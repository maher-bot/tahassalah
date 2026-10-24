import { rememberLogin, hidePasswords, sb, $, $$, toast, PLANS, planLabel, KINDS, KIND_ICON, STATUS, friendlyError, setBusy, trialInfo, fmtDay, valid, clean, digits } from './lib.js';

const VIEWS = ['v-loading', 'v-login', 'v-denied', 'v-list'];
const show = id => VIEWS.forEach(v => { $('#' + v).hidden = v !== id; });
let all = [], tab = 'pending', routedFor = undefined;
const focusId = location.hash.slice(1);

$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button', f);
  setBusy(btn, true);
  hidePasswords(f);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (!error) rememberLogin(f.email.value.trim(), f.password.value);
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
  { const ts = $('#to-store'); if (ts) ts.hidden = true; }
  if (!user) return show('v-login');
  show('v-loading');
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error) { $('#v-loading').textContent = friendlyError(error); return; }
  if (!isAdmin) return show('v-denied');
  show('v-list');
  // الأدمن اللي له متجر يشوف رابط «متجري»
  sb.from('merchants').select('id').eq('id', user.id).maybeSingle().then(({ data }) => { const ts = $('#to-store'); if (ts) ts.hidden = !data; });
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
  const list = all.filter(m => m.status === tab && (!q || [m.store_name, m.owner_name, m.cr_number, m.id_number, m.phone, m.email, m.city, KINDS[m.kind]].some(x => (x || '').toLowerCase().includes(q))));
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
  const person = m.kind && m.kind !== 'store';
  head.append(t('h3', m.store_name), t('span', STATUS[m.status], 'badge ' + m.status));
  if (person) head.append(t('span', `${KIND_ICON[m.kind]} ${KINDS[m.kind]}`, 'kind-chip'));
  if (person) head.append(t('span', m.site_verified_at ? '✔ تمت المعاينة' : '⚠️ بدون معاينة ميدانية', 'badge ' + (m.site_verified_at ? 'approved' : 'pending')));
  if (m.license_verified_at) head.append(t('span', '🏅 موثّق برخصة', 'badge approved'));
  if (m.iban_verified_at) head.append(t('span', '✔ الآيبان مطابق ' + (person ? 'للهوية' : 'للسجل'), 'badge approved'));
  if (!person && m.cr_check) {
    const c = m.cr_check, good = c.found && c.active && c.owner_match !== false;
    head.append(t('span', c.error ? '⚠️ واثق: تعذر التحقق' : !c.found ? '❌ واثق: السجل غير موجود' : good ? '✔ واثق: السجل ساري ومطابق' : !c.active ? '❌ واثق: السجل غير ساري' : '⚠️ واثق: اسم المالك مختلف',
      'badge ' + (good ? 'approved' : c.error || c.found ? 'pending' : 'rejected')));
  }
  head.append(t('span', 'أُرسل ' + fmtDate(m.submitted_at), 'hint num'));

  const kv = document.createElement('div'); kv.className = 'kv';
  const add = (k, v, ltr) => { const d = document.createElement('div'); d.append(t('span', k)); const b = t('b', v || '—'); if (ltr) { b.dir = 'ltr'; b.className = 'num'; } d.append(b); kv.append(d); };
  add('المالك', m.owner_name); add('النشاط', m.activity); add('المدينة', [m.city, m.district].filter(Boolean).join(' — '));
  add('العنوان الوطني', m.national_address, true);
  add('الجوال', m.phone, true); add('الإيميل', m.email, true);
  if (m.iban_verified_at) add('مطابقة الآيبان', fmtDate(m.iban_verified_at) + (m.iban_verified_note ? ' — ' + m.iban_verified_note : ''));
  if (person) {
    add('رقم الهوية', m.id_number, true);
    add('وثيقة العمل الحر / رخصة', m.license_number, !!m.license_number);
    if (m.site_verified_at) add('المعاينة الميدانية', fmtDate(m.site_verified_at) + (m.site_verified_note ? ' — ' + m.site_verified_note : ''));
    if (m.license_verified_at) add('شارة موثّق برخصة', fmtDate(m.license_verified_at) + (m.license_verified_note ? ' — ' + m.license_verified_note : ''));
  } else {
    add('السجل التجاري', m.cr_number, true);
    if (m.cr_check?.found) {
      const c = m.cr_check;
      add('واثق: اسم المنشأة', c.name);
      add('واثق: الحالة', [c.status, c.expiry && 'ينتهي ' + c.expiry].filter(Boolean).join(' · '));
      if (c.parties?.length) add('واثق: الملاك والمدراء', c.parties.join('، '));
      if (c.activities?.length) add('واثق: الأنشطة', c.activities.slice(0, 3).join('، '));
      if (c.source === 'sandbox') add('مصدر التحقق', 'بيئة واثق الاختبارية (بيانات تجريبية)');
    } else if (m.cr_check) add('واثق', (m.cr_check.message || '') + (m.cr_check.http ? ` (${m.cr_check.http})` : ''));
    add('الرقم الضريبي', m.vat_registered ? m.vat_number : 'غير مسجل', m.vat_registered);
  }
  add('البنك', m.bank_name); add('الآيبان', (m.iban || '').replace(/(.{4})/g, '$1 ').trim(), true);
  const tr = trialInfo(m);
  add('الباقة', m.plan !== 'free' ? planLabel(m.plan, m.billing)
    : `مجانية ${m.trial_months || 3} أشهر${m.founder ? ' ⭐' : ''} ${tr.state === 'waiting' ? '(تبدأ عند الإطلاق)' : tr.state === 'active' ? `(باقي ${tr.days} يوم، تنتهي ${fmtDay(tr.end)})` : '(انتهت)'} ← بعدها: ${planLabel(m.next_plan, m.billing)}`);
  if (m.lat != null) {
    const d = document.createElement('div'); d.append(t('span', 'الموقع'));
    const a = t('a', person && m.kind === 'family' ? 'افتح في الخرائط (البيت، لا يظهر للزبون)' : 'افتح في الخرائط'); a.href = `https://www.google.com/maps?q=${m.lat},${m.lng}`; a.target = '_blank'; a.rel = 'noopener';
    d.append(a); kv.append(d);
  }

  const docs = document.createElement('div'); docs.className = 'docs';
  const docList = [['السجل التجاري', m.cr_path], ['صورة الهوية', m.id_path], ['الشهادة الضريبية', m.vat_path], ['شهادة الآيبان', m.iban_path],
    ...(m.extra_docs || []).map((p, i) => [`مستند إضافي ${i + 1}`, p])];
  for (const [label, path] of docList) {
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
  const chk = t('a', person ? 'تحقق من وثيقة العمل الحر' : 'تحقق من السجل (منصة الأعمال)', 'btn ghost sm');
  chk.href = person ? 'https://freelance.sa' : 'https://business.sa'; chk.target = '_blank'; chk.rel = 'noopener';
  docs.append(chk);

  const parts = [head, kv, docs];
  if (m.review_note && m.status !== 'approved') { const n = t('div', 'ملاحظة سابقة: ' + m.review_note, 'note'); parts.push(n); }

  const acts = document.createElement('div'); acts.className = 'acts-row';
  const act = (label, cls, fn) => { const b = t('button', label, 'btn sm ' + cls); b.onclick = () => fn(b); acts.append(b); };
  if (m.status !== 'approved') act(m.status === 'suspended' ? 'إعادة التفعيل' : 'تفعيل المتجر ✓', 'primary', b => setStatus(m, 'approved', null, b));
  if (person && !m.site_verified_at) act('✔ تمت المعاينة الميدانية', 'ghost', b => verifySite(m, b));
  if (WATHQ_ON && !person && m.cr_number) act(m.cr_check ? '🔎 أعد التحقق من واثق' : '🔎 تحقق من واثق', 'ghost', b => checkWathq(m, b));
  if (person) act(m.license_verified_at ? 'سحب شارة «موثّق برخصة»' : '🏅 منح شارة «موثّق برخصة»', 'ghost', b => verifyLicense(m, !m.license_verified_at, b));
  act(m.iban_verified_at ? 'سحب علامة «الآيبان مطابق»' : person ? '✔ الآيبان مطابق للهوية' : '✔ الآيبان مطابق للسجل', 'ghost', b => verifyIban(m, !m.iban_verified_at, b));
  if (m.status === 'pending') act('رفض / طلب تعديل', 'danger', () => askNote(m, 'rejected'));
  if (m.status === 'approved') act('إيقاف مؤقت', 'danger', () => askNote(m, 'suspended'));
  act('✏️ تعديل البيانات', 'ghost', () => openEdit(m));
  const wa = t('a', 'واتساب التاجر', 'btn ghost sm'); wa.href = 'https://wa.me/966' + m.phone.slice(1); wa.target = '_blank'; wa.rel = 'noopener';
  acts.append(wa);
  parts.push(acts);
  el.append(...parts);
  return el;
}

async function setStatus(m, status, note, btn) {
  if (status === 'approved' && m.kind && m.kind !== 'store' && !m.site_verified_at
      && !confirm(`«${m.store_name}» ما تمت معاينته ميدانيًا بعد. ننصح بزيارة المسوّق أو المشرف قبل التفعيل.\nتفعّله الحين بدون معاينة؟`)) return;
  if (status === 'approved' && !confirm(`تفعيل «${m.store_name}»؟ بيوصل للتاجر إيميل ويقدر يضيف منتجاته.`)) return;
  setBusy(btn, true);
  const { error } = await sb.from('merchants').update({ status, review_note: note }).eq('id', m.id);
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast({ approved: 'تم التفعيل ✓ وصل التاجر إيميل.', rejected: 'تم إرسال طلب التعديل للتاجر.', suspended: 'تم إيقاف المتجر.' }[status]);
  await load();
}

async function verifySite(m, btn) {
  const note = prompt(`تأكيد المعاينة الميدانية لـ«${m.store_name}»\nاكتب ملاحظة قصيرة (مثل: زاره المسوّق فلان، المكان نظيف ومطابق للعنوان):`, '');
  if (note === null) return;
  setBusy(btn, true);
  const { error } = await sb.rpc('mark_site_verified', { mid: m.id, note });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast('تم تسجيل المعاينة ✓'); await load();
}

// الربط مع واثق موقوف مؤقتًا (التحقق يدوي من منصة الأعمال). لإعادة تفعيله: true هنا + تفعيل trigger merchants_wathq_check
const WATHQ_ON = false;
async function checkWathq(m, btn) {
  setBusy(btn, true, 'جارِ الاستعلام من واثق…');
  const { data, error } = await sb.functions.invoke('wathq', { body: { merchant_id: m.id } });
  setBusy(btn, false);
  if (error || data?.error) return toast('تعذر التحقق: ' + (data?.error || error.message));
  toast(data?.check?.found ? 'تم التحقق ✓' : 'رد واثق: ' + (data?.check?.message || 'غير موجود'));
  await load();
}

async function verifyLicense(m, on, btn) {
  let note = null;
  if (on) {
    note = prompt(`منح شارة «موثّق برخصة» لـ«${m.store_name}»\nامنحها فقط بعد ما تتأكد بنفسك أو عن طريق فريقك من:\n• رخصة بلدي سارية (نشاط منزلي أو عربة متنقلة)\n• الشهادة الصحية إن كان النشاط أكل\n• الالتزام بالاشتراطات البلدية في الموقع\n\nاكتب رقم الرخصة وتاريخ انتهائها:`, m.license_number || '');
    if (note === null) return;
    if (note.trim().length < 3) return toast('اكتب رقم الرخصة وتاريخ انتهائها.');
  } else if (!confirm(`سحب شارة «موثّق برخصة» من «${m.store_name}»؟`)) return;
  setBusy(btn, true);
  const { error } = await sb.rpc('set_license_verified', { mid: m.id, verified: on, note });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast(on ? 'تم منح الشارة 🏅' : 'تم سحب الشارة.'); await load();
}

// علامة «الآيبان مطابق»: تعتمدها بعد ما تقارن شهادة الآيبان (اسم صاحب الحساب) بالسجل التجاري أو الهوية.
// تنسحب تلقائيًا لو تغيّر الآيبان أو شهادته.
async function verifyIban(m, on, btn) {
  const person = !!(m.kind && m.kind !== 'store');
  let note = null;
  if (on) {
    note = prompt(`اعتماد مطابقة الآيبان لـ«${m.store_name}»\nاعتمدها بعد ما تفتح شهادة الآيبان وتتأكد أن اسم صاحب الحساب يطابق ${person ? 'اسم صاحب الهوية' : 'اسم المنشأة في السجل التجاري'}.\n\nملاحظة قصيرة (اختياري، مثل: الاسم مطابق):`, '');
    if (note === null) return;
  } else if (!confirm(`سحب علامة «الآيبان مطابق» من «${m.store_name}»؟`)) return;
  setBusy(btn, true);
  const { error } = await sb.rpc('set_iban_verified', { mid: m.id, verified: on, note });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast(on ? 'تم اعتماد مطابقة الآيبان ✓' : 'تم سحب العلامة.'); await load();
}

// نافذة سبب الرفض / الإيقاف
const dn = $('#dlg-note'), fn = $('#f-note');
const PRESETS = {
  rejected: ['صورة الهوية غير واضحة، ارفعها مرة ثانية.', 'اسم صاحب الآيبان لا يطابق الاسم في الهوية.', 'ما قدرنا نتأكد من الموقع، حدّده مرة ثانية من الخريطة.', 'صورة السجل التجاري غير واضحة، ارفعها مرة ثانية.', 'السجل التجاري منتهي، ارفع سجل ساري.', 'اسم صاحب الآيبان لا يطابق اسم المنشأة أو المالك.', 'الشهادة الضريبية لا تطابق الرقم الضريبي المكتوب.', 'النشاط في السجل لا يطابق النشاط المختار.'],
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

// ---------------- تعديل بيانات التاجر ----------------
// رقم السجل التجاري (والهوية للأفراد) ثابت: يظهر هنا للعرض فقط، والقاعدة نفسها ترفض تغييره. لتغييره: حذف الحساب.
const dlgEdit = $('#dlg-edit'), formEdit = $('#f-edit');
let editingM = null;
const EDIT_TEXT = ['owner_name', 'store_name', 'activity', 'city', 'bank_name'];

function openEdit(m) {
  editingM = m; formEdit.reset(); $('.err', formEdit).textContent = '';
  const person = !!(m.kind && m.kind !== 'store');
  $('#edit-title').textContent = `تعديل: ${m.store_name}`;
  for (const k of [...EDIT_TEXT, 'district', 'national_address', 'phone', 'contact_phone', 'license_number']) formEdit[k].value = m[k] ?? '';
  formEdit.email.value = m.email ?? '';
  formEdit.iban.value = (m.iban || '').replace(/(.{4})/g, '$1 ').trim();
  formEdit.lat.value = m.lat ?? ''; formEdit.lng.value = m.lng ?? '';
  formEdit.vat_registered.checked = !!m.vat_registered; formEdit.vat_number.value = m.vat_number ?? '';
  $('#e-vat').hidden = person; $('#e-license').hidden = !person;
  $('#e-locked').textContent = `🔒 ${person ? 'رقم الهوية' : 'السجل التجاري'}: ${(person ? m.id_number : m.cr_number) || '—'} — ثابت ولا يتغيّر. لتغييره احذف حساب التاجر وليسجّل من جديد.`;
  dlgEdit.showModal();
}
$('#edit-cancel').addEventListener('click', () => dlgEdit.close());

formEdit.addEventListener('submit', async e => {
  e.preventDefault();
  const m = editingM, err = $('.err', formEdit), btn = $('#edit-save'), person = !!(m.kind && m.kind !== 'store');
  const v = n => formEdit[n].value.trim();
  const patch = {};
  const put = (k, val) => { if ((m[k] ?? null) !== (val ?? null)) patch[k] = val; };
  for (const k of EDIT_TEXT) put(k, v(k));
  put('district', v('district') || null);
  put('national_address', clean(v('national_address')) || null);
  put('phone', digits(v('phone')));
  put('contact_phone', digits(v('contact_phone')) || null);
  put('iban', clean(formEdit.iban.value));
  if (person) put('license_number', v('license_number') || null);
  else {
    const on = formEdit.vat_registered.checked;
    put('vat_registered', on); put('vat_number', on ? digits(v('vat_number')) : null);
  }
  const la = digits(v('lat')), ln = digits(v('lng'));
  if (!la && !ln) { put('lat', null); put('lng', null); }
  else {
    const a = Number(la), b = Number(ln);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !la || !ln) { err.textContent = 'اكتب خط العرض وخط الطول معًا، أو اتركهما فاضيين.'; return; }
    if (a < 16 || a > 33 || b < 34 || b > 56) { err.textContent = 'الإحداثيات خارج السعودية، راجع الأرقام.'; return; }
    put('lat', a); put('lng', b);
  }
  const problems = [];
  if ('owner_name' in patch && patch.owner_name.length < 2) problems.push('اسم المالك حرفان على الأقل.');
  if ('store_name' in patch && patch.store_name.length < 2) problems.push('اسم المتجر حرفان على الأقل.');
  if ('activity' in patch && !patch.activity) problems.push('اكتب النشاط.');
  if ('city' in patch && !patch.city) problems.push('اكتب المدينة.');
  if ('phone' in patch && !valid.phone(patch.phone)) problems.push('الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (patch.contact_phone && !valid.phone(patch.contact_phone)) problems.push('رقم واتساب المشترين يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (patch.national_address && !valid.nationalAddress(patch.national_address)) problems.push('العنوان الوطني 4 حروف إنجليزية و4 أرقام.');
  if ('iban' in patch && !valid.iban(patch.iban)) problems.push('رقم الآيبان غير صحيح.');
  if ('bank_name' in patch && !patch.bank_name) problems.push('اكتب اسم البنك.');
  if (!person && formEdit.vat_registered.checked && !valid.vat(digits(v('vat_number')))) problems.push('الرقم الضريبي 15 رقم يبدأ وينتهي بـ 3.');
  const newEmail = v('email').toLowerCase(), emailChanged = newEmail !== (m.email || '').toLowerCase();
  if (emailChanged && !/^\S+@\S+\.\S+$/.test(newEmail)) problems.push('اكتب إيميل صحيح.');
  if (problems.length) { err.textContent = problems.join(' '); return; }
  if (!Object.keys(patch).length && !emailChanged) { err.textContent = 'ما فيه تغييرات للحفظ.'; return; }
  if (emailChanged && !confirm(`تغيير إيميل «${m.store_name}» من ${m.email} إلى ${newEmail}؟\nيتغيّر معه إيميل الدخول، وتوصله التنبيهات على الجديد.`)) return;

  err.textContent = ''; setBusy(btn, true, 'جارِ الحفظ…');
  try {
    if (emailChanged) {
      const { error } = await sb.rpc('admin_set_merchant_email', { mid: m.id, new_email: newEmail });
      if (error) throw error;
    }
    if (Object.keys(patch).length) {
      const { error } = await sb.rpc('admin_edit_merchant', { mid: m.id, patch, note: v('note') || null });
      if (error) throw error;
    }
    dlgEdit.close();
    toast('تم حفظ التعديلات ✓');
    await load();
  } catch (ex) { err.textContent = friendlyError(ex); }
  finally { setBusy(btn, false); }
});

// حذف حساب التاجر نهائيًا: المتجر ومنتجاته وفريقه ومستنداته. يبقى إيميل الدخول فقط، فيقدر صاحبه يسجّل من جديد.
$('#edit-delete').addEventListener('click', async () => {
  const m = editingM, btn = $('#edit-delete');
  const typed = prompt(`حذف حساب «${m.store_name}» نهائيًا؟\nيُحذف المتجر ومنتجاته وفريقه ومستنداته، ولا يمكن التراجع.\nيبقى إيميل الدخول فقط، ويقدر صاحبه يسجّل من جديد.\n\nللتأكيد اكتب اسم المتجر بالضبط:`, '');
  if (typed === null) return;
  if (typed.trim() !== m.store_name.trim()) return toast('الاسم ما يطابق. ما انحذف شي.');
  setBusy(btn, true, 'جارِ الحذف…');
  try {
    const docs = [m.cr_path, m.id_path, m.vat_path, m.iban_path, ...(m.extra_docs || [])].filter(Boolean);
    const { data: prods } = await sb.from('products').select('image_path').eq('merchant_id', m.id).not('image_path', 'is', null);
    const imgs = (prods || []).map(p => p.image_path);
    if (docs.length) { const { error } = await sb.storage.from('merchant-docs').remove(docs); if (error) throw error; }
    if (imgs.length) { const { error } = await sb.storage.from('product-images').remove(imgs); if (error) throw error; }
    const { error } = await sb.rpc('admin_delete_merchant', { mid: m.id });
    if (error) throw error;
    dlgEdit.close();
    toast('تم حذف حساب التاجر.');
    await load();
  } catch (ex) { toast(friendlyError(ex)); }
  finally { setBusy(btn, false); }
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
