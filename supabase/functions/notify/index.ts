// تحصّله — إشعارات البريد لتسجيل التجار ودعوات الموظفين
// يستدعيه Database Webhook على جدول merchants (INSERT و UPDATE).
// - طلب جديد أو إعادة إرسال بعد الرفض → إيميل لك فيه البيانات وروابط المستندات (صالحة 7 أيام) + إيميل استلام للتاجر
// - تغيّر الحالة إلى مفعّل / مرفوض / موقوف → إيميل للتاجر
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const RESEND_API_KEY = env("RESEND_API_KEY");

const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

// الإعدادات محفوظة في جدول notify_settings داخل القاعدة (تتغير بدون إعادة نشر)
type Settings = { webhook_secret: string; admin_email: string; from_email: string; site_url: string };
async function settings(): Promise<Settings> {
  const { data, error } = await admin.from("notify_settings").select("webhook_secret, admin_email, from_email, site_url").eq("id", true).single();
  if (error || !data) throw new Error("notify_settings missing: " + error?.message);
  return { ...data, site_url: String(data.site_url).replace(/\/$/, "") } as Settings;
}

const PLAN: Record<string, string> = {
  free: "الفترة المجانية",
  basic: "أساسي (مجاني)",
  family: "أسر ومتجولين 29 ر.س شهريًا",
  trader: "تاجر 59 ر.س شهريًا",
  pro: "مميز 119 ر.س شهريًا",
};
const planText = (p: string, b: string) =>
  p === "family" && b === "yearly" ? "أسر ومتجولين 290 ر.س سنويًا" : p === "trader" && b === "yearly" ? "تاجر 590 ر.س سنويًا" : p === "pro" && b === "yearly" ? "مميز 1,190 ر.س سنويًا" : (PLAN[p] ?? p);

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function layout(title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F3F6F5;font-family:Tahoma,Arial,sans-serif;color:#10231F">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:bold;color:#0D5C4E;margin-bottom:16px">تحصّله</div>
    <div style="background:#fff;border:1px solid #D6E0DD;border-radius:14px;padding:22px;line-height:1.8">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${body}
    </div>
    <p style="color:#4E625D;font-size:12px;margin-top:16px">تحصّله · مصنع رواحل العرب للصناعة · مكة المكرمة</p>
  </div></body></html>`;
}

const btn = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0D5C4E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;margin:6px 0 6px 6px">${esc(label)}</a>`;

async function send(to: string, subject: string, html: string) {
  if (!to) return;
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set; skipped:", subject); return; }
  const { from_email } = await settings();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from_email, to: [to], subject, html }),
  });
  if (!r.ok) console.error("resend failed", r.status, await r.text());
}

async function signed(path: string | null) {
  if (!path) return null;
  const { data, error } = await admin.storage.from("merchant-docs").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) console.error("sign failed", path, error.message);
  return data?.signedUrl ?? null;
}

async function notifyAdmin(m: any, resubmitted: boolean) {
  const { admin_email: ADMIN_EMAIL, site_url: SITE_URL } = await settings();
  const [cr, vat, iban] = await Promise.all([signed(m.cr_path), signed(m.vat_path), signed(m.iban_path)]);
  const row = (k: string, v: unknown) =>
    `<tr><td style="color:#4E625D;padding:4px 0 4px 14px;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v || "—")}</b></td></tr>`;
  const body = `
    <p>${resubmitted ? "تاجر عدّل طلبه بعد الرفض وأعاد إرساله." : "وصل طلب تسجيل متجر جديد ينتظر مراجعتك."}</p>
    <table style="border-collapse:collapse;font-size:14px;margin:10px 0">
      ${row("المحل", m.store_name)}${row("المالك", m.owner_name)}${row("النشاط", m.activity)}
      ${row("المدينة", [m.city, m.district].filter(Boolean).join(" — "))}${row("العنوان الوطني", m.national_address)}${row("الجوال", m.phone)}${row("الإيميل", m.email)}
      ${m.kind && m.kind !== "store"
        ? `${row("النوع", m.kind === "family" ? "أسرة منتجة" : "بائع متجول أو عربة")}${row("وثيقة العمل الحر / رخصة", m.license_number)}${row("المستندات الإضافية", (m.extra_docs || []).length)}`
        : `${row("السجل التجاري", m.cr_number)}${row("الرقم الضريبي", m.vat_registered ? m.vat_number : "غير مسجل في الضريبة")}`}
      ${row("البنك", m.bank_name)}${row("الآيبان", m.iban)}${row("الباقة", m.plan === "free" ? `مجانية ${m.trial_months ?? 3} أشهر، بعدها ${planText(m.next_plan, m.billing)}` : planText(m.plan, m.billing))}
    </table>
    <p style="margin:14px 0 4px"><b>المستندات</b> (الروابط صالحة 7 أيام):</p>
    ${cr ? btn(cr, "السجل التجاري") : ""}${vat ? btn(vat, "الشهادة الضريبية") : ""}${iban ? btn(iban, "شهادة الآيبان") : ""}
    ${m.kind && m.kind !== "store" ? `<p style="color:#4E625D">صورة الهوية ورقمها في لوحة المراجعة فقط (ما نرسلها بالإيميل). سجّل المعاينة الميدانية قبل التفعيل.</p>` : ""}
    <p style="margin-top:16px">${btn(`${SITE_URL}/admin.html#${m.id}`, "افتح لوحة المراجعة للتفعيل أو الرفض")}</p>`;
  await send(ADMIN_EMAIL, `${resubmitted ? "إعادة إرسال" : "طلب تاجر جديد"}: ${m.store_name} — ${m.city}`, layout("طلب تسجيل متجر", body));
}

async function notifyMerchant(m: any, kind: "received" | "approved" | "rejected" | "suspended") {
  const { site_url: SITE_URL } = await settings();
  const link = `${SITE_URL}/merchant.html`;
  const map = {
    received: {
      s: "استلمنا طلب تسجيل متجرك",
      b: `<p>أهلًا ${esc(m.owner_name)}،</p><p>وصلنا طلب تسجيل <b>${esc(m.store_name)}</b> مع المستندات. نراجعها ونرد عليك بالإيميل خلال يوم إلى يومي عمل.</p>${btn(link, "متابعة حالة الطلب")}`,
    },
    approved: {
      s: "تم تفعيل متجرك في تحصّله 🎉",
      b: `<p>أهلًا ${esc(m.owner_name)}،</p><p>راجعنا مستندات <b>${esc(m.store_name)}</b> وتم تفعيل حسابك. تقدر الآن تضيف منتجاتك وأسعارك وكمياتك من لوحة التاجر.</p>${btn(link, "ادخل لوحة التاجر")}`,
    },
    rejected: {
      s: "طلب تسجيل متجرك يحتاج تعديل",
      b: `<p>أهلًا ${esc(m.owner_name)}،</p><p>راجعنا طلب <b>${esc(m.store_name)}</b> ويحتاج تعديل قبل التفعيل:</p>
          <p style="background:#FFF4EE;border-radius:10px;padding:10px 14px">${esc(m.review_note || "تواصل معنا لمعرفة التفاصيل.")}</p>
          <p>عدّل البيانات أو ارفع المستند الصحيح وأعد الإرسال.</p>${btn(link, "عدّل طلبك")}`,
    },
    suspended: {
      s: "تم إيقاف متجرك مؤقتًا",
      b: `<p>أهلًا ${esc(m.owner_name)}،</p><p>تم إيقاف ظهور <b>${esc(m.store_name)}</b> مؤقتًا.</p>${m.review_note ? `<p>${esc(m.review_note)}</p>` : ""}<p>للاستفسار راسلنا على واتساب ‎+966 55 560 6635.</p>`,
    },
  }[kind];
  await send(m.email, map.s, layout(map.s, map.b));
}


const ROLE: Record<string, string> = {
  manager: "مدير فرع", stock: "أمين مخزون", pricing: "موظف أسعار", cashier: "كاشير", accountant: "محاسب",
};

async function notifyInvite(st: any, storeName: string) {
  const { site_url: SITE_URL } = await settings();
  const link = `${SITE_URL}/merchant.html#invite`;
  const s = `دعوة للانضمام لفريق ${storeName || "متجر"} في تحصّله`;
  const b = `<p>أهلًا${st.name ? " " + esc(st.name) : ""}،</p>
    <p>دعاك <b>${esc(storeName)}</b> للانضمام لفريق المتجر في تحصّله بدور <b>${esc(ROLE[st.role] ?? st.role)}</b>.</p>
    <p>سجّل دخولك أو أنشئ حسابًا <b>بنفس هذا الإيميل</b>، وبعدها اقبل الدعوة من الصفحة.</p>
    ${btn(link, "قبول الدعوة")}
    <p style="color:#4E625D;font-size:13px">إذا ما تعرف هذا المتجر، تجاهل الرسالة.</p>`;
  await send(st.email, s, layout(s, b));
}

const ACTION: Record<string, string> = { insert: "إضافة منتج", update: "تعديل منتج", delete: "حذف منتج" };

async function notifyChange(p: any) {
  const { site_url: SITE_URL } = await settings();
  const c = p.record;
  const s = `${c.staff_label || "موظفك"} ينتظر موافقتك في ${p.store_name}`;
  const b = `<p>أهلًا ${esc(p.owner_name)}،</p>
    <p><b>${esc(c.staff_label || "موظفك")}</b> أرسل طلب <b>${esc(ACTION[c.action] ?? c.action)}</b>${p.product_name ? `: «${esc(p.product_name)}»` : ""}.</p>
    <p>التعديلات ما تظهر في متجرك إلا بعد موافقتك. إذا أرسل أكثر من طلب، تلقاها كلها في نفس الصفحة.</p>
    ${btn(`${SITE_URL}/merchant.html`, "راجع الطلبات ووافق")}`;
  await send(p.owner_email, s, layout(s, b));
}

Deno.serve(async (req) => {
  let cfg: Settings;
  try { cfg = await settings(); } catch (e) { console.error(e); return new Response("not configured", { status: 500 }); }
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!cfg.webhook_secret || got !== cfg.webhook_secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const p = await req.json().catch(() => null);
  if (p?.table === "merchant_staff" && p.type === "INSERT") {
    try { await notifyInvite(p.record, p.store_name); } catch (e) { console.error(e); return new Response("error", { status: 500 }); }
    return new Response("ok");
  }
  if (p?.table === "product_changes" && p.type === "INSERT") {
    try { await notifyChange(p); } catch (e) { console.error(e); return new Response("error", { status: 500 }); }
    return new Response("ok");
  }
  if (!p || p.table !== "merchants") return new Response("ignored");
  const m = p.record, o = p.old_record;

  // محل سجّله وفعّله مسوّق: الدالة rep-activate ترسل للإدارة ولصاحب المحل بنفسها (إيميل واحد فيه رابط كلمة المرور)
  if (m.activated_by_rep && (p.type === "INSERT" || (o && o.status === "pending" && m.status === "approved"))) return new Response("ok");

  try {
    if (p.type === "INSERT") {
      await Promise.all([notifyAdmin(m, false), notifyMerchant(m, "received")]);
    } else if (p.type === "UPDATE" && o && o.status !== m.status) {
      if (o.status === "rejected" && m.status === "pending") {
        await Promise.all([notifyAdmin(m, true), notifyMerchant(m, "received")]);
      } else if (m.status === "approved" || m.status === "rejected" || m.status === "suspended") {
        await notifyMerchant(m, m.status);
      }
    }
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
});
