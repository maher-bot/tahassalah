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

// تفعيل إشعارات التطبيق لهذا الجهاز (لازم بضغطة من المستخدم، وفي الآيفون بعد تثبيت التطبيق)
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration(); return !!(await reg?.pushManager.getSubscription());
}
export async function enablePush(sb, userId) {
  if (!pushSupported()) throw new Error(ios() && !standalone() ? 'ios_install_first' : 'unsupported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
  const { data: key } = await sb.rpc('vapid_public_key');
  if (!key) throw new Error('not_configured');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
  if (error) throw error;
  return true;
}
// بطاقة «فعّل التنبيهات»
export async function showPushCard(container, sb, userId, text) {
  if (!container || !userId || !pushSupported() && !(ios() && !standalone())) return;
  container.querySelector('.push-card')?.remove();
  if (await pushEnabled()) return;
  try { if (localStorage.getItem('tah-push-hide') === '1') return; } catch {}
  const card = document.createElement('div'); card.className = 'card push-card';
  card.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px;margin-bottom:12px';
  const t = document.createElement('div'); t.style.cssText = 'flex:1;min-width:180px';
  const b = document.createElement('b'); b.textContent = '🔔 فعّل التنبيهات';
  const p = document.createElement('div'); p.className = 'hint';
  p.textContent = ios() && !standalone() ? 'في الآيفون: ثبّت التطبيق أول (زر المشاركة ⬆️ ← إضافة إلى الشاشة الرئيسية)، وافتحه من أيقونته وفعّل التنبيهات.' : text;
  t.append(b, p); card.append(t);
  if (!(ios() && !standalone())) {
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary sm'; go.textContent = 'فعّل';
    go.onclick = async () => {
      try { await enablePush(sb, userId); card.remove(); alert('تم ✓ بتوصلك التنبيهات على هذا الجوال.'); }
      catch (e) { alert(String(e.message) === 'denied' ? 'رفضت التنبيهات. تقدر تفعّلها من إعدادات المتصفح للموقع.' : 'ما قدرنا نفعّل التنبيهات على هذا الجهاز.'); }
    };
    card.append(go);
  }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ghost sm'; x.textContent = 'لاحقًا';
  x.onclick = () => { try { localStorage.setItem('tah-push-hide', '1'); } catch {} card.remove(); };
  card.append(x);
  container.prepend(card);
}
