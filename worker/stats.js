/* POST /api/event {id, e}: anonymous listening counters (site/js/app.js track()). Same-origin only, tiny body, lesson ids of the
   site's own shape, one upsert into D1 stats_daily(day, lesson_id, event, n). Always 204, so a broken counter never shows. */
const ID = /^(h_haddadi7|masothrbj47)-\d{1,7}$|^p-[0-9a-f]{10}$/;
const EVENTS = new Set(["play", "download"]);
const none = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function event(req, env, now = new Date()) {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const url = new URL(req.url), site = req.headers.get("sec-fetch-site"), origin = req.headers.get("origin");
  let same = site === "same-origin";
  if (!same && origin) { try { same = new URL(origin).host === url.host; } catch {} }
  if (!same || !env.DB || +req.headers.get("content-length") > 512) return none();
  try {
    const b = JSON.parse(await req.text());
    if (!b || !ID.test(String(b.id)) || !EVENTS.has(b.e)) return none();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    await env.DB.prepare("INSERT INTO stats_daily (day, lesson_id, event, n) VALUES (?,?,?,1) ON CONFLICT(day, lesson_id, event) DO UPDATE SET n = n + 1").bind(day, b.id, b.e).run();
  } catch (e) { console.error("event:", e && e.message); }
  return none();
}
