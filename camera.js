// كاميرا داخل الصفحة (للمندوب): التصوير مباشرة بدون اختيار ملف من الجوال، والصورة ما تنحفظ في جهازه.
// takePhoto(stamp) → Promise<Blob|null>. يطبع على الصورة رقم الطلب والتاريخ والوقت.
export async function takePhoto(stamp = '') {
  if (!navigator.mediaDevices?.getUserMedia) { alert('جهازك ما يدعم الكاميرا من المتصفح. افتح الصفحة من كروم أو سفاري.'); return null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false }); }
  catch { alert('اسمح للمتصفح باستخدام الكاميرا عشان تصوّر الطلب.'); return null; }

  const dlg = document.createElement('dialog');
  dlg.style.cssText = 'padding:0;border:0;border-radius:16px;width:min(560px,calc(100vw - 16px));background:#000;color:#fff';
  dlg.innerHTML = `<div style="display:grid;gap:10px;padding:10px">
    <video playsinline autoplay muted style="width:100%;border-radius:12px;background:#111"></video>
    <img alt="" hidden style="width:100%;border-radius:12px">
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button type="button" class="btn primary" data-a="shot">📸 التقط</button>
      <button type="button" class="btn primary" data-a="use" hidden>✓ استخدم الصورة</button>
      <button type="button" class="btn ghost" data-a="retake" hidden style="color:#fff">إعادة</button>
      <button type="button" class="btn ghost" data-a="cancel" style="color:#fff">إلغاء</button>
    </div></div>`;
  document.body.append(dlg);
  const video = dlg.querySelector('video'), img = dlg.querySelector('img'), btn = a => dlg.querySelector(`[data-a=${a}]`);
  video.srcObject = stream;
  dlg.showModal();

  let blob = null;
  return await new Promise(resolve => {
    const done = v => { stream.getTracks().forEach(t => t.stop()); dlg.close(); dlg.remove(); if (img.src) URL.revokeObjectURL(img.src); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    btn('cancel').onclick = () => done(null);
    btn('shot').onclick = () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return;
      const scale = Math.min(1, 1600 / Math.max(w, h)), c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const g = c.getContext('2d'); g.drawImage(video, 0, 0, c.width, c.height);
      // ختم الطلب والوقت على الصورة
      const text = `${stamp} · ${new Date().toLocaleString('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' })}`;
      const fs = Math.max(16, Math.round(c.width / 32));
      g.font = `bold ${fs}px sans-serif`; g.direction = 'rtl'; g.textAlign = 'right';
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, c.height - fs * 1.8, c.width, fs * 1.8);
      g.fillStyle = '#fff'; g.fillText(text, c.width - fs * 0.6, c.height - fs * 0.6);
      c.toBlob(b => {
        blob = b; img.src = URL.createObjectURL(b);
        img.hidden = false; video.hidden = true;
        btn('shot').hidden = true; btn('use').hidden = false; btn('retake').hidden = false;
      }, 'image/jpeg', 0.85);
    };
    btn('retake').onclick = () => {
      URL.revokeObjectURL(img.src); img.removeAttribute('src'); img.hidden = true; video.hidden = false; blob = null;
      btn('shot').hidden = false; btn('use').hidden = true; btn('retake').hidden = true;
    };
    btn('use').onclick = () => done(blob);
  });
}
