// موافقة التحليلات (Google Analytics): ما يشتغل التتبّع إلا بعد موافقة الزائر، واختياره ينحفظ في متصفحه.
// gtag() تبقى معرّفة دائمًا، فأي حدث قبل الموافقة ينضاف للطابور وما ينرسل إلا لو وافق.
(() => {
  const GA = 'G-7Y22WDZD7P', KEY = 'tah-analytics';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  let choice = null; try { choice = localStorage.getItem(KEY); } catch {}
  const load = () => {
    const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA;
    document.head.append(s); gtag('js', new Date()); gtag('config', GA);
  };
  if (choice === 'yes') return load();
  if (choice === 'no') return;
  const show = () => {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'موافقة التحليلات');
    bar.style.cssText = 'position:fixed;inset-inline:12px;bottom:12px;z-index:9999;max-width:560px;margin-inline:auto;background:var(--surface,#fff);color:inherit;border:1px solid var(--line,#d9e1dc);border-radius:14px;padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.12);display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:.92rem';
    const p = document.createElement('p'); p.style.cssText = 'flex:1 1 260px;margin:0;line-height:1.6';
    p.innerHTML = 'نستخدم Google Analytics لنعرف كيف يوصلنا الزوار ونحسّن الموقع. ما يشتغل إلا بموافقتك. <a href="privacy.html#analytics">التفاصيل</a>';
    const yes = document.createElement('button'); yes.className = 'btn primary sm'; yes.type = 'button'; yes.textContent = 'أوافق';
    const no = document.createElement('button'); no.className = 'btn ghost sm'; no.type = 'button'; no.textContent = 'لا، شكرًا';
    const done = v => { try { localStorage.setItem(KEY, v); } catch {} bar.remove(); if (v === 'yes') load(); };
    yes.onclick = () => done('yes'); no.onclick = () => done('no');
    bar.append(p, no, yes); document.body.append(bar);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
