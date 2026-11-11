// الفواتير المستحقة والميزانية القادمة: نفس الأداة للإدارة (mid = null) وللتاجر (mid = رقم المحل).
// تاريخ السداد يحدده صاحبها، والتذكير بأيام قبل الموعد (يختار أكثر من وحدة) أو بتواريخ محددة، ويتكرر لو الفاتورة شهرية/سنوية.
// صورة الفاتورة من كاميرا الجوال مباشرة أو ملف.
import { takePhoto } from './camera.js';

const mk = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const sar = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = s => Math.round((new Date(s + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
const num = v => { const t = String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬\s]/g, '').replace('٫', '.'); return t === '' ? null : Number(t); };

export const REPEAT = { none: 'مرة وحدة', monthly: 'شهريًا', quarterly: 'كل 3 أشهر', semiannual: 'كل 6 أشهر', yearly: 'سنويًا' };
export const REMIND = [[0, 'يوم الاستحقاق'], [1, 'قبل يوم'], [3, 'قبل 3 أيام'], [7, 'قبل أسبوع'], [14, 'قبل أسبوعين'], [20, 'قبل 20 يوم'], [30, 'قبل شهر'],
  [45, 'قبل 45 يوم'], [60, 'قبل شهرين'], [90, 'قبل 3 أشهر'], [120, 'قبل 4 أشهر'], [180, 'قبل 6 أشهر'], [270, 'قبل 9 أشهر'], [365, 'قبل سنة']];
const METHODS = { transfer: 'تحويل', cash: 'نقدًا', card: 'شبكة/بطاقة', other: 'أخرى' };
const STEP = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

// إنشاء/تعديل فاتورة
export function billDialog({ sb, mid, cats, bill = null, toast, friendlyError, onSaved }) {
  const dlg = mk('dialog'), f = mk('form'); f.method = 'dialog'; f.noValidate = true; dlg.append(f);
  const field = (label, el, hint) => { const l = mk('label'); l.append(mk('span', '', label), el); if (hint) l.append(mk('span', 'hint', hint)); return l; };
  const inp = (name, attrs = {}) => Object.assign(mk('input'), { name, ...attrs });
  const title = inp('title', { maxLength: 120, required: true, placeholder: 'مثال: إيجار المحل، فاتورة الكهرباء، رواتب الموظفين' });
  const vendor = inp('vendor', { maxLength: 120, placeholder: 'الجهة أو المورد (اختياري)' });
  const cat = mk('select'); Object.entries(cats).forEach(([k, v]) => cat.append(new Option(v, k)));
  const amount = inp('amount', { inputMode: 'decimal', dir: 'ltr', required: true });
  const due = inp('due', { type: 'date', required: true });
  const rep = mk('select'); Object.entries(REPEAT).forEach(([k, v]) => rep.append(new Option(v, k)));
  const note = Object.assign(mk('textarea'), { maxLength: 1000, rows: 2, placeholder: 'ملاحظات (اختياري)' });
  // التذكير: يختار أكثر من وحدة
  const rbox = mk('div'); rbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  const chosen = new Set(bill?.remind_days ?? [7, 0]);
  REMIND.forEach(([d, t]) => {
    const b = mk('button', 'btn sm ' + (chosen.has(d) ? 'primary' : 'ghost'), t); b.type = 'button';
    b.onclick = () => { chosen.has(d) ? chosen.delete(d) : chosen.add(d); b.className = 'btn sm ' + (chosen.has(d) ? 'primary' : 'ghost'); };
    rbox.append(b);
  });
  const dates = [...(bill?.remind_dates ?? [])];
  const dbox = mk('div'); dbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
  const dateIn = inp('rdate', { type: 'date' }); dateIn.style.width = 'auto';
  const addDate = mk('button', 'btn ghost sm', '＋ أضف تاريخ تذكير'); addDate.type = 'button';
  const drawDates = () => {
    dbox.replaceChildren(...dates.map((d, i) => { const x = mk('button', 'btn ghost sm', `📅 ${fmt(d)} ✕`); x.type = 'button'; x.onclick = () => { dates.splice(i, 1); drawDates(); }; return x; }), dateIn, addDate);
  };
  addDate.onclick = () => { if (dateIn.value && !dates.includes(dateIn.value)) { dates.push(dateIn.value); dates.sort(); } dateIn.value = ''; drawDates(); };
  drawDates();
  // المرفقات: تصوير مباشر أو ملف
  const files = [...(bill?.attachments ?? [])];
  const fbox = mk('div'); fbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
  const camB = mk('button', 'btn ghost sm', '📷 صوّر الفاتورة'); camB.type = 'button';
  const fileIn = Object.assign(mk('input'), { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  const fileB = mk('button', 'btn ghost sm', '📎 ملف أو صورة'); fileB.type = 'button'; fileB.onclick = () => fileIn.click();
  const folder = () => mid ? `books/${mid}` : 'finance/bills';
  const upload = async (blob, ext) => {
    const path = `${folder()}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('receipts').upload(path, blob, { contentType: blob.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
    if (error) return toast(friendlyError(error));
    files.push(path); drawFiles();
  };
  camB.onclick = async () => { const shot = await takePhoto('فاتورة'); if (shot) upload(shot, 'jpg'); };
  fileIn.onchange = () => { const x = fileIn.files[0]; if (!x) return; if (x.size > 5 * 1024 * 1024) return toast('الملف أكبر من 5 ميجا.'); upload(x, x.type === 'application/pdf' ? 'pdf' : (x.name.split('.').pop() || 'jpg').toLowerCase()); fileIn.value = ''; };
  const drawFiles = () => fbox.replaceChildren(camB, fileB, fileIn, ...files.map((p, i) => {
    const w = mk('span', 'badge approved', `📄 مرفق ${i + 1} `); const x = mk('button', 'btn ghost sm', '✕'); x.type = 'button';
    x.onclick = () => { files.splice(i, 1); drawFiles(); }; w.append(x); return w;
  }));
  drawFiles();

  const err = mk('p', 'err'); err.setAttribute('role', 'alert');
  const save = mk('button', 'btn primary', 'حفظ'); save.type = 'submit';
  const cancel = mk('button', 'btn ghost', 'إلغاء'); cancel.type = 'button'; cancel.onclick = () => dlg.close();
  const foot = mk('div', 'foot'); foot.append(cancel, save);
  const row2 = mk('div', 'row2'); row2.append(field('المبلغ (ر.س)', amount), field('تاريخ السداد', due));
  const row2b = mk('div', 'row2'); row2b.append(field('التصنيف', cat), field('تتكرر؟', rep));
  f.append(mk('h2', '', bill ? 'تعديل فاتورة' : 'فاتورة مستحقة جديدة'), field('الفاتورة', title), field('الجهة', vendor), row2, row2b,
    field('ذكّرني', rbox, 'اختر متى يوصلك التذكير قبل موعد السداد (تقدر تختار أكثر من وحدة).'),
    field('أو في تواريخ محددة', dbox), field('صورة الفاتورة', fbox), note, err, foot);
  if (bill) { title.value = bill.title; vendor.value = bill.vendor || ''; cat.value = bill.category; amount.value = bill.amount; due.value = bill.due_date; rep.value = bill.repeat; note.value = bill.note || ''; }
  else due.value = addDays(today(), 30);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const amt = num(amount.value);
    if (title.value.trim().length < 2) return (err.textContent = 'اكتب اسم الفاتورة.');
    if (!(amt >= 0)) return (err.textContent = 'اكتب المبلغ صح.');
    if (!due.value) return (err.textContent = 'حدد تاريخ السداد.');
    const row = { title: title.value.trim(), vendor: vendor.value.trim() || null, category: cat.value, amount: amt, due_date: due.value,
      repeat: rep.value, remind_days: [...chosen].sort((a, b) => b - a), remind_dates: dates, note: note.value.trim() || null, attachments: files };
    if (bill && (bill.due_date !== row.due_date || String(bill.remind_days) !== String(row.remind_days) || String(bill.remind_dates) !== String(row.remind_dates))) row.reminded = [];
    save.disabled = true;
    const { error } = bill ? await sb.from('bills').update(row).eq('id', bill.id) : await sb.from('bills').insert({ ...row, merchant_id: mid });
    save.disabled = false;
    if (error) return (err.textContent = friendlyError(error));
    dlg.close(); toast('تم الحفظ ✓'); onSaved?.();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); title.focus();
}

// قائمة الفواتير
export async function renderBills(box, { sb, mid, cats, toast, friendlyError, onChange, show = 'open' }) {
  let q = sb.from('bills').select('*').order('due_date', { ascending: show === 'open' }).limit(300);
  q = mid ? q.eq('merchant_id', mid) : q.is('merchant_id', null);
  q = show === 'open' ? q.eq('status', 'open') : q.neq('status', 'open');
  const { data, error } = await q;
  if (error) { box.replaceChildren(mk('p', 'err', friendlyError(error))); return []; }
  if (!data.length) { box.replaceChildren(mk('p', 'hint', show === 'open' ? 'ما فيه فواتير مستحقة. أضف الإيجار والرواتب والفواتير الثابتة عشان يوصلك تذكير قبل موعدها.' : 'ما فيه فواتير مسددة.')); return data; }
  box.replaceChildren(...data.map(b => {
    const el = mk('div', 'row-card'), txt = mk('div');
    const left = daysTo(b.due_date);
    const t = mk('div', 't', `${b.title} `);
    if (b.status === 'open') t.append(mk('span', 'badge ' + (left < 0 ? 'rejected' : left <= 7 ? 'pending' : 'approved'), left < 0 ? `متأخرة ${-left} يوم` : left === 0 ? 'اليوم' : `بعد ${left} يوم`));
    else t.append(mk('span', 'badge approved', `مسددة ${b.paid_at ? fmt(b.paid_at) : ''}`));
    const rem = [...b.remind_days].sort((a, z) => z - a).map(d => REMIND.find(r => r[0] === d)?.[1]).filter(Boolean);
    txt.append(t, mk('div', 's', `${sar(b.status === 'paid' ? b.paid_amount ?? b.amount : b.amount)} · ${fmt(b.due_date)} · ${cats[b.category] || b.category}${b.vendor ? ' · ' + b.vendor : ''}${b.repeat !== 'none' ? ' · 🔁 ' + REPEAT[b.repeat] : ''}`));
    if (b.status === 'open') txt.append(mk('div', 's', '⏰ ' + [...rem, ...(b.remind_dates || []).map(fmt)].join('، ')));
    if (b.note) txt.append(mk('div', 's', b.note));
    const acts = mk('div', 'acts');
    const btn = (label, cls, fn) => { const x = mk('button', 'btn sm ' + cls, label); x.type = 'button'; x.onclick = fn; acts.append(x); return x; };
    if (b.attachments?.length) btn(`📄 ${b.attachments.length}`, 'ghost', async () => { for (const p of b.attachments) { const { data } = await sb.storage.from('receipts').createSignedUrl(p, 300); if (data) open(data.signedUrl, '_blank'); } });
    if (b.status === 'open') {
      btn('✓ تم السداد', 'primary', async () => {
        const m = prompt(`طريقة السداد؟ اكتب رقم:\n1 تحويل · 2 نقدًا · 3 شبكة/بطاقة · 4 أخرى`, '1'); if (m == null) return;
        const method = ['transfer', 'cash', 'card', 'other'][Number(m) - 1] || 'other';
        const a = prompt('المبلغ المسدد:', b.amount); if (a == null) return;
        const { data: r, error } = await sb.rpc('bill_pay', { bid: b.id, method, paid_on: today(), amount: num(a) ?? b.amount });
        if (error) return toast(friendlyError(error));
        toast(r?.next_due ? `تم ✓ وانضافت الجاية لـ ${fmt(r.next_due)}` : 'تم السداد ✓ وانحفظت في المصروفات', 5000); onChange?.();
      });
      btn('تعديل', 'ghost', () => billDialog({ sb, mid, cats, bill: b, toast, friendlyError, onSaved: onChange }));
      btn('حذف', 'danger', async () => { if (!confirm(`حذف «${b.title}»؟`)) return; const { error } = await sb.from('bills').delete().eq('id', b.id); if (error) return toast(friendlyError(error)); onChange?.(); });
    } else if (b.paid_method) txt.append(mk('div', 's', 'السداد: ' + (METHODS[b.paid_method] || b.paid_method)));
    el.append(txt, acts); return el;
  }));
  return data;
}

// الميزانية القادمة: فواتير لازم تنسدد (مع تكرار المتكررة) مقابل الدخل المتوقع، لشهر وشهرين و3 أشهر
export function renderForecast(box, { bills, inflow = [], monthlyIncome = null, incomeLabel }) {
  const t = today(), horizons = [30, 60, 90];
  const outs = [];
  bills.filter(b => b.status === 'open').forEach(b => {
    outs.push({ date: b.due_date, amount: Number(b.amount) });
    const step = STEP[b.repeat];
    if (step) for (let k = 1; k <= 12; k++) { const d = new Date(b.due_date + 'T12:00:00'); d.setMonth(d.getMonth() + step * k); const s = d.toISOString().slice(0, 10); if (daysTo(s) > 90) break; outs.push({ date: s, amount: Number(b.amount) }); }
  });
  const rows = horizons.map(h => {
    const end = addDays(t, h);
    const out = outs.filter(o => o.date <= end).reduce((s, o) => s + o.amount, 0);   // يشمل المتأخرة
    const inc = monthlyIncome != null ? monthlyIncome * h / 30 : inflow.filter(i => i.date <= end).reduce((s, i) => s + Number(i.amount), 0);
    return { h, out, inc, net: inc - out };
  });
  const w = mk('div', 'table-wrap'), tb = mk('table');
  const tr = (cells, th = false) => { const r = mk('tr'); cells.forEach(c => { const x = mk(th ? 'th' : 'td'); if (c instanceof Node) x.append(c); else x.textContent = c; r.append(x); }); return r; };
  tb.append(tr(['', 'خلال شهر', 'خلال شهرين', 'خلال 3 أشهر'], true),
    tr(['فواتير لازم تنسدد', ...rows.map(r => sar(r.out))]),
    tr([incomeLabel, ...rows.map(r => sar(r.inc))]),
    tr(['الفرق', ...rows.map(r => { const b = mk('b', '', sar(r.net)); b.style.color = r.net < 0 ? 'var(--danger, #b42318)' : 'var(--brand)'; return b; })]));
  w.append(tb); w.querySelector('table').style.minWidth = '460px';
  const warn = rows.find(r => r.net < 0);
  box.replaceChildren(w, mk('p', 'hint', warn ? `⚠️ خلال ${warn.h === 30 ? 'شهر' : warn.h === 60 ? 'شهرين' : '3 أشهر'} الفواتير أكثر من الدخل المتوقع بـ ${sar(-warn.net)}. رتّب السيولة من الحين.` : 'الدخل المتوقع يغطي الفواتير في الفترات الثلاث.'));
}

// قيد دخل أو مصروف (للتاجر)، مع صورة الفاتورة أو الإيصال
export function entryDialog({ sb, mid, cats, kind, entry = null, toast, friendlyError, onSaved }) {
  const dlg = mk('dialog'), f = mk('form'); f.method = 'dialog'; f.noValidate = true; dlg.append(f);
  const field = (label, el) => { const l = mk('label'); l.append(mk('span', '', label), el); return l; };
  const cat = mk('select'); Object.entries(cats[kind]).forEach(([k, v]) => cat.append(new Option(v, k)));
  const amount = Object.assign(mk('input'), { inputMode: 'decimal', dir: 'ltr' });
  const date = Object.assign(mk('input'), { type: 'date', value: entry?.entry_date || today() });
  const desc = Object.assign(mk('input'), { maxLength: 300, placeholder: kind === 'expense' ? 'مثال: راتب أحمد لشهر نوفمبر' : 'مثال: مبيعات المحل نقدًا' });
  const files = [...(entry?.attachments ?? [])];
  const fbox = mk('div'); fbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
  const camB = mk('button', 'btn ghost sm', '📷 صوّر الفاتورة'); camB.type = 'button';
  const fileIn = Object.assign(mk('input'), { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  const fileB = mk('button', 'btn ghost sm', '📎 ملف'); fileB.type = 'button'; fileB.onclick = () => fileIn.click();
  const upload = async (blob, ext) => {
    const path = `books/${mid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('receipts').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
    if (error) return toast(friendlyError(error)); files.push(path); draw();
  };
  camB.onclick = async () => { const s = await takePhoto('فاتورة'); if (s) upload(s, 'jpg'); };
  fileIn.onchange = () => { const x = fileIn.files[0]; if (!x) return; if (x.size > 5 * 1024 * 1024) return toast('الملف أكبر من 5 ميجا.'); upload(x, x.type === 'application/pdf' ? 'pdf' : 'jpg'); fileIn.value = ''; };
  const draw = () => fbox.replaceChildren(camB, fileB, fileIn, ...files.map((p, i) => { const w = mk('span', 'badge approved', `📄 ${i + 1} `); const x = mk('button', 'btn ghost sm', '✕'); x.type = 'button'; x.onclick = () => { files.splice(i, 1); draw(); }; w.append(x); return w; }));
  draw();
  if (entry) { cat.value = entry.category; amount.value = entry.amount; desc.value = entry.description || ''; }
  const err = mk('p', 'err'), save = mk('button', 'btn primary', 'حفظ'); save.type = 'submit';
  const cancel = mk('button', 'btn ghost', 'إلغاء'); cancel.type = 'button'; cancel.onclick = () => dlg.close();
  const foot = mk('div', 'foot'); foot.append(cancel, save);
  const r2 = mk('div', 'row2'); r2.append(field('المبلغ (ر.س)', amount), field('التاريخ', date));
  f.append(mk('h2', '', kind === 'expense' ? 'مصروف' : 'دخل'), field('التصنيف', cat), r2, field('الوصف', desc), field('الفاتورة أو الإيصال', fbox), err, foot);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const amt = num(amount.value);
    if (!(amt >= 0) || amount.value.trim() === '') return (err.textContent = 'اكتب المبلغ صح.');
    const row = { kind, category: cat.value, amount: amt, entry_date: date.value || today(), description: desc.value.trim() || null, attachments: files };
    save.disabled = true;
    const { error } = entry ? await sb.from('merchant_entries').update(row).eq('id', entry.id) : await sb.from('merchant_entries').insert({ ...row, merchant_id: mid });
    save.disabled = false;
    if (error) return (err.textContent = friendlyError(error));
    dlg.close(); toast('تم الحفظ ✓'); onSaved?.();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); amount.focus();
}
