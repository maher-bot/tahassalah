import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// يحوّل الأرقام العربية/الفارسية إلى إنجليزية ويزيل المسافات
export const digits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
export const clean = s => digits(s).replace(/[\s-]/g, '').toUpperCase();

export const valid = {
  phone: v => /^05\d{8}$/.test(v),
  cr: v => /^\d{10}$/.test(v),
  nationalAddress: v => /^[A-Z]{4}\d{4}$/.test(v),
  vat: v => /^3\d{13}3$/.test(v),
  iban(v) {
    if (!/^SA\d{2}[0-9A-Z]{20}$/.test(v)) return false;
    const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
    let m = 0; for (const ch of r) m = (m * 10 + +ch) % 97;
    return m === 1;
  },
};

export const money = n => n == null || n === '' ? '' : Number(n).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ر.س';

export const ACTIVITIES = ['بقالة وتموينات', 'إلكترونيات وجوالات', 'صيدلية', 'ملابس وإكسسوارات', 'عطور وتجميل',
  'مطعم أو منتجات أسر', 'أدوات منزلية', 'قطع غيار وسيارات', 'خياط أو مغسلة', 'خدمات بالمواعيد', 'أخرى'];
export const PLANS = { free: 'مجانية 3 أشهر', commission: 'عمولة 5% على الطلب المكتمل', monthly: 'اشتراك شهري 100 ر.س', yearly: 'اشتراك سنوي 1,000 ر.س' };
export const STATUS = { pending: 'قيد المراجعة', approved: 'مفعّل', rejected: 'يحتاج تعديل', suspended: 'موقوف' };

export function fileExt(f) {
  const e = (f.name.split('.').pop() || '').toLowerCase();
  return ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(e) ? e : (f.type === 'application/pdf' ? 'pdf' : 'jpg');
}

// يصغّر الصورة قبل الرفع (لصور المنتجات)
export async function shrinkImage(file, max = 1000) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
    return blob && blob.size < file.size ? new File([blob], 'img.webp', { type: 'image/webp' }) : file;
  } catch { return file; }
}

export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'الإيميل أو كلمة المرور غير صحيحة.';
  if (/Email not confirmed/i.test(m)) return 'أكّد إيميلك أولًا من الرسالة اللي وصلتك، ثم سجّل دخول.';
  if (/already registered|already been registered/i.test(m)) return 'هذا الإيميل مسجل من قبل. سجّل دخول بدلًا من ذلك.';
  if (/Password should be/i.test(m)) return 'كلمة المرور لازم تكون 8 أحرف على الأقل.';
  if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة. انتظر دقيقة وحاول مرة ثانية.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'حجم الملف أكبر من المسموح.';
  if (/mime type/i.test(m)) return 'نوع الملف غير مقبول. ارفع PDF أو صورة.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذر الاتصال. تأكد من الإنترنت وحاول مرة ثانية.';
  return 'صار خطأ: ' + m;
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = text || 'لحظة…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// حالة الفترة المجانية: waiting (لم يبدأ الإطلاق) · active · ended
export function trialInfo(m) {
  if (m.plan !== 'free') return null;
  if (!m.trial_started_at) return { state: 'waiting' };
  const end = new Date(m.trial_started_at); end.setMonth(end.getMonth() + 3);
  const days = Math.ceil((end - Date.now()) / 864e5);
  return { state: days > 0 ? 'active' : 'ended', end, days: Math.max(0, days) };
}
export const fmtDay = d => new Date(d).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
