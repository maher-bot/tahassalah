// مسح الباركود بالكاميرا (للمشتري): scanBarcode() ترجّع رقم الباركود أو null لو أُغلقت.
// تستخدم BarcodeDetector لو المتصفح يدعمه، وإلا مكتبة ZXing. فيها خانة لكتابة الرقم يدويًا.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const toDigits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
// باركود GS1: نطلع رقم المنتج GTIN بعد المعرّف 01
export function normBarcode(code) {
  let d = toDigits(code);
  if (d.length > 14 && d.startsWith('01')) d = d.slice(2, 16);
  if (d.length === 14 && d.startsWith('0')) d = d.slice(1);
  return d;
}

let dlg = null;
function build() {
  dlg = document.createElement('dialog'); dlg.id = 'dlg-scan';
  dlg.innerHTML = `<div class="stack">
    <h2 style="font-size:1.2rem">وجّه الكاميرا على الباركود</h2>
    <div class="scanbox"><video playsinline muted></video><span class="scanline"></span></div>
    <p class="hint" data-state>جارِ تشغيل الكاميرا…</p>
    <label>أو اكتب رقم الباركود<input inputmode="numeric" dir="ltr" autocomplete="off"></label>
    <div class="foot"><span style="flex:1"></span><button class="btn ghost" type="button" data-close>إغلاق</button><button class="btn primary" type="button" data-ok>بحث</button></div>
  </div>`;
  document.body.append(dlg);
}

export function scanBarcode() {
  if (!dlg) build();
  const video = dlg.querySelector('video'), state = dlg.querySelector('[data-state]'), manual = dlg.querySelector('input');
  manual.value = ''; state.textContent = 'جارِ تشغيل الكاميرا…';
  return new Promise(resolve => {
    let stop = null, finished = false;
    const finish = code => {
      if (finished) return; finished = true;
      const s = stop; stop = null; try { s?.(); } catch {}
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      if (code && 'vibrate' in navigator) navigator.vibrate(60);
      resolve(code ? normBarcode(code) : null);
    };
    const onClose = () => finish(null);
    dlg.addEventListener('close', onClose);
    dlg.querySelector('[data-close]').onclick = () => finish(null);
    dlg.querySelector('[data-ok]').onclick = () => { const v = normBarcode(manual.value); if (v.length >= 6) finish(v); else state.textContent = 'اكتب رقم الباركود كامل.'; };
    manual.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('[data-ok]').click(); } };
    dlg.showModal();
    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const supported = await BarcodeDetector.getSupportedFormats();
          const det = new BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) });
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (finished) { stream.getTracks().forEach(t => t.stop()); return; }
          video.srcObject = stream; await video.play();
          let on = true;
          stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
          const tick = async () => {
            if (!on) return;
            try { const r = await det.detect(video); if (r[0]?.rawValue) return finish(r[0].rawValue); } catch {}
            setTimeout(tick, 180);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, res => { if (res) finish(res.getText()); });
          if (finished) controls.stop(); else stop = () => controls.stop();
        }
        if (!finished) state.textContent = 'وجّه الكاميرا على الباركود وقرّبها لين يوضح.';
      } catch {
        if (!finished) state.textContent = 'ما قدرنا نشغّل الكاميرا. اسمح للمتصفح باستخدامها، أو اكتب رقم الباركود تحت.';
      }
    })();
  });
}
