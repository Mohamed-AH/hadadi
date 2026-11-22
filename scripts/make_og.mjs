#!/usr/bin/env node
/* Renders site/og/default.png (1200×630, the picture shown when a link is shared) from the site's own fonts. Dev tool: needs Playwright.
   Usage: node scripts/make_og.mjs */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { STAR, LOGO } from "../site/js/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fonts = pathToFileURL(path.join(ROOT, "site", "fonts")).href;
const pattern = (c, o) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='54' height='54' viewBox='0 0 36 36'%3E%3Cg fill='none' stroke='%23${c}' stroke-opacity='${o}' stroke-width='1'%3E%3Cpath d='M0 0L36 36M36 0L0 36M18 0L0 18L18 36L36 18Z'/%3E%3Ccircle cx='18' cy='18' r='2.2'/%3E%3C/g%3E%3C/svg%3E")`;
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Tajawal;font-weight:400;src:url(${fonts}/el-messiri-arabic-500-normal.woff2)}
@font-face{font-family:Tajawal;font-weight:700;src:url(${fonts}/el-messiri-arabic-700-normal.woff2)}
@font-face{font-family:Kufi;font-weight:700;src:url(${fonts}/reem-kufi-arabic-700-normal.woff2)}
@font-face{font-family:Amiri;font-weight:700;src:url(${fonts}/aref-ruqaa-arabic-700-subset.woff2)}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;direction:rtl;position:relative;overflow:hidden;color:#f6ead8;font-family:Tajawal;
 background:${pattern("e0b48a", .1)},#3a2a1e;background-size:84px}
.mark{position:absolute;top:58px;right:96px;width:94px;height:130px;color:#e0b48a}
.pre{position:absolute;top:204px;right:96px;font:700 36px Tajawal;color:#e0b48a}
h1{position:absolute;top:256px;right:96px;margin:0;font:700 70px/1.3 Amiri}
.dua{position:absolute;top:406px;right:96px;font:400 40px Tajawal;color:#dcc9b0}
.sub{position:absolute;bottom:70px;right:96px;font:400 30px Tajawal;color:#f6ead8}
.sub b{color:#e0b48a;font-weight:700}
.art{position:absolute;left:60px;top:170px;width:270px;height:290px;border-radius:46% 46% 18px 18px / 26% 26% 18px 18px;background:${pattern("ffffff", .12)},#1f5f5b;background-size:84px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);transform:rotate(-4deg)}
.art2{left:105px;top:150px;background-color:#8a4a22;transform:rotate(5deg)}
.art3{left:80px;top:175px;background-color:#2f4f6b;transform:none}
.art svg{position:absolute;top:34px;right:122px;width:56px;height:56px;color:#e0b48a}
.art span{position:absolute;bottom:34px;right:34px;left:34px;font:700 38px/1.35 Kufi;color:#fff}
</style>
<div class="art art2"></div><div class="art"></div><div class="art art3">${STAR}<span>شرح كتاب التوحيد</span></div>
<div class="mark">${LOGO}</div>
<div class="pre">الموقع الرسمي لفضيلة الشيخ</div>
<h1>حسن بن علي بن حسن حدادي</h1><div class="dua">حفظه الله ورعاه</div>
<div class="sub"><b>دروس</b> · محاضرات · خطب · للاستماع والتحميل</div>`;
const tmp = path.join(os.tmpdir(), "og-default.html");
fs.writeFileSync(tmp, html);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(tmp).href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
fs.mkdirSync(path.join(ROOT, "site", "og"), { recursive: true });
await page.screenshot({ path: path.join(ROOT, "site", "og", "default.png") });
await browser.close(); console.log("wrote site/og/default.png");
