/* The admin portal's published content (phase B3), merged by scripts/build.mjs over the Telegram import.
   Source, in order: PORTAL_JSON=<file> (tests) · on Cloudflare's build (WORKERS_CI=1) the live snapshot at PORTAL_URL
   (default: PORTAL_URLS below, served by worker/admin/publish.mjs) · otherwise none (local builds).
   404 = nothing published yet. Anything else that is not a valid snapshot stops the build, so a deploy never drops portal content. */
import fs from "node:fs";

/* workers.dev first: it is the same Worker and sits outside the zone's bot and WAF rules, which could challenge a build server */
export const PORTAL_URLS = ["https://hadadi.emah84.workers.dev/api/published", "https://h-haddadi.com/api/published"];
const MEDIA_URL = /^https:\/\/media\.h-haddadi\.com\/audio\/[0-9a-f]{16}\.(m4a|mp3)$/;

export function checkSnapshot(s) {
  if (!s || typeof s !== "object" || s.v !== 1 || typeof s.media !== "object" || !s.media || !Array.isArray(s.lessons)) throw new Error("portal snapshot: unexpected shape");
  const media = {}, lessons = [];
  for (const [tg0, m] of Object.entries(s.media)) {
    const tg = tg0.replace("https://t.me/masothrbj47/", "https://t.me/Aqar8/");   // the second channel's real username (2026-11-20)
    if (/^https:\/\/t\.me\/[\w]+\/\d+$/.test(tg) && m && MEDIA_URL.test(m.url)) media[tg] = { url: m.url, key: m.key, size: m.size, duration: Number.isInteger(m.duration) ? m.duration : 0 };
  }
  for (const l of s.lessons) {
    if (!l || !/^p-[0-9a-f]{10}$/.test(l.id) || typeof l.title !== "string" || !l.title || typeof l.series !== "string" || !MEDIA_URL.test(l.src)) continue;
    const x = { id: l.id, title: l.title.slice(0, 200), series: l.series, kind: "audio", src: l.src, tg: "", date: /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : "",
      duration: Number.isInteger(l.duration) && l.duration > 0 ? l.duration : 0 };
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(l.hd || "")) x.hd = l.hd;
    lessons.push(x);
  }
  return { id: s.id || 0, at: s.at || "", media, lessons };
}

export async function loadPortal(env = process.env, fetcher = globalThis.fetch) {
  if (env.PORTAL_JSON) return checkSnapshot(JSON.parse(fs.readFileSync(env.PORTAL_JSON, "utf8")));
  if (env.WORKERS_CI !== "1" && !env.PORTAL_URL) return null;
  const errors = [];
  for (const url of env.PORTAL_URL ? [env.PORTAL_URL] : PORTAL_URLS) {
    let r = null, last;
    for (let i = 0; i < 3; i++) {                               // a short retry for a network blip; never silently continue
      try { r = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }); if (r.status < 500) break; last = "HTTP " + r.status; }
      catch (e) { last = e.message; r = null; }
      if (i < 2) await new Promise(ok => setTimeout(ok, (env.PORTAL_RETRY_MS ?? 2000) * (i + 1)));
    }
    if (!r || r.status >= 500) { errors.push(`${url}: ${last}`); continue; }
    /* 404: nothing published yet, or (HTML 404) the deployed Worker predates /api/published, so no portal content is live either */
    if (r.status === 404) { console.log("portal: nothing published yet"); return null; }
    if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) { errors.push(`${url}: answered ${r.status} ${r.headers.get("content-type") || ""}`); continue; }
    return checkSnapshot(await r.json());
  }
  throw new Error("portal snapshot unavailable, stopping the build so the site keeps its portal content: " + errors.join("; "));
}

/* -> { media, lib }: portal audio over media.json (the portal wins for the same post), new lessons appended to their series */
export function mergePortal(lib, media, portal) {
  if (!portal) return { lib, media };
  const series = new Set((lib.series || []).map(s => s.id)), ids = new Set((lib.lessons || []).map(l => l.id));
  const add = portal.lessons.filter(l => series.has(l.series) && !ids.has(l.id));
  const dropped = portal.lessons.length - add.length;
  console.log(`portal: publish #${portal.id} (${portal.at}): ${Object.keys(portal.media).length} audio, ${add.length} added lessons` + (dropped ? `, ${dropped} skipped (unknown series)` : ""));
  return { media: { ...(media || {}), ...portal.media }, lib: { ...lib, lessons: [...(lib.lessons || []), ...add] } };
}
