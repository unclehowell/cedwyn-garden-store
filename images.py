#!/usr/bin/env python3
"""images.py - Garden Store (webapp 46 of 59): host Garden City's newer product photos ourselves, as phone-sized webp.

  TAB_TASK_ID=<id> timeout -k 5 900 python3 images.py            new = images on her shop that the last catalogue.json snapshot did not show
  TAB_TASK_ID=<id> timeout -k 5 900 python3 images.py --all      every image on her shop not yet hosted
  ... --dry                                                      count only

For each new image: fetch from her Shopify CDN (width=1200), write <key>-800.webp and <key>-400.webp, upload them to R2 wayback-media
under garden-store/img/ through a temporary writer Worker (created and deleted in the run, both logged in work/cf-rebalance/changes.json,
md5-checked), add the image to images.json (her CDN URL without query -> key), then delete the local files. The store Worker binds the
bucket and serves them at /garden-store/img/<key>-800.webp. Run sync.py afterwards so catalogue.json carries the hosted URLs; deploy.py
regenerates worker/images.js. Read-only on her site. Zero spend. - Sion's Tab agent"""
import json, os, re, sys, io, time, hashlib, secrets, base64, subprocess, urllib.request, pathlib, shutil
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
HERE = pathlib.Path(__file__).resolve().parent
MAPF, CAT = HERE / 'images.json', HERE / 'catalogue.json'
SHOP = 'https://gardencity.cymru'; PREFIX = 'garden-store/img/'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; bucklerfamily-garden-store-sync/0.2; +https://bucklerfamily.estate/garden-store/)'}
base = lambda u: (u or '').split('?')[0]

def keyname(u):
    stem = re.sub(r'[^a-z0-9]+', '-', base(u).rsplit('/', 1)[-1].rsplit('.', 1)[0].lower()).strip('-')[:60]
    return f"{stem}-{hashlib.sha1(base(u).encode()).hexdigest()[:8]}"

def her_products():
    out = []
    for page in range(1, 9):
        with urllib.request.urlopen(urllib.request.Request(f'{SHOP}/products.json?limit=250&page={page}&_cb={int(time.time())}', headers=UA), timeout=40) as r:
            ps = json.loads(r.read()).get('products') or []
        out += ps
        if len(ps) < 250: break
        time.sleep(2)
    return out

def convert(u, d):
    k = keyname(u); o8, o4 = d / f'{k}-800.webp', d / f'{k}-400.webp'
    url = base(u) + '?' + (('v=' + u.split('v=')[1].split('&')[0] + '&') if 'v=' in u else '') + 'width=1200'
    for a in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: data = r.read(); break
        except Exception as e: err = e; time.sleep(3 * (a + 1))
    else: return None
    im = Image.open(io.BytesIO(data)); im.load()
    if im.mode in ('P', 'LA', 'RGBA'):
        im = im.convert('RGBA'); bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, mask=im.split()[-1]); im = bg
    else: im = im.convert('RGB')
    for w, o, q in ((800, o8, 78), (400, o4, 74)):
        c = im.copy()
        if c.width > w: c = c.resize((w, round(c.height * w / c.width)), Image.LANCZOS)
        c.save(o, 'WEBP', quality=q, method=5)
    return k, [o8, o4]

def upload(files):
    sys.path.insert(0, '/home/user/tab/work/ebook-promo'); import ig_post as I
    tok = secrets.token_hex(24)
    js = ('export default { async fetch(req, env) { if (req.headers.get("x-t") !== env.TOK) return new Response("no",{status:403});'
          ' const u=new URL(req.url); if (u.pathname==="/ping") return new Response("ok"); const key=decodeURIComponent(u.pathname.slice(1));'
          ' if (req.method==="PUT") { const o=await env.M.put(key, req.body, {httpMetadata:{contentType:"image/webp", cacheControl:"public, max-age=31536000, immutable"}}); return new Response(JSON.stringify({key,size:o.size,etag:o.etag})); }'
          ' return new Response("?",{status:400}); } };')
    name = f"garden-img-writer-{secrets.token_hex(3)}"
    st, w = I.cf("POST", f"/client/v4/accounts/{I.ACC}/workers/workers", body={"name": name, "subdomain": {"enabled": True}})
    wid = w["result"]["id"]; url = w["result"]["subdomain"]["url"].rstrip('/')
    I.log_change(f"TEMPORARY Worker {name} (id {wid}) bound to R2 {I.BUCKET} to upload {len(files)} garden-store webp images; deleted right after", f"DELETE /client/v4/accounts/{I.ACC}/workers/workers/{wid}")
    ok = {}
    try:
        I.cf("POST", f"/client/v4/accounts/{I.ACC}/workers/workers/{wid}/versions", query={"deploy": "true"}, body={
            "compatibility_date": "2026-10-01", "main_module": "w.js",
            "bindings": [{"type": "r2_bucket", "name": "M", "bucket_name": I.BUCKET}, {"type": "secret_text", "name": "TOK", "text": tok}],
            "modules": [{"name": "w.js", "content_type": "application/javascript+module", "content_base64": base64.b64encode(js.encode()).decode()}]})
        for i in range(30):
            if subprocess.run(["curl", "-s", "-m", "20", "-H", f"x-t: {tok}", url + "/ping"], capture_output=True, text=True).stdout == "ok": break
            time.sleep(5)
        def put(f):
            md5 = hashlib.md5(open(f, 'rb').read()).hexdigest()
            for _ in range(5):
                r = subprocess.run(["timeout", "-k", "5", "90", "curl", "-s", "-m", "80", "-X", "PUT", "-H", f"x-t: {tok}", "--data-binary", "@" + str(f), f"{url}/{PREFIX}{os.path.basename(f)}"], capture_output=True, text=True)
                try:
                    if json.loads(r.stdout)['etag'] == md5: return f, True
                except Exception: pass
                time.sleep(3)
            return f, False
        with ThreadPoolExecutor(6) as ex:
            for f, good in ex.map(put, files): ok[str(f)] = good
    finally:
        I.cf("DELETE", f"/client/v4/accounts/{I.ACC}/workers/workers/{wid}")
        I.log_change(f"Temporary Worker {name} deleted after uploading garden-store images to R2 {I.BUCKET}", f"delete objects under {PREFIX} if unwanted")
    return ok

def main():
    mp = json.loads(MAPF.read_text())['map'] if MAPF.exists() else {}
    shown = set()
    if CAT.exists() and '--all' not in sys.argv:
        for p in json.loads(CAT.read_text())['products']: shown |= {base(u) for u in p['i']}
    want = []
    for p in her_products():
        for im in p.get('images') or []:
            b = base(im.get('src'))
            if b and b not in mp and b not in shown and im['src'] not in want: want.append(im['src'])
    print(json.dumps({'new_images': len(want), 'hosted_already': len(mp)}))
    if '--dry' in sys.argv or not want: return
    d = pathlib.Path(f"/home/user/tab/tasks/{os.environ.get('TAB_TASK_ID', 'garden-images')}/img"); d.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(4) as ex: done = [x for x in ex.map(lambda u: (u, convert(u, d)), want) if x[1]]
    ok = upload([f for _, (k, fs) in done for f in fs])
    for u, (k, fs) in done:
        if all(ok.get(str(f)) for f in fs): mp[base(u)] = k
    MAPF.write_text(json.dumps({'note': json.loads(MAPF.read_text())['note'] if MAPF.exists() else 'Garden City image -> hosted webp key. - Sion\'s Tab agent', 'map': mp}, indent=0, separators=(',', ':')))
    shutil.rmtree(d, ignore_errors=True)
    print(json.dumps({'hosted_now': sum(1 for u, _ in done if base(u) in mp), 'hosted_total': len(mp)}))

if __name__ == '__main__': main()
