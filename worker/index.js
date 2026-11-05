// cedwyn-garden-store — Garden Store (webapp 46 of 59): our own plant store mirroring Garden City's catalogue
// (gardencity.cymru). Every "Buy" opens HER product page in a new tab; she sells, takes payment and delivers. We never take payment.
// Served at https://bucklerfamily.estate/garden-store/ (apex router -> cedwyn.bucklerfamily.estate/garden-store* -> this Worker).
// Own database: SQLite-backed Durable Object GardenDB (catalogue rows + guest book), refreshed from her public /products.json
// every 6 h by a DO alarm, seeded from the branch snapshot (catalogue.js). 0.4.1: her newer photos are hosted here as phone-sized webp
// (R2 binding IMG, served at /garden-store/img/<key>-800.webp | -400.webp; map in images.js from images.json); the rest still load from her Shopify CDN.
// Source: unclehowell/cedwyn branch section/garden-store. — Sion's Tab agent
import SEED from './catalogue.js';
import META from './meta.js';
import IMGMAP from './images.js';
const VERSION = META.version;
const SHOP = 'https://gardencity.cymru';
const UTM = 'utm_source=bucklerfamily&utm_medium=garden-store';
const BASE = '/garden-store';
const SLOT = 46, OF = 59;
const REFRESH_MS = 6 * 3600 * 1000;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = p => '£' + Number(p || 0).toFixed(2);
const buyUrl = (h, vid) => SHOP + '/products/' + encodeURIComponent(h) + '?' + UTM + (vid ? '&variant=' + vid : '');
const IMG_BASE = 'https://bucklerfamily.estate/garden-store/img/';
const IMAX = 16;
const hosted = u => { const k = IMGMAP[String(u || '').split('?')[0]]; return k ? IMG_BASE + k + '-800.webp' : u; };
const img = (u, w) => !u ? '' : u.startsWith(IMG_BASE) ? (w <= 400 ? u.replace(/-800\.webp$/, '-400.webp') : u) : u + (u.includes('?') ? '&' : '?') + 'width=' + w;
const PLANT = /plant|shrub|grass|flower|bulb|tree|perennial|herb|fern|climber|hedg|lily|lilies|rose|fruit|seed|succulent|cact|palm|bamboo|phormium|hosta|alpine|bedding/i;
const isPlant = p => PLANT.test(p.ty + ' ' + p.tg.join(' ') + ' ' + p.t);
const slug = s => String(s || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';

// 0.4.0: Google (schema.org Product/Offer, Merchant Center feed, sitemap) + agents (WebMCP, MCP endpoint, dropship JSON).
const SITE = 'https://bucklerfamily.estate';
const SUPPLIER = { name: 'Garden City', legal_name: 'Garden City Cymru', url: SHOP, country: 'GB', platform: 'Shopify',
  fulfilment: 'The supplier ships each order direct to the customer (dropship). Orders are placed on the supplier product page (order_url); the supplier takes the payment.',
  dispatch: 'within 48 hours', delivery: '1-6 working days (UK)', shipping_gbp: 6, free_shipping_over_gbp: 50,
  returns: '30 days from purchase; change-of-mind returns at the customer cost; damaged items replaced or refunded by the supplier',
  policies: { shipping: SHOP + '/policies/shipping-policy', returns: SHOP + '/policies/refund-policy', terms: SHOP + '/policies/terms-of-service' } };
const SHIP_LD = { '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: 6, currency: 'GBP' },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'GB' },
  deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
    transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 6, unitCode: 'DAY' } } };
const RET_LD = { '@type': 'MerchantReturnPolicy', applicableCountry: 'GB', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 30, returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnShippingFees' };
const SELLER_LD = { '@type': 'Organization', name: 'Garden City', url: SHOP };
const vname = v => (v && v[0] && !/^default title$/i.test(v[0])) ? v[0] : '';
const pageUrl = p => SITE + BASE + '/p/' + encodeURIComponent(p.h) + '/';
const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
const xesc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const money = x => Number(x || 0).toFixed(2);
function productLD(p) {
  const vs = p.v.length ? p.v : [['', p.p, p.a, '']];
  return [{ '@context': 'https://schema.org', '@type': 'Product', '@id': pageUrl(p) + '#product', name: p.t, description: p.d || p.t,
    image: p.i.slice(0, IMAX), sku: p.h, brand: { '@type': 'Brand', name: 'Garden City' }, category: p.ty || 'Plants', url: pageUrl(p),
    offers: vs.map(v => ({ '@type': 'Offer', sku: String(v[3] || p.h), name: vname(v) || undefined, url: pageUrl(p), price: money(v[1]), priceCurrency: 'GBP',
      availability: v[2] ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition',
      seller: SELLER_LD, shippingDetails: SHIP_LD, hasMerchantReturnPolicy: RET_LD })) },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Garden Store', item: SITE + BASE + '/' },
    { '@type': 'ListItem', position: 2, name: p.t, item: pageUrl(p) }] }];
}

function compact(p) {
  const vs = p.variants || [];
  const prices = vs.map(v => parseFloat(v.price)).filter(x => !isNaN(x));
  const cmp = vs.map(v => parseFloat(v.compare_at_price)).filter(x => !isNaN(x));
  const mx = prices.length ? Math.max(...prices) : 0, mn = prices.length ? Math.min(...prices) : 0;
  let d = String(p.body_html || '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  if (d.length > 420) d = d.slice(0, 420).replace(/\s+\S*$/, '') + '…';
  return { h: p.handle, t: String(p.title || '').trim(), ty: String(p.product_type || '').trim(), tg: (p.tags || []).slice(0, 6),
    p: mn.toFixed(2), pm: mx.toFixed(2), c: cmp.length && Math.max(...cmp) > mx ? Math.max(...cmp).toFixed(2) : '',
    a: vs.some(v => v.available), i: (p.images || []).slice(0, IMAX).map(x => x.src).filter(Boolean).map(hosted),
    v: vs.slice(0, 30).map(v => [String(v.title || '').trim(), v.price || '', !!v.available, v.id]), d, u: String(p.updated_at || '').slice(0, 10) };
}

export class GardenDB {
  constructor(state, env) {
    this.state = state; this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS products (h TEXT PRIMARY KEY, seq INTEGER, data TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, who TEXT, version TEXT, change TEXT)');
  }
  meta(k, v) {
    if (v === undefined) { const r = this.sql.exec('SELECT v FROM meta WHERE k=?', k).toArray(); return r.length ? r[0].v : null; }
    this.sql.exec('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)', k, String(v));
  }
  store(list, source, fetched) {
    this.sql.exec('DELETE FROM products');
    list.forEach((p, i) => this.sql.exec('INSERT OR REPLACE INTO products (h,seq,data) VALUES (?,?,?)', p.h, i, JSON.stringify(p)));
    this.meta('source', source); this.meta('fetched', fetched); this.meta('count', list.length);
  }
  async refresh() {
    const out = [];
    for (let page = 1; page <= 8; page++) {
      const r = await fetch(SHOP + '/products.json?limit=250&page=' + page + '&_cb=' + Date.now(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; bucklerfamily-garden-store/' + VERSION + ')' } });
      if (!r.ok) throw new Error('her catalogue answered ' + r.status);
      const ps = (await r.json()).products || [];
      out.push(...ps.map(compact));
      if (ps.length < 250) break;
    }
    if (!out.length) throw new Error('her catalogue was empty');
    out.sort((a, b) => (a.a === b.a ? a.t.toLowerCase().localeCompare(b.t.toLowerCase()) : a.a ? -1 : 1));
    this.store(out, 'live', new Date().toISOString());
    return out.length;
  }
  // Her shop rate-limits some cloud addresses (429). Fallback: the branch snapshot that sync.py --commit keeps fresh from the box.
  async fromBranch() {
    const r = await fetch('https://raw.githubusercontent.com/unclehowell/cedwyn/section/garden-store/catalogue.json?_cb=' + Date.now());
    if (!r.ok) throw new Error('branch snapshot answered ' + r.status);
    const j = await r.json();
    if (!j.products || !j.products.length) throw new Error('branch snapshot empty');
    if (this.meta('source') === 'live' && Date.parse(this.meta('fetched')) >= Date.parse(j.fetched)) return 0;
    this.store(j.products, 'branch snapshot', j.fetched);
    return j.products.length;
  }
  async update() {
    try { const n = await this.refresh(); this.meta('last_ok', new Date().toISOString() + ' live (' + n + ')'); return { ok: true, products: n, via: 'live' }; }
    catch (e) {
      this.meta('last_error', new Date().toISOString() + ' ' + String(e.message || e).slice(0, 200));
      const n = await this.fromBranch();
      this.meta('last_ok', new Date().toISOString() + ' branch snapshot (' + n + ')');
      return { ok: true, products: n, via: 'branch snapshot', live_error: String(e.message || e) };
    }
  }
  async alarm() {
    try { await this.update(); }
    catch (e) { this.meta('last_error', new Date().toISOString() + ' ' + String(e.message || e).slice(0, 200)); }
    await this.state.storage.setAlarm(Date.now() + REFRESH_MS);
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (!this.meta('count')) this.store(SEED.products, 'snapshot', SEED.fetched);
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + 2000);
    if (this.meta('seed_build') !== META.build) { this.meta('seed_build', META.build); if (Date.parse(SEED.fetched) >= (Date.parse(this.meta('fetched')) || 0)) this.store(SEED.products, 'snapshot', SEED.fetched); }
    if (this.meta('source') === 'snapshot' && this.meta('retry_build') !== META.build) { this.meta('retry_build', META.build); await this.state.storage.setAlarm(Date.now() + 2000); }
    if (u.pathname === '/cat') {
      const rows = this.sql.exec('SELECT data FROM products ORDER BY seq').toArray().map(r => JSON.parse(r.data));
      return Response.json({ source: this.meta('source'), fetched: this.meta('fetched'), last_ok: this.meta('last_ok'), last_error: this.meta('last_error'), products: rows });
    }
    if (u.pathname === '/refresh') {
      const last = Date.parse(this.meta('manual_at') || 0) || 0;
      if (Date.now() - last < 10 * 60 * 1000) return Response.json({ ok: false, why: 'refreshed less than 10 minutes ago', fetched: this.meta('fetched') }, { status: 429 });
      this.meta('manual_at', new Date().toISOString());
      try { const o = await this.update(); return Response.json(Object.assign(o, { fetched: this.meta('fetched'), source: this.meta('source') })); }
      catch (e) { return Response.json({ ok: false, why: String(e.message || e) }, { status: 502 }); }
    }
    if (u.pathname === '/gb' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch (e) {}
      const who = String(b.who || '').trim().slice(0, 60), change = String(b.change || '').trim().slice(0, 300), version = String(b.version || VERSION).slice(0, 20);
      if (!who || !change) return Response.json({ ok: false, why: 'who and change are required' }, { status: 400 });
      const today = new Date().toISOString().slice(0, 10);
      const n = this.sql.exec("SELECT COUNT(*) AS n FROM guestbook WHERE substr(at,1,10)=?", today).toArray()[0].n;
      if (n >= 50) return Response.json({ ok: false, why: 'daily guest book limit reached' }, { status: 429 });
      this.sql.exec('INSERT INTO guestbook (at,who,version,change) VALUES (?,?,?,?)', new Date().toISOString(), who, version, change);
      return Response.json({ ok: true });
    }
    if (u.pathname === '/gb') return Response.json({ entries: this.sql.exec('SELECT at,who,version,change FROM guestbook ORDER BY id DESC LIMIT 100').toArray() });
    return new Response('not found', { status: 404 });
  }
}

let CAT = null, CAT_AT = 0;
async function catalogue(env) {
  if (CAT && Date.now() - CAT_AT < 120000) return CAT;
  try {
    const stub = env.GARDEN.get(env.GARDEN.idFromName('garden-store'));
    const r = await stub.fetch('https://do/cat');
    if (r.ok) { const j = await r.json(); if (j.products && j.products.length) { CAT = j; CAT_AT = Date.now(); return CAT; } }
  } catch (e) {}
  return CAT || { source: 'snapshot', fetched: SEED.fetched, products: SEED.products };
}
async function gbEntries(env) {
  try { const r = await env.GARDEN.get(env.GARDEN.idFromName('garden-store')).fetch('https://do/gb'); return (await r.json()).entries || []; } catch (e) { return []; }
}

const CSS = `
:root{--g:#2f5d3a;--g2:#e9f2ea;--ink:#1d2a20;--mut:#5d6b60;--line:#d8e2d9}
.gs{margin:0;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#fbfdfb}
.gs *{box-sizing:border-box}.gs img{max-width:100%;display:block}
.gs-w{max-width:1100px;margin:0 auto;padding:12px 14px 40px;overflow-x:hidden}
.gs-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--mut);border-bottom:1px solid var(--line);padding:6px 0;margin-bottom:10px;flex-wrap:wrap}
.gs-bar a{color:var(--g);text-decoration:none}.gs-bar b{color:var(--ink)}
.gs h1{font-size:1.6rem;margin:.3em 0 .1em;color:var(--g)}.gs h1 small{display:block;font-size:.8rem;color:var(--mut);font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.gs-prov{margin:.35em 0 .5em;max-width:62ch;font-size:1.02rem;line-height:1.45;color:var(--g);font-style:italic}.gs-intro{color:var(--mut);margin:.2em 0 .8em;max-width:60ch}
.gs-sold{display:inline-block;background:var(--g2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12.5px;color:var(--g)}
.gs-tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.gs-tools input{flex:1 1 180px;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:10px;font:inherit}
.gs-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;max-width:100%}
.gs-chips button{flex:0 0 auto;border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
.gs-chips button[aria-pressed=true]{background:var(--g);color:#fff;border-color:var(--g)}
.gs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px}
.gs-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
.gs-card a.gs-ph{display:block;aspect-ratio:1/1;background:var(--g2)}
.gs-card a.gs-ph img{width:100%;height:100%;object-fit:cover}
.gs-cb{padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px;flex:1}
.gs .gs-cb h2{font-size:.92rem!important;line-height:1.25!important;margin:0!important;font-weight:600;overflow-wrap:anywhere;text-transform:none!important;letter-spacing:0!important;font-family:inherit!important;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.gs .gs-cb h2 a{color:inherit;text-decoration:none}
.gs-ty{font-size:11.5px;color:var(--mut)}.gs-pr{font-weight:700;color:var(--g)}.gs-pr s{color:var(--mut);font-weight:400;margin-left:4px}
.gs-out{font-size:11.5px;color:#9a3b1f}
.gs-buy{display:block;text-align:center;background:var(--g);color:#fff!important;text-decoration:none;border-radius:10px;padding:8px 10px;font-weight:600;margin-top:auto;font-size:14px}
.gs-buy.big{font-size:16px;padding:12px 14px;margin:12px 0 4px}
.gs-note{font-size:12.5px;color:var(--mut)}
.gs-p{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:760px){.gs-p{grid-template-columns:1.1fr 1fr}}
.gs-gal img{border-radius:14px;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--g2)}
.gs-th{display:flex;gap:8px;margin-top:8px;overflow-x:auto}.gs-th img{width:72px;height:72px;object-fit:cover;border-radius:8px;flex:0 0 auto}
.gs-vt{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}.gs-vt td{border-top:1px solid var(--line);padding:6px 4px;vertical-align:middle}
.gs-vt td:last-child{text-align:right;white-space:nowrap}.gs-vt a{color:var(--g);font-weight:600}
.gs-f{margin-top:28px;border-top:1px solid var(--line);padding-top:12px;font-size:13px;color:var(--mut)}
.gs-f details{margin:8px 0}.gs-f summary{cursor:pointer;color:var(--g);font-weight:600}
.gs-f table{width:100%;border-collapse:collapse;font-size:12.5px}.gs-f td,.gs-f th{border-top:1px solid var(--line);padding:4px;text-align:left;vertical-align:top}
.gs-tw{overflow-x:auto;max-width:100%}
.gs-pg{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px;margin:22px 0 6px;font-size:15px}
.gs-pg a,.gs-pg span{min-width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;text-decoration:none;color:var(--g);padding:0 6px;box-sizing:border-box}
.gs-pg a:hover,.gs-pg a:focus-visible{background:var(--g2)}
.gs-pg span[aria-current]{background:var(--g);color:#fff;font-weight:700}
.gs-pg .gs-el{min-width:14px;padding:0;color:var(--mut)}
.gs-pg .gs-pn{font-weight:600;padding:0 8px}
.gs-tools{scroll-margin-top:76px}
@media(max-width:420px){.gs-pg .gs-pl{display:none}.gs-pg .gs-pn{padding:0 6px}}
.gs-hide{display:none!important}
`;

function shell(title, desc, body, extraHead) {
  return `<!doctype html><html lang="en" data-cw-noclip data-cw-nolevels><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#2f5d3a">
<link rel="canonical" href="https://bucklerfamily.estate${extraHead && extraHead.canon || BASE + '/'}">${extraHead && extraHead.head || ''}
<link rel="alternate" type="text/plain" href="${BASE}/llms.txt" title="For AI agents"><link rel="alternate" type="application/json" href="${BASE}/catalogue.json" title="Catalogue (JSON)"><link rel="alternate" type="application/rss+xml" href="${BASE}/feed.xml" title="Product feed"><link rel="sitemap" type="application/xml" href="${BASE}/sitemap.xml">
<meta name="ai-agents" content="Dropship catalogue: ${BASE}/products.json · MCP: POST ${BASE}/mcp (discovery ${BASE}/.well-known/mcp) · search: ${BASE}/api/search?q= · product: ${BASE}/api/product/<handle> · WebMCP tools garden_store_* · Merchant feed: ${BASE}/feed.xml · guest book: POST ${BASE}/api/guestbook">
<style>${CSS}</style><script src="/_cedwyn/ghf/ghf-boot.js?v=2.1.19"></script></head><body class="gs"><main class="gs-w" data-scope="online">${body}</main></body></html>`;
}

function navBar() {
  return `<nav class="gs-bar" aria-label="Webapps"><a href="/analytics/" rel="prev">‹ Analytics</a><b>Garden Store · ${SLOT} of ${OF}</b><a href="/wiki/" rel="next">Wiki ›</a></nav>`;
}

function footer(gb) {
  const rows = META.changelog.map(r => `<tr><td>v${esc(r.v)}</td><td>${esc(r.d)}</td><td>${esc(r.c)}</td></tr>`).join('');
  const gbr = gb.map(e => `<tr><td>${esc(String(e.at).slice(0, 10))}</td><td>v${esc(e.version)}</td><td>${esc(e.change)}</td><td>${esc(e.who)}</td></tr>`).join('')
    + META.guestbook.map(e => `<tr><td>${esc(e.d)}</td><td>v${esc(e.v)}</td><td>${esc(e.c)}</td><td>${esc(e.who)}</td></tr>`).join('');
  const n = gb.length + META.guestbook.length;
  return `<footer class="gs-f">
<p><b>Sold and fulfilled by Garden City (gardencity.cymru).</b> This store mirrors Garden City's own catalogue: prices are hers, and every Buy button opens her product page, where she takes the order, the payment and the delivery. We never take payment and hold no card details.</p>
<details class="gs-ver" id="gs-ver"><summary>v${esc(VERSION)} ⓘ changelog</summary><div class="gs-tw"><table><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div></details>
<details class="gs-gb" id="gs-gb"><summary>Agent guest book (${n})</summary><div class="gs-tw"><table><thead><tr><th>Date</th><th>Version</th><th>Change</th><th>Who</th></tr></thead><tbody>${gbr}</tbody></table></div></details>
<p data-for-agents hidden>Agents: read ${BASE}/llms.txt. Dropship catalogue ${BASE}/products.json; MCP POST ${BASE}/mcp; catalogue ${BASE}/catalogue.json; search ${BASE}/api/search?q=; one product ${BASE}/api/product/&lt;handle&gt; (its buy_url is Garden City's own product page). Log every change you make to this webapp with POST ${BASE}/api/guestbook {"who","change","version"} or the WebMCP tool garden_store_guestbook_sign.</p>
</footer>`;
}

const WEBMCP = `<script>(function(){var B='${BASE}';function j(u,o){return fetch(u,o).then(function(r){return r.json()})}
var RO={readOnlyHint:true,untrustedContentHint:true},S={type:'object',properties:{query:{type:'string',description:'Words to match in the product name, type, tags or description'},type:{type:'string',description:'Product type, e.g. Perennial'},in_stock_only:{type:'boolean'}}};
var tools=[{name:'garden_store_search',title:'Search the garden store',description:'Search the Garden Store catalogue (plants and home & gift items supplied and shipped by Garden City, gardencity.cymru). Returns up to 50 products with price (GBP), stock, supplier order_url and dropship details. Read-only; never takes payment.',inputSchema:S,annotations:RO,execute:function(a){a=a||{};return j(B+'/api/search?q='+encodeURIComponent(a.query||'')+'&type='+encodeURIComponent(a.type||'')+(a.in_stock_only?'&stock=1':''))}},
{name:'garden_store_list_products',title:'List products (paged)',description:'Page through the whole dropship catalogue: products with variants, prices (GBP), stock, images, supplier order_url, shipping and returns terms. Read-only.',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1},per_page:{type:'integer',minimum:1,maximum:100},in_stock_only:{type:'boolean'}}},annotations:RO,execute:function(a){a=a||{};return j(B+'/products.json?page='+(a.page||1)+'&per_page='+(a.per_page||50)+(a.in_stock_only?'&in_stock=1':''))}},
{name:'garden_store_product',title:'Get one product',description:'One product by handle: variants, prices, images, the supplier order_url and dropship terms. Garden City takes the order, payment and delivery.',inputSchema:{type:'object',properties:{handle:{type:'string'}},required:['handle']},annotations:RO,execute:function(a){return j(B+'/api/product/'+encodeURIComponent(a.handle))}},
{name:'garden_store_dropship_terms',title:'Dropship and reseller terms',description:'Supplier, fulfilment, shipping, returns, referral tagging and the rule that this store never takes payment.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:function(){return j(B+'/products.json?per_page=1').then(function(r){return {supplier:r.supplier,ordering:r.ordering,referral:r.referral,reseller_rules:r.reseller_rules}})}},
{name:'garden_store_buy_link',title:'Supplier order link',description:'The exact Garden City product page where a customer places the order and pays (opens her shop; this store never takes payment).',inputSchema:{type:'object',properties:{handle:{type:'string'},variant_id:{type:'number'}},required:['handle']},annotations:{readOnlyHint:true},execute:function(a){return {order_url:'${SHOP}/products/'+encodeURIComponent(a.handle)+'?${UTM}'+(a.variant_id?'&variant='+a.variant_id:'')}}},
{name:'garden_store_guestbook_sign',title:'Sign the agent guest book',description:'Log a change you made to this webapp in its agent guest book.',inputSchema:{type:'object',properties:{who:{type:'string'},change:{type:'string'},version:{type:'string'}},required:['who','change']},annotations:{readOnlyHint:false},execute:function(a){return j(B+'/api/guestbook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a)})}}];
var mc=(document.modelContext)||(navigator.modelContext);if(mc){if(typeof mc.registerTool==='function')tools.forEach(function(t){try{var r=mc.registerTool(t);if(r&&r.catch)r.catch(function(){})}catch(e){}});else if(typeof mc.provideContext==='function')try{mc.provideContext({tools:tools})}catch(e){}}
var fm=document.getElementById('gs-form');if(fm)fm.addEventListener('submit',function(e){e.preventDefault();if(e.agentInvoked&&typeof e.respondWith==='function'){var q=document.getElementById('gs-q');e.respondWith(j(B+'/api/search?q='+encodeURIComponent(q?q.value:'')))}});
window.cedwynGardenStore={tools:tools};
function slot(){var s=document.querySelector('.ghf-v2-name small');if(s&&!s.textContent.trim())s.textContent='${SLOT} of ${OF}'}document.addEventListener('DOMContentLoaded',function(){slot();setTimeout(slot,1500)});})();</script>`;

function card(p, hide) {
  const price = p.p === p.pm ? gbp(p.p) : 'from ' + gbp(p.p);
  return `<article class="gs-card${hide ? ' gs-hide' : ''}" data-ty="${esc(slug(p.ty))}" data-g="${isPlant(p) ? 'plant' : 'home'}" data-q="${esc((p.t + ' ' + p.ty + ' ' + p.tg.join(' ')).toLowerCase())}">
<a class="gs-ph" href="${BASE}/p/${esc(p.h)}/">${p.i[0] ? `<img src="${esc(img(p.i[0], 400))}" alt="${esc(p.t)}" loading="lazy" width="400" height="400" referrerpolicy="no-referrer">` : ''}</a>
<div class="gs-cb"><span class="gs-ty">${esc(p.ty || 'Plant')}</span><h2><a href="${BASE}/p/${esc(p.h)}/">${esc(p.t)}</a></h2>
<span class="gs-pr">${price}${p.c ? `<s>${gbp(p.c)}</s>` : ''}</span>${p.a ? '' : '<span class="gs-out">Sold out at Garden City</span>'}
<a class="gs-buy" href="${esc(buyUrl(p.h))}" target="_blank" rel="noopener" data-buy="${esc(p.h)}">Buy on Garden City ↗</a></div></article>`;
}

// 0.3.0: 20 products per page with a Google-style page bar (owner request 14:11 GMT 2 Nov 2026).
const PER = 20;
function pagesList(total, cur, r) {
  var b = 2 * r + 3, out = [], i;
  if (total <= b + 2) { for (i = 1; i <= total; i++) out.push(i); return out; }
  if (cur <= b - 1) { for (i = 1; i <= b; i++) out.push(i); out.push(0, total); return out; }
  if (cur >= total - b + 2) { out.push(1, 0); for (i = total - b + 1; i <= total; i++) out.push(i); return out; }
  out.push(1, 0); for (i = cur - r; i <= cur + r; i++) out.push(i); out.push(0, total); return out;
}
function pagerHtml(total, cur, href) {
  if (total <= 1) return '';
  var h = '';
  if (cur > 1) h += '<a class="gs-pn" rel="prev" href="' + href(cur - 1) + '" data-p="' + (cur - 1) + '" aria-label="Previous page">‹<span class="gs-pl">&nbsp;Previous</span></a>';
  pagesList(total, cur, 1).forEach(function (n) {
    h += n === 0 ? '<span class="gs-el" aria-hidden="true">…</span>' : n === cur ? '<span aria-current="page">' + n + '</span>' : '<a href="' + href(n) + '" data-p="' + n + '" aria-label="Page ' + n + '">' + n + '</a>';
  });
  if (cur < total) h += '<a class="gs-pn" rel="next" href="' + href(cur + 1) + '" data-p="' + (cur + 1) + '" aria-label="Next page"><span class="gs-pl">Next&nbsp;</span>›</a>';
  return h;
}

async function home(env, u) {
  const cat = await catalogue(env);
  const ps = cat.products.filter(isPlant).concat(cat.products.filter(p => !isPlant(p)));
  const nPl = cat.products.filter(isPlant).length;
  const types = {}; ps.forEach(p => { const k = p.ty || 'Other'; types[k] = (types[k] || 0) + 1; });
  const groups = `<button type="button" data-g="plant" aria-pressed="false">Plants (${nPl})</button><button type="button" data-g="home" aria-pressed="false">Home &amp; gifts (${ps.length - nPl})</button>`;
  const chips = groups + Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button type="button" data-f="${esc(slug(k))}" aria-pressed="false">${esc(k)} (${n})</button>`).join('');
  const inStock = ps.filter(p => p.a).length;
  const sp = u ? u.searchParams : new URLSearchParams();
  const fq = (sp.get('q') || '').toLowerCase().trim(), ft = sp.get('type') || '', fg = sp.get('group') || '';
  const shown = ps.filter(p => (!ft || slug(p.ty) === ft) && (!fg || (isPlant(p) ? 'plant' : 'home') === fg) && (!fq || (p.t + ' ' + p.ty + ' ' + p.tg.join(' ')).toLowerCase().includes(fq)));
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const hm = String(sp.get('page') || '').match(/^\d+$/);
  const cur = Math.min(pages, Math.max(1, hm ? parseInt(hm[0], 10) : 1));
  const onPage = new Set(shown.slice((cur - 1) * PER, cur * PER).map(p => p.h));
  const qs = n => { const s = new URLSearchParams(); if (fq) s.set('q', fq); if (ft) s.set('type', ft); if (fg) s.set('group', fg); if (n > 1) s.set('page', n); const t = s.toString(); return BASE + '/' + (t ? '?' + t : ''); };
  const first = shown.length ? (cur - 1) * PER + 1 : 0, last = Math.min(cur * PER, shown.length);
  const body = `${navBar()}
<h1><small>Order the Garden&rsquo;s surviving flowers</small>Garden Store</h1>
<p class="gs-prov">These flowers are grown by Mary Buckler II, granddaughter of Mary Williams of Great House Farm, Llandough &mdash; the Williams matriarchy estate and realm.</p>
<p class="gs-intro">Peat-free plants grown in Wales, plus home and gift pieces, from Garden City's own catalogue: ${nPl} plants and ${ps.length - nPl} home &amp; gift items, ${inStock} in stock. Pick one here, then buy it on Garden City's shop.</p>
<span class="gs-sold">Sold and fulfilled by Garden City (gardencity.cymru)</span>
<form class="gs-tools" id="gs-form" role="search" action="${BASE}/" method="get" toolname="garden_store_search_form" tooldescription="Search the Garden Store catalogue of plants and home &amp; gift items supplied by Garden City; returns matching products as JSON with prices and supplier order links."><input type="search" id="gs-q" name="q" placeholder="Search plants" aria-label="Search plants" toolparamdescription="Words to match in the product name, type or tags"></form>
<div class="gs-chips" role="group" aria-label="Filter by type"><button type="button" data-f="" aria-pressed="true">All (${ps.length})</button>${chips}</div>
<p class="gs-note" id="gs-n" aria-live="polite">${shown.length ? first + '–' + last + ' of ' + shown.length : 'Nothing matches'}</p>
<div class="gs-grid" id="gs-grid">${ps.map(p => card(p, !onPage.has(p.h))).join('')}</div>
<nav class="gs-pg" id="gs-pg" aria-label="Pages">${pagerHtml(pages, cur, qs)}</nav>
${footer(await gbEntries(env))}
<script>(function(){var PER=${PER},q=document.getElementById('gs-q'),cs=[].slice.call(document.querySelectorAll('.gs-card')),bs=[].slice.call(document.querySelectorAll('.gs-chips button')),f='',g='',page=1,n=document.getElementById('gs-n'),pg=document.getElementById('gs-pg'),top=document.querySelector('.gs-tools');
${pagesList.toString()}
${pagerHtml.toString()}
function href(p){var s=new URLSearchParams(),t=(q.value||'').toLowerCase().trim();if(t)s.set('q',t);if(f)s.set('type',f);if(g)s.set('group',g);if(p>1)s.set('page',p);s=s.toString();return location.pathname+(s?'?'+s:'')}
function read(){var s=new URLSearchParams(location.search),h=(location.hash.match(/page=(\\d+)/)||[])[1];q.value=s.get('q')||'';f=s.get('type')||'';g=s.get('group')||'';page=parseInt(s.get('page')||h||'1',10)||1;bs.forEach(function(x){x.setAttribute('aria-pressed',String(f?x.dataset.f===f:g?x.dataset.g===g:(!x.dataset.g&&!x.dataset.f)))})}
function go(scroll){var t=(q.value||'').toLowerCase().trim(),m=cs.filter(function(c){return(!f||c.dataset.ty===f)&&(!g||c.dataset.g===g)&&(!t||c.dataset.q.indexOf(t)>=0)}),total=Math.max(1,Math.ceil(m.length/PER));page=Math.min(total,Math.max(1,page));var a=(page-1)*PER,b=Math.min(a+PER,m.length);cs.forEach(function(c){c.classList.add('gs-hide')});m.slice(a,b).forEach(function(c){c.classList.remove('gs-hide')});n.textContent=m.length?(a+1)+'–'+b+' of '+m.length:'Nothing matches';pg.innerHTML=pagerHtml(total,page,href);if(scroll&&top)top.scrollIntoView({block:'start'})}
function filt(){page=1;history.replaceState(null,'',href(1));go(false)}
q.addEventListener('input',filt);bs.forEach(function(b){b.addEventListener('click',function(){f=b.dataset.f||'';g=b.dataset.g||'';bs.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});filt()})});
pg.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-p]');if(!a||e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();page=parseInt(a.dataset.p,10)||1;history.pushState({p:page},'',href(page));go(true)});
window.addEventListener('popstate',function(){read();go(false);setTimeout(function(){if(top)top.scrollIntoView({block:'start'})},60)});
read();if(/page=\\d/.test(location.hash))history.replaceState(null,'',href(page));go(false)})();</script>
${WEBMCP}`;
  const plain = !fq && !ft && !fg, canon = BASE + '/' + (plain && cur > 1 ? '?page=' + cur : '');
  const listLD = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Garden Store' + (cur > 1 ? ' · page ' + cur : ''), url: SITE + canon,
    mainEntity: { '@type': 'ItemList', numberOfItems: shown.length, itemListElement: shown.slice((cur - 1) * PER, cur * PER).map((p, k) => ({ '@type': 'ListItem', position: (cur - 1) * PER + k + 1, url: pageUrl(p), name: p.t })) } };
  const rel = (cur > 1 ? `<link rel="prev" href="${esc(qs(cur - 1))}">` : '') + (cur < pages ? `<link rel="next" href="${esc(qs(cur + 1))}">` : '');
  return shell('Garden Store · Flowers & plants from Garden City, Wales' + (cur > 1 ? ' · page ' + cur : ''), 'Peat-free plants grown in Wales from Garden City (gardencity.cymru). Prices are hers; every Buy opens her own product page. Sold and fulfilled by Garden City.', body,
    { canon, head: rel + (plain ? '' : '<meta name="robots" content="noindex,follow">') + ld(listLD) });
}

async function product(env, h) {
  const cat = await catalogue(env), p = cat.products.find(x => x.h === h);
  if (!p) return null;
  const vrows = p.v.length > 1 ? `<table class="gs-vt"><tbody>${p.v.map(v => `<tr><td>${esc(v[0])}</td><td>${gbp(v[1])}${v[2] ? '' : ' <span class="gs-out">sold out</span>'}</td><td><a href="${esc(buyUrl(p.h, v[3]))}" target="_blank" rel="noopener">Buy ↗</a></td></tr>`).join('')}</tbody></table>` : '';
  const price = p.p === p.pm ? gbp(p.p) : gbp(p.p) + ' – ' + gbp(p.pm);
  const body = `${navBar()}
<p class="gs-note"><a href="${BASE}/" style="color:var(--g)">‹ All plants</a></p>
<div class="gs-p"><div class="gs-gal">${p.i[0] ? `<img id="gs-main" src="${esc(img(p.i[0], 800))}" alt="${esc(p.t)}" width="800" height="800" referrerpolicy="no-referrer">` : ''}
${p.i.length > 1 ? `<div class="gs-th">${p.i.map(u => `<a href="${esc(img(u, 800))}" data-big="${esc(img(u, 800))}"><img src="${esc(img(u, 160))}" alt="" loading="lazy" width="72" height="72" referrerpolicy="no-referrer"></a>`).join('')}</div>` : ''}</div>
<div><span class="gs-ty">${esc(p.ty || 'Plant')}</span><h1 style="font-size:1.35rem">${esc(p.t)}</h1>
<p class="gs-pr" style="font-size:1.25rem;margin:.2em 0">${price}${p.c ? ` <s>${gbp(p.c)}</s>` : ''}</p>
${p.a ? '' : '<p class="gs-out">Sold out at Garden City right now.</p>'}
<span class="gs-sold">Sold and fulfilled by Garden City (gardencity.cymru)</span>
<a class="gs-buy big" id="gs-buy" href="${esc(buyUrl(p.h))}" target="_blank" rel="noopener" data-buy="${esc(p.h)}">Add to cart on Garden City ↗</a>
<p class="gs-note">Opens Garden City's own page for this plant in a new tab. She takes the order, the payment and the delivery; we never take payment.</p>
${vrows}
${p.d ? `<p style="margin-top:12px">${esc(p.d)}</p>` : ''}</div></div>
${footer(await gbEntries(env))}
<script>(function(){var m=document.getElementById('gs-main');[].forEach.call(document.querySelectorAll('.gs-th a'),function(a){a.addEventListener('click',function(e){e.preventDefault();if(m)m.src=a.dataset.big})})})();</script>
${WEBMCP}`;
  const og = `<meta property="og:type" content="product"><meta property="og:title" content="${esc(p.t)}"><meta property="og:url" content="${esc(pageUrl(p))}">${p.i[0] ? `<meta property="og:image" content="${esc(img(p.i[0], 1200))}">` : ''}<meta property="product:price:amount" content="${money(p.p)}"><meta property="product:price:currency" content="GBP">`;
  return shell(p.t + ' · Garden Store', (p.d || p.t).slice(0, 160), body, { canon: BASE + '/p/' + encodeURIComponent(p.h) + '/', head: og + productLD(p).map(ld).join('') });
}

function api(p) {
  return { handle: p.h, title: p.t, type: p.ty, tags: p.tg, price_gbp: p.p, price_max_gbp: p.pm, compare_at_gbp: p.c || null, in_stock: p.a,
    images: p.i, variants: p.v.map(v => ({ title: v[0], price_gbp: v[1], in_stock: v[2], variant_id: v[3], buy_url: buyUrl(p.h, v[3]) })),
    description: p.d, page: 'https://bucklerfamily.estate' + BASE + '/p/' + p.h + '/', buy_url: buyUrl(p.h), seller: 'Garden City (gardencity.cymru)',
    order_url: buyUrl(p.h), supplier_url: SHOP + '/products/' + encodeURIComponent(p.h), supplier: SUPPLIER.name, currency: 'GBP', rrp_gbp: p.p,
    brand: 'Garden City', category: isPlant(p) ? 'plant' : 'home-and-gift', updated: p.u || null,
    dropship: { fulfilled_by: SUPPLIER.name, ships_from: 'GB', dispatch: SUPPLIER.dispatch, delivery: SUPPLIER.delivery, shipping_gbp: SUPPLIER.shipping_gbp, free_shipping_over_gbp: SUPPLIER.free_shipping_over_gbp, returns: SUPPLIER.returns }, payment_taken_here: false };
}

// ---- 0.4.0 machine-facing outputs (no human page text)
const RESELLER_RULES = ['Every order is placed and paid on the supplier product page (order_url). This store and its tools never take payment, hold card details or accept orders.',
  'Prices are the supplier retail prices in GBP (rrp_gbp); check price and stock on order_url before quoting a customer.',
  'Images are served from the supplier own CDN; link to them, do not re-host them.',
  'Keep the referral tags on order_url so the referral is attributed; commission terms are not published and are a matter for the supplier.',
  'Say "Sold and fulfilled by Garden City (gardencity.cymru)" wherever you list these products.'];
const REFERRAL = { params: UTM, example: SHOP + '/products/<handle>?' + UTM, commission: 'not published; arrange with the supplier' };
function filterProducts(ps, q, ty, stock) {
  q = (q || '').toLowerCase().trim(); ty = (ty || '').toLowerCase().trim();
  return ps.filter(x => (!q || (x.t + ' ' + x.ty + ' ' + x.tg.join(' ') + ' ' + x.d).toLowerCase().includes(q)) && (!ty || x.ty.toLowerCase().includes(ty)) && (!stock || x.a));
}
function productsJson(c, u) {
  const sp = u.searchParams, all = filterProducts(c.products, sp.get('q'), sp.get('type'), sp.get('in_stock') === '1' || sp.get('stock') === '1');
  const per = Math.min(250, Math.max(1, parseInt(sp.get('per_page') || '100', 10) || 100)), pages = Math.max(1, Math.ceil(all.length / per));
  const page = Math.min(pages, Math.max(1, parseInt(sp.get('page') || '1', 10) || 1));
  return { schema: 'garden-store-dropship/1', store: 'Garden Store', url: SITE + BASE + '/', version: VERSION, generated: new Date().toISOString(), catalogue_read: c.fetched,
    supplier: SUPPLIER, ordering: { how: 'Send the customer to order_url (or the variant buy_url); the supplier takes the order, the payment and the delivery.', payment_taken_here: false },
    referral: REFERRAL, reseller_rules: RESELLER_RULES, licence: 'Product data mirrors the supplier public catalogue; link back to order_url.',
    count: all.length, page, per_page: per, pages, next: page < pages ? SITE + BASE + '/products.json?page=' + (page + 1) + '&per_page=' + per : null,
    products: all.slice((page - 1) * per, page * per).map(api) };
}
function sitemapXml(c) {
  const ps = c.products.filter(isPlant).concat(c.products.filter(p => !isPlant(p))), pages = Math.max(1, Math.ceil(ps.length / PER));
  const newest = ps.map(p => p.u || '').sort().pop() || '';
  const u = [`<url><loc>${SITE}${BASE}/</loc>${newest ? `<lastmod>${newest}</lastmod>` : ''}</url>`];
  for (let n = 2; n <= pages; n++) u.push(`<url><loc>${SITE}${BASE}/?page=${n}</loc></url>`);
  for (const p of ps) u.push(`<url><loc>${xesc(pageUrl(p))}</loc>${p.u ? `<lastmod>${p.u}</lastmod>` : ''}${p.i.map(x => `<image:image><image:loc>${xesc(x)}</image:loc></image:image>`).join('')}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${u.join('\n')}\n</urlset>\n`;
}
function feedRows(c) {
  const rows = [];
  for (const p of c.products) {
    const vs = p.v.length ? p.v : [['', p.p, p.a, p.h]], many = vs.length > 1, link = pageUrl(p), desc = p.d || p.t, gpc = isPlant(p) ? '985' : '', more = p.i.slice(1, 11);
    for (const v of vs) {
      const vn = vname(v), reg = p.c && parseFloat(p.c) > parseFloat(v[1]) ? money(p.c) : '';
      rows.push({ p, id: String(v[3] || p.h), item_group_id: many ? p.h : '', title: (vn ? p.t + ' - ' + vn : p.t).slice(0, 150),
        description: desc, link, image_link: p.i[0] || '', additional_image_link: more,
        availability: v[2] ? 'in_stock' : 'out_of_stock', price: (reg || money(v[1])) + ' GBP', sale_price: reg ? money(v[1]) + ' GBP' : '',
        brand: 'Garden City', condition: 'new', identifier_exists: 'no', google_product_category: gpc, product_type: p.ty || '' });
    }
  }
  return rows;
}
const MEMO = {};
function memo(k, c, f) { const key = k + '|' + c.fetched + '|' + c.products.length; if (!MEMO[k] || MEMO[k].key !== key) MEMO[k] = { key, v: f(c) }; return MEMO[k].v; }
const cdata = s => '<![CDATA[' + String(s).split(']]>').join(']]]]><![CDATA[>') + ']]>';
function feedXml(c) {
  const t = (k, v) => v ? '<g:' + k + '>' + v + '</g:' + k + '>' : '';
  const PD = new Map(), SHIPX = '<g:shipping><g:country>GB</g:country><g:price>6.00 GBP</g:price><g:min_handling_time>0</g:min_handling_time><g:max_handling_time>2</g:max_handling_time><g:min_transit_time>1</g:min_transit_time><g:max_transit_time>6</g:max_transit_time></g:shipping>';
  const out = [];
  for (const r of feedRows(c)) {
    let pd = PD.get(r.p);
    if (!pd) { pd = '<description>' + cdata(r.description) + '</description><link>' + xesc(r.link) + '</link>' + t('image_link', xesc(r.image_link)) + r.additional_image_link.map(x => t('additional_image_link', xesc(x))).join('') + t('brand', 'Garden City') + '<g:condition>new</g:condition><g:identifier_exists>no</g:identifier_exists>' + t('google_product_category', r.google_product_category) + t('product_type', cdata(r.product_type).replace(/^<!\[CDATA\[\]\]>$/, '')) + SHIPX; PD.set(r.p, pd); }
    out.push('<item>' + t('id', r.id) + t('item_group_id', xesc(r.item_group_id)) + '<title>' + cdata(r.title) + '</title>' + pd + t('availability', r.availability) + t('price', r.price) + t('sale_price', r.sale_price) + '</item>');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Garden Store · plants from Garden City, Wales</title><link>' + SITE + BASE + '/</link><description>Product feed for Google Merchant Center (free listings). Sold and fulfilled by Garden City (gardencity.cymru).</description>\n' + out.join('\n') + '\n</channel></rss>\n';
}
function feedTsv(c) {
  const cols = ['id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability', 'price', 'sale_price', 'brand', 'condition', 'identifier_exists', 'google_product_category', 'product_type', 'shipping'];
  const cl = v => String(Array.isArray(v) ? v.join(',') : v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  return cols.join('\t') + '\n' + feedRows(c).map(r => cols.map(k => cl(k === 'shipping' ? 'GB:::6.00 GBP' : r[k])).join('\t')).join('\n') + '\n';
}

// MCP (Streamable HTTP, JSON responses only, read-only): POST ${BASE}/mcp with JSON-RPC 2.0.
const MCP_TOOLS = [
  { name: 'search_products', title: 'Search products', description: 'Search the dropship catalogue (plants and home & gift items supplied and shipped by Garden City, gardencity.cymru). Returns products with GBP prices, stock, images, order_url and dropship terms.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string' }, in_stock_only: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'list_products', title: 'List products (paged)', description: 'Page through every product with variants and supplier order links.',
    inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, per_page: { type: 'integer', minimum: 1, maximum: 100 }, in_stock_only: { type: 'boolean' } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'get_product', title: 'Get product', description: 'One product by handle with all variants, images, order_url per variant and dropship terms.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'get_dropship_terms', title: 'Dropship terms', description: 'Supplier, fulfilment, shipping, returns, referral tagging and reseller rules. This store never takes payment.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } }];
function mcpDiscovery() {
  return { schema: 'mcp-discovery/1', name: 'garden-store', title: 'Garden Store (dropship plant catalogue)', version: VERSION,
    description: 'Read-only tools for AI agents to list, search and get products supplied and shipped by Garden City (gardencity.cymru), with order links for resellers. No payment is taken by this store or its tools.',
    mcp: { endpoint: SITE + BASE + '/mcp', transport: 'streamable-http', protocolVersion: '2025-06-18', auth: 'none', methods: ['initialize', 'tools/list', 'tools/call', 'ping'] },
    webmcp: { page: SITE + BASE + '/', api: 'document.modelContext.registerTool (navigator.modelContext fallback)', tools: ['garden_store_search', 'garden_store_list_products', 'garden_store_product', 'garden_store_dropship_terms', 'garden_store_buy_link', 'garden_store_guestbook_sign'], declarative_form: 'garden_store_search_form' },
    http: { products: SITE + BASE + '/products.json', search: SITE + BASE + '/api/search?q=', product: SITE + BASE + '/api/product/<handle>', catalogue: SITE + BASE + '/catalogue.json', merchant_feed_xml: SITE + BASE + '/feed.xml', merchant_feed_tsv: SITE + BASE + '/feed.tsv', sitemap: SITE + BASE + '/sitemap.xml', llms: SITE + BASE + '/llms.txt' },
    tools: MCP_TOOLS, supplier: SUPPLIER, referral: REFERRAL, reseller_rules: RESELLER_RULES };
}
async function mcpCall(env, name, a) {
  const c = await catalogue(env); a = a || {};
  if (name === 'search_products') { const r = filterProducts(c.products, a.query, a.type, !!a.in_stock_only); return { count: r.length, products: r.slice(0, Math.min(50, a.limit || 20)).map(api) }; }
  if (name === 'list_products') { const u = new URL(SITE + BASE + '/products.json'); u.searchParams.set('page', a.page || 1); u.searchParams.set('per_page', Math.min(100, a.per_page || 50)); if (a.in_stock_only) u.searchParams.set('in_stock', '1'); const j = productsJson(c, u); return { count: j.count, page: j.page, pages: j.pages, products: j.products }; }
  if (name === 'get_product') { const x = c.products.find(y => y.h === String(a.handle || '')); if (!x) throw new Error('no such product: ' + a.handle); return api(x); }
  if (name === 'get_dropship_terms') return { supplier: SUPPLIER, ordering: { how: 'Send the customer to order_url; the supplier takes the order, payment and delivery.', payment_taken_here: false }, referral: REFERRAL, reseller_rules: RESELLER_RULES };
  throw new Error('unknown tool: ' + name);
}
async function mcpHandle(req, env) {
  const H = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id', 'cache-control': 'no-store' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...H, 'access-control-allow-methods': 'POST, GET, OPTIONS' } });
  if (req.method !== 'POST') return new Response(JSON.stringify(mcpDiscovery()), { status: 200, headers: H });
  let msg; try { msg = await req.json(); } catch (e) { return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), { status: 400, headers: H }); }
  const one = async m => {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m && m.id != null ? m.id : null, error: { code: -32600, message: 'Invalid Request' } };
    if (m.id === undefined) return null; // notification
    try {
      if (m.method === 'initialize') return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'garden-store', title: 'Garden Store', version: VERSION }, instructions: 'Read-only dropship catalogue. Orders are placed and paid on the supplier order_url; this server never takes payment.' } };
      if (m.method === 'ping') return { jsonrpc: '2.0', id: m.id, result: {} };
      if (m.method === 'tools/list') return { jsonrpc: '2.0', id: m.id, result: { tools: MCP_TOOLS } };
      if (m.method === 'tools/call') { const p = m.params || {}; try { const out = await mcpCall(env, p.name, p.arguments); return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false } }; } catch (e) { return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } }; } }
      if (m.method === 'resources/list') return { jsonrpc: '2.0', id: m.id, result: { resources: [] } };
      if (m.method === 'prompts/list') return { jsonrpc: '2.0', id: m.id, result: { prompts: [] } };
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } };
    } catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'Internal error' } }; }
  };
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? new Response(JSON.stringify(out), { headers: H }) : new Response(null, { status: 202, headers: H }); }
  const out = await one(msg); return out ? new Response(JSON.stringify(out), { headers: H }) : new Response(null, { status: 202, headers: H });
}

function llms(cat) {
  return `# Garden Store (flowers & plants) — webapp ${SLOT} of ${OF}
> Our own plant store mirroring Garden City's catalogue (gardencity.cymru, peat-free plants grown in Wales). Garden City sells, takes payment and delivers; every buy link is her own product page. This store never takes payment.

Version: ${VERSION}. Products: ${cat.products.length}. Catalogue last read: ${cat.fetched} (${cat.source}).

## Read
- ${BASE}/catalogue.json — every product (compact form)
- ${BASE}/api/search?q=<words>&type=<product type>&stock=1 — search
- ${BASE}/api/product/<handle> — one product with variants and buy_url
- ${BASE}/?page=<n> — the grid for people, 20 products per page (also &q=, &type=, &group=plant|home)
- ${BASE}/p/<handle>/ — the product page for people
- ${BASE}/products.json?page=<n>&per_page=<1-250>&q=&type=&in_stock=1 — dropship catalogue for resellers: supplier, order_url per variant, shipping, returns, referral tags
- ${BASE}/feed.xml and ${BASE}/feed.tsv — Google Merchant Center product feed (one row per variant)
- ${BASE}/sitemap.xml — every page and product

## Talk
- MCP server (Streamable HTTP, JSON, read-only, no auth): POST ${BASE}/mcp — tools search_products, list_products, get_product, get_dropship_terms; discovery ${BASE}/.well-known/mcp
- WebMCP tools on every page (document.modelContext): garden_store_search, garden_store_list_products, garden_store_product, garden_store_dropship_terms, garden_store_buy_link, garden_store_guestbook_sign; declarative search form garden_store_search_form
- POST ${BASE}/api/guestbook {"who","change","version"} — log any change you make to this webapp
- POST ${BASE}/api/refresh — re-read Garden City's catalogue now (at most every 10 minutes; it also refreshes itself every 6 hours)

## Rules
- Buy links go to ${SHOP}/products/<handle>?${UTM}. Never build a checkout, cart or payment form here.
- Dropship: Garden City ships each order direct to the customer (dispatch within 48 hours, 1-6 working days, £6 shipping, free over £50, 30-day returns). Resellers send customers to order_url; keep the referral tags.
- Prices are Garden City's; show "Sold and fulfilled by Garden City (gardencity.cymru)".
- Images are shown from Garden City's own CDN; do not copy them elsewhere.
`;
}

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=120' } });
const H = (t, s) => new Response(t, { status: s || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120', 'x-garden-store': VERSION } });

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url); let p = u.pathname;
    if (p === BASE) return new Response(null, { status: 301, headers: { location: BASE + '/' + u.search } });
    if (!p.startsWith(BASE + '/')) return new Response('not found', { status: 404 });
    p = p.slice(BASE.length);
    if (p.startsWith('/img/')) {
      const key = p.slice(5);
      if (!/^[a-z0-9-]+-(800|400)\.webp$/.test(key) || !env.IMG) return new Response('not found', { status: 404 });
      const o = await env.IMG.get('garden-store/img/' + key);
      if (!o) return new Response('not found', { status: 404 });
      return new Response(o.body, { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', etag: o.httpEtag } });
    }
    if (p === '/' || p === '/index.html') return H(await home(env, u));
    if (p === '/version.json') return J({ version: VERSION, slot: SLOT, of: OF, seller: SHOP });
    if (p === '/llms.txt') return new Response(llms(await catalogue(env)), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (p === '/catalogue.json') { const c = await catalogue(env); return J({ version: VERSION, source: SHOP, catalogue: c.source, fetched: c.fetched, last_ok: c.last_ok || null, last_error: c.last_error || null, count: c.products.length, seller: 'Garden City (gardencity.cymru)', buy_url_pattern: SHOP + '/products/<handle>?' + UTM, products: c.products }); }
    if (p === '/products.json') return J(productsJson(await catalogue(env), u));
    if (p === '/sitemap.xml') return new Response(memo('sm', await catalogue(env), sitemapXml), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
    if (p === '/feed.xml') return new Response(memo('fx', await catalogue(env), feedXml), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
    if (p === '/feed.tsv') return new Response(memo('ft', await catalogue(env), feedTsv), { headers: { 'content-type': 'text/tab-separated-values; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
    if (p === '/.well-known/mcp' || p === '/.well-known/mcp.json' || p === '/.well-known/webmcp.json') return J(mcpDiscovery());
    if (p === '/mcp' || p === '/mcp/') return mcpHandle(req, env);
    if (p === '/api/search' || p === '/api/') {
      const c = await catalogue(env), q = (u.searchParams.get('q') || '').toLowerCase().trim(), ty = (u.searchParams.get('type') || '').toLowerCase().trim(), st = u.searchParams.get('stock') === '1';
      const r = c.products.filter(x => (!q || (x.t + ' ' + x.ty + ' ' + x.tg.join(' ') + ' ' + x.d).toLowerCase().includes(q)) && (!ty || x.ty.toLowerCase().includes(ty)) && (!st || x.a));
      return J({ query: q, count: r.length, products: r.slice(0, 50).map(api) });
    }
    let m = p.match(/^\/api\/product\/([^\/]+)\/?$/);
    if (m) { const c = await catalogue(env), x = c.products.find(y => y.h === decodeURIComponent(m[1])); return x ? J(api(x)) : J({ error: 'no such product' }, 404); }
    if (p === '/api/refresh' && req.method === 'POST') { CAT = null; const r = await env.GARDEN.get(env.GARDEN.idFromName('garden-store')).fetch('https://do/refresh'); return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } }); }
    if (p === '/api/guestbook') {
      const stub = env.GARDEN.get(env.GARDEN.idFromName('garden-store'));
      if (req.method === 'POST') { const r = await stub.fetch('https://do/gb', { method: 'POST', body: await req.text() }); return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } }); }
      return J({ entries: (await gbEntries(env)), static: META.guestbook });
    }
    m = p.match(/^\/p\/([^\/]+)\/?$/);
    if (m) {
      if (!p.endsWith('/')) return new Response(null, { status: 301, headers: { location: BASE + p + '/' } });
      const t = await product(env, decodeURIComponent(m[1]));
      if (t) return H(t);
    }
    return H(shell('Not found · Garden Store', 'Not found', `${navBar()}<h1>Not found</h1><p><a href="${BASE}/">All plants</a></p>`), 404);
  }
};
