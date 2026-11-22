/* The announcement posters for the build. Source, in order: POSTERS_JSON=<file> (tests) · on Cloudflare's build (WORKERS_CI=1)
   the live list at POSTERS_URL (default: POSTERS_URLS below, served by worker/poster_store.js from D1) · otherwise the repo's
   site/data/announcements.json (local builds). A 404 (a Worker that predates /api/posters) also falls back to the repo file.
   Anything else that is not a valid list stops the build, so a deploy never drops the posters. */
import fs from "node:fs";

export const POSTERS_URLS = ["https://hadadi.emah84.workers.dev/api/posters", "https://h-haddadi.com/api/posters"];

export function checkPosters(j) {
  if (!j || j.v !== 1 || !Array.isArray(j.posters)) throw new Error("posters: unexpected shape");
  return j.posters;   // each entry is checked again by setAnnouncements() in core.js
}

export async function loadPosters(file, env = process.env, fetcher = globalThis.fetch) {
  const repo = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  if (env.POSTERS_JSON) return checkPosters(JSON.parse(fs.readFileSync(env.POSTERS_JSON, "utf8")));
  if (env.WORKERS_CI !== "1" && !env.POSTERS_URL) return repo();
  const errors = [];
  for (const url of env.POSTERS_URL ? [env.POSTERS_URL] : POSTERS_URLS) {
    let r = null, last;
    for (let i = 0; i < 3; i++) {
      try { r = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }); if (r.status < 500) break; last = "HTTP " + r.status; }
      catch (e) { last = e.message; r = null; }
      if (i < 2) await new Promise(ok => setTimeout(ok, (env.POSTERS_RETRY_MS ?? 2000) * (i + 1)));
    }
    if (!r || r.status >= 500) { errors.push(`${url}: ${last}`); continue; }
    if (r.status === 404) { console.log("posters: /api/posters not deployed yet, using the repo file"); return repo(); }
    if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) { errors.push(`${url}: answered ${r.status} ${r.headers.get("content-type") || ""}`); continue; }
    const list = checkPosters(await r.json());
    console.log(`posters: ${list.length} from ${url}`);
    return list;
  }
  throw new Error("posters unavailable, stopping the build so the site keeps its posters: " + errors.join("; "));
}
