// صفحة المشتري: المحلات القريبة ← منتجات المحل ← السلة ← تأكيد الطلب ← متابعة الطلب.
// الدفع للمحل مباشرة (عند الاستلام، شبكة، تحويل، تابي/تمارا في المحل)؛ المنصة ما تمسك فلوس.
import { sb, $, $$, toast, digits, valid, friendlyError, setBusy, shrinkImage, fileExt } from './lib.js';
import { IS_DEMO } from './config.js';
import { pickLocation } from './mappick.js';

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
function setQty(p, qty) {
  let c = cart.get();
  if (c.mid && c.mid !== cur.id && cart.count(c)) {
    if (!confirm('السلة فيها منتجات من محل ثاني. تفرّغها وتبدأ من هذا المحل؟')) return;
    c = { mid: null, items: {} };
  }
  c.mid = cur.id; c.store = cur.store_name;
  if (qty <= 0) delete c.items[p.id];
  else c.items[p.id] = { qty: Math.min(qty, settings?.service_roundtrip ? 999 : (p.quantity ?? 999)), name: p.name, price: unitPrice(p) };
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
  const { data: s } = await sb.from('app_settings').select('buyer_enabled').maybeSingle();
  if (!s?.buyer_enabled) return show('v-closed');
  const { data } = await sb.from('stores_public').select('*');
  stores = data || [];
  navigator.geolocation?.getCurrentPosition(p => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; if (!$('#v-stores').hidden) renderStores(); }, () => {}, { timeout: 8000 });
  if (location.hash === '#orders') return openOrders();
  showStores();
})();

// ---------------- المحلات ----------------
function showStores() { renderStores(); show('v-stores'); }
$('#sq').addEventListener('input', renderStores);
function renderStores() {
  const q = $('#sq').value.trim();
  const list = stores.filter(s => !q || s.store_name.includes(q) || (s.activity || '').includes(q))
    .map(s => ({ s, d: here && s.lat != null ? km(here, s) : null }))
    .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
  $('#loc-note').textContent = here ? 'مرتبة من الأقرب لك.' : 'اسمح بالموقع عشان نرتبها من الأقرب.';
  $('#stores').replaceChildren(...list.map(({ s, d }) => {
    const b = mk('button', 'card store-card'); b.type = 'button';
    const t = mk('div'); t.append(mk('b', '', s.store_name), mk('div', 'hint', [s.activity, s.district].filter(Boolean).join(' · ')));
    b.append(t, mk('span', 'badge approved num', d == null ? '' : d < 1 ? `${Math.round(d * 1000)} م` : `${d.toFixed(1)} كم`));
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
  $('#st-name').textContent = s.store_name;
  const info = [s.activity, settings.pickup !== false && 'استلام من المحل', settings.delivers && `توصيل ${Number(settings.delivery_fee) ? sar(settings.delivery_fee) : 'مجاني'}`,
    settings.service_roundtrip && `🧺 استلام وتسليم من بيتك ${Number(settings.roundtrip_fee) ? sar(settings.roundtrip_fee) : 'مجاني'}`,
    settings.min_order && `أقل طلب ${sar(settings.min_order)}`].filter(Boolean);
  $('#st-info').textContent = info.join(' · ');
  $('#pq').value = '';
  renderProducts(); renderCartBar(); show('v-store');
}
$('#pq').addEventListener('input', renderProducts);
function renderProducts() {
  const q = $('#pq').value.trim(), c = cart.get();
  const list = products.filter(p => !q || p.name.includes(q) || (p.category || '').includes(q));
  $('#products').replaceChildren(...list.map(p => {
    const svc = !!settings.service_roundtrip, out = !svc && p.quantity === 0;
    const el = mk('div', 'prod' + (out ? ' off' : ''));
    const src = imgUrl(p.image_path);
    if (src) { const i = mk('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; el.append(i); } else el.append(mk('div', 'ph', p.name.slice(0, 1)));
    const t = mk('div'); t.style.minWidth = '0';
    const m = mk('div', 'm'); const up = unitPrice(p);
    m.append(mk('b', 'num', sar(up)));
    if (up !== Number(p.price)) m.append(Object.assign(mk('s', 'num', sar(p.price))));
    if (out) m.append(mk('span', 'low', 'نفد'));
    t.append(mk('div', 'n', p.name), m); el.append(t);
    const inCart = c.mid === cur.id ? c.items[p.id]?.qty || 0 : 0;
    const box = mk('div', 'qty');
    if (!out) {
      if (inCart) {
        const minus = mk('button', '', '−'); minus.type = 'button'; minus.onclick = () => { setQty(p, inCart - 1); renderProducts(); };
        const plus = mk('button', '', '+'); plus.type = 'button'; plus.onclick = () => { setQty(p, inCart + 1); renderProducts(); };
        box.append(plus, mk('b', 'num', String(inCart)), minus);
      } else {
        const add = mk('button', 'btn primary sm', 'أضف'); add.type = 'button'; add.onclick = () => { setQty(p, 1); renderProducts(); };
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
    const p = products.find(y => y.id === pid);
    const q = mk('div', 'qty');
    const minus = mk('button', '', '−'); minus.type = 'button'; minus.onclick = () => { if (p) setQty(p, x.qty - 1); else { delete c.items[pid]; cart.save(c); } openCart(); };
    const plus = mk('button', '', '+'); plus.type = 'button'; plus.onclick = () => { if (p) { setQty(p, x.qty + 1); openCart(); } };
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
    mid: c.mid, items: Object.entries(c.items).map(([product_id, x]) => ({ product_id, qty: x.qty })), fulfillment: f, payment_method: pay,
    address: f !== 'pickup' ? fo.address.value.trim() : null, lat: f !== 'pickup' ? coords.lat : null, lng: f !== 'pickup' ? coords.lng : null, note: fo.note.value.trim() || null,
    collect_at: f === 'roundtrip' ? new Date(fo.collect_at.value).toISOString() : null, express: f === 'roundtrip' && fo.express.checked,
  });
  setBusy(btn, false);
  if (error) return (err.textContent = why(error));
  err.textContent = '';
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
  const { data, error } = await sb.from('buyers').insert({ id: user.id, name, phone: user.phone ? '0' + user.phone.replace(/^966/, '') : null }).select().single();
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
  if (!silent) show('v-orders');
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
  c.append(mk('div', 'num', `الإجمالي ${sar(o.total)} · ${o.fulfillment === 'delivery' ? 'توصيل' : o.fulfillment === 'roundtrip' ? 'استلام وتسليم' + (o.express ? ' ⚡ مستعجل' : '') : 'استلام من المحل'} · ${PAY[o.payment_method]}${o.payment_status === 'paid' ? ' · مدفوع ✓' : o.payment_status === 'proof' ? ' · وصل الإيصال' : ''}`));
  if (o.driver_name && ['ready', 'out'].includes(o.status)) c.append(mk('div', 'hint', `🛵 المندوب: ${o.driver_name}`));
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
