// صفحة المشتري: بحث عن منتج (اسم، باركود، صورة) ومقارنة سعره بين المحلات ← السلة (من أكثر من محل) ← تأكيد طلب كل محل ← متابعة الطلب.
// وتحتها قائمة المحلات القريبة لمن يبي يتصفح محل بعينه.
// الدفع للمحل مباشرة (عند الاستلام، شبكة، تحويل، تابي/تمارا في المحل)؛ المنصة ما تمسك فلوس.
import { sb, $, $$, toast, digits, valid, friendlyError, setBusy, shrinkImage, fileExt } from './lib.js';
import { IS_DEMO } from './config.js';
import { invoiceLink } from './invoice-ui.js';
import { pickLocation } from './mappick.js';
import { scanBarcode } from './scan.js';
import { showInstall, showPushCard } from './pwa.js';

const VIEWS = ['v-loading', 'v-closed', 'v-stores', 'v-store', 'v-basket', 'v-cart', 'v-login', 'v-orders'];
const show = id => { VIEWS.forEach(v => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); };
const sar = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ر.س';
const mk = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const imgUrl = p => p ? sb.storage.from('product-images').getPublicUrl(p).data.publicUrl : null;
const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180; const d = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(d)); };

const STATUS = {
  placed: ['وصل المحل، بانتظار القبول', 1], accepted: ['المحل قبل طلبك', 2], preparing: ['جاري التجهيز', 3], ready: ['جاهز', 4],
  out: ['مع المندوب في الطريق 🛵', 5], delivered: ['تم التسليم ✓', 6], picked_up: ['تم الاستلام ✓', 6], rejected: ['اعتذر المحل', 0], cancelled: ['ملغي', 0],
  to_collect: ['المندوب بيجيك يستلم', 2], collecting: ['المندوب في الطريق لك يستلم 🛵', 2], at_store: ['وصلت أغراضك المحل', 3], processing: ['قيد التنفيذ 🧺', 3],
};
const when = d => new Date(d).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
const PAY = { cash: 'نقدًا عند الاستلام', card: 'شبكة (مدى/بطاقة) عند الاستلام', transfer: 'تحويل بنكي للمحل', tabby: 'تابي في المحل', tamara: 'تمارا في المحل' };

let user = null, buyer = null, here = null, stores = [], cur = null, settings = null, products = [];
let after = null;    // وين يرجع بعد الدخول
let coords = null;
// عنوان التوصيل المحفوظ: من حساب المشتري لو داخل، وإلا من الجهاز
const ADDR_KEY = 'tah-addr';
function savedAddr() {
  if (buyer?.address && buyer.lat != null) return { address: buyer.address, lat: buyer.lat, lng: buyer.lng };
  try { const a = JSON.parse(localStorage.getItem(ADDR_KEY)); if (a?.address && a.lat != null) return a; } catch {}
  return null;
}
function applySavedAddr() {
  const a = savedAddr();
  if (!a) return;
  if (!fo.address.value.trim()) fo.address.value = a.address;
  if (!coords) { coords = { lat: a.lat, lng: a.lng }; $('#c-loc').textContent = '✓ موقعك محفوظ من طلبك السابق'; }
}
async function rememberAddr(address, c) {
  const a = { address, lat: c.lat, lng: c.lng };
  try { localStorage.setItem(ADDR_KEY, JSON.stringify(a)); } catch {}
  if (buyer && (buyer.address !== address || buyer.lat !== c.lat || buyer.lng !== c.lng)) {
    const { error } = await sb.from('buyers').update(a).eq('id', buyer.id);
    if (!error) Object.assign(buyer, a);
  }
}

// ---------------- السلة: لكل محل سلته (المشتري يجمع من أكثر من محل، وكل محل طلبه لحاله) ----------------
const CART_KEY = 'tah-cart';
const cart = {
  all() {
    let a = null; try { a = JSON.parse(localStorage.getItem(CART_KEY)); } catch {}
    if (a?.stores) return a;
    const n = { stores: {} };
    if (a?.mid && a.items && Object.keys(a.items).length) n.stores[a.mid] = { store: a.store, items: a.items };   // الصيغة القديمة (محل واحد)
    return n;
  },
  write(a) { try { localStorage.setItem(CART_KEY, JSON.stringify(a)); } catch {} },
  get(mid = cur?.id) { const b = mid ? cart.all().stores[mid] : null; return { mid: mid || null, store: b?.store, items: b?.items || {} }; },
  save(c) { if (!c.mid) return; const a = cart.all(); if (Object.keys(c.items).length) a.stores[c.mid] = { store: c.store, items: c.items }; else delete a.stores[c.mid]; cart.write(a); },
  clear(mid) { const a = cart.all(); delete a.stores[mid]; cart.write(a); },
  count(c = cart.get()) { return Object.values(c.items).reduce((s, x) => s + x.qty, 0); },
  sum(c = cart.get()) { return Object.values(c.items).reduce((s, x) => s + x.qty * x.price, 0); },
  buckets() { return Object.entries(cart.all().stores).map(([mid, b]) => ({ mid, store: b.store, items: b.items })); },
};
function setQty(p, qty, pack = false) {
  const c = cart.get();
  c.mid = cur.id; c.store = cur.store_name;
  pack = !!(pack || p.pack_only);
  const key = pack ? p.id + ':p' : p.id, cap = settings?.service_roundtrip || p.always_available ? 999 : pack ? Math.floor((p.quantity ?? 0) / p.pack_size) : (p.quantity ?? 999);
  if (qty <= 0) delete c.items[key];
  else c.items[key] = { pid: p.id, pack, qty: Math.min(qty, cap), name: pack ? `${p.name} (${packLabel(p)})` : p.name, price: pack ? Number(p.pack_price) : unitPrice(p) };
  cart.save(c); renderCartBar();
}
const unitPrice = p => p.sale_price != null && (!p.offer_ends_at || new Date(p.offer_ends_at) > new Date()) ? Number(p.sale_price) : Number(p.price);

// ---------------- البداية ----------------
sb.auth.onAuthStateChange((ev, session) => {
  user = session?.user ?? null;
  $('#who').textContent = user ? (user.phone ? '+' + user.phone : user.email || '') : '';
  $('#logout').hidden = $('#to-orders').hidden = !user;
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); buyer = null; show('v-stores'); });
$('#to-orders').addEventListener('click', e => { e.preventDefault(); openOrders(); });
$$('[data-back]').forEach(b => b.addEventListener('click', () => { if (b.dataset.back === 'v-store' && cur) openStore(cur); else showStores(); }));

(async () => {
  // قبل الإطلاق: الصفحة مقفلة إلا للمختبرين (buyer_access)
  const { data: open } = await sb.rpc('buyer_access');
  if (!open) return show('v-closed');
  // لو المشتري داخل من قبل: نجيب ملفه (فيه عنوانه المحفوظ)
  { const { data: ses } = await sb.auth.getSession(); if (ses?.session?.user) { user = ses.session.user; const { data: b } = await sb.from('buyers').select('*').eq('id', user.id).maybeSingle(); buyer = b; } }
  const { data } = await sb.from('stores_public').select('*');
  stores = data || [];
  // موقع المشتري للترتيب: نستخدم آخر موقع محفوظ مباشرة، ونحدّثه بهدوء لو المتصفح سامح من قبل (بدون ما نسأله كل مرة)
  try { const h = JSON.parse(localStorage.getItem('tah-here')); if (h?.lat) here = h; } catch {}
  const locate = () => navigator.geolocation?.getCurrentPosition(p => {
    here = { lat: p.coords.latitude, lng: p.coords.longitude };
    try { localStorage.setItem('tah-here', JSON.stringify(here)); } catch {}
    if (!$('#v-stores').hidden) renderStores();
  }, () => {}, { timeout: 8000, maximumAge: 5 * 60e3 });
  let perm = null; try { perm = (await navigator.permissions?.query({ name: 'geolocation' }))?.state; } catch {}
  if (!here || perm === 'granted') locate();
  if (location.hash === '#orders') return openOrders();
  // من زر «إيقاف تنبيهات العروض» في التنبيه
  if (location.hash === '#stop-offers') {
    history.replaceState(null, '', location.pathname + location.search);
    const stop = async () => { await sb.rpc('set_offer_alerts', { on_: false }); if (buyer) buyer.offer_alerts = false; toast('وقفنا تنبيهات العروض. تقدر ترجّعها من «طلباتي».', 5000); openOrders(); };
    if (await ensureBuyer(stop)) return stop();
    return;
  }
  showStores();
})();

// ---------------- المحلات ----------------
function showStores() { renderStores(); show('v-stores'); showInstall($('#v-stores'), 'ثبّت تحصّله على جوالك، وتسوّق من محلات حيّك من أيقونته.'); }
// ---------------- البحث عن منتج ومقارنة سعره بين المحلات ----------------
let results = null, resLabel = '', sortBy = 'price', searchTimer = null, searchSeq = 0;
const sState = t => { const el = $('#s-state'); el.hidden = !t; el.textContent = t || ''; };
const normName = t => String(t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
async function runSearch({ q = null, bc = null, label = null } = {}) {
  const seq = ++searchSeq;
  sState('جارِ البحث…');
  const { data, error } = await sb.rpc('product_search', { q, bc, la: here?.lat ?? null, ln: here?.lng ?? null });
  if (seq !== searchSeq) return null;
  sState('');
  if (error) { toast(friendlyError(error)); return null; }
  results = data || []; resLabel = label || (bc ? `باركود ${bc}` : q);
  renderStores();
  return results;
}
$('#sq').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#sq').value.trim();
  if (q.length < 2) { searchSeq++; results = null; sState(''); return renderStores(); }
  searchTimer = setTimeout(() => runSearch({ q }), 450);
});
$('#res-clear').addEventListener('click', () => { $('#sq').value = ''; searchSeq++; results = null; sState(''); renderStores(); });
$$('.seg [data-sort]').forEach(b => b.addEventListener('click', () => {
  sortBy = b.dataset.sort; $$('.seg [data-sort]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderResults();
}));
// بالباركود
$('#s-scan').addEventListener('click', async () => {
  const code = await scanBarcode();
  if (!code) return;
  $('#sq').value = '';
  const r = await runSearch({ bc: code });
  if (r && !r.length) sState(`ما لقينا منتج بهذا الباركود (${code}) في المحلات القريبة. جرّب تكتب اسمه.`);
});
// بالصورة (تصوير أو رفع): الذكاء الاصطناعي يتعرّف على المنتج، وبعدها نبحث باسمه
async function toJpegBase64(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}
async function searchByPhoto(file) {
  if (!file) return;
  if (!(await ensureBuyer(() => showStores()))) return toast('سجّل دخولك أول عشان تبحث بالصورة، وبعدها صوّر المنتج.', 4500);
  sState('🤖 جارِ التعرّف على المنتج من الصورة…');
  try {
    const image = await toJpegBase64(file);
    const res = await Promise.race([sb.functions.invoke('recognize', { body: { mode: 'buyer', image, media_type: 'image/jpeg' } }), new Promise(r => setTimeout(() => r(null), 25000))]);
    if (!res) return sState('التعرّف على الصورة تأخر. اكتب اسم المنتج أو امسح الباركود.');
    let { data, error } = res;
    if (error) { try { data = await error.context.json(); } catch { throw error; } }
    if (data?.error === 'not_configured') return sState('البحث بالصورة يتفعّل قريبًا. الحين اكتب اسم المنتج أو امسح الباركود.');
    if (data?.error === 'limit') return sState('وصلت الحد اليومي للبحث بالصورة. اكتب اسم المنتج أو امسح الباركود.');
    if (data?.error) return sState('ما قدرنا نقرأ الصورة الحين. اكتب اسم المنتج أو امسح الباركود.');
    const r = data?.result;
    if (!r?.recognized) return sState('ما قدرنا نتعرّف على المنتج من الصورة. جرّب صورة أوضح، أو اكتب اسمه.');
    // نجرب: الباركود لو ظهر، ثم الاسم كامل، ثم كلمات البحث المختصرة
    const tries = [];
    if (/^\d{8,14}$/.test(String(r.barcode || ''))) tries.push({ bc: String(r.barcode), label: r.name });
    for (const t of [r.name, r.search, String(r.name || '').split(' ').slice(0, 2).join(' '), String(r.search || r.name || '').split(' ')[0]])
      if (t && t.trim().length >= 2 && !tries.some(x => x.q === t.trim())) tries.push({ q: t.trim(), label: r.name });
    for (const t of tries) {
      const out = await runSearch(t);
      if (out?.length) { $('#sq').value = t.q || ''; return sState(`✓ تعرّفنا عليه: ${r.name}`); }
    }
    $('#sq').value = r.search || r.name || '';
    sState(`تعرّفنا عليه: ${r.name}، بس ما لقيناه في المحلات القريبة.`);
  } catch (ex) { sState('ما قدرنا نقرأ الصورة الحين: ' + friendlyError(ex)); }
}
for (const id of ['#s-cam', '#s-img']) $(id).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; searchByPhoto(f); });

// نجمع نفس المنتج من أكثر من محل: بالباركود أولًا، ثم بنفس الاسم
function groupResults(rows) {
  const groups = new Map(), byName = new Map();
  for (const r of rows.filter(r => r.barcode)) {
    const k = 'b:' + r.barcode;
    if (!groups.has(k)) groups.set(k, { key: k, rows: [] });
    groups.get(k).rows.push(r);
    if (!byName.has(normName(r.name))) byName.set(normName(r.name), k);
  }
  for (const r of rows.filter(r => !r.barcode)) {
    const k = byName.get(normName(r.name)) || 'n:' + normName(r.name);
    if (!groups.has(k)) { groups.set(k, { key: k, rows: [] }); byName.set(normName(r.name), k); }
    groups.get(k).rows.push(r);
  }
  return [...groups.values()];
}
const offerPrice = r => r.pack_only && r.pack_price ? Number(r.pack_price) : r.on_offer ? Number(r.sale_price) : Number(r.price);
const offerUnit = r => r.pack_only && r.pack_size ? `${r.pack_name || 'كرتون'} ${r.pack_size} ${r.unit || 'حبة'}` : (r.unit || 'حبة');
const dist = d => d == null ? '' : d < 1 ? `${Math.round(d * 1000)} م` : `${d.toFixed(1)} كم`;
function searchSetQty(r, qty) {
  const pack = !!(r.pack_only && r.pack_size);
  const c = cart.get(r.merchant_id); c.mid = r.merchant_id; c.store = r.store_name;
  const key = pack ? r.id + ':p' : r.id;
  const cap = r.always_available || !(r.quantity > 0) ? 999 : pack ? Math.floor(r.quantity / r.pack_size) : r.quantity;
  if (qty <= 0) delete c.items[key];
  else c.items[key] = { pid: r.id, pack, qty: Math.min(qty, cap), name: pack ? `${r.name} (${offerUnit(r)})` : r.name, price: offerPrice(r) };
  cart.save(c); renderResults(); renderGcart();
}
function renderResults() {
  if (!results) return;
  const groups = groupResults(results);
  for (const g of groups) {
    g.rows.sort((a, b) => (b.in_stock - a.in_stock) || (sortBy === 'near' ? ((a.km ?? 1e9) - (b.km ?? 1e9)) || (offerPrice(a) - offerPrice(b)) : (offerPrice(a) - offerPrice(b)) || ((a.km ?? 1e9) - (b.km ?? 1e9))));
    g.min = Math.min(...g.rows.filter(r => r.in_stock).map(offerPrice), Infinity);
    g.near = Math.min(...g.rows.map(r => r.km ?? 1e9));
  }
  groups.sort((a, b) => (b.rows.length - a.rows.length) || (sortBy === 'near' ? a.near - b.near : a.min - b.min));
  const nStores = new Set(results.map(r => r.merchant_id)).size;
  $('#res-title').textContent = groups.length ? `«${resLabel}»: ${groups.length === 1 ? 'منتج واحد' : groups.length + ' منتجات'} في ${nStores === 1 ? 'محل واحد' : nStores + ' محلات'}` : `ما لقينا «${resLabel}» في المحلات القريبة`;
  const box = $('#results');
  if (!groups.length) { box.replaceChildren(mk('div', 'empty', 'جرّب كلمة ثانية أو أقصر، أو امسح باركود المنتج.')); return; }
  box.replaceChildren(...groups.map(g => {
    const first = g.rows.find(r => r.image_path) || g.rows[0];
    const el = mk('article', 'card pgroup');
    const head = mk('div', 'head');
    const imgs = [first.image_path, ...(first.extra_images || [])].filter(Boolean);
    if (imgs.length) {
      const b = mk('button', 'pic'); b.type = 'button'; b.setAttribute('aria-label', `صور ${first.name}`);
      const i = mk('img'); i.src = imgUrl(imgs[0]); i.alt = ''; i.loading = 'lazy'; b.append(i);
      if (imgs.length > 1) b.append(mk('span', 'cnt num', `${imgs.length} صور`));
      b.onclick = () => viewImages(first.name, imgs);
      head.append(b);
    } else head.append(mk('div', 'ph', first.name.trim()[0] || '؟'));
    const t = mk('div'); t.style.minWidth = '0';
    const inStock = g.rows.filter(r => r.in_stock);
    t.append(mk('b', '', first.name), mk('div', 'hint num', [first.category, new Set(g.rows.map(r => r.merchant_id)).size > 1 ? `في ${new Set(g.rows.map(r => r.merchant_id)).size} محلات` : null,
      inStock.length ? (inStock.length > 1 && g.min !== Math.max(...inStock.map(offerPrice)) ? `من ${sar(g.min)} إلى ${sar(Math.max(...inStock.map(offerPrice)))}` : sar(g.min)) : 'نفد من الكل'].filter(Boolean).join(' · ')));
    head.append(t); el.append(head);
    g.rows.forEach((r, idx) => {
      const row = mk('div', 'offer' + (r.in_stock ? '' : ' off'));
      const st = mk('button', 'st'); st.type = 'button';
      if (r.logo_path) { const lg = mk('img'); lg.src = imgUrl(r.logo_path); lg.alt = ''; lg.loading = 'lazy'; st.append(lg); }
      const sn = mk('div'); sn.style.minWidth = '0';
      sn.append(mk('b', '', r.store_name + (r.premium ? ' ⭐' : '')), mk('div', 'hint num', [dist(r.km), normName(r.name) !== normName(first.name) ? r.name : null].filter(Boolean).join(' · ')));
      st.append(sn);
      st.onclick = () => { const s = stores.find(x => x.id === r.merchant_id); if (s) openStore(s); };
      const pr = mk('div', 'pr num');
      pr.append(mk('b', '', sar(offerPrice(r))));
      if (r.on_offer && !(r.pack_only && r.pack_price)) pr.append(mk('s', 'hint', sar(r.price)));
      pr.append(mk('span', 'hint', '/ ' + offerUnit(r)));
      if (r.in_stock && inStock.length > 1 && offerPrice(r) === g.min && g.min !== Math.max(...inStock.map(offerPrice)) && inStock.indexOf(r) === inStock.findIndex(x => offerPrice(x) === g.min)) pr.append(mk('span', 'best', 'الأرخص'));
      const key = r.pack_only && r.pack_size ? r.id + ':p' : r.id;
      const inCart = cart.get(r.merchant_id).items[key]?.qty || 0;
      const box2 = mk('div', 'qty');
      if (!r.in_stock) box2.append(mk('span', 'low', 'نفد'));
      else if (inCart) {
        const minus = mk('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'نقّص'); minus.onclick = () => searchSetQty(r, inCart - 1);
        const plus = mk('button', '', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'زوّد'); plus.onclick = () => searchSetQty(r, inCart + 1);
        box2.append(plus, mk('b', 'num', String(inCart)), minus);
      } else { const add = mk('button', 'btn primary sm', 'أضف للسلة'); add.type = 'button'; add.onclick = () => searchSetQty(r, 1); box2.append(add); }
      row.append(st, pr, box2); el.append(row);
    });
    return el;
  }));
}
// شريط السلة العام (كل المحلات) وصفحة السلة
function renderGcart() {
  const b = cart.buckets(), n = b.reduce((s, x) => s + cart.count(x), 0), sum = b.reduce((s, x) => s + cart.sum(x), 0);
  $('#gcart').hidden = !n;
  $('#gcart-sum').textContent = `🛒 ${n} منتج${b.length > 1 ? ` من ${b.length} محلات` : ''} · ${sar(sum)}`;
}
async function checkoutStore(mid) {
  const s = stores.find(x => x.id === mid);
  if (!s) { toast('هذا المحل مو متاح الحين.'); return; }
  await openStore(s); openCart();
}
function openBasket() {
  const b = cart.buckets().filter(x => cart.count(x));
  if (!b.length) { toast('السلة فاضية.'); return showStores(); }
  $('#basket').replaceChildren(...b.map(x => {
    const el = mk('div', 'card'); el.style.cssText = 'display:grid;gap:8px';
    el.append(mk('b', '', '🏪 ' + (x.store || 'محل')));
    Object.values(x.items).forEach(i => { const r = mk('div', 'hint num'); r.style.cssText = 'display:flex;justify-content:space-between;gap:8px'; r.append(mk('span', '', `${i.name} × ${i.qty}`), mk('span', '', sar(i.price * i.qty))); el.append(r); });
    const tot = mk('div', 'num'); tot.style.cssText = 'display:flex;justify-content:space-between;font-weight:700;border-top:1px dashed var(--line);padding-top:8px';
    tot.append(mk('span', '', 'المنتجات'), mk('span', '', sar(cart.sum(x))));
    const acts = mk('div'); acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const go = mk('button', 'btn primary', 'أكمل الطلب من هذا المحل ←'); go.type = 'button'; go.style.flex = '1'; go.onclick = () => checkoutStore(x.mid);
    const rm = mk('button', 'btn ghost sm', 'حذف'); rm.type = 'button'; rm.onclick = () => { if (confirm(`تحذف منتجات «${x.store || 'المحل'}» من السلة؟`)) { cart.clear(x.mid); openBasket(); } };
    acts.append(go, rm); el.append(tot, acts); return el;
  }));
  show('v-basket');
}
$('#go-basket').addEventListener('click', () => { const b = cart.buckets().filter(x => cart.count(x)); if (b.length === 1) checkoutStore(b[0].mid); else openBasket(); });

const PREMIUM_KM = 3;
function renderStores() {
  const searching = !!results;
  $('#res-wrap').hidden = !searching; $('#stores-wrap').hidden = searching;
  renderGcart();
  if (searching) return renderResults();
  const withD = s => ({ s, d: here && s.lat != null ? km(here, s) : null });
  const boost = x => x.s.premium && (x.d == null || x.d <= PREMIUM_KM);
  const list = stores.map(withD).sort((a, b) => (boost(b) - boost(a)) || ((a.d ?? 1e9) - (b.d ?? 1e9)));
  $('#loc-note').textContent = !list.length ? 'ما فيه محلات مفعّلة قريبة منك للحين.' : here ? 'مرتبة من الأقرب لك.' : 'اسمح بالموقع عشان نرتبها من الأقرب.';
  $('#stores').replaceChildren(...list.map(({ s, d }) => {
    const b = mk('button', 'card store-card'); b.type = 'button';
    const name = mk('b', '', s.store_name);
    if (s.premium) { const pb = mk('span', 'badge pending', '⭐ مميز'); pb.style.marginInlineStart = '6px'; name.append(pb); }
    const t = mk('div'); t.append(name, mk('div', 'hint', [s.activity, s.district].filter(Boolean).join(' · ')));
    b.append(withLogo(s.logo_path, t, 44), mk('span', 'badge approved num', d == null ? '' : d < 1 ? `${Math.round(d * 1000)} م` : `${d.toFixed(1)} كم`));
    b.onclick = () => openStore(s);
    return b;
  }));
  if (!list.length) $('#stores').append(mk('p', 'hint', 'ما لقينا محلات.'));
}

// ---------------- المحل ----------------
async function openStore(s) {
  cur = s; show('v-loading');
  const [p, ss] = await Promise.all([
    sb.from('products').select('*').eq('merchant_id', s.id).eq('is_active', true).order('name').limit(1000),
    sb.from('store_settings').select('*').eq('merchant_id', s.id).maybeSingle(),
  ]);
  products = p.data || []; settings = ss.data || { pickup: true, pay_cash: true };
  $('#st-name').replaceChildren(withLogo(s.logo_path, mk('span', '', s.store_name + (s.premium ? ' ⭐' : '')), 52));
  const info = [s.activity, settings.pickup !== false && 'استلام من المحل', settings.delivers && `توصيل ${Number(settings.delivery_fee) ? sar(settings.delivery_fee) : 'مجاني'}`,
    settings.service_roundtrip && `🧺 استلام وتسليم من بيتك ${Number(settings.roundtrip_fee) ? sar(settings.roundtrip_fee) : 'مجاني'}`,
    settings.min_order && `أقل طلب ${sar(settings.min_order)}`].filter(Boolean);
  $('#st-info').textContent = info.join(' · ');
  $('#pq').value = '';
  renderProducts(); renderCartBar(); show('v-store');
}
let missTimer = null;
$('#pq').addEventListener('input', () => {
  renderProducts();
  // بحث داخل المحل ما لقى شي: نسجّله للمحل (بدون هوية المشتري) عشان يعرف وش يدوّرون عليه
  clearTimeout(missTimer);
  const q = $('#pq').value.trim();
  if (q.length >= 2 && cur && !products.some(p => p.name.includes(q) || (p.category || '').includes(q)))
    missTimer = setTimeout(() => sb.rpc('log_store_miss', { mid: cur.id, q }).then(() => {}), 1500);
});
// المنتج بالحبة، وبالكرتون لو التاجر حدده (أو بالكرتون فقط للجملة)
const hasPack = p => p.pack_size && p.pack_price;
const packLabel = p => `${p.pack_name || 'كرتون'} ${p.pack_size} ${p.unit || 'حبة'}`;
function renderProducts() {
  const q = $('#pq').value.trim(), c = cart.get();
  const list = products.filter(p => !q || p.name.includes(q) || (p.category || '').includes(q));
  const rows = list.flatMap(p => hasPack(p) ? (p.pack_only ? [[p, true]] : [[p, false], [p, true]]) : (p.pack_only ? [] : [[p, false]]));
  $('#products').replaceChildren(...rows.map(([p, pack]) => {
    const svc = !!settings.service_roundtrip;
    const out = !svc && !p.always_available && (pack ? p.quantity < p.pack_size : p.quantity === 0);
    const el = mk('div', 'prod' + (out ? ' off' : ''));
    const src = imgUrl(p.image_path);
    if (pack && !p.pack_only) el.append(mk('div', 'ph', '📦'));
    else if (src) {
      // الضغط على الصورة يكبّرها ويعرض باقي صور المنتج
      const all = [p.image_path, ...(p.extra_images || [])];
      const b = mk('button', 'pic'); b.type = 'button'; b.setAttribute('aria-label', `صور ${p.name}`);
      const i = mk('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; b.append(i);
      if (all.length > 1) b.append(mk('span', 'cnt num', `${all.length} صور`));
      b.onclick = () => viewImages(p.name, all);
      el.append(b);
    } else el.append(mk('div', 'ph', p.name.slice(0, 1)));
    const t = mk('div'); t.style.minWidth = '0';
    const m = mk('div', 'm');
    if (pack) m.append(mk('b', 'num', sar(p.pack_price)), mk('span', 'hint', '/ ' + packLabel(p)));
    else {
      const up = unitPrice(p);
      m.append(mk('b', 'num', sar(up)), mk('span', 'hint', '/ ' + (p.unit || (svc ? 'قطعة' : 'حبة'))));
      if (up !== Number(p.price)) m.append(Object.assign(mk('s', 'num', sar(p.price))));
    }
    if (out) m.append(mk('span', 'low', 'نفد'));
    t.append(mk('div', 'n', pack && !p.pack_only ? `${p.name} · ${p.pack_name || 'كرتون'}` : p.name), m); el.append(t);
    const key = pack ? p.id + ':p' : p.id;
    const inCart = c.mid === cur.id ? c.items[key]?.qty || 0 : 0;
    const box = mk('div', 'qty');
    if (!out) {
      if (inCart) {
        const minus = mk('button', '', '−'); minus.type = 'button'; minus.onclick = () => { setQty(p, inCart - 1, pack); renderProducts(); };
        const plus = mk('button', '', '+'); plus.type = 'button'; plus.onclick = () => { setQty(p, inCart + 1, pack); renderProducts(); };
        box.append(plus, mk('b', 'num', String(inCart)), minus);
      } else {
        const add = mk('button', 'btn primary sm', 'أضف'); add.type = 'button'; add.onclick = () => { setQty(p, 1, pack); renderProducts(); };
        box.append(add);
      }
    }
    el.append(box); return el;
  }));
  if (!list.length) $('#products').append(mk('p', 'hint', 'ما فيه منتجات.'));
}
function renderCartBar() {
  const c = cart.get(), n = c.mid === cur?.id ? cart.count(c) : 0;
  $('#cartbar').hidden = !n;
  $('#cart-sum').textContent = `${n} منتج · ${sar(cart.sum(c))}`;
}
$('#go-cart').addEventListener('click', () => openCart());

// ---------------- السلة والطلب ----------------
const fo = $('#f-order');
const RECEIPT = [['none', 'ما أحتاج فاتورة', ''], ['paper', '🧾 ورقية مع الطلب', ''], ['whatsapp', '💬 على الواتساب', '(يوصل رقمك للمحل عشان يرسلها)']];
function radio(name, value, label, hint, checked) {
  const l = mk('label', 'plan'); const i = Object.assign(document.createElement('input'), { type: 'radio', name, value, checked });
  const s = mk('span'); s.append(mk('b', '', label)); if (hint) s.append(' ', hint);
  l.append(i, s); return l;
}
function openCart() {
  const c = cart.get();
  if (!cart.count(c) || c.mid !== cur?.id) return toast('السلة فاضية.');
  $('#c-store').textContent = cur.store_name;
  $('#c-items').replaceChildren(...Object.entries(c.items).map(([pid, x]) => {
    const r = mk('div'); r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center';
    const p = products.find(y => y.id === (x.pid || pid));
    const q = mk('div', 'qty');
    const minus = mk('button', '', '−'); minus.type = 'button'; minus.onclick = () => { if (p) setQty(p, x.qty - 1, x.pack); else { delete c.items[pid]; cart.save(c); } openCart(); };
    const plus = mk('button', '', '+'); plus.type = 'button'; plus.onclick = () => { if (p) { setQty(p, x.qty + 1, x.pack); openCart(); } };
    q.append(plus, mk('b', 'num', String(x.qty)), minus);
    const t = mk('div'); t.append(mk('b', '', x.name), mk('div', 'hint num', `${sar(x.price)} × ${x.qty} = ${sar(x.price * x.qty)}`));
    r.append(t, q); return r;
  }));
  const ful = [];
  if (settings.pickup !== false) ful.push(radio('ful', 'pickup', 'استلام من المحل', '', true));
  if (settings.delivers) ful.push(radio('ful', 'delivery', 'توصيل', Number(settings.delivery_fee) ? `(${sar(settings.delivery_fee)}${settings.free_delivery_over ? `، مجاني فوق ${sar(settings.free_delivery_over)}` : ''})` : '(مجاني)', !ful.length));
  if (settings.service_roundtrip) ful.unshift(radio('ful', 'roundtrip', '🧺 استلام وتسليم من بيتك', Number(settings.roundtrip_fee)
    ? `(${sar(settings.roundtrip_fee)} للمشوارين${settings.roundtrip_free_over ? `، مجاني فوق ${sar(settings.roundtrip_free_over)}` : ''})` : '(مجاني)', true));
  if (settings.service_roundtrip) ful.forEach((x, i) => { if (i) x.querySelector('input').checked = false; });
  const prevFul = fulVal();   // نحافظ على اختياره لو انعاد رسم السلة (مثل بعد تسجيل الدخول)
  $('#c-ful').replaceChildren(...ful);
  if (prevFul) { const keep = fo.querySelector(`input[name=ful][value=${prevFul}]`); if (keep) keep.checked = true; }
  const ex = $('#c-express-row'); ex.hidden = !settings.express_enabled;
  $('#c-express-lbl').textContent = `⚡ مستعجل: يرجع لك خلال ${settings.express_hours || 24} ساعة (+${sar(settings.express_fee)})`;
  if (!fo.collect_at.value) { const d = new Date(Date.now() + 2 * 36e5); d.setMinutes(0, 0, 0); fo.collect_at.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
  if (!ful.length) $('#c-ful').append(mk('p', 'err', 'المحل ما فعّل الاستلام ولا التوصيل.'));
  applySavedAddr();
  renderPay(); updateTotal();
  show('v-cart');
}
function fulVal() { return fo.querySelector('input[name=ful]:checked')?.value; }
function renderPay() {
  const f = fulVal(), opts = [];
  if (settings.pay_cash !== false) opts.push(['cash', f === 'pickup' ? 'نقدًا في المحل' : f === 'roundtrip' ? 'نقدًا للمندوب عند التسليم' : 'نقدًا للمندوب']);
  const door = f === 'delivery' || f === 'roundtrip';
  if (door ? settings.pay_card_delivery : settings.pay_card) opts.push(['card', door ? 'شبكة (مدى/بطاقة) عند المندوب' : 'شبكة (مدى/بطاقة) في المحل']);
  if (settings.pay_transfer) opts.push(['transfer', 'تحويل بنكي للمحل', 'تحوّل بعد ما يقبل المحل طلبك، وترفع الإيصال']);
  if (f === 'pickup' && settings.pay_tabby) opts.push(['tabby', 'تقسيط تابي في المحل']);
  if (f === 'pickup' && settings.pay_tamara) opts.push(['tamara', 'تقسيط تمارا في المحل']);
  $('#c-pay').replaceChildren(...opts.map(([v, l, h], i) => radio('pay', v, l, h || '', i === 0)));
  { let last = 'none'; try { last = localStorage.getItem('tah-receipt') || 'none'; } catch {}
    $('#c-receipt').replaceChildren(...RECEIPT.map(([v, l, h]) => radio('receipt', v, l, h, v === last))); }
  $('#c-addr').hidden = f === 'pickup';
  $('#c-rt').hidden = f !== 'roundtrip';
  $('#c-rt-hint').textContent = f === 'roundtrip' ? `يرجع لك خلال ${fo.express?.checked ? settings.express_hours || 24 : settings.turnaround_hours || 48} ساعة من الاستلام. لو العدد اختلف وقت الاستلام، يتعدّل المبلغ وتوافق عليه.` : '';
}
fo.addEventListener('change', e => { if (e.target.name === 'ful' || e.target.name === 'express') { renderPay(); updateTotal(); } });
function fee() {
  const sub = cart.sum(), f = fulVal();
  if (f === 'delivery') return settings.free_delivery_over && sub >= Number(settings.free_delivery_over) ? 0 : Number(settings.delivery_fee || 0);
  if (f === 'roundtrip') return (settings.roundtrip_free_over && sub >= Number(settings.roundtrip_free_over) ? 0 : Number(settings.roundtrip_fee || 0))
    + (fo.express.checked ? Number(settings.express_fee || 0) : 0);
  return 0;
}
function updateTotal() {
  const sub = cart.sum(), f = fee();
  const lbl = fulVal() === 'delivery' ? ' + التوصيل ' + sar(f) : fulVal() === 'roundtrip' ? ' + الاستلام والتسليم' + (fo.express.checked ? ' والمستعجل ' : ' ') + sar(f) : '';
  $('#c-total').textContent = `المنتجات ${sar(sub)}${lbl} = الإجمالي ${sar(sub + f)}`;
}
$('#c-locate').addEventListener('click', () => {
  $('#c-loc').textContent = 'جارِ تحديد موقعك…';
  navigator.geolocation?.getCurrentPosition(p => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; $('#c-loc').textContent = '✓ تم تحديد الموقع الجديد'; },
    () => { $('#c-loc').textContent = 'ما قدرنا نحدد موقعك. حدّده على الخريطة.'; }, { enableHighAccuracy: true, timeout: 15000 });
});
$('#c-map').addEventListener('click', async () => { const p = await pickLocation(coords || here); if (p) { coords = p; $('#c-loc').textContent = '✓ تم تحديد الموقع على الخريطة'; } });

const ERR = {
  store_unavailable: 'المحل مو متاح الحين.', delivery_unavailable: 'المحل ما يوصّل الحين.', pickup_unavailable: 'الاستلام من المحل مو متاح.',
  address_required: 'اكتب العنوان وحدّد موقعك.', collect_time_required: 'اختر وقت استلام خلال الأسبوعين الجايات.', roundtrip_unavailable: 'المحل ما يقدّم الاستلام والتسليم الحين.', payment_unavailable: 'طريقة الدفع هذي مو متاحة.', product_unavailable: 'فيه منتج ما عاد متوفر. حدّث السلة.',
  cart_empty: 'السلة فاضية.', cannot_cancel: 'المحل قبل الطلب، ما تقدر تلغيه. تواصل معه.',
};
const why = e => { const m = String(e?.message || e); for (const k in ERR) if (m.includes(k)) return ERR[k];
  if (m.includes('pack_unavailable')) return 'البيع بالكرتون لهذا المنتج تغيّر. حدّث الصفحة وأعد الإضافة.';
  if (m.includes('out_of_stock')) return 'الكمية المتوفرة من «' + m.split(':').pop().trim() + '» أقل من طلبك.';
  if (m.includes('below_min_order')) return 'أقل مبلغ للطلب ' + sar(m.split(':').pop()) + '.'; return friendlyError(e); };

fo.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fo), btn = $('#c-place'), f = fulVal(), pay = fo.querySelector('input[name=pay]:checked')?.value;
  if (!f) return (err.textContent = 'اختر طريقة الاستلام.');
  if (!pay) return (err.textContent = 'اختر طريقة الدفع.');
  if (f !== 'pickup' && (!coords || fo.address.value.trim().length < 4)) return (err.textContent = 'اكتب العنوان وحدّد موقعك.');
  if (f === 'roundtrip' && !fo.collect_at.value) return (err.textContent = 'اختر وقت الاستلام.');
  if (!(await ensureBuyer(() => openCart()))) return;
  const c = cart.get();
  setBusy(btn, true);
  const { data, error } = await sb.rpc('place_order', {
    mid: c.mid, items: Object.entries(c.items).map(([k, x]) => ({ product_id: x.pid || k, qty: x.qty, pack: !!x.pack })), fulfillment: f, payment_method: pay,
    address: f !== 'pickup' ? fo.address.value.trim() : null, lat: f !== 'pickup' ? coords.lat : null, lng: f !== 'pickup' ? coords.lng : null, note: fo.note.value.trim() || null,
    collect_at: f === 'roundtrip' ? new Date(fo.collect_at.value).toISOString() : null, express: f === 'roundtrip' && fo.express.checked,
  });
  setBusy(btn, false);
  if (error) return (err.textContent = why(error));
  err.textContent = '';
  const rc = fo.querySelector('input[name=receipt]:checked')?.value || 'none';
  try { localStorage.setItem('tah-receipt', rc); } catch {}
  if (rc !== 'none') await sb.rpc('order_set_receipt', { oid: data.id, pref: rc });
  if (f !== 'pickup') rememberAddr(fo.address.value.trim(), coords);
  cart.clear(c.mid);
  const left = cart.buckets().length;
  toast(`وصل طلبك ${data.number} للمحل ✓` + (left ? ` · باقي في سلتك منتجات من ${left === 1 ? 'محل ثاني' : left + ' محلات'}` : ''), 5500);
  if (left) openBasket(); else openOrders();
});

// ---------------- الدخول بالجوال ----------------
async function ensureBuyer(back) {
  if (!user) { after = back; openLogin(); return false; }
  if (!buyer) { const { data } = await sb.from('buyers').select('*').eq('id', user.id).maybeSingle(); buyer = data; }
  if (!buyer) { after = back; openLogin('name'); return false; }
  return true;
}
function openLogin(step = 'phone') {
  $('#f-phone').hidden = step !== 'phone'; $('#f-otp').hidden = step !== 'otp'; $('#f-name').hidden = step !== 'name';
  $('#f-demo').hidden = !(IS_DEMO && step === 'phone');
  $('#name-phone').hidden = !(step === 'name' && user && !user.phone);
  show('v-login');
}
const intl = p => '966' + digits(p).replace(/\D/g, '').replace(/^0/, '');
let phone = '';
$('#f-phone').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#ph-send'), v = digits(f.phone.value).replace(/\D/g, '');
  if (!valid.phone(v)) return (err.textContent = 'الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  setBusy(btn, true);
  phone = intl(v);
  const { error } = await sb.auth.signInWithOtp({ phone: '+' + phone });
  setBusy(btn, false);
  if (error) return (err.textContent = /provider|sms|phone/i.test(error.message) ? 'خدمة الرسائل ما تشتغل الحين. جرّب بعد شوي.' : friendlyError(error));
  $('#otp-to').textContent = `أرسلنا رمز إلى ${v}.`; openLogin('otp');
});
$('#f-otp').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#otp-ok');
  setBusy(btn, true);
  const { data, error } = await sb.auth.verifyOtp({ phone: '+' + phone, token: digits(f.code.value).trim(), type: 'sms' });
  setBusy(btn, false);
  if (error) return (err.textContent = 'الرمز غير صحيح أو انتهى. اطلب رمز جديد.');
  user = data.user; afterLogin();
});
$('#f-demo').addEventListener('submit', async e => {
  e.preventDefault();
  const { data, error } = await sb.auth.signInWithPassword({ email: 'buyer.demo@example.com', password: 'Demo@2026' });
  if (error) return toast(friendlyError(error));
  user = data.user; afterLogin();
});
async function afterLogin() {
  const { data } = await sb.from('buyers').select('*').eq('id', user.id).maybeSingle();
  buyer = data;
  if (!buyer) return openLogin('name');
  const go = after; after = null; go ? go() : openOrders();
}
$('#f-name').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, name = f.name.value.trim(), err = $('.err', f);
  if (name.length < 2) return (err.textContent = 'اكتب اسمك.');
  let ph = user.phone ? '0' + user.phone.replace(/^966/, '') : digits(f.phone.value).replace(/\D/g, '');
  if (!valid.phone(ph)) return (err.textContent = 'الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  const { data, error } = await sb.from('buyers').insert({ id: user.id, name, phone: ph }).select().single();
  if (error) return (err.textContent = friendlyError(error));
  buyer = data; const go = after; after = null; go ? go() : openOrders();
});

// ---------------- طلباتي ----------------
async function openOrders(silent = false) {
  if (!(await ensureBuyer(() => openOrders()))) return;
  if (!silent) show('v-loading');
  const { data, error } = await sb.from('orders_v').select('*').eq('buyer_id', user.id).order('created_at', { ascending: false }).limit(50);
  if (error) { toast(friendlyError(error)); return showStores(); }
  $('#orders').replaceChildren(...data.map(o => orderCard(o, o.store_name)));
  if (!data.length) $('#orders').append(mk('p', 'hint', 'ما عندك طلبات للحين.'));
  if (!silent) { show('v-orders'); showPushCard($('#v-orders'), sb, user.id, 'يوصلك تنبيه على جوالك مع كل تحديث لطلبك.'); }
  const oa = $('#offer-alerts'); oa.hidden = !buyer; if (buyer) $('input', oa).checked = !!buyer.offer_alerts;
}
function orderCard(o, storeName) {
  const c = mk('div', 'card stack');
  const [label, step] = STATUS[o.status];
  const head = mk('div'); head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap';
  head.append(mk('b', '', `${storeName || 'المحل'} · ${o.number}`), mk('span', 'badge ' + (step === 0 ? 'rejected' : step === 6 ? 'approved' : 'pending'), label));
  c.append(head);
  if (step > 0) { const st = mk('div', 'steps'); for (let i = 1; i <= 6; i++) st.append(mk('i', i <= step ? 'on' : '')); c.append(st); }
  c.append(mk('div', 'hint', o.items.map(i => `${i.name} × ${i.qty}`).join('، ')));
  if (o.fulfillment === 'roundtrip') {
    if (o.collect_at && ['placed', 'accepted', 'to_collect', 'collecting'].includes(o.status)) c.append(mk('div', 'hint', '🕒 الاستلام منك: ' + when(o.collect_at)));
    if (o.return_due_at && !['delivered', 'rejected', 'cancelled'].includes(o.status)) c.append(mk('div', 'hint', '⏰ يرجع لك قبل: ' + when(o.return_due_at)));
    if (o.adjust_pending) {
      const box = mk('div', 'note stack');
      box.append(mk('b', '', `تعدّل العدد وقت الاستلام. المبلغ الجديد ${sar(o.total)}`), mk('div', 'hint', o.items.map(i => `${i.name} × ${i.qty}`).join('، ') + (o.adjust_note ? ' · ' + o.adjust_note : '')));
      const ok = mk('button', 'btn primary sm', '✓ موافق على التعديل'); ok.type = 'button';
      ok.onclick = async () => { const { error } = await sb.rpc('order_action_v', { oid: o.id, action: 'approve_adjust', args: {} }); if (error) return toast(why(error)); toast('تمت الموافقة ✓'); openOrders(); };
      box.append(ok); c.append(box);
    }
  }
  if (o.receipt_pref === 'paper') c.append(mk('div', 'hint', '🧾 طلبت فاتورة ورقية مع الطلب'));
  if (o.invoice_token && !['placed', 'rejected', 'cancelled'].includes(o.status)) { const a = mk('a', 'btn ghost sm', '📄 فاتورتك (PDF)'); a.href = invoiceLink(o.invoice_token, IS_DEMO); a.target = '_blank'; a.rel = 'noopener'; c.append(a); }
  if (o.receipt_pref === 'whatsapp') c.append(mk('div', 'hint', o.receipt_sent_at ? '💬 أرسل لك المحل الفاتورة على الواتساب ✓' : '💬 الفاتورة بتوصلك على الواتساب'));
  c.append(mk('div', 'num', `الإجمالي ${sar(o.total)} · ${o.fulfillment === 'delivery' ? 'توصيل' : o.fulfillment === 'roundtrip' ? 'استلام وتسليم' + (o.express ? ' ⚡ مستعجل' : '') : 'استلام من المحل'} · ${PAY[o.payment_method]}${o.payment_status === 'paid' ? ' · مدفوع ✓' : o.payment_status === 'proof' ? ' · وصل الإيصال' : ''}`));
  if (o.driver_name && ['ready', 'out'].includes(o.status)) c.append(mk('div', 'hint', `🛵 المندوب: ${o.driver_name}`));
  // رمز التسليم: يعطيه الزبون للمندوب (أو للكاشير في الاستلام من المحل)
  const codeTime = o.fulfillment === 'pickup' ? ['accepted', 'preparing', 'ready'].includes(o.status) : o.status === 'out' || (o.fulfillment !== 'roundtrip' && ['accepted', 'preparing', 'ready'].includes(o.status));
  // الطلب المدفوع مسبقًا: المشتري يأكّد بنفسه «استلمت طلبي» بدون تواصل، والرمز احتياط
  const selfConfirm = o.fulfillment !== 'pickup' && o.status === 'out' && o.payment_status === 'paid';
  if (o.buyer_confirmed_at && o.status === 'out') c.append(mk('div', 'hint', '✅ أكّدت الاستلام. شكرًا لك'));
  else if (o.handover_code && codeTime) {
    const box = mk('div', 'note stack'); box.style.textAlign = 'center';
    if (selfConfirm) {
      const ok = mk('button', 'btn primary', '✓ استلمت طلبي'); ok.type = 'button';
      ok.onclick = async () => {
        if (!confirm('تأكد إن الطلب صار عندك. نأكّد الاستلام؟')) return;
        setBusy(ok, true);
        const { error } = await sb.rpc('order_action_v', { oid: o.id, action: 'buyer_confirm', args: {} });
        setBusy(ok, false);
        if (error) return toast(why(error));
        toast('شكرًا، وصل المندوب تأكيدك ✓'); openOrders(true);
      };
      box.append(mk('div', '', 'طلبك مدفوع. لما يوصلك اضغط هنا، وما يحتاج تقابل المندوب.'), ok, mk('div', 'hint', 'أو قول للمندوب هذا الرمز:'));
    } else box.append(mk('div', 'hint', o.fulfillment === 'pickup' ? '🔐 رمز الاستلام: قوله للكاشير وقت ما تستلم طلبك' : '🔐 رمز التسليم: قوله للمندوب لما يوصلك'));
    const code = mk('b', 'num', o.handover_code); code.style.cssText = 'font-size:2rem;letter-spacing:.35em'; code.dir = 'ltr';
    box.append(code, mk('div', 'hint', 'لا تعطيه لأحد قبل ما تستلم طلبك. لو بيستلم أحد بدالك، أرسله له.'));
    c.append(box);
  }
  if (o.reason) c.append(mk('div', 'hint', 'السبب: ' + o.reason));

  const acts = mk('div'); acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  if (o.status === 'placed') {
    const x = mk('button', 'btn ghost sm', 'إلغاء الطلب'); x.type = 'button';
    x.onclick = async () => { if (!confirm('تلغي الطلب؟')) return; const { error } = await sb.rpc('order_action_v', { oid: o.id, action: 'cancel', args: {} }); if (error) return toast(why(error)); openOrders(); };
    acts.append(x);
  }
  if (o.payment_method === 'transfer' && o.payment_status !== 'paid' && ['accepted', 'preparing', 'ready', 'out'].includes(o.status)) {
    const box = mk('div', 'note stack'); c.append(box);
    sb.rpc('order_transfer_info', { oid: o.id }).then(({ data }) => {
      const t = data?.[0];
      box.append(mk('div', '', t ? `حوّل ${sar(o.total)} إلى ${t.holder}${t.bank_name ? ' (' + t.bank_name + ')' : ''}: ` : 'بيانات التحويل بتوصلك من المحل.'));
      if (t) box.append(mk('b', 'num', t.iban.replace(/(.{4})/g, '$1 ').trim()));
      box.append(mk('div', 'hint', '⚠️ لا تحوّل لأي رقم ثاني غير هذا الحساب المعتمد عندنا.'));
      if (o.payment_status !== 'proof' && t) {
        const up = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,application/pdf' });
        const b = mk('button', 'btn primary sm', '📎 رفع إيصال التحويل'); b.type = 'button';
        b.onclick = async () => {
          const f = up.files[0]; if (!f) return toast('اختر صورة الإيصال.');
          setBusy(b, true);
          try {
            const sm = await shrinkImage(f, 1600), path = `${user.id}/${o.number}-${Date.now()}.${fileExt(sm)}`;
            const r1 = await sb.storage.from('receipts').upload(path, sm, { contentType: sm.type || undefined }); if (r1.error) throw r1.error;
            const r2 = await sb.rpc('order_action_v', { oid: o.id, action: 'proof', args: { receipt: path } }); if (r2.error) throw r2.error;
            toast('وصل الإيصال للمحل ✓'); openOrders();
          } catch (ex) { toast(why(ex)); } finally { setBusy(b, false); }
        };
        box.append(up, b);
      }
    });
  }
  if (acts.children.length) c.append(acts);
  return c;
}
// تحديث الحالة كل 30 ثانية وأنت في صفحة طلباتي
setInterval(() => { if (!$('#v-orders').hidden && !document.hidden) openOrders(true); }, 30000);

// موافقة المشتري على تنبيهات العروض (اختيارية)
$('#offer-alerts input').addEventListener('change', async e => {
  const on = e.target.checked;
  const { error } = await sb.rpc('set_offer_alerts', { on_: on });
  if (error) { e.target.checked = !on; return toast(friendlyError(error)); }
  if (buyer) buyer.offer_alerts = on;
  toast(on ? 'بنبهك بعروض المحلات القريبة ✓ (فعّل التنبيهات لو ما فعّلتها)' : 'وقفنا تنبيهات العروض.');
});

// شعار المحل (لو رفعه) جنب الاسم
function withLogo(path, el, size) {
  if (!path) return el;
  const w = mk('div'); w.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0';
  const lg = mk('img'); lg.src = imgUrl(path); lg.alt = ''; lg.loading = 'lazy';
  lg.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;border-radius:10px;border:1px solid var(--line);background:#fff;flex:0 0 auto`;
  w.append(lg, el); return w;
}

// اختيار الفاتورة يبقى محفوظ لو أعاد فتح السلة (مثلًا بعد تسجيل الدخول)
$('#c-receipt').addEventListener('change', e => { if (e.target.name === 'receipt') try { localStorage.setItem('tah-receipt', e.target.value); } catch {} });

// دخول المختبرين بالإيميل (قبل الإطلاق)
$('#f-tester').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  setBusy(btn, true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) { setBusy(btn, false); return (err.textContent = 'الإيميل أو كلمة المرور غير صحيحة.'); }
  const { data: ok } = await sb.rpc('buyer_access');
  setBusy(btn, false);
  if (!ok) { await sb.auth.signOut(); return (err.textContent = 'هذا الحساب مو من المختبرين.'); }
  location.reload();
});

// عارض صور المنتج (يسحب يمين ويسار بين الصور)
function viewImages(title, paths) {
  const d = $('#img-view');
  $('#iv-title').textContent = title;
  $('#iv-slides').replaceChildren(...paths.map((p, i) => { const im = mk('img'); im.src = imgUrl(p); im.alt = `${title} · صورة ${i + 1}`; return im; }));
  $('#iv-hint').hidden = paths.length < 2;
  d.showModal(); $('#iv-slides').scrollTo(0, 0);
}
$('#iv-close').addEventListener('click', () => $('#img-view').close());
