// تحصّله — إيميلات المطالبات (اشتراك وخدمات).
// daily (يوميًا من cron عبر billing_daily): مطالبة جديدة قبل 7 أيام، تذكير قبل 3 أيام، وتذكير يوم الاستحقاق.
// paid (من تريقر invoices): إيصال سداد للتاجر. proof: التاجر رفع إيصال ← إيميل للإدارة. issued: مطالبة خدمة جديدة ← إيميل للتاجر.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const RESEND_API_KEY = env("RESEND_API_KEY");

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const btn = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0D5C4E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;margin:6px 0 6px 6px">${esc(label)}</a>`;
const PLAN: Record<string, string> = { family: "أسر ومتجولين", trader: "تاجر", pro: "مميز" };
const METHOD: Record<string, string> = { transfer: "تحويل بنكي", pos: "شبكة (نقاط بيع)", cash: "نقدًا" };
const money = (n: number) => Number(n).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ر.س";
const day = (d: string) => new Date(d).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh" });

async function cfg() {
  const [{ data: n }, { data: b }] = await Promise.all([
    admin.from("notify_settings").select("webhook_secret, admin_email, from_email, site_url").eq("id", true).single(),
    admin.from("billing_settings").select("*").eq("id", true).single(),
  ]);
  return { n: { ...n, site_url: String(n?.site_url ?? "").replace(/\/$/, "") }, b };
}

function layout(b: any, title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F3F6F5;font-family:Tahoma,Arial,sans-serif;color:#10231F">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:bold;color:#0D5C4E;margin-bottom:16px">تحصّله</div>
    <div style="background:#fff;border:1px solid #D6E0DD;border-radius:14px;padding:22px;line-height:1.8">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${body}
    </div>
    <p style="color:#4E625D;font-size:12px;margin-top:16px">${esc(b.company_name)} · سجل تجاري ${esc(b.cr_number)} · الرقم الضريبي ${esc(b.vat_number)} · ${esc(b.address)}</p>
  </div></body></html>`;
}

function invTable(inv: any) {
  const r = (k: string, v: string) => `<tr><td style="color:#4E625D;padding:4px 0 4px 14px;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`;
  return `<table style="border-collapse:collapse;font-size:14px;margin:10px 0">
    ${r("رقم المطالبة", esc(inv.number))}${r("المحل", esc(inv.store_name))}
    ${inv.kind === "service"
      ? r("الخدمة", esc(`${inv.description}${Number(inv.qty) !== 1 ? ` × ${Number(inv.qty)}` : ""}`))
      : `${r("الباقة", esc(`${PLAN[inv.plan] ?? inv.plan} · ${inv.billing === "yearly" ? "سنوي" : "شهري"}`))}
    ${r("الفترة", esc(`${day(inv.period_start)} — ${day(inv.period_end)}`))}`}
    ${r("المبلغ", esc(money(inv.amount)))}${r("ضريبة القيمة المضافة 15%", esc(money(inv.vat)))}
    ${r("الإجمالي", `<span style="color:#0D5C4E;font-size:16px">${esc(money(inv.total))}</span>`)}
    ${r("آخر موعد للسداد", esc(day(inv.due_at)))}
  </table>`;
}

function howToPay(b: any, inv: any) {
  return `<p style="margin:14px 0 4px"><b>طرق السداد</b></p>
    <ul style="margin:0;padding-inline-start:20px">
      ${b.iban ? `<li>تحويل بنكي إلى <b>${esc(b.company_name)}</b>${b.bank_name ? ` (${esc(b.bank_name)})` : ""}، الآيبان: <b dir="ltr">${esc(b.iban)}</b>، واكتب رقم المطالبة <b>${esc(inv.number)}</b> في الملاحظة.</li>` : ""}
      <li>شبكة (مدى أو بطاقة) أو نقدًا عن طريق مسوّق تحصّله.</li>
    </ul>
    <p style="margin:8px 0 0"><b>حوّلت؟</b> افتح المطالبة من الزر تحت وارفع صورة الإيصال، أو أرسله واتساب.</p>
    <p style="color:#4E625D;font-size:13px">أول ما يتأكد السداد ${inv.kind === "service" ? "" : "يتجدد اشتراكك تلقائيًا و"}يوصلك إيصال. للاستفسار واتساب ‎+966 55 560 6635.</p>`;
}

async function send(from: string, to: string, subject: string, html: string) {
  if (!to || !RESEND_API_KEY) { console.log("email skipped:", subject); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!r.ok) { console.error("resend failed", r.status, await r.text()); return false; }
  return true;
}

async function daily(c: any) {
  const { data: list } = await admin.from("invoices").select("*").eq("status", "issued");
  let sent = 0;
  for (const inv of list ?? []) {
    const left = Math.ceil((new Date(inv.due_at).getTime() - Date.now()) / 86400000);
    const rem = inv.reminders ?? {};
    let key = "", subject = "", lead = "";
    if (left <= 0 && !rem.due) { key = "due"; subject = `اليوم آخر موعد لتجديد اشتراكك · ${inv.number}`; lead = "اليوم آخر موعد لسداد اشتراكك. جدّده اليوم عشان يبقى متجرك ظاهر للمشترين."; }
    else if (left > 0 && left <= 3 && !rem.d3) { key = "d3"; subject = `باقي ${left} ${left === 1 ? "يوم" : "أيام"} على تجديد اشتراكك · ${inv.number}`; lead = `باقي <b>${left} ${left === 1 ? "يوم" : "أيام"}</b> على نهاية اشتراكك. سدّد المطالبة عشان ما يتوقف ظهور متجرك.`; }
    else if (left > 3 && !rem.d7) { key = "d7"; subject = `مطالبة تجديد اشتراكك في تحصّله · ${inv.number}`; lead = `اشتراكك يتجدد بعد <b>${left} أيام</b>. هذي مطالبة التجديد حسب باقتك.`; }
    if (!key) continue;
    if (inv.kind === "service") {
      subject = key === "due" ? `اليوم آخر موعد لسداد ${inv.description} · ${inv.number}` : key === "d3" ? `تذكير: مطالبة ${inv.description} · ${inv.number}` : `مطالبة ${inv.description} · ${inv.number}`;
      lead = key === "due" ? "اليوم آخر موعد لسداد مطالبة الخدمة." : key === "d3" ? `باقي <b>${left} ${left === 1 ? "يوم" : "أيام"}</b> على موعد سداد مطالبة الخدمة.` : "هذي مطالبة الخدمة اللي اتفقنا عليها.";
    }
    const html = layout(c.b, inv.kind === "service" ? "مطالبة خدمة" : "مطالبة اشتراك", `<p>أهلًا ${esc(inv.owner_name ?? "")}،</p><p>${lead}</p>${invTable(inv)}${howToPay(c.b, inv)}
      ${btn(`${c.n.site_url}/invoice.html?id=${inv.id}`, "عرض المطالبة ورفع الإيصال")}`);
    const ok = await send(c.n.from_email, inv.email, subject, html);
    // نعلّم التذكيرات اللي قبله بعد، عشان ما يوصله تذكيران متتاليان
    const mark = key === "due" ? { d7: true, d3: true, due: new Date().toISOString() } : key === "d3" ? { d7: true, d3: new Date().toISOString() } : { d7: new Date().toISOString() };
    if (ok || !RESEND_API_KEY) { await admin.from("invoices").update({ reminders: { ...rem, ...mark } }).eq("id", inv.id); sent++; }
  }
  return sent;
}

async function paid(c: any, id: string) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", id).single();
  if (!inv || inv.status !== "paid") return false;
  const html = layout(c.b, inv.kind === "service" ? "تم استلام السداد ✓" : "تم استلام اشتراكك ✓", `<p>أهلًا ${esc(inv.owner_name ?? "")}،</p>
    ${inv.kind === "service"
      ? `<p>استلمنا سداد <b>${esc(inv.description)}</b> (${esc(METHOD[inv.paid_method] ?? inv.paid_method)}). شكرًا لك.</p>`
      : `<p>استلمنا سداد اشتراك <b>${esc(inv.store_name)}</b> (${esc(METHOD[inv.paid_method] ?? inv.paid_method)})، واشتراكك ساري لين <b>${esc(day(inv.period_end))}</b>.</p>`}
    ${invTable(inv)}${btn(`${c.n.site_url}/invoice.html?id=${inv.id}`, "عرض الإيصال")}`);
  return await send(c.n.from_email, inv.email, `إيصال سداد ${inv.kind === "service" ? inv.description : "اشتراكك"} · ${inv.number}`, html);
}

async function issued(c: any, id: string) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", id).single();
  if (!inv || inv.status !== "issued") return false;
  const left = Math.ceil((new Date(inv.due_at).getTime() - Date.now()) / 86400000);
  const html = layout(c.b, "مطالبة خدمة", `<p>أهلًا ${esc(inv.owner_name ?? "")}،</p><p>هذي مطالبة <b>${esc(inv.description)}</b> اللي اتفقنا عليها${left > 0 ? `، وآخر موعد للسداد بعد ${left} ${left === 1 ? "يوم" : "أيام"}` : ""}.</p>
    ${invTable(inv)}${howToPay(c.b, inv)}${btn(`${c.n.site_url}/invoice.html?id=${inv.id}`, "عرض المطالبة ورفع الإيصال")}`);
  const ok = await send(c.n.from_email, inv.email, `مطالبة ${inv.description} · ${inv.number}`, html);
  if (ok || !RESEND_API_KEY) await admin.from("invoices").update({ reminders: { ...(inv.reminders ?? {}), d7: new Date().toISOString(), ...(left <= 3 ? { d3: true } : {}) } }).eq("id", inv.id);
  return ok;
}

async function proof(c: any, id: string) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", id).single();
  if (!inv || inv.status !== "issued" || !inv.submitted_receipt) return false;
  const { data: u } = await admin.storage.from("receipts").createSignedUrl(inv.submitted_receipt, 60 * 60 * 24 * 7);
  const html = layout(c.b, "تاجر رفع إيصال سداد", `<p><b>${esc(inv.store_name)}</b> رفع إيصال سداد المطالبة <b>${esc(inv.number)}</b> بمبلغ <b>${esc(money(inv.total))}</b>${inv.submitted_ref ? ` (مرجع ${esc(inv.submitted_ref)})` : ""}.</p>
    <p>تأكد إن المبلغ وصل الحساب، وبعدها اضغط «تأكيد السداد» في الحسابات${inv.kind === "service" ? "" : "، والاشتراك يتجدد تلقائيًا"}.</p>
    ${u?.signedUrl ? btn(u.signedUrl, "عرض الإيصال") : ""}${btn(`${c.n.site_url}/accounts.html#bills`, "افتح الحسابات")}`);
  return await send(c.n.from_email, c.n.admin_email, `📎 إيصال سداد: ${inv.store_name} · ${inv.number}`, html);
}

// تذكير الفواتير المستحقة (للإدارة والتاجر) حسب الأيام أو التواريخ اللي اختارها صاحبها: إيميل + تنبيه على الجوال
async function billReminders(c: any) {
  const { data: rows, error } = await admin.rpc("bill_reminders_due");
  if (error) { console.error("bill_reminders_due", error.message); return 0; }
  let n = 0;
  const pushes: any[] = [];
  for (const r of rows ?? []) {
    const when = r.days_left === 0 ? "اليوم" : r.days_left < 0 ? "متأخرة" : `بعد ${r.days_left} يوم`;
    const subject = `⏰ فاتورة مستحقة ${when}: ${r.title}`;
    const url = r.merchant_id ? `${c.n.site_url}/merchant.html#books` : `${c.n.site_url}/accounts.html#payables`;
    const html = layout(c.b, "تذكير بفاتورة مستحقة", `<p>${r.store_name ? `<b>${esc(r.store_name)}</b>: ` : ""}فاتورة <b>${esc(r.title)}</b>${r.vendor ? ` لـ ${esc(r.vendor)}` : ""} بمبلغ <b>${esc(money(r.amount))}</b> موعد سدادها <b>${esc(day(r.due_date))}</b> (${esc(when)}).</p>
      <p>لما تسددها اضغط «تم السداد» في الحسابات، وتنحفظ في المصروفات تلقائيًا.</p>${btn(url, "افتح الفواتير")}`);
    for (const to of r.emails ?? []) if (await send(c.n.from_email, to, subject, html)) n++;
    pushes.push({ users: r.user_ids ?? [], title: subject, body: `${r.title} · ${money(r.amount)} · ${day(r.due_date)}`, url: r.merchant_id ? "merchant.html#books" : "accounts.html#payables", tag: "bill-" + r.bill_id });
  }
  if (pushes.length) await fetch(replaceFn(c, "push"), { method: "POST", headers: { "Content-Type": "application/json", "x-webhook-secret": c.n.webhook_secret }, body: JSON.stringify({ type: "direct", messages: pushes }) }).catch((e) => console.error("push", e));
  return n;
}
const replaceFn = (c: any, name: string) => `${env("SUPABASE_URL")}/functions/v1/${name}`;

Deno.serve(async (req) => {
  const c = await cfg();
  if (!c.n?.webhook_secret || req.headers.get("x-webhook-secret") !== c.n.webhook_secret) return new Response("unauthorized", { status: 401 });
  const p = await req.json().catch(() => null);
  try {
    if (p?.type === "daily") return Response.json({ sent: await daily(c), bills: await billReminders(c) });
    if (p?.type === "bills") return Response.json({ bills: await billReminders(c) });
    if (p?.type === "issued" && p.invoice_id) return Response.json({ sent: await issued(c, p.invoice_id) });
    if (p?.type === "proof" && p.invoice_id) return Response.json({ sent: await proof(c, p.invoice_id) });
    if (p?.type === "paid" && p.invoice_id) return Response.json({ sent: await paid(c, p.invoice_id) });
  } catch (e) { console.error(e); return new Response("error", { status: 500 }); }
  return new Response("ignored");
});
