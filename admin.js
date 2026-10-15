import { sb, $, $$, toast, PLANS, STATUS, friendlyError, setBusy, trialInfo, fmtDay } from './lib.js';

const VIEWS = ['v-loading', 'v-login', 'v-denied', 'v-list'];
const show = id => VIEWS.forEach(v => { $('#' + v).hidden = v !== id; });
let all = [], tab = 'pending', routedFor = undefined;
const focusId = location.hash.slice(1);

$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button', f);
  setBusy(btn, true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  setBusy(btn, false);
  err.textContent = error ? friendlyError(error) : '';
});
$('#logout').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((event, session) => {
  if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
  const id = session?.user?.id ?? null;
  if (id === routedFor) return;
  routedFor = id;
  setTimeout(() => route(session), 0);
});

async function route(session) {
  const user = session?.user;
  $('#who').textContent = user?.email ?? '';
  $('#logout').hidden = !user;
  if (!user) return show('v-login');
  show('v-loading');
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error) { $('#v-loading').textContent = friendlyError(error); return; }
  if (!isAdmin) return show('v-denied');
  show('v-list');
  await load();
}

async function load() {
  const { data, error } = await sb.from('merchants').select('*').order('submitted_at', { ascending: false });
  if (error) return toast(friendlyError(error));
  all = data;
  if (focusId) { const m = all.find(x => x.id === focusId); if (m) tab = m.status; }
  for (const s of Object.keys(STATUS)) $(`[data-c="${s}"]`).textContent = all.filter(m => m.status === s).length;
  $$('#tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.s === tab)));
  render();
}

$$('#tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.s;
  $$('#tabs [role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  render();
}));
$('#q').addEventListener('input', render);
$('#refresh').addEventListener('click', load);

const fmtDate = d => new Date(d).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });

function render() {
  $('#q').hidden = tab === 'launch';
  if (tab === 'launch') return renderLaunch();
  const q = $('#q').value.trim().toLowerCase();
  const list = all.filter(m => m.status === tab && (!q || [m.store_name, m.owner_name, m.cr_number, m.phone, m.email, m.city].some(x => (x || '').toLowerCase().includes(q))));
  const box = $('#mlist');
  if (!list.length) { box.innerHTML = '<div class="empty">ما فيه طلبات هنا.</div>'; return; }
  box.replaceChildren(...list.map(card));
  const f = focusId && document.getElementById('m-' + focusId);
  if (f) { f.classList.add('focus'); f.scrollIntoView({ block: 'center' }); }
}

function card(m) {
  const el = document.createElement('article');
  el.className = 'card mcard'; el.id = 'm-' + m.id;
  const t = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? '', className: cls || '' });

  const head = document.createElement('div'); head.className = 'head';
  head.append(t('h3', m.store_name), t('span', STATUS[m.status], 'badge ' + m.status), t('span', 'أُرسل ' + fmtDate(m.submitted_at), 'hint num'));

  const kv = document.createElement('div'); kv.className = 'kv';
  const add = (k, v, ltr) => { const d = document.createElement('div'); d.append(t('span', k)); const b = t('b', v || '—'); if (ltr) { b.dir = 'ltr'; b.className = 'num'; } d.append(b); kv.append(d); };
  add('المالك', m.owner_name); add('النشاط', m.activity); add('المدينة', [m.city, m.district].filter(Boolean).join(' — '));
  add('العنوان الوطني', m.national_address, true);
  add('الجوال', m.phone, true); add('الإيميل', m.email, true);
  add('السجل التجاري', m.cr_number, true);
  add('الرقم الضريبي', m.vat_registered ? m.vat_number : 'غير مسجل', m.vat_registered);
  add('البنك', m.bank_name); add('الآيبان', (m.iban || '').replace(/(.{4})/g, '$1 ').trim(), true);
  const tr = trialInfo(m);
  add('الباقة', m.plan !== 'free' ? PLANS[m.plan]
    : `مجانية 3 أشهر ${tr.state === 'waiting' ? '(تبدأ عند الإطلاق)' : tr.state === 'active' ? `(باقي ${tr.days} يوم، تنتهي ${fmtDay(tr.end)})` : '(انتهت)'} ← بعدها: ${PLANS[m.next_plan]}`);
  if (m.lat != null) {
    const d = document.createElement('div'); d.append(t('span', 'الموقع'));
    const a = t('a', 'افتح في الخرائط'); a.href = `https://www.google.com/maps?q=${m.lat},${m.lng}`; a.target = '_blank'; a.rel = 'noopener';
    d.append(a); kv.append(d);
  }

  const docs = document.createElement('div'); docs.className = 'docs';
  for (const [label, path] of [['السجل التجاري', m.cr_path], ['الشهادة الضريبية', m.vat_path], ['شهادة الآيبان', m.iban_path]]) {
    if (!path) continue;
    const b = t('button', '📄 ' + label, 'btn ghost sm');
    b.onclick = async () => {
      const w = window.open('', '_blank');
      const { data, error } = await sb.storage.from('merchant-docs').createSignedUrl(path, 600);
      if (error) { w?.close(); return toast(friendlyError(error)); }
      if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
    };
    docs.append(b);
  }
  const chk = [];
  chk.push(t('a', 'تحقق من السجل (منصة الأعمال)', 'btn ghost sm'));
  chk[0].href = 'https://business.sa'; chk[0].target = '_blank'; chk[0].rel = 'noopener';
  docs.append(...chk);

  const parts = [head, kv, docs];
  if (m.review_note && m.status !== 'approved') { const n = t('div', 'ملاحظة سابقة: ' + m.review_note, 'note'); parts.push(n); }

  const acts = document.createElement('div'); acts.className = 'acts-row';
  const act = (label, cls, fn) => { const b = t('button', label, 'btn sm ' + cls); b.onclick = () => fn(b); acts.append(b); };
  if (m.status !== 'approved') act(m.status === 'suspended' ? 'إعادة التفعيل' : 'تفعيل المتجر ✓', 'primary', b => setStatus(m, 'approved', null, b));
  if (m.status === 'pending') act('رفض / طلب تعديل', 'danger', () => askNote(m, 'rejected'));
  if (m.status === 'approved') act('إيقاف مؤقت', 'danger', () => askNote(m, 'suspended'));
  const wa = t('a', 'واتساب التاجر', 'btn ghost sm'); wa.href = 'https://wa.me/966' + m.phone.slice(1); wa.target = '_blank'; wa.rel = 'noopener';
  acts.append(wa);
  parts.push(acts);
  el.append(...parts);
  return el;
}

async function setStatus(m, status, note, btn) {
  if (status === 'approved' && !confirm(`تفعيل «${m.store_name}»؟ بيوصل للتاجر إيميل ويقدر يضيف منتجاته.`)) return;
  setBusy(btn, true);
  const { error } = await sb.from('merchants').update({ status, review_note: note }).eq('id', m.id);
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast({ approved: 'تم التفعيل ✓ وصل التاجر إيميل.', rejected: 'تم إرسال طلب التعديل للتاجر.', suspended: 'تم إيقاف المتجر.' }[status]);
  await load();
}

// نافذة سبب الرفض / الإيقاف
const dn = $('#dlg-note'), fn = $('#f-note');
const PRESETS = {
  rejected: ['صورة السجل التجاري غير واضحة، ارفعها مرة ثانية.', 'السجل التجاري منتهي، ارفع سجل ساري.', 'اسم صاحب الآيبان لا يطابق اسم المنشأة أو المالك.', 'الشهادة الضريبية لا تطابق الرقم الضريبي المكتوب.', 'النشاط في السجل لا يطابق النشاط المختار.'],
  suspended: ['شكاوى متكررة من المشترين.', 'أسعار أو كميات غير صحيحة.', 'انتهاء صلاحية السجل التجاري.'],
};
let pending = null;
function askNote(m, status) {
  pending = { m, status };
  fn.reset(); $('.err', fn).textContent = '';
  $('#note-title').textContent = status === 'rejected' ? `طلب تعديل: ${m.store_name}` : `إيقاف: ${m.store_name}`;
  $('#note-ok').textContent = status === 'rejected' ? 'إرسال للتاجر' : 'إيقاف المتجر';
  $('#presets').replaceChildren(...PRESETS[status].map(p => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost sm', textContent: p });
    b.onclick = () => { fn.note.value = (fn.note.value ? fn.note.value + '\n' : '') + p; };
    return b;
  }));
  dn.showModal();
}
$('#note-cancel').addEventListener('click', () => dn.close());
fn.addEventListener('submit', async e => {
  e.preventDefault();
  const note = fn.note.value.trim();
  if (pending.status === 'rejected' && note.length < 5) { $('.err', fn).textContent = 'اكتب للتاجر وش المطلوب يعدّل.'; return; }
  dn.close();
  await setStatus(pending.m, pending.status, note || null, null);
});

// ---------------- لوحة الإطلاق ----------------
async function renderLaunch() {
  const box = $('#mlist');
  box.innerHTML = '<p class="hint">جارِ التحميل…</p>';
  const [{ data: st, error: e1 }, { data: cfg, error: e2 }] = await Promise.all([
    sb.rpc('launch_stats'), sb.from('app_settings').select('*').single(),
  ]);
  if (e1 || e2) { box.innerHTML = ''; return toast(friendlyError(e1 || e2)); }
  if (tab !== 'launch') return;
  const t = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? '', className: cls || '' });
  const bs = st.by_status || {};

  const stats = t('div', '', 'stats');
  stats.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
  for (const [n, l] of [[bs.approved || 0, 'محل مفعّل'], [bs.pending || 0, 'بانتظار المراجعة'], [st.products, 'منتج ظاهر'], [st.stores_with_products, 'محل أضاف منتجات'], [st.last_7_days, 'تسجيل آخر 7 أيام']]) {
    const d = t('div', '', 'stat'); d.append(t('b', String(n), 'num'), t('span', l)); stats.append(d);
  }

  const cities = t('div', '', 'card stack');
  cities.append(t('h3', 'الجاهزية حسب المدينة'));
  if (!st.by_city.length) cities.append(t('p', 'ما فيه محلات مسجلة بعد.', 'hint'));
  for (const c of st.by_city) {
    const row = t('div', ''); row.style.cssText = 'display:grid;grid-template-columns:minmax(90px,1fr) 3fr;gap:10px;align-items:center';
    const bar = t('div', ''); bar.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    const meter = t('div', ''); meter.style.cssText = 'height:10px;border-radius:999px;background:var(--brand-soft);overflow:hidden';
    const fill = t('div', ''); fill.style.cssText = `height:100%;width:${Math.min(100, c.approved)}%;background:var(--brand)`;
    meter.append(fill);
    bar.append(meter, t('span', `${c.approved} مفعّل · ${c.pending} بالانتظار · ${c.products} منتج`, 'hint num'));
    row.append(t('b', c.city), bar);
    cities.append(row);
  }
  cities.append(t('p', 'الشريط يمتلئ عند 100 محل مفعّل، وهذا هدف مقترح قبل فتح خدمة المشتري في المدينة.', 'hint'));

  const plans = t('div', '', 'card stack');
  plans.append(t('h3', 'الباقات (المحلات المفعّلة)'));
  const ptags = t('div', '', 'docs');
  for (const [k, n] of Object.entries(st.by_plan || {})) ptags.append(t('span', `${PLANS[k] || k}: ${n}`, 'badge approved'));
  if (!Object.keys(st.by_plan || {}).length) ptags.append(t('span', '—', 'hint'));
  plans.append(ptags);

  const acts = t('div', '', 'card stack');
  acts.append(t('h3', 'الأنشطة المفعّلة'));
  const tags = t('div', '', 'docs');
  for (const a of st.by_activity) tags.append(t('span', `${a.activity}: ${a.n}`, 'badge approved'));
  if (!st.by_activity.length) tags.append(t('span', '—', 'hint'));
  acts.append(tags);

  const sw = t('div', '', 'card stack');
  sw.append(t('h3', 'مفاتيح الإطلاق'), t('p', 'كل شيء مقفل افتراضيًا. التجار يسجلون ويضيفون منتجاتهم، لكن ما يظهر شيء للعامة لين تفتح خدمة المشتري.', 'hint'));
  const city = t('label', 'مدينة الإطلاق الأولى');
  const ci = Object.assign(document.createElement('input'), { value: cfg.launch_city });
  city.append(ci);
  const mkSw = (key, label, hint) => {
    const l = t('label', '', 'check'); const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cfg[key] });
    const span = t('span', ''); span.append(t('b', label)); span.append(document.createElement('br')); span.append(t('span', hint, 'hint'));
    l.append(c, span); return [l, c];
  };
  const [l1, c1] = mkSw('buyer_enabled', 'فتح خدمة المشتري', 'تظهر المحلات والمنتجات المفعّلة للعامة وتطبيق المشتري.');
  const [l2, c2] = mkSw('payments_enabled', 'تفعيل المدفوعات', 'لا تفعّلها إلا بعد ربط بوابة الدفع وتجربتها.');
  c2.disabled = !cfg.buyer_enabled;
  c1.onchange = () => { c2.disabled = !c1.checked; if (!c1.checked) c2.checked = false; };
  const save = t('button', 'حفظ', 'btn primary');
  save.onclick = async () => {
    if (c1.checked && !cfg.buyer_enabled && !confirm('فتح خدمة المشتري يخلي المحلات والمنتجات ظاهرة للعامة. متأكد؟')) return;
    setBusy(save, true);
    const { error } = await sb.from('app_settings').update({ buyer_enabled: c1.checked, payments_enabled: c1.checked && c2.checked, launch_city: ci.value.trim() || cfg.launch_city, updated_at: new Date().toISOString() }).eq('id', true);
    setBusy(save, false);
    toast(error ? friendlyError(error) : 'تم الحفظ ✓');
    if (!error) renderLaunch();
  };
  const row = t('div', '', 'acts-row'); row.append(save);
  sw.append(city, l1, l2, row);

  box.replaceChildren(stats, cities, plans, acts, sw);
}
