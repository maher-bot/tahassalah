import { rememberLogin, hidePasswords, sb, $, $$, toast, digits, valid, ACTIVITIES, shrinkImage, friendlyError, setBusy, fmtDay,
  FIELD_STATUS, FIELD_BADGE, FIELD_PROBLEMS, MAKKAH_DISTRICTS, ago } from './lib.js';
import { pickLocation } from './mappick.js';

const VIEWS = ['v-loading', 'v-auth', 'v-check', 'v-denied', 'v-app'];
const show = id => { VIEWS.forEach(v => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); };
const here = () => location.origin + location.pathname;
const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
const today = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD بالتوقيت المحلي
const SITE = 'https://tahassalah.com';

let user = null, rep = null, stores = [], visitsToday = 0, filter = 'all', routedFor, photos = {}, current = null;

// ---------------- الحساب ----------------
$$('#v-auth [role=tab]').forEach(t => t.addEventListener('click', () => {
  $$('#v-auth [role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $('#f-login').hidden = t.dataset.tab !== 'login';
  $('#f-signup').hidden = t.dataset.tab !== 'signup';
}));
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  setBusy(btn, true);
  hidePasswords(f);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (!error) rememberLogin(f.email.value.trim(), f.password.value);
  setBusy(btn, false);
  err.textContent = error ? friendlyError(error) : '';
});
$('#f-signup').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('.err', f), btn = $('button[type=submit]', f);
  if (!/^\S+@\S+\.\S+$/.test(f.email.value.trim())) return (err.textContent = 'اكتب إيميل صحيح.');
  if (f.password.value.length < 8) return (err.textContent = 'كلمة المرور لازم تكون 8 أحرف على الأقل.');
  setBusy(btn, true);
  hidePasswords(f);
  const { data, error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.password.value, options: { emailRedirectTo: here() } });
  setBusy(btn, false);
  if (error) return (err.textContent = friendlyError(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return (err.textContent = 'هذا الإيميل مسجل من قبل. اضغط «دخول».');
  if (!data.session) show('v-check');
});
$('#forgot').addEventListener('click', async () => {
  const f = $('#f-login'), email = f.email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('.err', f).textContent = 'اكتب إيميلك فوق أولًا.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + '/merchant.html' });
  toast(error ? friendlyError(error) : 'أرسلنا لك رابط تغيير كلمة المرور على الإيميل.');
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
  user = session?.user ?? null;
  $('#who').textContent = user?.email ?? '';
  $('#logout').hidden = !user;
  if (!user) return show('v-auth');
  show('v-loading');
  const { data, error } = await sb.rpc('my_rep');
  if (error) { $('#v-loading').textContent = friendlyError(error); return; }
  rep = data?.[0];
  if (!rep) { $('#denied-email').textContent = user.email; return show('v-denied'); }
  $('#r-name').textContent = rep.name;
  $('#r-code').textContent = 'كودك ' + rep.code;
  $('#r-districts').textContent = rep.districts.length ? 'أحياؤك: ' + rep.districts.join('، ') : '';
  show('v-app');
  await load();
  locate();   // نجهّز الموقع مبكرًا
}

// ---------------- القائمة ----------------
async function load() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [s, v] = await Promise.all([
    sb.from('field_stores').select('*').eq('rep_id', rep.id).order('last_visit_at', { ascending: false }).limit(1000),
    sb.from('field_visits').select('id', { count: 'exact', head: true }).eq('rep_id', rep.id).gte('created_at', start.toISOString()),
  ]);
  if (s.error) return toast(friendlyError(s.error));
  stores = s.data; visitsToday = v.count ?? 0;
  await signPhotos(stores.map(x => x.photo_path));
  render();
}

async function signPhotos(paths) {
  const need = [...new Set(paths.filter(p => p && !photos[p]))];
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from('field-photos').createSignedUrls(need.slice(i, i + 100), 3600);
    (data || []).forEach(d => { if (d.signedUrl) photos[d.path] = d.signedUrl; });
  }
}

const isDue = s => s.follow_up_on && s.follow_up_on <= today() && !['registered', 'not_interested', 'closed'].includes(s.status);

function render() {
  const t = today();
  $('#s-today').textContent = visitsToday;
  $('#s-reg').textContent = stores.filter(s => s.status === 'registered').length;
  $('#s-int').textContent = stores.filter(s => s.status === 'interested').length;
  const due = stores.filter(isDue).length;
  $('#s-due').textContent = due;
  const c = $('#c-due'); c.hidden = !due; c.textContent = due;
  const pct = rep.daily_target ? Math.min(100, Math.round(visitsToday / rep.daily_target * 100)) : 0;
  $('#t-bar').style.width = pct + '%';
  $('#t-text').textContent = rep.daily_target ? `هدفك اليوم ${rep.daily_target} زيارات — أنجزت ${visitsToday}` : '';

  const q = $('#q').value.trim().toLowerCase();
  const list = stores.filter(s =>
    (filter === 'all' || (filter === 'due' ? isDue(s) : s.status === filter)) &&
    (!q || [s.store_name, s.phone, s.district, s.contact_name].some(x => (x || '').toLowerCase().includes(q))));
  const box = $('#list');
  if (!stores.length) { box.innerHTML = '<div class="empty"><b>ابدأ أول زيارة</b><br>اضغط «زيارة محل جديد»، صوّر الواجهة، واكتب النتيجة.</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="empty">ما فيه محلات هنا.</div>'; return; }
  box.replaceChildren(...list.map(s => {
    const el = mk('button', 'fstore'); el.type = 'button';
    const url = photos[s.photo_path];
    el.append(url ? Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' }) : mk('div', 'ph', s.store_name.trim()[0]));
    const mid = mk('div'); mid.style.minWidth = '0';
    const top = mk('div'); top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    top.append(mk('span', 'n', s.store_name), mk('span', 'badge ' + FIELD_BADGE[s.status], FIELD_STATUS[s.status]));
    const m = mk('div', 'm');
    m.append(mk('span', '', [s.district, s.activity].filter(Boolean).join(' · ')), mk('span', 'num', `${s.visits} زيارة · ${ago(s.last_visit_at)}`));
    if (s.follow_up_on && !['registered', 'not_interested', 'closed'].includes(s.status)) m.append(mk('span', isDue(s) ? 'low' : '', 'الزيارة الجاية ' + fmtDay(s.follow_up_on)));
    if (s.problem) m.append(mk('span', 'low', s.problem));
    mid.append(top, m);
    el.append(mid);
    el.onclick = () => openStore(s);
    return el;
  }));
}
$$('#f-tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.f;
  $$('#f-tabs [role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  render();
}));
$('#q').addEventListener('input', render);
$('#reload').addEventListener('click', load);

// رابط التسجيل بكود المسوّق
const regLink = () => `${SITE}/merchant.html?ref=${rep.code}`;
const regText = name => `السلام عليكم${name ? ' ' + name : ''}، هذا رابط تسجيل محلك في تطبيق تحصّله مجانًا:\n${regLink()}`;
$('#share-link').addEventListener('click', async () => {
  const text = regText('');
  if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
  try { await navigator.clipboard.writeText(regLink()); toast('نسخنا الرابط ✓ ' + regLink(), 5000); } catch { prompt('انسخ الرابط:', regLink()); }
});

// ---------------- الموقع ----------------
let coords = null;
function locate() {
  const st = $('#loc-state');
  if (!navigator.geolocation) { st.textContent = '📍 جهازك ما يدعم تحديد الموقع.'; return; }
  st.textContent = '📍 جارِ تحديد الموقع…';
  navigator.geolocation.getCurrentPosition(
    p => { coords = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
      st.textContent = `📍 ✓ تم تحديد الموقع (دقة ${coords.acc} متر)`; },
    () => { coords = null; st.innerHTML = '📍 ما قدرنا نحدد الموقع. اسمح للمتصفح بالموقع. <button type="button" class="btn ghost sm" id="loc-retry">حاول مرة ثانية</button>';
      $('#loc-retry').onclick = locate; },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

// ---------------- خيارات النماذج ----------------
function statusChips(box, name, onChange) {
  box.replaceChildren(...Object.entries(FIELD_STATUS).map(([v, l]) => {
    const lab = mk('label'); const r = Object.assign(document.createElement('input'), { type: 'radio', name, value: v });
    r.addEventListener('change', onChange); lab.append(r, l); return lab;
  }));
}
const fn = $('#f-new'), fv = $('#f-visit');
fn.activity.append(...ACTIVITIES.map(a => new Option(a, a)));
// اختار «أخرى»: تظهر خانة يكتب فيها المسوّق اسم نشاط المحل بدل ما تنحفظ كلمة «أخرى»
const syncOther = () => {
  if (!fn.activity_other) return;
  const on = fn.activity.value === 'أخرى';
  fn.activity_other.hidden = !on;
  if (on) fn.activity_other.focus(); else fn.activity_other.value = '';
};
fn.activity.addEventListener('change', syncOther);
for (const sel of [fn.problem, fv.problem]) sel.append(new Option('اختر', ''), ...FIELD_PROBLEMS.map(p => new Option(p, p)));
// جوال المحل مطلوب لما يكون المحل مهتم أو سجّل، عشان نربطه بحسابه ونرسل له رابط التسجيل
const NEED_PHONE = ['registered', 'interested', 'follow_up'];
const syncNew = () => {
  const s = fn.querySelector('input[name=nstatus]:checked')?.value;
  $('#phone-opt').textContent = NEED_PHONE.includes(s) ? '(مطلوب)' : '(اختياري)';
  $('#new-problem-wrap').hidden = s !== 'problem';
  $('#new-follow-wrap').hidden = !['interested', 'follow_up', 'problem'].includes(s);
};
const syncVisit = () => {
  const s = fv.querySelector('input[name=vstatus]:checked')?.value;
  $('#v-phone-wrap').hidden = !(current && !current.phone && NEED_PHONE.includes(s));
  $('#v-problem-wrap').hidden = s !== 'problem';
  $('#v-follow-wrap').hidden = !['interested', 'follow_up', 'problem'].includes(s);
};
statusChips($('#new-status'), 'nstatus', syncNew);
statusChips($('#v-status'), 'vstatus', syncVisit);
fn.phone.addEventListener('input', () => { fn.phone.value = digits(fn.phone.value).replace(/\D/g, ''); });
fn.national_address.addEventListener('input', () => { fn.national_address.value = digits(fn.national_address.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); });
$('#map-pick').addEventListener('click', async () => {
  const p = await pickLocation(coords);
  if (!p) return;
  coords = { lat: p.lat, lng: p.lng, acc: null };
  $('#loc-state').textContent = '📍 ✓ تم تحديد الموقع على الخريطة';
});
fn.photo.addEventListener('change', () => {
  const f = fn.photo.files[0], img = $('#new-prev');
  img.hidden = !f; if (f) img.src = URL.createObjectURL(f);
});

// ---------------- زيارة محل جديد ----------------
const dlgNew = $('#dlg-new');
let dupConfirmed = false;
$('#new').addEventListener('click', () => {
  fn.reset(); dupConfirmed = false; syncOther();
  $('#new-prev').hidden = true; $('#dup').hidden = true; $('.err', fn).textContent = '';
  const ds = [...rep.districts, ...MAKKAH_DISTRICTS.filter(d => !rep.districts.includes(d))];
  fn.district.replaceChildren(new Option('اختر الحي', ''), ...ds.map(d => new Option(d, d)));
  if (rep.districts.length === 1) fn.district.value = rep.districts[0];
  syncNew(); locate();
  dlgNew.showModal();
});
$('#new-cancel').addEventListener('click', () => dlgNew.close());

fn.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fn), btn = $('#new-save');
  const status = fn.querySelector('input[name=nstatus]:checked')?.value;
  const phone = fn.phone.value.trim() || null;
  const photo = fn.photo.files[0];
  if (!photo) return (err.textContent = 'صوّر واجهة المحل أول.');
  if (fn.store_name.value.trim().length < 2) return (err.textContent = 'اكتب اسم المحل.');
  if (!fn.district.value) return (err.textContent = 'اختر الحي.');
  const activity = fn.activity.value === 'أخرى' ? (fn.activity_other?.value.trim() || '') : fn.activity.value;
  if (fn.activity.value === 'أخرى' && activity.length < 2) { fn.activity_other?.focus(); return (err.textContent = 'اكتب اسم نشاط المحل، مثل: ورشة سيارات.'); }
  if (phone && !valid.phone(phone)) return (err.textContent = 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  const na = fn.national_address.value.trim() || null;
  if (na && !valid.nationalAddress(na)) return (err.textContent = 'العنوان الوطني المختصر 4 حروف إنجليزية و4 أرقام، مثل RRRD2929.');
  if (!status) return (err.textContent = 'اختر نتيجة الزيارة.');
  if (!coords && !na) return (err.textContent = 'حدّد موقع المحل: من الجوال أو على الخريطة، أو اكتب العنوان الوطني.');
  if (status === 'problem' && !fn.problem.value) return (err.textContent = 'اختر وش المشكلة.');
  if (NEED_PHONE.includes(status) && !phone) { fn.phone.focus(); return (err.textContent = 'اكتب جوال المحل. مطلوب لما يكون المحل مهتم أو سجّل.'); }
  err.textContent = '';
  setBusy(btn, true, 'جارِ التحقق…');
  try {
    // هل زار المحل أحد قبل؟
    if (!dupConfirmed) {
      const { data: dups } = await sb.rpc('field_duplicates', { p_phone: phone, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null,
        p_name: fn.store_name.value.trim(), p_district: fn.district.value || null });
      if (dups?.length) {
        const box = $('#dup');
        const why = { phone: 'نفس الجوال', near: 'في نفس المكان', name: 'اسم مشابه قريب' };
        const mineDup = dups.find(d => d.mine);
        box.replaceChildren(mk('b', '', '⚠️ انتبه: يمكن هذا المحل مسجّل من قبل'),
          ...dups.map(d => mk('span', '', `«${d.store_name}» (${why[d.reason] || ''}) — ${d.mine ? 'زرته أنت' : 'زاره ' + d.rep_name} ${ago(d.last_visit_at)}` + (d.distance_m != null ? ` · يبعد ${d.distance_m} متر` : '') + ` · ${FIELD_STATUS[d.status]}`)));
        if (mineDup) {
          const s = stores.find(x => x.id === mineDup.store_id);
          box.append(mk('span', 'hint', 'إذا هو نفس المحل، سجّل عليه زيارة جديدة بدل ما تكرره.'));
          if (s) { const open = mk('button', 'btn primary sm', `افتح «${s.store_name}» وسجّل زيارة`); open.type = 'button';
            open.onclick = () => { dlgNew.close(); openStore(s); }; box.append(open); }
          box.append(mk('span', 'hint', 'إذا متأكد إنه محل ثاني، اضغط «حفظ الزيارة» مرة ثانية.'));
        } else {
          box.append(mk('span', 'hint', 'إذا هو نفس المحل لا تسجّله، هذا محل زميلك. إذا متأكد إنه محل ثاني اضغط «حفظ الزيارة» مرة ثانية.'));
        }
        box.hidden = false; dupConfirmed = true;
        box.scrollIntoView({ block: 'center' });
        return;
      }
    }
    btn.textContent = 'جارِ رفع الصورة…';
    const small = await shrinkImage(photo, 1280);
    const path = `${rep.id}/${crypto.randomUUID()}.${small.type === 'image/webp' ? 'webp' : small.type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await sb.storage.from('field-photos').upload(path, small, { contentType: small.type || 'image/jpeg' });
    if (up.error) throw up.error;
    btn.textContent = 'جارِ الحفظ…';
    const row = {
      store_name: fn.store_name.value.trim(), activity: activity || null, district: fn.district.value,
      contact_name: fn.contact_name.value.trim() || null, phone, national_address: na,
      lat: coords?.lat ?? null, lng: coords?.lng ?? null, accuracy_m: coords?.acc ?? null, photo_path: path,
      status, problem: status === 'problem' ? fn.problem.value : null,
      notes: fn.notes.value.trim() || null, follow_up_on: $('#new-follow-wrap').hidden ? null : (fn.follow_up_on.value || null),
    };
    const { error } = await sb.from('field_stores').insert(row);
    if (error) {
      if (/field_stores_phone_uq|duplicate key/i.test(error.message)) throw new Error('هذا الجوال مسجّل لمحل ثاني في الفريق.');
      throw error;
    }
    dlgNew.close();
    toast('تم حفظ الزيارة ✓');
    await load();
  } catch (ex) { err.textContent = friendlyError(ex).replace('صار خطأ: ', ''); }
  finally { setBusy(btn, false); }
});

// ---------------- تفاصيل المحل وزيارة جديدة ----------------
const dlgStore = $('#dlg-store');
async function openStore(s) {
  current = s; fv.reset(); syncVisit(); $('.err', fv).textContent = '';
  const img = $('#st-photo'); img.hidden = !photos[s.photo_path]; img.src = photos[s.photo_path] || '';
  $('#st-name').textContent = s.store_name;
  const b = $('#st-badge'); b.className = 'badge ' + FIELD_BADGE[s.status]; b.textContent = FIELD_STATUS[s.status];
  $('#st-meta').textContent = [s.district, s.activity, s.contact_name, `${s.visits} زيارة`].filter(Boolean).join(' · ');
  const notes = $('#st-notes'); notes.hidden = !s.notes && !s.problem;
  notes.textContent = [s.problem && 'المشكلة: ' + s.problem, s.notes].filter(Boolean).join(' — ');
  const acts = $('#st-actions'); acts.replaceChildren();
  const link = (text, href) => { const a = mk('a', 'btn ghost sm', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); };
  if (s.phone) {
    link('📞 اتصال', 'tel:' + s.phone);
    link('💬 أرسل رابط التسجيل', `https://wa.me/966${s.phone.slice(1)}?text=${encodeURIComponent(regText(s.contact_name))}`);
  }
  if (s.lat != null) link('🗺️ الموقع', `https://www.google.com/maps?q=${s.lat},${s.lng}`);
  $('#visit-box').hidden = s.status === 'registered' && !!s.merchant_id;
  $('#v-save').hidden = $('#visit-box').hidden;
  const tl = $('#st-history'); tl.replaceChildren(mk('div', 'hint', 'جارِ تحميل الزيارات…'));
  dlgStore.showModal();
  const { data } = await sb.from('field_visits').select('*').eq('store_id', s.id).order('created_at', { ascending: false }).limit(20);
  tl.replaceChildren(...(data || []).map(v => {
    const d = mk('div'); d.append(mk('b', '', FIELD_STATUS[v.status]), ` · ${fmtDay(v.created_at)} · ${ago(v.created_at)}`);
    if (v.problem || v.notes) d.append(mk('div', 'hint', [v.problem, v.notes].filter(Boolean).join(' — ')));
    return d;
  }));
  if (s.merchant_id) tl.prepend(mk('div', '', '✅ سجّل في تحصّله وصار تاجر في النظام'));
}
$('#st-close').addEventListener('click', () => dlgStore.close());
fv.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fv), btn = $('#v-save');
  const status = fv.querySelector('input[name=vstatus]:checked')?.value;
  if (!status) return (err.textContent = 'اختر نتيجة الزيارة.');
  if (status === 'problem' && !fv.problem.value) return (err.textContent = 'اختر وش المشكلة.');
  const vphone = digits(fv.phone.value).replace(/\D/g, '');
  const needPhone = !current.phone && NEED_PHONE.includes(status);
  if (needPhone && !valid.phone(vphone)) { fv.phone.focus(); return (err.textContent = 'اكتب جوال المحل صحيح: يبدأ بـ 05 ومكوّن من 10 أرقام.'); }
  setBusy(btn, true);
  try {
    if (needPhone) {
      const { error: pe } = await sb.from('field_stores').update({ phone: vphone }).eq('id', current.id);
      if (pe) throw (/field_stores_phone_uq|duplicate key/i.test(pe.message) ? new Error('هذا الجوال مسجّل لمحل ثاني في الفريق.') : pe);
    }
    const { error } = await sb.from('field_visits').insert({
      store_id: current.id, status, problem: status === 'problem' ? fv.problem.value : null,
      notes: fv.notes.value.trim() || null, lat: coords?.lat ?? null, lng: coords?.lng ?? null,
    });
    if (error) throw error;
    const follow = $('#v-follow-wrap').hidden ? null : (fv.follow_up_on.value || null);
    if (follow !== current.follow_up_on) await sb.from('field_stores').update({ follow_up_on: follow }).eq('id', current.id);
    dlgStore.close(); toast('تم حفظ الزيارة ✓'); await load();
  } catch (ex) { err.textContent = friendlyError(ex); }
  finally { setBusy(btn, false); }
});
