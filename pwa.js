// تثبيت تحصّله كتطبيق على الجوال: أندرويد (زر تثبيت مباشر) وآيفون (تعليمات «إضافة إلى الشاشة الرئيسية»).
// showInstall(container): يطلع بطاقة التثبيت لو الجهاز يقدر وما هو مثبّت.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
let deferred = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const listeners = [];
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; listeners.forEach(f => f()); });
addEventListener('appinstalled', () => { deferred = null; document.querySelectorAll('.pwa-card').forEach(x => x.remove()); });

export function showInstall(container, text = 'ثبّت تحصّله على جوالك، وافتحه من أيقونته مثل أي تطبيق.') {
  if (!container || standalone()) return;
  try { if (localStorage.getItem('tah-pwa-hide') === '1') return; } catch {}
  const render = () => {
    container.querySelector('.pwa-card')?.remove();
    if (!deferred && !ios()) return;
    const card = document.createElement('div'); card.className = 'card pwa-card';
    card.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px;margin-bottom:12px';
    const img = Object.assign(document.createElement('img'), { src: 'brand/icon-192.png', alt: '', width: 44, height: 44 }); img.style.borderRadius = '12px';
    const t = document.createElement('div'); t.style.cssText = 'flex:1;min-width:180px';
    const b = document.createElement('b'); b.textContent = '📲 تطبيق تحصّله';
    const p = document.createElement('div'); p.className = 'hint';
    p.textContent = ios() ? 'من سفاري: اضغط زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية».' : text;
    t.append(b, p);
    card.append(img, t);
    if (deferred) {
      const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary sm'; go.textContent = 'ثبّت';
      go.onclick = async () => { deferred.prompt(); await deferred.userChoice; deferred = null; card.remove(); };
      card.append(go);
    }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ghost sm'; x.textContent = 'لاحقًا';
    x.onclick = () => { try { localStorage.setItem('tah-pwa-hide', '1'); } catch {} card.remove(); };
    card.append(x);
    container.prepend(card);
  };
  listeners.push(render); render();
}
