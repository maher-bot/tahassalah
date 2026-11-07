// تحصّله — تفعيل فوري عن طريق المسوّق.
// المسوّق المصرّح له (reps.can_activate) يرسل بيانات المحل ومسارات المستندات اللي رفعها في مجلده المؤقت (rep-<حسابه>/).
// الدالة: تنشئ حساب صاحب المحل بإيميله، تنقل المستندات لمجلده، تسجّل المحل وتفعّله، وترسل:
//   - لصاحب المحل: رابط يحط فيه كلمة المرور ويدخل لوحته
//   - للإدارة: البيانات والمستندات ومين فعّله (تقدر توقفه من لوحة المراجعة)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const RESEND_API_KEY = env("RESEND_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, status = 400) => json({ error: code }, status);

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const layout = (title: string, body: string) => `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F3F6F5;font-family:Tahoma,Arial,sans-serif;color:#10231F">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:bold;color:#0D5C4E;margin-bottom:16px">تحصّله</div>
    <div style="background:#fff;border:1px solid #D6E0DD;border-radius:14px;padding:22px;line-height:1.8">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${body}
    </div>
    <p style="color:#4E625D;font-size:12px;margin-top:16px">تحصّله · مصنع رواحل العرب للصناعة · مكة المكرمة</p>
  </div></body></html>`;
const btn = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0D5C4E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;margin:6px 0 6px 6px">${esc(label)}</a>`;

type Settings = { admin_email: string; from_email: string; site_url: string } | null;
async function settings(): Promise<Settings> {
  const { data } = await admin.from("notify_settings").select("admin_email, from_email, site_url").eq("id", true).maybeSingle();
  return data ? { ...data, site_url: String(data.site_url).replace(/\/$/, "") } : null;
}
async function send(s: Settings, to: string, subject: string, html: string) {
  if (!s || !to || !RESEND_API_KEY) { console.log("email skipped:", subject); return; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: s.from_email, to: [to], subject, html }),
  });
  if (!r.ok) console.error("resend failed", r.status, await r.text());
}

// الحقول اللي يقدر المسوّق يعبيها (نفس نموذج التسجيل)
const FIELDS = ["owner_name", "store_name", "activity", "phone", "contact_phone", "city", "district", "national_address", "lat", "lng", "kind",
  "cr_number", "id_number", "license_number", "vat_registered", "vat_number", "bank_name", "iban", "bnpl", "next_plan", "billing"] as const;
const DOCS = ["cr_path", "vat_path", "iban_path", "id_path"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method", 405);

  // 1) مين المتصل؟ لازم مسوّق نشط عنده صلاحية التفعيل
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  const caller = who?.user;
  if (!caller?.email) return fail("not_signed_in", 401);
  const { data: rep } = await admin.from("reps").select("id, name, code, email, active, can_activate").ilike("email", caller.email).maybeSingle();
  if (!rep?.active || !rep.can_activate) return fail("rep_not_allowed", 403);

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail("bad_request");
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("bad_email");
  if (email === caller.email.toLowerCase()) return fail("own_email");
  if (typeof b.lat !== "number" || typeof b.lng !== "number") return fail("location_required");
  if (!b.owner_ack) return fail("owner_ack_required");

  // المستندات لازم تكون من مجلد المسوّق المؤقت
  const prefix = `rep-${caller.id}/`;
  const docs: Record<string, string | null> = {};
  for (const k of DOCS) {
    const p = b[k];
    if (p == null || p === "") { docs[k] = null; continue; }
    if (typeof p !== "string" || !p.startsWith(prefix) || p.includes("..")) return fail("bad_doc_path");
    docs[k] = p;
  }
  const extras: string[] = Array.isArray(b.extra_docs) ? b.extra_docs : [];
  if (extras.length > 5 || extras.some((p) => typeof p !== "string" || !p.startsWith(prefix) || p.includes(".."))) return fail("bad_doc_path");
  if (!docs.iban_path) return fail("iban_doc_required");

  // 2) حساب صاحب المحل: جديد، أو موجود بدون متجر
  // لو ما كمل التفعيل، نحذف الصور المؤقتة (ما نخلي مستندات محل ما تسجّل)
  const temp = [...Object.values(docs).filter(Boolean) as string[], ...extras];
  const dropTemp = () => admin.storage.from("merchant-docs").remove(temp);

  let uid: string | null = null, created = false;
  const { data: existing } = await admin.rpc("user_id_by_email", { e: email });
  if (existing) {
    const { data: m } = await admin.from("merchants").select("id").eq("id", existing).maybeSingle();
    if (m) { await dropTemp(); return fail("merchant_exists", 409); }
    uid = existing as string;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) { console.error(error); await dropTemp(); return fail("create_user_failed", 500); }
    uid = data.user.id; created = true;
  }

  const moved: string[] = [];
  const cleanup = async () => {
    if (moved.length) await admin.storage.from("merchant-docs").remove(moved);
    await dropTemp();
    await admin.from("merchants").delete().eq("id", uid!);
    if (created) await admin.auth.admin.deleteUser(uid!);
  };

  try {
    // 3) ننقل المستندات لمجلد صاحب المحل
    const move = async (p: string, name: string) => {
      const ext = (p.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
      const to = `${uid}/${name}-${Date.now()}.${ext}`;
      const { error } = await admin.storage.from("merchant-docs").move(p, to);
      if (error) throw new Error("move_failed: " + error.message);
      moved.push(to); return to;
    };
    const finalDocs: Record<string, string | null> = {};
    for (const k of DOCS) finalDocs[k] = docs[k] ? await move(docs[k]!, k.replace("_path", "")) : null;
    const extraDocs: string[] = [];
    for (const [i, p] of extras.entries()) extraDocs.push(await move(p, `extra-${i}`));

    // 4) نسجّل المحل (بانتظار) ثم نفعّله، عشان تشتغل قواعد المؤسسين وبداية الفترة المجانية مثل تفعيل الإدارة
    const row: Record<string, unknown> = { id: uid, email, rep_code: rep.code, activated_by_rep: rep.id, ...finalDocs, extra_docs: extraDocs };
    for (const k of FIELDS) if (b[k] !== undefined) row[k] = b[k];
    if (row.kind !== "store") { row.site_verified_at = new Date().toISOString(); row.site_verified_note = `معاينة ميدانية بالتفعيل: ${rep.name}`; }
    if (row.kind !== "store") row.location_consent_at = new Date().toISOString();
    const ins = await admin.from("merchants").insert(row);
    if (ins.error) throw ins.error;
    const up = await admin.from("merchants").update({ status: "approved", review_note: null }).eq("id", uid);
    if (up.error) throw up.error;
    // يطلع في محلات المسوّق في لوحة الفريق الميداني
    const lk = await admin.rpc("link_rep_activation", { mid: uid });
    if (lk.error) console.error("field link failed", lk.error.message);
    await admin.from("merchant_edits").insert({
      merchant_id: uid, merchant_name: row.store_name, admin_id: null, admin_email: rep.email,
      changes: { activated_by_rep: rep.name, rep_code: rep.code }, note: "تفعيل فوري عن طريق المسوّق",
    });
  } catch (e) {
    console.error(e);
    await cleanup();
    const msg = String((e as any)?.message ?? e);
    const code = /merchants_\w+_chk|violates check|invalid input|not-null/.test(msg) ? "invalid_data: " + msg : "activation_failed";
    return fail(code, 400);
  }

  // 5) الإيميلات
  const s = await settings();
  const site = s?.site_url ?? "https://tahassalah.com";
  let pwLink = "";
  if (created) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${site}/merchant.html` } });
    if (error) console.error(error); else pwLink = data.properties?.action_link ?? "";
  }
  const name = esc(b.owner_name), store = esc(b.store_name);
  const ownerBody = `<p>أهلًا ${name}،</p>
    <p>تم تسجيل <b>${store}</b> في تحصّله وتفعيله عن طريق مسوّقنا <b>${esc(rep.name)}</b>. تقدر الآن تضيف منتجاتك وأسعارك.</p>
    ${pwLink ? `<p>اضغط الزر وحط كلمة مرور لحسابك (الرابط صالح لفترة محدودة؛ لو انتهى، اضغط «نسيت كلمة المرور» في صفحة الدخول):</p>${btn(pwLink, "حط كلمة المرور وادخل لوحتك")}`
      : `<p>ادخل بحسابك الحالي على نفس الإيميل:</p>${btn(`${site}/merchant.html?tab=login`, "ادخل لوحتك")}`}
    <p style="color:#4E625D;font-size:13px">بالدخول أنت موافق على <a href="${site}/terms.html">الشروط</a> و<a href="${site}/privacy.html">سياسة الخصوصية</a>. إذا ما سجّلت في تحصّله ولا تعرف هذا المحل، راسلنا على واتساب ‎+966 55 560 6635.</p>`;
  await send(s, email, "تم تفعيل متجرك في تحصّله 🎉", layout("تم تفعيل متجرك", ownerBody));

  if (s) {
    const sign = async (p: string | undefined) => p ? (await admin.storage.from("merchant-docs").createSignedUrl(p, 60 * 60 * 24 * 7)).data?.signedUrl : null;
    const { data: m } = await admin.from("merchants").select("*").eq("id", uid).single();
    const [cr, vat, iban, id] = await Promise.all([sign(m.cr_path), sign(m.vat_path), sign(m.iban_path), sign(m.id_path)]);
    const r = (k: string, v: unknown) => `<tr><td style="color:#4E625D;padding:4px 0 4px 14px;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v || "—")}</b></td></tr>`;
    const person = m.kind !== "store";
    const body = `<p>⚡ <b>${esc(rep.name)}</b> (كود ${esc(rep.code)}) سجّل هذا المحل وفعّله من الميدان. المحل ظاهر الحين. راجع المستندات، ولو فيها خطأ أوقفه من لوحة المراجعة.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:10px 0">
        ${r("المحل", m.store_name)}${r("المالك", m.owner_name)}${r("النشاط", m.activity)}${r("المدينة", [m.city, m.district].filter(Boolean).join(" — "))}
        ${r("الجوال", m.phone)}${r("الإيميل", m.email)}
        ${person ? r("رقم الهوية", m.id_number) : `${r("السجل التجاري", m.cr_number)}${r("الرقم الضريبي", m.vat_registered ? m.vat_number : "غير مسجل في الضريبة")}`}
        ${r("البنك", m.bank_name)}${r("الآيبان", m.iban)}${r("الموقع", `${m.lat?.toFixed?.(5)}, ${m.lng?.toFixed?.(5)}`)}
      </table>
      <p style="margin:14px 0 4px"><b>المستندات</b> (الروابط صالحة 7 أيام):</p>
      ${cr ? btn(cr, "السجل التجاري") : ""}${vat ? btn(vat, "الشهادة الضريبية") : ""}${iban ? btn(iban, "شهادة الآيبان") : ""}${person && id ? `<span style="color:#4E625D">صورة الهوية في لوحة المراجعة فقط.</span>` : ""}
      <p style="margin-top:16px">${btn(`${site}/admin.html#${m.id}`, "افتح المحل في لوحة المراجعة")}</p>`;
    await send(s, s.admin_email, `⚡ فعّله ${rep.name}: ${m.store_name} — ${m.city}`, layout("محل تفعّل عن طريق مسوّق", body));
  }

  return json({ ok: true, merchant_id: uid, new_account: created, email_sent: !!(s && RESEND_API_KEY) });
});
