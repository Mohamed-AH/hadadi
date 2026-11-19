/* All portal URLs live under /admin/ (wrangler.jsonc run_worker_first "/admin/*", so the public site's static files never start
   the Worker); admin.h-haddadi.com/ redirects there. The portal, served by the site's own Worker on admin.h-haddadi.com only (worker/index.js routes by host), so every merge
   deploys it and the owner installs nothing. Two locks: Cloudflare Access in front (Google or emailed code), then this code
   re-verifies the Access JWT (RS256, fail closed) and looks the email up in D1 `users`. Ported from Mohamed-AH/drwasiullah admin/. */
import { identify } from "./auth.mjs";
import { can, ROLES, manageable } from "./roles.mjs";
import { CSS, message, page } from "./html.mjs";
import { audit, auditStmt } from "./audit.mjs";
import * as P from "./pages.mjs";
import * as C from "./content_pages.mjs";
import { JS } from "./client.mjs";
import { handleUpload, attachAudio, addLesson, removeAudio, removeLesson, json } from "./upload.mjs";
import { publish } from "./publish.mjs";

export const ADMIN_HOST = /^admin\./;
const HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; media-src blob:; style-src 'self'; img-src 'self' https://h-haddadi.com data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow",
  "cross-origin-opener-policy": "same-origin", "x-frame-options": "DENY", "strict-transport-security": "max-age=15552000",
};
const done = r => { const h = new Headers(r.headers); for (const [k, v] of Object.entries(HEADERS)) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };
const redirect = (to, code, kind) => done(new Response(null, { status: 303, headers: { location: `/admin${to}${to.includes("?") ? "&" : "?"}${kind}=${code}` } }));
const EMAIL = /^[^\s@<>"',;:\\]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").trim().slice(0, n);
const activeSupers = async db => (await db.prepare("SELECT COUNT(*) c FROM users WHERE role='super' AND active=1").first()).c;

async function post(request, env, user, path) {
  const db = env.DB, f = await request.formData();
  if (path === "/messages/status" && can(user.role, "messages.edit")) {
    const id = parseInt(f.get("id"), 10), status = String(f.get("status") || "");
    if (!id || !P.STATUS.includes(status)) return redirect("/messages", "invalid", "err");
    const before = await db.prepare("SELECT status FROM messages WHERE id=?").bind(id).first();
    if (!before) return redirect("/messages", "unknown", "err");
    await db.batch([db.prepare("UPDATE messages SET status=? WHERE id=?").bind(status, id), auditStmt(db, user.email, "message.status", "message", String(id), before, { status })]);
    return redirect(`/messages/${id}`, "status_saved", "ok");
  }
  if (path === "/messages/delete" && can(user.role, "users.manage")) {          // super admin only, with a confirmation tick
    const id = parseInt(f.get("id"), 10);
    if (!id || f.get("confirm") !== "1") return redirect(`/messages/${id || ""}`, "invalid", "err");
    const before = await db.prepare("SELECT id, at, status FROM messages WHERE id=?").bind(id).first();
    if (!before) return redirect("/messages", "unknown", "err");
    await db.batch([db.prepare("DELETE FROM messages WHERE id=?").bind(id), auditStmt(db, user.email, "message.delete", "message", String(id), before, null)]);
    return redirect("/messages", "deleted", "ok");
  }
  if ((path === "/audio/remove" || path === "/lessons/remove") && can(user.role, "content.edit")) {
    const id = clean(f.get("id"), 80), series = clean(f.get("series"), 80);
    const back = series ? `/series/${encodeURIComponent(series)}` : "/series";
    const okd = path === "/audio/remove" ? await removeAudio(db, user, id) : await removeLesson(db, user, id);
    return okd ? redirect(back, path === "/audio/remove" ? "audio_removed" : "lesson_removed", "ok") : redirect(back, "unknown", "err");
  }
  if (path === "/publish" && can(user.role, "content.publish")) {
    const r = await publish(env, user);
    return redirect("/publish", r, r === "published" || r === "nothing" ? "ok" : "err");
  }
  const allowed = manageable(user.role);
  if (!allowed.length) return null;
  if (path === "/users/add") {
    const email = clean(f.get("email"), 254).toLowerCase(), role = clean(f.get("role"), 10), name = clean(f.get("name"), 80);
    if (!EMAIL.test(email) || !ROLES.includes(role)) return redirect("/users", "invalid", "err");
    if (!allowed.includes(role)) return redirect("/users", "not_yours", "err");
    if (await db.prepare("SELECT 1 FROM users WHERE email=?").bind(email).first()) return redirect("/users", "exists", "err");
    await db.batch([db.prepare("INSERT INTO users (email, role, name) VALUES (?,?,?)").bind(email, role, name || null), auditStmt(db, user.email, "user.add", "user", email, null, { role, name })]);
    return redirect("/users", "added", "ok");
  }
  if (path === "/users/update") {
    const email = clean(f.get("email"), 254).toLowerCase(), role = clean(f.get("role"), 10), active = f.get("active") === "1" ? 1 : 0;
    if (!ROLES.includes(role)) return redirect("/users", "invalid", "err");
    if (email === user.email) return redirect("/users", "self", "err");
    const before = await db.prepare("SELECT email, role, name, active FROM users WHERE email=?").bind(email).first();
    if (!before) return redirect("/users", "unknown", "err");
    if (!allowed.includes(before.role) || !allowed.includes(role)) return redirect("/users", "not_yours", "err");
    if (before.role === "super" && before.active === 1 && !(role === "super" && active === 1) && (await activeSupers(db)) <= 1) return redirect("/users", "last_super", "err");
    await db.batch([db.prepare("UPDATE users SET role=?, active=? WHERE email=?").bind(role, active, email), auditStmt(db, user.email, "user.update", "user", email, before, { ...before, role, active })]);
    return redirect("/users", "updated", "ok");
  }
  return null;
}

export async function admin(request, env) {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/admin(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    if (path === "/admin.css") return done(new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8" } }));
    if (path === "/admin.js") return done(new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8" } }));
    if (!env.DB) return done(message("غير مُهيّأ", "قاعدة البيانات غير مربوطة.", 503));
    let who;
    try { who = await identify(request, env); }
    catch (e) {
      if (e.status === 503) return done(message("غير مُهيّأ", "لوحة التحرير لم تُهيَّأ بعد.", 503));
      return done(message("غير مصرّح", "الدخول عبر Cloudflare Access فقط.", 401));
    }
    const row = await env.DB.prepare("SELECT email, role, name, active FROM users WHERE email = ?").bind(who.email).first();
    if (!row || !row.active) return done(message("لا تملك صلاحية", "هذا البريد غير مسجّل في لوحة التحرير. تواصل مع المدير العام.", 403));
    const user = { email: row.email, role: row.role, name: row.name };

    if (request.method === "POST" || request.method === "PUT") {   // same-origin forms and upload calls only
      const site = request.headers.get("sec-fetch-site"), origin = request.headers.get("origin");
      let same = site === "same-origin";
      if (!same && origin) { try { same = new URL(origin).host === url.host; } catch { /* refuse */ } }
      if (!same) return done(message("مرفوض", "طلب من مصدر غير مسموح.", 403));
      if (path.startsWith("/api/")) {                        // JSON: the upload forms (client.mjs)
        if (!can(user.role, "content.edit")) return done(json({ error: "لا تملك صلاحية الرفع" }, 403));
        const u = await handleUpload(request, env, user, path, url);
        if (u) return done(u);
        if (request.method === "POST" && path === "/api/audio") return done(await attachAudio(request, env, user, await P.library(env)));
        if (request.method === "POST" && path === "/api/lessons") return done(await addLesson(request, env, user, await P.library(env)));
        return done(json({ error: "غير موجود" }, 404));
      }
      if (request.method === "PUT") return done(new Response("Method not allowed", { status: 405 }));
      const r = await post(request, env, user, path);
      return r || done(message("غير متاح", "لا تملك صلاحية هذه العملية.", 403));
    }
    if (request.method !== "GET" && request.method !== "HEAD") return done(new Response("Method not allowed", { status: 405 }));
    if (path === "/favicon.ico") return done(new Response(null, { status: 204 }));
    const flash = url.searchParams.get("ok") ? { kind: "ok", code: url.searchParams.get("ok") } : url.searchParams.get("err") ? { kind: "err", code: url.searchParams.get("err") } : null;
    let html = null, m;
    if (path === "/") html = await P.dashboard(env, user);
    else if (path === "/messages" && can(user.role, "messages.view")) html = await P.messagesList(env.DB, user, url.searchParams, flash);
    else if ((m = /^\/messages\/(\d{1,9})$/.exec(path)) && can(user.role, "messages.view")) html = await P.messageDetail(env.DB, user, +m[1], flash);
    else if (path === "/series") html = await P.seriesList(env, user);
    else if ((m = /^\/series\/([\w-]{1,80})$/.exec(path))) html = await C.seriesDetail(env, user, m[1], flash);
    else if ((m = /^\/series\/([\w-]{1,80})\/new$/.exec(path)) && can(user.role, "content.edit")) html = await C.newLessonPage(env, user, m[1]);
    else if ((m = /^\/lessons\/([\w-]{1,80})\/audio$/.exec(path)) && can(user.role, "content.edit")) html = await C.audioPage(env, user, m[1]);
    else if (path === "/publish" && can(user.role, "content.publish")) html = await C.publishPage(env, user, flash);
    else if (path === "/users" && manageable(user.role).length) html = await P.usersPage(env.DB, user, flash);
    else if (path === "/audit" && can(user.role, "audit.view")) html = await P.auditPage(env.DB, user);
    if (!html) return done(message("غير موجود", "الصفحة المطلوبة غير موجودة أو لا تملك صلاحيتها.", 404));
    return done(page(request.method === "HEAD" ? "" : html));
  } catch (e) {
    console.error("admin error:", e && e.stack || e);
    return done(message("خطأ", "حدث خطأ غير متوقع.", 500));
  }
}
