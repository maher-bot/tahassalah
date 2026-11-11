// تحصّله — التعرّف على المنتج من صورة (يتفعّل بعد إضافة ANTHROPIC_API_KEY في أسرار الدوال)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const KEY = env("ANTHROPIC_API_KEY");
const MODEL = env("ANTHROPIC_MODEL") || "claude-haiku-4-5";
const DAILY_LIMIT = Number(env("AI_DAILY_LIMIT") || 60);
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `أنت مساعد يتعرّف على المنتجات التجارية من الصور لمتجر في السعودية.
انظر للصورة وأرجع JSON فقط بدون أي نص آخر، بهذا الشكل:
{"recognized":true,"name":"اسم المنتج بالعربي مع الماركة والحجم إن ظهر","brand":"","category":"تصنيف قصير بالعربي","description":"وصف تسويقي قصير بالعربي (سطرين كحد أقصى)","barcode":"الأرقام إن ظهر باركود واضح وإلا فارغ","estimatedPriceSar":0,"confidence":0.0}
إذا الصورة ما فيها منتج واضح أرجع {"recognized":false}. لا تخترع باركود.`;

// المشتري يصوّر منتج عشان يبحث عنه: نحتاج اسمه وكلمة بحث قصيرة
const PROMPT_BUYER = `أنت مساعد يتعرّف على المنتجات من الصور لتطبيق تسوّق في السعودية. المشتري صوّر منتج ويبي يبحث عنه في المحلات القريبة.
أرجع JSON فقط بدون أي نص آخر، بهذا الشكل:
{"recognized":true,"name":"اسم المنتج بالعربي مع الماركة والحجم إن ظهر","search":"نوع المنتج بكلمة أو كلمتين بالعربي للبحث (مثل: حليب، رز بسمتي، شاحن جوال)","brand":"","barcode":"الأرقام إن ظهر باركود واضح وإلا فارغ"}
إذا الصورة ما فيها منتج واضح أرجع {"recognized":false}. لا تخترع باركود.`;
const BUYER_DAILY_LIMIT = Number(env("AI_BUYER_DAILY_LIMIT") || 30);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // نقرأ الطلب كامل أول (الرد قبل ما تخلص قراءة الصورة كان يعلّق الاتصال)
  const body = await req.json().catch(() => null);
  if (!KEY) return json({ error: "not_configured" });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  const buyerMode = body?.mode === "buyer";
  const mid = String(body?.merchant_id ?? "");
  const image = String(body?.image ?? "");
  const media = /^image\/(jpeg|png|webp)$/.test(body?.media_type) ? body.media_type : "image/jpeg";
  if ((!buyerMode && !mid) || !image || image.length > 1_500_000) return json({ error: "bad_request" }, 400);

  if (buyerMode) {
    // مشتري مسجّل (له ملف في buyers)
    const { data: b } = await admin.from("buyers").select("id").eq("id", uid).maybeSingle();
    if (!b) return json({ error: "not_allowed" }, 403);
  } else {
    const { data: ok } = await admin.rpc("can_use_ai", { mid, uid });
    if (!ok) return json({ error: "not_allowed" }, 403);
  }
  const LIMIT = buyerMode ? BUYER_DAILY_LIMIT : DAILY_LIMIT;

  const day = new Date().toISOString().slice(0, 10);
  const { data: row } = await admin.from("ai_usage").select("count").eq("user_id", uid).eq("day", day).maybeSingle();
  const used = row?.count ?? 0;
  if (used >= LIMIT) return json({ error: "limit" }, 429);
  await admin.from("ai_usage").upsert({ user_id: uid, day, count: used + 1 });

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media, data: image } },
          { type: "text", text: buyerMode ? PROMPT_BUYER : PROMPT },
        ] }],
      }),
    });
  } catch (e) { console.error("anthropic fetch", String(e)); return json({ error: "ai_timeout" }, 504); }
  if (!r.ok) { console.error("anthropic", r.status, await r.text()); return json({ error: "ai_failed", status: r.status }, 502); }
  const out = await r.json();
  const text = (out?.content ?? []).map((c: any) => c.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const res = JSON.parse(m ? m[0] : text);
    return json({ result: res, remaining: LIMIT - used - 1 });
  } catch {
    return json({ result: { recognized: false } });
  }
});
