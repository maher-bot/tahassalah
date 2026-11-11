// تحصّله — ربط المخزون مع نظام الكاشير (POS).
// نظام الكاشير يرسل الكميات تلقائيًا (كل ما تتغير أو كل فترة قصيرة):
//   POST /functions/v1/stock-sync   الهيدر: x-api-key: tah_...  (أو Authorization: Bearer tah_...)
//   {"items":[{"barcode":"6281234567890","quantity":12,"price":9.5}]}   (price اختياري)
// الكمية في المنصة = كمية نظام الكاشير ناقص المحجوز في طلبات المنصة اللي لسا ما خلصت.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-api-key, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const key = (req.headers.get("x-api-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")).trim();
  if (!/^tah_[0-9a-f]{48}$/.test(key)) return json({ error: "invalid api key" }, 401);
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body) ? body : body?.items;
  if (!Array.isArray(items)) return json({ error: "body must be {items:[{barcode, quantity, price?}]}" }, 400);
  if (items.length > 5000) return json({ error: "max 5000 items per request" }, 413);
  const { data, error } = await admin.rpc("pos_stock_sync", { h: await sha256(key), items });
  if (error) {
    const m = String(error.message);
    if (m.includes("bad_key")) return json({ error: "invalid api key" }, 401);
    if (m.includes("plan_pro_required")) return json({ error: "stock sync needs the store's premium plan" }, 402);
    console.error("stock-sync", m);
    return json({ error: "sync failed" }, 500);
  }
  return json({ ok: true, ...data });
});
