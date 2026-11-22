#!/usr/bin/env node
/* Renders the logo SVGs in brand/ to PNG (for places that don't take SVG: WhatsApp, Telegram, print shops) and
   site/apple-touch-icon.png (180×180, the phone home-screen icon). Dev tool: needs Playwright.
   Usage: python3 tools/logo/make_logo.py && node tools/logo/render_png.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BRAND = path.join(ROOT, "brand");
const jobs = [
  ...["logo-gold", "logo-gold-site", "logo-dark-bg", "logo-all-gold", "mark-gold", "mark-brass", "mark-teak"].map(n => [`${n}.svg`, path.join(BRAND, `${n}.png`), 1600]),
  ["icon.svg", path.join(BRAND, "icon-512.png"), 512],
  ["icon-square.svg", path.join(ROOT, "site", "apple-touch-icon.png"), 180],
];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [src, out, size] of jobs) {
  const svg = fs.readFileSync(path.join(BRAND, src), "utf8");
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  const W = w >= h ? size : Math.round(size * w / h), H = w >= h ? Math.round(size * h / w) : size;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  console.log("wrote", path.relative(ROOT, out), `${W}×${H}`);
}
await browser.close();
