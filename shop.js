// صفحة المشتري: المحلات القريبة ← منتجات المحل ← السلة ← تأكيد الطلب ← متابعة الطلب.
// الدفع للمحل مباشرة (عند الاستلام، شبكة، تحويل، تابي/تمارا في المحل)؛ المنصة ما تمسك فلوس.
import { sb, $, $$, toast, digits, valid, friendlyError, setBusy, shrinkImage, fileExt } from './lib.js';
import { IS_DEMO } from './config.js';
import { invoiceLink } from './invoice-ui.js';
import { pickLocation } from './mappick.js';
import { showInstall, showPushCard } from './pwa.js';

const VIEWS = ['v-loading', 'v-closed', 'v-stores', 'v-store', 'v-cart', 'v-login', 'v-orders'];
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

// ---------------- السلة (محل واحد) ----------------
const CART_KEY = 'tah-cart';
const cart = {
  get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || { mid: null, items: {} }; } catch { return { mid: null, items: {} }; } },
  save(c) { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {} },
  count(c = cart.get()) { return Object.values(c.items).reduce((s, x) => s + x.qty, 0); },
  sum(c = cart.get()) { return Object.values(c.items).reduce((s, x) => s + x.qty * x.price, 0); },
};
function setQty(p, qty, pack = false) {
  let c = cart.get();
  if (c.mid && c.mid !== cur.id && cart.count(c)) {
    if (!confirm('السلة فيها منتجات من محل ثاني. تفرّغها وتبدأ من هذا المحل؟')) return;
    c = { mid: null, items: {} };
  }
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
  const { data } = await sb.from('stores_public').select('*');
  stores = data || [];
  navigator.geolocation?.getCurrentPosition(p => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; if (!$('#v-stores').hidden) renderStores(); }, () => {}, { timeout: 8000 });
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
// البحث: عن منتج أو محل في المحلات القريبة (من الخادم)، والمحلات «المميزة» القريبة تطلع أول
let searchHits = null, searchTimer = null;
$('#sq').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#sq').value.trim();
  if (q.length < 2) { searchHits = null; return renderStores(); }
  searchTimer = setTimeout(async () => {
    const { data } = await sb.rpc('search_nearby', { q, la: here?.lat ?? null, ln: here?.lng ?? null });
    if ($('#sq').value.trim() !== q) return;
    searchHits = data || []; renderStores();
  }, 450);
});
const PREMIUM_KM = 3;
function renderStores() {
  const q = $('#sq').value.trim();
  const withD = s => ({ s, d: here && s.lat != null ? km(here, s) : null });
  const boost = x => x.s.premium && (x.d == null || x.d <= PREMIUM_KM);
  let list;
  if (searchHits && q.length >= 2) {
    const byId = Object.fromEntries(stores.map(s => [s.id, s]));
    list = searchHits.filter(h => byId[h.id]).map(h => ({ ...withD(byId[h.id]), hit: h }));
  } else {
    list = stores.map(withD).sort((a, b) => (boost(b) - boost(a)) || ((a.d ?? 1e9) - (b.d ?? 1e9)));
  }
  $('#loc-note').textContent = searchHits && q.length >= 2 ? (list.length ? `لقينا «${q}» في ${list.length} محل.` : `ما لقينا «${q}» قريب منك. جرّب كلمة ثانية.`)
    : here ? 'مرتبة من الأقرب لك.' : 'اسمح بالموقع عشان نرتبها من الأقرب.';
  $('#stores').replaceChildren(...list.map(({ s, d, hit }) => {
    const b = mk('button', 'card store-card'); b.type = 'button';
    const name = mk('b', '', s.store_name);
    if (s.premium) { const pb = mk('span', 'badge pending', '⭐ مميز'); pb.style.marginInlineStart = '6px'; name.append(pb); }
    const t = mk('div'); t.append(name, mk('div', 'hint', [s.activity, s.district].filter(Boolean).join(' · ')));
    if (hit?.matches) t.append(mk('div', 'hint', `فيه: ${(hit.sample || []).join('، ')}${hit.matches > 3 ? ` و${hit.matches - 3} غيرها` : ''}`));
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
    else if (src) { const i = mk('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; el.append(i); } else el.append(mk('div', 'ph', p.name.slice(0, 1)));
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
  $('#c-ful').replaceChildren(...ful);
  const ex = $('#c-express-row'); ex.hidden = !settings.express_enabled;
  $('#c-express-lbl').textContent = `⚡ مستعجل: يرجع لك خلال ${settings.express_hours || 24} ساعة (+${sar(settings.express_fee)})`;
  if (!fo.collect_at.value) { const d = new Date(Date.now() + 2 * 36e5); d.setMinutes(0, 0, 0); fo.collect_at.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
  if (!ful.length) $('#c-ful').append(mk('p', 'err', 'المحل ما فعّل الاستلام ولا التوصيل.'));
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
  navigator.geolocation?.getCurrentPosition(p => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; $('#c-loc').textContent = '✓ تم تحديد الموقع'; },
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
  cart.save({ mid: null, items: {} });
  toast(`وصل طلبك ${data.number} للمحل ✓`, 4500);
  openOrders();
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
