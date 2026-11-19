/* Publish through Cloudflare only (the owner can't use GitHub): «نشر» saves a snapshot of the portal's content rows in D1 and calls
   the Worker's Workers Builds deploy hook (secret DEPLOY_HOOK). The build (scripts/portal.mjs) reads the newest snapshot from
   https://h-haddadi.com/api/published and merges it over the Telegram import. A merge of a pull request rebuilds with the same
   snapshot, so portal content never disappears. */
import { auditStmt } from "./audit.mjs";
import { MEDIA_BASE } from "./upload.mjs";

const all = (db, sql, ...a) => db.prepare(sql).bind(...a).all().then(r => r.results);

/* exactly what the build gets; no timestamps inside, so equal content = equal JSON */
export async function snapshot(db) {
  const media = {}, lessons = [];
  for (const a of await all(db, "SELECT lesson_id, tg, key, size, duration FROM audio ORDER BY lesson_id"))
    media[a.tg] = { url: `${MEDIA_BASE}/${a.key}`, key: a.key, size: a.size, duration: a.duration, lesson: a.lesson_id };
  for (const l of await all(db, "SELECT id, series_id, title, hd, date, key, duration FROM lessons_new ORDER BY date, id")) {
    const x = { id: l.id, title: l.title, series: l.series_id, kind: "audio", src: `${MEDIA_BASE}/${l.key}`, tg: "", date: l.date || "", duration: l.duration || 0 };
    if (l.hd) x.hd = l.hd;
    lessons.push(x);
  }
  return { v: 1, media, lessons };
}

export const lastPublish = db => db.prepare("SELECT id, at, by, snapshot, result FROM publishes ORDER BY id DESC LIMIT 1").first();

/* what «نشر» would change, compared with the last publish */
export async function pending(db) {
  const now = await snapshot(db), last = await lastPublish(db);
  const was = last ? JSON.parse(last.snapshot) : { media: {}, lessons: [] };
  const key = o => JSON.stringify(o);
  const wasL = new Map(was.lessons.map(l => [l.id, key(l)])), nowL = new Map(now.lessons.map(l => [l.id, key(l)]));
  const wasM = new Map(Object.values(was.media).map(m => [m.lesson, key(m)])), nowM = new Map(Object.values(now.media).map(m => [m.lesson, key(m)]));
  const diff = (a, b) => ({ added: [...b.keys()].filter(k => !a.has(k)), changed: [...b.keys()].filter(k => a.has(k) && a.get(k) !== b.get(k)), removed: [...a.keys()].filter(k => !b.has(k)) });
  const lessons = diff(wasL, nowL), audio = diff(wasM, nowM);
  const count = [lessons, audio].reduce((n, d) => n + d.added.length + d.changed.length + d.removed.length, 0);
  return { now, last, lessons, audio, count };
}

/* -> "published" | "nothing" | "no_hook" | "hook_failed" */
export async function publish(env, user, fetcher = fetch) {
  const db = env.DB, hook = String(env.DEPLOY_HOOK || "");
  if (!/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[\w-]{8,}$/.test(hook)) return "no_hook";
  const p = await pending(db);
  if (!p.count && p.last) return "nothing";
  const snap = JSON.stringify(p.now);
  const { meta } = await db.prepare("INSERT INTO publishes (by, snapshot) VALUES (?, ?)").bind(user.email, snap).run();
  const id = meta.last_row_id;
  let result;
  try {
    const r = await fetcher(hook, { method: "POST", signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    result = { status: r.status, build: (j.result && (j.result.build_uuid || j.result.id)) || null };
    if (!r.ok) throw new Error("deploy hook " + r.status);
  } catch (e) {
    console.error("publish:", e && e.message);
    await db.batch([db.prepare("DELETE FROM publishes WHERE id = ?").bind(id), auditStmt(db, user.email, "site.publish_failed", "site", String(id), null, result || { error: String(e && e.message || e) })]);
    return "hook_failed";
  }
  await db.batch([db.prepare("UPDATE publishes SET result = ? WHERE id = ?").bind(JSON.stringify(result), id),
    auditStmt(db, user.email, "site.publish", "site", String(id), null, { lessons: p.lessons, audio: p.audio, build: result.build })]);
  return "published";
}

/* GET https://h-haddadi.com/api/published — the newest snapshot for the build; public (it is what the site shows anyway).
   404 only when nothing was ever published; any other database error is a 503, so a build fails instead of dropping content. */
export async function published(env) {
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (!env.DB) return new Response('{"error":"no database"}', { status: 503, headers: h });
  try {
    const last = await lastPublish(env.DB);
    if (!last) return new Response('{"none":true}', { status: 404, headers: h });
    return new Response(JSON.stringify({ id: last.id, at: last.at, ...JSON.parse(last.snapshot) }), { headers: h });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return new Response('{"none":true}', { status: 404, headers: h });
    console.error("published:", e && e.stack || e);
    return new Response('{"error":"database"}', { status: 503, headers: h });
  }
}
