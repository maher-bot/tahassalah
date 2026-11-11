// أدوات عرض مؤشرات الأداء (لوحة التاجر ولوحة الإدارة): بطاقات أرقام، أشرطة، أعمدة يومية، وجداول.
export const mk = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const nf = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
export const sar = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 }) + ' ر.س';
export const mins = m => m == null ? '—' : m < 60 ? `${nf(m)} دقيقة` : `${nf(m / 60)} ساعة`;

export function section(title, hint, ...kids) {
  const c = mk('div', 'card stack'); c.style.padding = '16px';
  c.append(mk('b', '', title)); if (hint) c.append(mk('div', 'hint', hint));
  c.append(...kids.filter(Boolean)); return c;
}
export function kpis(list) {
  const g = mk('div', 'kpis');
  list.forEach(([label, value, sub]) => { const s = mk('div', 'stat'); s.append(mk('b', 'num', value), mk('span', '', label)); if (sub) s.append(mk('small', '', sub)); g.append(s); });
  return g;
}
// أشرطة أفقية (سلسلة وحدة: لون الهوية)، والقيمة مكتوبة جنب كل شريط
export function bars(rows, fmt = nf) {
  if (!rows.length) return mk('p', 'hint', 'ما فيه بيانات في هذي الفترة.');
  const max = Math.max(...rows.map(r => r.value), 1), box = mk('div', 'sbars');
  rows.forEach(r => {
    const row = mk('div', 'sbar'); row.title = `${r.label}: ${fmt(r.value)}${r.note ? ' · ' + r.note : ''}`;
    const tr = mk('div', 'track'), i = mk('i'); i.style.width = (r.value / max * 100) + '%'; tr.append(i);
    row.append(mk('span', '', r.label), tr, mk('b', '', fmt(r.value) + (r.note ? ` · ${r.note}` : '')));
    box.append(row);
  });
  return box;
}
// أعمدة يومية: كل يوم في الفترة (الأيام بدون طلبات تطلع رمادية)
export function dayCols(byDay, days, label = 'طلب') {
  const map = Object.fromEntries(byDay.map(x => [x.d, x.n])), out = mk('div'), cols = mk('div', 'scols');
  const list = [];
  for (let k = days - 1; k >= 0; k--) { const d = new Date(Date.now() - k * 864e5); list.push(new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10)); }
  const max = Math.max(...list.map(d => map[d] || 0), 1);
  list.forEach(d => { const n = map[d] || 0, i = mk('i', n ? '' : 'zero'); i.style.height = (n / max * 100) + '%'; i.title = `${d}: ${n} ${label}`; cols.append(i); });
  const x = mk('div', 'scols-x'); x.append(mk('span', '', list[0]), mk('span', '', list[list.length - 1]));
  out.append(cols, x); return out;
}
export function hourCols(byHour) {
  const map = Object.fromEntries(byHour.map(x => [x.h, x.n])), out = mk('div'), cols = mk('div', 'scols');
  const max = Math.max(...Object.values(map), 1);
  for (let h = 0; h < 24; h++) { const n = map[h] || 0, i = mk('i', n ? '' : 'zero'); i.style.height = (n / max * 100) + '%'; i.title = `الساعة ${h}:00 · ${n} طلب`; cols.append(i); }
  const x = mk('div', 'scols-x'); x.append(mk('span', '', '12 ص'), mk('span', '', '12 م'), mk('span', '', '11 م'));
  out.append(cols, x); return out;
}
export function table(head, rows) {
  if (!rows.length) return mk('p', 'hint', 'ما فيه بيانات في هذي الفترة.');
  const w = mk('div', 'table-wrap'), t = mk('table'), th = mk('tr');
  head.forEach(h => th.append(mk('th', '', h))); t.append(th);
  rows.forEach(r => { const tr = mk('tr'); r.forEach((v, i) => { const td = mk('td'); if (head[i]) td.dataset.label = head[i]; if (v instanceof Node) td.append(v); else td.textContent = v ?? '—'; tr.append(td); }); t.append(tr); });
  w.append(t); return w;
}
