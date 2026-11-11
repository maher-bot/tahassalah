// فاتورة الطلب: نفس الشكل للطباعة عند الكاشير (80 ملم) ولصفحة المشتري (receipt.html) والـ PDF.
// المحل المسجل في الضريبة: «فاتورة ضريبية مبسطة» بالرقم الضريبي والضريبة 15% (الأسعار شاملة الضريبة) ورمز QR الهيئة (المرحلة الأولى).
// غير المسجل: «فاتورة» عادية بدون ضريبة.

export const VAT_RATE = 0.15;
const PAY = { cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل بنكي', tabby: 'تابي', tamara: 'تمارا' };
const FUL = { pickup: 'استلام من المحل', delivery: 'توصيل', roundtrip: 'استلام وتسليم' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n2 = n => Number(n || 0).toFixed(2);
const sar = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function vatSplit(total) {
  const vat = Math.round(Number(total) * VAT_RATE / (1 + VAT_RATE) * 100) / 100;
  return { vat, net: Math.round((Number(total) - vat) * 100) / 100 };
}

// رمز QR حسب مواصفات هيئة الزكاة والضريبة والجمارك (TLV ثم Base64): الاسم، الرقم الضريبي، الوقت، الإجمالي، الضريبة
export function zatcaTlv(inv) {
  const enc = new TextEncoder(), parts = [];
  const { vat } = vatSplit(inv.total);
  const vals = [inv.store_name, inv.vat_number, new Date(inv.issued_at).toISOString().replace(/\.\d{3}Z$/, 'Z'), n2(inv.total), n2(vat)];
  vals.forEach((v, i) => { const b = enc.encode(String(v)); parts.push(i + 1, b.length, ...b); });
  let s = ''; for (const x of parts) s += String.fromCharCode(x);
  return btoa(s);
}

export async function qrSvg(text, cell = 3) {
  const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

// محتوى الفاتورة (بدون html/head)؛ opts: logoUrl, link (رابط الفاتورة للمشتري), note, copy (نص أسفل)
export async function invoiceBody(inv, opts = {}) {
  const tax = !!inv.vat_registered;
  const { vat, net } = vatSplit(inv.total);
  const rows = inv.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${sar(i.price)}</td><td class="n">${sar(i.line_total)}</td></tr>`).join('');
  const day = new Date(inv.issued_at);
  const when = `${day.toLocaleDateString('en-CA')} ${day.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const qr = tax ? await qrSvg(zatcaTlv(inv)) : '';
  return `
    ${opts.logoUrl ? `<div class="c"><img class="logo" src="${esc(opts.logoUrl)}" alt=""></div>` : ''}
    <h1>${esc(inv.store_name)}</h1>
    ${inv.address ? `<div class="c sm">${esc(inv.address)}</div>` : ''}
    ${inv.cr_number ? `<div class="c sm">سجل تجاري: <span class="ltr">${esc(inv.cr_number)}</span></div>` : ''}
    ${tax ? `<div class="c sm">الرقم الضريبي: <span class="ltr">${esc(inv.vat_number)}</span></div>` : ''}
    <div class="title">${tax ? 'فاتورة ضريبية مبسطة' : 'فاتورة'}<br><span class="en">${tax ? 'Simplified Tax Invoice' : 'Invoice'}</span></div>
    <div class="row"><span>رقم الفاتورة</span><b class="ltr">${esc(inv.number)}</b></div>
    <div class="row"><span>التاريخ</span><span class="ltr">${when}</span></div>
    ${inv.buyer_name ? `<div class="row"><span>العميل</span><span>${esc(inv.buyer_name)}</span></div>` : ''}
    <div class="row"><span>الاستلام</span><span>${esc(FUL[inv.fulfillment] || '')}${inv.express ? ' ⚡' : ''}</span></div>
    <table><thead><tr><td><b>الصنف</b></td><td class="n"><b>الكمية</b></td><td class="n"><b>السعر</b></td><td class="n"><b>المبلغ</b></td></tr></thead><tbody>${rows}</tbody></table>
    ${Number(inv.delivery_fee) ? `<div class="row"><span>${inv.fulfillment === 'roundtrip' ? 'الاستلام والتسليم' : 'التوصيل'}</span><span>${sar(inv.delivery_fee)}</span></div>` : ''}
    ${Number(inv.express_fee) ? `<div class="row"><span>مستعجل</span><span>${sar(inv.express_fee)}</span></div>` : ''}
    ${tax ? `<div class="row"><span>الإجمالي غير شامل الضريبة</span><span>${sar(net)}</span></div>
    <div class="row"><span>ضريبة القيمة المضافة 15%</span><span>${sar(vat)}</span></div>` : ''}
    <div class="row tot"><span>${tax ? 'الإجمالي شامل الضريبة' : 'الإجمالي'}</span><span>${sar(inv.total)} ر.س</span></div>
    <div class="row"><span>الدفع</span><span>${esc(PAY[inv.payment_method] || '')}${inv.payment_status === 'paid' ? ' · مدفوع ✓' : ''}</span></div>
    ${opts.note ? `<hr><div>📝 ${esc(opts.note)}</div>` : ''}
    ${qr ? `<div class="qr">${qr}</div>` : ''}
    <hr><div class="c sm">${opts.copy ? esc(opts.copy) + '<br>' : ''}شكرًا لتسوّقكم 🌿 طلب عبر tahassalah.com</div>`;
}

export const INVOICE_CSS = `
  body { font-family: system-ui, Tahoma, sans-serif; font-size: 12px; color: #000; background: #fff; }
  .inv80 { width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 2px 0; } .c { text-align: center; } .sm { font-size: 11px; color: #222; }
  .logo { width: 22mm; height: 22mm; object-fit: contain; }
  .title { text-align: center; font-weight: 700; font-size: 14px; margin: 8px 0 6px; padding: 4px 0; border-block: 1px solid #000; }
  .title .en { font-size: 10px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; } td { padding: 3px 0; border-bottom: 1px dashed #999; vertical-align: top; }
  .n { text-align: left; white-space: nowrap; padding-inline-start: 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .tot { font-size: 15px; font-weight: 700; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
  .ltr { direction: ltr; unicode-bidi: embed; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .qr { width: 32mm; margin: 8px auto 2px; } .qr svg { width: 100%; height: auto; display: block; }`;

export async function invoiceDoc(inv, opts = {}) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>
    @page { size: 80mm auto; margin: 4mm; } body { margin: 0; } ${INVOICE_CSS}</style></head><body><div class="inv80">${await invoiceBody(inv, opts)}</div></body></html>`;
}

// رابط الفاتورة اللي يوصل للمشتري (يحفظ وضع التجريبي)
export function invoiceLink(token, demo) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}receipt.html?t=${token}${demo ? '&demo=1' : ''}`;
}
