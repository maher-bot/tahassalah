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
  nid: v => /^[12]\d{9}$/.test(v),
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
export const ACTIVITIES_BY_KIND = {
  store: ACTIVITIES,
  family: ['أطباق وأكل بيتي', 'حلويات ومخبوزات', 'قهوة وعصائر ومشروبات', 'مقبلات ومخللات وتوابل', 'عطور وبخور', 'خياطة وتطريز', 'أشغال يدوية وإكسسوارات', 'أخرى'],
  mobile: ['فود ترك', 'آيسكريم', 'قهوة متنقلة', 'خضار وفواكه', 'ذرة وبليلة وأكلات شعبية', 'بائع متجول', 'أخرى'],
};
export const PLANS = { free: 'الفترة المجانية', basic: 'أساسي (مجاني)', family: 'أسر ومتجولين', trader: 'تاجر', pro: 'مميز' };
export const PLAN_PRICE = { basic: { monthly: 0, yearly: 0 }, family: { monthly: 29, yearly: 290 }, trader: { monthly: 59, yearly: 590 }, pro: { monthly: 119, yearly: 1190 } };
// نوع الحساب
export const KINDS = { store: 'محل', family: 'أسرة منتجة', mobile: 'بائع متجول أو عربة' };
export const KIND_ICON = { store: '🏪', family: '🏠', mobile: '🚚' };
export const planLabel = (p, b = 'monthly') => p === 'basic' ? 'أساسي (مجاني)' : p === 'free' ? 'الفترة المجانية'
  : `${PLANS[p] || p} · ${PLAN_PRICE[p]?.[b] ?? ''} ر.س ${b === 'yearly' ? 'سنويًا' : 'شهريًا'}`;
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
  if (/merchant_staff_merchant_id_email_key|duplicate key.*merchant_staff/i.test(m)) return 'هذا الإيميل مضاف للفريق من قبل.';
  if (/cannot_invite_self/.test(m)) return 'ما تقدر تضيف إيميلك نفسه كموظف.';
  if (/staff_limit/.test(m)) return 'وصلت الحد الأقصى: 10 موظفين.';
  if (/invite_not_found/.test(m)) return 'الدعوة ما عادت موجودة. اطلب من صاحب المتجر يرسلها من جديد.';
  if (/change_not_found/.test(m)) return 'هذا الطلب تمت مراجعته من قبل.';
  if (/not_staff|no_permission|not_allowed|row-level security/i.test(m)) return 'ما عندك صلاحية لهذا الإجراء.';
  if (/product_not_found/.test(m)) return 'المنتج ما عاد موجود.';
  if (/plan_basic_products/.test(m)) return 'الباقة الأساسية تسمح بـ 30 منتج ظاهر. رقّ باقتك لـ«تاجر» عشان تضيف أكثر.';
  if (/plan_basic_offers/.test(m)) return 'العروض متاحة في باقة «تاجر» و«مميز».';
  if (/plan_basic_delivery/.test(m)) return 'التوصيل متاح في باقة «تاجر» و«مميز». الأساسية فيها الاستلام من المحل فقط.';
  if (/plan_basic_staff/.test(m)) return 'إضافة الموظفين متاحة في باقة «تاجر» و«مميز».';
  if (/plan_basic_preorder/.test(m)) return 'الطلب المسبق متاح في باقة «أسر ومتجولين» و«تاجر» و«مميز».';
  if (/plan_family_products/.test(m)) return 'باقة «أسر ومتجولين» تسمح بـ 60 منتج ظاهر. رقّ باقتك لـ«تاجر» عشان تضيف أكثر.';
  if (/plan_basic_live/.test(m)) return 'الموقع المباشر متاح في باقة «أسر ومتجولين» وما فوق.';
  if (/live_mobile_only/.test(m)) return 'الموقع المباشر للباعة المتجولين والعربات فقط.';
  if (/plan_family_kind/.test(m)) return 'باقة «أسر ومتجولين» خاصة بالأسر المنتجة والباعة المتجولين.';
  if (/bad_location/.test(m)) return 'الموقع غير صحيح. حاول مرة ثانية.';
  if (/merchants_id_number_check/.test(m)) return 'رقم الهوية 10 أرقام يبدأ بـ 1 أو 2.';
  if (/merchants_docs_by_kind/.test(m)) return 'المستندات ناقصة: المحل يحتاج السجل التجاري، والأسرة والمتجول يحتاجون الهوية.';
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
  const end = new Date(m.trial_started_at); end.setMonth(end.getMonth() + (m.trial_months || 3));
  const days = Math.ceil((end - Date.now()) / 864e5);
  return { state: days > 0 ? 'active' : 'ended', end, days: Math.max(0, days) };
}
export const OFFER_REASONS = { expiry: 'قرب انتهاء الصلاحية', low_stock: 'كمية قليلة متبقية', clearance: 'تصفية', season: 'عرض موسمي', new: 'منتج جديد' };
export const fmtDay = d => new Date(d).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- الفريق الميداني ----------
export const FIELD_STATUS = {
  registered: 'سجّل', interested: 'مهتم', follow_up: 'زيارة ثانية',
  problem: 'عنده مشكلة', not_interested: 'غير مهتم', closed: 'مغلق',
};
export const FIELD_BADGE = { registered: 'approved', interested: 'pending', follow_up: 'pending', problem: 'rejected', not_interested: 'suspended', closed: 'suspended' };
export const FIELD_PROBLEMS = [
  'ما عنده سجل تجاري', 'الآيبان مو باسم المنشأة', 'ما عنده إيميل', 'صعوبة في رفع المستندات',
  'ما يعرف يستخدم الجوال', 'يبغى يستشير المالك أو الشريك', 'المالك مو موجود', 'خايف من الرسوم', 'أخرى',
];
export const MAKKAH_DISTRICTS = [
  'المنطقة المركزية', 'وسط مكة', 'الشرايع', 'النورية', 'الكعكية', 'الشوقية', 'العزيزية', 'العوالي', 'الزاهر',
  'العتيبية', 'المنصور', 'جرول', 'الرصيفة', 'بطحاء قريش', 'النسيم', 'الزايدي', 'الهجرة', 'الحمراء', 'العمرة',
  'المسفلة', 'الخالدية', 'الكعكية', 'ولي العهد', 'الشرائع الجديدة', 'العدل', 'الفيصلية', 'التنعيم', 'الملاوي',
].filter((d, i, a) => a.indexOf(d) === i);
export const ago = d => {
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  if (m < 1) return 'الحين'; if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60); if (h < 24) return `قبل ${h} ساعة`;
  const dd = Math.round(h / 24); return dd === 1 ? 'أمس' : `قبل ${dd} يوم`;
};

// إظهار/إخفاء كلمة المرور: زر 👁 بجانب كل خانة كلمة مرور
export function enhancePasswords(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-pw])').forEach((inp) => {
    inp.dataset.pw = '1';
    inp.setAttribute('dir', 'ltr');
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('spellcheck', 'false');
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pw-eye';
    b.setAttribute('aria-label', 'إظهار كلمة المرور');
    b.textContent = '👁';
    b.addEventListener('click', () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? '🙈' : '👁';
      b.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      inp.focus();
    });
    wrap.appendChild(b);
  });
}

// قبل الإرسال: نرجّع الخانات لوضع الإخفاء عشان المتصفح يعرضها كحفظ كلمة مرور
export function hidePasswords(form) {
  form.querySelectorAll('input[data-pw]').forEach((inp) => {
    inp.type = 'password';
    const b = inp.parentNode.querySelector('.pw-eye');
    if (b) b.textContent = '👁';
  });
}

// بعد الدخول الناجح: نطلب من المتصفح حفظ الإيميل وكلمة المرور على الجهاز
export async function rememberLogin(email, password) {
  try {
    if (window.PasswordCredential && navigator.credentials) {
      await navigator.credentials.store(new window.PasswordCredential({ id: email, password, name: email }));
    }
  } catch { /* بعض المتصفحات ما تدعمها، وتحفظ تلقائيًا من النموذج */ }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => enhancePasswords());
  else enhancePasswords();
}
