// إعدادات الاتصال بـ Supabase (المفتاح العام anon عام بطبيعته؛ الحماية بسياسات RLS).
// النسخة التجريبية للتدريب: افتح أي صفحة مع ?demo=1 لتتصل بقاعدة بيانات تجريبية منفصلة (بيانات وهمية)،
// وتبقى كذلك في نفس التبويب إلى أن تفتح ?demo=0. بقية الزوار يتصلون بالقاعدة الحقيقية دائمًا.
const DEMO = (() => {
  try {
    const q = new URLSearchParams(location.search).get('demo');
    if (q === '1') sessionStorage.setItem('tah-demo', '1');
    if (q === '0') sessionStorage.removeItem('tah-demo');
    return sessionStorage.getItem('tah-demo') === '1';
  } catch { return false; }
})();
export const IS_DEMO = DEMO;
export const SUPABASE_URL = DEMO ? 'https://jxuxylqvxjqmotawreaw.supabase.co' : 'https://loyiwdjgtvyihnzrqskn.supabase.co';
export const SUPABASE_ANON_KEY = DEMO ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4dXh5bHF2eGpxbW90YXdyZWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTU3NTQsImV4cCI6MjEwODI5MTc1NH0.abHtHv-x-eGnMAYCE21Zpx7w-AMZ8SPFWQsi7NuTNr0' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxveWl3ZGpndHZ5aWhuenJxc2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDkzNzgsImV4cCI6MjEwNzU4NTM3OH0.MJIqnej2Yhxf_rrYzmbhPHSGz7RKiM_RO2zwW6aigDw';
export const WHATSAPP = '966555606635';
