// تحصّله — Service Worker بسيط عشان يقدر المستخدم يثبّت الموقع كتطبيق على جواله.
// كل الطلبات من الشبكة مباشرة (البيانات دايمًا محدّثة)، ولو انقطع النت تطلع صفحة «ما فيه اتصال».
const OFFLINE = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تحصّله</title><body style="font-family:Tahoma,Arial;background:#F3F6F5;color:#10231F;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">
<div><div style="font-size:48px">📶</div><h2>ما فيه اتصال بالإنترنت</h2><p>تأكد من النت وحاول مرة ثانية.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 20px;border-radius:999px;border:0;background:#105E51;color:#fff">إعادة المحاولة</button></div></body></html>`;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
