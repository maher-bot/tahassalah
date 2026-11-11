// فحص الجوال: يفتح كل صفحة وكل تبويب (عام، تاجر، مشتري، إدارة، مسوّق، مندوب) على مقاس جوال،
// ويطلّع أي عنصر يطلع برا عرض الشاشة. يشتغل على النسخة التجريبية فقط (القاعدة الحقيقية محجوبة في الاختبار)
// وبملفات المستودع المحلية (مو المنشورة).
//   node tests/mobile-check.js            ← كل الصفحات بعرض 390
//   W=360 node tests/mobile-check.js      ← بعرض 360 (جوالات أصغر)
//   node tests/mobile-check.js merchant   ← جزء واحد: public | merchant | buyer | staff
// اختياري: VEND=<مجلد> فيه نسخ محلية من مكتبات CDN (sb, zx, qr, h2c, jspdf .esm.js) لو الشبكة ما توصل لـ jsdelivr.
// النتيجة: ✓/✗ لكل شاشة، وملف mobile-check-<W>.json، وكود خروج 1 لو فيه مشكلة.
const { chromium } = require('playwright'); const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROOT = require('path').resolve(__dirname, '..') + '/';
const VEND = process.env.VEND;
const PW = 'Demo@2026';
const W = +(process.env.W || 390);
async function ctxFor() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ar-SA' });
  await ctx.addInitScript(() => { try { localStorage.setItem('tah-analytics', 'no'); } catch {} });
  await ctx.grantPermissions(['geolocation'], { origin: 'https://tahassalah.com' }); await ctx.setGeolocation({ latitude: 21.4225, longitude: 39.8262 });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('loyiwdjgtvyihnzrqskn')) return r.abort();
    if (/googletagmanager|google-analytics/.test(u)) return r.abort();
    if (VEND) for (const [k, f] of [['@supabase/supabase-js', 'sb'], ['@zxing/browser', 'zx'], ['qrcode-generator', 'qr'], ['html2canvas', 'h2c'], ['jspdf', 'jspdf']])
      if (u.includes('cdn.jsdelivr.net/npm/' + k)) return r.fulfill({ path: VEND + '/' + f + '.esm.js', contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    const m = u.match(/^https:\/\/tahassalah\.com\/([^?#]*)/);
    if (m) { const f = m[1] || 'index.html'; if (fs.existsSync(ROOT + f) && fs.statSync(ROOT + f).isFile()) return r.fulfill({ path: ROOT + f, contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : undefined }); }
    return r.continue();
  });
  const page = await ctx.newPage(); page.on('dialog', d => d.dismiss());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  return { browser, page, errs };
}
async function check(page, label, out) {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    const clipped = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) return true; } } return false; };
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.position === 'fixed') continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      if ((r.right > W + 1 || r.left < -1) && !clipped(el)) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.innerText || '').trim().slice(0, 30)}"`);
    }
    return { sw: document.documentElement.scrollWidth, W, bad };
  });
  const ok = r.sw <= r.W + 1 && !r.bad.length;
  out.push({ label, ok, ...r });
  console.log(ok ? '✓' : '✗', label, ok ? '' : `scrollWidth=${r.sw} ` + r.bad.slice(0, 5).join(' | '));
}
async function login(page, path, email) {
  await page.goto('https://tahassalah.com/' + path + '?demo=1', { waitUntil: 'networkidle' });
  const lt = page.locator('[role=tab][data-tab=login]'); if (await lt.count() && await lt.first().isVisible()) await lt.first().click();
  const form = page.locator('form:visible').filter({ has: page.locator('input[type=password]') }).first();
  await form.locator('input[name=email]').fill(email); await form.locator('input[type=password]').fill(PW);
  await form.locator('button[type=submit]').first().click(); await wait(4000); await page.waitForLoadState('networkidle');
}
async function tabs(page, sel, label, out) {
  const ids = await page.$$eval(sel, b => b.filter(x => x.offsetParent).map((x, i) => i));
  for (const i of ids) {
    const b = page.locator(sel).nth(i); const name = (await b.innerText()).replace(/\s+/g, ' ').trim();
    await b.click().catch(() => {}); await wait(2200); await page.mouse.wheel(0, 0);
    await check(page, `${label} › ${name}`, out);
  }
}
async function main(only) {
  const out = [];
  // صفحات عامة
  if (!only || only === 'public') { const { browser, page, errs } = await ctxFor();
    for (const f of ['index.html', 'terms.html', 'privacy.html', 'pos-api.html', 'shop.html?demo=1', 'receipt.html?t=00000000-0000-0000-0000-000000000000&demo=1', 'merchant.html?demo=1'])
      { await page.goto('https://tahassalah.com/' + f, { waitUntil: 'networkidle' }); await wait(1500); await check(page, f, out); }
    await browser.close(); errs.forEach(e => console.log('pageerror', e)); }
  // صاحب المحل: كل التبويبات والتبويبات الفرعية
  if (!only || only === 'merchant') { const { browser, page, errs } = await ctxFor();
    await login(page, 'merchant.html', 'store.demo@example.com');
    await check(page, 'تاجر › البداية', out);
    const main = await page.$$eval('#d-tabs [data-tab]', b => b.filter(x => x.offsetParent).map(x => x.dataset.tab));
    for (const t of main) {
      await page.click(`#d-tabs [data-tab=${t}]`); await wait(2500);
      await check(page, `تاجر › ${t}`, out);
      const sub = `[data-tab-panel="${t}"] [role=tab], #t-${t} [role=tab]`;
      if (await page.locator(sub).count()) await tabs(page, sub, `تاجر › ${t}`, out);
    }
    await browser.close(); errs.forEach(e => console.log('pageerror', e)); }
  // المشتري
  if (!only || only === 'buyer') { const { browser, page, errs } = await ctxFor();
    await page.goto('https://tahassalah.com/shop.html?demo=1', { waitUntil: 'networkidle' }); await wait(1500);
    if (await page.locator('#f-demo').isVisible()) { await page.click('#f-demo button[type=submit]'); await wait(3500); }
    await page.goto('https://tahassalah.com/shop.html?demo=1', { waitUntil: 'networkidle' }); await wait(2500);
    await check(page, 'مشتري › المحلات', out);
    await page.locator('#stores button', { hasText: 'بقالة النور' }).first().click(); await wait(2500); await check(page, 'مشتري › المحل', out);
    await page.locator('#products .prod button', { hasText: 'أضف' }).first().click(); await wait(500);
    await page.click('#go-cart'); await wait(1200); await check(page, 'مشتري › السلة', out);
    await page.goto('https://tahassalah.com/shop.html?demo=1#orders', { waitUntil: 'networkidle' }); await wait(3000); await check(page, 'مشتري › طلباتي', out);
    await browser.close(); errs.forEach(e => console.log('pageerror', e)); }
  // الإدارة والمسوّق والمندوب
  if (!only || only === 'staff') for (const [path, email, sel] of [['admin.html', 'admin.demo@example.com', '[role=tab]'], ['accounts.html', 'admin.demo@example.com', '[role=tab]'], ['stats.html', 'admin.demo@example.com', '[role=tab]'],
    ['field.html', 'admin.demo@example.com', '[role=tab]'], ['rep.html', 'rep.demo@example.com', '[role=tab]'], ['merchant.html', 'driver.demo@example.com', '#d-tabs [role=tab]']]) {
    const { browser, page, errs } = await ctxFor();
    await login(page, path, email); if (!page.url().includes(path)) await page.goto('https://tahassalah.com/' + path + '?demo=1', { waitUntil: 'networkidle' }); await wait(2500); await check(page, `${path} (${email.split('.')[0]})`, out);
    await tabs(page, sel, `${path} (${email.split('.')[0]})`, out);
    await browser.close(); errs.forEach(e => console.log('pageerror', path, e));
  }
  const bad = out.filter(x => !x.ok);
  console.log(`\nالمجموع ${out.length} شاشة · سليمة ${out.length - bad.length} · فيها مشكلة ${bad.length}`);
  fs.writeFileSync(`mobile-check-${W}.json`, JSON.stringify(out, null, 1));
  process.exitCode = bad.length ? 1 : 0;
}
if (require.main === module) main(process.argv[2]);
module.exports = { ctxFor, login, check, wait };
