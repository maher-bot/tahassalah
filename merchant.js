import { sb, $, $$, toast, clean, digits, valid, money, ACTIVITIES, PLANS, STATUS, fileExt, shrinkImage, friendlyError, setBusy, trialInfo, fmtDay } from './lib.js';

const VIEWS = ['v-loading', 'v-auth', 'v-check-email', 'v-reset', 'v-apply', 'v-status', 'v-dash'];
const show = id => { VIEWS.forEach(v => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); };
const here = () => location.origin + location.pathname;

let user = null, merchant = null, products = [], editing = null, recovering = false, routedFor = undefined, coords = null;

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
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return (err.textContent = 'هذا الإيميل مسجل من قبل. سجّل دخول بدلًا من ذلك.');
  }
  if (!data.session) { $('#sent-to').textContent = email; show('v-check-email'); }
});

$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  err.textContent = ''; setBusy(btn, true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  setBusy(btn, false);
  if (error) err.textContent = friendlyError(error);
});

$('#forgot').addEventListener('click', async () => {
  const f = $('#f-login'), err = $('.err', f), email = f.email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'اكتب إيميلك فوق أولًا.'; f.email.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
  err.textContent = '';
  toast(error ? friendlyError(error) : 'أرسلنا لك رابط تغيير كلمة المرور على الإيميل.');
});

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
  if (!user) return show('v-auth');

  show('v-loading');
  const { data, error } = await sb.from('merchants').select('*').eq('id', user.id).maybeSingle();
  if (error) { $('#v-loading').textContent = friendlyError(error); return; }
  merchant = data;
  if (!merchant) return openApply();
  if (merchant.status === 'approved') return openDash();
  showStatus();
}

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
  show('v-status');
}

// ---------------- نموذج التسجيل ----------------
const fa = $('#f-apply');
fa.activity.append(...ACTIVITIES.map(a => new Option(a, a)));

fa.no_vat.addEventListener('change', () => { $('#vat-fields').hidden = fa.no_vat.checked; });
fa.iban.addEventListener('input', () => {
  const v = clean(fa.iban.value).slice(0, 24);
  fa.iban.value = v.replace(/(.{4})/g, '$1 ').trim();
});
fa.national_address.addEventListener('input', () => { fa.national_address.value = clean(fa.national_address.value).replace(/[^A-Z0-9]/g, '').slice(0, 8); });
const syncNext = () => { $('#next-plan-wrap').hidden = fa.querySelector('input[name=plan]:checked')?.value !== 'free'; };
$$('input[name=plan]', fa).forEach(r => r.addEventListener('change', syncNext));
for (const n of ['phone', 'cr_number', 'vat_number']) fa[n].addEventListener('input', () => { fa[n].value = digits(fa[n].value).replace(/\D/g, ''); });

$$('.file input[type=file]').forEach(inp => inp.addEventListener('change', () => {
  const box = inp.closest('.file'), f = inp.files[0];
  box.classList.toggle('has', !!f || !!box.dataset.existing);
  $('.cur', box).textContent = f ? `✓ ${f.name}` : (box.dataset.existing ? '✓ مرفوع مسبقًا (اختر ملف جديد لاستبداله)' : '');
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

function setExisting(kind, path) {
  const box = $(`.file[data-file="${kind}"]`);
  box.dataset.existing = path ? '1' : '';
  $('input[type=file]', box).value = '';
  box.classList.toggle('has', !!path);
  $('.cur', box).textContent = path ? '✓ مرفوع مسبقًا (اختر ملف جديد لاستبداله)' : '';
}

function openApply(m = null) {
  fa.reset();
  fa.activity.value = '';
  coords = m?.lat != null ? { lat: m.lat, lng: m.lng } : null;
  $('#loc-state').textContent = coords ? '✓ الموقع محدد مسبقًا' : 'اضغطه وأنت داخل المحل، عشان يظهر للمشترين القريبين.';
  $('#apply-title').textContent = m ? 'تعديل طلبك' : 'بيانات متجرك';
  $('#apply-btn').textContent = m ? 'حفظ وإعادة الإرسال' : 'إرسال الطلب للمراجعة';
  const note = $('#apply-note');
  note.hidden = !(m?.status === 'rejected' && m.review_note);
  note.textContent = m?.review_note ? 'ملاحظة المراجعة: ' + m.review_note : '';
  if (m) {
    for (const k of ['owner_name', 'store_name', 'activity', 'phone', 'city', 'district', 'national_address', 'cr_number', 'vat_number', 'bank_name']) fa[k].value = m[k] ?? '';
    fa.next_plan.value = m.next_plan || 'commission';
    fa.iban.value = (m.iban || '').replace(/(.{4})/g, '$1 ').trim();
    fa.no_vat.checked = !m.vat_registered;
    $$('input[name=plan]', fa).forEach(r => { r.checked = r.value === m.plan; });
  }
  $('#vat-fields').hidden = fa.no_vat.checked;
  syncNext();
  setExisting('cr', m?.cr_path); setExisting('vat', m?.vat_path); setExisting('iban', m?.iban_path);
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
  const vatReg = !fa.no_vat.checked;
  const files = { cr: fa.cr_file.files[0], vat: fa.vat_file.files[0], iban: fa.iban_file.files[0] };
  const iban = clean(fa.iban.value);
  const problems = [];
  if (v('owner_name').length < 2) problems.push('اكتب اسمك الكامل.');
  if (v('store_name').length < 2) problems.push('اكتب اسم المحل.');
  if (!v('activity')) problems.push('اختر النشاط.');
  if (!valid.phone(v('phone'))) problems.push('رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (!v('city')) problems.push('اكتب المدينة.');
  if (!valid.nationalAddress(v('national_address'))) problems.push('العنوان الوطني المختصر 4 حروف إنجليزية و4 أرقام، مثل RRRD2929.');
  if (!valid.cr(v('cr_number'))) problems.push('رقم السجل التجاري 10 أرقام.');
  if (!files.cr && !merchant?.cr_path) problems.push('ارفع صورة السجل التجاري.');
  if (vatReg && !valid.vat(v('vat_number'))) problems.push('الرقم الضريبي 15 رقم يبدأ وينتهي بـ 3.');
  if (vatReg && !files.vat && !merchant?.vat_path) problems.push('ارفع الشهادة الضريبية، أو اختر «غير مسجلة في الضريبة».');
  if (!v('bank_name')) problems.push('اكتب اسم البنك.');
  if (!valid.iban(iban)) problems.push('رقم الآيبان غير صحيح. يبدأ بـ SA ومكوّن من 24 خانة.');
  if (!files.iban && !merchant?.iban_path) problems.push('ارفع شهادة الآيبان.');
  for (const [k, l] of [['cr', 'السجل التجاري'], ['vat', 'الشهادة الضريبية'], ['iban', 'شهادة الآيبان']]) {
    const p = checkFile(files[k], l); if (p) problems.push(p);
  }
  if (!fa.agree.checked) problems.push('وافق على الإقرار والشروط.');
  if (problems.length) { err.textContent = problems.join(' '); return; }
  err.textContent = '';

  setBusy(btn, true, 'جارِ رفع المستندات…');
  try {
    const paths = {};
    for (const k of ['cr', 'vat', 'iban']) {
      const f = files[k];
      if (!f || (k === 'vat' && !vatReg)) continue;
      const path = `${user.id}/${k}-${Date.now()}.${fileExt(f)}`;
      const { error } = await sb.storage.from('merchant-docs').upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) throw error;
      paths[k] = path;
    }
    btn.textContent = 'جارِ الإرسال…';
    const row = {
      id: user.id, email: user.email,
      owner_name: v('owner_name'), store_name: v('store_name'), activity: v('activity'),
      phone: v('phone'), city: v('city'), district: v('district') || null, national_address: v('national_address'),
      lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      cr_number: v('cr_number'),
      vat_registered: vatReg, vat_number: vatReg ? v('vat_number') : null,
      bank_name: v('bank_name'), iban,
      plan: fa.querySelector('input[name=plan]:checked').value,
      next_plan: fa.next_plan.value,
      cr_path: paths.cr ?? merchant?.cr_path,
      vat_path: vatReg ? (paths.vat ?? merchant?.vat_path ?? null) : null,
      iban_path: paths.iban ?? merchant?.iban_path,
    };
    const q = merchant ? sb.from('merchants').update(row).eq('id', user.id) : sb.from('merchants').insert(row);
    const { error } = await q;
    if (error) throw error;
    toast(merchant ? 'تم حفظ التعديلات وإرسالها للمراجعة.' : 'تم إرسال طلبك ✓');
    routedFor = undefined; await route();
  } catch (ex) {
    err.textContent = friendlyError(ex);
  } finally { setBusy(btn, false); }
});

// ---------------- لوحة المنتجات ----------------
const imgUrl = p => p ? sb.storage.from('product-images').getPublicUrl(p).data.publicUrl : null;

async function openDash() {
  $('#d-store').textContent = merchant.store_name;
  $('#d-plan').textContent = PLANS[merchant.plan] || '';
  renderTrial();
  show('v-dash');
  await loadProducts();
}

function renderTrial() {
  const t = trialInfo(merchant), box = $('#trial');
  box.hidden = !t;
  if (!t) return;
  box.classList.toggle('ended', t.state === 'ended');
  $('#trial-next').value = merchant.next_plan || 'commission';
  $('.t-pick', box).hidden = t.state === 'ended';
  if (t.state === 'waiting') {
    $('#trial-title').textContent = 'باقتك مجانية 3 أشهر';
    $('#trial-sub').textContent = 'تبدأ الأشهر الثلاثة من يوم إطلاق التطبيق للمشترين، وقبلها كل شيء مجاني. أضف منتجاتك الحين عشان تكون جاهز من أول يوم.';
  } else if (t.state === 'active') {
    $('#trial-title').textContent = `باقي ${t.days} يوم على الفترة المجانية`;
    $('#trial-sub').textContent = `تنتهي ${fmtDay(t.end)}، وبعدها يتفعّل حسابك كامل على الباقة اللي تختارها.`;
  } else {
    $('#trial-title').textContent = 'انتهت الفترة المجانية';
    $('#trial-sub').textContent = `يتحوّل حسابك إلى ${PLANS[merchant.next_plan]} خلال يوم.`;
  }
}
$('#trial-save').addEventListener('click', async e => {
  const btn = e.currentTarget, p = $('#trial-next').value;
  setBusy(btn, true);
  const { error } = await sb.rpc('set_next_plan', { p });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  merchant.next_plan = p; toast('تم حفظ باقتك القادمة: ' + PLANS[p]);
});

async function loadProducts() {
  const { data, error } = await sb.from('products').select('*').eq('merchant_id', user.id).order('created_at', { ascending: false });
  if (error) { toast(friendlyError(error)); return; }
  products = data;
  $('#cats').replaceChildren(...[...new Set(products.map(p => p.category).filter(Boolean))].map(c => new Option(c)));
  render();
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.category || '').toLowerCase().includes(q));
  $('#s-total').textContent = products.length;
  $('#s-active').textContent = products.filter(p => p.is_active && p.quantity > 0).length;
  $('#s-low').textContent = products.filter(p => p.quantity <= 2).length;
  const box = $('#plist');
  if (!products.length) {
    box.innerHTML = '<div class="empty"><b>ما أضفت منتجات بعد</b><br>ابدأ بـ «إضافة منتج»، أو ارفع ملف CSV فيه كل منتجاتك دفعة وحدة.</div>';
    return;
  }
  if (!list.length) { box.innerHTML = '<div class="empty">ما فيه نتائج لبحثك.</div>'; return; }
  box.replaceChildren(...list.map(p => {
    const el = document.createElement('article');
    el.className = 'prod' + (p.is_active ? '' : ' off');
    const url = imgUrl(p.image_path);
    const pic = url ? Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' })
      : Object.assign(document.createElement('div'), { className: 'ph', textContent: p.name.trim()[0] || '؟' });
    const mid = document.createElement('div'); mid.style.minWidth = '0';
    const n = document.createElement('div'); n.className = 'n'; n.textContent = p.name;
    const m = document.createElement('div'); m.className = 'm num';
    const price = document.createElement('span');
    if (p.sale_price != null) { price.innerHTML = '<b></b> <s></s>'; price.querySelector('b').textContent = money(p.sale_price); price.querySelector('s').textContent = money(p.price); }
    else { price.innerHTML = '<b></b>'; price.querySelector('b').textContent = money(p.price); }
    const qty = document.createElement('span');
    qty.textContent = p.quantity > 0 ? `الكمية ${p.quantity}` : 'نفد';
    if (p.quantity <= 2) qty.className = 'low';
    m.append(price, qty);
    if (p.category) m.append(Object.assign(document.createElement('span'), { textContent: p.category }));
    if (!p.is_active) m.append(Object.assign(document.createElement('span'), { textContent: 'مخفي' }));
    mid.append(n, m);
    const acts = document.createElement('div'); acts.className = 'acts';
    const minus = Object.assign(document.createElement('button'), { className: 'btn ghost sm', textContent: '−1', title: 'إنقاص الكمية' });
    const plus = Object.assign(document.createElement('button'), { className: 'btn ghost sm', textContent: '+1', title: 'زيادة الكمية' });
    const edit = Object.assign(document.createElement('button'), { className: 'btn ghost sm', textContent: 'تعديل' });
    minus.disabled = p.quantity <= 0;
    minus.onclick = () => bump(p, -1); plus.onclick = () => bump(p, 1); edit.onclick = () => openProduct(p);
    acts.append(minus, plus, edit);
    el.append(pic, mid, acts);
    return el;
  }));
}
$('#q').addEventListener('input', render);

async function bump(p, d) {
  const qn = Math.max(0, p.quantity + d);
  const { error } = await sb.from('products').update({ quantity: qn }).eq('id', p.id);
  if (error) return toast(friendlyError(error));
  p.quantity = qn; render();
}

const dlg = $('#dlg'), fp = $('#f-prod');
$('#add').addEventListener('click', () => openProduct(null));
$('#cancel').addEventListener('click', () => dlg.close());

function openProduct(p) {
  editing = p;
  fp.reset();
  $('#dlg-title').textContent = p ? 'تعديل منتج' : 'منتج جديد';
  $('#del').hidden = !p;
  $('.err', fp).textContent = '';
  if (p) {
    for (const k of ['name', 'price', 'sale_price', 'quantity', 'category', 'barcode', 'description']) fp[k].value = p[k] ?? '';
    fp.is_active.checked = p.is_active;
  }
  const box = $('.file[data-file="img"]', fp);
  box.dataset.existing = p?.image_path ? '1' : '';
  box.classList.toggle('has', !!p?.image_path);
  $('.cur', box).textContent = p?.image_path ? '✓ فيه صورة (اختر صورة جديدة لاستبدالها)' : '';
  dlg.showModal();
  fp.name.focus();
}

const num = s => { const t = digits(s).replace(/[٫,]/g, '.').trim(); return t === '' ? null : Number(t); };

fp.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fp), btn = $('#save');
  const price = num(fp.price.value), sale = num(fp.sale_price.value), qty = num(fp.quantity.value);
  if (fp.name.value.trim().length < 2) return (err.textContent = 'اكتب اسم المنتج.');
  if (price == null || !(price >= 0)) return (err.textContent = 'اكتب سعر صحيح.');
  if (sale != null && !(sale >= 0 && sale < price)) return (err.textContent = 'سعر العرض لازم يكون أقل من السعر الأصلي.');
  if (qty == null || !Number.isInteger(qty) || qty < 0) return (err.textContent = 'الكمية رقم صحيح من 0 وفوق.');
  err.textContent = ''; setBusy(btn, true, 'جارِ الحفظ…');
  try {
    let image_path = editing?.image_path ?? null;
    const file = fp.image.files[0];
    if (file) {
      const small = await shrinkImage(file);
      if (small.size > 2 * 1024 * 1024) throw new Error('الصورة كبيرة جدًا، اختر صورة أصغر من 2 ميجا.');
      const path = `${user.id}/${crypto.randomUUID()}.${small.type === 'image/webp' ? 'webp' : fileExt(small)}`;
      const { error } = await sb.storage.from('product-images').upload(path, small, { contentType: small.type });
      if (error) throw error;
      if (image_path) sb.storage.from('product-images').remove([image_path]);
      image_path = path;
    }
    const row = {
      name: fp.name.value.trim(), price, sale_price: sale, quantity: qty,
      category: fp.category.value.trim() || null, barcode: digits(fp.barcode.value).trim() || null,
      description: fp.description.value.trim() || null, is_active: fp.is_active.checked, image_path,
    };
    const { error } = editing
      ? await sb.from('products').update(row).eq('id', editing.id)
      : await sb.from('products').insert({ ...row, merchant_id: user.id });
    if (error) throw error;
    dlg.close(); toast(editing ? 'تم حفظ التعديل.' : 'تمت إضافة المنتج.');
    await loadProducts();
  } catch (ex) { err.textContent = friendlyError(ex); }
  finally { setBusy(btn, false); }
});

$('#del').addEventListener('click', async () => {
  if (!editing || !confirm(`حذف «${editing.name}» نهائيًا؟`)) return;
  const { error } = await sb.from('products').delete().eq('id', editing.id);
  if (error) return toast(friendlyError(error));
  if (editing.image_path) sb.storage.from('product-images').remove([editing.image_path]);
  dlg.close(); toast('تم حذف المنتج.'); await loadProducts();
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
    const name = g('name'), price = num(g('price')), sale = num(g('sale_price')), qty = num(g('quantity')) ?? 0, barcode = digits(g('barcode')) || null;
    if (name.length < 2 || price == null || !(price >= 0) || !Number.isInteger(qty) || qty < 0 || (sale != null && !(sale >= 0 && sale < price))) { bad.push(i + 2); return; }
    const row = { name, price, sale_price: sale, quantity: qty, barcode, category: g('category') || null, description: g('description') || null };
    const ex = barcode && byBarcode.get(barcode);
    if (ex) updates.push({ id: ex.id, row }); else inserts.push({ ...row, merchant_id: user.id, is_active: true });
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
