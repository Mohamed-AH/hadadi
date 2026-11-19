/* POST /api/contact — the «تواصل معنا» form on /contact/ (owner 2026-11-18: anonymous, no mail app, Turnstile).
   1. same-origin only, form or JSON body, field limits;  2. Cloudflare Turnstile check (secret TURNSTILE_SECRET);
   3. saved in D1 table `messages` (binding DB; the admin portal lists them);  4. emailed to info@h-haddadi.com through the
   send_email binding MAIL (Cloudflare Email Routing). Either 3 or 4 is enough for success; nothing about the visitor is
   stored beyond what they typed (no IP, no user agent). A form post without JavaScript gets a 303 back to /contact/?s=<result>. */
export const LIMITS = { name: 80, reply: 120, body: 4000, min: 5 };
export const FROM = "noreply@h-haddadi.com", TO = "info@h-haddadi.com";
const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

export const clean = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(CTRL, "").trim().slice(0, max);

export function validate(f) {
  const m = { name: clean(f.name, LIMITS.name).replace(/\n/g, " "), reply: clean(f.reply, LIMITS.reply).replace(/\n/g, " "), body: clean(f.body, LIMITS.body) };
  if (m.body.length < LIMITS.min) return { error: "body" };
  if (String(f.website || "")) return { error: "spam" };            // honeypot field, hidden from people
  return { m };
}

export async function verifyTurnstile(token, env, fetcher = fetch) {
  if (!env.TURNSTILE_SECRET) return false;
  if (!token || String(token).length > 2048) return false;
  const r = await fetcher(VERIFY, { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token) }) });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

const b64 = s => { const b = new TextEncoder().encode(s); let t = ""; for (const x of b) t += String.fromCharCode(x); return btoa(t).replace(/.{76}/g, "$&\r\n"); };
const encWord = s => `=?UTF-8?B?${b64(s).replace(/\r\n/g, "")}?=`;
const h = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}$/i;
/* Plain text + an RTL HTML part (Gmail shows plain Arabic text left-aligned with the punctuation flipped). Reply-To = the visitor's
   email when they left one, so «رد» in the mail app answers them directly. Every visitor value is escaped (HTML) or base64-encoded. */
export function mime(m, id, now = new Date(), to = TO) {
  const reply = m.reply || "— (لم يترك وسيلة للرد)";
  const text = [`رسالة جديدة من نموذج «تواصل معنا» في h-haddadi.com`, ``, `الاسم: ${m.name || "—"}`, `للرد: ${reply}`, ``, m.body, ``,
    `—`, `رقم الرسالة: ${id || "—"}`].join("\n");
  const row = (k, v) => `<tr><td style="padding:4px 0 4px 16px;color:#6b5846;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0">${h(v)}</td></tr>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:24px;background:#f3ece1"><div dir="rtl" style="max-width:640px;margin:0 auto;background:#fffaf2;border:1px solid #e3d5c0;border-radius:8px;padding:24px;font:16px/1.8 Tahoma,Arial,sans-serif;color:#2b2119;text-align:right">
<p style="margin:0 0 16px;font-weight:bold">رسالة جديدة من نموذج «تواصل معنا» في h-haddadi.com</p>
<table dir="rtl" style="border-collapse:collapse;margin-bottom:16px">${row("الاسم", m.name || "—")}${row("للرد", reply)}</table>
<div style="white-space:pre-wrap;border-top:1px solid #e3d5c0;padding-top:16px">${h(m.body)}</div>
<p style="margin:16px 0 0;color:#6b5846;font-size:13px">رقم الرسالة: ${h(id || "—")}</p></div></body></html>`;
  const B = "b-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return [`From: ${encWord("موقع الشيخ حسن حدادي")} <${FROM}>`, `To: <${to}>`, ...(EMAIL.test(m.reply) ? [`Reply-To: <${m.reply}>`] : []),
    `Subject: ${encWord("رسالة من الموقع" + (m.name ? ": " + m.name : ""))}`,
    `Date: ${now.toUTCString()}`, `Message-ID: <contact-${id || now.getTime()}-${Math.random().toString(36).slice(2)}@h-haddadi.com>`,
    `MIME-Version: 1.0`, `Content-Type: multipart/alternative; boundary="${B}"`, ``,
    `--${B}`, `Content-Type: text/plain; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, b64(text),
    `--${B}`, `Content-Type: text/html; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, b64(html), `--${B}--`, ``].join("\r\n");
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function contact(req, env, { fetcher = fetch, Email = null } = {}) {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const url = new URL(req.url), origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "origin" }, 403);
  const type = req.headers.get("content-type") || "", isForm = !type.includes("application/json");
  if (+(req.headers.get("content-length") || 0) > 20000) return json({ ok: false, error: "size" }, 413);
  let f = {};
  try { f = isForm ? Object.fromEntries(await req.formData()) : await req.json(); } catch (e) { return json({ ok: false, error: "bad" }, 400); }
  const done = (ok, error, status) => isForm ? Response.redirect(`${url.origin}/contact/?s=${ok ? "sent" : error}`, 303) : json(ok ? { ok } : { ok, error }, status);
  const v = validate(f);
  if (v.error === "spam") return done(true);                          // pretend success to bots
  if (v.error) return done(false, v.error, 400);
  if (!(await verifyTurnstile(f["cf-turnstile-response"], env, fetcher))) return done(false, "captcha", 403);
  const m = v.m, at = new Date().toISOString();
  let id = 0, saved = false, mailed = false;
  if (env.DB) {
    try {
      const r = await env.DB.prepare("INSERT INTO messages (at, name, reply, body) VALUES (?, ?, ?, ?)").bind(at, m.name, m.reply, m.body).run();
      id = r.meta?.last_row_id || 0; saved = true;
    } catch (e) { console.log("contact: D1 insert failed: " + e.message); }
  }
  if (env.MAIL) {
    try {
      const EM = Email || (await import("cloudflare:email")).EmailMessage;
      const to = env.MAIL_TO || TO;
      await env.MAIL.send(new EM(FROM, to, mime(m, id, new Date(), to)));
      mailed = true;
      if (saved && id) await env.DB.prepare("UPDATE messages SET mailed = 1 WHERE id = ?").bind(id).run().catch(() => {});
    } catch (e) { console.log("contact: email failed: " + e.message); }
  }
  if (!saved && !mailed) return done(false, "down", 503);
  return done(true);
}
