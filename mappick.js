// تحديد موقع المحل على الخريطة (Leaflet + OpenStreetMap)
// pickLocation({ lat, lng }) → Promise<{ lat, lng } | null>
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
const MAKKAH = [21.4225, 39.8262];
let ready;

function loadLeaflet() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET + 'leaflet.css' });
    document.head.append(css);
    const js = Object.assign(document.createElement('script'), { src: LEAFLET + 'leaflet.js' });
    js.onload = () => resolve(window.L);
    js.onerror = () => { ready = null; reject(new Error('map_failed')); };
    document.head.append(js);
  });
  return ready;
}

function dialog() {
  let d = document.getElementById('dlg-map');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'dlg-map';
  d.innerHTML = `
    <div class="stack" style="padding:16px">
      <h2 style="font-size:1.15rem">حدّد موقع المحل على الخريطة</h2>
      <p class="hint">اسحب الدبوس أو اضغط على مكان المحل بالضبط.</p>
      <div id="map-box" style="height:min(60vh,420px);border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>
      <p class="hint num" id="map-coords" dir="ltr" style="text-align:end"></p>
      <div class="foot">
        <button class="btn ghost sm" type="button" id="map-me">📍 موقعي الحالي</button>
        <span style="flex:1"></span>
        <button class="btn ghost" type="button" id="map-cancel">إلغاء</button>
        <button class="btn primary" type="button" id="map-ok">اعتماد الموقع</button>
      </div>
    </div>`;
  document.body.append(d);
  return d;
}

export async function pickLocation(start) {
  let L;
  try { L = await loadLeaflet(); } catch { alert('ما قدرنا نحمّل الخريطة. تأكد من الإنترنت وحاول مرة ثانية.'); return null; }
  const d = dialog();
  d.showModal();
  const box = d.querySelector('#map-box');
  box.replaceChildren();
  const at = start?.lat != null ? [start.lat, start.lng] : MAKKAH;
  const map = L.map(box, { zoomControl: true }).setView(at, start?.lat != null ? 18 : 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  const icon = L.divIcon({ className: '', iconSize: [30, 40], iconAnchor: [15, 40],
    html: '<svg viewBox="0 0 24 24" width="30" height="40"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="#E2683C"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>' });
  const pin = L.marker(at, { draggable: true, icon }).addTo(map);
  const show = () => { const p = pin.getLatLng(); d.querySelector('#map-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`; };
  pin.on('dragend', show);
  map.on('click', e => { pin.setLatLng(e.latlng); show(); });
  show();
  setTimeout(() => map.invalidateSize(), 50);
  d.querySelector('#map-me').onclick = () => navigator.geolocation?.getCurrentPosition(
    p => { const ll = [p.coords.latitude, p.coords.longitude]; pin.setLatLng(ll); map.setView(ll, 18); show(); },
    () => alert('ما قدرنا نحدد موقعك. اسمح للمتصفح بالموقع.'), { enableHighAccuracy: true, timeout: 15000 });
  return new Promise(resolve => {
    const done = v => { d.close(); map.remove(); resolve(v); };
    d.querySelector('#map-ok').onclick = () => { const p = pin.getLatLng(); done({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); };
    d.querySelector('#map-cancel').onclick = () => done(null);
    d.oncancel = e => { e.preventDefault(); done(null); };
  });
}
