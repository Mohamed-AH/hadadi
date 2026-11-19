/* Phase B3 end to end without a server: upload (R2 multipart on an in-memory bucket), attach audio, add a lesson, remove, Publish
   through a fake deploy hook, /api/published, the build merge (scripts/portal.mjs), and the anonymous counters (/api/event).
   node --no-warnings tests/portal_check.mjs */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import crypto from "node:crypto";
import worker from "../worker/index.js";
import { forgetJwks } from "../worker/admin/auth.mjs";
import { publish } from "../worker/admin/publish.mjs";
import { checkSnapshot, mergePortal, loadPortal } from "../scripts/portal.mjs";
import { applyMedia } from "../site/js/core.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

/* ---- D1 on SQLite ---- */
const sql = new DatabaseSync(":memory:");
for (const f of ["0001_messages.sql", "0002_admin.sql", "0003_content.sql"]) sql.exec(fs.readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
const stmt = (q, a = []) => ({ bind: (...b) => stmt(q, b), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }),
  run: async () => { const r = sql.prepare(q).run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }, _run() { return sql.prepare(q).run(...a); } });
const DB = { prepare: q => stmt(q), batch: async list => { sql.exec("BEGIN"); try { for (const s of list) s._run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } return []; } };
sql.exec(`INSERT INTO users (email, role) VALUES ('boss@x.org','super'), ('ed@x.org','editor'), ('adm@x.org','admin')`);

/* ---- R2 in memory (the subset upload.mjs uses) ---- */
const objects = new Map(), uploads = new Map();
const MEDIA = {
  head: async k => objects.has(k) ? { size: objects.get(k).length } : null,
  get: async (k, o) => { const b = objects.get(k); if (!b) return null; const s = o?.range ? b.subarray(o.range.offset, o.range.offset + o.range.length) : b; return { arrayBuffer: async () => s.buffer.slice(s.byteOffset, s.byteOffset + s.length) }; },
  delete: async k => { objects.delete(k); },
  createMultipartUpload: async k => { const id = "up" + uploads.size; uploads.set(id, { k, parts: new Map() }); return { uploadId: id }; },
  resumeMultipartUpload: (k, id) => ({
    uploadPart: async (n, body) => { const u = uploads.get(id); const buf = Buffer.from(await new Response(body).arrayBuffer()); u.parts.set(n, buf); return { partNumber: n, etag: "e" + n }; },
    complete: async parts => { const u = uploads.get(id); const b = Buffer.concat(parts.map(p => u.parts.get(p.partNumber))); objects.set(k, b); uploads.delete(id); return { size: b.length }; },
    abort: async () => { uploads.delete(id); },
  }),
};

/* ---- Access tokens ---- */
const TEAM = "team.cloudflareaccess.com", AUD = "aud-hadadi";
const kp = await crypto.webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.webcrypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const b64u = b => Buffer.from(b).toString("base64url");
async function token(email) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify({ email, aud: [AUD], iss: "https://" + TEAM, exp: Date.now() / 1000 + 600 }));
  return `${h}.${p}.${b64u(await crypto.webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)))}`;
}
const hookCalls = [];
let hookStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  if (String(u) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
  if (String(u).startsWith("https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/")) {
    hookCalls.push(i?.method); return new Response(JSON.stringify({ success: hookStatus === 200, result: hookStatus === 200 ? { build_uuid: "11111111-2222-3333-4444-555555555555", status: "queued" } : null }), { status: hookStatus });
  }
  return realFetch(u, i);
};
forgetJwks();

const LIB = { updated: "2026-11-19", series: [{ id: "khutab", title: "خطب الجمعة والعيدين", sec: "khutab" }, { id: "sullam", title: "سلم الوصول", sec: "aqeedah" }],
  lessons: [{ id: "h_haddadi7-1", title: "خطبة أولى", series: "khutab", kind: "audio", src: "", tg: "https://t.me/h_haddadi7/1", date: "2026-11-06", duration: 0 },
    { id: "h_haddadi7-2", title: "الدرس الأول", series: "sullam", kind: "audio", src: "https://media.h-haddadi.com/audio/aaaaaaaaaaaaaaaa.m4a", tg: "https://t.me/h_haddadi7/2", date: "2025-01-01", duration: 60 }] };
const ASSETS = { fetch: async r => { const p = new URL(r.url).pathname; return p === "/data/library.json" ? new Response(JSON.stringify(LIB)) : new Response("public:" + p, { status: p.startsWith("/api/") ? 404 : 200 }); } };
const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab";
const env = { DB, ASSETS, MEDIA, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DEPLOY_HOOK: HOOK };

const H = "https://admin.h-haddadi.com";
async function call(method, path, email, body, { origin = H, type = "application/json" } = {}) {
  const headers = { "cf-access-jwt-assertion": await token(email), ...(origin ? { origin } : {}), ...(body != null && type ? { "content-type": type } : {}) };
  if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) body = type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body);
  if (body instanceof Uint8Array) headers["content-length"] = String(body.length);
  const r = await worker.fetch(new Request(H + path, { method, headers, body, redirect: "manual" }), env);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { r, t, j, loc: r.headers.get("location") || "" };
}
const get = (p, e) => call("GET", p, e, null);
const form = (p, e, f, o) => call("POST", p, e, f, { type: "application/x-www-form-urlencoded", ...o });

/* an m4a-looking file of 9 MiB (two 8 MiB parts) */
function m4a(n, seed) { const b = Buffer.alloc(n, seed); b.write("\0\0\0\x20ftypM4A ", 0, "latin1"); return b; }
async function uploadFile(buf, ext, email = "ed@x.org") {
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const st = await call("POST", "/admin/api/upload/start", email, { size: buf.length, ext, sha256: sha });
  if (!st.r.ok) return st;
  if (st.j.exists) return st;
  const parts = [];
  for (let i = 0, n = 1; i < buf.length; i += 8 * 1048576, n++) {
    const p = await call("PUT", `/admin/api/upload/part?key=${encodeURIComponent(st.j.key)}&uploadId=${st.j.uploadId}&n=${n}`, email, new Uint8Array(buf.subarray(i, i + 8 * 1048576)), { type: "application/octet-stream" });
    parts.push(p.j);
  }
  const c = await call("POST", "/admin/api/upload/complete", email, { key: st.j.key, uploadId: st.j.uploadId, parts });
  return { ...c, key: st.j.key };
}

// pages and permissions
{ const { r, t } = await get("/admin/series/khutab", "ed@x.org"); ok(r.status === 200 && t.includes("تيليجرام فقط") && t.includes('href="/admin/lessons/h_haddadi7-1/audio"'), "series page offers upload for a Telegram-only lesson");
  ok(t.includes('href="/admin/series/khutab/new"'), "series page offers a new lesson"); }
{ const { r } = await get("/admin/series/nope", "ed@x.org"); ok(r.status === 404, "unknown series 404"); }
{ const { r, t } = await get("/admin/lessons/h_haddadi7-1/audio", "ed@x.org"); ok(r.status === 200 && t.includes('<script src="/admin/admin.js" defer>') && t.includes('data-lesson="h_haddadi7-1"'), "upload page loads the script");
  ok(r.headers.get("content-security-policy").includes("script-src 'self'") && !/script-src[^;]*unsafe/.test(r.headers.get("content-security-policy")), "CSP allows only our own script"); }
{ const r = await worker.fetch(new Request(H + "/admin/admin.js"), env); const t = await r.text(); ok(r.status === 200 && /javascript/.test(r.headers.get("content-type")) && t.includes("upload/start") && !t.includes("innerHTML"), "client script served, no innerHTML");
  try { new Function(t); ok(true, ""); } catch (e) { ok(false, "client script parses: " + e.message); } }
{ const { t } = await get("/admin/", "ed@x.org"); ok(t.includes('href="/admin/publish"'), "editor nav has Publish"); }

// upload
const A = m4a(9 * 1048576 + 5, 1);
const up = await uploadFile(A, "m4a");
ok(up.r.status === 200 && /^audio\/[0-9a-f]{16}\.m4a$/.test(up.key) && objects.get(up.key)?.equals(A), "multipart upload stored byte for byte");
{ const again = await uploadFile(A, "m4a"); ok(again.j.exists === true && again.j.key === up.key, "same file again: reused, not re-sent"); }
{ const bad = await uploadFile(Buffer.from("not audio at all, just text....."), "m4a"); ok(bad.r.status === 400 && !objects.has(bad.key), "wrong content refused and deleted"); }
{ const r = await call("POST", "/admin/api/upload/start", "ed@x.org", { size: 10, ext: "exe", sha256: "a".repeat(64) }); ok(r.r.status === 400, "other file types refused"); }
{ const r = await call("POST", "/admin/api/upload/start", "ed@x.org", { size: 10, ext: "m4a", sha256: "a".repeat(64) }, { origin: "https://evil.example" }); ok(r.r.status === 403, "cross-origin upload refused"); }
{ const r = await call("PUT", "/admin/api/upload/part?key=../x&uploadId=u&n=1", "ed@x.org", new Uint8Array(4), { type: "application/octet-stream" }); ok(r.r.status === 400, "bad key refused"); }

// attach to a Telegram lesson
{ const r = await call("POST", "/admin/api/audio", "ed@x.org", { lesson: "h_haddadi7-1", key: up.key, duration: 1830 }); ok(r.r.status === 200 && r.j.ok, "audio attached");
  const row = sql.prepare("SELECT * FROM audio WHERE lesson_id='h_haddadi7-1'").get(); ok(row && row.tg === "https://t.me/h_haddadi7/1" && row.size === A.length && row.duration === 1830 && row.by === "ed@x.org", "audio row saved");
  ok(sql.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='audio.add'").get().c === 1, "attach audited"); }
{ const r = await call("POST", "/admin/api/audio", "ed@x.org", { lesson: "h_haddadi7-1", key: "audio/0000000000000000.m4a" }); ok(r.r.status === 400, "attach needs a stored file"); }
{ const r = await call("POST", "/admin/api/audio", "ed@x.org", { lesson: "nope", key: up.key }); ok(r.r.status === 400, "attach needs a real lesson"); }
{ const r = await call("POST", "/admin/api/audio", "ed@x.org", { lesson: "h_haddadi7-1", key: up.key, duration: 60 }); ok(r.r.status === 400 && /أثقل/.test(r.j.error), "heavy file refused (9 MB for 1 minute)"); }
{ const r = await call("POST", "/admin/api/audio", "ed@x.org", { lesson: "h_haddadi7-1", key: up.key }); ok(r.r.status === 400, "unknown duration refused"); }
{ const { t } = await get("/admin/series/khutab", "ed@x.org"); ok(t.includes("صوت مرفوع في اللوحة") && t.includes("ينتظر النشر"), "series page shows the pending upload"); }

// add a new lesson
const B = m4a(300000, 2), upB = await uploadFile(B, "m4a");
let newId;
{ const r = await call("POST", "/admin/api/lessons", "ed@x.org", { series: "sullam", title: "  درس   <b>إضافي</b> ", hd: "1448-5-28", date: "2026-11-19", key: upB.key, duration: 600 });
  newId = r.j && r.j.lesson; ok(r.r.status === 200 && /^p-[0-9a-f]{10}$/.test(newId), "lesson added with a portal id");
  const row = sql.prepare("SELECT * FROM lessons_new WHERE id=?").get(newId); ok(row && row.title === "درس <b>إضافي</b>" && row.hd === "1448-5-28" && row.series_id === "sullam", "lesson row saved, title tidied"); }
{ const { t } = await get("/admin/series/sullam", "ed@x.org"); ok(t.includes("درس &lt;b&gt;إضافي&lt;/b&gt;") && t.includes("أُضيف في اللوحة") && !t.includes("<b>إضافي"), "new lesson listed, escaped"); }
{ const r = await call("POST", "/admin/api/lessons", "ed@x.org", { series: "nope", title: "عنوان", key: upB.key }); ok(r.r.status === 400, "unknown series refused"); }
{ const r = await call("POST", "/admin/api/lessons", "ed@x.org", { series: "sullam", title: "عنوان", hd: "1448-13-1", date: "2026-11-19", key: upB.key }); ok(r.r.status === 400, "bad Hijri date refused"); }
{ const r = await call("POST", "/admin/api/lessons", "ed@x.org", { series: "sullam", title: "x", key: upB.key }); ok(r.r.status === 400, "title required"); }

// Publish
{ const { t } = await get("/admin/publish", "ed@x.org"); ok(t.includes("تغييرات تنتظر النشر (٢)") && t.includes("صوت جديد: خطبة أولى") && t.includes("نشر التغييرات في الموقع"), "publish page lists two pending changes"); }
{ const r = await worker.fetch(new Request("https://h-haddadi.com/api/published"), env); ok(r.status === 404, "nothing published yet -> 404"); }
{ const res = await publish({ ...env, DEPLOY_HOOK: "" }, { email: "ed@x.org" }); ok(res === "no_hook" && hookCalls.length === 0, "no deploy hook -> refused"); }
{ hookStatus = 500; const { loc } = await form("/admin/publish", "ed@x.org", {}); ok(loc.includes("err=hook_failed") && sql.prepare("SELECT COUNT(*) c FROM publishes").get().c === 0, "hook failure leaves nothing published"); hookStatus = 200; }
{ const { loc } = await form("/admin/publish", "ed@x.org", {}); ok(loc.includes("ok=published") && hookCalls.at(-1) === "POST", "publish calls the deploy hook");
  const p = sql.prepare("SELECT * FROM publishes").get(); ok(p && JSON.parse(p.result).build === "11111111-2222-3333-4444-555555555555", "build id recorded");
  ok(sql.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='site.publish'").get().c === 1, "publish audited"); }
{ const { loc } = await form("/admin/publish", "ed@x.org", {}); ok(loc.includes("ok=nothing"), "nothing new -> no second build"); }
{ const { t } = await get("/admin/series/khutab", "ed@x.org"); ok(t.includes("صوت مرفوع في اللوحة") && !t.includes("ينتظر النشر"), "after publish: no longer pending"); }
let snap;
{ const r = await worker.fetch(new Request("https://h-haddadi.com/api/published"), env); snap = await r.json();
  ok(r.status === 200 && r.headers.get("cache-control") === "no-store" && snap.v === 1 && snap.media["https://t.me/h_haddadi7/1"].url === "https://media.h-haddadi.com/" + up.key, "snapshot served for the build");
  ok(snap.lessons.length === 1 && snap.lessons[0].id === newId && snap.lessons[0].src === "https://media.h-haddadi.com/" + upB.key && snap.lessons[0].hd === "1448-5-28", "snapshot carries the new lesson"); }

// build side
{ const p = checkSnapshot(snap), { lib, media } = mergePortal(LIB, {}, p), out = applyMedia(lib, media);
  const l1 = out.lessons.find(l => l.id === "h_haddadi7-1"), ln = out.lessons.find(l => l.id === newId);
  ok(l1.src === "https://media.h-haddadi.com/" + up.key && l1.duration === 1830 && l1.tg, "build: Telegram lesson gets the uploaded audio");
  ok(ln && ln.series === "sullam" && ln.kind === "audio" && ln.tg === "", "build: new lesson appended"); }
{ const p = checkSnapshot({ v: 1, media: { "https://t.me/h_haddadi7/9": { url: "https://evil.example/a.m4a" } }, lessons: [{ id: "p-0123456789", title: "x", series: "nope", src: "https://media.h-haddadi.com/audio/0123456789abcdef.m4a" }, { id: "../x", title: "y", series: "khutab", src: "javascript:1" }] });
  const { lib, media } = mergePortal(LIB, {}, p); ok(!Object.keys(media).length && lib.lessons.length === LIB.lessons.length, "build: foreign hosts, bad ids and unknown series ignored"); }
{ let threw = false; try { checkSnapshot({ hello: 1 }); } catch { threw = true; } ok(threw, "build: a malformed snapshot stops the build"); }
{ const f = async () => new Response('{"none":true}', { status: 404 }); ok(await loadPortal({ WORKERS_CI: "1" }, f) === null, "build: 404 = nothing published"); }
{ let threw = false, urls = []; try { await loadPortal({ WORKERS_CI: "1", PORTAL_RETRY_MS: 0 }, async u => { urls.push(u); throw new Error("offline"); }); } catch { threw = true; }
  ok(threw && urls.length === 6 && urls[0].includes("workers.dev") && urls[5].includes("h-haddadi.com"), "build: unreachable snapshot stops the build after trying both hosts"); }
{ let threw = false; try { await loadPortal({ WORKERS_CI: "1", PORTAL_RETRY_MS: 0 }, async () => new Response("<html>challenge</html>", { status: 403, headers: { "content-type": "text/html" } })); } catch { threw = true; }
  ok(threw, "build: a bot challenge page stops the build"); }
{ const seen = []; const p = await loadPortal({ WORKERS_CI: "1", PORTAL_RETRY_MS: 0 }, async u => { seen.push(u); return u.includes("workers.dev") ? new Response("x", { status: 403, headers: { "content-type": "text/html" } }) : new Response(JSON.stringify(snap), { headers: { "content-type": "application/json" } }); });
  ok(p && p.lessons.length === 1 && seen.length === 2, "build: falls back to the second host"); }
{ ok(await loadPortal({}, async () => { throw new Error("should not fetch"); }) === null, "local build without PORTAL_*: no fetch"); }
{ const f = async () => new Response(JSON.stringify(snap), { headers: { "content-type": "application/json; charset=utf-8" } }); const p = await loadPortal({ WORKERS_CI: "1" }, f); ok(p.lessons.length === 1, "build: Cloudflare build reads the live snapshot"); }

// remove, then publish again
{ const { loc } = await form("/admin/audio/remove", "ed@x.org", { id: "h_haddadi7-1", series: "khutab" }); ok(loc.includes("ok=audio_removed") && !sql.prepare("SELECT 1 FROM audio").get(), "audio upload taken back"); }
{ const { t } = await get("/admin/publish", "ed@x.org"); ok(t.includes("إلغاء صوت: خطبة أولى"), "removal pending"); }
{ const { loc } = await form("/admin/lessons/remove", "ed@x.org", { id: newId, series: "sullam" }); ok(loc.includes("ok=lesson_removed"), "lesson removed"); }
{ const { loc } = await form("/admin/lessons/remove", "ed@x.org", { id: newId, series: "sullam" }); ok(loc.includes("err=unknown"), "second removal: unknown"); }
{ await form("/admin/publish", "ed@x.org", {}); const s2 = await (await worker.fetch(new Request("https://h-haddadi.com/api/published"), env)).json();
  ok(s2.id > snap.id && !Object.keys(s2.media).length && !s2.lessons.length, "second publish drops what was removed"); }
{ ok(objects.has(up.key), "R2 file kept (content-addressed, may be shared)"); }

// counters
const ev = (body, h = { "sec-fetch-site": "same-origin" }) => worker.fetch(new Request("https://h-haddadi.com/api/event", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env);
{ const r = await ev({ id: "h_haddadi7-1", e: "play" }); ok(r.status === 204, "event -> 204"); await ev({ id: "h_haddadi7-1", e: "play" }); await ev({ id: "h_haddadi7-1", e: "download" });
  const rows = sql.prepare("SELECT event, n FROM stats_daily WHERE lesson_id='h_haddadi7-1' ORDER BY event").all(); ok(rows.length === 2 && rows[0].n === 1 && rows[1].n === 2, "counters add up per day and event"); }
{ await ev({ id: "h_haddadi7-1", e: "play" }, { origin: "https://evil.example" }); await ev({ id: "x'; DROP TABLE", e: "play" }); await ev({ id: "h_haddadi7-1", e: "like" });
  ok(sql.prepare("SELECT SUM(n) n FROM stats_daily").get().n === 3, "cross-origin, bad ids and unknown events not counted"); }
{ const r = await worker.fetch(new Request("https://h-haddadi.com/api/event"), env); ok(r.status === 405, "GET /api/event -> 405"); }
{ const { t } = await get("/admin/series/khutab", "boss@x.org"); ok(t.includes("٢ / ١"), "series page shows plays / downloads"); }
{ const { t } = await get("/admin/", "boss@x.org"); ok(t.includes("استماع في آخر ٣٠ يومًا"), "dashboard counts plays"); }

// roles
{ sql.exec("INSERT INTO users (email, role, active) VALUES ('gone@x.org','editor',0)");
  const r = await call("POST", "/admin/api/upload/start", "gone@x.org", { size: 10, ext: "m4a", sha256: "a".repeat(64) }); ok(r.r.status === 403, "stopped user cannot upload"); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
