/* The /contact/ page in a browser. Turnstile's script and /api/contact are stubbed (the cloud session can't reach Cloudflare's
   challenge host, and the local static server can't take POSTs). Build with a site key first:
   TURNSTILE_SITEKEY=1x00000000000000000000AA node scripts/build.mjs, serve dist/ on :8000, then node tests/contact_page_check.mjs */
import { chromium } from "playwright";
const BASE = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const STUB = `window.turnstile = { render(el, o) { window.__ts = o; el.textContent = "تحقق"; setTimeout(() => o.callback("tok"), 50); return 1; }, reset() { window.__resets = (window.__resets || 0) + 1; setTimeout(() => window.__ts.callback("tok2"), 50); } };`;
const browser = await chromium.launch();
for (const w of [1280, 375]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const posts = [];
  await page.route("https://challenges.cloudflare.com/**", r => r.fulfill({ contentType: "text/javascript", body: STUB }));
  await page.route("**/api/contact", async r => { const b = JSON.parse(r.request().postData()); posts.push(b);
    r.fulfill({ contentType: "application/json", body: JSON.stringify(b.body.includes("fail") ? { ok: false, error: "captcha" } : { ok: true }) }); });
  await page.goto(BASE + "/");
  ok(await page.locator("footer a.foot-cta[href='/contact/']").count() === 1, "footer button links to /contact/");
  ok(await page.locator("footer a[href='/contact/']").count() === 1, "contact linked once in the footer");
  ok(await page.locator("a[href^='mailto:']").count() === 0, "no mailto anywhere");
  await page.locator("footer a.foot-cta").click();
  await page.waitForURL("**/contact/");
  ok(await page.locator("h1").textContent() === "تواصل معنا", "client-side navigation renders the page");
  await page.waitForFunction(() => window.__ts);
  ok((await page.evaluate(() => window.__ts.sitekey)) === "1x00000000000000000000AA" && (await page.evaluate(() => window.__ts.language)) === "ar", "widget rendered with key + Arabic");
  await page.click("#cform-go");
  ok((await page.textContent("#cform-st")).includes("اكتب رسالتك"), "empty message refused in the browser");
  ok(posts.length === 0, "nothing posted for an empty message");
  await page.fill("#cf-body", "السلام عليكم ورحمة الله");
  await page.waitForTimeout(100);
  await page.click("#cform-go");
  await page.waitForFunction(() => document.querySelector("#cform-st").classList.contains("ok") && document.querySelector("#cform-st").textContent.includes("وصلت"));
  ok(posts.length === 1 && posts[0].body === "السلام عليكم ورحمة الله" && posts[0]["cf-turnstile-response"] === "tok" && posts[0].name === "", "posted JSON with token, anonymous");
  ok((await page.inputValue("#cf-body")) === "", "form cleared after sending");
  ok((await page.evaluate(() => window.__resets)) === 1, "widget reset for the next message");
  await page.waitForTimeout(100);
  await page.fill("#cf-body", "please fail this one");
  await page.click("#cform-go");
  await page.waitForFunction(() => document.querySelector("#cform-st").classList.contains("err"));
  ok((await page.textContent("#cform-st")).includes("التحقق"), "server error shown in Arabic");
  // no-JS result banners
  await page.goto(BASE + "/contact/?s=sent"); ok((await page.textContent("#cform-st")).includes("وصلت"), "?s=sent banner");
  await page.goto(BASE + "/contact/?s=<script>"); ok((await page.textContent("#cform-st")) === "", "unknown ?s= ignored");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${w}px`);
  ok(errors.length === 0, "no page errors: " + errors.join("; "));
  await page.close();
}
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
