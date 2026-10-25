import { rememberLogin, hidePasswords, sb, $, $$, toast, clean, digits, valid, money, ACTIVITIES, PLANS, planLabel, STATUS, fileExt, shrinkImage, friendlyError, setBusy, trialInfo, fmtDay, OFFER_REASONS, KINDS, KIND_ICON, ACTIVITIES_BY_KIND } from './lib.js';
import { pickLocation } from './mappick.js';

const VIEWS = ['v-loading', 'v-auth', 'v-check-email', 'v-reset', 'v-apply', 'v-status', 'v-invites', 'v-dash'];
const show = id => { VIEWS.forEach(v => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); };
const here = () => location.origin + location.pathname;

let user = null, merchant = null, products = [], editing = null, recovering = false, routedFor = undefined, coords = null;
let invites = [], stores = [], skipInvites = false;
// كود المسوّق من رابط التسجيل (?ref=M01) — نحفظه لين يكمل التاجر طلبه
const REF = (() => {
  const r = new URLSearchParams(location.search).get('ref');
  try { if (r) localStorage.setItem('tah-ref', r.toUpperCase()); return r?.toUpperCase() || localStorage.getItem('tah-ref'); } catch { return r?.toUpperCase() || null; }
})();
// ctx: المتجر المفتوح حاليًا — صاحبه أو موظف فيه
let ctx = null;
const ROLES = { manager: 'مدير فرع', stock: 'أمين مخزون', pricing: 'موظف أسعار', cashier: 'كاشير', accountant: 'محاسب' };
const ROLE_PERMS = { manager: ['inventory', 'prices'], stock: ['inventory'], pricing: ['prices'] };
const canInv = () => ctx?.owner || ctx?.perms.has('inventory');
const canPrice = () => ctx?.owner || ctx?.perms.has('prices');
const viaApproval = () => !!ctx && !ctx.owner && ctx.needs;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// حدود المنتجات الظاهرة لكل باقة (مميز والفترة المجانية بلا حد)
const PLAN_LIMITS = { basic: 10, family: 100, trader: 500 };
const PLAN_NOTE = { basic: ' · حتى 10 منتجات، بدون عروض ولا توصيل', family: ' · حتى 100 منتج', trader: ' · حتى 500 منتج', pro: ' · منتجات بلا حد' };

// ---------------- الحساب ----------------
$$('#v-auth [role=tab]').forEach(t => t.addEventListener('click', () => {
  $$('#v-auth [role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $('#f-signup').hidden = t.dataset.tab !== 'signup';
  $('#f-login').hidden = t.dataset.tab !== 'login';
}));

$('#f-signup').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  const email = f.email.value.trim(), password = f.password.value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'اكتب إيميل صحيح.');
  if (password.length < 8) return (err.textContent = 'كلمة المرور لازم تكون 8 أحرف على الأقل.');
  if (password !== f.password2.value) return (err.textContent = 'كلمتا المرور غير متطابقتين.');
  err.textContent = ''; setBusy(btn, true);
  hidePasswords(f);
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return (err.textContent = 'هذا الإيميل مسجل من قبل. سجّل دخول بدلًا من ذلك.');
  }
  if (typeof gtag === 'function') gtag('event', 'sign_up', { method: 'merchant' });
  if (!data.session) { $('#sent-to').textContent = email; show('v-check-email'); }
});
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  err.textContent = ''; setBusy(btn, true);
  hidePasswords(f);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (!error) rememberLogin(f.email.value.trim(), f.password.value);
  setBusy(btn, false);
  if (error) { err.textContent = friendlyError(error); $('#resend').hidden = !(error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)); }
});

const SUPPORT_WA = '966555606635'; // رقم واتساب الدعم
$('#forgot').addEventListener('click', async () => {
  const f = $('#f-login'), err = $('.err', f), email = f.email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'اكتب إيميلك فوق أولًا.'; f.email.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
  err.textContent = '';
  $('#forgot-wa').hidden = false;
  toast(error ? friendlyError(error) : 'أرسلنا لك رابط تغيير كلمة المرور. إذا ما لقيته، شيّك على الرسائل غير المرغوب فيها (Spam).');
});
$('#forgot-wa').addEventListener('click', () => {
  const f = $('#f-login'), email = f.email.value.trim();
  const msg = `السلام عليكم، نسيت كلمة المرور في تحصّله.\nإيميل الحساب: ${email}`;
  window.open(`https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(msg)}`, '_blank');
  toast('راسلنا من نفس رقم الجوال المسجل في حسابك، ونرسل لك كلمة مرور مؤقتة.');
});// ---------------- إعادة إرسال رابط التأكيد ----------------
let resendWait = 0;
$('#resend').addEventListener('click', async () => {
  const f = $('#f-login'), err = $('.err', f), email = f.email.value.trim(), btn = $('#resend');
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'اكتب إيميلك فوق أولًا.'; f.email.focus(); return; }
  if (Date.now() < resendWait) { err.textContent = 'انتظر دقيقة ثم أعد المحاولة.'; return; }
  setBusy(btn, true);
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: here() } });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  resendWait = Date.now() + 60000;
  err.textContent = '';
  toast('أرسلنا رابط تأكيد جديد. افتح آخر رسالة فقط واضغط الرابط مرة واحدة.');
});

// رابط تأكيد منتهي أو مستخدم من قبل
(() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('error_code') !== 'otp_expired') return;
  history.replaceState(null, '', location.pathname);
  $('#v-auth [role=tab][data-tab=login]')?.click();
  $('.err', $('#f-login')).textContent = 'انتهت صلاحية رابط التأكيد. اكتب إيميلك واضغط "إعادة إرسال رابط التأكيد".';
  $('#resend').hidden = false;
})();
$('#f-reset').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f);
  if (f.password.value.length < 8) return (err.textContent = 'كلمة المرور لازم تكون 8 أحرف على الأقل.');
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  if (error) return (err.textContent = friendlyError(error));
  recovering = false; toast('تم تغيير كلمة المرور.'); routedFor = undefined; route();
});

$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; show('v-reset'); return; }
  if (recovering) return;
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
    const id = session?.user?.id ?? null;
    if (id === routedFor) return;           // نفس المستخدم، لا تعيد بناء الصفحة
    setTimeout(() => route(session), 0);
  }
});

async function route(session) {
  if (session === undefined) session = (await sb.auth.getSession()).data.session;
  user = session?.user ?? null;
  routedFor = user?.id ?? null;
  $('#who').textContent = user?.email ?? '';
  $('#logout').hidden = !user;
  { const ta = $('#to-admin'); if (ta) ta.hidden = true; }
  if (!user) return show('v-auth');
  // حساب الإدارة (اللي له متجر أيضًا) يشوف رابط لوحة الإدارة
  sb.rpc('is_admin').then(({ data }) => { const ta = $('#to-admin'); if (ta) ta.hidden = !data; });

  show('v-loading');
  const [m, inv, st] = await Promise.all([
    sb.from('merchants').select('*').eq('id', user.id).maybeSingle(),
    sb.rpc('my_invites'), sb.rpc('my_stores'),
  ]);
  if (m.error) { $('#v-loading').textContent = friendlyError(m.error); return; }
  merchant = m.data; invites = inv.data || []; stores = st.data || [];
  if (invites.length && !skipInvites) return showInvites();
  if (merchant?.status === 'approved' || stores.length) return openDash(pickStore());
  if (!merchant) return openApply();
  showStatus();
}

function pickStore() {
  const saved = store.get('tah-store');
  const ids = [merchant?.status === 'approved' ? merchant.id : null, ...stores.map(s => s.merchant_id)].filter(Boolean);
  return ids.includes(saved) ? saved : ids[0];
}

// ---------------- دعوات الانضمام ----------------
function showInvites() {
  const box = $('#inv-list');
  box.replaceChildren(...invites.map(i => {
    const el = document.createElement('div'); el.className = 'row-card';
    const txt = document.createElement('div');
    txt.append(Object.assign(document.createElement('div'), { className: 't', textContent: i.store_name }),
      Object.assign(document.createElement('div'), { className: 's', textContent: `الدور: ${ROLES[i.role] || i.role}` }));
    const acts = document.createElement('div'); acts.className = 'acts';
    const yes = Object.assign(document.createElement('button'), { className: 'btn primary sm', textContent: 'قبول الدعوة' });
    const no = Object.assign(document.createElement('button'), { className: 'btn ghost sm', textContent: 'رفض' });
    const answer = async (accept, btn) => {
      if (!accept && !confirm(`رفض دعوة «${i.store_name}»؟`)) return;
      setBusy(btn, true);
      const { error } = await sb.rpc('accept_invite', { invite: i.id, accept });
      setBusy(btn, false);
      if (error) return toast(friendlyError(error));
      toast(accept ? `انضممت لفريق «${i.store_name}» ✓` : 'تم رفض الدعوة.');
      if (accept) store.set('tah-store', i.merchant_id || '');
      routedFor = undefined; route();
    };
    yes.onclick = () => answer(true, yes); no.onclick = () => answer(false, no);
    acts.append(yes, no); el.append(txt, acts);
    return el;
  }));
  $('#inv-skip').textContent = merchant || stores.length ? 'تخطّي الآن' : 'لا، أبغى أسجّل متجري الخاص';
  show('v-invites');
}
$('#inv-skip').addEventListener('click', () => { skipInvites = true; routedFor = undefined; route(); });

// ---------------- حالة الطلب ----------------
function showStatus() {
  const s = merchant.status;
  const cfg = {
    pending: ['⏳', 'var(--warn-soft)', 'var(--warn)', 'طلبك قيد المراجعة',
      `استلمنا طلب «${merchant.store_name}» ومستنداته. نراجعها خلال يوم إلى يومي عمل، ويوصلك إيميل أول ما نفعّل متجرك.`],
    rejected: ['!', 'var(--pin-soft)', 'var(--pin)', 'طلبك يحتاج تعديل', 'راجعنا طلبك ونحتاج منك تعديل بسيط قبل التفعيل:'],
    suspended: ['⏸', 'var(--pin-soft)', 'var(--pin)', 'المتجر موقوف مؤقتًا', 'متجرك غير ظاهر للمشترين حاليًا. تواصل معنا لمعرفة التفاصيل.'],
  }[s];
  const icon = $('#st-icon');
  icon.textContent = cfg[0]; icon.style.background = cfg[1]; icon.style.color = cfg[2];
  $('#st-title').textContent = cfg[3];
  $('#st-text').textContent = cfg[4];
  const note = $('#st-note');
  note.hidden = !merchant.review_note || s === 'pending';
  note.textContent = merchant.review_note || '';
  const acts = $('#st-actions'); acts.replaceChildren();
  const mk = (cls, text, fn, href) => {
    const el = document.createElement(href ? 'a' : 'button');
    el.className = 'btn ' + cls; el.textContent = text;
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; } else el.addEventListener('click', fn);
    acts.append(el);
  };
  if (s === 'pending' || s === 'rejected') mk(s === 'rejected' ? 'primary' : 'ghost', s === 'rejected' ? 'عدّل الطلب وأعد الإرسال' : 'تعديل البيانات', () => openApply(merchant));
  mk('ghost', 'تواصل معنا على واتساب', null, 'https://wa.me/966555606635');
  if (stores.length) mk('ghost', 'رجوع لمتجر ' + stores[0].store_name, () => openDash(stores[0].merchant_id));
  show('v-status');
}

// ---------------- نموذج التسجيل ----------------
const fa = $('#f-apply');
// اقتراحات النشاط: القائمة الثابتة + الأنشطة اللي سجّلها تجار معتمدون من نفس النوع
const learned = {};
const OTHER_ACTIVITY = 'أنشطة أخرى (اكتب نشاطك)';   // خيار في القائمة: يفرّغ الخانة ويطلب من التاجر يكتب نشاطه
function fillActivities(k) {
  const all = [...new Set([...ACTIVITIES_BY_KIND[k], ...(learned[k] || [])])];
  const dl = $('#activity-list');
  if (dl) {
    dl.replaceChildren(...[...all.filter(a => a !== 'أخرى' && a !== 'أنشطة أخرى'), OTHER_ACTIVITY].map(a => Object.assign(document.createElement('option'), { value: a })));
  } else {   // صفحة قديمة (قائمة منسدلة): نفس السلوك السابق
    const keep = fa.activity.value;
    fa.activity.replaceChildren(new Option('اختر', ''), ...all.map(a => new Option(a, a)));
    if (all.includes(keep)) fa.activity.value = keep;
  }
}
async function learnActivities(k) {
  if (!user || learned[k]) return;
  const { data, error } = await sb.rpc('activity_suggestions', { k });
  if (error) return;
  learned[k] = (data || []).map(r => r.activity);
  if (kindOf() === k) fillActivities(k);
}
const kindOf = () => fa.querySelector('input[name=kind]:checked')?.value || 'store';
function syncKind() {
  const k = kindOf(), person = k !== 'store';
  fillActivities(k);
  learnActivities(k);
  $('#fs-id').hidden = !person; $('#fs-cr').hidden = person; $('#fs-vat').hidden = person;
  if (person) { fa.no_vat.checked = true; $('#vat-fields').hidden = true; }
  $('#lg-store').textContent = { store: 'المحل', family: 'مشروعك', mobile: 'العربة أو البسطة' }[k];
  $('#lb-store').textContent = { store: 'اسم المحل', family: 'اسم مشروعك (مثل: مطبخ أم فهد)', mobile: 'اسم العربة' }[k];
  $('#locate').textContent = { store: '📍 حدّد موقع المحل من جوالك', family: '📍 حدّد موقع البيت من جوالك', mobile: '📍 حدّد مكان وقوفك المعتاد' }[k];
  if (!coords) $('#loc-state').textContent = { store: 'اضغطه وأنت داخل المحل، عشان يظهر للمشترين القريبين.', family: 'اضغطه وأنت في البيت.', mobile: 'اضغطه وأنت في المكان اللي توقف فيه عادة.' }[k];
  const lk = $('#loc-kind');
  lk.hidden = !person;
  lk.textContent = k === 'family' ? '🔒 موقع بيتك ما يظهر للزبون بالضبط. يشوف اسم الحي والمسافة التقريبية فقط، والموقع الدقيق يوصله بعد ما تقبل طلبه.'
    : '🚚 بعد التفعيل تتحكم بظهورك من لوحتك: متاح الآن، أو مشغول، أو خارج الخدمة.';
  $('#na-hint').textContent = person ? '4 حروف و4 أرقام. تلقاه في تطبيق «سبل» أو «توكلنا»، في عنوانك الوطني الشخصي.'
    : '4 حروف و4 أرقام. تلقاه في تطبيق «سبل» أو موقع splonline.com.sa، في خانة العنوان الوطني للمنشأة.';
  $('#bank-hint').textContent = person
    ? 'حسابك الشخصي يكفي، بشرط يكون باسمك نفس اسم الهوية. آيبانك يظهر للمشتري بعد موافقتك على طلبه، لو فعّلت «تحويل على الحساب».'
    : 'الحساب لازم يكون باسم المنشأة أو صاحبها نفسه. آيبانك ما يظهر للمشترين.';
  $('#plan-family').hidden = !person; $('#yearly-family').hidden = !person;
  const pb = $('#plan-basic'); if (pb) pb.hidden = k === 'mobile';   // المتنقل ما له باقة مجانية
  if (k === 'mobile' && fa.querySelector('input[name=next_plan]:checked')?.value === 'basic') fa.querySelector('input[name=next_plan][value=family]').checked = true;
  if (!person && fa.querySelector('input[name=next_plan]:checked')?.value === 'family') fa.querySelector('input[name=next_plan][value=basic]').checked = true;
}
$$('input[name=kind]', fa).forEach(r => r.addEventListener('change', syncKind));
syncKind();

fa.no_vat.addEventListener('change', () => { $('#vat-fields').hidden = fa.no_vat.checked; });
fa.iban.addEventListener('input', () => {
  const v = clean(fa.iban.value).slice(0, 24);
  fa.iban.value = v.replace(/(.{4})/g, '$1 ').trim();
});
fa.national_address.addEventListener('input', () => { fa.national_address.value = clean(fa.national_address.value).replace(/[^A-Z0-9]/g, '').slice(0, 8); });
// اختار «أخرى (اكتب نشاطك)»: نفرّغ الخانة وننبّهه يكتب اسم نشاطه بنفسه
fa.activity?.addEventListener('input', () => {
  if (fa.activity.value === OTHER_ACTIVITY) { fa.activity.value = ''; fa.activity.focus(); toast('اكتب اسم نشاطك في الخانة، مثل: ورشة سيارات'); }
});
$('#same-phone')?.addEventListener('click', () => { if (fa.contact_phone) fa.contact_phone.value = fa.phone.value; });
for (const n of ['phone', 'contact_phone', 'cr_number', 'vat_number', 'id_number']) fa[n]?.addEventListener('input', () => { fa[n].value = digits(fa[n].value).replace(/\D/g, ''); });

$$('.file input[type=file]').forEach(inp => inp.addEventListener('change', () => {
  const box = inp.closest('.file'), f = inp.files[0];
  box.classList.toggle('has', !!f || !!box.dataset.existing);
  const many = inp.multiple && inp.files.length > 1 ? `✓ ${inp.files.length} ملفات` : null;
  $('.cur', box).textContent = many || (f ? `✓ ${f.name}` : (box.dataset.existing ? '✓ مرفوع مسبقًا (اختر ملف جديد لاستبداله)' : ''));
}));

$('#locate').addEventListener('click', () => {
  const st = $('#loc-state');
  if (!navigator.geolocation) { st.textContent = 'جهازك ما يدعم تحديد الموقع.'; return; }
  st.textContent = 'جارِ تحديد الموقع…';
  navigator.geolocation.getCurrentPosition(
    p => { coords = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }; st.textContent = `✓ تم تحديد الموقع (دقة ${Math.round(p.coords.accuracy)} متر)`; },
    () => { st.textContent = 'ما قدرنا نحدد الموقع. اسمح للمتصفح بالوصول للموقع وحاول مرة ثانية، أو تخطَّ هذه الخطوة.'; },
    { enableHighAccuracy: true, timeout: 15000 });
});

$('#map-pick').addEventListener('click', async () => {
  const p = await pickLocation(coords);
  if (!p) return;
  coords = p;
  $('#loc-state').textContent = '✓ تم تحديد الموقع على الخريطة';
});

function setExisting(kind, path) {
  const box = $(`.file[data-file="${kind}"]`);
  box.dataset.existing = path ? '1' : '';
  $('input[type=file]', box).value = '';
  box.classList.toggle('has', !!path);
  $('.cur', box).textContent = path ? '✓ مرفوع مسبقًا (اختر ملف جديد لاستبداله)' : '';
}

function openApply(m = null) {
  fa.reset();
  $$('input[name=kind]', fa).forEach(r => { r.checked = r.value === (m?.kind || 'store'); });
  syncKind();
  coords = m?.lat != null ? { lat: m.lat, lng: m.lng } : null;
  $('#loc-state').textContent = coords ? '✓ الموقع محدد مسبقًا' : 'اضغطه وأنت داخل المحل، عشان يظهر للمشترين القريبين.';
  $('#apply-title').textContent = m ? 'تعديل طلبك' : 'بيانات متجرك';
  $('#apply-btn').textContent = m ? 'حفظ وإعادة الإرسال' : 'إرسال الطلب للمراجعة';
  const note = $('#apply-note');
  note.hidden = !(m?.status === 'rejected' && m.review_note);
  note.textContent = m?.review_note ? 'ملاحظة المراجعة: ' + m.review_note : '';
  if (m) {
    for (const k of ['owner_name', 'store_name', 'activity', 'phone', 'city', 'district', 'national_address', 'cr_number', 'vat_number', 'bank_name', 'id_number', 'license_number']) fa[k].value = m[k] ?? '';
    $$('input[name=next_plan]', fa).forEach(r => { r.checked = r.value === (m.next_plan || 'basic'); });
    fa.yearly.checked = m.billing === 'yearly';
    fa.iban.value = (m.iban || '').replace(/(.{4})/g, '$1 ').trim();
    fa.no_vat.checked = !m.vat_registered;
    if (fa.contact_phone) fa.contact_phone.value = m.contact_phone ?? '';
  }
  $('#vat-fields').hidden = fa.no_vat.checked;
  setExisting('cr', m?.cr_path); setExisting('vat', m?.vat_path); setExisting('iban', m?.iban_path);
  setExisting('id', m?.id_path); setExisting('extra', m?.extra_docs?.length ? 'x' : null);
  $('#apply-err').textContent = '';
  show('v-apply');
}

function checkFile(f, label) {
  if (!f) return null;
  if (f.size > 5 * 1024 * 1024) return `${label}: الحجم أكبر من 5 ميجا.`;
  if (!(f.type === 'application/pdf' || f.type.startsWith('image/'))) return `${label}: ارفع PDF أو صورة.`;
  return null;
}

fa.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#apply-err'), btn = $('#apply-btn');
  const v = n => fa[n].value.trim();
  const kind = kindOf(), person = kind !== 'store';
  const vatReg = !person && !fa.no_vat.checked;
  const files = { cr: person ? null : fa.cr_file.files[0], vat: fa.vat_file.files[0], iban: fa.iban_file.files[0], id: person ? fa.id_file.files[0] : null };
  const extras = person ? [...fa.extra_files.files] : [];
  const iban = clean(fa.iban.value);
  const problems = [];
  if (v('owner_name').length < 2) problems.push('اكتب اسمك الكامل.');
  if (v('store_name').length < 2) problems.push(person ? 'اكتب اسم مشروعك.' : 'اكتب اسم المحل.');
  if (v('activity').length < 2 || v('activity').length > 40) problems.push('اكتب نشاطك (من حرفين إلى 40 حرف).');
  else if (['أخرى', 'أنشطة أخرى', OTHER_ACTIVITY].includes(v('activity'))) problems.push('اكتب اسم نشاطك الفعلي بدل «أنشطة أخرى»، مثل: ورشة سيارات.');
  if (!valid.phone(v('phone'))) problems.push('رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (fa.contact_phone && !valid.phone(v('contact_phone'))) problems.push('رقم واتساب التواصل مع المشترين يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (!v('city')) problems.push('اكتب المدينة.');
  if (!valid.nationalAddress(v('national_address'))) problems.push('العنوان الوطني المختصر 4 حروف إنجليزية و4 أرقام، مثل RRRD2929.');
  if (!person && !valid.cr(v('cr_number'))) problems.push('رقم السجل التجاري 10 أرقام.');
  if (!person && !files.cr && !merchant?.cr_path) problems.push('ارفع صورة السجل التجاري.');
  if (person && !valid.nid(v('id_number'))) problems.push('رقم الهوية أو الإقامة 10 أرقام يبدأ بـ 1 أو 2.');
  if (person && !files.id && !merchant?.id_path) problems.push('ارفع صورة الهوية.');
  if (person && !coords) problems.push(kind === 'family' ? 'حدّد موقع البيت (ما يظهر للزبون بالضبط).' : 'حدّد مكان وقوفك المعتاد.');
  if (extras.length > 5) problems.push('المستندات الإضافية 5 ملفات كحد أقصى.');
  extras.forEach((f, i) => { const p = checkFile(f, `المستند الإضافي ${i + 1}`); if (p) problems.push(p); });
  if (vatReg && !valid.vat(v('vat_number'))) problems.push('الرقم الضريبي 15 رقم يبدأ وينتهي بـ 3.');
  if (vatReg && !files.vat && !merchant?.vat_path) problems.push('ارفع الشهادة الضريبية، أو اختر «غير مسجلة في الضريبة».');
  if (!v('bank_name')) problems.push('اكتب اسم البنك.');
  if (!valid.iban(iban)) problems.push('رقم الآيبان غير صحيح. يبدأ بـ SA ومكوّن من 24 خانة.');
  if (!files.iban && !merchant?.iban_path) problems.push('ارفع شهادة الآيبان.');
  for (const [k, l] of [['cr', 'السجل التجاري'], ['vat', 'الشهادة الضريبية'], ['iban', 'شهادة الآيبان'], ['id', 'صورة الهوية']]) {
    const p = checkFile(files[k], l); if (p) problems.push(p);
  }
  if (!fa.agree.checked) problems.push('وافق على الإقرار والشروط.');
  if (problems.length) { err.textContent = problems.join(' '); return; }
  err.textContent = '';

  setBusy(btn, true, 'جارِ رفع المستندات…');
  try {
    const paths = {};
    for (const k of ['cr', 'vat', 'iban', 'id']) {
      const f = files[k];
      if (!f || (k === 'vat' && !vatReg)) continue;
      const path = `${user.id}/${k}-${Date.now()}.${fileExt(f)}`;
      const { error } = await sb.storage.from('merchant-docs').upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) throw error;
      paths[k] = path;
    }
    let extra_docs = merchant?.extra_docs || [];
    if (extras.length) {
      extra_docs = [];
      for (const [i, f] of extras.entries()) {
        const path = `${user.id}/extra-${Date.now()}-${i}.${fileExt(f)}`;
        const { error } = await sb.storage.from('merchant-docs').upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (error) throw error;
        extra_docs.push(path);
      }
    }
    btn.textContent = 'جارِ الإرسال…';
    const row = {
      id: user.id, email: user.email,
      owner_name: v('owner_name'), store_name: v('store_name'), activity: v('activity').replace(/\s+/g, ' '),
      phone: v('phone'), contact_phone: fa.contact_phone ? v('contact_phone') : undefined, city: v('city'), district: v('district') || null, national_address: v('national_address'),
      lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      kind,
      cr_number: person ? null : v('cr_number'),
      id_number: person ? v('id_number') : null,
      license_number: person ? (v('license_number') || null) : null,
      id_path: person ? (paths.id ?? merchant?.id_path ?? null) : null,
      extra_docs: person ? extra_docs : [],
      vat_registered: vatReg, vat_number: vatReg ? v('vat_number') : null,
      bank_name: v('bank_name'), iban,
      next_plan: fa.querySelector('input[name=next_plan]:checked')?.value || 'basic',
      billing: fa.yearly.checked ? 'yearly' : 'monthly',
      cr_path: person ? null : (paths.cr ?? merchant?.cr_path),
      vat_path: vatReg ? (paths.vat ?? merchant?.vat_path ?? null) : null,
      iban_path: paths.iban ?? merchant?.iban_path,
    };
    if (!merchant && REF && /^[A-Z0-9]{2,8}$/.test(REF)) row.rep_code = REF;
    const q = merchant ? sb.from('merchants').update(row).eq('id', user.id) : sb.from('merchants').insert(row);
    const { error } = await q;
    if (error) throw error;
    toast(merchant ? 'تم حفظ التعديلات وإرسالها للمراجعة.' : 'تم إرسال طلبك ✓');
    routedFor = undefined; await route();
  } catch (ex) {
    err.textContent = friendlyError(ex);
  } finally { setBusy(btn, false); }
});

// ---------------- لوحة المتجر ----------------
const imgUrl = p => p ? sb.storage.from('product-images').getPublicUrl(p).data.publicUrl : null;
let pendingIds = new Set(), approvals = [], team = [];

function setCtx(id) {
  if (merchant && id === merchant.id) {
    ctx = { mid: id, owner: true, perms: new Set(['inventory', 'prices']), needs: false, store: merchant.store_name };
  } else {
    const s = stores.find(x => x.merchant_id === id) || stores[0];
    ctx = { mid: s.merchant_id, owner: false, perms: new Set(s.perms), needs: s.needs_approval, store: s.store_name, role: s.role };
  }
  store.set('tah-store', ctx.mid);
}

async function openDash(id) {
  setCtx(id); pendingIds = new Set();
  $('#d-store').textContent = ctx.store;
  const badge = $('#d-badge');
  if (ctx.owner) {
    badge.textContent = 'مفعّل'; badge.className = 'badge approved';
    $('#d-plan').textContent = (merchant.kind && merchant.kind !== 'store' ? `${KIND_ICON[merchant.kind]} ${KINDS[merchant.kind]} · ` : '')
      + (merchant.plan === 'free' ? `مجانية ${merchant.trial_months || 3} أشهر` + (merchant.founder ? ' ⭐' : '') : 'باقة ' + planLabel(merchant.plan, merchant.billing)
      + (PLAN_NOTE[merchant.plan] || ''))
      + (merchant.license_verified_at ? ' · 🏅 موثّق برخصة' : '');
    renderTrial();
    renderLive();
  } else {
    badge.textContent = ROLES[ctx.role] || 'موظف'; badge.className = 'badge pending';
    $('#d-plan').textContent = 'أنت موظف في هذا المتجر';
    $('#trial').hidden = true;
    $('#live').hidden = true;
  }
  renderContactCard();
  renderIbans();
  loadLinkCard();
  // مبدّل المتاجر: متجري + المتاجر اللي أنا موظف فيها
  const sw = $('#d-switch'), opts = [];
  if (merchant) opts.push(new Option(merchant.status === 'approved' ? `متجري: ${merchant.store_name}` : `متجري (${STATUS[merchant.status]})`, merchant.id));
  stores.forEach(s => opts.push(new Option(`${s.store_name} · ${ROLES[s.role] || 'موظف'}`, s.merchant_id)));
  if (!merchant) opts.push(new Option('＋ سجّل متجرك الخاص', 'new'));
  sw.replaceChildren(...opts); sw.value = ctx.mid;
  $('#d-switch-wrap').hidden = opts.length < 2;

  $$('#d-tabs [data-owner]').forEach(b => { b.hidden = !ctx.owner; });
  $$('#d-tabs [data-staff]').forEach(b => { b.hidden = !viaApproval(); });
  $('#add').hidden = !canInv();
  const direct = ctx.owner || (canInv() && !ctx.needs);
  $('#csv-wrap').hidden = !direct; $('#csv-tpl').hidden = !direct;
  const note = $('#staff-note');
  note.hidden = ctx.owner;
  if (!ctx.owner) {
    const can = [canInv() && 'إضافة المنتجات وتعديل الكميات', canPrice() && 'تعديل الأسعار'].filter(Boolean).join(' و');
    note.textContent = `صلاحياتك: ${can || 'عرض فقط'}.` + (ctx.needs ? ' كل تعديل تسويه يوصل لصاحب المتجر ويظهر بعد موافقته.' : '');
  }
  selectTab('products');
  show('v-dash');
  await loadProducts();
  if (ctx.owner) loadApprovals(); else if (viaApproval()) loadMine();
}

$('#d-switch').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'new') return openApply();
  if (merchant && v === merchant.id && merchant.status !== 'approved') return showStatus();
  openDash(v);
});

function selectTab(name) {
  $$('#d-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const t of ['products', 'approvals', 'mine', 'team', 'settings']) $('#p-' + t).hidden = t !== name;
  if (name === 'settings') loadSettings();
  if (name === 'approvals') loadApprovals();
  if (name === 'mine') loadMine();
  if (name === 'team') loadTeam();
}
$$('#d-tabs [role=tab]').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));

const WA_NUMBER = '966555606635';
// مراحل الباقة: waiting / trial / trial_ended / basic / lapsed / paid (تاريخ النهاية الفاضي = بلا نهاية)
function planStage(m) {
  const now = new Date();
  if (m.plan === 'free') {
    const t = trialInfo(m);
    return { stage: t.state === 'waiting' ? 'waiting' : t.state === 'active' ? 'trial' : 'trial_ended', t };
  }
  if (m.plan === 'basic') {
    const until = m.basic_until ? new Date(m.basic_until) : null;
    return !until || until > now ? { stage: 'basic', until } : { stage: 'lapsed' };
  }
  const until = m.paid_until ? new Date(m.paid_until) : null;
  return !until || until > now ? { stage: 'paid', until } : { stage: 'lapsed' };
}
const daysLeft = d => Math.max(0, Math.ceil((d - Date.now()) / 864e5));

function renderTrial() {
  const box = $('#trial'), st = planStage(merchant), stage = st.stage, mobile = merchant.kind === 'mobile';
  box.hidden = false;
  box.classList.toggle('ended', stage === 'lapsed' || stage === 'trial_ended');
  $$('#trial-next [data-kind]').forEach(o => { o.hidden = o.disabled = (merchant.kind || 'store') === 'store'; });
  $$('#trial-next [data-basic]').forEach(o => { o.hidden = o.disabled = mobile; });
  $('#trial-next').value = (merchant.next_plan || 'basic') + (merchant.billing === 'yearly' && merchant.next_plan !== 'basic' ? ':yearly' : '');
  $('.t-pick', box).hidden = stage === 'paid';
  const after = mobile ? 'اشتراك «أسر ومتجولين»' : '3 أشهر على الباقة الأساسية (10 منتجات) ثم اشتراك';
  const title = $('#trial-title'), sub = $('#trial-sub');
  if (stage === 'waiting') {
    const n = merchant.trial_months || 3, months = n === 3 ? '3 أشهر' : n === 6 ? '6 أشهر' : n + ' أشهر';
    title.textContent = `${months} مفتوحة بكل المزايا` + (merchant.founder ? ' ⭐ عرض المؤسسين' : '');
    sub.textContent = `تبدأ من يوم إطلاق التطبيق للمشترين، وقبلها كل شيء مجاني. بعدها ${after}. أضف منتجاتك الحين عشان تكون جاهز من أول يوم.`;
  } else if (stage === 'trial') {
    title.textContent = `باقي ${st.t.days} يوم على الفترة المفتوحة`;
    sub.textContent = `تنتهي ${fmtDay(st.t.end)}. بعدها ${after}.`;
  } else if (stage === 'trial_ended') {
    title.textContent = 'انتهت الفترة المفتوحة';
    sub.textContent = 'ننقل حسابك للمرحلة التالية خلال يوم.';
  } else if (stage === 'basic') {
    title.textContent = 'أنت في الفترة الأساسية المجانية';
    sub.textContent = '10 منتجات، بدون عروض أو توصيل أو موظفين.' + (st.until
      ? ` تنتهي ${fmtDay(st.until)} (باقي ${daysLeft(st.until)} يوم)، وبعدها لازم الاشتراك عشان يستمر ظهور متجرك.` : '');
  } else if (stage === 'lapsed') {
    title.textContent = 'انتهت فترتك المجانية';
    sub.textContent = 'متجرك غير ظاهر للمشترين حاليًا، ومنتجاتك وبياناتك محفوظة. تفعيل الاشتراك يرجعه فورًا.';
  } else {
    title.textContent = `باقتك ${planLabel(merchant.plan, merchant.billing)} مفعّلة`;
    sub.textContent = st.until ? `حتى ${fmtDay(st.until)} (باقي ${daysLeft(st.until)} يوم).` : 'بدون تاريخ انتهاء محدد.';
  }
  const badge = $('#d-badge');
  if (badge && stage === 'lapsed') { badge.textContent = 'غير ظاهر للمشترين'; badge.className = 'badge rejected'; }
  const wa = $('#trial-wa');
  if (wa) {
    wa.hidden = !['basic', 'lapsed', 'trial_ended'].includes(stage);
    const planName = merchant.next_plan && merchant.next_plan !== 'basic' ? 'باقة ' + planLabel(merchant.next_plan, merchant.billing) + ' ' : '';
    wa.href = `https://wa.me/${WA_NUMBER}?text=` + encodeURIComponent(`السلام عليكم، أبغى أفعّل اشتراك ${planName}لمتجري «${merchant.store_name}» في تحصّله.`);
  }
}
$('#trial-save').addEventListener('click', async e => {
  const btn = e.currentTarget, p = $('#trial-next').value;
  setBusy(btn, true);
  const [plan, cycle] = p.split(':');
  const { error } = await sb.rpc('set_plan_choice', { p: plan, b: cycle || 'monthly' });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  merchant.next_plan = plan; merchant.billing = cycle || 'monthly'; renderTrial(); toast('تم حفظ اشتراكك المختار: ' + planLabel(plan, merchant.billing));
});

async function loadProducts() {
  const { data, error } = await sb.from('products').select('*').eq('merchant_id', ctx.mid).order('created_at', { ascending: false });
  if (error) { toast(friendlyError(error)); return; }
  products = data;
  $('#cats').replaceChildren(...[...new Set(products.map(p => p.category).filter(Boolean))].map(c => new Option(c)));
  render();
}

function renderLimit() {
  const el = $('#limit-hint');
  if (!el) return;
  const lim = ctx?.owner && merchant ? PLAN_LIMITS[merchant.plan] : null;
  const used = products.filter(p => p.is_active).length;
  el.hidden = !lim || used < lim * 0.8;
  if (el.hidden) return;
  el.textContent = used >= lim
    ? `وصلت حد باقتك: ${used} من ${lim} منتج ظاهر. لإضافة المزيد رقّ باقتك أو أخفِ بعض المنتجات.`
    : `عندك ${used} من ${lim} منتج ظاهر، وتقترب من حد باقتك.`;
}

const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

function render() {
  renderLimit();
  const q = $('#q').value.trim().toLowerCase();
  const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.category || '').toLowerCase().includes(q));
  $('#s-total').textContent = products.length;
  $('#s-active').textContent = products.filter(p => p.is_active && p.quantity > 0).length;
  $('#s-low').textContent = products.filter(p => p.quantity <= 2).length;
  const box = $('#plist');
  if (!products.length) {
    box.innerHTML = canInv()
      ? '<div class="empty"><b>ما فيه منتجات بعد</b><br>ابدأ بـ «إضافة منتج» وصوّر المنتج أو امسح الباركود' + ($('#csv-wrap').hidden ? '.' : '، أو ارفع ملف CSV فيه كل المنتجات دفعة وحدة.') + '</div>'
      : '<div class="empty">ما فيه منتجات في المتجر بعد.</div>';
    return;
  }
  if (!list.length) { box.innerHTML = '<div class="empty">ما فيه نتائج لبحثك.</div>'; return; }
  box.replaceChildren(...list.map(p => {
    const el = mk('article', 'prod' + (p.is_active ? '' : ' off'));
    const url = imgUrl(p.image_path);
    const pic = url ? Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' }) : mk('div', 'ph', p.name.trim()[0] || '؟');
    const mid = mk('div'); mid.style.minWidth = '0';
    const m = mk('div', 'm num');
    const price = mk('span');
    if (p.sale_price != null) { price.append(mk('b', '', money(p.sale_price)), ' ', mk('s', '', money(p.price))); }
    else price.append(mk('b', '', money(p.price)));
    const qty = mk('span', p.quantity <= 2 ? 'low' : '', p.quantity > 0 ? `الكمية ${p.quantity}` : 'نفد');
    m.append(price, qty);
    if (p.category) m.append(mk('span', '', p.category));
    if (p.preorder_hours) m.append(mk('span', '', '🕒 طلب مسبق ' + (p.preorder_hours >= 24 ? `${p.preorder_hours / 24 === 1 ? 'يوم' : p.preorder_hours / 24 === 2 ? 'يومين' : p.preorder_hours / 24 + ' أيام'}` : `${p.preorder_hours} ساعات`)));
    if (!p.is_active) m.append(mk('span', '', 'مخفي'));
    if (p.sale_price != null) m.append(mk('span', 'low', '🏷️ ' + (OFFER_REASONS[p.offer_reason] || 'عرض') + (p.offer_ends_at ? ' · ينتهي ' + fmtDay(p.offer_ends_at) : '')));
    const dLeft = p.expires_on ? Math.ceil((new Date(p.expires_on + 'T23:59:59') - Date.now()) / 864e5) : null;
    if (dLeft != null) m.append(mk('span', dLeft <= 7 ? 'low' : '', dLeft < 0 ? 'منتهي الصلاحية' : dLeft <= 7 ? `⚠️ تنتهي صلاحيته خلال ${dLeft} يوم${p.sale_price == null ? ' — سوّ عليه عرض' : ''}` : 'الصلاحية ' + fmtDay(p.expires_on)));
    if (pendingIds.has(p.id)) m.append(mk('span', 'low', '⏳ تعديل بانتظار الموافقة'));
    mid.append(mk('div', 'n', p.name), m);
    const acts = mk('div', 'acts');
    if (canInv()) {
      const minus = mk('button', 'btn ghost sm', '−1'); minus.title = 'إنقاص الكمية';
      const plus = mk('button', 'btn ghost sm', '+1'); plus.title = 'زيادة الكمية';
      minus.disabled = p.quantity <= 0;
      minus.onclick = () => bump(p, -1); plus.onclick = () => bump(p, 1);
      acts.append(minus, plus);
    }
    if (canInv() || canPrice()) { const edit = mk('button', 'btn ghost sm', 'تعديل'); edit.onclick = () => openProduct(p); acts.append(edit); }
    el.append(pic, mid, acts);
    return el;
  }));
}
$('#q').addEventListener('input', render);

// كل الكتابة على المنتجات تمر من هنا: مباشرة، أو طلب ينتظر موافقة صاحب المتجر
const FIELDS = ['name', 'price', 'sale_price', 'quantity', 'category', 'barcode', 'description', 'image_path', 'is_active', 'offer_reason', 'offer_ends_at', 'expires_on'];
function changed(p, row) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in row)) continue;
    const a = p[k] ?? null, b = row[k] ?? null;
    if (k === 'offer_ends_at') { if ((a ? new Date(a).getTime() : null) !== (b ? new Date(b).getTime() : null)) out[k] = b; continue; }
    const same = typeof a === 'number' || typeof b === 'number' || ['price', 'sale_price'].includes(k) ? (a == null ? b == null : b != null && Number(a) === Number(b)) : a === b;
    if (!same) out[k] = b;
  }
  return out;
}
async function writeProduct(action, p, row = {}) {
  if (viaApproval()) {
    const payload = action === 'update' ? changed(p, row) : action === 'insert' ? row : {};
    if (action === 'update' && !Object.keys(payload).length) return 'same';
    const { error } = await sb.from('product_changes').insert({ merchant_id: ctx.mid, action, product_id: p?.id ?? null, payload });
    if (error) throw error;
    if (p) pendingIds.add(p.id);
    loadMine();
    return 'queued';
  }
  const q = action === 'insert' ? sb.from('products').insert({ ...row, merchant_id: ctx.mid })
    : action === 'update' ? sb.from('products').update(row).eq('id', p.id)
    : sb.from('products').delete().eq('id', p.id);
  const { error } = await q;
  if (error) throw error;
  return 'done';
}
const QUEUED = 'أُرسل لصاحب المتجر للموافقة ✓';

async function bump(p, d) {
  const qn = Math.max(0, p.quantity + d);
  try {
    const r = await writeProduct('update', p, { quantity: qn });
    if (r === 'queued') { toast(QUEUED); render(); return; }
    p.quantity = qn; render();
  } catch (ex) { toast(friendlyError(ex)); }
}

// ---------------- نافذة المنتج ----------------
const dlg = $('#dlg'), fp = $('#f-prod');
$('#add').addEventListener('click', () => openProduct(null));
$('#cancel').addEventListener('click', () => dlg.close());
const aiState = (t) => { const el = $('#ai-state'); el.hidden = !t; el.textContent = t || ''; };

function openProduct(p) {
  if (dlg.open) dlg.close();
  editing = p;
  fp.reset();
  $('#dlg-title').textContent = p ? 'تعديل منتج' : 'منتج جديد';
  $('#del').hidden = !p || !canInv();
  $('.err', fp).textContent = '';
  aiState(''); $('#cam-prev').hidden = true;
  if (p) {
    for (const k of ['name', 'price', 'sale_price', 'quantity', 'category', 'barcode', 'description', 'offer_reason', 'expires_on']) fp[k].value = p[k] ?? '';
    fp.offer_ends_at.value = p.offer_ends_at ? new Date(p.offer_ends_at).toLocaleDateString('en-CA') : '';
    fp.is_active.checked = p.is_active;
    fp.preorder_hours.value = p.preorder_hours ?? '';
  }
  $('#preorder-row').hidden = viaApproval();
  fp.preorder_hours.disabled = !canInv();
  syncOffer();
  const box = $('.file[data-file="img"]', fp);
  box.dataset.existing = p?.image_path ? '1' : '';
  box.classList.toggle('has', !!p?.image_path);
  $('.cur', box).textContent = p?.image_path ? '✓ فيه صورة (اختر صورة جديدة لاستبدالها)' : '';
  // الحقول حسب الصلاحية
  const inv = canInv(), pr = canPrice() || !p;
  for (const k of ['name', 'quantity', 'category', 'barcode', 'description', 'image', 'is_active']) fp[k].disabled = !inv;
  for (const k of ['price', 'sale_price', 'offer_reason', 'offer_ends_at']) fp[k].disabled = !pr;
  fp.expires_on.disabled = !inv;
  $('#capture').hidden = !inv;
  $('#save').textContent = viaApproval() ? 'إرسال للموافقة' : 'حفظ';
  if (viaApproval()) aiState('تعديلك يوصل لصاحب المتجر ويظهر بعد موافقته.');
  dlg.showModal();
  (inv ? fp.name : fp.price).focus();
}

// يقرأ الأرقام بالعربي والإنجليزي مع فواصل الآلاف: «1,200» = 1200 و«1,250.50» = 1250.5 و«٩٫٥» = 9.5
// فاضي = null، وغير صالح = NaN (والفحوصات اللي بعده ترفضه)
const num = s => {
  let t = digits(s).replace(/[\s ٬]/g, '').replace(/٫/g, '.');
  if (t === '') return null;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // الفاصل الأخير هو العشري، والثاني فاصل آلاف
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // «1,200» أو «1,200,000» = آلاف، غير كذا الفاصلة عشرية («9,5»)
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  }
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

fp.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fp), btn = $('#save');
  const price = num(fp.price.value), sale = num(fp.sale_price.value), qty = num(fp.quantity.value);
  if (fp.name.value.trim().length < 2) return (err.textContent = 'اكتب اسم المنتج.');
  if (price == null || !(price >= 0)) return (err.textContent = 'اكتب سعر صحيح.');
  if (sale != null && !(sale >= 0 && sale < price)) return (err.textContent = 'سعر العرض لازم يكون أقل من السعر الأصلي.');
  if (qty == null || !Number.isInteger(qty) || qty < 0) return (err.textContent = 'الكمية رقم صحيح من 0 وفوق.');
  err.textContent = ''; setBusy(btn, true, 'جارِ الحفظ…');
  let oldImage = null, newImage = null;   // القديمة تنحذف بعد نجاح الحفظ فقط، والجديدة تنحذف لو فشل
  try {
    let image_path = editing?.image_path ?? null;
    const file = fp.image.files[0];
    if (file && canInv()) {
      const small = await shrinkImage(file);
      if (small.size > 2 * 1024 * 1024) throw new Error('الصورة كبيرة جدًا، اختر صورة أصغر من 2 ميجا.');
      const path = `${ctx.mid}/${crypto.randomUUID()}.${small.type === 'image/webp' ? 'webp' : fileExt(small)}`;
      const { error } = await sb.storage.from('product-images').upload(path, small, { contentType: small.type });
      if (error) throw error;
      newImage = path;
      if (image_path && !viaApproval()) oldImage = image_path;
      image_path = path;
    }
    const offer = sale == null ? { offer_reason: null, offer_ends_at: null } : {
      offer_reason: fp.offer_reason.value || null,
      offer_ends_at: fp.offer_ends_at.value ? new Date(fp.offer_ends_at.value + 'T23:59:59').toISOString() : null,
    };
    if (offer.offer_ends_at && new Date(offer.offer_ends_at) < new Date()) throw new Error('تاريخ نهاية العرض لازم يكون اليوم أو بعده.');
    const row = canInv() ? {
      name: fp.name.value.trim(), price, sale_price: sale, quantity: qty,
      category: fp.category.value.trim() || null, barcode: digits(fp.barcode.value).trim() || null,
      description: fp.description.value.trim() || null, is_active: fp.is_active.checked, image_path,
      expires_on: fp.expires_on.value || null, ...offer,
    } : { price, sale_price: sale, ...offer };
    if (canInv() && !viaApproval()) row.preorder_hours = fp.preorder_hours.value ? Number(fp.preorder_hours.value) : null;
    if (editing && !canPrice()) { delete row.price; delete row.sale_price; delete row.offer_reason; delete row.offer_ends_at; }
    const r = await writeProduct(editing ? 'update' : 'insert', editing, row);
    if (oldImage) sb.storage.from('product-images').remove([oldImage]);
    dlg.close();
    toast(r === 'queued' ? QUEUED : r === 'same' ? 'ما فيه تغيير.' : editing ? 'تم حفظ التعديل.' : 'تمت إضافة المنتج.');
    await loadProducts();
  } catch (ex) {
    if (newImage) sb.storage.from('product-images').remove([newImage]);
    err.textContent = friendlyError(ex);
  }
  finally { setBusy(btn, false); }
});

$('#del').addEventListener('click', async () => {
  if (!editing || !confirm(viaApproval() ? `طلب حذف «${editing.name}»؟ يُحذف بعد موافقة صاحب المتجر.` : `حذف «${editing.name}» نهائيًا؟`)) return;
  try {
    const r = await writeProduct('delete', editing);
    if (r === 'done' && editing.image_path) sb.storage.from('product-images').remove([editing.image_path]);
    dlg.close(); toast(r === 'queued' ? QUEUED : 'تم حذف المنتج.'); await loadProducts();
  } catch (ex) { toast(friendlyError(ex)); }
});

// ---------------- الكاميرا والتعرّف على المنتج ----------------
let aiOff = false;
async function toJpegBase64(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}
const fillEmpty = (k, v) => { if (v && !fp[k].value.trim() && !fp[k].disabled) fp[k].value = v; };

$('#cam').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const dt = new DataTransfer(); dt.items.add(f);
  fp.image.files = dt.files; fp.image.dispatchEvent(new Event('change'));
  const prev = $('#cam-prev'); prev.src = URL.createObjectURL(f); prev.hidden = false;
  if (aiOff) return aiState('✓ انضافت الصورة للمنتج. عبّئ البيانات أو امسح الباركود.');
  aiState('🤖 جارِ التعرّف على المنتج من الصورة…');
  try {
    const image = await toJpegBase64(f);
    let { data, error } = await sb.functions.invoke('recognize', { body: { merchant_id: ctx.mid, image, media_type: 'image/jpeg' } });
    if (error) { try { data = await error.context.json(); } catch { throw error; } }
    if (data?.error === 'not_configured') { aiOff = true; return aiState('✓ انضافت الصورة للمنتج. التعرّف التلقائي بالذكاء الاصطناعي يتفعّل قريبًا، عبّئ البيانات يدويًا أو امسح الباركود.'); }
    if (data?.error === 'limit') return aiState('وصلت الحد اليومي للتعرّف التلقائي. الصورة انضافت، عبّئ البيانات يدويًا.');
    if (data?.error) throw new Error(data.error);
    const r = data?.result;
    if (!r?.recognized) return aiState('ما قدرنا نتعرّف على المنتج من الصورة. جرّب صورة أوضح للغلاف، أو امسح الباركود.');
    fillEmpty('name', r.name); fillEmpty('category', r.category); fillEmpty('description', r.description);
    if (/^\d{8,14}$/.test(String(r.barcode || ''))) fillEmpty('barcode', String(r.barcode));
    aiState(`✓ تعرّفنا عليه: ${r.name}` + (r.estimatedPriceSar > 0 ? ` · سعره التقريبي في السوق ${money(r.estimatedPriceSar)}` : '') + '. راجع البيانات وحط سعرك قبل الحفظ.');
  } catch (ex) { aiState('الصورة انضافت، لكن التعرّف التلقائي ما اشتغل الحين: ' + friendlyError(ex)); }
});

// ---------------- مسح الباركود ----------------
const dlgScan = $('#dlg-scan'), video = $('#scan-video');
let scanCb = null, scanStop = null;
const scanState = t => { $('#scan-state').textContent = t; };
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

async function scan(cb) {
  scanCb = cb; $('#scan-manual').value = '';
  scanState('جارِ تشغيل الكاميرا…');
  dlgScan.showModal();
  try {
    if ('BarcodeDetector' in window) {
      const supported = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      let on = true;
      scanStop = () => { on = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
      const tick = async () => {
        if (!on) return;
        try { const r = await det.detect(video); if (r[0]?.rawValue) return done(r[0].rawValue); } catch {}
        setTimeout(tick, 180);
      };
      tick();
    } else {
      const { BrowserMultiFormatReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, res => { if (res) done(res.getText()); });
      scanStop = () => controls.stop();
    }
    scanState('وجّه الكاميرا على الباركود وقرّبها لين يوضح.');
  } catch {
    scanState('ما قدرنا نشغّل الكاميرا. اسمح للمتصفح باستخدامها، أو اكتب رقم الباركود تحت.');
  }
}
function stopScan() { const s = scanStop; scanStop = null; if (s) s(); }
function done(code) {
  const cb = scanCb; scanCb = null; stopScan();
  if (dlgScan.open) dlgScan.close();
  if ('vibrate' in navigator) navigator.vibrate(60);
  cb?.(normBarcode(code));
}
// باركود GS1 (مثل اللي على أكياس الرز): نطلع رقم المنتج GTIN بعد المعرّف 01
function normBarcode(code) {
  let d = digits(code).replace(/\D/g, '');
  if (d.length > 14 && d.startsWith('01')) d = d.slice(2, 16);
  if (d.length === 14 && d.startsWith('0')) d = d.slice(1);
  return d;
}
dlgScan.addEventListener('close', stopScan);
$('#scan-close').addEventListener('click', () => dlgScan.close());
$('#scan-ok').addEventListener('click', () => {
  const v = normBarcode($('#scan-manual').value);
  if (v.length < 6) return scanState('اكتب رقم الباركود كامل.');
  done(v);
});

async function lookupBarcode(code) {
  if (!/^\d{8,14}$/.test(code)) return;
  const own = products.find(p => p.barcode === code && p.id !== editing?.id);
  if (own) {
    if (confirm(`«${own.name}» مسجّل عندك بنفس الباركود. تفتحه للتعديل؟`)) openProduct(own);
    return;
  }
  if (fp.name.value.trim()) return;
  aiState('جارِ البحث عن الباركود…');
  let hit = null;
  const { data } = await sb.rpc('barcode_lookup', { code });
  if (data?.[0]) hit = data[0];
  if (!hit) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name_ar,product_name,brands,quantity`);
      const j = await r.json();
      if (j.status === 1) {
        const pr = j.product, name = pr.product_name_ar || pr.product_name || '';
        const brand = (pr.brands || '').split(',')[0].trim();
        hit = { name: [name, brand && !name.includes(brand) ? brand : '', pr.quantity || ''].filter(Boolean).join(' ').trim() };
      }
    } catch {}
  }
  if (hit?.name) {
    fillEmpty('name', hit.name); fillEmpty('category', hit.category); fillEmpty('description', hit.description);
    aiState(`✓ لقينا المنتج: ${hit.name}. راجع الاسم وحط سعرك وكميتك.`);
  } else aiState('ما لقينا بيانات لهذا الباركود. عبّئ البيانات يدويًا أو صوّر المنتج.');
}

$('#b-scan').addEventListener('click', () => scan(code => { fp.barcode.value = code; lookupBarcode(code); }));
fp.barcode.addEventListener('change', () => { fp.barcode.value = normBarcode(fp.barcode.value); lookupBarcode(fp.barcode.value); });
$('#q-scan').addEventListener('click', () => scan(code => {
  const p = products.find(x => x.barcode === code);
  if (p && (canInv() || canPrice())) return openProduct(p);
  if (!p && canInv()) { openProduct(null); fp.barcode.value = code; lookupBarcode(code); return; }
  $('#q').value = code; render();
  if (!p) toast('ما فيه منتج بهذا الباركود.');
}));

// ---------------- موافقات صاحب المتجر ----------------
const LABEL = { name: 'الاسم', price: 'السعر', sale_price: 'سعر العرض', quantity: 'الكمية', category: 'التصنيف', barcode: 'الباركود', description: 'الوصف', image_path: 'الصورة', is_active: 'الظهور', offer_reason: 'سبب العرض', offer_ends_at: 'نهاية العرض', expires_on: 'الصلاحية' };
const ACTION = { insert: 'إضافة منتج', update: 'تعديل', delete: 'حذف' };
const showVal = (k, v) => v == null || v === '' ? '—' : k === 'offer_reason' ? (OFFER_REASONS[v] || v) : ['offer_ends_at', 'expires_on'].includes(k) ? fmtDay(v) : k === 'is_active' ? (v ? 'ظاهر' : 'مخفي') : k === 'image_path' ? 'صورة جديدة' : ['price', 'sale_price'].includes(k) ? money(v) : String(v);

function changeCard(c, { owner }) {
  const p = products.find(x => x.id === c.product_id);
  const name = c.payload?.name || p?.name || 'منتج';
  const el = mk('div', 'row-card');
  const txt = mk('div');
  txt.append(mk('div', 't', `${ACTION[c.action]} · ${name}`));
  const meta = owner ? `من ${c.staff_label || 'موظف'} · ${fmtDay(c.created_at)}` : fmtDay(c.created_at);
  txt.append(mk('div', 's', meta));
  const diff = mk('div', 'diff');
  if (c.action !== 'delete') {
    for (const [k, v] of Object.entries(c.payload || {})) {
      if (!LABEL[k] || (c.action === 'insert' && (v == null || v === ''))) continue;
      const sp = mk('span'); sp.append(`${LABEL[k]}: `);
      if (c.action === 'update' && p) { sp.append(mk('s', '', showVal(k, p[k])), ' ← '); }
      sp.append(mk('b', '', showVal(k, v)));
      diff.append(sp);
    }
  }
  if (diff.childElementCount) txt.append(diff);
  if (c.payload?.image_path) { const im = Object.assign(document.createElement('img'), { src: imgUrl(c.payload.image_path), alt: '' }); im.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:8px;margin-top:6px'; txt.append(im); }
  if (!owner && c.status === 'rejected' && c.note) txt.append(mk('div', 's', 'سبب الرفض: ' + c.note));
  const acts = mk('div', 'acts');
  if (owner) {
    const ok = mk('button', 'btn primary sm', '✓ موافقة'), no = mk('button', 'btn ghost sm', '✕ رفض');
    ok.onclick = () => review(c, true, ok); no.onclick = () => review(c, false, no);
    acts.append(ok, no);
  } else {
    const st = { pending: ['pending', 'بانتظار الموافقة'], approved: ['approved', 'تمت الموافقة'], rejected: ['rejected', 'مرفوض'] }[c.status];
    acts.append(mk('span', 'badge ' + st[0], st[1]));
    if (c.status === 'pending') {
      const x = mk('button', 'btn ghost sm', 'إلغاء');
      x.onclick = async () => { const { error } = await sb.from('product_changes').delete().eq('id', c.id); if (error) return toast(friendlyError(error)); toast('تم إلغاء الطلب.'); loadMine(); loadProducts(); };
      acts.append(x);
    }
  }
  el.append(txt, acts);
  return el;
}

async function loadApprovals() {
  if (!ctx?.owner) return;
  const { data, error } = await sb.from('product_changes').select('*').eq('merchant_id', ctx.mid).eq('status', 'pending').order('created_at');
  if (error) return toast(friendlyError(error));
  approvals = data;
  const c = $('#c-approvals'); c.hidden = !approvals.length; c.textContent = approvals.length;
  const box = $('#appr-list');
  if (!approvals.length) { box.innerHTML = '<div class="empty">ما فيه تعديلات تنتظر موافقتك.</div>'; return; }
  const all = mk('button', 'btn ghost sm', `✓ موافقة على الكل (${approvals.length})`);
  all.style.justifySelf = 'start';
  all.onclick = async () => {
    if (!confirm(`الموافقة على ${approvals.length} تعديل؟`)) return;
    setBusy(all, true);
    for (const a of approvals) { const { error } = await sb.rpc('review_change', { change_id: a.id, approve: true }); if (error) toast(friendlyError(error)); }
    toast('تمت الموافقة ✓'); await loadProducts(); loadApprovals();
  };
  box.replaceChildren(...(approvals.length > 1 ? [all] : []), ...approvals.map(a => changeCard(a, { owner: true })));
}

async function review(c, approve, btn) {
  let reason = null;
  if (!approve) { reason = prompt('سبب الرفض (اختياري، يشوفه الموظف):', ''); if (reason === null) return; }
  setBusy(btn, true);
  const { error } = await sb.rpc('review_change', { change_id: c.id, approve, reason: reason || null });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast(approve ? 'تمت الموافقة وتحدّث المتجر ✓' : 'تم الرفض.');
  if (approve) await loadProducts();
  loadApprovals();
}

async function loadMine() {
  if (!viaApproval()) return;
  const { data, error } = await sb.from('product_changes').select('*').eq('merchant_id', ctx.mid).eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
  if (error) return toast(friendlyError(error));
  const pend = data.filter(c => c.status === 'pending');
  pendingIds = new Set(pend.map(c => c.product_id).filter(Boolean));
  const c = $('#c-mine'); c.hidden = !pend.length; c.textContent = pend.length;
  const box = $('#mine-list');
  box.replaceChildren(...(data.length ? data.map(x => changeCard(x, { owner: false })) : [Object.assign(mk('div', 'empty'), { textContent: 'ما أرسلت تعديلات بعد.' })]));
  render();
}

// ---------------- فريق المتجر ----------------
const dlgStaff = $('#dlg-staff'), fs = $('#f-staff');
let editingStaff = null;
const STAFF_STATUS = { invited: ['pending', 'بانتظار القبول'], active: ['approved', 'نشط'], suspended: ['suspended', 'موقوف'] };

async function loadTeam() {
  if (!ctx?.owner) return;
  const { data, error } = await sb.from('merchant_staff').select('*').eq('merchant_id', ctx.mid).order('invited_at');
  if (error) return toast(friendlyError(error));
  team = data;
  $('#t-add').disabled = team.length >= 10;
  const box = $('#team-list');
  if (!team.length) { box.innerHTML = '<div class="empty"><b>ما أضفت موظفين بعد</b><br>أضف موظفك بإيميله، ويدخل بحسابه الخاص بالصلاحيات اللي تحددها.</div>'; return; }
  box.replaceChildren(...team.map(s => {
    const el = mk('div', 'row-card');
    const txt = mk('div');
    const t = mk('div', 't', (s.name || s.email) + ' ');
    const st = STAFF_STATUS[s.status]; t.append(mk('span', 'badge ' + st[0], st[1]));
    const perms = [s.perms.includes('inventory') && 'المنتجات والكميات', s.perms.includes('prices') && 'الأسعار'].filter(Boolean).join(' + ');
    txt.append(t, mk('div', 's', `${s.email} · ${ROLES[s.role] || s.role} · ${perms}`),
      mk('div', 's', s.needs_approval ? '🔒 تعديلاته تحتاج موافقتك' : '✓ يعدّل مباشرة بدون موافقة'));
    const acts = mk('div', 'acts');
    const edit = mk('button', 'btn ghost sm', 'تعديل'); edit.onclick = () => openStaff(s);
    acts.append(edit);
    if (s.status !== 'invited') {
      const tg = mk('button', 'btn ghost sm', s.status === 'active' ? 'إيقاف' : 'تفعيل');
      tg.onclick = async () => {
        const { error } = await sb.from('merchant_staff').update({ status: s.status === 'active' ? 'suspended' : 'active' }).eq('id', s.id);
        if (error) return toast(friendlyError(error)); loadTeam();
      };
      acts.append(tg);
    }
    const rm = mk('button', 'btn danger sm', 'حذف');
    rm.onclick = async () => {
      if (!confirm(`حذف ${s.name || s.email} من الفريق؟`)) return;
      const { error } = await sb.from('merchant_staff').delete().eq('id', s.id);
      if (error) return toast(friendlyError(error)); toast('تم الحذف من الفريق.'); loadTeam();
    };
    acts.append(rm);
    el.append(txt, acts);
    return el;
  }));
}

function openStaff(s) {
  editingStaff = s; fs.reset();
  $('#staff-title').textContent = s ? 'تعديل الموظف' : 'إضافة موظف';
  $('#staff-save').textContent = s ? 'حفظ' : 'إرسال الدعوة';
  $('.err', fs).textContent = '';
  fs.email.disabled = !!s;
  if (s) {
    fs.name.value = s.name || ''; fs.email.value = s.email;
    fs.role.value = ROLE_PERMS[s.role] ? s.role : 'stock';
    fs.p_inventory.checked = s.perms.includes('inventory'); fs.p_prices.checked = s.perms.includes('prices');
    fs.needs_approval.checked = s.needs_approval;
  }
  dlgStaff.showModal(); (s ? fs.name : fs.name).focus();
}
$('#t-add').addEventListener('click', () => openStaff(null));
$('#staff-cancel').addEventListener('click', () => dlgStaff.close());
fs.role.addEventListener('change', () => {
  const p = ROLE_PERMS[fs.role.value] || [];
  fs.p_inventory.checked = p.includes('inventory'); fs.p_prices.checked = p.includes('prices');
});
fs.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fs), btn = $('#staff-save');
  const email = fs.email.value.trim().toLowerCase(), name = fs.name.value.trim();
  const perms = [fs.p_inventory.checked && 'inventory', fs.p_prices.checked && 'prices'].filter(Boolean);
  if (name.length < 2) return (err.textContent = 'اكتب اسم الموظف.');
  if (!editingStaff && !/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'اكتب إيميل صحيح.');
  if (!perms.length) return (err.textContent = 'اختر صلاحية وحدة على الأقل.');
  err.textContent = ''; setBusy(btn, true);
  const row = { name, role: fs.role.value, perms, needs_approval: fs.needs_approval.checked };
  const { error } = editingStaff
    ? await sb.from('merchant_staff').update(row).eq('id', editingStaff.id)
    : await sb.from('merchant_staff').insert({ ...row, email, merchant_id: ctx.mid });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  dlgStaff.close();
  toast(editingStaff ? 'تم حفظ التعديل.' : `أرسلنا دعوة إلى ${email} ✓`, 4500);
  loadTeam();
});

// ---------------- استيراد CSV ----------------
const TEMPLATE = '﻿الاسم,السعر,الكمية,سعر العرض,الباركود,التصنيف,الوصف\nمثال: شاحن سريع 20 واط,59,12,49,1234567890123,إكسسوارات جوال,\n';
$('#csv-tpl').href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(TEMPLATE);

const HEAD = {
  name: ['الاسم', 'اسم المنتج', 'المنتج', 'name'], price: ['السعر', 'price'], quantity: ['الكمية', 'quantity', 'qty'],
  sale_price: ['سعر العرض', 'sale_price', 'sale'], barcode: ['الباركود', 'barcode'], category: ['التصنيف', 'category'], description: ['الوصف', 'description'],
};

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

$('#csv').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return toast('الملف فاضي أو ما فيه صفوف منتجات.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(HEAD)) col[k] = head.findIndex(h => names.includes(h));
  if (col.name < 0 || col.price < 0) return toast('لازم يكون في الملف عمود «الاسم» وعمود «السعر». نزّل نموذج الملف.', 5000);

  const byBarcode = new Map(products.filter(p => p.barcode).map(p => [p.barcode, p]));
  const inserts = [], updates = [], bad = [];
  rows.slice(1).forEach((r, i) => {
    const g = k => col[k] >= 0 ? (r[col[k]] ?? '').trim() : '';
    const name = g('name'), price = num(g('price')), sale = num(g('sale_price')), qtyRaw = num(g('quantity')), qty = qtyRaw ?? 0, barcode = digits(g('barcode')) || null;
    if (name.length < 2 || price == null || !(price >= 0) || !Number.isInteger(qty) || qty < 0 || (sale != null && !(sale >= 0 && sale < price))) { bad.push(i + 2); return; }
    const ex = barcode && byBarcode.get(barcode);
    if (ex) {
      // تحديث منتج موجود: نغيّر فقط الأعمدة الموجودة في الملف، وما نلمس الباقي (الكمية، العرض، الوصف، التصنيف)
      const row = { name, price };
      if (col.quantity >= 0 && qtyRaw != null) row.quantity = qty;
      if (col.sale_price >= 0) row.sale_price = sale;
      if (col.category >= 0) row.category = g('category') || null;
      if (col.description >= 0) row.description = g('description') || null;
      updates.push({ id: ex.id, row });
    } else {
      inserts.push({ name, price, sale_price: sale, quantity: qty, barcode, category: g('category') || null, description: g('description') || null, merchant_id: ctx.mid, is_active: true });
    }
  });
  if (!inserts.length && !updates.length) return toast(`ما فيه صفوف صحيحة. راجع الصفوف: ${bad.slice(0, 10).join('، ')}`, 6000);
  if (!confirm(`إضافة ${inserts.length} منتج جديد وتحديث ${updates.length} منتج موجود (بنفس الباركود)؟` + (bad.length ? `\nسيتم تجاهل ${bad.length} صف فيه خطأ.` : ''))) return;

  toast('جارِ الاستيراد…');
  try {
    for (let i = 0; i < inserts.length; i += 200) {
      const { error } = await sb.from('products').insert(inserts.slice(i, i + 200));
      if (error) throw error;
    }
    for (let i = 0; i < updates.length; i += 10) {
      const res = await Promise.all(updates.slice(i, i + 10).map(u => sb.from('products').update(u.row).eq('id', u.id)));
      const fail = res.find(r => r.error); if (fail) throw fail.error;
    }
    toast(`تم ✓ أُضيف ${inserts.length} وتحدّث ${updates.length}` + (bad.length ? ` · تجاهلنا الصفوف: ${bad.slice(0, 8).join('، ')}` : ''), 6000);
  } catch (ex) { toast(friendlyError(ex), 6000); }
  await loadProducts();
});


// ---------------- العروض ----------------
function syncOffer() { $('#offer-row').hidden = !fp.sale_price.value.trim(); }
fp.sale_price.addEventListener('input', syncOffer);

// ---------------- التوصيل والاستلام ----------------
const fset = $('#f-settings');
const isPerson = () => !!(merchant?.kind && merchant.kind !== 'store');
// الأسر والمتنقلون: نقدًا أو تحويل على الحساب. المحلات: نقدًا أو بطاقة (في المحل أو للمندوب).
const syncPay = () => {
  const person = isPerson(), show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  show('#pay-card-row', !person); show('#pay-transfer-row', person); show('#pay-card-delivery-row', !person && fset.delivers.checked);
  if (person) { fset.pay_card.checked = false; fset.pay_card_delivery.checked = false; }
  else { if (fset.pay_transfer) fset.pay_transfer.checked = false; if (!fset.delivers.checked) fset.pay_card_delivery.checked = false; }
};
const syncDelivery = () => { $('#delivery-box').hidden = !fset.delivers.checked; syncPay(); };
fset.delivers.addEventListener('change', syncDelivery);
// التوصيل لمدن ثانية: الدفع فيه بتحويل على الآيبان المسجّل، والتكلفة بالاتفاق على الواتساب أو رسوم ثابتة أو علينا
const syncIntercity = () => {
  if (!fset.ships_intercity) return;
  const on = fset.ships_intercity.checked;
  $('#intercity-box').hidden = !on;
  $('#intercity-fee-row').hidden = !on || fset.intercity_fee_mode.value !== 'buyer_fixed';
};
fset.ships_intercity?.addEventListener('change', syncIntercity);
fset.intercity_fee_mode?.addEventListener('change', syncIntercity);
async function loadSettings() {
  if (!ctx?.owner) return;
  const { data, error } = await sb.from('store_settings').select('*').eq('merchant_id', ctx.mid).maybeSingle();
  if (error) return toast(friendlyError(error));
  const d = data || {};
  fset.pickup.checked = d.pickup ?? true; fset.delivers.checked = d.delivers ?? false;
  fset.delivery_radius_m.value = String(d.delivery_radius_m ?? 1000);
  fset.delivery_fee.value = d.delivery_fee ?? 0; fset.free_delivery_over.value = d.free_delivery_over ?? '';
  fset.min_order.value = d.min_order ?? 0;
  fset.delivery_from.value = (d.delivery_from || '').slice(0, 5); fset.delivery_to.value = (d.delivery_to || '').slice(0, 5);
  fset.prep_minutes.value = String(d.prep_minutes ?? 15); fset.note.value = d.note ?? '';
  if (fset.pay_cash) { fset.pay_cash.checked = d.pay_cash ?? true; fset.pay_card.checked = d.pay_card ?? false; fset.pay_card_delivery.checked = d.pay_card_delivery ?? false; if (fset.pay_transfer) fset.pay_transfer.checked = d.pay_transfer ?? false; }
  if (fset.ships_intercity) {
    fset.ships_intercity.checked = d.ships_intercity ?? false; fset.intercity_fee_mode.value = d.intercity_fee_mode ?? 'negotiable';
    fset.intercity_fee.value = d.intercity_fee ?? ''; fset.intercity_eta.value = d.intercity_eta ?? ''; fset.intercity_note.value = d.intercity_note ?? '';
  }
  if (![...fset.prep_minutes.options].some(o => o.value === fset.prep_minutes.value)) fset.prep_minutes.value = '15';
  syncDelivery(); syncIntercity();
}
fset.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fset), btn = $('#settings-save');
  if (!fset.pickup.checked && !fset.delivers.checked && !fset.ships_intercity?.checked) return (err.textContent = 'اختر الاستلام أو التوصيل (المحلي أو لمدن ثانية).');
  const person = isPerson();
  const cardDelivery = !person && fset.delivers.checked && fset.pay_card_delivery.checked;
  const card = !person && fset.pay_card.checked, transfer = person && !!fset.pay_transfer?.checked;
  if (!fset.pay_cash.checked && !card && !cardDelivery && !transfer) return (err.textContent = 'اختر طريقة دفع واحدة على الأقل.');
  const ships = !!fset.ships_intercity?.checked, feeMode = fset.intercity_fee_mode?.value || 'negotiable', interFee = num(fset.intercity_fee?.value);
  if (ships && feeMode === 'buyer_fixed' && (interFee === null || interFee < 0 || interFee > 2000)) return (err.textContent = 'اكتب مبلغ الشحن (من 0 إلى 2000 ريال).');
  const fee = num(fset.delivery_fee.value) ?? 0, over = num(fset.free_delivery_over.value), min = num(fset.min_order.value) ?? 0;
  if (!(fee >= 0 && fee <= 100)) return (err.textContent = 'رسوم التوصيل من 0 إلى 100 ريال.');
  if (over != null && !(over >= 0)) return (err.textContent = 'اكتب مبلغ صحيح للتوصيل المجاني.');
  if (!(min >= 0)) return (err.textContent = 'اكتب أقل مبلغ للطلب بشكل صحيح.');
  err.textContent = ''; setBusy(btn, true);
  const row = {
    merchant_id: ctx.mid, pickup: fset.pickup.checked, delivers: fset.delivers.checked,
    delivery_radius_m: Number(fset.delivery_radius_m.value), delivery_fee: fee, free_delivery_over: over, min_order: min,
    delivery_from: fset.delivery_from.value || null, delivery_to: fset.delivery_to.value || null,
    prep_minutes: Number(fset.prep_minutes.value), note: fset.note.value.trim() || null,
    pay_cash: fset.pay_cash.checked, pay_card: card, pay_card_delivery: cardDelivery, pay_transfer: transfer,
    ships_intercity: ships, intercity_fee_mode: feeMode, intercity_fee: ships && feeMode === 'buyer_fixed' ? interFee : null,
    intercity_eta: ships ? (fset.intercity_eta.value.trim() || null) : null, intercity_note: ships ? (fset.intercity_note.value.trim() || null) : null,
  };
  const { error } = await sb.from('store_settings').upsert(row);
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  toast('تم حفظ إعدادات التوصيل والاستلام ✓');
});

// ---------------- إتاحة المتنقلين: متاح / مشغول / خارج الخدمة ----------------
const LIVE_HOURS = 3;       // مدة الظهور الافتراضية بعد كل ضغطة
const LIVE_WARN_MIN = 15;   // ننبّه التاجر قبل الانتهاء بهذي المدة
let liveTimer = null;

function liveInfo() {
  const until = merchant?.live_until ? new Date(merchant.live_until) : null;
  const active = !!until && until > new Date() && ['available', 'busy'].includes(merchant.availability);
  const expired = !active && !!until && merchant.availability !== 'off';
  return { active, expired, mode: active ? merchant.availability : 'off', left: active ? until - Date.now() : 0 };
}
const leftText = ms => {
  const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} ساعة` + (mm ? ` و${mm} دقيقة` : '') : `${mm} دقيقة`;
};

function renderLive() {
  const box = $('#live');
  clearInterval(liveTimer); liveTimer = null;
  box.hidden = !(ctx?.owner && merchant?.kind === 'mobile');
  if (box.hidden) return;
  const st = $('#live-state'), here = $('#live-here'), busy = $('#live-busy'), off = $('#live-off'), ext = $('#live-extend');
  if (!busy || !ext) { box.hidden = true; return; }
  if (merchant.plan === 'basic') {
    st.textContent = 'الظهور للزبائن على الخريطة (متاح ومشغول) متاح في باقة «أسر ومتجولين» بـ 29 ر.س. حاليًا لا تظهر للزبائن.';
    box.style.borderColor = 'var(--line)';
    here.disabled = busy.disabled = off.disabled = true; ext.hidden = true;
    return;
  }
  const { active, expired, mode, left } = liveInfo();
  here.disabled = busy.disabled = false; off.disabled = !active;
  here.className = 'btn sm ' + (mode === 'available' ? 'primary' : 'ghost');
  busy.className = 'btn sm ' + (mode === 'busy' ? 'primary' : 'ghost');
  const warn = active && left <= LIVE_WARN_MIN * 60000;
  ext.hidden = !active;
  ext.className = 'btn sm ' + (warn ? 'primary' : 'ghost');
  box.style.borderColor = !active ? 'var(--line)' : warn || mode === 'busy' ? 'var(--warn)' : 'var(--brand)';
  if (active) {
    st.textContent = (mode === 'busy' ? '🟠 مشغول الآن · يظهر للزبائن بعلامة «مشغول»' : '🟢 متاح الآن · ظاهر للزبائن بموقعك الحي')
      + ` · ينتهي ظهورك بعد ${leftText(left)}` + (warn ? ' ⚠️ قارب الانتهاء، اضغط «تمديد» عشان تبقى ظاهر.' : '');
    liveTimer = setInterval(renderLive, 30000);
  } else if (expired) {
    st.textContent = '⚫ انتهت مدة ظهورك وصرت خارج الخدمة. اضغط «متاح الآن» لتظهر من جديد.';
  } else {
    st.textContent = '⚫ خارج الخدمة · غير ظاهر للزبائن. اضغط «متاح الآن» لما تكون جاهز للشغل.';
  }
}

async function setAvailability(mode, btn) {
  if (mode === 'off') {
    setBusy(btn, true);
    const { error } = await sb.rpc('set_availability', { st: 'off' });
    setBusy(btn, false);
    if (error) return toast(friendlyError(error));
    Object.assign(merchant, { availability: 'off', live_until: null, live_at: null, live_lat: null, live_lng: null });
    renderLive(); toast('صرت خارج الخدمة، وما تظهر للزبائن.');
    return;
  }
  if (!navigator.geolocation) return toast('جهازك ما يدعم تحديد الموقع.');
  setBusy(btn, true, 'جارِ تحديد موقعك…');
  navigator.geolocation.getCurrentPosition(async p => {
    const { data, error } = await sb.rpc('set_availability', { st: mode, la: p.coords.latitude, ln: p.coords.longitude, hrs: LIVE_HOURS });
    setBusy(btn, false);
    if (error) return toast(friendlyError(error));
    Object.assign(merchant, { availability: data.availability, live_until: data.live_until, live_at: data.live_at, live_lat: p.coords.latitude, live_lng: p.coords.longitude });
    renderLive();
    toast(mode === 'busy' ? 'تم ✓ تظهر للزبائن بعلامة «مشغول».' : 'تم ✓ أنت متاح، والزبائن القريبين يشوفون موقعك.');
  }, () => { setBusy(btn, false); toast('ما قدرنا نحدد موقعك. اسمح للمتصفح بالوصول للموقع.'); }, { enableHighAccuracy: true, timeout: 15000 });
}
$('#live-here')?.addEventListener('click', e => setAvailability('available', e.currentTarget));
$('#live-busy')?.addEventListener('click', e => setAvailability('busy', e.currentTarget));
$('#live-off')?.addEventListener('click', e => setAvailability('off', e.currentTarget));
$('#live-extend')?.addEventListener('click', e => setAvailability(liveInfo().mode === 'busy' ? 'busy' : 'available', e.currentTarget));


// ---------------- اربط متجرك الإلكتروني (اهتمام مبدئي) ----------------
const LINK_PLATFORMS = { salla: 'سلة', zid: 'زد', shopify: 'شوبيفاي', custom: 'موقع أو تطبيق خاص' };
async function loadLinkCard() {
  const box = $('#link-card'), f = $('#f-link');
  if (!box || !f) return;
  box.hidden = !(ctx?.owner && merchant?.kind === 'store');
  if (box.hidden) return;
  const { data } = await sb.from('store_link_requests').select('platform, store_url').eq('merchant_id', ctx.mid).maybeSingle();
  f.platform.value = data?.platform || 'salla';
  f.store_url.value = data?.store_url || '';
  $('#link-save').textContent = data ? 'تحديث' : 'سجّل اهتمامي';
  const st = $('#link-state'); st.dataset.def ||= st.textContent;
  st.textContent = data ? `✓ سجّلنا اهتمامك بربط متجرك على ${LINK_PLATFORMS[data.platform] || data.platform}. بنتواصل معك أول ما تفتح الميزة.` : st.dataset.def;
}
$('#f-link')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#link-save'), url = f.store_url.value.trim();
  if (url && !/^https?:\/\/\S+\.\S+/.test(url)) return toast('اكتب رابطًا صحيحًا يبدأ بـ https://');
  setBusy(btn, true);
  const { error } = await sb.from('store_link_requests').upsert({ merchant_id: ctx.mid, platform: f.platform.value, store_url: url || null });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast('تم ✓ سجّلنا اهتمامك.');
  loadLinkCard();
});


// ---------------- رقم واتساب التواصل مع المشترين ----------------
function renderContactCard() {
  const box = $('#contact-card'), f = $('#f-contact');
  if (!box || !f) return;
  box.hidden = !(ctx?.owner && merchant);
  if (box.hidden) return;
  f.contact_phone.value = merchant.contact_phone || '';
  $('#contact-state').textContent = merchant.contact_phone
    ? 'هذا الرقم هو اللي يتواصل عليه المشترون واتساب، وهو الوحيد اللي يظهر لهم.'
    : '⚠️ ما أضفت رقم واتساب للمشترين بعد، فما يقدرون يتواصلون معك. تقدر تكتب نفس جوالك أو رقماً غيره.';
}
$('#f-contact')?.addEventListener('input', e => { e.target.value = digits(e.target.value).replace(/\D/g, ''); });
$('#f-contact')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#contact-save'), p = digits(f.contact_phone.value).trim();
  if (!valid.phone(p)) return toast('الرقم يبدأ بـ 05 ومكوّن من 10 أرقام.');
  setBusy(btn, true);
  const { error } = await sb.rpc('set_contact_phone', { p });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  merchant.contact_phone = p;
  renderContactCard();
  toast('تم ✓ حفظنا رقم التواصل مع المشترين.');
});

// ---------------- حساباتي البنكية (آيبان إضافي لبنوك ثانية) ----------------
// الحساب الأساسي من التسجيل. الإضافي يراجعه الإدارة ويعتمده، ولا يظهر للمشتري إلا المعتمد (لاحقًا، بعد موافقتك على طلبه).
const fmtIban = v => String(v || '').replace(/(.{4})/g, '$1 ').trim();
async function renderIbans() {
  const box = $('#ibans-card'), f = $('#f-iban');
  if (!box || !f) return;
  box.hidden = !(ctx?.owner && merchant && merchant.kind && merchant.kind !== 'store');
  if (box.hidden) return;
  const list = $('#ibans-list'); list.textContent = '';
  const li = (title, iban, ok, onRemove) => {
    const row = document.createElement('li');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--line);border-radius:8px';
    const txt = document.createElement('span'); txt.style.flex = '1'; txt.dir = 'ltr';
    txt.textContent = `${fmtIban(iban)}`;
    const name = document.createElement('b'); name.textContent = title;
    const st = document.createElement('span'); st.className = ok ? 'badge approved' : 'badge pending'; st.textContent = ok ? '✔ معتمد' : 'بانتظار مراجعة الإدارة';
    row.append(name, txt, st);
    if (onRemove) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm'; b.textContent = 'حذف'; b.onclick = onRemove; row.append(b); }
    return row;
  };
  list.append(li(`${merchant.bank_name} (الأساسي)`, merchant.iban, !!merchant.iban_verified_at));
  const { data, error } = await sb.from('merchant_ibans').select('*').eq('merchant_id', merchant.id).order('created_at');
  if (error) return toast(friendlyError(error));
  for (const x of data || []) list.append(li(x.bank_name, x.iban, !!x.verified_at, () => removeIban(x)));
  f.hidden = (data || []).length >= 4;
}
async function removeIban(x) {
  if (!confirm(`حذف الحساب ${fmtIban(x.iban)} (${x.bank_name})؟`)) return;
  const { error } = await sb.from('merchant_ibans').delete().eq('id', x.id);
  if (error) return toast(friendlyError(error));
  if (x.cert_path) sb.storage.from('merchant-docs').remove([x.cert_path]);
  toast('تم حذف الحساب.'); renderIbans();
}
$('#f-iban')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#iban-add');
  const bank = f.bank_name.value.trim(), iban = clean(f.iban.value), file = f.cert.files[0];
  const problems = [];
  if (bank.length < 2) problems.push('اكتب اسم البنك.');
  if (!valid.iban(iban)) problems.push('رقم الآيبان غير صحيح. يبدأ بـ SA ومكوّن من 24 خانة.');
  if (!file) problems.push('ارفع شهادة الآيبان من البنك.');
  else { const p = checkFile(file, 'شهادة الآيبان'); if (p) problems.push(p); }
  if (problems.length) { err.textContent = problems.join(' '); return; }
  err.textContent = ''; setBusy(btn, true, 'جارِ الرفع…');
  try {
    const path = `${merchant.id}/iban2-${Date.now()}.${fileExt(file)}`;
    const up = await sb.storage.from('merchant-docs').upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.from('merchant_ibans').insert({ merchant_id: merchant.id, bank_name: bank, iban, cert_path: path });
    if (error) { sb.storage.from('merchant-docs').remove([path]); throw error; }
    f.reset(); toast('تمت الإضافة. تنتظر مراجعة الإدارة قبل ما تظهر للمشتري.');
    await renderIbans();
  } catch (ex) { err.textContent = friendlyError(ex); }
  finally { setBusy(btn, false); }
});
