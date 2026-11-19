/* The «تواصل معنا» endpoint (worker/contact.js) with a fake D1, a fake send_email binding and a fake Turnstile. No server needed.
   node tests/contact_check.mjs */
import { contact, validate, mime, LIMITS } from "../worker/contact.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

function fakeEnv({ db = true, mail = true, secret = "s3cret", dbFails = false, mailFails = false } = {}) {
  const rows = [], sent = [];
  const env = { TURNSTILE_SECRET: secret };
  if (db) env.DB = { prepare: sql => ({ bind: (...a) => ({ run: async () => {
    if (dbFails) throw new Error("d1 down");
    if (sql.startsWith("INSERT")) { rows.push({ id: rows.length + 1, at: a[0], name: a[1], reply: a[2], body: a[3], mailed: 0 }); return { meta: { last_row_id: rows.length } }; }
    if (sql.startsWith("UPDATE")) { rows[a[0] - 1].mailed = 1; return {}; }
  } }) }) };
  if (mail) env.MAIL = { send: async m => { if (mailFails) throw new Error("mail down"); sent.push(m); } };
  return { env, rows, sent };
}
const dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\r\n/g, "")), c => c.charCodeAt(0)));
const parts = raw => raw.split(/--b-[^\r\n]*\r\n/).slice(1).map(p => p.split("\r\n\r\n")[1]).filter(Boolean).map(b => dec(b.replace(/\r\n--b-.*$/s, "").trim()));
class Email { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
const ts = good => async (url, init) => { ok(url.includes("siteverify"), "turnstile URL"); ok(init.body.get("secret") === "s3cret", "secret sent"); return new Response(JSON.stringify({ success: good && init.body.get("response") === "tok" })); };
const req = (body, { json = true, origin = "https://h-haddadi.com", method = "POST" } = {}) => new Request("https://h-haddadi.com/api/contact", { method,
  headers: { ...(origin ? { origin } : {}), "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
  body: method === "GET" ? undefined : json ? JSON.stringify(body) : new URLSearchParams(body) });
const good = { name: "عبدالله", reply: "0500000000", body: "السلام عليكم، سؤال عن درس الأمس.", "cf-turnstile-response": "tok" };

// happy path: saved + mailed
{ const { env, rows, sent } = fakeEnv(); const r = await contact(req(good), env, { fetcher: ts(true), Email });
  const j = await r.json(); ok(r.status === 200 && j.ok, "happy path ok"); ok(rows.length === 1 && rows[0].body === good.body && rows[0].mailed === 1, "saved and marked mailed");
  ok(sent.length === 1 && sent[0].to === "info@h-haddadi.com" && sent[0].from === "noreply@h-haddadi.com", "mailed to info@");
  const raw = sent[0].raw; ok(/Content-Transfer-Encoding: base64/.test(raw) && /charset=UTF-8/.test(raw), "MIME headers");
  const [text, html] = parts(raw);
  ok(/multipart\/alternative/.test(raw) && html.includes('dir="rtl"') && html.includes(good.body), "RTL HTML part");
  ok(text.includes(good.body) && text.includes("0500000000") && text.includes("رقم الرسالة: 1"), "email body has the message"); }
// MAIL_TO (the verified team inbox) wins over info@
{ const { env, sent } = fakeEnv(); env.MAIL_TO = "team@example.org"; await contact(req(good), env, { fetcher: ts(true), Email });
  ok(sent[0].to === "team@example.org" && /^To: <team@example.org>/m.test(sent[0].raw), "MAIL_TO used"); }
// no IP or user agent stored
{ const { env, rows } = fakeEnv(); await contact(req(good), env, { fetcher: ts(true), Email }); ok(Object.keys(rows[0]).join() === "id,at,name,reply,body,mailed", "only typed fields stored"); }
// anonymous: only the message
{ const { env, rows } = fakeEnv(); const r = await contact(req({ body: "رسالة بلا اسم", "cf-turnstile-response": "tok" }), env, { fetcher: ts(true), Email });
  ok((await r.json()).ok && rows[0].name === "" && rows[0].reply === "", "anonymous message accepted"); }
// Turnstile fails / missing / no secret
{ const { env, rows } = fakeEnv(); const r = await contact(req({ ...good, "cf-turnstile-response": "bad" }), env, { fetcher: ts(true), Email });
  ok(r.status === 403 && (await r.json()).error === "captcha" && rows.length === 0, "bad token refused"); }
{ const { env } = fakeEnv(); const r = await contact(req({ ...good, "cf-turnstile-response": "" }), env, { fetcher: async () => { ok(false, "no siteverify call without a token"); }, Email });
  ok(r.status === 403, "missing token refused"); }
{ const { env } = fakeEnv({ secret: "" }); const r = await contact(req(good), env, { fetcher: ts(true), Email }); ok(r.status === 403, "no secret = refused (fail closed)"); }
// validation
{ const { env } = fakeEnv(); const r = await contact(req({ ...good, body: "  ab " }), env, { fetcher: ts(true), Email }); ok(r.status === 400 && (await r.json()).error === "body", "short message refused"); }
{ const v = validate({ name: "a\nb‮c", reply: "x".repeat(500), body: "y".repeat(9000) });
  ok(v.m.name === "a bc" && v.m.reply.length === LIMITS.reply && v.m.body.length === LIMITS.body, "trimmed, control chars and bidi overrides removed, capped"); }
// honeypot: pretend success, store nothing
{ const { env, rows, sent } = fakeEnv(); const r = await contact(req({ ...good, website: "http://spam" }), env, { fetcher: async () => { ok(false, "honeypot skips siteverify"); }, Email });
  ok((await r.json()).ok && rows.length === 0 && sent.length === 0, "honeypot swallowed"); }
// cross-origin, method
{ const { env } = fakeEnv(); const r = await contact(req(good, { origin: "https://evil.example" }), env, { fetcher: ts(true), Email }); ok(r.status === 403, "cross-origin refused"); }
{ const { env } = fakeEnv(); const r = await contact(req(null, { method: "GET" }), env, { fetcher: ts(true), Email }); ok(r.status === 405, "GET refused"); }
// one of the two outputs is enough; both down = 503
{ const { env, sent } = fakeEnv({ dbFails: true }); const r = await contact(req(good), env, { fetcher: ts(true), Email }); ok((await r.json()).ok && sent.length === 1, "D1 down, email still sent"); }
{ const { env, rows } = fakeEnv({ mailFails: true }); const r = await contact(req(good), env, { fetcher: ts(true), Email }); ok((await r.json()).ok && rows.length === 1 && rows[0].mailed === 0, "email down, saved"); }
{ const { env } = fakeEnv({ db: false, mail: false }); const r = await contact(req(good), env, { fetcher: ts(true), Email }); ok(r.status === 503, "no outputs = 503"); }
// plain form post (no JavaScript): 303 back to the page
{ const { env } = fakeEnv(); const r = await contact(req(good, { json: false }), env, { fetcher: ts(true), Email });
  ok(r.status === 303 && r.headers.get("location") === "https://h-haddadi.com/contact/?s=sent", "form post redirects"); }
{ const { env } = fakeEnv(); const r = await contact(req({ ...good, body: "" }, { json: false }), env, { fetcher: ts(true), Email });
  ok(r.status === 303 && r.headers.get("location").endsWith("?s=body"), "form post error redirects"); }
// HTML escaping + Reply-To only for a real email address
{ const raw = mime({ name: "<b>x</b>", reply: "a@b.co", body: "<script>alert(1)</script> & co" }, 4); const [, html] = parts(raw);
  ok(!html.includes("<script>") && html.includes("&lt;script&gt;") && html.includes("&lt;b&gt;") && html.includes("&amp; co"), "visitor text escaped in HTML");
  ok(/^Reply-To: <a@b.co>$/m.test(raw), "Reply-To set for an email"); }
{ ok(!/^Reply-To:/m.test(mime({ name: "", reply: "0500000000", body: "hello there" }, 5)), "no Reply-To for a phone number");
  ok(!/^Reply-To:/m.test(mime({ name: "", reply: "a@b.co\r\nBcc: x@y.z", body: "hello there" }, 6)), "no Reply-To injection"); }
// header injection: name with CR/LF cannot add headers
{ const raw = mime({ name: "x\r\nBcc: a@b.c", reply: "", body: "hello there" }, 3); ok(!/^Bcc:/m.test(raw), "no header injection"); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
