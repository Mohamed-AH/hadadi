/* Admin pages: dashboard, contact messages, series list, users, audit log (the content pages of phase B3 are in content_pages.mjs). */
import { esc, layout, num, stamp, hijriOf } from "./html.mjs";
import { ROLE_AR, can, manageable } from "./roles.mjs";
import { pending } from "./publish.mjs";

const all = (db, sql, ...a) => db.prepare(sql).bind(...a).all().then(r => r.results);
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const trunc = (s, n) => { s = String(s ?? "").replace(/\s+/g, " "); return s.length > n ? s.slice(0, n) + "…" : s; };
const region = (label, html) => `<div class="scroll" tabindex="0" role="region" aria-label="${label}">${html}</div>`;

/* the published catalogue, as visitors see it (the static asset the build wrote) */
export async function library(env) {
  const r = await env.ASSETS.fetch(new Request("https://h-haddadi.com/data/library.json"));
  if (!r.ok) throw new Error("library.json " + r.status);
  return r.json();
}

export const STATUS = ["new", "read", "answered", "archived"];
export const STATUS_AR = { new: "جديدة", read: "مقروءة", answered: "تم الرد", archived: "مؤرشفة" };
const tag = s => `<span class="tag tag-${esc(s)}">${esc(STATUS_AR[s] || s)}</span>`;

const auditTable = rows => region("آخر العمليات", `<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>العنصر</th></tr></thead><tbody>${
  rows.map(r => `<tr><td>${stamp(r.at)}</td><td class="ltr">${esc(r.actor)}</td><td>${esc(r.action)}</td><td class="ltr">${esc(r.entity)}${r.entity_id ? " · " + esc(r.entity_id) : ""}</td></tr>`).join("")}</tbody></table>`);

export async function dashboard(env, user) {
  const db = env.DB, lib = await library(env);
  const hosted = lib.lessons.filter(l => l.src).length;
  const msgs = can(user.role, "messages.view") ? await one(db, "SELECT SUM(status='new') n, COUNT(*) c FROM messages") : null;
  const recent = can(user.role, "audit.view") ? await all(db, "SELECT at, actor, action, entity, entity_id FROM audit_log ORDER BY id DESC LIMIT 8") : [];
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const plays = await one(db, "SELECT COALESCE(SUM(n),0) n FROM stats_daily WHERE event='play' AND day >= ?", since).catch(() => null);
  const waiting = can(user.role, "content.publish") ? await pending(db).catch(() => null) : null;
  const cards = [
    msgs && [msgs.n || 0, "رسالة جديدة", "/messages?status=new"],
    waiting && waiting.count && [waiting.count, "تغيير ينتظر النشر", "/publish"],
    plays && [plays.n, "استماع في آخر ٣٠ يومًا", "/series"],
    [lib.lessons.length, "درس منشور", "/series"], [hosted, "درس بصوت على الموقع", "/series"], [lib.series.length, "سلسلة", "/series"],
  ].filter(Boolean).map(([n, l, h]) => `<a class="card" href="/admin${h}"><b>${num(n)}</b><span>${l}</span></a>`).join("");
  return layout({ title: "الرئيسية", user, path: "/", body: `<div class="cards">${cards}</div>${recent.length ? `<h2>آخر العمليات</h2>${auditTable(recent)}` : ""}
<p class="muted">آخر تحديث للفهرس: ${esc(hijriOf("", String(lib.updated || "").slice(0, 10)))}. لرفع صوت درس أو إضافة درس افتح السلسلة من «السلاسل».</p>` });
}

/* ---- contact messages ---- */
const PER = 50;
export async function messagesList(db, user, params, flash) {
  const st = STATUS.includes(params.get("status")) ? params.get("status") : "";
  const p = Math.min(Math.max(parseInt(params.get("page") || "1", 10) || 1, 1), 1000);
  const counts = Object.fromEntries((await all(db, "SELECT status, COUNT(*) c FROM messages GROUP BY status")).map(r => [r.status, r.c]));
  const total = st ? counts[st] || 0 : Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = await all(db, `SELECT id, at, name, reply, body, status FROM messages ${st ? "WHERE status = ?" : "WHERE status != 'archived'"} ORDER BY id DESC LIMIT ? OFFSET ?`, ...(st ? [st] : []), PER, (p - 1) * PER);
  const filters = [["", "الكل (دون المؤرشفة)"], ...STATUS.map(s => [s, STATUS_AR[s]])].map(([s, t]) =>
    `<a href="/admin/messages${s ? "?status=" + s : ""}"${s === st ? ' aria-current="true"' : ""}>${t}${s ? ` (${num(counts[s] || 0)})` : ""}</a>`).join("");
  const list = rows.length ? region("الرسائل", `<table><thead><tr><th>الوقت</th><th>من</th><th>الرسالة</th><th>الحالة</th></tr></thead><tbody>${
    rows.map(r => `<tr${r.status === "new" ? ' class="unread"' : ""}><td>${stamp(r.at)}</td><td>${esc(r.name || "—")}${r.reply ? `<br><small class="ltr">${esc(r.reply)}</small>` : ""}</td><td><a href="/admin/messages/${r.id}">${esc(trunc(r.body, 90))}</a></td><td>${tag(r.status)}</td></tr>`).join("")}</tbody></table>`)
    : `<p class="muted">لا توجد رسائل هنا.</p>`;
  const pages = Math.max(1, Math.ceil(total / PER)), q = st ? `status=${st}&` : "";
  const pager = pages > 1 ? `<div class="pager">${p > 1 ? `<a href="?${q}page=${p - 1}">الأحدث</a>` : ""}<span>صفحة ${num(p)} من ${num(pages)}</span>${p < pages ? `<a href="?${q}page=${p + 1}">الأقدم</a>` : ""}</div>` : "";
  return layout({ title: "الرسائل", user, path: "/messages", flash, body: `<p class="muted">رسائل نموذج «تواصل معنا» في الموقع. تصل نسخة منها أيضًا إلى البريد.</p><nav class="filters" aria-label="تصفية">${filters}</nav>${list}${pager}` });
}

const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}$/i;
/* a reply link for what the visitor left: email -> mailto, Saudi/international mobile -> WhatsApp + call */
export function replyLinks(reply) {
  const r = String(reply || "").trim();
  if (EMAIL.test(r)) return `<a href="mailto:${esc(r)}?subject=${encodeURIComponent("رد: رسالتك إلى موقع الشيخ حسن حدادي")}">الرد بالبريد</a>`;
  let d = r.replace(/[\s\-()]/g, "").replace(/[٠-٩]/g, c => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  if (/^\+?\d{9,15}$/.test(d)) {
    d = d.replace(/^\+/, "").replace(/^00/, "");
    if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
    return `<a href="https://wa.me/${d}" target="_blank" rel="noopener">واتساب</a> · <a href="tel:+${d}">اتصال</a>`;
  }
  return "";
}

export async function messageDetail(db, user, id, flash) {
  const m = await one(db, "SELECT id, at, name, reply, body, status, mailed FROM messages WHERE id = ?", id);
  if (!m) return null;
  const links = replyLinks(m.reply);
  const btn = (s, label, cls = "secondary") => m.status === s ? "" : `<button class="${cls}" name="status" value="${s}">${label}</button>`;
  const actions = can(user.role, "messages.edit") ? `<form class="inline" method="post" action="/admin/messages/status"><input type="hidden" name="id" value="${m.id}">
${btn("read", "مقروءة")}${btn("answered", "تم الرد", "")}${btn("archived", "أرشفة")}${btn("new", "إعادتها جديدة")}</form>
${can(user.role, "users.manage") ? `<form class="inline" method="post" action="/admin/messages/delete"><input type="hidden" name="id" value="${m.id}"><label><input type="checkbox" name="confirm" value="1" required> تأكيد الحذف النهائي</label><button class="danger">حذف</button></form>` : ""}` : "";
  return layout({ title: `رسالة رقم ${num(m.id)}`, user, path: "/messages", flash, body: `<p><a href="/admin/messages">← كل الرسائل</a></p>
<dl class="meta"><dt>الوقت</dt><dd>${stamp(m.at)}</dd><dt>الاسم</dt><dd>${esc(m.name || "—")}</dd><dt>للرد</dt><dd><span class="ltr">${esc(m.reply || "— (لم يترك وسيلة للرد)")}</span>${links ? ` · ${links}` : ""}</dd>
<dt>الحالة</dt><dd>${tag(m.status)}${m.mailed ? "" : ` <span class="muted">(لم تُرسل نسخة إلى البريد)</span>`}</dd></dl>
<div class="msg" dir="auto">${esc(m.body)}</div><h2>الإجراءات</h2>${actions}` });
}

/* ---- series (read-only until the editing phase) ---- */
export async function seriesList(env, user) {
  const lib = await library(env), by = {};
  for (const l of lib.lessons) { const b = by[l.series] || (by[l.series] = { n: 0, h: 0, last: "" }); b.n++; if (l.src) b.h++; if ((l.date || "") > b.last) b.last = l.date || ""; }
  const rows = lib.series.map(s => ({ ...s, ...(by[s.id] || { n: 0, h: 0, last: "" }) })).sort((a, b) => b.n - a.n);
  return layout({ title: "السلاسل", user, path: "/series", body: region("السلاسل", `<table><thead><tr><th>السلسلة</th><th>الدروس</th><th>بصوت على الموقع</th><th>آخر درس</th></tr></thead><tbody>${
    rows.map(s => `<tr><td><a href="/admin/series/${encodeURIComponent(s.id)}">${esc(s.title)}</a></td><td>${num(s.n)}</td><td>${num(s.h)}</td><td>${s.last ? esc(hijriOf("", s.last)) : "—"}</td></tr>`).join("")}</tbody></table>`) +
    `<p class="muted">افتح سلسلة لرفع صوت دروسها أو إضافة درس. تعديل العناوين والإخفاء والترتيب يأتي في المرحلة التالية.</p>` });
}

/* ---- users ---- */
const roleSelect = (name, cur, allowed) => `<select name="${name}" aria-label="الدور">${allowed.map(r => `<option value="${r}"${r === cur ? " selected" : ""}>${esc(ROLE_AR[r])}</option>`).join("")}</select>`;
export async function usersPage(db, user, flash) {
  const allowed = manageable(user.role);
  const rows = await all(db, "SELECT email, role, name, active FROM users ORDER BY active DESC, CASE role WHEN 'super' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email");
  const list = rows.map(r => {
    const editable = allowed.includes(r.role) && r.email !== user.email;
    return `<tr><td class="ltr">${esc(r.email)}</td><td>${esc(r.name || "")}</td><td>${editable ? `<form class="inline" method="post" action="/admin/users/update"><input type="hidden" name="email" value="${esc(r.email)}">${roleSelect("role", r.role, allowed)}
<select name="active" aria-label="الحالة"><option value="1"${r.active ? " selected" : ""}>فعّال</option><option value="0"${r.active ? "" : " selected"}>موقوف</option></select><button>حفظ</button></form>`
      : `${esc(ROLE_AR[r.role] || r.role)} · ${r.active ? "فعّال" : "موقوف"}${r.email === user.email ? " (أنت)" : ""}`}</td></tr>`;
  }).join("");
  return layout({ title: "المستخدمون", user, path: "/users", flash, body: region("المستخدمون", `<table><thead><tr><th>البريد</th><th>الاسم</th><th>الدور والحالة</th></tr></thead><tbody>${list}</tbody></table>`) + `
<h2>إضافة مستخدم</h2><form class="inline" method="post" action="/admin/users/add"><label>البريد <input type="email" name="email" required maxlength="254" dir="ltr"></label>
<label>الاسم <input name="name" maxlength="80"></label><label>الدور ${roleSelect("role", "editor", allowed)}</label><button>إضافة</button></form>
<p class="muted">إضافة البريد هنا لا تكفي: أضفه أيضًا إلى سياسة «hadadi-admin» في Cloudflare Access.${can(user.role, "users.manage") ? "" : " يضيف المدير المحررين فقط؛ المديرون يضيفهم المدير العام."}</p>` });
}

export async function auditPage(db, user) {
  const rows = await all(db, "SELECT at, actor, action, entity, entity_id, before, after FROM audit_log ORDER BY id DESC LIMIT 200");
  return layout({ title: "السجل", user, path: "/audit", body: region("السجل", `<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>العنصر</th><th>قبل</th><th>بعد</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${stamp(r.at)}</td><td class="ltr">${esc(r.actor)}</td><td>${esc(r.action)}</td><td class="ltr">${esc(r.entity)}${r.entity_id ? " · " + esc(r.entity_id) : ""}</td><td class="ltr"><code>${esc(trunc(r.before, 120))}</code></td><td class="ltr"><code>${esc(trunc(r.after, 120))}</code></td></tr>`).join("")}</tbody></table>`) + `<p class="muted">آخر ٢٠٠ عملية.</p>` });
}
