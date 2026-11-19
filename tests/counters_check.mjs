// Listening counters in the browser (site/js/app.js track()): one «play» after 30 s of real listening (not on first press, not
// twice for the same lesson), one «download» per download click, body = {id, e} only. Needs the player build:
//   MEDIA_JSON=tests/fixtures/media.json node scripts/build.mjs && (cd dist && python3 -m http.server 8000) &
//   node tests/counters_check.mjs http://localhost:8000
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const B = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const dir = fs.mkdtempSync("/tmp/claude-counters-");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=60", "-c:a", "libopus", "-b:a", "24k", `${dir}/t.ogg`]);
const TONE = fs.readFileSync(`${dir}/t.ogg`);
let ok = 0, bad = 0;
const t = (n, c, info = "") => c ? ok++ : (bad++, console.log("  FAIL:", n, info));
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route("https://media.test/**", r => r.fulfill({ status: 200, contentType: "audio/ogg", body: TONE }));
const events = [];
await ctx.route("**/api/event", r => { events.push({ body: r.request().postData(), type: r.request().headers()["content-type"] }); r.fulfill({ status: 204 }); });
await ctx.route("**/dl/**", r => r.fulfill({ status: 200, contentType: "audio/mp4", body: "x" }));
const p = await ctx.newPage(), errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto(B + "/lesson/h_haddadi7-1241/"); await p.waitForTimeout(800);
await p.click("#lp-play"); await p.waitForTimeout(1500);
await p.evaluate(() => { document.getElementById("d-aud").playbackRate = 4; });
t("no event on the first seconds", events.length === 0, JSON.stringify(events));
await p.waitForFunction(() => document.getElementById("d-aud").currentTime > 34, null, { timeout: 30000 });
await p.waitForTimeout(500);
const plays = events.filter(e => /"play"/.test(e.body));
t("one play after 30 s of listening", plays.length === 1, JSON.stringify(events));
t("body is only the lesson id and event", plays[0] && plays[0].body === JSON.stringify({ id: "h_haddadi7-1241", e: "play" }), plays[0] && plays[0].body);
await p.evaluate(() => { const a = document.getElementById("d-aud"); a.currentTime = 2; });
await p.waitForFunction(() => document.getElementById("d-aud").currentTime > 40, null, { timeout: 30000 });
t("not counted twice for the same lesson", events.filter(e => /"play"/.test(e.body)).length === 1);
await p.evaluate(() => document.getElementById("d-aud").pause());
const before = events.length;
const dl = p.locator('a[download]').first();
await dl.evaluate(a => a.addEventListener("click", e => e.preventDefault(), { once: true }));   // keep the page; the counter listens in the capture phase
await dl.click(); await p.waitForTimeout(500);
t("download click counted", events.slice(before).some(e => e.body === JSON.stringify({ id: "h_haddadi7-1241", e: "download" })), JSON.stringify(events));
t("no page errors", !errs.length, errs.join(" | "));
await b.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
