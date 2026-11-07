import { sb, $, $$, toast, PLANS, KIND_ICON, friendlyError, setBusy, fmtDay, fileExt, shrinkImage, digits } from './lib.js';

// ---------------- أساسيات ----------------
const VIEWS = ['v-loading', 'v-denied', 'v-app'];
const show = id => VIEWS.forEach(v => { $('#' + v).hidden = v !== id; });
const sar = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
const mk = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const DAY = 86400000;
const METHOD = { transfer: 'تحويل', pos: 'شبكة', cash: 'نقدي' };
const CATS = {
  income: { subscription: 'اشتراكات التجار', other_income: 'دخل آخر' },
  expense: { salaries: 'رواتب', rep_bonus: 'مكافآت المسوّقين', rent: 'إيجار', marketing: 'تسويق وإعلانات', tech: 'تقنية واستضافة', government: 'رسوم حكومية', transport: 'مواصلات', other: 'أخرى' },
};
const catName = (k, c) => CATS[k]?.[c] || c;

let me = null, merchants = [], invoices = [], entries = [], settings = null, tab = 'sum';
const monthEl = $('#month');
monthEl.value = new Date().toISOString().slice(0, 7);
const monthRange = () => { const [y, m] = monthEl.value.split('-').map(Number); return [new Date(y, m - 1, 1), new Date(y, m, 1)]; };
const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// نفس منطق billing_due في القاعدة
function dueOf(m) {
  if (m.plan === 'free') {
    if (!m.trial_started_at) return null;
    const t = new Date(m.trial_started_at); t.setMonth(t.getMonth() + (m.trial_months || 3));
    return m.paid_until && new Date(m.paid_until) > t ? new Date(m.paid_until) : t;
  }
  if (m.plan === 'basic') return m.basic_until ? new Date(m.basic_until) : null;
  return m.paid_until ? new Date(m.paid_until) : null;
}
function billPlan(m) {
  if (['family', 'trader', 'pro'].includes(m.plan)) return m.plan;
  if (m.kind === 'store') return m.next_plan === 'pro' ? 'pro' : 'trader';
  return ['trader', 'pro'].includes(m.next_plan) ? m.next_plan : 'family';
}

if (location.hash === '#bills') setTimeout(() => $('#tabs [data-t=bills]')?.click(), 0);
// ---------------- الدخول ----------------
sb.auth.getSession().then(async ({ data: { session } }) => {
  me = session?.user;
  $('#who').textContent = me?.email ?? '';
  $('#logout').hidden = !me;
  if (!me) { location.href = 'admin.html'; return; }
  const { data: ok } = await sb.rpc('is_admin');
  if (!ok) return show('v-denied');
  show('v-app');
  await loadAll();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'admin.html'; });

$$('#tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.t;
  $$('#tabs [role=tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  $$('[data-p]').forEach(p => { p.hidden = p.dataset.p !== tab; });
  render();
}));
monthEl.addEventListener('change', () => loadAll());

async function loadAll() {
  const [from, to] = monthRange();
  const [m, i, f, s] = await Promise.all([
    sb.from('merchants').select('id,store_name,owner_name,phone,email,kind,status,plan,next_plan,billing,trial_started_at,trial_months,paid_until,basic_until,rep_code').eq('status', 'approved').order('store_name'),
    sb.from('invoices').select('*').order('issued_at', { ascending: false }).limit(2000),
    sb.from('finance_entries').select('*').gte('entry_date', isoDay(from)).lt('entry_date', isoDay(to)).order('entry_date', { ascending: false }),
    sb.from('billing_settings').select('*').single(),
  ]);
  for (const r of [m, i, f, s]) if (r.error) return toast(friendlyError(r.error));
  merchants = m.data; invoices = i.data; entries = f.data; settings = s.data;
  render();
}

function render() {
  const open = invoices.filter(x => x.status === 'issued');
  $('#c-bills').textContent = open.length;
  if (tab === 'sum') renderSum(open);
  if (tab === 'bills') renderBills();
  if (tab === 'reps') renderReps();
  if (tab === 'ledger') renderLedger();
  if (tab === 'settings') renderSettings();
}

// ---------------- الملخص ----------------
function renderSum(open) {
  const inc = entries.filter(e => e.kind === 'income'), exp = entries.filter(e => e.kind === 'expense');
  const sum = (a, k = 'amount') => a.reduce((s, e) => s + Number(e[k] || 0), 0);
  $('#s-inc').textContent = sar(sum(inc));
  $('#s-exp').textContent = sar(sum(exp));
  $('#s-net').textContent = sar(sum(inc) - sum(exp));
  $('#s-vat').textContent = sar(sum(inc, 'vat'));
  $('#s-open').textContent = `${open.length} · ${sar(open.reduce((s, x) => s + Number(x.total), 0))}`;
  const now = Date.now();
  $('#s-late').textContent = merchants.filter(m => { const d = dueOf(m); return d && d < now; }).length;
  $('#s-soon').textContent = merchants.filter(m => { const d = dueOf(m); return d && d >= now && d - now <= 7 * DAY; }).length;
}

// ---------------- التجار والمطالبات ----------------
$('#bq').addEventListener('input', () => renderBills());
$('#bf').addEventListener('change', () => renderBills());

function renderBills() {
  const q = digits($('#bq').value.trim()).toLowerCase(), f = $('#bf').value, now = Date.now();
  const [from, to] = monthRange();
  const openBy = new Map(invoices.filter(x => x.status === 'issued').map(x => [x.merchant_id, x]));
  const lastPaid = new Map();
  for (const x of invoices) if (x.status === 'paid' && !lastPaid.has(x.merchant_id)) lastPaid.set(x.merchant_id, x);
  const rows = merchants.map(m => ({ m, due: dueOf(m), inv: openBy.get(m.id), paid: lastPaid.get(m.id) }))
    .filter(({ m, due, inv, paid }) => {
      if (q && !(m.store_name.toLowerCase().includes(q) || (m.phone || '').includes(q) || (inv?.number || '').toLowerCase().includes(q))) return false;
      if (f === 'soon') return due && due >= now && due - now <= 7 * DAY;
      if (f === 'late') return due && due < now;
      if (f === 'open') return !!inv;
      if (f === 'proof') return !!inv?.submitted_at;
      if (f === 'paid') return paid && new Date(paid.paid_at) >= from && new Date(paid.paid_at) < to;
      if (f === 'none') return !due;
      return true;
    })
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const tb = $('#bills');
  tb.replaceChildren(...rows.map(({ m, due, inv, paid }) => {
    const tr = document.createElement('tr');
    const td = (x, cls) => { const t = mk('td', cls || ''); if (x instanceof Node) t.append(x); else t.textContent = x; tr.append(t); return t; };
    const who = mk('div'); who.append(mk('b', '', `${KIND_ICON[m.kind] || ''} ${m.store_name}`), mk('div', 'hint num', [m.owner_name, m.phone].filter(Boolean).join(' · ')));
    td(who);
    const p = billPlan(m);
    td(`${PLANS[m.plan] || m.plan}${m.plan === 'free' ? ' ← ' + PLANS[p] : ''}${m.billing === 'yearly' ? ' · سنوي' : ''}`);
    td(due ? fmtDay(due) : 'يبدأ مع الإطلاق', 'num');
    const left = due ? Math.ceil((due - now) / DAY) : null;
    const badge = mk('span', 'badge num ' + (left == null ? '' : left < 0 ? 'rejected' : left <= 7 ? 'pending' : 'approved'),
      left == null ? '—' : left < 0 ? `متأخر ${-left} يوم` : left === 0 ? 'اليوم' : `${left} يوم`);
    td(badge);
    const invCell = mk('div');
    if (inv) {
      const a = mk('a', 'num', inv.number); a.href = 'invoice.html?id=' + inv.id; a.target = '_blank';
      invCell.append(a, mk('div', 'hint num', sar(inv.total)));
      if (inv.submitted_at) {
        const r = mk('a', 'badge pending', '📎 إيصال من التاجر'); r.href = '#';
        r.onclick = async ev => { ev.preventDefault(); const { data } = await sb.storage.from('receipts').createSignedUrl(inv.submitted_receipt, 300); if (data) open(data.signedUrl, '_blank'); };
        invCell.append(r);
      }
    } else if (paid) {
      const a = mk('a', 'num', '✓ ' + paid.number); a.href = 'invoice.html?id=' + paid.id; a.target = '_blank';
      invCell.append(a, mk('div', 'hint', `${METHOD[paid.paid_method] || ''} · ${fmtDay(paid.paid_at)}`));
    } else invCell.textContent = '—';
    td(invCell);
    const act = mk('div'); act.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    if (inv) {
      const pay = mk('button', 'btn primary sm', inv.submitted_at ? '✓ تأكيد السداد' : '💳 تسجيل سداد'); pay.type = 'button'; pay.onclick = () => openPay(inv);
      const v = mk('button', 'btn ghost sm', 'إلغاء'); v.type = 'button'; v.onclick = () => voidInv(inv);
      act.append(pay, v);
    } else {
      const is = mk('button', 'btn ghost sm', '🧾 إصدار مطالبة'); is.type = 'button'; is.onclick = () => issue(m, is);
      act.append(is);
    }
    td(act);
    return tr;
  }));
  if (!rows.length) { const tr = document.createElement('tr'); const t = mk('td', 'hint', 'ما فيه نتائج.'); t.colSpan = 6; tr.append(t); tb.append(tr); }
}

async function issue(m, btn) {
  const due = dueOf(m);
  if (!confirm(`إصدار مطالبة لـ «${m.store_name}» (${PLANS[billPlan(m)]}${m.billing === 'yearly' ? ' سنوي' : ''})؟${due ? '' : '\nملاحظة: فترته المجانية ما بدأت بعد، فالاشتراك يبدأ من اليوم.'}`)) return;
  setBusy(btn, true);
  const { data, error } = await sb.rpc('issue_invoice', { mid: m.id });
  setBusy(btn, false);
  if (error) return toast(friendlyError(error));
  toast(`صدرت المطالبة ${data.number}. توصله بالإيميل في رسالة التذكير الجاية (الصبح).`);
  loadAll();
}

async function voidInv(inv) {
  const reason = prompt(`إلغاء المطالبة ${inv.number}؟ اكتب السبب:`);
  if (reason == null) return;
  const { error } = await sb.rpc('void_invoice', { inv_id: inv.id, reason });
  if (error) return toast(friendlyError(error));
  toast('تم الإلغاء.'); loadAll();
}

// تسجيل السداد
const dlg = $('#dlg-pay'), fp = $('#f-pay');
let paying = null;
function openPay(inv) {
  paying = inv; fp.reset(); $('.err', fp).textContent = '';
  $('#pay-what').textContent = `${inv.store_name} · ${inv.number} · ${sar(inv.total)}`;
  if (inv.submitted_at) { fp.method.value = 'transfer'; fp.ref.value = inv.submitted_ref || ''; $('#pay-what').textContent += ' · 📎 التاجر رفع إيصال (يُحفظ مع السداد)'; }
  dlg.showModal();
}
$('#pay-cancel').addEventListener('click', () => dlg.close());
fp.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#pay-save'), err = $('.err', fp);
  setBusy(btn, true);
  try {
    let receipt = paying.submitted_receipt || null;
    const f = fp.file.files[0];
    if (f) {
      if (f.size > 5 * 1024 * 1024 && !f.type.startsWith('image/')) throw new Error('الإيصال أكبر من 5 ميجا.');
      const up = await shrinkImage(f, 1600);
      receipt = `${me.id}/${paying.number}-${Date.now()}.${fileExt(up)}`;
      const { error } = await sb.storage.from('receipts').upload(receipt, up, { contentType: up.type || undefined });
      if (error) throw error;
    }
    const { error } = await sb.rpc('pay_invoice', { inv_id: paying.id, method: fp.method.value, ref: fp.ref.value, receipt });
    if (error) throw error;
    dlg.close(); toast('تم تسجيل السداد وتجديد الاشتراك ✓'); loadAll();
  } catch (ex) { err.textContent = friendlyError(ex); } finally { setBusy(btn, false); }
});

// ---------------- المسوّقين ----------------
async function renderReps() {
  const tb = $('#reps');
  const [from] = monthRange();
  const { data, error } = await sb.rpc('rep_month_stats', { m: isoDay(from) });
  if (error) return toast(friendlyError(error));
  tb.replaceChildren(...data.map(r => {
    const tr = document.createElement('tr');
    const td = (x, cls) => { const t = mk('td', cls || ''); if (x instanceof Node) t.append(x); else t.textContent = x; tr.append(t); return t; };
    const who = mk('div'); who.append(mk('b', '', r.name), mk('div', 'hint num', r.code + (r.active ? '' : ' · موقوف')));
    td(who); td(String(r.stores), 'num');
    const inp = (val, key) => {
      const i = Object.assign(document.createElement('input'), { value: val, inputMode: 'decimal', dir: 'ltr' }); i.style.cssText = 'width:80px';
      i.onchange = async () => {
        const v = Number(digits(i.value)); if (!(v >= 0)) return toast('رقم غير صحيح.');
        const { error } = await sb.from('reps').update({ [key]: v }).eq('id', r.rep_id);
        if (error) return toast(friendlyError(error));
        toast('تم الحفظ.'); renderReps();
      };
      return i;
    };
    td(inp(r.monthly_target, 'monthly_target')); td(inp(r.bonus_per_store, 'bonus_per_store'));
    td(String(r.extra), 'num'); td(sar(r.bonus), 'num');
    const act = mk('div');
    if (r.paid) act.append(mk('span', 'badge approved', `✓ انصرف ${sar(r.paid_amount)}`));
    else if (Number(r.bonus) > 0) {
      const b = mk('button', 'btn primary sm', 'صرف المكافأة'); b.type = 'button';
      b.onclick = async () => {
        if (!confirm(`تسجيل صرف ${sar(r.bonus)} لـ ${r.name} عن ${monthEl.value}؟ (تنضاف كمصروف)`)) return;
        const { error } = await sb.from('finance_entries').insert({ kind: 'expense', category: 'rep_bonus', amount: r.bonus, entry_date: isoDay(new Date()),
          description: `مكافأة ${r.name} (${r.code}) عن ${monthEl.value}: ${r.extra} محل × ${r.bonus_per_store}`, rep_id: r.rep_id, ref_month: isoDay(from), created_by: me.id });
        if (error) return toast(friendlyError(error));
        toast('تم التسجيل.'); loadAll();
      };
      act.append(b);
    } else act.append(mk('span', 'hint', r.stores ? `باقي ${r.monthly_target - r.stores} للهدف` : '—'));
    td(act);
    return tr;
  }));
}

// ---------------- الدخل والمصروفات ----------------
const fe = $('#f-entry');
fe.entry_date.value = isoDay(new Date());
const fillCats = () => { fe.category.replaceChildren(...Object.entries(CATS[fe.kind.value]).filter(([k]) => k !== 'subscription').map(([k, v]) => new Option(v, k))); };
fe.kind.addEventListener('change', fillCats); fillCats();
fe.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', fe), btn = $('#entry-save');
  const amount = Number(digits(fe.amount.value)), vat = Number(digits(fe.vat.value || '0'));
  if (!(amount > 0)) return (err.textContent = 'اكتب المبلغ.');
  if (!(vat >= 0)) return (err.textContent = 'الضريبة رقم.');
  setBusy(btn, true);
  try {
    let attachment_path = null;
    const f = fe.file.files[0];
    if (f) {
      const up = await shrinkImage(f, 1600);
      attachment_path = `finance/${Date.now()}.${fileExt(up)}`;
      const { error } = await sb.storage.from('receipts').upload(attachment_path, up, { contentType: up.type || undefined });
      if (error) throw error;
    }
    const { error } = await sb.from('finance_entries').insert({ kind: fe.kind.value, category: fe.category.value, amount, vat,
      entry_date: fe.entry_date.value, description: fe.description.value.trim() || null, attachment_path, created_by: me.id });
    if (error) throw error;
    err.textContent = ''; fe.amount.value = ''; fe.vat.value = '0'; fe.description.value = ''; fe.file.value = '';
    toast('تمت الإضافة.'); loadAll();
  } catch (ex) { err.textContent = friendlyError(ex); } finally { setBusy(btn, false); }
});

function renderLedger() {
  const tb = $('#ledger');
  const inc = entries.filter(e => e.kind === 'income').reduce((s, e) => s + Number(e.amount), 0);
  const exp = entries.filter(e => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0);
  $('#l-total').textContent = `دخل ${sar(inc)} · مصروف ${sar(exp)} · صافي ${sar(inc - exp)}`;
  tb.replaceChildren(...entries.map(e => {
    const tr = document.createElement('tr');
    const td = (x, cls) => { const t = mk('td', cls || ''); if (x instanceof Node) t.append(x); else t.textContent = x; tr.append(t); return t; };
    td(e.entry_date, 'num');
    td(mk('span', 'badge ' + (e.kind === 'income' ? 'approved' : 'pending'), e.kind === 'income' ? 'دخل' : 'مصروف'));
    td(catName(e.kind, e.category));
    const d = mk('div', '', e.description || '—');
    if (e.attachment_path) {
      const a = mk('a', '', ' 📎'); a.href = '#';
      a.onclick = async ev => { ev.preventDefault(); const { data } = await sb.storage.from('receipts').createSignedUrl(e.attachment_path, 300); if (data) open(data.signedUrl, '_blank'); };
      d.append(a);
    }
    td(d); td(sar(e.amount), 'num'); td(sar(e.vat), 'num');
    const act = mk('div');
    if (!e.invoice_id) {
      const del = mk('button', 'btn ghost sm', 'حذف'); del.type = 'button';
      del.onclick = async () => {
        if (!confirm('حذف هذا القيد؟')) return;
        const { error } = await sb.from('finance_entries').delete().eq('id', e.id);
        if (error) return toast(friendlyError(error));
        loadAll();
      };
      act.append(del);
    } else act.append(mk('span', 'hint', 'من مطالبة'));
    td(act);
    return tr;
  }));
  if (!entries.length) { const tr = document.createElement('tr'); const t = mk('td', 'hint', 'ما فيه قيود في هذا الشهر.'); t.colSpan = 7; tr.append(t); tb.append(tr); }
}

$('#csv').addEventListener('click', () => {
  const head = ['التاريخ', 'النوع', 'التصنيف', 'الوصف', 'المبلغ', 'الضريبة', 'الإجمالي'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(q).join(','), ...entries.map(e => [e.entry_date, e.kind === 'income' ? 'دخل' : 'مصروف', catName(e.kind, e.category), e.description,
    e.amount, e.vat, (Number(e.amount) + Number(e.vat)).toFixed(2)].map(q).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tahassalah-accounts-${monthEl.value}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

// ---------------- الإعدادات ----------------
const fs = $('#f-settings');
function renderSettings() {
  for (const k of ['company_name', 'cr_number', 'vat_number', 'address', 'bank_name', 'iban']) fs[k].value = settings?.[k] ?? '';
}
fs.addEventListener('submit', async e => {
  e.preventDefault();
  const row = {};
  for (const k of ['company_name', 'cr_number', 'vat_number', 'address', 'bank_name', 'iban']) row[k] = fs[k].value.trim() || null;
  if (row.iban) row.iban = row.iban.replace(/\s+/g, '').toUpperCase();
  if (row.iban && !/^SA\d{22}$/.test(row.iban)) return ($('.err', fs).textContent = 'الآيبان يبدأ بـ SA وبعده 22 رقم.');
  row.updated_at = new Date().toISOString();
  const { error } = await sb.from('billing_settings').update(row).eq('id', true);
  if (error) return ($('.err', fs).textContent = friendlyError(error));
  $('.err', fs).textContent = ''; toast('تم الحفظ.'); loadAll();
});
