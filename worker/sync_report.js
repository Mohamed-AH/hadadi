/* POST /api/sync-report: the sync job's report (tools/sync.py), emailed to the team inbox (MAIL binding -> MAIL_TO), like the
   contact form. Only the job can call it: Authorization: Bearer <SYNC_TOKEN> (a Worker secret; setup_sync.sh makes it and saves
   the same value as a GitHub secret). Every value is escaped or base64-encoded; nothing is stored. */
import { FROM, TO, b64, encWord } from "./contact.js";

const KEYS = [["lessons", "دروس جديدة نُشرت"], ["audio", "صوتيات رُفعت"], ["videos", "مرئيات جديدة"], ["held", "لم تُنشر (تحتاج مراجعة)"], ["errors", "مشكلات"]];
const h = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/* equal length + XOR over all bytes: the time does not tell how much of a wrong token matched */
export function sameToken(a, b) {
  const x = new TextEncoder().encode(String(a || "")), y = new TextEncoder().encode(String(b || ""));
  if (!x.length || x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export function clean(r) {
  const out = {};
  for (const [k] of KEYS) out[k] = (Array.isArray(r[k]) ? r[k] : []).filter(x => typeof x === "string").slice(0, 200).map(x => x.slice(0, 400));
  out.run = typeof r.run === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(r.run) ? r.run : "";
  return out;
}

export function reportMime(r, now = new Date(), to = TO) {
  const n = k => r[k].length;
  const subject = "تحديث الموقع — " + ([n("lessons") && `دروس جديدة: ${n("lessons")}`, n("videos") && `مرئيات جديدة: ${n("videos")}`, n("held") && `للمراجعة: ${n("held")}`,
    n("errors") && `مشكلات: ${n("errors")}`].filter(Boolean).join("، ") || "لا جديد");
  const text = [`تقرير التحديث التلقائي لموقع h-haddadi.com`, ``, ...KEYS.flatMap(([k, t]) => n(k) ? [`${t} (${n(k)}):`, ...r[k].map(x => "- " + x), ``] : []),
    ...(r.run ? [`التفاصيل: ${r.run}`] : [])].join("\n");
  const sec = ([k, t]) => n(k) ? `<p style="margin:16px 0 4px;font-weight:bold">${h(t)} (${n(k)})</p><ul style="margin:0;padding-right:20px">${r[k].map(x => `<li>${h(x)}</li>`).join("")}</ul>` : "";
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:24px;background:#f3ece1"><div dir="rtl" style="max-width:640px;margin:0 auto;background:#fffaf2;border:1px solid #e3d5c0;border-radius:8px;padding:24px;font:16px/1.8 Tahoma,Arial,sans-serif;color:#2b2119;text-align:right">
<p style="margin:0;font-weight:bold">تقرير التحديث التلقائي لموقع h-haddadi.com</p>${KEYS.map(sec).join("")}
${r.run ? `<p style="margin:16px 0 0;font-size:13px"><a href="${h(r.run)}" style="color:#1d6a65">تفاصيل التشغيل على GitHub</a></p>` : ""}</div></body></html>`;
  const B = "b-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return [`From: ${encWord("موقع الشيخ حسن حدادي")} <${FROM}>`, `To: <${to}>`, `Subject: ${encWord(subject)}`, `Date: ${now.toUTCString()}`,
    `Message-ID: <sync-${now.getTime()}-${Math.random().toString(36).slice(2)}@h-haddadi.com>`, `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${B}"`, ``,
    `--${B}`, `Content-Type: text/plain; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, b64(text),
    `--${B}`, `Content-Type: text/html; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, b64(html), `--${B}--`, ``].join("\r\n");
}

export async function syncReport(req, env, { Email = null } = {}) {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.SYNC_TOKEN || !sameToken(auth, env.SYNC_TOKEN)) return json({ ok: false }, 403);
  if (+(req.headers.get("content-length") || 0) > 65536) return json({ ok: false, error: "size" }, 413);
  let r;
  try { r = clean(await req.json()); } catch (e) { return json({ ok: false, error: "bad" }, 400); }
  if (!env.MAIL) return json({ ok: false, error: "no mail" }, 503);
  try {
    const EM = Email || (await import("cloudflare:email")).EmailMessage, to = env.MAIL_TO || TO;
    await env.MAIL.send(new EM(FROM, to, reportMime(r, new Date(), to)));
  } catch (e) { console.log("sync-report: email failed: " + e.message); return json({ ok: false, error: "mail" }, 502); }
  return json({ ok: true });
}
