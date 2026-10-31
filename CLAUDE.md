# تحصّله (tahassalah.com)

موقع ثابت (HTML/JS) على GitHub Pages + Supabase. صاحب المشروع يتكلم عربي (لهجة خليجية) — رد عليه بالعربي وبشكل مبسط.

## الهوية — `brand/`

الشعار المعتمد (فكرة "حولك": رادار ودبوس برتقالي). الكلمة بخط El Messiri 700، والإنجليزي بخط Alexandria 700.
- `logo-horizontal.*` و`logo-stacked.*` (و`-white` للخلفيات الغامقة)، `icon.svg` / `icon-*.png`
- `icon-small.svg`: نسخة مبسطة للمقاسات الصغيرة (منها `favicon.ico`)
- `apple-touch-icon.png`، `social-avatar.png`، و`preview.png` (معاينة كل النسخ)
- في الموقع: الأيقونة مضمّنة كـ SVG داخل `.mark` في كل صفحة HTML (تستخدم متغيرات الألوان عشان الوضع الغامق)، والفافيكون من `brand/`.

## الفيديو — `video/`

مشروع Remotion. الـ SessionStart hook يثبّت حزمه وأداة الصوت تلقائيًا.

| الفيديو | الـ Composition | المدة |
|---|---|---|
| الإعلان الكامل | `Promo-9x16` / `Promo-16x9` | 30ث |
| إعلان قصير | `Ad15-9x16` / `Ad15-16x9` | 15ث |
| الأسر المنتجة في الشرائع | `Families-9x16` / `Families-16x9` | 24ث |
| إعلانات ثابتة (صورة) للشرائع | `Teaser-<families|vendors|shops>-story` (صورة) و`TeaserVideo-<…>` (فيديو) | صورة 9:16؛ فيديو 6ث (الأسر 19.5ث بالتعليق) |
| تعريف بتاجر | `Merchant-<id>-9x16` / `-16x9` | حسب عدد الصور |

- **نصوص الإعلان** في `video/src/content.ts`، والمشاهد في `video/src/scenes/`، وترتيبها ومددها (للكامل والقصير) في `video/src/Promo.tsx`.
- **إعلانات موجّهة** (مثل `families`): نصوصها في `content.ts` تحت مفتاحها، ومشاهدها في `variants` داخل `Promo.tsx` (المشاهد تقبل نصوصها كـ props).
- **الإعلانات الثابتة**: نصوصها في `content.teasers`، والقالب `video/src/templates/Teaser.tsx`. النسخ الجاهزة في `media/teasers/`. الفيديو = نفس الصورة مع شارة "📍 الشرائع" تنبض مثل التنبيه؛ فيديو الأسر عليه التعليق الصوتي `families-vo`، والباقي بدون صوت (`--enforce-audio-track` يضيف مسار صامت). مخصصة لسناب وتيك توك: آخر 20% من الشاشة فاضي لزر المنصة، ولا نكتب "اسحب لفوق" (المنصة تضيف زرها).
- **العروض** في الإعلانات: "حتى 6 أشهر مجانًا" بس، بدون تفاصيل ثانية (قرار صاحب المشروع، لكل الفئات). كلمة "حتى" ضرورية: النظام يعطي 3 أشهر، و6 لأول 500 يتفعّلون في المنصة (`merchants_founder` في Supabase)، والموقع يشرح هذا التفصيل. عدد منتجات باقة الأسر متعارض في الموقع (60 في index.html و100 في merchant.html)، فلا تذكره.
- **صفحة التسجيل** (`merchant.html`): فيديو يشتغل تلقائيًا بدون صوت أعلى نموذج التسجيل. الافتراضي `media/promo-9x16.mp4`، ومع `utm_content=families` (أو `?for=families`) يطلع فيديو الأسر.
- **التجّار** في `video/src/merchants.ts` (المدخل `example` تجريبي، أسماؤه وهمية). صورهم في `video/public/merchants/<id>/`. القالب في `video/src/templates/Merchant.tsx`.
- **الألوان والخطوط** في `video/src/theme.ts`. الألوان `#105E51` و`#FF7B47`. أيقونة الشعار `LogoIcon` (`video/src/ui.tsx`) تقرأ `video/public/brand/icon.svg` (نسخة من `brand/icon.svg`). الخطوط محفوظة في `video/public/fonts`.
- **الموسيقى** `video/public/music.m4a`.

```bash
cd video
npm run list           # كل الفيديوهات المتاحة
npm run still          # صورة سريعة للمعاينة
npm run render         # الإعلان الكامل بالمقاسين → out/
npm run render:ad15    # الإعلان القصير بالمقاسين
npx remotion render Merchant-example-9x16 out/merchant-example-9x16.mp4
npm run thumbs         # صورة غلاف JPG لكل فيديو → out/
```

### تعليق صوتي + كابشن
```bash
npm run voice -- intro "تدوّر شي قريب منك؟ تحصّله!"   # → public/voice/intro.mp3 + intro.json
npm run voice -- --voices                               # الأصوات العربية
```
بعدها مرّر `voice` للفيديو: `npx remotion render Ad15-9x16 out/x.mp4 --props='{"variant":"ad15","voice":"intro"}'`
(أو `"voice": "intro"` في بيانات التاجر). الكابشن يطلع تلقائيًا من توقيت الكلمات، والموسيقى تخف تحت الصوت (ومع `voiceSeconds` ترجع بعد نهاية التعليق).

تعليق مسجّل من صاحب المشروع: `public/voice/families-vo.mp3` (18.2ث) على `TeaserVideo-families` (الإعلان الثابت أبو صورة المطبخ) — مو على `Families-*`. ما له ملف توقيت (`.json`) لأن خدمات التفريغ الصوتي محجوبة في البيئة، فيطلع بدون كابشن لين يوصلنا نص التعليق.
أداة الصوت تحتاج إن البيئة تسمح بالدومين `speech.platform.bing.com`. لو مو مسموح، الطلب يفشل بخطأ اتصال.

للنشر على الموقع: انسخ الملف من `video/out/` إلى `media/` (الموقع يقرأ `media/promo-*.mp4` و`media/promo-*.jpg`).

## أدوات الذكاء الاصطناعي الإضافية

ما تنحفظ في المستودع (حجمها كبير). تنزل عند الحاجة في `~/video-tools`:

```bash
video/tools/install.sh list          # القائمة والحالة
video/tools/install.sh whisperx      # تثبيت أداة وحدة أو أكثر
```

الأدوات: comfyui, moneyprinter, hyperframes, postiz, whisperx, pyvideotrans, opencreator, narratoai, openshorts.
الجهاز السحابي ما فيه GPU، فـ ComfyUI بطيء جدًا هنا. بعضها يحتاج مفاتيح API (اطلبها من المستخدم وقت الحاجة، ولا تحفظها في المستودع).
