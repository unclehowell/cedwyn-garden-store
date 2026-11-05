#!/usr/bin/env python3
"""Garden Store sync: re-reads Garden City's public catalogue (gardencity.cymru, a Shopify shop) and writes the compact
catalogue our plant store (bucklerfamily.estate/garden-store/, Worker cedwyn-garden-store) seeds from.

  python3 sync.py            fetch + write ./catalogue.json, print counts and whether anything changed
  python3 sync.py --check    fetch only, print counts (no writes)
  python3 sync.py --commit   ... and commit catalogue.json to unclehowell/cedwyn branch section/garden-store when it changed
  python3 sync.py --poke     ... and ask the live Worker to refresh its own database now (it also refreshes itself every 6 h)

Read-only on her site: public /products.json, polite pace (2 s between pages), cache-busted. Images: the ones images.py has hosted (images.json)
are written as our own webp URLs (/garden-store/img/<key>-800.webp); the rest are her Shopify CDN URLs. Never buys, never contacts anyone. Commits through
work/site-flywheels/tools/gh.py (no force-push). - Sion's Tab agent"""
import json, os, re, sys, time, html, hashlib, urllib.request, pathlib, base64
SHOP = 'https://gardencity.cymru'
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'catalogue.json'
MAPF = HERE / 'images.json'
IMG_BASE = 'https://bucklerfamily.estate/garden-store/img/'
IMAX = 16
IMAP = json.loads(MAPF.read_text())['map'] if MAPF.exists() else {}
def hosted(u):
    k = IMAP.get((u or '').split('?')[0])
    return IMG_BASE + k + '-800.webp' if k else u
STATE = HERE / 'state.json'
REPO, BRANCH = 'unclehowell/cedwyn', 'section/garden-store'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; bucklerfamily-garden-store-sync/0.1; +https://bucklerfamily.estate/garden-store/)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.loads(r.read().decode('utf-8'))

def text(h, n=420):
    t = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', h or '', flags=re.S | re.I)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'\s+', ' ', t).strip()
    return t if len(t) <= n else t[:n].rsplit(' ', 1)[0] + '…'

def compact(p):
    vs = p.get('variants') or []
    prices = [float(v['price']) for v in vs if v.get('price')] or [0.0]
    cmp_ = [float(v['compare_at_price']) for v in vs if v.get('compare_at_price')]
    return {'h': p['handle'], 't': p['title'].strip(), 'ty': (p.get('product_type') or '').strip(),
            'tg': (p.get('tags') or [])[:6], 'p': '%.2f' % min(prices), 'pm': '%.2f' % max(prices),
            'c': ('%.2f' % max(cmp_)) if cmp_ and max(cmp_) > max(prices) else '',
            'a': any(v.get('available') for v in vs),
            'i': [hosted(im['src']) for im in (p.get('images') or [])[:IMAX] if im.get('src')],
            'v': [[(v.get('title') or '').strip(), v.get('price') or '', bool(v.get('available')), v.get('id')] for v in vs[:30]],
            'd': text(p.get('body_html')), 'u': (p.get('updated_at') or '')[:10]}

def fetch():
    out = []
    for page in range(1, 9):
        j = get(f'{SHOP}/products.json?limit=250&page={page}&_cb={int(time.time())}')
        ps = j.get('products') or []
        out += [compact(p) for p in ps]
        if len(ps) < 250: break
        time.sleep(2)
    out.sort(key=lambda x: (not x['a'], x['t'].lower()))
    return out

def main():
    prods = fetch()
    body = {'source': SHOP, 'platform': 'Shopify (garden-fairies-wales.myshopify.com)', 'currency': 'GBP',
            'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'count': len(prods), 'products': prods}
    digest = hashlib.sha256(json.dumps(prods, sort_keys=True).encode()).hexdigest()[:16]
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    changed = digest != st.get('digest')
    info = {'products': len(prods), 'in_stock': sum(p['a'] for p in prods),
            'variants': sum(len(p['v']) for p in prods), 'digest': digest, 'changed': changed}
    print(json.dumps(info))
    if '--check' in sys.argv: return
    data = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(data, encoding='utf-8')
    st.update({'digest': digest, 'checked': body['fetched'], 'last': info})
    if '--commit' in sys.argv and changed:
        sys.path.insert(0, '/home/user/tab/work/site-flywheels/tools'); import gh as G
        st_, ref = G.gh('GET', f'/repos/{REPO}/git/ref/heads/{BRANCH}')
        if st_ == 200:
            cur = G.gh('GET', f'/repos/{REPO}/contents/catalogue.json?ref={BRANCH}')[1]
            b = {'message': f'garden-store: catalogue sync, {len(prods)} products ({digest}) — Sion\'s Tab agent',
                 'content': base64.b64encode(data.encode()).decode(), 'branch': BRANCH}
            if isinstance(cur, dict) and cur.get('sha'): b['sha'] = cur['sha']
            s2, r2 = G.gh('PUT', f'/repos/{REPO}/contents/catalogue.json', b)
            st['commit'] = {'status': s2, 'sha': ((r2 or {}).get('commit') or {}).get('sha') if isinstance(r2, dict) else None}
            print('commit', st['commit'])
    STATE.write_text(json.dumps(st, indent=1))
    if '--poke' in sys.argv:
        try:
            req = urllib.request.Request('https://bucklerfamily.estate/garden-store/api/refresh?_cb=%d' % time.time(), method='POST', headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r: print('poke', r.status, r.read()[:200])
        except Exception as e: print('poke failed', e)

if __name__ == '__main__': main()
