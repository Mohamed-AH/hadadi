/* The upload forms in a real browser (Chromium): admin.h-haddadi.com is answered by the real Worker entry through page.route, with
   SQLite for D1 and an in-memory R2. Checks the client script end to end: the weight limit, hash, 2-part upload, attach, add a lesson with a Hijri
   date, the redirect and flash, no console errors, axe on the forms.   node --no-warnings tests/portal_browser.mjs */
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import crypto from "node:crypto";
import worker from "../worker/index.js";
import { forgetJwks } from "../worker/admin/auth.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const sql = new DatabaseSync(":memory:");
for (const f of ["0001_messages.sql", "0002_admin.sql", "0003_content.sql"]) sql.exec(fs.readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
const stmt = (q, a = []) => ({ bind: (...b) => stmt(q, b), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }),
  run: async () => { const r = sql.prepare(q).run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }, _run() { return sql.prepare(q).run(...a); } });
const DB = { prepare: q => stmt(q), batch: async list => { sql.exec("BEGIN"); try { for (const s of list) s._run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } return []; } };
sql.exec("INSERT INTO users (email, role) VALUES ('ed@x.org','editor')");
const objects = new Map(), uploads = new Map();
const MEDIA = {
  head: async k => objects.has(k) ? { size: objects.get(k).length } : null,
  get: async (k, o) => { const b = objects.get(k); if (!b) return null; const s = b.subarray(o.range.offset, o.range.offset + o.range.length); return { arrayBuffer: async () => s.buffer.slice(s.byteOffset, s.byteOffset + s.length) }; },
  delete: async k => { objects.delete(k); },
  createMultipartUpload: async k => { const id = "up" + Math.random(); uploads.set(id, new Map()); return { uploadId: id }; },
  resumeMultipartUpload: (k, id) => ({
    uploadPart: async (n, body) => { uploads.get(id).set(n, Buffer.from(await new Response(body).arrayBuffer())); return { partNumber: n, etag: "e" + n }; },
    complete: async parts => { const b = Buffer.concat(parts.map(p => uploads.get(id).get(p.partNumber))); objects.set(k, b); return { size: b.length }; },
    abort: async () => {},
  }),
};
const TEAM = "team.cloudflareaccess.com", AUD = "aud";
const kp = await crypto.webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.webcrypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const b64u = b => Buffer.from(b).toString("base64url");
const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify({ email: "ed@x.org", aud: [AUD], iss: "https://" + TEAM, exp: Date.now() / 1000 + 3600 }));
const JWT = `${h}.${p}.${b64u(await crypto.webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)))}`;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => String(u) === `https://${TEAM}/cdn-cgi/access/certs` ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(u, i);
forgetJwks();
const LIB = { updated: "2026-11-19", series: [{ id: "khutab", title: "خطب الجمعة والعيدين", sec: "khutab" }],
  lessons: [{ id: "h_haddadi7-1", title: "خطبة أولى", series: "khutab", kind: "audio", src: "", tg: "https://t.me/h_haddadi7/1", date: "2026-11-06", duration: 0 }] };
const ASSETS = { fetch: async r => new URL(r.url).pathname === "/data/library.json" ? new Response(JSON.stringify(LIB)) : new Response("x", { status: 404 }) };
const env = { DB, ASSETS, MEDIA, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DEPLOY_HOOK: "" };

/* a short real m4a (ffmpeg) padded past 8 MiB with a trailing free box, so the upload takes two parts and the browser reads a duration */
const dir = fs.mkdtempSync("/tmp/claude-portal-");
const { execFileSync } = await import("node:child_process");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=65", "-ac", "1", "-b:a", "48k", "-movflags", "+faststart", `${dir}/a.m4a`]);
const pad = 9 * 1048576, raw = fs.readFileSync(`${dir}/a.m4a`), free = Buffer.alloc(pad); free.writeUInt32BE(pad, 0); free.write("free", 4, "latin1");
fs.writeFileSync(`${dir}/big.m4a`, Buffer.concat([raw, free]));
fs.copyFileSync(`${dir}/a.m4a`, `${dir}/small.m4a`);
/* an optimised long lesson: 26 min mono 48 kbps, about 9 MB, so the upload takes two 8 MiB parts */
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=1560:c=pink:a=0.2", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", `${dir}/long.m4a`]);

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: scheme === "dark" ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("https://admin.h-haddadi.com/**", async route => {
    const rq = route.request(), headers = { ...rq.headers(), "cf-access-jwt-assertion": JWT };
    const body = ["POST", "PUT"].includes(rq.method()) ? rq.postDataBuffer() : undefined;
    if (body) headers["content-length"] = String(body.length);
    const r = await worker.fetch(new Request(rq.url(), { method: rq.method(), headers, body, redirect: "manual" }), env);
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
  if (scheme === "light") {
    await page.goto("https://admin.h-haddadi.com/admin/lessons/h_haddadi7-1/audio");
    /* a heavy file (9 MB for 65 s) is refused before anything is sent */
    await page.setInputFiles("#file", `${dir}/big.m4a`);
    await page.waitForFunction(() => /دقيقة/.test(document.getElementById("note").textContent), null, { timeout: 10000 });
    ok(/١ دقيقة/.test(await page.textContent("#note")), "duration read in the browser");
    ok(!(await page.isHidden("#msg")) && /أداة تحسين الصوت/.test(await page.textContent("#msg")), "heavy file flagged as soon as it is chosen");
    await page.click("#go"); await page.waitForTimeout(500);
    ok(objects.size === 0 && !sql.prepare("SELECT 1 FROM audio").get() && page.url().endsWith("/audio"), "heavy file not uploaded");
    /* an optimised 26-minute lesson goes up in two parts */
    await page.setInputFiles("#file", `${dir}/long.m4a`);
    await page.waitForFunction(() => /٢٦ دقيقة/.test(document.getElementById("note").textContent), null, { timeout: 10000 });
    ok(await page.isHidden("#msg"), "light file: no warning");
    await Promise.all([page.waitForURL(/\/admin\/series\/khutab\?ok=audio_added/, { timeout: 60000 }), page.click("#go")]);
    ok((await page.textContent(".flash.ok")).includes("تم رفع الصوت"), "redirected with the success message");
    const row = sql.prepare("SELECT * FROM audio").get();
    ok(row && objects.get(row.key)?.equals(fs.readFileSync(`${dir}/long.m4a`)) && Math.abs(row.duration - 1560) <= 1, "file stored byte for byte, duration saved");
    await page.goto("https://admin.h-haddadi.com/admin/series/khutab/new");
    await page.click("#go");
    ok(!(await page.isHidden("#msg")) || (await page.evaluate(() => !document.getElementById("title").validity.valid)), "empty form refused");
    await page.fill("#title", "محاضرة مضافة");
    await page.fill("#hd-d", "28"); await page.fill("#hd-m", "5"); await page.fill("#hd-y", "1448");
    await page.setInputFiles("#file", `${dir}/small.m4a`);
    await page.waitForFunction(() => /دقيقة/.test(document.getElementById("note").textContent));
    await Promise.all([page.waitForURL(/ok=lesson_added/, { timeout: 30000 }), page.click("#go")]);
    const l = sql.prepare("SELECT * FROM lessons_new").get();
    ok(l && l.title === "محاضرة مضافة" && l.hd === "1448-5-28" && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && l.duration === 65, "lesson added with Hijri and Gregorian dates");
    ok(l && new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", timeZone: "Asia/Riyadh" }).format(new Date(l.date + "T12:00:00+03:00")) === "28", "Gregorian day matches the Hijri day");
    ok((await page.content()).includes("محاضرة مضافة"), "new lesson listed on the series page");
  }
  /* axe on the forms and the series page */
  const axe = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
  for (const u of ["/admin/series/khutab/new", "/admin/lessons/h_haddadi7-1/audio", "/admin/series/khutab", "/admin/publish"]) {
    await page.goto("https://admin.h-haddadi.com" + u);
    await page.evaluate(axe);
    const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"] })).violations.map(x => x.id + ": " + x.nodes.length));
    ok(!v.length, `axe ${scheme} ${u}: ${v.join(", ")}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 ? "" : [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().left < -1 || e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => e.tagName + "." + e.className + "#" + e.id).join(" "));
    ok(!wide, `no horizontal scroll ${scheme} ${u}: ${wide}`);
  }
  ok(!errors.length, `no console errors (${scheme}): ${errors.join(" | ")}`);
  await ctx.close();
}
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
