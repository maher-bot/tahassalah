import { rememberLogin, hidePasswords, sb, $, $$, toast, clean, digits, valid, money, ACTIVITIES, PLANS, planLabel, STATUS, fileExt, shrinkImage, friendlyError, setBusy, trialInfo, fmtDay, OFFER_REASONS, KINDS, KIND_ICON, ACTIVITIES_BY_KIND } from './lib.js';
import { takePhoto } from './camera.js';
import { showInstall, showPushCard } from './pwa.js';
import { pickLocation } from './mappick.js';
import { SUPABASE_URL } from './config.js';
import * as S from './stats-ui.js';

const VIEWS = ['v-loading', 'v-auth', 'v-check-email', 'v-reset', 'v-apply', 'v-status', 'v-invites', 'v-dash', 'v-roles', 'v-rep-done'];
const show = id => { VIEWS.forEach(v => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); };
const here = () => location.origin + location.pathname;

let user = null, merchant = null, products = [], editing = null, recovering = false, routedFor = undefined, coords = null;
const currentMerchant = () => merchant;   // نموذج التسجيل في وضع المسوّق يتجاهل متجر المسوّق نفسه
let invites = [], stores = [], skipInvites = false;
// كود المسوّق من رابط التسجيل (?ref=M01) — نحفظه لين يكمل التاجر طلبه
const REP_MODE = new URLSearchParams(location.search).get('rep') === '1';
let repMode = false;
const REF = (() => {
  const r = new URLSearchParams(location.search).get('ref');
  try { if (r) localStorage.setItem('tah-ref', r.toUpperCase()); return r?.toUpperCase() || localStorage.getItem('tah-ref'); } catch { return r?.toUpperCase() || null; }
})();
// مصدر الحملة اللي حفظه utm.js — يُرسل مع أحداث التسجيل في Google Analytics
const UTM = (() => {
  try {
    const u = JSON.parse(localStorage.getItem('tah-utm'));
    return u && Date.now() - u.at < 30 * 864e5 ? u : null;
  } catch { return null; }
})();
const utmParams = () => ({
  campaign_source: UTM?.utm_source || '(none)',
  campaign_medium: UTM?.utm_medium || '(none)',
  campaign_name: UTM?.utm_campaign || '(none)',
  campaign_content: UTM?.utm_content || '(none)',
});
// ctx: المتجر المفتوح حاليًا — صاحبه أو موظف فيه
let ctx = null;
const ROLES = { manager: 'مدير فرع', stock: 'أمين مخزون', pricing: 'موظف أسعار', cashier: 'كاشير', accountant: 'محاسب', driver: 'مندوب توصيل' };
const ROLE_PERMS = { manager: ['inventory', 'prices', 'orders'], stock: ['inventory'], pricing: ['prices'], cashier: ['orders'], driver: ['delivery'] };
const canOrders = () => ctx?.owner || ctx?.perms.has('orders');
const isDriver = () => !ctx?.owner && ctx?.perms.has('delivery');
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
  const login = t.dataset.tab === 'login';
  $('#v-auth h1').textContent = login ? 'دخول التجار' : 'سجّل متجرك في تحصّله';
  $('#v-auth h1 + .hint').textContent = login ? 'ادخل بإيميلك وكلمة المرور لإدارة متجرك ومنتجاتك.' : 'أنشئ حسابك، ارفع مستنداتك، ونفعّل متجرك بعد المراجعة لتضيف منتجاتك وأسعارك.';
}));
// رابط «دخول» من الصفحة الرئيسية (?tab=login) يفتح تبويب «عندي حساب» مباشرة
if (new URLSearchParams(location.search).get('tab') === 'login') $('#v-auth [role=tab][data-tab=login]')?.click();

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
  if (typeof gtag === 'function') gtag('event', 'sign_up', { method: 'merchant', ...utmParams() });
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

$('#logout').addEventListener('click', async () => { try { sessionStorage.removeItem('tah-role'); } catch {} await sb.auth.signOut(); });

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
  { const ta = $('#to-admin'); if (ta) ta.hidden = true; const tr = $('#to-rep'); if (tr) tr.hidden = true; }
  if (!user) return show('v-auth');
  // وضع المسوّق: ?rep=1 يفتح نموذج التسجيل لمحل جديد باسم صاحبه (للمسوّق المصرّح له فقط)
  if (REP_MODE) {
    show('v-loading');
    const { data: ok } = await sb.rpc('can_rep_activate');
    if (ok) return openApply(null, true);
    toast('ما عندك صلاحية تفعيل المحلات. اطلبها من الإدارة.');
  }
  // حساب الإدارة (اللي له متجر أيضًا) يشوف رابط لوحة الإدارة
  sb.rpc('is_admin').then(({ data }) => { const ta = $('#to-admin'); if (ta) ta.hidden = !data; });
  sb.rpc('my_rep').then(({ data }) => { const tr = $('#to-rep'); if (tr) tr.hidden = !data?.[0]; });

  show('v-loading');
  const [m, inv, st] = await Promise.all([
    sb.from('merchants').select('*').eq('id', user.id).maybeSingle(),
    sb.rpc('my_invites'), sb.rpc('my_stores'),
  ]);
  if (m.error) { $('#v-loading').textContent = friendlyError(m.error); return; }
  merchant = m.data; invites = inv.data || []; stores = st.data || [];
  if (invites.length && !skipInvites) return showInvites();
  // نفس الإيميل له أكثر من دور: نسأله وين يدخل (مرة وحدة في الجلسة)
  let chosen = null; try { chosen = sessionStorage.getItem('tah-role'); } catch {}
  if (chosen !== 'merchant') {
    const [ad, rp] = await Promise.all([sb.rpc('is_admin'), sb.rpc('my_rep')]);
    const isAdmin = !!ad.data, isRep = !!rp.data?.[0];
    const hasStore = !!merchant || stores.length > 0 || invites.length > 0;
    const n = isAdmin + isRep + hasStore;
    if (n > 1) return showRoles(isAdmin, isRep, hasStore);
    if (isRep && n === 1) return location.replace('rep.html');
    if (isAdmin && n === 1) return location.replace('admin.html');
  }
  if (merchant?.status === 'approved' || stores.length) return openDash(pickStore());
  if (!merchant) return openApply();
  showStatus();
}

function pickStore() {
  const saved = store.get('tah-store');
  const ids = [merchant?.status === 'approved' ? merchant.id : null, ...stores.map(s => s.merchant_id)].filter(Boolean);
  return ids.includes(saved) ? saved : ids[0];
}

function showRoles(isAdmin, isRep, hasStore) {
  $('#go-admin').hidden = !isAdmin; $('#go-rep').hidden = !isRep; $('#go-store').hidden = !hasStore;
  show('v-roles');
}
$('#go-store').addEventListener('click', () => { try { sessionStorage.setItem('tah-role', 'merchant'); } catch {} route(); });

$('#rep-another').addEventListener('click', () => openApply(null, true));

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
  const lc = $('#loc-consent-row'); if (lc) { lc.hidden = !person; if (!person) fa.loc_consent.checked = false; }
  const bb = $('#bnpl-box'); if (bb) { bb.hidden = person; if (person) { fa.signup_tabby.checked = false; fa.signup_tamara.checked = false; } }
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

function openApply(m = null, asRep = false) {
  fa.reset();
  repMode = asRep;
  $('#rep-box').hidden = $('#rep-ack-row').hidden = !asRep;
  $('#agree-row').hidden = asRep;
  $$('input[name=kind]', fa).forEach(r => { r.checked = r.value === (m?.kind || 'store'); });
  syncKind();
  coords = m?.lat != null ? { lat: m.lat, lng: m.lng } : null;
  $('#loc-state').textContent = coords ? '✓ الموقع محدد مسبقًا' : 'اضغطه وأنت داخل المحل، عشان يظهر للمشترين القريبين.';
  $('#apply-title').textContent = asRep ? 'تسجيل محل جديد' : m ? 'تعديل طلبك' : 'بيانات متجرك';
  $('#apply-btn').textContent = asRep ? '⚡ سجّل وفعّل المحل' : m ? 'حفظ وإعادة الإرسال' : 'إرسال الطلب للمراجعة';
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
    if (fa.loc_consent) fa.loc_consent.checked = !!m.location_consent_at;
    if (fa.signup_tabby) { fa.signup_tabby.checked = (m.bnpl || []).includes('tabby'); fa.signup_tamara.checked = (m.bnpl || []).includes('tamara'); }
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
  const merchant = repMode ? null : currentMerchant();
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
  if (!repMode && fa.loc_consent && kindOf() !== 'store' && !fa.loc_consent.checked) problems.push('وافق على حفظ الموقع واستخدامه، لأن عرض الأسر والعربات للمشترين يعتمد عليه.');
  if (repMode) {
    const oe = fa.owner_email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oe)) problems.push('اكتب إيميل صاحب المحل صحيح.');
    else if (oe === (user.email || '').toLowerCase()) problems.push('اكتب إيميل صاحب المحل، مو إيميلك.');
    if (!coords) problems.push('حدّد موقع المحل وأنت داخله.');
    if (!fa.owner_ack.checked) problems.push('أكّد الإقرار: أنت عند المحل وصاحبه وافق.');
  } else if (!fa.agree.checked) problems.push('وافق على الإقرار والشروط.');
  if (problems.length) { err.textContent = problems.join(' '); return; }
  err.textContent = '';

  setBusy(btn, true, 'جارِ رفع المستندات…');
  try {
    const paths = {};
    const folder = repMode ? `rep-${user.id}` : user.id;
    for (const k of ['cr', 'vat', 'iban', 'id']) {
      const f = files[k];
      if (!f || (k === 'vat' && !vatReg)) continue;
      const up = repMode ? await shrinkImage(f, 1800) : f;
      const path = `${folder}/${k}-${Date.now()}.${fileExt(up)}`;
      const { error } = await sb.storage.from('merchant-docs').upload(path, up, { contentType: f.type || undefined, upsert: false });
      if (error) throw error;
      paths[k] = path;
    }
    let extra_docs = merchant?.extra_docs || [];
    if (extras.length) {
      extra_docs = [];
      for (const [i, f] of extras.entries()) {
        const path = `${folder}/extra-${Date.now()}-${i}.${fileExt(f)}`;
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
      location_consent_at: person && fa.loc_consent?.checked ? (merchant?.location_consent_at || new Date().toISOString()) : null,
      bnpl: person || !fa.signup_tabby ? [] : [fa.signup_tabby.checked && 'tabby', fa.signup_tamara.checked && 'tamara'].filter(Boolean),
      next_plan: fa.querySelector('input[name=next_plan]:checked')?.value || 'basic',
      billing: fa.yearly.checked ? 'yearly' : 'monthly',
      cr_path: person ? null : (paths.cr ?? merchant?.cr_path),
      vat_path: vatReg ? (paths.vat ?? merchant?.vat_path ?? null) : null,
      iban_path: paths.iban ?? merchant?.iban_path,
    };
    if (!merchant && REF && /^[A-Z0-9]{2,8}$/.test(REF)) row.rep_code = REF;
    if (repMode) {
      const body = { ...row, email: fa.owner_email.value.trim().toLowerCase(), owner_ack: true, lat: coords.lat, lng: coords.lng };
      delete body.id; delete body.location_consent_at; delete body.rep_code;
      if (!paths.iban) throw new Error('ارفع شهادة الآيبان.');
      const { data, error } = await sb.functions.invoke('rep-activate', { body });
      if (error) {
        let code = ''; try { code = (await error.context.json()).error; } catch {}
        throw new Error({ merchant_exists: 'هذا الإيميل عنده متجر مسجّل من قبل.', rep_not_allowed: 'ما عندك صلاحية التفعيل.', bad_email: 'إيميل صاحب المحل غير صحيح.',
          location_required: 'حدّد موقع المحل.', own_email: 'اكتب إيميل صاحب المحل، مو إيميلك.' }[code] || (code ? 'ما تم التفعيل: ' + code : friendlyError(error)));
      }
      $('#rep-done-msg').textContent = `«${row.store_name}» مفعّل الحين. ${!data?.email_sent ? '⚠️ ما انرسل الإيميل، بلّغ الإدارة.' : data?.new_account ? 'وصل لصاحب المحل إيميل يحط فيه كلمة المرور.' : 'صاحب المحل يدخل بحسابه الحالي على نفس الإيميل.'} والإدارة وصلها المستندات باسمك.`;
      return show('v-rep-done');
    }
    const q = merchant ? sb.from('merchants').update(row).eq('id', user.id) : sb.from('merchants').insert(row);
    const { error } = await q;
    if (error) throw error;
    // طلب تسجيل تاجر مكتمل: هذا اللي نقيس عليه تكلفة التاجر المسجّل لكل حملة
    if (!merchant && typeof gtag === 'function') gtag('event', 'merchant_application', { merchant_kind: kind, ...utmParams() });
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
  $$('#d-tabs [data-orders]').forEach(b => { b.hidden = !canOrders(); });
  $$('#d-tabs [data-driver]').forEach(b => { b.hidden = !isDriver(); });
  $('#add').hidden = !canInv();
  const direct = ctx.owner || (canInv() && !ctx.needs);
  $('#csv-wrap').hidden = !direct; $('#csv-tpl').hidden = !direct;
  const note = $('#staff-note');
  note.hidden = ctx.owner;
  if (!ctx.owner) {
    const can = [canInv() && 'إضافة المنتجات وتعديل الكميات', canPrice() && 'تعديل الأسعار', canOrders() && 'استقبال الطلبات', isDriver() && 'توصيل الطلبات'].filter(Boolean).join(' و');
    note.textContent = `صلاحياتك: ${can || 'عرض فقط'}.` + (ctx.needs ? ' كل تعديل تسويه يوصل لصاحب المتجر ويظهر بعد موافقته.' : '');
  }
  // باقة المحل: ميزات «مميز» (المناوبات، العهدة، ربط المخزون، سجل الحركات)
  const { data: feat } = await sb.rpc('store_features', { mid: ctx.mid });
  ctx.pro = !!feat?.pro; ctx.plan = feat?.plan; ctx.activity = feat?.activity;
  selectTab(isDriver() ? 'deliveries' : 'products');
  show('v-dash');
  showPushCard($('#v-dash'), sb, user.id, isDriver() ? 'يوصلك تنبيه على جوالك أول ما يتحوّل لك طلب، حتى والتطبيق مقفول.' : 'يوصلك تنبيه على جوالك أول ما يجيك طلب جديد، حتى والتطبيق مقفول.');
  showInstall($('#v-dash'), isDriver() ? 'ثبّت تحصّله على جوالك، وتوصلك توصيلاتك من أيقونته مباشرة.' : 'ثبّت لوحة متجرك على جوالك، وافتحها من أيقونتها مثل أي تطبيق.');
  if (canOrders()) pollOrders();
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
  for (const t of ['products', 'approvals', 'mine', 'team', 'settings', 'orders', 'deliveries', 'stats']) $('#p-' + t).hidden = t !== name;
  if (name === 'stats') loadStats();
  if (name === 'orders') loadOrders();
  if (name === 'deliveries') loadDeliveries();
  if (name === 'settings') { loadSettings(); loadPos(); }
  if (name === 'approvals') loadApprovals();
  if (name === 'mine') loadMine();
  if (name === 'team') { loadTeam(); loadCashiers(); loadShiftLog(); }
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
// مطالبة الاشتراك المفتوحة (تطلع قبل الاستحقاق بـ 7 أيام): رابطها وطريقة السداد
async function showOpenInvoice(box) {
  box.querySelector('#trial-inv')?.remove();
  if (!merchant?.id || merchant.id !== user?.id) return;
  const { data } = await sb.from('invoices').select('id,number,total,due_at,kind,description,submitted_at').eq('merchant_id', merchant.id).eq('status', 'issued').order('due_at');
  if (!data?.length) return;
  const d = document.createElement('div'); d.id = 'trial-inv'; d.className = 'note'; d.style.marginTop = '10px';
  for (const inv of data) {
    const p = document.createElement('p');
    const left = Math.ceil((new Date(inv.due_at) - Date.now()) / 864e5);
    p.append(`🧾 مطالبة ${inv.kind === 'service' ? inv.description : 'تجديد الاشتراك'}: ${money(inv.total)} (شامل الضريبة)، ${left > 0 ? `آخر موعد بعد ${left} يوم` : 'موعدها اليوم'}. ${inv.submitted_at ? '📎 وصلنا إيصالك وبنأكده. ' : 'حوّل وارفع الإيصال من صفحة المطالبة، أو ادفع شبكة عن طريق المسوّق. '}`);
    const a = document.createElement('a'); a.href = 'invoice.html?id=' + inv.id; a.target = '_blank'; a.textContent = 'عرض المطالبة';
    p.append(a); d.append(p);
  }
  box.append(d);
}
const daysLeft = d => Math.max(0, Math.ceil((d - Date.now()) / 864e5));

function renderTrial() {
  const box = $('#trial'), st = planStage(merchant), stage = st.stage, mobile = merchant.kind === 'mobile';
  box.hidden = false;
  showOpenInvoice(box);
  box.classList.toggle('ended', stage === 'lapsed' || stage === 'trial_ended');
  $$('#trial-next [data-kind]').forEach(o => { o.hidden = o.disabled = (merchant.kind || 'store') === 'store'; });
  $$('#trial-next [data-basic]').forEach(o => { o.hidden = o.disabled = mobile; });
  $('#trial-next').value = (merchant.next_plan || 'basic') + (merchant.billing === 'yearly' && merchant.next_plan !== 'basic' ? ':yearly' : '');
  $('.t-pick', box).hidden = stage === 'paid';
  const after = (merchant.kind || 'store') === 'store' ? 'اشتراك «تاجر» أو «مميز» ليستمر ظهور متجرك' : 'اشتراك «أسر ومتجولين» ليستمر ظهورك';
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
  $('#s-active').textContent = products.filter(p => p.is_active && (p.always_available || p.quantity > 0)).length;
  $('#s-low').textContent = products.filter(p => !p.always_available && p.quantity <= 2).length;
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
    const qty = p.always_available ? mk('span', '', `متوفر دائمًا · لكل ${unitOf(p)}`) : mk('span', p.quantity <= 2 ? 'low' : '', p.quantity > 0 ? `${p.quantity} ${unitOf(p)}` : 'نفد');
    m.append(price, qty);
    if (p.pack_size) m.append(mk('span', '', `📦 ${p.pack_name || 'كرتون'} ${p.pack_size}: ${money(p.pack_price)}${p.pack_only ? ' · بالعبوة فقط' : ''}`));
    if (p.category) m.append(mk('span', '', p.category));
    if (p.preorder_hours) m.append(mk('span', '', '🕒 طلب مسبق ' + (p.preorder_hours >= 24 ? `${p.preorder_hours / 24 === 1 ? 'يوم' : p.preorder_hours / 24 === 2 ? 'يومين' : p.preorder_hours / 24 + ' أيام'}` : `${p.preorder_hours} ساعات`)));
    if (!p.is_active) m.append(mk('span', '', 'مخفي'));
    if (p.sale_price != null) m.append(mk('span', 'low', '🏷️ ' + (OFFER_REASONS[p.offer_reason] || 'عرض') + (p.offer_ends_at ? ' · ينتهي ' + fmtDay(p.offer_ends_at) : '')));
    const dLeft = p.expires_on ? Math.ceil((new Date(p.expires_on + 'T23:59:59') - Date.now()) / 864e5) : null;
    if (dLeft != null) m.append(mk('span', dLeft <= 7 ? 'low' : '', dLeft < 0 ? 'منتهي الصلاحية' : dLeft <= 7 ? `⚠️ تنتهي صلاحيته خلال ${dLeft} يوم${p.sale_price == null ? ' — سوّ عليه عرض' : ''}` : 'الصلاحية ' + fmtDay(p.expires_on)));
    if (pendingIds.has(p.id)) m.append(mk('span', 'low', '⏳ تعديل بانتظار الموافقة'));
    mid.append(mk('div', 'n', p.name), m);
    const acts = mk('div', 'acts');
    if (canInv() && !p.always_available) {
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
// وحدة البيع الافتراضية حسب نشاط المحل، و«متوفر دائمًا» للأكل المطبوخ والخدمات
function unitDefaults() {
  const a = ctx?.activity || (ctx?.owner ? merchant?.activity : '') || '';
  if (/أطباق|أكل|مطعم|مطبخ|وجبات|مشاوي|شاورما|برجر/.test(a)) return { unit: 'وجبة', always: true };
  if (/خدمات|فني|سطحة|صيانة|سباك|نقل|تنظيف/.test(a)) return { unit: 'خدمة', always: true };
  if (/آيسكريم|قهوة|عصير|مشروبات/.test(a)) return { unit: 'كوب', always: false };
  if (/ملابس|أزياء|عباي|خياط|مغسلة|أحذية|أقمشة/.test(a)) return { unit: 'قطعة', always: false };
  if (/حلويات|مخبوزات|كيك/.test(a)) return { unit: 'قطعة', always: false };
  return { unit: 'حبة', always: false };
}
const unitOf = p => p.unit || unitDefaults().unit;
const FIELDS = ['name', 'price', 'sale_price', 'quantity', 'unit', 'always_available', 'pack_name', 'pack_size', 'pack_price', 'pack_only', 'category', 'barcode', 'description', 'image_path', 'is_active', 'offer_reason', 'offer_ends_at', 'expires_on'];
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
    fp.unit.value = p.unit || ''; fp.always_available.checked = !!p.always_available;
    fp.pack_name.value = p.pack_name || ''; fp.pack_size.value = p.pack_size ?? ''; fp.pack_price.value = p.pack_price ?? ''; fp.pack_only.checked = !!p.pack_only;
  } else { const d = unitDefaults(); fp.unit.value = d.unit; fp.always_available.checked = d.always; }
  syncAlways(); $('#pack-box').open = !!p?.pack_size;
  $('#preorder-row').hidden = viaApproval();
  fp.preorder_hours.disabled = !canInv();
  syncOffer();
  const box = $('.file[data-file="img"]', fp);
  box.dataset.existing = p?.image_path ? '1' : '';
  box.classList.toggle('has', !!p?.image_path);
  $('.cur', box).textContent = p?.image_path ? '✓ فيه صورة (اختر صورة جديدة لاستبدالها)' : '';
  // الحقول حسب الصلاحية
  const inv = canInv(), pr = canPrice() || !p;
  for (const k of ['name', 'quantity', 'category', 'barcode', 'description', 'image', 'is_active', 'unit', 'always_available', 'pack_name', 'pack_size', 'pack_only']) fp[k].disabled = !inv;
  fp.pack_price.disabled = !pr;
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
  const always = fp.always_available.checked;
  const packSize = num(fp.pack_size.value), packPrice = num(fp.pack_price.value), packOnly = fp.pack_only.checked;
  if ((packSize != null || packPrice != null || packOnly) && !(Number.isInteger(packSize) && packSize >= 2 && packSize <= 10000 && packPrice > 0))
    return (err.textContent = 'للبيع بالعبوة: اكتب كم حبة فيها (2 وفوق) وسعرها.');
  const pack = { pack_name: packSize ? (fp.pack_name.value.trim() || 'كرتون') : null, pack_size: packSize ?? null, pack_only: !!packSize && packOnly };
  if (!always && (qty == null || !Number.isInteger(qty) || qty < 0)) return (err.textContent = 'الكمية رقم صحيح من 0 وفوق.');
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
      name: fp.name.value.trim(), price, sale_price: sale, quantity: always ? (Number.isInteger(qty) && qty >= 0 ? qty : (editing?.quantity ?? 0)) : qty,
      unit: fp.unit.value.trim() || null, always_available: always, ...pack, pack_price: packSize ? packPrice : null,
      category: fp.category.value.trim() || null, barcode: digits(fp.barcode.value).trim() || null,
      description: fp.description.value.trim() || null, is_active: fp.is_active.checked, image_path,
      expires_on: fp.expires_on.value || null, ...offer,
    } : { price, sale_price: sale, ...offer, pack_price: editing?.pack_size ? packPrice : null };
    if (canInv() && !viaApproval()) row.preorder_hours = fp.preorder_hours.value ? Number(fp.preorder_hours.value) : null;
    if (editing && !canPrice()) { delete row.price; delete row.sale_price; delete row.offer_reason; delete row.offer_ends_at; delete row.pack_price; }
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
const LABEL = { unit: 'الوحدة', always_available: 'متوفر دائمًا', pack_name: 'اسم العبوة', pack_size: 'حبات العبوة', pack_price: 'سعر العبوة', pack_only: 'بالعبوة فقط', name: 'الاسم', price: 'السعر', sale_price: 'سعر العرض', quantity: 'الكمية', category: 'التصنيف', barcode: 'الباركود', description: 'الوصف', image_path: 'الصورة', is_active: 'الظهور', offer_reason: 'سبب العرض', offer_ends_at: 'نهاية العرض', expires_on: 'الصلاحية' };
const ACTION = { insert: 'إضافة منتج', update: 'تعديل', delete: 'حذف' };
const showVal = (k, v) => v == null || v === '' ? '—' : k === 'offer_reason' ? (OFFER_REASONS[v] || v) : ['offer_ends_at', 'expires_on'].includes(k) ? fmtDay(v) : k === 'is_active' ? (v ? 'ظاهر' : 'مخفي') : ['always_available', 'pack_only'].includes(k) ? (v ? 'نعم' : 'لا') : k === 'pack_price' ? money(v) : k === 'image_path' ? 'صورة جديدة' : ['price', 'sale_price'].includes(k) ? money(v) : String(v);

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
    fs.p_orders.checked = s.perms.includes('orders'); fs.p_delivery.checked = s.perms.includes('delivery');
    fs.needs_approval.checked = s.needs_approval;
  }
  dlgStaff.showModal(); (s ? fs.name : fs.name).focus();
}
$('#t-add').addEventListener('click', () => openStaff(null));
$('#staff-cancel').addEventListener('click', () => dlgStaff.close());
fs.role.addEventListener('change', () => {
  const p = ROLE_PERMS[fs.role.value] || [];
  fs.p_inventory.checked = p.includes('inventory'); fs.p_prices.checked = p.includes('prices');
  fs.p_orders.checked = p.includes('orders'); fs.p_delivery.checked = p.includes('delivery');
});
fs.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fs), btn = $('#staff-save');
  const email = fs.email.value.trim().toLowerCase(), name = fs.name.value.trim();
  const perms = [fs.p_inventory.checked && 'inventory', fs.p_prices.checked && 'prices', fs.p_orders.checked && 'orders', fs.p_delivery.checked && 'delivery'].filter(Boolean);
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
function syncAlways() { $('#qty-row').hidden = fp.always_available.checked; }
fp.always_available.addEventListener('change', syncAlways);
function syncOffer() { $('#offer-row').hidden = !fp.sale_price.value.trim(); }
fp.sale_price.addEventListener('input', syncOffer);

// ---------------- التوصيل والاستلام ----------------
const fset = $('#f-settings');
const isPerson = () => !!(merchant?.kind && merchant.kind !== 'store');
// الأسر والمتنقلون: نقدًا أو تحويل على الحساب. المحلات: نقدًا أو بطاقة (في المحل أو للمندوب)، وتقسيط تابي أو تمارا في المحل بحساب التاجر نفسه.
const syncPay = () => {
  const person = isPerson(), show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  show('#pay-card-row', !person); show('#pay-tabby-row', !person); show('#pay-tamara-row', !person); show('#pay-transfer-row', person); show('#pay-card-delivery-row', !person && (fset.delivers.checked || fset.service_roundtrip.checked));
  if (person) { fset.pay_card.checked = false; fset.pay_card_delivery.checked = false; if (fset.pay_tabby) { fset.pay_tabby.checked = false; fset.pay_tamara.checked = false; } }
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
  if (fset.pay_cash) { fset.pay_cash.checked = d.pay_cash ?? true; fset.pay_card.checked = d.pay_card ?? false; fset.pay_card_delivery.checked = d.pay_card_delivery ?? false; if (fset.pay_transfer) fset.pay_transfer.checked = d.pay_transfer ?? false; if (fset.pay_tabby) { const sb0 = merchant?.bnpl || []; fset.pay_tabby.checked = d.pay_tabby ?? sb0.includes('tabby'); fset.pay_tamara.checked = d.pay_tamara ?? sb0.includes('tamara'); } }
  renderPayLink(); renderMyData();
  fset.service_roundtrip.checked = !!d.service_roundtrip; fset.roundtrip_fee.value = d.roundtrip_fee ?? 0; fset.roundtrip_free_over.value = d.roundtrip_free_over ?? '';
  fset.turnaround_hours.value = String(d.turnaround_hours ?? 48); fset.express_enabled.checked = !!d.express_enabled;
  fset.express_fee.value = d.express_fee ?? 0; fset.express_hours.value = String(d.express_hours ?? 24);
  $('#rt-fields').hidden = !fset.service_roundtrip.checked;
  if (fset.ships_intercity) {
    fset.ships_intercity.checked = d.ships_intercity ?? false; fset.intercity_fee_mode.value = d.intercity_fee_mode ?? 'negotiable';
    fset.intercity_fee.value = d.intercity_fee ?? ''; fset.intercity_eta.value = d.intercity_eta ?? ''; fset.intercity_note.value = d.intercity_note ?? '';
  }
  if (![...fset.prep_minutes.options].some(o => o.value === fset.prep_minutes.value)) fset.prep_minutes.value = '15';
  syncDelivery(); syncIntercity();
}
fset.service_roundtrip.addEventListener('change', () => { $('#rt-fields').hidden = !fset.service_roundtrip.checked; syncPay(); });
fset.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fset), btn = $('#settings-save');
  if (!fset.pickup.checked && !fset.delivers.checked && !fset.ships_intercity?.checked && !fset.service_roundtrip.checked) return (err.textContent = 'اختر الاستلام أو التوصيل (المحلي أو لمدن ثانية) أو خدمة الاستلام والتسليم.');
  const rt = fset.service_roundtrip.checked, rtFee = num(fset.roundtrip_fee.value) ?? 0, rtOver = num(fset.roundtrip_free_over.value), exFee = num(fset.express_fee.value) ?? 0;
  if (rt && !(rtFee >= 0 && rtFee <= 500)) return (err.textContent = 'رسوم الاستلام والتسليم من 0 إلى 500 ريال.');
  if (rt && fset.express_enabled.checked && !(exFee >= 0 && exFee <= 500)) return (err.textContent = 'رسوم المستعجل من 0 إلى 500 ريال.');
  const person = isPerson();
  const cardDelivery = !person && (fset.delivers.checked || fset.service_roundtrip.checked) && fset.pay_card_delivery.checked;
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
    ...(fset.pay_tabby ? { pay_tabby: !person && fset.pay_tabby.checked, pay_tamara: !person && fset.pay_tamara.checked } : {}),
    service_roundtrip: rt, roundtrip_fee: rtFee, roundtrip_free_over: rt ? rtOver : null, turnaround_hours: Number(fset.turnaround_hours.value),
    express_enabled: rt && fset.express_enabled.checked, express_fee: exFee, express_hours: Number(fset.express_hours.value),
    ships_intercity: ships, intercity_fee_mode: feeMode, intercity_fee: ships && feeMode === 'buyer_fixed' ? interFee : null,
    intercity_eta: ships ? (fset.intercity_eta.value.trim() || null) : null, intercity_note: ships ? (fset.intercity_note.value.trim() || null) : null,
  };
  const { error } = await sb.from('store_settings').upsert(row);
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  toast('تم حفظ إعدادات التوصيل والاستلام ✓');
});

// ---------------- رابط الدفع الإلكتروني الخاص بالتاجر ----------------
// المشتري يدفع للتاجر مباشرة (بوابة باسمه أو متجره في سلة/زد). يعتمده الأدمن مثل الآيبان، وينسحب الاعتماد لو تغيّر.
const fpl = $('#f-paylink');
function renderPayLink() {
  if (!fpl) return;
  fpl.hidden = !(ctx?.owner && merchant);
  if (fpl.hidden) return;
  fpl.provider.value = merchant.pay_link_provider || ''; fpl.link.value = merchant.pay_link || '';
  $('#paylink-clear').hidden = !merchant.pay_link;
  $('#paylink-state').textContent = !merchant.pay_link ? ''
    : merchant.pay_link_verified_at ? '✔ رابطك معتمد من الإدارة.' : '⏳ رابطك بانتظار مراجعة الإدارة.';
}
async function savePayLink(provider, link) {
  const err = $('.err', fpl), btn = $('#paylink-save');
  setBusy(btn, true);
  const { error } = await sb.rpc('set_pay_link', { provider, link });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  err.textContent = '';
  Object.assign(merchant, { pay_link: link || null, pay_link_provider: link ? provider : null, pay_link_verified_at: null, pay_link_verified_note: null });
  renderPayLink();
  toast(link ? 'تم حفظ الرابط ✓ بيراجعه فريقنا قريبًا.' : 'تم حذف الرابط.');
}
fpl?.addEventListener('submit', e => {
  e.preventDefault();
  const err = $('.err', fpl), link = fpl.link.value.trim(), provider = fpl.provider.value;
  if (!provider) return (err.textContent = 'اختر نوع الرابط.');
  if (!/^https:\/\/[^\s\/]+\.[^\s\/]+(\/\S*)?$/.test(link) || link.length > 300) return (err.textContent = 'اكتب رابط صحيح يبدأ بـ https://');
  savePayLink(provider, link);
});
$('#paylink-clear')?.addEventListener('click', () => { if (confirm('تحذف رابط الدفع؟')) savePayLink('', ''); });

// ---------------- بياناتك: نسخة، موافقة الموقع، حذف الحساب (نظام حماية البيانات الشخصية) ----------------
function renderMyData() {
  const box = $('#my-data'); if (!box) return;
  box.hidden = !(ctx?.owner && merchant);
  if (box.hidden) return;
  const person = isPerson(), st = $('#loc-consent-state'), tg = $('#loc-consent-toggle');
  st.hidden = tg.hidden = !person;
  if (person) {
    st.textContent = merchant.location_consent_at ? '📍 موافق على حفظ موقعك واستخدامه لعرض متجرك.' : '📍 ما وافقت على استخدام موقعك، فما تظهر للزبائن على الخريطة.';
    tg.textContent = merchant.location_consent_at ? 'سحب موافقة الموقع' : 'الموافقة على استخدام الموقع';
  }
}
$('#loc-consent-toggle')?.addEventListener('click', async e => {
  const agree = !merchant.location_consent_at, btn = e.currentTarget;
  if (!agree && !confirm('سحب الموافقة يوقف ظهورك على الخريطة، ويطفّي «متاح الآن» لو كان شغّال. تكمل؟')) return;
  setBusy(btn, true);
  if (!agree && merchant.kind === 'mobile' && merchant.availability && merchant.availability !== 'off') await sb.rpc('set_availability', { st: 'off' });
  const { error } = await sb.rpc('set_location_consent', { agree });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  merchant.location_consent_at = agree ? new Date().toISOString() : null;
  if (!agree) Object.assign(merchant, { availability: 'off', live_until: null, live_at: null });
  renderMyData(); if (typeof renderLive === 'function') renderLive();
  toast(agree ? 'تم ✓ وافقت على استخدام الموقع.' : 'تم سحب موافقتك على استخدام الموقع.');
});
$('#data-export')?.addEventListener('click', async e => {
  const btn = e.currentTarget; setBusy(btn, true);
  try {
    const id = merchant.id, q = t => sb.from(t).select('*').eq('merchant_id', id);
    const [s, p, i, t] = await Promise.all([q('store_settings'), q('products'), q('merchant_ibans'), q('merchant_staff')]);
    const out = { exported_at: new Date().toISOString(), account: { email: user?.email }, merchant, store_settings: s.data || [], products: p.data || [], extra_ibans: i.data || [], staff: t.data || [],
      note: 'المستندات المرفوعة (السجل والهوية وشهادات الآيبان) أسماؤها في الحقول التي تنتهي بـ _path. تقدر تطلب نسخها من فريقنا.' };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = `tahassalah-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('تم تنزيل نسخة من بياناتك ✓');
  } catch (ex) { toast(friendlyError(ex)); }
  finally { setBusy(btn, false); }
});
$('#data-delete')?.addEventListener('click', async e => {
  const m = merchant, btn = e.currentTarget;
  const typed = prompt(`حذف حسابك نهائيًا؟\nينحذف متجرك ومنتجاتك وفريقك ومستنداتك وإيميل الدخول، ولا يمكن التراجع.\n\nللتأكيد اكتب اسم متجرك بالضبط: ${m.store_name}`, '');
  if (typed === null) return;
  if (typed.trim() !== m.store_name.trim()) return toast('الاسم ما يطابق. ما انحذف شي.');
  setBusy(btn, true, 'جارِ الحذف…');
  try {
    const { data: xs } = await sb.from('merchant_ibans').select('cert_path').eq('merchant_id', m.id);
    const docs = [m.cr_path, m.id_path, m.vat_path, m.iban_path, ...(m.extra_docs || []), ...(xs || []).map(x => x.cert_path)].filter(Boolean);
    const { data: prods } = await sb.from('products').select('image_path').eq('merchant_id', m.id).not('image_path', 'is', null);
    const imgs = (prods || []).map(p => p.image_path);
    if (docs.length) { const { error } = await sb.storage.from('merchant-docs').remove(docs); if (error) throw error; }
    if (imgs.length) { const { error } = await sb.storage.from('product-images').remove(imgs); if (error) throw error; }
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    await sb.auth.signOut();
    alert('تم حذف حسابك وكل بياناته. شكرًا لك.');
    location.href = 'index.html';
  } catch (ex) { toast(friendlyError(ex)); setBusy(btn, false); }
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
  if (mode !== 'off' && !merchant.location_consent_at) {
    if (!confirm('عشان تظهر للزبائن لازم توافق على حفظ موقعك واستخدامه وقت ما تكون «متاح» أو «مشغول» فقط.\nتقدر تسحب موافقتك من «بياناتك» في «التوصيل والاستلام».\n\nتوافق؟')) return;
    const { error } = await sb.rpc('set_location_consent', { agree: true });
    if (error) return toast(friendlyError(error));
    merchant.location_consent_at = new Date().toISOString(); renderMyData();
  }
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

// ---------------- طلبات المشترين ----------------
const O_STATUS = { placed: ['جديد', 'pending'], accepted: ['مقبول', 'approved'], preparing: ['جاري التجهيز', 'approved'], ready: ['جاهز', 'approved'],
  out: ['مع المندوب', 'approved'], delivered: ['تم التسليم', 'approved'], picked_up: ['تم الاستلام', 'approved'], rejected: ['مرفوض', 'rejected'], cancelled: ['ملغي', 'suspended'],
  to_collect: ['بانتظار الاستلام من الزبون', 'pending'], collecting: ['المندوب رايح يستلم', 'approved'], at_store: ['وصلت المحل', 'approved'], processing: ['قيد التنفيذ', 'approved'] };
const O_PAY = { cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل', tabby: 'تابي', tamara: 'تمارا' };
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out', 'to_collect', 'collecting', 'at_store', 'processing'];
const FUL = { delivery: '🛵 توصيل', pickup: '🏪 استلام من المحل', roundtrip: '🧺 استلام وتسليم' };
const when = d => new Date(d).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
let ordersCache = [], seenNew = new Set(), pollTimer = null, primed = false;
const mapLink = o => o.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}` : null;
const waLink = p => p ? 'https://wa.me/966' + String(p).replace(/\D/g, '').replace(/^(966|0)/, '') : null;
async function orderAct(o, action, args = {}) {
  const { error } = await sb.rpc('order_action_v', { oid: o.id, action, args });
  if (error) {
    const m = String(error.message);
    return toast(m.includes('pay_before_delivery') ? 'الطلب تحويل: أكّد استلام المبلغ قبل ما تحوّله للمندوب.' : m.includes('driver_not_found') ? 'المندوب مو مفعّل في فريق المتجر.' : m.includes('code_required') ? 'لازم رمز التسليم من الزبون أول.' : m.includes('reason_required') ? 'اكتب السبب.' : m.includes('invalid_state') ? 'حالة الطلب تغيّرت، حدّث الصفحة.' : friendlyError(error));
  }
  if (!$('#p-orders').hidden) loadOrders(); if (!$('#p-deliveries').hidden) loadDeliveries();
}
function orderBox(o, mode) {
  const el = document.createElement('div'); el.className = 'card stack'; el.style.padding = '14px';
  const head = document.createElement('div'); head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center';
  const t = document.createElement('b'); t.textContent = `${o.number} · ${o.buyer_name}`;
  const b = document.createElement('span'); b.className = 'badge ' + O_STATUS[o.status][1]; b.textContent = O_STATUS[o.status][0];
  head.append(t, b); el.append(head);
  const line = (txt, cls = 'hint') => { const p = document.createElement('div'); p.className = cls; p.textContent = txt; el.append(p); return p; };
  if (mode === 'driver') line(`🏪 ${o.store_name}${o.store_district ? ' · ' + o.store_district : ''}`, '');
  line(o.items.map(i => `${i.name} × ${i.qty}`).join('، '), '');
  line(`${money(o.total)} · ${FUL[o.fulfillment]}${o.express ? ' ⚡ مستعجل' : ''} · ${O_PAY[o.payment_method]} · ${o.payment_status === 'paid' ? 'مدفوع ✓' : o.payment_status === 'proof' ? '📎 وصل إيصال تحويل' : 'غير مدفوع'}`);
  line(new Date(o.created_at).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }));
  if (o.fulfillment !== 'pickup' && o.address) line('📍 ' + o.address);
  else if (o.fulfillment !== 'pickup' && mode === 'orders') line('📍 عنوان الزبون وجواله يطلعون للمندوب بعد التحويل.');
  if (o.fulfillment === 'roundtrip') {
    if (o.collect_at && ['placed', 'accepted', 'to_collect', 'collecting'].includes(o.status)) line('🕒 وقت الاستلام من الزبون: ' + when(o.collect_at), '');
    if (o.return_due_at && !['delivered', 'rejected', 'cancelled'].includes(o.status)) line('⏰ يرجع للزبون قبل: ' + when(o.return_due_at), '');
    if (o.collect_driver_name && mode === 'orders') line('🧺 مندوب الاستلام: ' + o.collect_driver_name);
    if (o.adjust_pending) line('⚠️ تعدّل العدد، بانتظار موافقة الزبون على المبلغ الجديد' + (o.adjust_note ? ': ' + o.adjust_note : ''), 'low');
  }
  if (o.note) line('📝 ' + o.note);
  if (o.driver_name && mode === 'orders') line((o.fulfillment === 'roundtrip' ? '🛵 مندوب التسليم: ' : '🛵 المندوب: ') + o.driver_name);
  if (o.collected_amount != null && o.fulfillment !== 'pickup') line(`استلم المندوب ${money(o.collected_amount)} ${o.collected_method === 'card' ? 'شبكة' : 'نقدًا'}` + (o.collected_method === 'cash' && mode === 'orders' ? (o.cash_handover_id ? ' · سلّمه للمحل ✓' : ' · لسا معه') : ''));
  if (o.collected_amount != null && o.fulfillment === 'pickup') line(`دفع ${money(o.collected_amount)} ${o.collected_method === 'card' ? 'شبكة' : 'نقدًا'} عند الكاونتر`);
  if (mode === 'orders' && ctx?.pro && o.history?.length) line('👤 ' + o.history.map(h => `${O_ACT[h.a] || h.a}: ${h.by} ${new Date(h.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}`).join(' · '));
  const acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  const btn = (txt, cls, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn sm ' + cls; x.textContent = txt; x.onclick = fn; acts.append(x); return x; };
  const link = (txt, href) => { if (!href) return; const a = document.createElement('a'); a.className = 'btn ghost sm'; a.textContent = txt; a.href = href; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); };
  const pickDriver = (label, action) => {
    const sel = document.createElement('select'); sel.style.width = 'auto'; sel.append(new Option('اختر المندوب…', ''));
    sb.rpc('store_drivers', { mid: o.merchant_id }).then(({ data }) => {
      (data || []).forEach(d => sel.append(new Option(`${d.name || d.email}${d.open_orders ? ` (معه ${d.open_orders})` : ''}`, d.id)));
      if (!data?.length) sel.replaceChildren(new Option('ما عندك مندوب مفعّل. أضفه من «الفريق».', ''));
    });
    acts.append(sel);
    btn(label, 'primary', () => { if (!sel.value) return toast('اختر المندوب.'); orderAct(o, action, { staff_id: sel.value }); });
  };
  // صورة الاستلام / التسليم: من كاميرا الصفحة مباشرة (بدون اختيار ملف)، وتطلع للكاشير وصاحب المحل فقط
  const camBtn = (label, cls, tag, after) => {
    const b = btn(label, cls, async () => {
      const shot = await takePhoto(`${o.number} · ${tag === 'collect' ? 'استلام من الزبون' : tag === 'pickup' ? 'استلام من المحل' : 'تسليم'}`);
      if (!shot) return;
      setBusy(b, true);
      try {
        const path = `${user.id}/${o.number}-${tag}-${Date.now()}.jpg`;
        const r = await sb.storage.from('receipts').upload(path, shot, { contentType: 'image/jpeg' }); if (r.error) throw r.error;
        await after([path]);
      } catch (ex) { toast(friendlyError(ex)); } finally { setBusy(b, false); }
    });
    return b;
  };
  // تعديل العدد: جدول بكل الخدمات في صفحة وحدة
  const adjustBtn = () => btn('✏️ تعديل العدد', 'ghost', () => {
    if (el.querySelector('.adj')) return;
    const box = document.createElement('div'); box.className = 'adj note stack';
    const rows = o.items.map(i => {
      const r = document.createElement('label'); r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px';
      const n = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 999, value: i.qty, inputMode: 'numeric' }); n.style.width = '80px';
      const s = document.createElement('span'); s.textContent = `${i.name} (${money(i.price)})`;
      r.append(s, n); box.append(r); return { i, n };
    });
    const note = Object.assign(document.createElement('input'), { placeholder: 'ملاحظة للزبون (اختياري)', maxLength: 200 });
    const tot = document.createElement('b');
    const calc = () => { tot.textContent = 'المنتجات بعد التعديل: ' + money(rows.reduce((s, r) => s + r.i.price * (Number(r.n.value) || 0), 0)); };
    rows.forEach(r => r.n.addEventListener('input', calc)); calc();
    const save = document.createElement('button'); save.type = 'button'; save.className = 'btn primary sm'; save.textContent = 'حفظ التعديل وإرساله للزبون';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn ghost sm'; cancel.textContent = 'إلغاء';
    cancel.onclick = () => box.remove();
    save.onclick = () => {
      const items = rows.filter(r => Number(r.n.value) !== r.i.qty).map(r => ({ id: r.i.id, qty: Math.max(0, Math.round(Number(r.n.value) || 0)) }));
      if (!items.length) return toast('ما فيه تغيير.');
      orderAct(o, 'adjust', { items, note: note.value });
    };
    const f = document.createElement('div'); f.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'; f.append(save, cancel);
    box.append(note, tot, f); el.insertBefore(box, acts);
  });
  // رمز التسليم: يكتبه المندوب/الكاشير من الزبون، وبدونه ما يكتمل التسليم
  const needCode = o.code_needed && !o.code_ok;
  const codeBox = (withHelp) => {
    if (o.code_locked) { line('🔒 انقفل رمز التسليم بعد 5 محاولات غلط.' + (mode === 'orders' ? ' تأكد من الزبون ووافق بدون رمز.' : ' تواصل مع المحل.'), 'low'); return; }
    const inp = Object.assign(document.createElement('input'), { inputMode: 'numeric', maxLength: 4, placeholder: 'رمز الزبون', autocomplete: 'off' });
    inp.dir = 'ltr'; inp.style.cssText = 'width:120px;letter-spacing:.3em;text-align:center';
    acts.append(inp);
    btn('🔐 تحقق من الرمز', 'primary', async () => {
      const code = inp.value.replace(/\D/g, '');
      if (code.length !== 4) return toast('الرمز 4 أرقام، اطلبه من الزبون.');
      const { data, error } = await sb.rpc('order_verify_code', { oid: o.id, code });
      if (error) return toast(friendlyError(error));
      if (data.ok) { toast('الرمز صحيح ✓'); return mode === 'orders' ? loadOrders() : loadDeliveries(); }
      toast(data.error === 'locked' ? 'انقفل الرمز بعد 5 محاولات غلط.' : `الرمز غلط. باقي ${data.left} محاولات.`);
      inp.value = ''; if (data.error === 'locked') (mode === 'orders' ? loadOrders() : loadDeliveries());
    });
    if (withHelp) btn(o.code_help_at ? '⏳ بانتظار موافقة المحل' : 'الزبون ما عنده الرمز', 'ghost', () => {
      if (o.code_help_at) return toast('أرسلنا للمحل. يتصل بالزبون ويوافق.');
      if (confirm('نرسل للمحل يتصل بالزبون ويوافق على التسليم بدون رمز؟')) orderAct(o, 'code_help');
    });
  };
  const overrideBtn = () => btn(o.code_help_at ? '🔐 المندوب يطلب موافقتك: سلّم بدون رمز' : '🔓 تسليم بدون رمز', o.code_help_at ? 'primary' : 'ghost', () => {
    const r = prompt('تأكدت من الزبون؟ اكتب السبب (ينحفظ باسمك):', o.code_help_at ? 'اتصلت بالزبون وأكّد' : '');
    if (r != null) orderAct(o, 'code_override', { reason: r });
  });
  if (o.buyer_confirmed_at) line('✅ الزبون أكّد الاستلام من جواله');
  else if (o.code_override_by) line(`🔓 تسليم بدون رمز، وافق: ${o.code_override_by}${o.code_override_reason ? ' · ' + o.code_override_reason : ''}`);
  else if (o.code_needed && o.code_ok && ['out', 'ready', 'accepted', 'preparing'].includes(o.status)) line('🔐 الرمز صحيح ✓');
  const allPhotos = [...(o.collect_photos || []), ...(o.pickup_photos || []), ...(o.delivery_photos || [])];
  if (allPhotos.length) btn(`📷 الصور (${allPhotos.length})`, 'ghost', async () => {
    for (const p of allPhotos) { const { data } = await sb.storage.from('receipts').createSignedUrl(p, 300); if (data) open(data.signedUrl, '_blank'); }
  });
  if (o.buyer_phone) { link('📞 اتصال', 'tel:+966' + String(o.buyer_phone).replace(/\D/g, '').replace(/^(966|0)/, '')); link('💬 واتساب الزبون', waLink(o.buyer_phone)); }
  if (mode === 'orders') {
    if (o.payment_proof && o.payment_status === 'proof') btn('📎 الإيصال', 'ghost', async () => { const { data } = await sb.storage.from('receipts').createSignedUrl(o.payment_proof, 300); if (data) open(data.signedUrl, '_blank'); });
    if (o.status === 'placed') { btn('✓ قبول', 'primary', () => orderAct(o, 'accept')); btn('رفض', 'ghost', () => { const r = prompt('سبب الرفض (يشوفه الزبون):'); if (r != null) orderAct(o, 'reject', { reason: r }); }); }
    if (o.status === 'accepted' && o.fulfillment !== 'roundtrip') btn('جاري التجهيز', 'ghost', () => orderAct(o, 'preparing'));
    if (o.fulfillment === 'roundtrip') {
      if (o.status === 'accepted') pickDriver('🧺 حوّل لمندوب الاستلام', 'assign_collect');
      if (o.status === 'at_store') { adjustBtn(); if (!o.adjust_pending) btn('▶️ بدأ التنفيذ', 'primary', () => orderAct(o, 'processing')); }
      if (o.status === 'processing') btn('✓ جاهز للتسليم', 'primary', () => orderAct(o, 'ready'));
      if (o.status === 'ready' && !o.driver_user_id) pickDriver('🛵 حوّل لمندوب التسليم', 'assign');
    }
    if (['accepted', 'preparing'].includes(o.status) && o.fulfillment === 'pickup') btn('جاهز للاستلام', 'ghost', () => orderAct(o, 'ready'));
    if (o.payment_status !== 'paid' && ['accepted', 'preparing', 'ready'].includes(o.status) && ['transfer', 'tabby', 'tamara'].includes(o.payment_method)) btn('✓ تم الدفع', 'ghost', () => { if (confirm('تأكدت إن المبلغ وصل؟')) orderAct(o, 'paid'); });
    if (o.fulfillment === 'pickup' && ['accepted', 'preparing', 'ready'].includes(o.status) && needCode) { codeBox(false); overrideBtn(); }
    else if (o.fulfillment === 'pickup' && ['accepted', 'preparing', 'ready'].includes(o.status)) {
      if (o.payment_status === 'paid') btn('✓ استلمه الزبون', 'primary', () => { if (confirm('الزبون استلم طلبه؟')) orderAct(o, 'picked_up'); });
      else {
        btn(`✓ استلم ودفع ${money(o.total)} نقدًا`, 'primary', () => { if (confirm(`الزبون استلم ودفع ${money(o.total)} نقدًا؟`)) orderAct(o, 'picked_up', { method: 'cash' }); });
        btn('✓ استلم والدفع شبكة', 'ghost', () => { if (confirm(`الزبون استلم ودفع ${money(o.total)} بالشبكة؟`)) orderAct(o, 'picked_up', { method: 'card' }); });
      }
    }
    if (o.fulfillment === 'delivery' && ['accepted', 'preparing', 'ready'].includes(o.status) && !o.driver_user_id) pickDriver('🛵 حوّل للمندوب', 'assign');
    if (o.status === 'out' && needCode && (o.code_help_at || o.code_locked)) overrideBtn();
    if (['accepted', 'preparing', 'to_collect'].includes(o.status)) btn('إلغاء', 'ghost', () => { const r = prompt('سبب الإلغاء (يشوفه الزبون):'); if (r != null) orderAct(o, 'reject', { reason: r }); });
  } else if (['to_collect', 'collecting'].includes(o.status)) {
    // مشوار الاستلام من الزبون
    link('🗺️ موقع الزبون', mapLink(o));
    if (o.status === 'to_collect') btn('🛵 رايح أستلم', 'primary', () => orderAct(o, 'collecting'));
    adjustBtn();
    camBtn('📷 استلمت (صوّر الأغراض)', 'primary', 'collect', photos => orderAct(o, 'collected', { photos }));
    const h = document.createElement('div'); h.className = 'hint'; h.style.width = '100%'; h.textContent = 'التصوير من الكاميرا مباشرة، والصورة توصل المحل وما تنحفظ في جوالك.'; acts.append(h);
    if (o.store_lat != null) link('🏪 موقع المحل', `https://www.google.com/maps/dir/?api=1&destination=${o.store_lat},${o.store_lng}`);
  } else {
    if (['ready'].includes(o.status) && o.store_lat != null) link('🏪 موقع المحل', `https://www.google.com/maps/dir/?api=1&destination=${o.store_lat},${o.store_lng}`);
    link('🗺️ موقع الزبون', mapLink(o));
    if (o.status === 'ready') camBtn('📷 استلمت الطلب من المحل (صوّره)', 'primary', 'pickup', photos => orderAct(o, 'out', { photos }));
    if (o.status === 'out' && needCode) {
      if (o.payment_status === 'paid') line('⏳ الطلب مدفوع: حطه عند الزبون، وانتظر يأكّد الاستلام من جواله. أو اطلب منه الرمز.', 'low');
      codeBox(true);
      const hint = document.createElement('div'); hint.className = 'hint'; hint.style.width = '100%'; hint.textContent = o.payment_status === 'paid' ? 'أول ما يأكّد الزبون يوصلك تنبيه، وتصوّر وتنهي التوصيل.' : 'اطلب من الزبون رمز التسليم (يطلع له في صفحة طلبه)، واكتبه هنا. بعدها تصوّر وتنهي التوصيل.'; acts.append(hint);
    } else if (o.status === 'out') {
      // صورة التسليم تنهي التوصيل
      if (o.payment_status === 'paid') camBtn('📷 صوّر التسليم وأنهِ', 'primary', 'delivered', photos => orderAct(o, 'delivered', { photos }));
      else {
        camBtn(`📷 سلّمت واستلمت ${money(o.total)} نقدًا`, 'primary', 'delivered', photos => orderAct(o, 'delivered', { amount: o.total, method: 'cash', photos }));
        camBtn('📷 سلّمت والدفع شبكة', 'ghost', 'delivered', photos => orderAct(o, 'delivered', { amount: o.total, method: 'card', photos }));
      }
      const hint = document.createElement('div'); hint.className = 'hint'; hint.style.width = '100%'; hint.textContent = 'صوّر الطلب عند الزبون من الكاميرا، وأول ما تستخدم الصورة يكتمل التوصيل. الصورة توصل المحل وما تنحفظ في جوالك.'; acts.append(hint);
    }
  }
  if (acts.children.length) el.append(acts);
  return el;
}
async function loadOrders() {
  const f = $('#o-filter').value, start = new Date(); start.setHours(0, 0, 0, 0);
  let q = sb.from('orders_v').select('*').eq('merchant_id', ctx.mid).order('created_at', { ascending: false }).limit(200);
  if (f === 'active') q = q.in('status', ACTIVE);
  if (f === 'done') q = q.in('status', ['delivered', 'picked_up']).gte('done_at', start.toISOString());
  const { data, error } = await q;
  if (error) return toast(friendlyError(error));
  ordersCache = data;
  $('#o-list').replaceChildren(...data.map(o => orderBox(o, 'orders')));
  if (!data.length) $('#o-list').append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'ما فيه طلبات هنا.' }));
  const cash = data.filter(o => o.fulfillment !== 'pickup' && o.collected_method === 'cash' && o.done_at && new Date(o.done_at) >= start).reduce((s, o) => s + Number(o.collected_amount), 0);
  $('#o-cash').textContent = f === 'done' ? `كاش استلمه المندوبين اليوم: ${money(cash)}` : '';
  renderShift(); renderCustody();
}
$('#o-filter').addEventListener('change', loadOrders);
// تنبيه الطلبات الجديدة: عدّاد وصوت كل 20 ثانية
function pollOrders() {
  clearInterval(pollTimer);
  const tick = async () => {
    if (!ctx || !canOrders() || document.hidden) return;
    const { data } = await sb.from('orders_v').select('id').eq('merchant_id', ctx.mid).eq('status', 'placed');
    const n = data?.length || 0, c = $('#c-orders');
    c.hidden = !n; c.textContent = n;
    const fresh = (data || []).filter(x => !seenNew.has(x.id));
    fresh.forEach(x => seenNew.add(x.id));
    if (fresh.length && primed) {
      toast(`🧾 طلب جديد (${fresh.length})`);
      try { const a = new AudioContext(), osc = a.createOscillator(); osc.connect(a.destination); osc.frequency.value = 880; osc.start(); osc.stop(a.currentTime + 0.3); } catch {}
      if (!$('#p-orders').hidden) loadOrders();
    }
    primed = true;
  };
  seenNew = new Set(); primed = false; tick(); pollTimer = setInterval(tick, 20000);
}
async function loadDeliveries() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  // كل المحلات اللي يوصّل لها في قائمة وحدة
  const { data: all, error } = await sb.from('orders_v').select('*')
    .or(`driver_user_id.eq.${user.id},collect_driver_user_id.eq.${user.id}`).gte('updated_at', new Date(Date.now() - 7 * 864e5).toISOString())
    .order('created_at', { ascending: false });
  // مهامي: استلام من الزبون، توصيل/تسليم، والمسلّم اليوم
  const data = (all || []).filter(o => (o.collect_driver_user_id === user.id && ['to_collect', 'collecting'].includes(o.status))
    || (o.driver_user_id === user.id && (['ready', 'out'].includes(o.status) || (o.done_at && new Date(o.done_at) >= start))));
  if (error) return toast(friendlyError(error));
  const open = data.filter(o => ['ready', 'out', 'to_collect', 'collecting'].includes(o.status));
  // العهدة: الكاش اللي معي ولسا ما استلمه كاشير المحل
  const { data: cus } = await sb.rpc('my_custody');
  const cashTxt = (cus || []).map(c => `${c.store_name}: ${money(c.amount)}`).join(' · ');
  $('#dl-sum').textContent = `عندك ${open.length} طلب للتوصيل · سلّمت اليوم ${data.length - open.length}` + (cashTxt ? ` · الكاش اللي معك (سلّمه لكل محل): ${cashTxt}` : '');
  const c = $('#c-deliv'); c.hidden = !open.length; c.textContent = open.length;
  $('#dl-list').replaceChildren(...data.map(o => orderBox(o, 'driver')));
  if (!data.length) $('#dl-list').append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'ما عندك طلبات الحين. أول ما يحوّل لك الكاشير طلب يطلع هنا.' }));
}
setInterval(() => { if (!document.hidden && !$('#p-deliveries').hidden) loadDeliveries(); }, 30000);

// ---------------- مناوبات الكاشير والعهدة ----------------
const O_ACT = { accept: 'قبله', reject: 'رفضه', preparing: 'جهّزه', ready: 'جاهز', assign: 'حوّله للمندوب', assign_collect: 'حوّله لمندوب الاستلام',
  picked_up: 'سلّمه للزبون', paid: 'أكّد الدفع', processing: 'بدأ التنفيذ', out: 'طلع فيه', delivered: 'سلّمه', collected: 'استلم من الزبون',
  collecting: 'راح يستلم', code_ok: 'تحقق من الرمز', code_help: 'طلب موافقة بدون رمز', code_override: 'وافق بدون رمز', buyer_confirm: 'أكّد الاستلام', adjust: 'عدّل العدد', approve_adjust: 'وافق على التعديل', proof: 'أرسل الإيصال' };
const SHIFT_ERR = { bad_pin: 'الرقم السري غلط.', pin_locked: 'محاولات كثيرة غلط. انتظر 10 دقايق.', shift_open: 'فيه مناوبة مفتوحة على هذا الجهاز.', bad_amount: 'اكتب المبلغ صح.', not_allowed: 'ما عندك صلاحية الطلبات في هذا المحل.' };
const numIn = v => Number(String(v || '0').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.'));
const tm = d => new Date(d).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
let myShift = null;
// بطاقة «متاح في الباقة المميزة»
function proLock(what) {
  const d = mk('div'); d.style.cssText = 'display:grid;gap:4px';
  d.append(mk('b', '', '🔒 ' + what), mk('div', 'hint', 'متاحة في الباقة المميزة (119 ر.س شهريًا). تواصل معنا للترقية.'));
  return d;
}

async function renderShift() {
  const bar = $('#shift-bar');
  if (!ctx || !canOrders()) { bar.hidden = true; return; }
  if (!ctx.pro) {
    bar.hidden = !ctx.owner;
    bar.replaceChildren(proLock('مناوبات الكاشير بالرقم السري، وتقرير إغلاق الدرج، وعهدة كاش المندوبين'));
    return;
  }
  const { data } = await sb.from('cashier_shifts').select('*').eq('merchant_id', ctx.mid).eq('device_user_id', user.id).is('ended_at', null).maybeSingle();
  myShift = data; bar.hidden = false;
  const txt = mk('div');
  const b = (label, cls, fn) => { const x = mk('button', 'btn sm ' + cls, label); x.type = 'button'; x.onclick = fn; return x; };
  const acts = mk('div'); acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  if (myShift) {
    txt.append(mk('b', '', `🟢 على المناوبة: ${myShift.cashier_name}`), mk('div', 'hint', `من ${tm(myShift.started_at)} · كل حركة تنحفظ باسمه، والتنبيهات تجي هذا الجهاز.`));
    acts.append(b('⏹ إنهاء المناوبة', 'ghost', openShiftEnd));
  } else {
    txt.append(mk('b', '', '⚪ ما فيه مناوبة على هذا الجهاز'), mk('div', 'hint', 'ابدأ مناوبتك عشان تنحفظ الطلبات والكاش باسمك، وتوصلك تنبيهات الطلبات.'));
    acts.append(b('▶️ ابدأ مناوبة', 'primary', openShiftStart));
  }
  bar.replaceChildren(txt, acts);
}

async function openShiftStart() {
  const f = $('#f-shift'); f.reset(); $('.err', f).textContent = '';
  const { data } = await sb.from('counter_cashiers').select('id,name').eq('merchant_id', ctx.mid).eq('active', true).order('name');
  const me = ctx.owner ? 'أنا (صاحب المحل)' : 'أنا بحسابي';
  f.who.replaceChildren(...(data || []).map(c => new Option(c.name, c.id)), new Option(me, ''));
  const sync = () => { $('#shift-pin-row').hidden = !f.who.value; };
  f.who.onchange = sync; sync();
  $('#dlg-shift').showModal(); (f.who.value ? f.pin : f.opening).focus();
}
$('#shift-cancel').addEventListener('click', () => $('#dlg-shift').close());
$('#f-shift').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#shift-go');
  const opening = numIn(f.opening.value);
  if (!(opening >= 0)) return (err.textContent = 'اكتب مبلغ الدرج صح.');
  if (f.who.value && !/^\d{4,6}$/.test(f.pin.value)) return (err.textContent = 'اكتب الرقم السري.');
  setBusy(btn, true);
  const { data, error } = await sb.rpc('shift_start', { mid: ctx.mid, cashier: f.who.value || null, pin: f.who.value ? f.pin.value : null, opening });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  if (!data.ok) { f.pin.value = ''; return (err.textContent = SHIFT_ERR[data.error] || data.error); }
  $('#dlg-shift').close(); toast(`بدأت مناوبة ${data.name} ✓`); loadOrders();
});

const reportLines = r => [
  ['طلبات تعامل معها', r.orders, false], ['كاش الدرج أول المناوبة', r.opening], ['مبيعات نقد عند الكاونتر', r.cash_sales],
  ['مبيعات شبكة', r.card_sales], ['تحويلات أكّدها', r.transfers], [`كاش استلمه من المندوبين (${r.handovers_count})`, r.handovers],
  ['المفروض في الدرج', r.expected_cash],
].map(([k, v, m = true]) => { const d = mk('div'); d.style.cssText = 'display:flex;justify-content:space-between;gap:10px'; d.append(mk('span', '', k), mk('b', '', m ? money(v) : String(v))); return d; });

async function openShiftEnd() {
  if (!myShift) return;
  const f = $('#f-shiftend'); f.reset(); $('.err', f).textContent = '';
  const { data, error } = await sb.rpc('shift_report', { sid: myShift.id });
  if (error) return toast(friendlyError(error));
  $('#shift-report').replaceChildren(...reportLines(data));
  f.counted.value = data.expected_cash;
  $('#dlg-shiftend').showModal(); f.counted.select();
}
$('#shiftend-cancel').addEventListener('click', () => $('#dlg-shiftend').close());
$('#f-shiftend').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#shiftend-go');
  const counted = numIn(f.counted.value);
  if (!f.counted.value.trim() || !(counted >= 0)) return (err.textContent = 'اكتب الكاش اللي عدّيته.');
  setBusy(btn, true);
  const { data, error } = await sb.rpc('shift_end', { sid: myShift.id, counted, note: f.note.value });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  $('#dlg-shiftend').close();
  const d = Number(data.diff);
  toast(d === 0 ? 'انتهت المناوبة ✓ الدرج مطابق.' : `انتهت المناوبة. ${d > 0 ? 'زيادة' : 'نقص'} ${money(Math.abs(d))} في الدرج.`, 6000);
  loadOrders();
});

// عهدة المندوبين: الكاش اللي معهم للمحل، والكاشير يستلمه
async function renderCustody() {
  const box = $('#custody');
  if (!ctx || !canOrders() || !ctx.pro) { box.hidden = true; return; }
  const { data } = await sb.rpc('driver_custody', { mid: ctx.mid });
  box.hidden = !data?.length;
  if (!data?.length) return;
  const rows = data.map(c => {
    const r = mk('div'); r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap';
    r.append(mk('span', '', `🛵 ${c.driver_name || 'مندوب'}: ${money(c.amount)} (${c.orders} طلب)`));
    const x = mk('button', 'btn primary sm', '💵 استلمت الكاش'); x.type = 'button';
    x.onclick = async () => {
      const v = prompt(`كم استلمت من ${c.driver_name || 'المندوب'}؟ المفروض ${c.amount} ر.س`, String(c.amount));
      if (v == null) return;
      const amt = numIn(v);
      if (!(amt >= 0)) return toast('اكتب المبلغ صح.');
      const note = amt !== Number(c.amount) ? prompt('المبلغ مختلف. وش السبب؟ (يشوفه صاحب المحل)') : null;
      setBusy(x, true);
      const { data: h, error } = await sb.rpc('receive_cash', { mid: ctx.mid, driver: c.driver_user_id, received: amt, note });
      setBusy(x, false);
      if (error) return toast(String(error.message).includes('nothing_to_receive') ? 'ما فيه كاش معه الحين.' : friendlyError(error));
      toast(`استلمت ${money(h.received)} عن ${h.orders} طلب ✓`); loadOrders();
    };
    r.append(x); return r;
  });
  box.replaceChildren(mk('b', '', '💵 كاش مع المندوبين (لسا ما تسلّم)'), ...rows,
    mk('div', 'hint', myShift ? `يدخل في عهدة مناوبة ${myShift.cashier_name}.` : 'ابدأ مناوبة قبل الاستلام عشان يدخل الكاش في تقرير مناوبتك.'));
}

// ---------------- كاشيرية الكاونتر (صاحب المحل) ----------------
let editingCashier = null;
async function loadCashiers() {
  if (!ctx?.owner) return;
  $('#c-add').hidden = !ctx.pro;
  if (!ctx.pro) { $('#cashier-list').replaceChildren(proLock('كاشيرية الكاونتر بالرقم السري وسجل المناوبات')); return; }
  const { data, error } = await sb.from('counter_cashiers').select('id,name,phone,active').eq('merchant_id', ctx.mid).order('created_at');
  if (error) return toast(friendlyError(error));
  const box = $('#cashier-list');
  if (!data.length) { box.replaceChildren(mk('p', 'hint', 'ما أضفت كاشير بعد.')); return; }
  box.replaceChildren(...data.map(c => {
    const el = mk('div', 'row-card'), txt = mk('div');
    const t = mk('div', 't', c.name + ' '); t.append(mk('span', 'badge ' + (c.active ? 'approved' : 'suspended'), c.active ? 'مفعّل' : 'موقوف'));
    txt.append(t, mk('div', 's', (c.phone || 'بدون جوال') + ' · يدخل بالرقم السري'));
    const acts = mk('div', 'acts'), ed = mk('button', 'btn ghost sm', 'تعديل'); ed.type = 'button'; ed.onclick = () => openCashier(c);
    acts.append(ed); el.append(txt, acts); return el;
  }));
}
function openCashier(c) {
  editingCashier = c; const f = $('#f-cashier'); f.reset(); $('.err', f).textContent = '';
  $('#cashier-title').textContent = c ? 'تعديل الكاشير' : 'إضافة كاشير';
  $('#pin-hint').textContent = c ? 'اتركه فاضي إذا ما تبغى تغيّره. لا تستخدم رقم الهوية.' : 'يدخل فيه مناوبته. لا تستخدم رقم الهوية.';
  $('#cashier-del').hidden = !c;
  if (c) { f.name.value = c.name; f.phone.value = c.phone || ''; f.active.checked = c.active; }
  $('#dlg-cashier').showModal(); f.name.focus();
}
$('#c-add').addEventListener('click', () => openCashier(null));
$('#cashier-cancel').addEventListener('click', () => $('#dlg-cashier').close());
$('#cashier-del').addEventListener('click', async () => {
  if (!editingCashier || !confirm(`حذف ${editingCashier.name}؟ مناوباته السابقة تبقى في السجل.`)) return;
  const { error } = await sb.rpc('cashier_delete', { cid: editingCashier.id });
  if (error) return toast(friendlyError(error));
  $('#dlg-cashier').close(); loadCashiers();
});
$('#f-cashier').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('#cashier-save');
  const name = f.name.value.trim(), phone = f.phone.value.replace(/\D/g, ''), pin = f.pin.value.trim();
  if (name.length < 2) return (err.textContent = 'اكتب اسم الكاشير.');
  if (phone && !/^05\d{8}$/.test(phone)) return (err.textContent = 'الجوال يبدأ بـ 05 وفيه 10 أرقام.');
  if ((!editingCashier || pin) && !/^\d{4,6}$/.test(pin)) return (err.textContent = 'الرقم السري من 4 إلى 6 أرقام.');
  if (pin && /^(\d)\1+$/.test(pin) || ['1234', '12345', '123456'].includes(pin)) return (err.textContent = 'اختر رقم سري أصعب من كذا.');
  setBusy(btn, true);
  const { error } = await sb.rpc('cashier_save', { cid: editingCashier?.id || null, cname: name, cphone: phone || null, pin: pin || null, is_active: f.active.checked });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  $('#dlg-cashier').close(); toast('تم الحفظ ✓'); loadCashiers();
});

async function loadShiftLog() {
  if (!ctx?.owner) return;
  const [{ data: sh }, { data: ho }] = await Promise.all([
    sb.from('cashier_shifts').select('*').eq('merchant_id', ctx.mid).order('started_at', { ascending: false }).limit(30),
    sb.from('cash_handovers').select('*').eq('merchant_id', ctx.mid).order('at', { ascending: false }).limit(30),
  ]);
  const box = $('#shift-log'), items = [];
  (sh || []).forEach(s => {
    const el = mk('div', 'row-card'), txt = mk('div');
    const r = s.report || {}, d = s.ended_at ? Number(r.diff || 0) : null;
    const t = mk('div', 't', `${s.cashier_name} `);
    t.append(mk('span', 'badge ' + (!s.ended_at ? 'pending' : d === 0 ? 'approved' : 'rejected'), !s.ended_at ? 'مفتوحة' : d === 0 ? 'مطابق' : `${d > 0 ? 'زيادة' : 'نقص'} ${money(Math.abs(d))}`));
    txt.append(t, mk('div', 's', `${tm(s.started_at)}${s.ended_at ? ' ← ' + tm(s.ended_at) : ''}`));
    if (s.ended_at) txt.append(mk('div', 's', `نقد ${money(r.cash_sales)} · شبكة ${money(r.card_sales)} · تحويل ${money(r.transfers)} · من المندوبين ${money(r.handovers)} · المفروض ${money(r.expected_cash)} · عدّ ${money(r.counted)}${s.note ? ' · ' + s.note : ''}`));
    el.append(txt); items.push([s.started_at, el]);
  });
  (ho || []).forEach(h => {
    const el = mk('div', 'row-card'), txt = mk('div');
    const t = mk('div', 't', `💵 ${h.received_by_name || ''} استلم ${money(h.received)} من ${h.driver_name || 'المندوب'} `);
    if (Number(h.received) !== Number(h.expected)) t.append(mk('span', 'badge rejected', `المفروض ${money(h.expected)}`));
    txt.append(t, mk('div', 's', `${tm(h.at)} · ${h.order_ids.length} طلب${h.note ? ' · ' + h.note : ''}`));
    el.append(txt); items.push([h.at, el]);
  });
  items.sort((a, b) => new Date(b[0]) - new Date(a[0]));
  box.replaceChildren(...(items.length ? items.map(x => x[1]) : [mk('p', 'hint', 'ما فيه مناوبات بعد.')]));
}

// ---------------- ربط المخزون مع نظام الكاشير ----------------
async function loadPos() {
  if (!ctx?.owner) return;
  const [{ data: link }, { count: noBarcode }] = await Promise.all([
    sb.from('pos_links').select('key_hint,created_at,last_sync_at,last_result').eq('merchant_id', ctx.mid).maybeSingle(),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('merchant_id', ctx.mid).or('barcode.is.null,barcode.eq.'),
  ]);
  const st = $('#pos-state'), lines = [];
  $('#pos-create').hidden = !ctx.pro;
  if (!ctx.pro) { $('#pos-revoke').hidden = true; st.replaceChildren(proLock('ربط المخزون التلقائي مع نظام الكاشير')); return; }
  if (!link) lines.push(mk('p', 'hint', 'الربط مو مفعّل. أنشئ مفتاح، وأعطه مع رابط «طريقة الربط» لمزوّد نظام الكاشير حقك.'));
  else {
    lines.push(mk('div', '', `✅ الربط مفعّل · المفتاح ينتهي بـ …${link.key_hint}`));
    if (!link.last_sync_at) lines.push(mk('div', 'low', '⏳ ما وصلنا أي تحديث من نظام الكاشير بعد.'));
    else {
      const hrs = (Date.now() - new Date(link.last_sync_at)) / 36e5, r = link.last_result || {};
      lines.push(mk('div', hrs > 24 ? 'low' : 'hint', `${hrs > 24 ? '⚠️ آخر تحديث من أكثر من يوم: ' : 'آخر تحديث: '}${tm(link.last_sync_at)} · تحدّث ${r.updated || 0} منتج` + (r.unknown_count ? ` · ${r.unknown_count} باركود ما له منتج عندنا` : '')));
      if (r.unknown?.length) lines.push(mk('div', 'hint', 'باركودات ما لقيناها: ' + r.unknown.slice(0, 10).join('، ')));
    }
    const url = mk('code', '', `${SUPABASE_URL}/functions/v1/stock-sync`); url.dir = 'ltr'; url.style.cssText = 'word-break:break-all';
    lines.push(mk('div', 'hint', 'رابط الربط:'), url);
  }
  if (noBarcode) lines.push(mk('div', 'low', `⚠️ عندك ${noBarcode} منتج بدون باركود، هذي ما تتحدّث من نظام الكاشير.`));
  st.replaceChildren(...lines);
  $('#pos-create').textContent = link ? 'مفتاح جديد (يلغي القديم)' : 'إنشاء مفتاح الربط';
  $('#pos-revoke').hidden = !link;
}
$('#pos-create').addEventListener('click', async e => {
  if ($('#pos-revoke').hidden === false && !confirm('المفتاح القديم يوقف فورًا، ولازم تعطي الجديد لمزوّد نظام الكاشير. تكمل؟')) return;
  setBusy(e.target, true);
  const { data, error } = await sb.rpc('pos_key_create');
  setBusy(e.target, false);
  if (error) return toast(friendlyError(error));
  try { await navigator.clipboard.writeText(data); } catch {}
  prompt('هذا مفتاح الربط. انسخه وأعطه لمزوّد نظام الكاشير. ما يطلع مرة ثانية (انتسخ تلقائيًا):', data);
  loadPos();
});
$('#pos-revoke').addEventListener('click', async () => {
  if (!confirm('إيقاف الربط؟ نظام الكاشير ما يقدر يحدّث الكميات بعدها.')) return;
  const { error } = await sb.rpc('pos_key_revoke');
  if (error) return toast(friendlyError(error));
  loadPos();
});

// ---------------- مؤشرات الأداء (الباقة المميزة) ----------------
const FUL_NAME = { delivery: 'توصيل', pickup: 'استلام من المحل', roundtrip: 'استلام وتسليم' };
async function loadStats() {
  const body = $('#st-body');
  if (!ctx?.owner) return;
  if (!ctx.pro) { body.replaceChildren(S.section('📊 مؤشرات الأداء', null, proLock('مؤشرات أداء المحل: المنتجات الأكثر طلبًا، وأداء المندوبين والكاشيرية، وأوقات الذروة'))); return; }
  body.replaceChildren(S.mk('p', 'hint', 'جارِ التحميل…'));
  const days = Number($('#st-days').value);
  const { data: d, error } = await sb.rpc('store_stats', { mid: ctx.mid, days });
  if (error) return body.replaceChildren(S.mk('p', 'err', friendlyError(error)));
  const rate = d.orders ? Math.round(d.done / d.orders * 100) : 0;
  const shifts = Object.fromEntries((d.shifts || []).map(x => [x.name, x]));
  const names = [...new Set([...(d.cashiers || []).map(x => x.name), ...Object.keys(shifts)])];
  body.replaceChildren(
    S.kpis([
      ['الطلبات', S.nf(d.orders), `${S.nf(d.done)} مكتمل · ${rate}%`],
      ['المبيعات', S.sar(d.sales), `متوسط الطلب ${S.sar(d.avg_order)}`],
      ['القطع المباعة', S.nf(d.items_sold)],
      ['الزبائن', S.nf(d.buyers), `${S.nf(d.repeat_buyers)} رجعوا وطلبوا مرة ثانية`],
      ['وقت القبول', S.mins(d.accept_min), 'من وصول الطلب لين القبول'],
      ['وقت التوصيل', S.mins(d.deliver_min), 'من طلوع المندوب لين التسليم'],
      ['مرفوض / ملغي', `${S.nf(d.rejected)} / ${S.nf(d.cancelled)}`],
    ]),
    S.section('الطلبات اليومية', 'مرّر على العمود تشوف العدد.', S.dayCols(d.by_day || [], days)),
    S.section('🔥 المنتجات الأكثر طلبًا', d.no_sales ? `${S.nf(d.no_sales)} منتج ظاهر ما انطلب ولا مرة في هذي الفترة. جرّب عليها عرض أو صورة أوضح.` : null,
      S.bars((d.top_products || []).map(p => ({ label: p.name, value: p.qty, note: S.sar(p.rev) })))),
    d.low_stock?.length ? S.section('⚠️ منتجات عليها طلب وكميتها قليلة', null, S.bars(d.low_stock.map(p => ({ label: p.name, value: p.qty, note: p.unit || '' })))) : null,
    S.section('🛵 أداء المندوبين', null, S.table(['المندوب', 'سلّم', 'متوسط التوصيل', 'كاش استلمه', 'معه الحين', 'تسليم بدون رمز', 'بالطريق'],
      (d.drivers || []).map(x => [x.name, S.nf(x.delivered), S.mins(x.avg_min), S.sar(x.cash), S.sar(x.cash_held), S.nf(x.overrides), S.nf(x.on_road)]))),
    S.section('🧑‍💼 أداء الكاشيرية', 'من سجل الحركات والمناوبات.', S.table(['الاسم', 'طلبات تعامل معها', 'قبل', 'رفض', 'سلّم للزبون', 'متوسط القبول', 'مناوبات', 'ساعات', 'فرق الدرج'],
      names.map(n => { const c = (d.cashiers || []).find(x => x.name === n) || {}, s = shifts[n] || {};
        return [n, S.nf(c.orders), S.nf(c.accepted), S.nf(c.rejected), S.nf(c.handed), S.mins(c.accept_min), S.nf(s.shifts), S.nf(s.hours), s.shifts ? (Number(s.diff) === 0 ? 'مطابق' : S.sar(s.diff)) : '—']; }))),
    S.section('⏰ أوقات الذروة', 'كم طلب يجيك في كل ساعة. رتّب عدد الكاشيرية والمندوبين على هذي الأوقات.', S.hourCols(d.by_hour || [])),
    S.section('طريقة الاستلام والدفع', null,
      S.bars(Object.entries(d.by_fulfillment || {}).map(([k, v]) => ({ label: FUL_NAME[k] || k, value: v }))),
      S.bars(Object.entries(d.by_payment || {}).map(([k, v]) => ({ label: O_PAY[k] || k, value: v })))),
    S.section('🔐 تأكيد التسليم', null, S.kpis([['برمز التسليم', S.nf(d.confirm?.code)], ['أكّده الزبون بنفسه', S.nf(d.confirm?.buyer)], ['بدون رمز (بموافقة المحل)', S.nf(d.confirm?.override)]])),
  );
}
$('#st-days').addEventListener('change', loadStats);
