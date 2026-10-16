import { rememberLogin, hidePasswords, sb, $, $$, toast, digits, valid, friendlyError, setBusy, fmtDay,
  FIELD_STATUS, FIELD_BADGE, MAKKAH_DISTRICTS, ago } from './lib.js';

const VIEWS = ['v-loading', 'v-login', 'v-denied', 'v-app'];
const show = id => VIEWS.forEach(v => { $('#' + v).hidden = v !== id; });
const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
let reps = [], stores = [], visits = [], photos = {}, routedFor, editing = null;

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
  if (!user) return show('v-login');
  show('v-loading');
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin) return show('v-denied');
  show('v-app');
  await load();
}

function since() {
  const p = $('#period').value, d = new Date();
  if (p === 'all') return null;
  if (p === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (p === 'week' ? 7 : 30));
  return d;
}

async function load() {
  const from = since();
  let vq = sb.from('field_visits').select('id, store_id, rep_id, status, created_at').order('created_at', { ascending: false }).limit(5000);
  if (from) vq = vq.gte('created_at', from.toISOString());
  const [r, s, v] = await Promise.all([
    sb.from('reps').select('*').order('code'),
    sb.from('field_stores').select('*').order('last_visit_at', { ascending: false }).limit(3000),
    vq,
  ]);
  const err = r.error || s.error || v.error;
  if (err) return toast(friendlyError(err));
  reps = r.data; stores = s.data; visits = v.data;
  const repSel = $('#f-rep'), keep = repSel.value;
  repSel.replaceChildren(new Option('كل المسوّقين', ''), ...reps.map(x => new Option(`${x.name} (${x.code})`, x.id)));
  repSel.value = keep;
  const dSel = $('#f-district'), keepD = dSel.value;
  dSel.replaceChildren(new Option('كل الأحياء', ''), ...[...new Set(stores.map(x => x.district).filter(Boolean))].map(d => new Option(d, d)));
  dSel.value = keepD;
  if ($('#f-status').options.length === 1) $('#f-status').append(...Object.entries(FIELD_STATUS).map(([k, l]) => new Option(l, k)));
  render();
}
$('#period').addEventListener('change', load);
$('#reload').addEventListener('click', load);
for (const id of ['#q', '#f-rep', '#f-district', '#f-status']) $(id).addEventListener('input', renderStores);

// المحلات اللي انزارت في الفترة المختارة
function inPeriod(s) {
  const from = since();
  return !from || new Date(s.last_visit_at) >= from || new Date(s.created_at) >= from;
}

function render() {
  const from = since();
  const scope = stores.filter(inPeriod);
  const count = st => scope.filter(s => st.includes(s.status)).length;
  $('#k-visits').textContent = visits.length;
  $('#k-new').textContent = stores.filter(s => !from || new Date(s.created_at) >= from).length;
  $('#k-reg').textContent = count(['registered']);
  $('#k-int').textContent = count(['interested', 'follow_up']);
  $('#k-prob').textContent = count(['problem']);
  $('#k-conv').textContent = (scope.length ? Math.round(count(['registered']) / scope.length * 100) : 0) + '%';

  // جدول المسوّقين
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const body = $('#reps');
  if (!reps.length) { body.innerHTML = '<tr><td colspan="12" class="hint" style="text-align:center;padding:24px">ما أضفت مسوّقين بعد. اضغط «إضافة مسوّق».</td></tr>'; }
  else body.replaceChildren(...reps.map(r => {
    const mine = scope.filter(s => s.rep_id === r.id), c = st => mine.filter(s => s.status === st).length;
    const vis = visits.filter(v => v.rep_id === r.id);
    const todayN = visits.filter(v => v.rep_id === r.id && new Date(v.created_at) >= start).length;
    const last = stores.filter(s => s.rep_id === r.id).map(s => s.last_visit_at).sort().pop();
    const conv = mine.length ? Math.round(c('registered') / mine.length * 100) : 0;
    const tr = document.createElement('tr');
    const td = (x, cls) => { const t = mk('td', cls || ''); if (x instanceof Node) t.append(x); else t.textContent = x; tr.append(t); return t; };
    const who = mk('div'); who.append(mk('b', '', r.name), mk('div', 'hint num', r.code + (r.active ? '' : ' · موقوف')));
    const links = mk('div'); links.style.cssText = 'display:flex;gap:10px;font-size:.85rem';
    const e = mk('a', '', 'تعديل'); e.href = '#'; e.onclick = ev => { ev.preventDefault(); openRep(r); };
    const v = mk('a', '', 'محلاته'); v.href = '#'; v.onclick = ev => { ev.preventDefault(); $('#f-rep').value = r.id; renderStores(); $('#stores').scrollIntoView({ behavior: 'smooth' }); };
    links.append(e, v); who.append(links);
    td(who); td(r.districts.join('، ') || '—');
    td(vis.length, 'num');
    const tgt = mk('div'); tgt.append(mk('span', 'num', `${todayN} / ${r.daily_target}`));
    const bar = mk('div', 'bar'); const i = mk('i'); i.style.width = Math.min(100, r.daily_target ? todayN / r.daily_target * 100 : 0) + '%'; bar.append(i); tgt.append(bar);
    td(tgt);
    td(stores.filter(s => s.rep_id === r.id && (!from || new Date(s.created_at) >= from)).length, 'num');
    td(c('registered'), 'num'); td(c('interested'), 'num'); td(c('follow_up'), 'num'); td(c('problem'), 'num'); td(c('not_interested'), 'num');
    td(conv + '%', 'num'); td(last ? ago(last) : '—');
    return tr;
  }));

  // المشاكل والأحياء
  const tally = (arr, key) => Object.entries(arr.reduce((a, x) => (x[key] ? (a[x[key]] = (a[x[key]] || 0) + 1) : 0, a), {})).sort((a, b) => b[1] - a[1]);
  const bars = (box, rows, empty) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    box.replaceChildren(...(rows.length ? rows.slice(0, 10).map(([k, n]) => {
      const d = mk('div'); d.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-bottom:8px';
      const bar = mk('div', 'bar'); bar.style.gridColumn = '1 / -1'; const i = mk('i'); i.style.width = (n / max * 100) + '%'; bar.append(i);
      d.append(mk('span', '', k), mk('b', 'num', n), bar); return d;
    }) : [mk('p', 'hint', empty)]));
  };
  bars($('#problems'), tally(scope.filter(s => s.status === 'problem'), 'problem'), 'ما فيه مشاكل مسجّلة في هذي الفترة.');
  const dist = Object.entries(scope.reduce((a, s) => { if (!s.district) return a; const x = a[s.district] ||= [0, 0]; x[0]++; if (s.status === 'registered') x[1]++; return a; }, {}))
    .sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, r]]) => [`${k} · سجّل ${r}`, n]);
  bars($('#districts'), dist, 'ما فيه زيارات في هذي الفترة.');
  renderStores();
}

async function renderStores() {
  const q = $('#q').value.trim().toLowerCase(), fr = $('#f-rep').value, fd = $('#f-district').value, fs = $('#f-status').value;
  const list = stores.filter(s => inPeriod(s) && (!fr || s.rep_id === fr) && (!fd || s.district === fd) && (!fs || s.status === fs)
    && (!q || [s.store_name, s.phone, s.contact_name].some(x => (x || '').toLowerCase().includes(q)))).slice(0, 300);
  $('#s-count').textContent = `${list.length} محل` + (list.length === 300 ? ' (أول 300)' : '');
  const need = [...new Set(list.map(s => s.photo_path).filter(p => p && !photos[p]))];
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from('field-photos').createSignedUrls(need.slice(i, i + 100), 3600);
    (data || []).forEach(d => { if (d.signedUrl) photos[d.path] = d.signedUrl; });
  }
  const repName = id => reps.find(r => r.id === id)?.name || '—';
  const box = $('#stores');
  if (!list.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">ما فيه محلات بهذي الفلاتر.</div>'; return; }
  box.replaceChildren(...list.map(s => {
    const el = mk('button', 'fstore'); el.type = 'button';
    const url = photos[s.photo_path];
    el.append(url ? Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' }) : mk('div', 'ph', s.store_name.trim()[0]));
    const mid = mk('div'); mid.style.minWidth = '0';
    const top = mk('div'); top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    top.append(mk('span', 'n', s.store_name), mk('span', 'badge ' + FIELD_BADGE[s.status], FIELD_STATUS[s.status]));
    const m = mk('div', 'm');
    m.append(mk('span', '', `${repName(s.rep_id)} · ${s.district || '—'}`), mk('span', 'num', `${s.visits} زيارة · ${ago(s.last_visit_at)}`));
    if (s.problem) m.append(mk('span', 'low', s.problem));
    if (s.notes) m.append(mk('span', '', s.notes.length > 70 ? s.notes.slice(0, 70) + '…' : s.notes));
    mid.append(top, m); el.append(mid);
    el.onclick = () => openStore(s, repName(s.rep_id));
    return el;
  }));
}

let shown = null;
async function openStore(s, repName) {
  shown = s;
  const dlg = $('#dlg-store');
  const img = $('#d-photo'); img.hidden = !photos[s.photo_path]; img.src = photos[s.photo_path] || '';
  $('#d-name').textContent = s.store_name;
  const b = $('#d-badge'); b.className = 'badge ' + FIELD_BADGE[s.status]; b.textContent = FIELD_STATUS[s.status];
  $('#d-meta').textContent = [`المسوّق: ${repName}`, s.district, s.activity, s.contact_name, s.phone, s.national_address && 'العنوان الوطني ' + s.national_address, s.lat != null ? (s.accuracy_m != null ? `دقة الموقع ${s.accuracy_m} م` : 'الموقع محدد على الخريطة') : 'بدون موقع'].filter(Boolean).join(' · ');
  const acts = $('#d-actions'); acts.replaceChildren();
  const link = (t, h) => { const a = mk('a', 'btn ghost sm', t); a.href = h; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); };
  if (s.phone) link('📞 اتصال', 'tel:' + s.phone);
  if (s.lat != null) link('🗺️ الموقع على الخريطة', `https://www.google.com/maps?q=${s.lat},${s.lng}`);
  if (s.merchant_id) link('🏪 ملف التاجر', 'admin.html#' + s.merchant_id);
  const tl = $('#d-history'); tl.replaceChildren(mk('div', 'hint', 'جارِ التحميل…'));
  dlg.showModal();
  const { data } = await sb.from('field_visits').select('*').eq('store_id', s.id).order('created_at', { ascending: false });
  tl.replaceChildren(...(data || []).map(v => {
    const d = mk('div'); d.append(mk('b', '', FIELD_STATUS[v.status]), ` · ${fmtDay(v.created_at)} · ${new Date(v.created_at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}`);
    if (v.problem || v.notes) d.append(mk('div', 'hint', [v.problem, v.notes].filter(Boolean).join(' — ')));
    return d;
  }));
}
$('#d-close').addEventListener('click', () => $('#dlg-store').close());
$('#d-del').addEventListener('click', async () => {
  if (!shown || !confirm(`حذف «${shown.store_name}» وكل زياراته نهائيًا؟\nاستخدمه للمحلات المكررة أو المسجّلة بالغلط.`)) return;
  const { error } = await sb.from('field_stores').delete().eq('id', shown.id);
  if (error) return toast(friendlyError(error));
  if (shown.photo_path) sb.storage.from('field-photos').remove([shown.photo_path]);
  $('#dlg-store').close(); toast('تم الحذف.'); load();
});

// ---------------- إضافة وتعديل مسوّق ----------------
const fr = $('#f-rep-edit'), dlgRep = $('#dlg-rep');
function openRep(r) {
  editing = r; fr.reset(); $('.err', fr).textContent = '';
  $('#rep-title').textContent = r ? 'تعديل المسوّق' : 'إضافة مسوّق';
  const taken = new Map(reps.filter(x => x !== r).flatMap(x => x.districts.map(d => [d, x.name.split(' ')[0]])));
  const all = [...new Set([...MAKKAH_DISTRICTS, ...(r?.districts || [])])];
  $('#rep-districts').replaceChildren(...all.map(d => {
    const lab = mk('label'); const c = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'd', value: d });
    c.checked = !!r?.districts.includes(d);
    lab.append(c, d);
    if (taken.has(d)) { lab.append(mk('span', 'hint', '(' + taken.get(d) + ')')); lab.title = 'مسند لـ ' + taken.get(d); }
    return lab;
  }));
  if (r) {
    fr.name.value = r.name; fr.email.value = r.email; fr.phone.value = r.phone || ''; fr.code.value = r.code;
    fr.daily_target.value = r.daily_target; fr.active.checked = r.active;
  } else {
    let n = reps.length + 1; while (reps.some(x => x.code === 'M' + String(n).padStart(2, '0'))) n++;
    fr.code.value = 'M' + String(n).padStart(2, '0');
  }
  dlgRep.showModal();
}
$('#add-rep').addEventListener('click', () => openRep(null));
$('#rep-cancel').addEventListener('click', () => dlgRep.close());
fr.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fr), btn = $('#rep-save');
  const districts = [...$$('#rep-districts input:checked').map(c => c.value),
    ...fr.extra.value.split(/[،,]/).map(x => x.trim()).filter(Boolean)].filter((d, i, a) => a.indexOf(d) === i);
  const row = {
    name: fr.name.value.trim(), email: fr.email.value.trim().toLowerCase(), phone: digits(fr.phone.value).replace(/\D/g, '') || null,
    code: fr.code.value.trim().toUpperCase(), daily_target: Number(digits(fr.daily_target.value)) || 0,
    districts, active: fr.active.checked,
  };
  if (row.name.length < 2) return (err.textContent = 'اكتب اسم المسوّق.');
  if (!/^\S+@\S+\.\S+$/.test(row.email)) return (err.textContent = 'اكتب إيميل صحيح.');
  if (row.phone && !valid.phone(row.phone)) return (err.textContent = 'الجوال يبدأ بـ 05 ومكوّن من 10 أرقام.');
  if (!/^[A-Z0-9]{2,8}$/.test(row.code)) return (err.textContent = 'الكود حروف إنجليزية وأرقام فقط، مثل M01.');
  setBusy(btn, true);
  const { error } = editing ? await sb.from('reps').update(row).eq('id', editing.id) : await sb.from('reps').insert(row);
  setBusy(btn, false);
  if (error) {
    err.textContent = /reps_email_key/.test(error.message) ? 'هذا الإيميل مضاف من قبل.' : /reps_code_key/.test(error.message) ? 'هذا الكود مستخدم لمسوّق ثاني.' : friendlyError(error);
    return;
  }
  dlgRep.close();
  toast(editing ? 'تم الحفظ.' : `تمت إضافة ${row.name}. أرسل له رابط tahassalah.com/rep.html`, 6000);
  load();
});
