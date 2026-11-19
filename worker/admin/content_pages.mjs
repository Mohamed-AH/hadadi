/* Phase B3 pages: one series with its lessons, upload audio for a lesson, add a lesson, Publish. Server-rendered; the only script
   is /admin/admin.js (client.mjs), for the upload forms. */
import { esc, layout, num, stamp, hijriOf } from "./html.mjs";
import { can } from "./roles.mjs";
import { library } from "./pages.mjs";
import { pending } from "./publish.mjs";

const all = (db, sql, ...a) => db.prepare(sql).bind(...a).all().then(r => r.results);
const region = (label, html) => `<div class="scroll" tabindex="0" role="region" aria-label="${label}">${html}</div>`;
const PUBLIC = "https://h-haddadi.com";
const mins = s => s ? num(Math.round(s / 60)) + " د" : "";
const tag = (cls, t) => `<span class="tag ${cls}">${t}</span>`;

/* the portal's own rows next to the published catalogue */
export async function portalState(env) {
  const db = env.DB;
  const [audio, added, p, stats] = await Promise.all([
    all(db, "SELECT lesson_id, tg, key, size, duration, by, at FROM audio"),
    all(db, "SELECT id, series_id, title, hd, date, key, size, duration, by, at FROM lessons_new"),
    pending(db),
    all(db, "SELECT lesson_id, SUM(CASE WHEN event='play' THEN n ELSE 0 END) p, SUM(CASE WHEN event='download' THEN n ELSE 0 END) d FROM stats_daily GROUP BY lesson_id"),
  ]);
  const was = p.last ? JSON.parse(p.last.snapshot) : { media: {}, lessons: [] };
  return { audio: new Map(audio.map(a => [a.lesson_id, a])), added, pending: p, stats: new Map(stats.map(s => [s.lesson_id, s])),
    wasMedia: new Map(Object.values(was.media).map(m => [m.lesson, m])), wasLessons: new Set(was.lessons.map(l => l.id)) };
}

export async function seriesDetail(env, user, id, flash) {
  const lib = await library(env), s = lib.series.find(x => x.id === id);
  if (!s) return null;
  const st = await portalState(env), edit = can(user.role, "content.edit");
  const pub = lib.lessons.filter(l => l.series === id);
  const extra = st.added.filter(a => a.series_id === id && !pub.some(l => l.id === a.id))
    .map(a => ({ id: a.id, title: a.title, series: id, date: a.date || "", hd: a.hd, duration: a.duration, src: "x", fresh: true }));
  const rows = [...pub, ...extra].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const tr = rows.map(l => {
    const mine = st.audio.get(l.id), added = st.added.find(a => a.id === l.id), stat = st.stats.get(l.id);
    let state, act = "";
    if (added) {
      state = tag("tag-new", "أُضيف في اللوحة") + (st.wasLessons.has(l.id) ? "" : " " + tag("tag-wait", "ينتظر النشر"));
      if (edit) act = `<form class="inline" method="post" action="/admin/lessons/remove"><input type="hidden" name="id" value="${esc(l.id)}"><input type="hidden" name="series" value="${esc(id)}"><button class="danger">حذف الدرس</button></form>`;
    } else if (/^p-/.test(l.id)) {
      state = tag("tag-wait", "حُذف، ينتظر النشر");
    } else if (mine) {
      const live = st.wasMedia.get(l.id);
      state = tag("tag-answered", "صوت مرفوع في اللوحة") + (live && live.key === mine.key ? "" : " " + tag("tag-wait", "ينتظر النشر"));
      if (edit) act = `<a href="/admin/lessons/${encodeURIComponent(l.id)}/audio">استبدال</a> <form class="inline" method="post" action="/admin/audio/remove"><input type="hidden" name="id" value="${esc(l.id)}"><input type="hidden" name="series" value="${esc(id)}"><button class="danger">إلغاء الرفع</button></form>`;
    } else if (l.src) {
      state = tag("tag-answered", "على الموقع");
      if (edit) act = `<a href="/admin/lessons/${encodeURIComponent(l.id)}/audio">استبدال الصوت</a>`;
    } else {
      state = tag("tag-archived", "تيليجرام فقط");
      if (edit && l.tg) act = `<a href="/admin/lessons/${encodeURIComponent(l.id)}/audio">رفع الصوت</a>`;
    }
    const title = l.fresh ? esc(l.title) : `<a href="${PUBLIC}/lesson/${encodeURIComponent(l.id)}/">${esc(l.title)}</a>`;
    return `<tr><td>${title}</td><td>${esc(hijriOf(l.hd, l.date))}</td><td>${mins(l.duration)}</td><td>${state}</td><td>${stat ? num(stat.p) + " / " + num(stat.d) : "—"}</td><td>${act}</td></tr>`;
  }).join("");
  const hosted = pub.filter(l => l.src).length;
  return layout({ title: s.title, user, path: "/series", flash, body: `<p class="muted">${num(pub.length)} درس منشور، منها ${num(hosted)} بصوت على الموقع. <a href="${PUBLIC}/series/${encodeURIComponent(id)}/">صفحة السلسلة في الموقع</a></p>
${edit ? `<p><a class="btnlink" href="/admin/series/${encodeURIComponent(id)}/new">إضافة درس جديد إلى هذه السلسلة</a></p>` : ""}
${region("دروس السلسلة", `<table><thead><tr><th>الدرس</th><th>التاريخ</th><th>المدة</th><th>الصوت</th><th>استماع / تحميل</th><th><span class="sr">إجراءات</span></th></tr></thead><tbody>${tr}</tbody></table>`)}
<p class="muted">الأرقام: مرات الاستماع (٣٠ ثانية فأكثر) / مرات التحميل منذ بدء العدّ. التغييرات تظهر في الموقع بعد <a href="/admin/publish">النشر</a>.</p>` });
}

/* the upload form; client.mjs does the work (hash, multipart upload, then one JSON call) */
const fileField = `<p><label for="file">ملف الصوت (m4a أو mp3، حتى ٢٠٠ ميغابايت)</label><br><input type="file" id="file" accept=".m4a,.mp3,audio/mp4,audio/mpeg" required></p>
<p id="note" class="muted"></p><p id="prog" role="status" aria-live="polite"></p><p id="msg" class="flash err" role="alert" hidden></p>
<p><button id="go" type="submit">رفع وحفظ</button></p>`;

export async function audioPage(env, user, id) {
  const lib = await library(env), l = lib.lessons.find(x => x.id === id);
  if (!l || !l.tg) return null;
  const s = lib.series.find(x => x.id === l.series) || { title: "" };
  return layout({ title: "رفع صوت الدرس", user, path: "/series", scripts: true, body: `<dl class="meta"><dt>الدرس</dt><dd>${esc(l.title)}</dd><dt>السلسلة</dt><dd><a href="/admin/series/${encodeURIComponent(l.series)}">${esc(s.title)}</a></dd>
<dt>التاريخ</dt><dd>${esc(hijriOf(l.hd, l.date))}</dd><dt>الآن</dt><dd>${l.src ? "له صوت على الموقع؛ الملف الجديد يحلّ محله بعد النشر" : "على تيليجرام فقط"}</dd>
<dt>المنشور</dt><dd><a href="${esc(l.tg)}" class="ltr">${esc(l.tg)}</a></dd></dl>
<form id="up" data-mode="audio" data-lesson="${esc(l.id)}" data-series="${esc(l.series)}">${fileField}</form>
<p class="muted">يُرفع الملف كما هو، فحسّنه قبل الرفع بأداة تحسين الصوت (m4a أحادي بمعدل ٤٨ كب/ث كبقية دروس الموقع). يُرفض الملف الأثقل من ٦٤ كب/ث.</p>` });
}

export async function newLessonPage(env, user, sid) {
  const lib = await library(env), s = lib.series.find(x => x.id === sid);
  if (!s) return null;
  return layout({ title: "إضافة درس", user, path: "/series", scripts: true, body: `<p>السلسلة: <a href="/admin/series/${encodeURIComponent(sid)}">${esc(s.title)}</a></p>
<form id="up" data-mode="new" data-series="${esc(sid)}">
<p><label for="title">عنوان الدرس</label><br><input type="text" id="title" maxlength="200" required class="wide"></p>
<fieldset class="hdate"><legend>التاريخ الهجري (اختياري)</legend>
<label>اليوم <input type="number" id="hd-d" min="1" max="30" class="num"></label> <label>الشهر <input type="number" id="hd-m" min="1" max="12" class="num"></label> <label>السنة <input type="number" id="hd-y" min="1300" max="1600" class="num md"></label></fieldset>
${fileField}</form>
<p class="muted">يُستعمل هذا للدروس التي ليست في قناتَي تيليجرام. حسّن الملف قبل الرفع بأداة تحسين الصوت. يظهر الدرس في الموقع بعد النشر.</p>` });
}

/* ---- Publish ---- */
const RESULT = r => { try { const j = JSON.parse(r || "{}"); return j.status ? `${num(j.status)}${j.build ? ` <small class="ltr">${esc(j.build.slice(0, 8))}</small>` : ""}` : "—"; } catch { return "—"; } };
export async function publishPage(env, user, flash) {
  const db = env.DB, lib = await library(env), st = await portalState(env), p = st.pending;
  const titleOf = id => (lib.lessons.find(l => l.id === id) || st.added.find(a => a.id === id) || { title: id }).title;
  const line = (ids, what) => ids.map(id => `<li>${what}: ${esc(titleOf(id))}</li>`).join("");
  const list = line(p.lessons.added, "درس جديد") + line(p.lessons.changed, "تعديل درس") + line(p.lessons.removed, "حذف درس")
    + line(p.audio.added, "صوت جديد") + line(p.audio.changed, "صوت مستبدل") + line(p.audio.removed, "إلغاء صوت");
  const hook = /^https:\/\/api\.cloudflare\.com\//.test(String(env.DEPLOY_HOOK || ""));
  const hist = await all(db, "SELECT id, at, by, result FROM publishes ORDER BY id DESC LIMIT 10");
  const canPub = can(user.role, "content.publish");
  return layout({ title: "النشر", user, path: "/publish", flash, body: `
${p.count ? `<h2>تغييرات تنتظر النشر (${num(p.count)})</h2><ul>${list}</ul>` : `<p>لا تغييرات جديدة منذ آخر نشر.</p>`}
${!hook ? `<p class="flash err">لم يُضبط رابط النشر بعد (المتغيّر السري DEPLOY_HOOK في إعدادات الـ Worker).</p>` : ""}
${canPub && hook && (p.count || !p.last) ? `<form method="post" action="/admin/publish"><button>نشر التغييرات في الموقع</button></form><p class="muted">يبني Cloudflare الموقع من جديد، ويظهر التغيير بعد دقيقتين إلى ثلاث تقريبًا.</p>` : ""}
<h2>آخر عمليات النشر</h2>
${hist.length ? region("آخر عمليات النشر", `<table><thead><tr><th>#</th><th>الوقت</th><th>بواسطة</th><th>رد Cloudflare</th></tr></thead><tbody>${hist.map(h => `<tr><td>${num(h.id)}</td><td>${stamp(h.at)}</td><td class="ltr">${esc(h.by)}</td><td>${RESULT(h.result)}</td></tr>`).join("")}</tbody></table>`) : `<p class="muted">لم يُنشر شيء من اللوحة بعد.</p>`}` });
}
