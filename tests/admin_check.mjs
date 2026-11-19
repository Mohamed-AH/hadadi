/* Admin portal (worker/admin/) through the real Worker entry, with an in-memory SQLite standing in for D1 (node:sqlite), a fake
   ASSETS binding and real RS256 Access tokens signed by a test key. No server, no wrangler.   node --no-warnings tests/admin_check.mjs */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import worker from "../worker/index.js";
import { forgetJwks } from "../worker/admin/auth.mjs";
import { replyLinks } from "../worker/admin/pages.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

/* ---- D1 on SQLite ---- */
const sql = new DatabaseSync(":memory:");
for (const f of ["0001_messages.sql", "0002_admin.sql", "0003_content.sql"]) sql.exec(fs.readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
const stmt = (q, a = []) => ({ bind: (...b) => stmt(q, b), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }),
  run: async () => { const r = sql.prepare(q).run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }, _run() { return sql.prepare(q).run(...a); } });
const DB = { prepare: q => stmt(q), batch: async list => { sql.exec("BEGIN"); try { for (const s of list) s._run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } return []; } };
sql.exec(`INSERT INTO users (email, role) VALUES ('boss@x.org','super'), ('adm@x.org','admin'), ('ed@x.org','editor'), ('off@x.org','admin');
  UPDATE users SET active=0 WHERE email='off@x.org';
  INSERT INTO messages (at, name, reply, body, mailed) VALUES ('2026-11-19T06:30:00.000Z','عبدالله','0501234567','سؤال <script>alert(1)</script>',1), ('2026-11-19T06:40:00.000Z','','a@b.co','رسالة ثانية',0);`);

/* ---- Access tokens ---- */
const TEAM = "team.cloudflareaccess.com", AUD = "aud-hadadi";
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const b64u = b => Buffer.from(b).toString("base64url");
async function token(email, { aud = AUD, iss = "https://" + TEAM, exp = Date.now() / 1000 + 600 } = {}) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify({ email, aud: [aud], iss, exp }));
  return `${h}.${p}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)))}`;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => String(u) === `https://${TEAM}/cdn-cgi/access/certs` ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(u, i);
forgetJwks();

const LIB = { updated: "2026-11-19", series: [{ id: "khutab", title: "خطب الجمعة والعيدين", sec: "khutab" }, { id: "sullam", title: "سلم الوصول", sec: "aqeedah" }],
  lessons: [{ id: "a", series: "khutab", src: "https://media.h-haddadi.com/audio/x.m4a", date: "2026-11-06" }, { id: "b", series: "khutab", src: "", date: "2026-10-01" }, { id: "c", series: "sullam", src: "", date: "2025-01-01" }] };
const ASSETS = { fetch: async r => { const p = new URL(r.url).pathname; return p === "/data/library.json" ? new Response(JSON.stringify(LIB)) : new Response("public:" + p); } };
const env = { DB, ASSETS, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const H = "https://admin.h-haddadi.com";
async function get(path, email, opt = {}) {
  const headers = { ...(email ? { "cf-access-jwt-assertion": await token(email, opt) } : {}) };
  const r = await worker.fetch(new Request(H + path, { headers, redirect: "manual" }), env);
  return { r, t: await r.text() };
}
async function post(path, email, form, { origin = H } = {}) {
  const headers = { "cf-access-jwt-assertion": await token(email), "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) };
  const r = await worker.fetch(new Request(H + path, { method: "POST", headers, body: new URLSearchParams(form), redirect: "manual" }), env);
  return { r, loc: r.headers.get("location") || "" };
}

// routing: public host untouched, admin host root redirects, /admin/* is the portal
{ const r = await worker.fetch(new Request("https://h-haddadi.com/"), env); ok((await r.text()) === "public:/", "public home still served from assets"); }
{ const r = await worker.fetch(new Request("https://h-haddadi.com/admin/"), env); ok((await r.text()) === "public:/admin/", "no portal on the public host"); }
{ const r = await worker.fetch(new Request(H + "/", { redirect: "manual" }), env); ok(r.status === 302 && r.headers.get("location") === H + "/admin/", "admin host / -> /admin/"); }
{ const { r, t } = await get("/admin/admin.css"); ok(r.status === 200 && t.includes("--night"), "stylesheet without login"); }
// auth: fail closed
{ const { r } = await get("/admin/"); ok(r.status === 401, "no token -> 401"); }
{ const { r } = await get("/admin/", "boss@x.org", { aud: "other-app" }); ok(r.status === 401, "token for another Access app -> 401"); }
{ const { r } = await get("/admin/", "boss@x.org", { iss: "https://evil.cloudflareaccess.com" }); ok(r.status === 401, "wrong issuer -> 401"); }
{ const { r } = await get("/admin/", "boss@x.org", { exp: Date.now() / 1000 - 5 }); ok(r.status === 401, "expired -> 401"); }
{ const { r } = await get("/admin/", "stranger@x.org"); ok(r.status === 403, "unknown email -> 403"); }
{ const { r } = await get("/admin/", "off@x.org"); ok(r.status === 403, "stopped user -> 403"); }
{ const { r } = await get("/admin/", "BOSS@x.org"); ok(r.status === 200, "email case-insensitive"); }
{ const r = await worker.fetch(new Request(H + "/admin/", { headers: { "x-dev-email": "boss@x.org" } }), env); ok(r.status === 401, "dev header ignored outside ENV=dev"); }
{ const r = await worker.fetch(new Request(H + "/admin/"), { ...env, ACCESS_AUD: "" }); ok(r.status === 503, "not configured -> 503"); }
// dashboard + headers
{ const { r, t } = await get("/admin/", "boss@x.org");
  ok(r.status === 200 && t.includes("لوحة التحرير") && t.includes('href="/admin/messages?status=new"'), "super dashboard with messages card");
  ok(/<b>[١٢]<\/b><span>رسالة جديدة/.test(t) && t.includes("<b>١</b><span>درس بصوت على الموقع"), "dashboard counts");
  ok(r.headers.get("content-security-policy").includes("default-src 'none'") && r.headers.get("x-frame-options") === "DENY" && r.headers.get("cache-control") === "no-store", "security headers");
  ok(t.includes('href="/admin/audit"') && t.includes('href="/admin/users"'), "super sees users + audit"); }
{ const { t } = await get("/admin/", "ed@x.org"); ok(!t.includes('href="/admin/messages"') && !t.includes('href="/admin/users"') && !t.includes('href="/admin/audit"'), "editor nav: no messages/users/audit"); }
{ const { r } = await get("/admin/messages", "ed@x.org"); ok(r.status === 404, "editor cannot open messages"); }
{ const { t } = await get("/admin/", "adm@x.org"); ok(t.includes('href="/admin/messages"') && t.includes('href="/admin/users"') && !t.includes('href="/admin/audit"'), "admin nav: messages + users, no audit"); }
// messages
{ const { r, t } = await get("/admin/messages", "adm@x.org"); ok(r.status === 200 && t.includes("رسالة ثانية") && t.includes('class="unread"'), "inbox lists messages");
  ok(!t.includes("<script>alert") && t.includes("&lt;script&gt;"), "message body escaped in the list"); }
{ const { t } = await get("/admin/messages/1", "adm@x.org"); ok(t.includes("&lt;script&gt;alert(1)") && t.includes("https://wa.me/966501234567"), "detail escaped, WhatsApp link from a Saudi mobile");
  ok(!t.includes("/admin/messages/delete"), "admin cannot delete"); }
{ const { t } = await get("/admin/messages/2", "boss@x.org"); ok(t.includes("mailto:a@b.co") && t.includes("لم تُرسل نسخة"), "mailto + not-mailed note"); ok(t.includes("/admin/messages/delete"), "super can delete"); }
{ const { r } = await get("/admin/messages/999", "boss@x.org"); ok(r.status === 404, "unknown message 404"); }
{ const { r, loc } = await post("/admin/messages/status", "adm@x.org", { id: "1", status: "answered" }); ok(r.status === 303 && loc === "/admin/messages/1?ok=status_saved", "status change redirects");
  ok(sql.prepare("SELECT status FROM messages WHERE id=1").get().status === "answered", "status saved"); ok(sql.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='message.status'").get().c === 1, "status change audited"); }
{ const { loc } = await post("/admin/messages/status", "adm@x.org", { id: "1", status: "spam" }); ok(loc.includes("err=invalid"), "bad status refused"); }
{ const { r } = await post("/admin/messages/status", "adm@x.org", { id: "1", status: "read" }, { origin: "https://evil.example" }); ok(r.status === 403, "cross-origin POST refused"); }
{ const { r } = await post("/admin/messages/status", "ed@x.org", { id: "1", status: "read" }); ok(r.status === 403, "editor cannot change status"); }
{ const { loc } = await post("/admin/messages/delete", "boss@x.org", { id: "2" }); ok(loc.includes("err=invalid") && sql.prepare("SELECT COUNT(*) c FROM messages").get().c === 2, "delete needs the confirmation tick"); }
{ const { r } = await post("/admin/messages/delete", "adm@x.org", { id: "2", confirm: "1" }); ok(r.status === 403, "admin cannot delete"); }
{ const { loc } = await post("/admin/messages/delete", "boss@x.org", { id: "2", confirm: "1" }); ok(loc.includes("ok=deleted") && sql.prepare("SELECT COUNT(*) c FROM messages").get().c === 1, "super deletes with confirmation"); }
{ const { t } = await get("/admin/messages?status=answered", "adm@x.org"); ok(t.includes("عبدالله") && t.includes('aria-current="true"'), "filter by status"); }
// series (read-only, from the published library)
{ const { t } = await get("/admin/series", "ed@x.org"); ok(t.includes("خطب الجمعة والعيدين") && t.includes(`href="/admin/series/khutab"`), "series list from library.json"); }
// users: super manages all, admin only editors, last super guarded, no self-change
{ const { loc } = await post("/admin/users/add", "adm@x.org", { email: "new-admin@x.org", role: "admin" }); ok(loc.includes("err=not_yours"), "admin cannot add an admin"); }
{ const { loc } = await post("/admin/users/add", "adm@x.org", { email: "New-Ed@x.org", role: "editor", name: "محرر" }); ok(loc.includes("ok=added") && sql.prepare("SELECT role FROM users WHERE email='new-ed@x.org'").get()?.role === "editor", "admin adds an editor (lower-cased)"); }
{ const { loc } = await post("/admin/users/add", "boss@x.org", { email: "new-ed@x.org", role: "editor" }); ok(loc.includes("err=exists"), "duplicate refused"); }
{ const { loc } = await post("/admin/users/add", "boss@x.org", { email: "not an email", role: "editor" }); ok(loc.includes("err=invalid"), "bad email refused"); }
{ const { loc } = await post("/admin/users/update", "adm@x.org", { email: "boss@x.org", role: "editor", active: "1" }); ok(loc.includes("err=not_yours"), "admin cannot demote the super"); }
{ const { loc } = await post("/admin/users/update", "adm@x.org", { email: "ed@x.org", role: "admin", active: "1" }); ok(loc.includes("err=not_yours"), "admin cannot promote to admin"); }
{ const { loc } = await post("/admin/users/update", "boss@x.org", { email: "boss@x.org", role: "admin", active: "1" }); ok(loc.includes("err=self"), "no self-change"); }
{ sql.exec("INSERT INTO users (email, role) VALUES ('boss2@x.org','super')");
  const { loc } = await post("/admin/users/update", "boss2@x.org", { email: "boss@x.org", role: "admin", active: "1" }); ok(loc.includes("ok=updated"), "a second super can demote the first");
  const r2 = await post("/admin/users/update", "boss@x.org", { email: "boss2@x.org", role: "admin", active: "1" }); ok(r2.loc.includes("err=not_yours"), "the demoted one cannot touch a super");
  sql.exec("UPDATE users SET role='super' WHERE email='boss@x.org'"); sql.exec("DELETE FROM users WHERE email='boss2@x.org'"); }
{ sql.exec("INSERT INTO users (email, role) VALUES ('boss3@x.org','super')"); sql.exec("UPDATE users SET active=0 WHERE email='boss@x.org'");
  sql.exec("UPDATE users SET active=1 WHERE email='boss@x.org'"); sql.exec("UPDATE users SET active=0 WHERE email='boss3@x.org'");
  sql.exec("UPDATE users SET role='super', active=1 WHERE email='adm@x.org'");
  const { loc } = await post("/admin/users/update", "adm@x.org", { email: "boss@x.org", role: "super", active: "0" });
  ok(loc.includes("ok=updated"), "stopping one of two supers is fine");
  const r2 = await post("/admin/users/update", "boss3@x.org", { email: "adm@x.org", role: "admin", active: "1" }); ok(r2.r.status === 403, "stopped super cannot act");
  sql.exec("UPDATE users SET active=1 WHERE email='boss@x.org'"); sql.exec("UPDATE users SET role='admin' WHERE email='adm@x.org'"); sql.exec("DELETE FROM users WHERE email='boss3@x.org'");
  sql.exec("INSERT INTO users (email, role) VALUES ('boss4@x.org','admin')");
  const r3 = await post("/admin/users/update", "boss@x.org", { email: "boss@x.org", role: "admin", active: "1" }); ok(r3.loc.includes("err=self"), "only super cannot remove themselves");
  ok(sql.prepare("SELECT COUNT(*) c FROM users WHERE role='super' AND active=1").get().c >= 1, "at least one active super remains"); }
{ const { t } = await get("/admin/users", "adm@x.org"); ok(t.includes("new-ed@x.org") && !/name="email" value="boss@x.org"/.test(t), "admin sees users, cannot edit the super's row"); }
{ const { t } = await get("/admin/audit", "boss@x.org"); ok(t.includes("user.add") && t.includes("message.delete"), "audit log lists changes"); }
{ const { r } = await get("/admin/audit", "adm@x.org"); ok(r.status === 404, "admin has no audit page"); }
// reply links
ok(replyLinks("+966 50 123 4567").includes("wa.me/966501234567") && replyLinks("٠٥٠١٢٣٤٥٦٧").includes("wa.me/966501234567") && replyLinks("hello") === "" && replyLinks('a@b.co"><script>').indexOf("<script>") === -1, "reply links");

globalThis.fetch = realFetch;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
