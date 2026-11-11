// تحصّله — إشعارات التطبيق (Web Push) لأطراف الطلب. يناديها تريقر orders (notify_order_push).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const money = (n: number) => Number(n).toLocaleString("ar-SA", { maximumFractionDigits: 2 }) + " ر.س";

type Msg = { users: string[]; title: string; body: string; url: string; tag: string; actions?: { action: string; title: string }[] };

// تنبيهات المحل: لو فيه مناوبة مفتوحة تروح لأجهزة المناوبة فقط، وإلا لصاحب المحل وموظفين الطلبات
async function staffOf(mid: string) {
  const { data: shifts } = await admin.from("cashier_shifts").select("device_user_id").eq("merchant_id", mid).is("ended_at", null);
  if (shifts?.length) return shifts.map((x: any) => x.device_user_id);
  const { data } = await admin.from("merchant_staff").select("user_id").eq("merchant_id", mid).eq("status", "active").contains("perms", ["orders"]);
  return [mid, ...(data ?? []).map((x: any) => x.user_id).filter(Boolean)];
}

async function messages(type: string, o: any, old: any): Promise<Msg[]> {
  const out: Msg[] = [];
  const { data: m } = await admin.from("merchants").select("store_name").eq("id", o.merchant_id).single();
  const store = m?.store_name ?? "المحل";
  const tag = "order-" + o.id;
  const shop = "shop.html#orders", dash = "merchant.html?app=1";
  const st = (s: string) => type === "UPDATE" && old?.status !== s && o.status === s;

  if (type === "INSERT") out.push({ users: await staffOf(o.merchant_id), title: "🧾 طلب جديد", body: `${o.number} · ${o.buyer_name} · ${money(o.total)}`, url: dash, tag });
  if (type === "UPDATE") {
    if (o.collect_driver_user_id && o.collect_driver_user_id !== old?.collect_driver_user_id)
      out.push({ users: [o.collect_driver_user_id], title: "🧺 استلام جديد لك", body: `${store} · ${o.number}`, url: dash, tag: tag + "-c" });
    if (o.driver_user_id && o.driver_user_id !== old?.driver_user_id)
      out.push({ users: [o.driver_user_id], title: "🛵 توصيلة جديدة لك", body: `${store} · ${o.number}`, url: dash, tag: tag + "-d" });
    if (o.payment_status === "proof" && old?.payment_status !== "proof")
      out.push({ users: await staffOf(o.merchant_id), title: "📎 وصل إيصال تحويل", body: `${o.number} · ${money(o.total)}`, url: dash, tag });
    if (o.adjust_pending && !old?.adjust_pending)
      out.push({ users: [o.buyer_id], title: "تعدّل عدد طلبك", body: `${store}: المبلغ الجديد ${money(o.total)}، افتح ووافق`, url: shop, tag });
    const buyer: Record<string, string> = {
      accepted: `${store} قبل طلبك`, rejected: `${store} اعتذر عن طلبك${o.reason ? ": " + o.reason : ""}`,
      to_collect: "المندوب بيجيك يستلم أغراضك", at_store: "وصلت أغراضك المحل", processing: "طلبك قيد التنفيذ",
      out: `طلبك مع المندوب في الطريق 🛵${o.handover_code ? " · رمز التسليم: " + o.handover_code + " (أعطه للمندوب)" : ""}`, delivered: "تم تسليم طلبك ✓", picked_up: "تم استلام طلبك ✓",
    };
    for (const [s, body] of Object.entries(buyer)) if (st(s)) out.push({ users: [o.buyer_id], title: `طلبك ${o.number}`, body, url: shop, tag });
    if (st("ready") && o.fulfillment === "pickup") out.push({ users: [o.buyer_id], title: `طلبك ${o.number}`, body: `جاهز للاستلام من ${store}${o.handover_code ? " · رمز الاستلام: " + o.handover_code : ""}`, url: shop, tag });
    if (o.buyer_confirmed_at && o.buyer_confirmed_at !== old?.buyer_confirmed_at && o.driver_user_id)
      out.push({ users: [o.driver_user_id], title: "✅ الزبون أكّد الاستلام", body: `${o.number}: صوّر الطلب وأنهِ التوصيل`, url: dash, tag: tag + "-d" });
    if (o.code_help_at && o.code_help_at !== old?.code_help_at)
      out.push({ users: await staffOf(o.merchant_id), title: "🔐 المندوب يحتاج موافقتك", body: `${o.number}: الزبون ما عنده رمز التسليم. اتصل فيه ووافق من الطلبات`, url: dash, tag: tag + "-code" });
    if (o.code_attempts >= 5 && (old?.code_attempts ?? 0) < 5)
      out.push({ users: await staffOf(o.merchant_id), title: "🔒 انقفل رمز التسليم", body: `${o.number}: 5 محاولات غلط. تأكد من الزبون قبل التسليم`, url: dash, tag: tag + "-code" });
    if (st("cancelled")) out.push({ users: await staffOf(o.merchant_id), title: "ألغى الزبون طلبه", body: o.number, url: dash, tag });
  }
  return out;
}

Deno.serve(async (req) => {
  const { data: ns } = await admin.from("notify_settings").select("webhook_secret").eq("id", true).single();
  if (!ns?.webhook_secret || req.headers.get("x-webhook-secret") !== ns.webhook_secret) return new Response("unauthorized", { status: 401 });
  // أول تشغيل: نولّد مفاتيح VAPID هنا ونحفظها في القاعدة (المفتاح السري ما يطلع برّا الخادم)
  let { data: ps } = await admin.from("push_settings").select("*").eq("id", true).maybeSingle();
  if (!ps) {
    const k = webpush.generateVAPIDKeys();
    const ins = await admin.from("push_settings").insert({ id: true, vapid_public: k.publicKey, vapid_private: k.privateKey }).select().single();
    ps = ins.data ?? (await admin.from("push_settings").select("*").eq("id", true).single()).data;
  }
  webpush.setVapidDetails(ps.subject, ps.vapid_public, ps.vapid_private);
  const p = await req.json().catch(() => null);
  if (p?.type === "init") return Response.json({ ready: !!ps?.vapid_public });
  // عرض جديد من محل «مميز»: للمشترين الموافقين على تنبيه العروض والقريبين من المحل
  let list: Msg[] = [];
  if (p?.type === "offer") {
    const { data: aud } = await admin.rpc("offer_audience", { mid: p.merchant_id, la: p.lat, ln: p.lng });
    const users = (aud ?? []).map((x: any) => x.user_id);
    if (users.length) list = [{ users, title: `🏷️ عرض من ${p.store}`, body: `${p.product}: ${money(p.sale)} بدل ${money(p.price)}`, url: "shop.html", tag: "offer-" + p.merchant_id,
      actions: [{ action: "stop-offers", title: "إيقاف تنبيهات العروض" }] }];
  } else if (!p?.record) return new Response("ignored");
  else list = await messages(p.type, p.record, p.old_record);
  let sent = 0;
  for (const msg of list) {
    const users = [...new Set(msg.users.filter(Boolean))];
    if (!users.length) continue;
    const subs: any[] = [];
    for (let i = 0; i < users.length; i += 150) {   // دفعات عشان طول الرابط
      const { data } = await admin.from("push_subscriptions").select("*").in("user_id", users.slice(i, i + 150));
      subs.push(...(data ?? []));
    }
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, actions: msg.actions }), { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push failed", e?.statusCode, e?.body ?? e);
      }
    }
  }
  return Response.json({ sent });
});
