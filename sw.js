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

// إشعارات التطبيق
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'تحصّله', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'تحصّله', {
    body: d.body || '', icon: 'brand/icon-192.png', badge: 'brand/icon-192.png', tag: d.tag, renotify: true, dir: 'rtl', lang: 'ar',
    data: { url: d.url || 'merchant.html' }, vibrate: [200, 100, 200],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || 'merchant.html', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.split('#')[0].split('?')[0] === url.split('#')[0].split('?')[0] && 'focus' in c) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
