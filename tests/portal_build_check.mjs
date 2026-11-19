/* The build merges a portal snapshot (tests/fixtures/portal.json): the Telegram-only lesson h_haddadi7-14 gets hosted audio and the
   added lesson p-00aa11bb22 gets its own page. Rebuilds without the fixture at the end.   node tests/portal_build_check.mjs */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const build = env => execFileSync(process.execPath, ["scripts/build.mjs"], { env: { ...process.env, ...env }, encoding: "utf8" });
try {
  const out = build({ PORTAL_JSON: "tests/fixtures/portal.json" });
  ok(/portal: publish #7 .*1 audio, 1 added lessons/.test(out), "build log names the publish");
  const lib = JSON.parse(fs.readFileSync("dist/data/library.json", "utf8")), by = Object.fromEntries(lib.lessons.map(l => [l.id, l]));
  ok(by["h_haddadi7-14"].src === "https://media.h-haddadi.com/audio/0123456789abcdef.m4a" && by["h_haddadi7-14"].duration === 1234, "Telegram lesson gets the portal audio");
  ok(by["p-00aa11bb22"] && by["p-00aa11bb22"].hd === "1448-5-28", "added lesson in the library");
  const page = fs.readFileSync("dist/lesson/p-00aa11bb22/index.html", "utf8");
  ok(page.includes("درس مضاف من اللوحة") && page.includes('id="lp"') && page.includes("/dl/fedcba9876543210"), "added lesson page with player and download");
  const tg = fs.readFileSync("dist/lesson/h_haddadi7-14/index.html", "utf8");
  ok(tg.includes('id="lp"') && !tg.includes("tg-listen"), "Telegram-only lesson now has the player");
  ok(fs.readFileSync("dist/sitemap.xml", "utf8").includes("/lesson/p-00aa11bb22/"), "added lesson in the sitemap");
} finally { build({}); }
const plain = JSON.parse(fs.readFileSync("dist/data/library.json", "utf8"));
ok(!plain.lessons.some(l => l.id === "p-00aa11bb22"), "plain rebuild has no fixture lesson");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
