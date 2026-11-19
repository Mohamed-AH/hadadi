/* Phase B3: audio upload (browser -> this Worker -> R2 multipart, 8 MiB parts; the Worker never holds a whole file), then one call
   attaches the file to a Telegram lesson or adds a new lesson to a series. Ported from Mohamed-AH/drwasiullah admin/src/upload.mjs.
   Keys are content-addressed like tools/fetch_audio.py: audio/<sha256[:16]>.<ext>, so a file uploaded twice is stored once. */
import { auditStmt } from "./audit.mjs";

export const MEDIA_BASE = "https://media.h-haddadi.com";
export const KEY = /^audio\/[0-9a-f]{16}\.(mp3|m4a)$/;
const MAX_FILE = 200 * 1024 * 1024, MAX_PART = 16 * 1024 * 1024;
const TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4" };
export const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (status, error) => json({ error }, status);
async function body(request, max = 64 * 1024) {
  if (+request.headers.get("content-length") > max) throw Object.assign(new Error("الطلب كبير"), { status: 413 });
  try { return await request.json(); } catch { throw Object.assign(new Error("طلب غير صالح"), { status: 400 }); }
}

/* the first bytes must look like the claimed type: mp3 (ID3 tag or MPEG frame sync), m4a (an ftyp box) */
export function sniff(bytes, ext) {
  if (ext === "mp3") return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

/* /api/upload/{start,part,complete,abort} — the caller has checked content.edit and the same-origin rule */
export async function handleUpload(request, env, user, path, url) {
  const R2 = env.MEDIA;
  if (!R2) return fail(503, "مخزن الصوت غير مربوط");
  try {
    if (path === "/api/upload/start" && request.method === "POST") {
      const b = await body(request);
      const ext = String(b.ext).toLowerCase(), size = Number(b.size), sha = String(b.sha256 || "");
      if (!TYPES[ext] || !Number.isInteger(size) || size < 1 || size > MAX_FILE || !/^[0-9a-f]{64}$/.test(sha)) return fail(400, "ملف غير صالح (mp3 أو m4a حتى ٢٠٠ ميغابايت)");
      const key = `audio/${sha.slice(0, 16)}.${ext}`;
      const have = await R2.head(key);
      if (have && have.size === size) return json({ exists: true, key });
      if (have) return fail(409, "يوجد ملف مختلف بالبصمة نفسها؛ لن يُستبدل");        // never overwrite an existing object
      const mp = await R2.createMultipartUpload(key, { httpMetadata: { contentType: TYPES[ext], cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { sha256: sha } });
      return json({ key, uploadId: mp.uploadId });
    }
    if (path === "/api/upload/part" && request.method === "PUT") {
      const key = url.searchParams.get("key") || "", uploadId = url.searchParams.get("uploadId") || "", n = parseInt(url.searchParams.get("n") || "", 10);
      const len = +request.headers.get("content-length");
      if (!KEY.test(key) || !uploadId || uploadId.length > 600 || !(n >= 1 && n <= 10000)) return fail(400, "طلب غير صالح");
      if (!len || len > MAX_PART) return fail(413, "حجم الجزء غير مقبول");
      const part = await R2.resumeMultipartUpload(key, uploadId).uploadPart(n, request.body);
      return json({ partNumber: part.partNumber, etag: part.etag });
    }
    if (path === "/api/upload/complete" && request.method === "POST") {
      const b = await body(request);
      const key = String(b.key), ext = key.split(".").pop();
      if (!KEY.test(key) || !b.uploadId || !Array.isArray(b.parts) || b.parts.length < 1 || b.parts.length > 10000) return fail(400, "طلب غير صالح");
      const obj = await R2.resumeMultipartUpload(key, String(b.uploadId)).complete(b.parts.map(p => ({ partNumber: +p.partNumber, etag: String(p.etag) })));
      const head = await R2.get(key, { range: { offset: 0, length: 12 } });
      const bytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array(0);
      if (!sniff(bytes, ext)) { await R2.delete(key); return fail(400, "محتوى الملف لا يطابق نوعه (mp3 / m4a)"); }
      return json({ key, size: obj.size });
    }
    if (path === "/api/upload/abort" && request.method === "POST") {
      const b = await body(request);
      if (KEY.test(String(b.key)) && b.uploadId) await R2.resumeMultipartUpload(String(b.key), String(b.uploadId)).abort().catch(() => {});
      return json({ ok: true });
    }
  } catch (e) {
    if (e.status) return fail(e.status, e.message);
    console.error("upload error:", e && e.stack || e);
    return fail(500, "تعذّر إكمال العملية");
  }
  return null;
}

const duration = d => Number.isInteger(d) && d > 0 && d < 86400 ? d : 0;
/* owner 2026-11-19: no heavy files. The page compresses to 48 kbps; a file it could not compress is accepted only when it is light
   already. 72 kbps leaves room for container overhead and a rounded duration. */
export const MAX_KBPS = 72;
const tooHeavy = (size, secs) => !secs || size * 8 / secs > MAX_KBPS * 1000;
const HEAVY = "الملف أثقل من المسموح (أكثر من ٧٢ كب/ث) أو مدته غير معروفة. ارفعه من Chrome أو Edge على الحاسوب ليُضغط تلقائيًا";
async function stored(env, key) {                                   // the file must really be in R2
  const o = KEY.test(key) && env.MEDIA ? await env.MEDIA.head(key) : null;
  return o ? o.size : 0;
}
/* Hijri y-m-d (Umm al-Qura) as the site writes it, plus the Gregorian day the browser computed; both or neither */
export function dates(hd, date) {
  if (!hd) return { hd: null, date: null };
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(hd));
  if (!m || +m[1] < 1300 || +m[1] > 1600 || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 30) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || isNaN(new Date(date))) return null;
  return { hd: `${+m[1]}-${+m[2]}-${+m[3]}`, date: String(date) };
}

/* POST /api/audio {lesson, key, duration}: the audio of a lesson from the published catalogue (replaces an earlier portal upload) */
export async function attachAudio(request, env, user, lib) {
  let b;
  try { b = await body(request); } catch (e) { return fail(e.status || 400, e.message); }
  const id = clean(b.lesson, 80), key = String(b.key || "");
  const l = lib.lessons.find(x => x.id === id);
  if (!l || !/^https:\/\/t\.me\//.test(l.tg || "")) return fail(400, "الدرس غير موجود");
  const size = await stored(env, key);
  if (!size) return fail(400, "لم يكتمل رفع الملف");
  if (tooHeavy(size, duration(b.duration))) return fail(400, HEAVY);
  const db = env.DB, before = await db.prepare("SELECT key, size, duration FROM audio WHERE lesson_id = ?").bind(id).first();
  const row = { key, size, duration: duration(b.duration) };
  await db.batch([
    db.prepare("INSERT INTO audio (lesson_id, tg, key, size, duration, by, at) VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(lesson_id) DO UPDATE SET key=excluded.key, size=excluded.size, duration=excluded.duration, by=excluded.by, at=excluded.at")
      .bind(id, l.tg, key, size, row.duration, user.email),
    auditStmt(db, user.email, "audio.add", "lesson", id, before, row),
  ]);
  return json({ ok: true, lesson: id });
}

/* POST /api/lessons {series, title, hd, date, key, duration}: a lesson that is not in the Telegram channels */
export async function addLesson(request, env, user, lib) {
  let b;
  try { b = await body(request); } catch (e) { return fail(e.status || 400, e.message); }
  const series = clean(b.series, 80), title = clean(b.title, 200), key = String(b.key || "");
  if (!lib.series.some(s => s.id === series)) return fail(400, "السلسلة غير موجودة");
  if (title.length < 3) return fail(400, "اكتب عنوان الدرس");
  const d = dates(b.hd, b.date);
  if (!d) return fail(400, "التاريخ الهجري غير صالح");
  const size = await stored(env, key);
  if (!size) return fail(400, "لم يكتمل رفع الملف");
  if (tooHeavy(size, duration(b.duration))) return fail(400, HEAVY);
  const db = env.DB, id = "p-" + [...crypto.getRandomValues(new Uint8Array(5))].map(x => x.toString(16).padStart(2, "0")).join("");
  const row = { series, title, ...d, key, size, duration: duration(b.duration) };
  await db.batch([
    db.prepare("INSERT INTO lessons_new (id, series_id, title, hd, date, key, size, duration, by) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, series, title, d.hd, d.date, key, size, row.duration, user.email),
    auditStmt(db, user.email, "lesson.add", "lesson", id, null, row),
  ]);
  return json({ ok: true, lesson: id });
}

/* form posts: take back a portal upload (the R2 file stays: keys are content-addressed and may be shared) */
export async function removeAudio(db, user, id) {
  const before = await db.prepare("SELECT lesson_id, tg, key, size, duration FROM audio WHERE lesson_id = ?").bind(id).first();
  if (!before) return false;
  await db.batch([db.prepare("DELETE FROM audio WHERE lesson_id = ?").bind(id), auditStmt(db, user.email, "audio.remove", "lesson", id, before, null)]);
  return true;
}
export async function removeLesson(db, user, id) {
  const before = await db.prepare("SELECT id, series_id, title, hd, date, key, size, duration FROM lessons_new WHERE id = ?").bind(id).first();
  if (!before) return false;
  await db.batch([db.prepare("DELETE FROM lessons_new WHERE id = ?").bind(id), auditStmt(db, user.email, "lesson.remove", "lesson", id, before, null)]);
  return true;
}
