/* Where the announcement posters live: Cloudflare only (no GitHub token, nothing for the team to set up there).
     the list   D1 table `posters`, one row holding the whole list as JSON (the order is the site's order) with a version
                number, so two admins pressing buttons at once never overwrite each other (the later write is retried);
     pictures   R2 (the MEDIA bucket) as ann/<sha16>.<ext> and a smaller preview ann/thumb/<sha16>.jpg, served by the Worker
                at /ann/... (worker/index.js);
     the site   GET /api/posters gives the published posters to the build (scripts/posters.mjs). A change that visitors would
                see (publish, edit, move, delete, an end date passing) calls the Workers Builds deploy hook (secret DEPLOY_HOOK),
                so the site is rebuilt within about two minutes. Without the hook, it shows on the next build. */
import { today } from "./posters.js";

const ENSURE = ["CREATE TABLE IF NOT EXISTS posters (k INTEGER PRIMARY KEY CHECK (k = 1), list TEXT NOT NULL, ver INTEGER NOT NULL)",
  "INSERT OR IGNORE INTO posters (k, list, ver) VALUES (1, '[]', 0)"];
const HOOK = /^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[\w-]{8,}$/;
export const IMAGE = /^\/ann\/[0-9a-f]{16}\.(jpg|png|webp)$/, THUMB = /^\/ann\/thumb\/[0-9a-f]{16}\.jpg$/;

/* exactly what the site gets: published posters whose end date has not passed, public fields only */
export function publicList(list, day = today()) {
  return list.filter(a => !a.draft && IMAGE.test(a.image || "") && (!a.until || a.until >= day)).map(a => ({ id: a.id, title: a.title, image: a.image,
    ...(THUMB.test(a.thumb || "") ? { thumb: a.thumb } : {}), w: a.w, h: a.h, until: a.until || "", added: a.added || "", ...(a.pin ? { pin: true } : {}) }));
}

/* the pictures no remaining poster uses (to delete from R2) */
const pictures = l => new Set(l.flatMap(a => [a.image, a.thumb]).filter(Boolean));
export const unused = (before, after) => [...pictures(before)].filter(p => !pictures(after).has(p));

export async function deploy(env, fetcher = fetch) {
  const hook = String(env.DEPLOY_HOOK || "");
  if (!HOOK.test(hook)) { console.log("posters: no DEPLOY_HOOK, the change shows on the next build"); return false; }
  try {
    const r = await fetcher(hook, { method: "POST", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("deploy hook " + r.status);
    return true;
  } catch (e) { console.log("posters: " + e.message); return false; }
}

export function store(env, { fetcher = fetch, day = today() } = {}) {
  const db = env.DB;
  let ready = null;
  const ensure = () => ready || (ready = db.batch(ENSURE.map(s => db.prepare(s))));
  const read = async () => { await ensure(); const r = await db.prepare("SELECT list, ver FROM posters WHERE k = 1").first(); return { list: JSON.parse(r.list), ver: r.ver }; };
  return {
    async read() { return (await read()).list; },
    /* change(list) -> { list, message? } or null (nothing to save). Expired posters are dropped with any write. Returns the
       saved result (with .deployed) or null. */
    async update(change) {
      for (let n = 0; n < 4; n++) {
        const { list, ver } = await read();
        const res = change(list);
        if (!res) return null;
        const next = res.list.filter(a => a.draft || !a.until || a.until >= day);
        const r = await db.prepare("UPDATE posters SET list = ?, ver = ver + 1 WHERE k = 1 AND ver = ?").bind(JSON.stringify(next), ver).run();
        if (!r.meta || r.meta.changes !== 1) continue;                     // someone else wrote meanwhile: read again
        const gone = unused(list, next);
        if (gone.length && env.MEDIA) await env.MEDIA.delete(gone.map(p => p.slice(1))).catch(e => console.log("posters: delete " + e.message));
        const seen = JSON.stringify(publicList(list, day)) !== JSON.stringify(publicList(next, day));
        return { ...res, list: next, deployed: seen ? await deploy(env, fetcher) : false };
      }
      throw new Error("القائمة تتغير الآن، حاول مرة أخرى");
    },
  };
}

/* ---- pictures: Telegram file -> R2 ---- */
const sniff = b => b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "png"
  : String.fromCharCode(...b.slice(8, 12)) === "WEBP" ? "webp" : "";
const TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/* [w, h] of a JPEG, PNG or WebP, or [0, 0] */
export function size(b) {
  const be16 = i => (b[i] << 8) | b[i + 1], be32 = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3], le16 = i => b[i] | (b[i + 1] << 8);
  const t = sniff(b);
  if (t === "png") return [be32(16), be32(20)];
  if (t === "jpg") {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i += mk === 0xff ? 1 : 2; continue; }
      if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [be16(i + 7), be16(i + 5)];
      i += 2 + be16(i + 2);
    }
  }
  if (t === "webp") {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === "VP8 ") return [le16(26) & 0x3fff, le16(28) & 0x3fff];
    if (kind === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1]; }
    if (kind === "VP8X") return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  }
  return [0, 0];
}

const hex16 = async b => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b)).slice(0, 8)].map(x => x.toString(16).padStart(2, "0")).join("");

/* download a Telegram file (getFile, at most 20 MB there; we take 10) */
async function download(tg, env, fetcher, file_id, max) {
  const f = await tg("getFile", { file_id });
  if (f.file_size && f.file_size > max) throw new Error("الصورة أكبر من ١٠ ميغابايت");
  const r = await fetcher(`${env.TELEGRAM_API || "https://api.telegram.org"}/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error("تعذّر تنزيل الصورة من تيليجرام (" + r.status + ")");
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > max) throw new Error("الصورة أكبر من ١٠ ميغابايت");
  return b;
}

/* the poster's picture and its preview -> R2. big/small are Telegram file ids (small: a ~320-800 px size, or "").
   -> { image, thumb, w, h } */
export async function savePicture(tg, env, { big, small }, { fetcher = fetch, max = 10e6 } = {}) {
  const b = await download(tg, env, fetcher, big, max), ext = sniff(b);
  if (!ext) throw new Error("هذا الملف ليس صورة JPEG أو PNG أو WebP");
  const [w, h] = size(b), id = await hex16(b), image = `/ann/${id}.${ext}`;
  const opts = { httpMetadata: { contentType: TYPE[ext], cacheControl: "public, max-age=31536000, immutable" } };
  await env.MEDIA.put(image.slice(1), b, opts);
  let thumb = "";
  if (small && small !== big) {
    try {
      const s = await download(tg, env, fetcher, small, 2e6);
      if (sniff(s) === "jpg") { thumb = `/ann/thumb/${id}.jpg`; await env.MEDIA.put(thumb.slice(1), s, { httpMetadata: { ...opts.httpMetadata, contentType: "image/jpeg" } }); }
    } catch (e) { console.log("posters: no preview: " + e.message); thumb = ""; }
  }
  return { image, thumb, w: w || 1131, h: h || 1600 };
}

/* GET /ann/<file> from R2 (immutable: the name is the content's hash) */
export async function annFile(req, env) {
  const p = new URL(req.url).pathname;
  if (!IMAGE.test(p) && !THUMB.test(p)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const obj = env.MEDIA && await env.MEDIA.get(p.slice(1));
  if (!obj) return null;
  const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[p.split(".").pop()];
  return new Response(req.method === "HEAD" ? null : obj.body, { headers: { "content-type": type, "content-length": String(obj.size),
    "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}

/* GET /api/posters: the published list for the build (public: it is what the site shows anyway). 503 on a database error,
   so a build stops instead of dropping the posters. */
export async function postersApi(env, day = today()) {
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (!env.DB) return new Response('{"error":"no database"}', { status: 503, headers: h });
  try { return new Response(JSON.stringify({ v: 1, posters: publicList(await store(env, { day }).read(), day) }), { headers: h }); }
  catch (e) { console.log("posters api: " + (e && e.message)); return new Response('{"error":"database"}', { status: 503, headers: h }); }
}

/* the daily timer (just after midnight Riyadh): a poster whose end date passed yesterday leaves the site */
export async function expire(env, { fetcher = fetch, day = today() } = {}) {
  if (!env.DB) return false;
  const s = store(env, { fetcher, day });
  const res = await s.update(list => list.some(a => a.until && a.until < day && !a.draft) ? { list } : null);   // update() drops them
  if (res) await deploy(env, fetcher);   // the built pages still show them: rebuild
  return !!res;
}
