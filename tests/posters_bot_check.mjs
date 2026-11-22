// worker/bot.js + worker/poster_store.js (the announcements bot, all on Cloudflare) against a fake Telegram, SQLite as D1 and a
// fake R2: strangers are refused, the menu opens, a new picture is saved to R2 at once and becomes a hidden draft (title, end
// date, then publish), text and end date can be changed, posters move and are deleted (with their pictures), a schedule
// replaces the old one, writes are retried when the list changed meanwhile, the deploy hook is called only for changes
// visitors would see, /api/posters and /ann/* answer, the daily timer drops expired posters, and the webhook only accepts
// Telegram's secret.     Usage: node tests/posters_bot_check.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { handleUpdate, webhook } from "../worker/bot.js";
import { webhookSecret, move, parseDate } from "../worker/posters.js";
import { store, size, postersApi, annFile, expire, publicList } from "../worker/poster_store.js";
import { setAnnouncements, state } from "../site/js/core.js";
import { loadPosters } from "../scripts/posters.mjs";
import worker from "../worker/index.js";

let ok = 0, bad = 0; const t = (n, c, info = "") => c ? ok++ : (bad++, console.log("  FAIL:", n, info));

// SQLite standing in for D1 (as in tests/admin_check.mjs); `conflicts` makes the next UPDATEs lose a race
const sql = new DatabaseSync(":memory:");
let conflicts = 0;
const stmt = (q, a = []) => ({ bind: (...b) => stmt(q, b), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }),
  run: async () => { if (conflicts > 0 && /^UPDATE posters/.test(q)) { conflicts--; sql.exec("UPDATE posters SET ver = ver + 1"); } const r = sql.prepare(q).run(...a); return { meta: { changes: r.changes } }; },
  _run() { return sql.prepare(q).run(...a); } });
const DB = { prepare: q => stmt(q), batch: async list => { for (const s of list) s._run(); return []; } };
sql.exec(fs.readFileSync(new URL("../db/migrations/0004_posters.sql", import.meta.url), "utf8"));
const OLD = { id: "aaaaaaaaaaaa", title: "قديم", image: "/ann/aaaaaaaaaaaaaaaa.jpg", w: 10, h: 10, until: "", added: "2026-10-01" };
sql.prepare("UPDATE posters SET list = ? WHERE k = 1").run(JSON.stringify([OLD]));
const list = () => JSON.parse(sql.prepare("SELECT list FROM posters").get().list);

// fake R2
const r2 = new Map([["ann/aaaaaaaaaaaaaaaa.jpg", new Uint8Array([1])]]);
const MEDIA = { put: async (k, b) => { r2.set(k, b); }, get: async k => r2.has(k) ? { body: r2.get(k), size: r2.get(k).length } : null,
  delete: async ks => { for (const k of [].concat(ks)) r2.delete(k); } };

// fake Telegram (Bot API + file downloads) and deploy hook
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQAAsBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");   // 11×16
const PNG = (w, h, salt = 0) => { const b = Buffer.alloc(40); b.write("\x89PNG\r\n\x1a\n", 0, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[39] = salt; return b; };
const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abcdef123456";
const ADMIN = 111, STRANGER = 222, env = { TELEGRAM_BOT_TOKEN: "tok", BOT_ADMINS: String(ADMIN), DB, MEDIA, DEPLOY_HOOK: HOOK };
let sent = [], hooks = 0, files = {};
const fetcher = async (url, o = {}) => {
  const u = String(url);
  if (u === HOOK) { hooks++; return Response.json({ success: true }); }
  if (u.includes("/file/bottok/")) { const f = files[u.split("/").pop()]; return f ? new Response(f) : new Response("no", { status: 404 }); }
  const m = u.split("/").pop(), p = JSON.parse(o.body || "{}");
  if (m === "getFile") return Response.json({ ok: true, result: { file_id: p.file_id, file_size: (files[p.file_id] || []).length, file_path: "photos/" + p.file_id } });
  sent.push({ m, ...p });
  return Response.json({ ok: true, result: { message_id: 900 + sent.length } });
};
const DAY = "2026-11-12", deps = { fetcher, day: DAY };
let upd = 0;
const msg = (from, extra) => ({ update_id: ++upd, message: { message_id: upd * 10, from: { id: from }, chat: { id: from, type: "private" }, ...extra } });
const cb = (data, message = { message_id: 5, chat: { id: ADMIN }, photo: [{}] }) => ({ update_id: ++upd, callback_query: { id: "q" + upd, from: { id: ADMIN }, message, data } });
const run = async u => { sent = []; await handleUpdate(u, env, deps); return sent; };
const last = () => sent.filter(s => s.m === "sendMessage" || s.m === "sendPhoto").pop() || {};
const replyTo = text => ({ from: { is_bot: true }, text });

t("picture sizes: JPEG, PNG", size(JPEG).join() === "11,16" && size(PNG(800, 1131)).join() === "800,1131");

let s = await run(msg(STRANGER, { text: "/menu" }));
t("stranger refused and told their id", s.length === 1 && s[0].text.includes(String(STRANGER)) && list().length === 1);
s = await run(msg(ADMIN, { text: "/menu" }));
t("menu has list / add / help", JSON.stringify(s[0].reply_markup).includes('"l"') && JSON.stringify(s[0].reply_markup).includes('"a"'));

// a new poster: picture without caption -> picture and preview in R2 at once, a hidden draft at the top; asks for the title
files = { small: PNG(90, 128), mid: JPEG, BIG: PNG(1131, 1600, 1) };
s = await run(msg(ADMIN, { photo: [{ file_id: "small", width: 90, height: 128 }, { file_id: "mid", width: 480, height: 680 }, { file_id: "BIG", file_unique_id: "u1", file_size: 40, width: 1131, height: 1600 }] }));
let d = list()[0];
t("picture becomes a draft at the top", list().length === 2 && d.draft === true && d.file_id === "BIG" && /^[0-9a-f]{12}$/.test(d.id), JSON.stringify(d));
t("its picture is in R2, sized", /^\/ann\/[0-9a-f]{16}\.png$/.test(d.image) && r2.has(d.image.slice(1)) && d.w === 1131 && d.h === 1600, JSON.stringify(d));
t("the 480-px size is the preview", /^\/ann\/thumb\/[0-9a-f]{16}\.jpg$/.test(d.thumb) && r2.get(d.thumb.slice(1)).length === JPEG.length);
t("a draft does not rebuild the site", hooks === 0);
t("asks for the title", last().text.endsWith("#t-" + d.id) && last().reply_markup.force_reply === true);
setAnnouncements(publicList(list(), DAY), DAY);
t("a draft is not shown on the site", state.ann.length === 1 && state.ann[0].id === "aaaaaaaaaaaa");

s = await run(msg(ADMIN, { text: "دورة علمية‮ في جدة\nسطر", reply_to_message: replyTo("✏️ اكتب العنوان\n#t-" + d.id) }));
t("title saved, cleaned to one line", list()[0].title === "دورة علمية في جدة سطر", list()[0].title);
t("then asks for the end date", last().text.endsWith("#d-" + d.id));
s = await run(msg(ADMIN, { text: "١٤٤٧/١/١", reply_to_message: replyTo("📅\n#d-" + d.id) }));
t("a past date is refused", list()[0].until === "" && last().text.includes("مضى"));
s = await run(msg(ADMIN, { text: "١٤٤٨/٧/٢", reply_to_message: replyTo("📅\n#d-" + d.id) }));
t("Hijri end date saved", list()[0].until === "2026-12-11", list()[0].until);
t("draft card shown with publish buttons", last().m === "sendPhoto" && last().photo === "BIG" && JSON.stringify(last().reply_markup).includes("P:" + d.id));

s = await run(cb("B:" + d.id));
t("published at the bottom", !list()[1].draft && list()[1].id === d.id && list()[0].id === "aaaaaaaaaaaa", JSON.stringify(list().map(a => a.id)));
t("publishing rebuilds the site", hooks === 1 && last().text.includes("دقيقتين"));
setAnnouncements(publicList(list(), DAY), DAY);
t("site shows it in list order, with its preview", state.ann.map(a => a.id).join() === ["aaaaaaaaaaaa", d.id].join() && state.ann[1].thumb === d.thumb && state.ann[0].thumb === OLD.image);

s = await run(cb("u:" + d.id));
t("move up", list()[0].id === d.id && hooks === 2 && s.some(x => x.m === "editMessageCaption" && x.caption.includes("الموضع: ١ من ٢")));
s = await run(cb("u:" + d.id));
t("already first: nothing written", list()[0].id === d.id && hooks === 2 && s.some(x => x.m === "answerCallbackQuery" && x.text.includes("أصلًا")));

conflicts = 2;
s = await run(msg(ADMIN, { text: "عنوان جديد", reply_to_message: replyTo("✏️\n#t-" + d.id) }));
t("edit retried after conflicting writes", list()[0].title === "عنوان جديد" && conflicts === 0);
s = await run(msg(ADMIN, { text: "بدون", reply_to_message: replyTo("📅\n#d-" + d.id) }));
t("«بدون» clears the end date", list()[0].until === "");

s = await run(msg(ADMIN, { photo: [{ file_id: "BIG2", file_unique_id: "u1" }] }));
t("same picture again is noticed", list().length === 2 && sent.some(x => (x.text || "").includes("موجودة من قبل")));
files.BAD = Buffer.from("not an image at all");
s = await run(msg(ADMIN, { document: { file_id: "BAD", file_unique_id: "u9", mime_type: "image/jpeg" } }));
t("a file that is not a picture is refused", list().length === 2 && last().text.includes("ليس صورة"));

// a schedule poster (sent as a file, with its small thumbnail) replaces the old schedule when published
const arr = list(); arr[1].pin = true; sql.prepare("UPDATE posters SET list = ?").run(JSON.stringify(arr));
files.S = PNG(1000, 1400, 2); files.Sth = JPEG;
s = await run(msg(ADMIN, { document: { file_id: "S", file_unique_id: "u2", mime_type: "image/png", thumbnail: { file_id: "Sth" } }, caption: "جدول الدروس ١٤٤٨\nحتى ١٤٤٨/١٢/١" }));
const sc = list()[0];
t("caption gives title, date and schedule; card shown at once", sc.pin && sc.title === "جدول الدروس ١٤٤٨" && sc.until && sc.w === 1000 && sc.thumb && last().m === "sendPhoto");
const oldPic = "aaaaaaaaaaaaaaaa.jpg";
s = await run(cb("P:" + sc.id));
t("new schedule replaces the old one", list().length === 2 && list()[0].id === sc.id && !list().some(a => a.id === "aaaaaaaaaaaa") && last().text.includes("الجدول السابق"));
t("the old schedule's picture is deleted from R2", !r2.has("ann/" + oldPic));

s = await run(cb("x:" + d.id));
t("delete asks first", list().length === 2 && JSON.stringify(last().reply_markup).includes("X:" + d.id));
const h0 = hooks;
s = await run(cb("X:" + d.id));
t("delete removes it, its pictures, and rebuilds", list().length === 1 && list()[0].id === sc.id && !r2.has(d.image.slice(1)) && !r2.has(d.thumb.slice(1)) && hooks === h0 + 1);
s = await run(cb("v:" + d.id));
t("a deleted poster's buttons say so", s.some(x => x.m === "answerCallbackQuery" && x.show_alert));
s = await run({ update_id: ++upd, callback_query: { id: "z", from: { id: STRANGER }, message: { message_id: 1, chat: { id: STRANGER } }, data: "X:" + sc.id } });
t("a stranger's button press does nothing", list().length === 1 && s.length === 1 && s[0].m === "answerCallbackQuery");
s = await run(cb("l", { message_id: 1, chat: { id: ADMIN } }));
t("list shows the posters with buttons", last().text.includes("جدول الدروس ١٤٤٨") && JSON.stringify(last().reply_markup).includes("v:" + sc.id));

// without a deploy hook: saved all the same, and the admin is told it shows with the next update
const noHook = { ...env, DEPLOY_HOOK: "" };
sent = []; await handleUpdate(cb("X:" + sc.id), noHook, deps);
t("no hook: still saved, honest message", list().length === 0 && last().text.includes("التحديث القادم"));

// /api/posters, /ann/*, the daily timer
const pub = { id: "bbbbbbbbbbbb", title: "درس", image: "/ann/bbbbbbbbbbbbbbbb.jpg", w: 5, h: 7, until: "2026-11-12", added: DAY, file_id: "secret-ish", tg: { chat: 1, msg: 2 } };
const dr = { id: "cccccccccccc", title: "مسودة", image: "/ann/cccccccccccccccc.jpg", w: 5, h: 7, until: "", added: DAY, draft: true };
sql.prepare("UPDATE posters SET list = ?").run(JSON.stringify([dr, pub]));
let j = await (await postersApi(env, DAY)).json();
t("/api/posters: published only, public fields only", j.v === 1 && j.posters.length === 1 && j.posters[0].id === pub.id && !("file_id" in j.posters[0]) && !("tg" in j.posters[0]));
j = await (await postersApi(env, "2026-11-13")).json();
t("/api/posters: an expired poster is left out", j.posters.length === 0);
t("/api/posters without a database is 503", (await postersApi({})).status === 503);
r2.set("ann/bbbbbbbbbbbbbbbb.jpg", JPEG);
let r = await annFile(new Request("https://h-haddadi.com/ann/bbbbbbbbbbbbbbbb.jpg"), env);
t("/ann/ serves R2 with an immutable cache", r.status === 200 && r.headers.get("content-type") === "image/jpeg" && /immutable/.test(r.headers.get("cache-control")));
t("/ann/ ignores other names", (await annFile(new Request("https://h-haddadi.com/ann/../x.jpg"), env)) === null && (await annFile(new Request("https://h-haddadi.com/ann/dddddddddddddddd.jpg"), env)) === null);
const assets = { fetch: async () => new Response("asset") };
r = await worker.fetch(new Request("https://h-haddadi.com/ann/bbbbbbbbbbbbbbbb.jpg"), { ...env, ASSETS: assets });
t("the Worker routes /ann/ to R2", r.status === 200 && (await r.arrayBuffer()).byteLength === JPEG.length);
r = await worker.fetch(new Request("https://h-haddadi.com/ann/thumb/eeeeeeeeeeeeeeee.webp"), { ...env, ASSETS: assets });
t("a file not in R2 falls back to the site's assets", await r.text() === "asset");
const h1 = hooks;
t("timer: nothing expired, nothing done", !(await expire(env, { fetcher, day: DAY })) && hooks === h1);
t("timer: an expired poster is dropped and the site rebuilt", await expire(env, { fetcher, day: "2026-11-13" }) && list().length === 1 && list()[0].id === dr.id && hooks === h1 + 1 && !r2.has("ann/bbbbbbbbbbbbbbbb.jpg"));
t("store: ensure() creates the table on a new database", await (async () => { const s2 = new DatabaseSync(":memory:"); const d2 = { prepare: q => ({ bind: (...a) => ({ first: async () => s2.prepare(q).get(...a) }), first: async () => s2.prepare(q).get(), _run() { return s2.prepare(q).run(); } }), batch: async l => l.forEach(x => x._run()) }; return (await store({ DB: d2 }).read()).length === 0; })());

// the build's source of posters
const fake = (status, body, type = "application/json") => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
const CI = { WORKERS_CI: "1", POSTERS_RETRY_MS: 0 };
t("build: live list on Cloudflare", (await loadPosters("/nonexistent", CI, fake(200, { v: 1, posters: [pub] }))).length === 1);
t("build: 404 (older Worker) falls back to the repo file", (await loadPosters("/nonexistent", CI, fake(404, "Not found", "text/html"))).length === 0);
t("build: an outage stops the build", await loadPosters("/nonexistent", CI, fake(503, "{}")).then(() => false, e => /stopping the build/.test(e.message)));
t("build: a bad shape stops the build", await loadPosters("/nonexistent", CI, fake(200, { posters: "x" })).then(() => false, () => true));
t("build: local builds read the repo file", Array.isArray(await loadPosters(new URL("../site/data/announcements.json", import.meta.url), {})));

// webhook: only Telegram (with the derived secret) gets in
const req = (secret, body = { update_id: 1, message: { message_id: 1, from: { id: STRANGER }, chat: { id: STRANGER, type: "private" }, text: "x" } }, method = "POST") =>
  new Request("https://hadadi.emah84.workers.dev/bot", { method, headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {}, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
const sec = await webhookSecret("tok");
t("secret is stable and Telegram-safe", sec === await webhookSecret("tok") && /^[0-9a-f]{48}$/.test(sec));
t("no secret -> 403", (await webhook(req(""), env, deps)).status === 403);
t("wrong secret -> 403", (await webhook(req("x" + sec.slice(1)), env, deps)).status === 403);
t("GET -> 405", (await webhook(req(sec, null, "GET"), env, deps)).status === 405);
sent = [];
t("right secret -> 200 and handled", (await webhook(req(sec), env, deps)).status === 200 && sent.length === 1);
t("not configured -> 503", (await webhook(req(sec), { BOT_ADMINS: "1", TELEGRAM_BOT_TOKEN: "tok" }, deps)).status === 503);
t("helpers: move and dates", move([{ id: "a" }, { id: "b" }, { id: "c" }], "c", "top").map(x => x.id).join("") === "cab" && parseDate("2/7/1448") === "2026-12-11" && parseDate("x") === "");

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
