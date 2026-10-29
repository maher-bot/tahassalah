// مصدر الحملة من رابط الإعلان (?utm_source=snapchat&utm_campaign=sharaie…) — نحفظه 30 يوم
// عشان نربطه بطلب تسجيل التاجر حتى لو تنقّل بين الصفحات أو رجع بعد تأكيد الإيميل
(() => {
  try {
    const q = new URLSearchParams(location.search);
    const u = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const v = q.get(k);
      if (v) u[k] = v.slice(0, 60);
    }
    if (u.utm_source) localStorage.setItem('tah-utm', JSON.stringify({ ...u, at: Date.now() }));
  } catch {}
})();
