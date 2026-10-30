# تحصّله (tahassalah.com)

موقع ثابت (HTML/JS) على GitHub Pages + Supabase. صاحب المشروع يتكلم عربي (لهجة خليجية) — رد عليه بالعربي وبشكل مبسط.

## الفيديو — `video/`

مشروع Remotion للفيديو الإعلاني (30 ثانية، نسختين: 9x16 و16x9).
الـ SessionStart hook يثبّت حزمه تلقائيًا، فهو جاهز من أول الجلسة.

- **النصوص كلها** في `video/src/content.ts` — أي تعديل على الكلام يصير هناك.
- **المشاهد** في `video/src/scenes/` وترتيبها ومدتها في `video/src/Promo.tsx`.
- **الألوان والخطوط** في `video/src/theme.ts` (نفس خطوط الموقع، محفوظة في `video/public/fonts` عشان الريندر ما يحتاج إنترنت).
- **الموسيقى** `video/public/music.m4a`.

```bash
cd video
npm run still          # صورة سريعة للمعاينة → out/still.png
npm run render:9x16    # → out/promo-9x16.mp4
npm run render:16x9    # → out/promo-16x9.mp4
```

لنشر نسخة جديدة على الموقع: انسخ الملف من `video/out/` إلى `media/` بنفس الاسم (الموقع يقرأ `media/promo-*.mp4` و`media/promo-*.jpg` كصورة غلاف).

## أدوات الذكاء الاصطناعي الإضافية

ما تنحفظ في المستودع (حجمها كبير). تنزل عند الحاجة في `~/video-tools`:

```bash
video/tools/install.sh list          # القائمة والحالة
video/tools/install.sh whisperx      # تثبيت أداة وحدة أو أكثر
```

الأدوات: comfyui, moneyprinter, hyperframes, postiz, whisperx, pyvideotrans, opencreator, narratoai, openshorts.
الجهاز السحابي ما فيه GPU، فـ ComfyUI بطيء جدًا هنا. بعضها يحتاج مفاتيح API (اطلبها من المستخدم وقت الحاجة، ولا تحفظها في المستودع).
