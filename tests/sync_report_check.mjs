/* POST /api/sync-report (worker/sync_report.js) with a fake send_email binding. No server needed. node tests/sync_report_check.mjs */
import { syncReport, sameToken, clean } from "../worker/sync_report.js";
import worker from "../worker/index.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
class Email { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
const dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\r\n/g, "")), c => c.charCodeAt(0)));
const env = (o = {}) => { const sent = []; return { sent, env: { SYNC_TOKEN: "tok-123456", MAIL_TO: "team@example.org", MAIL: { send: async m => { if (o.mailFails) throw new Error("down"); sent.push(m); } }, ...o.env } }; };
const req = (body, { token = "tok-123456", method = "POST" } = {}) => new Request("https://h-haddadi.com/api/sync-report", { method,
  headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body) });
const rep = { lessons: ["خطبة الجمعة: <b>x</b> (h_haddadi7-1400)"], audio: ["a"], videos: [], held: ["h_haddadi7-1401: forwarded from X"], errors: [], run: "https://github.com/Mohamed-AH/hadadi/actions/runs/123" };

{ const { env: e, sent } = env(); const r = await syncReport(req(rep), e, { Email });
  ok(r.status === 200 && sent.length === 1, "sent"); const m = sent[0];
  ok(m.to === "team@example.org" && m.from === "noreply@h-haddadi.com", "from/to");
  const parts = m.raw.split(/--b-[^\r\n]*\r\n/).slice(1).map(p => p.split("\r\n\r\n")[1]).filter(Boolean).map(b => dec(b.replace(/\r\n--b-.*$/s, "").trim()));
  ok(parts[0].includes("دروس جديدة نُشرت (1)") && parts[0].includes("h_haddadi7-1401"), "text part");
  ok(parts[1].includes("&lt;b&gt;x&lt;/b&gt;") && !parts[1].includes("<b>x</b>"), "html escaped");
  ok(parts[1].includes("actions/runs/123"), "run link"); ok(/Subject: =\?UTF-8\?B\?/.test(m.raw), "encoded subject"); }
{ const { env: e, sent } = env(); const r = await syncReport(req(rep, { token: "wrong-1234" }), e, { Email }); ok(r.status === 403 && !sent.length, "wrong token"); }
{ const { env: e, sent } = env(); const r = await syncReport(req(rep, { token: "" }), e, { Email }); ok(r.status === 403 && !sent.length, "no token"); }
{ const { env: e, sent } = env({ env: { SYNC_TOKEN: "" } }); const r = await syncReport(req(rep, { token: "" }), e, { Email }); ok(r.status === 403 && !sent.length, "no secret set = closed"); }
{ const { env: e } = env(); const r = await syncReport(req(rep, { method: "GET" }), e, { Email }); ok(r.status === 405, "GET 405"); }
{ const { env: e } = env({ mailFails: true }); const r = await syncReport(req(rep), e, { Email }); ok(r.status === 502, "mail failure 502"); }
ok(!sameToken("abc", "abd") && sameToken("abc", "abc") && !sameToken("", ""), "sameToken");
{ const c = clean({ lessons: ["a", 5, { x: 1 }], run: "javascript:alert(1)", errors: ["x".repeat(900)] }); ok(c.lessons.length === 1 && c.run === "" && c.errors[0].length === 400 && c.held.length === 0, "clean"); }
{ const { env: e, sent } = env(); const r = await worker.fetch(req(rep), { ...e, ASSETS: { fetch: () => new Response("asset") } });
  ok(r.status === 502 && sent.length === 0, "routed through the worker (no cloudflare:email in node -> 502)"); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
