/* Pure page renderers: every page is a function returning { html, title, description, path, jsonld, ... }.
   Used by scripts/build.mjs (pre-rendering to real static HTML) and by js/app.js (client-side navigation). */
import {
  SITE, NAME, NAME_FULL, OFFICIAL_PRE, FULL_NAME, ROLE, OFFICIAL_NAME, YT_CHANNEL, TG_CHANNEL, LINKS, CONTACT_EMAIL, tsKey, hasContact, SECTIONS, COVER, COVER_PALETTE, PAGE, MAXQ, ROSHAN,
  state, byId, seriesById, secById, ic, brand, esc, fmtNum, count, itemKind, fmtYear, ldate, rawDate, dur, isoDur, hours, dg, cleanQuery, oneOf, safeUrl, safeYt, safeLang, safeDecode, jsonLd,
  DOCS, SCHEDULE, todayRiyadh, kindIcon, useLabel, label, mainTitle, fullTitle, secOfSeries, secOfLesson, seriesOrder, lang, thumb, STAR, LOGO, match, sectionCount, visible, isFlat, seriesIn, href, fmtDate,
} from "./core.js";

const OG_DEFAULT = SITE + "/og/default.png";
const clip = (s, n) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; };

/* ───────── Components ───────── */
export const searchBox = (ph, v = "", id = "q", asForm = false) => {
  const inner = `<label class="sr-only" for="${id}">${esc(ph)}</label>${ic("search", 20)}<input id="${id}" name="q" type="search" placeholder="${esc(ph)}" value="${esc(v)}" autocomplete="off" enterkeyhint="search" maxlength="${MAXQ}" spellcheck="false">`;
  return asForm ? `<form class="search" role="search" action="/search/" method="get">${inner}</form>` : `<div class="search" role="search">${inner}</div>`;
};

/* A series' artwork: its colour, the star, its title and size. "mini" = colour and pattern only (beside a lesson title). */
export const coverColor = s => COVER[s.id] || COVER_PALETTE[Math.max(0, state.DB.series.indexOf(s)) % COVER_PALETTE.length];
export const art = (s, cls = "") => `<span class="art${cls ? " " + cls : ""}" style="--c:${coverColor(s)}" aria-hidden="true">${/\bmini\b/.test(cls) ? ""
  : `${STAR.replace("<svg", '<svg class="art-s"')}<span class="art-t">${esc(s.title)}</span><span class="art-n">${count(s.count, itemKind(s.id))}</span>`}</span>`;

/* Our R2 copies download through the site's /dl/ route (worker/index.js), which saves them under the lesson title;
   anything else keeps the plain link. */
const dlLink = (src, title) => {
  const m = /\/audio\/([0-9a-f]{16})\.m4a$/.exec(String(src || ""));
  return m ? `<a class="btn" href="/dl/${m[1]}?n=${esc(encodeURIComponent(title))}" download>${ic("download", 17)} تحميل</a>`
           : `<a class="btn" href="${esc(safeUrl(src))}" download target="_blank" rel="noopener">${ic("download", 17)} تحميل</a>`;
};

export function seriesTile(s, i = 0) {
  return `<a class="stile" href="${href.series(s.id)}" style="--i:${i}" aria-label="${esc(s.title)}، ${count(s.count, itemKind(s.id))}">${art(s)}
    <span class="stile-m" aria-hidden="true"><span>${secOfSeries(s).title}</span>${hours(s.seconds) ? `<span>${hours(s.seconds)}</span>` : ""}</span></a>`;
}
export const tiles = (list, cls = "") => `<div class="stiles${cls ? " " + cls : ""}">${list.map(seriesTile).join("")}</div>`;

/* a lesson in a list of recent lessons: series artwork, title, series + date, length */
export function lessonCard(l, i = 0) {
  const s = seriesById[l.series];
  const heading = useLabel(l) ? `${s.title} — ${label(l)}${l.section ? "، " + l.section : ""}` : fullTitle(l);
  return `<a class="ep" href="${href.lesson(l.id)}" style="--i:${i}"${lang(l)}>${art(s, "mini")}
    <span class="tt"><span class="t">${esc(heading)}</span><span class="s">${esc(s.title)}${ldate(l) ? `، <span class="nw">${ldate(l)}</span>` : ""}</span></span>
    ${l.duration ? `<span class="d">${dur(l.duration)}</span>` : ""}<span class="pb" aria-hidden="true">${ic(kindIcon(l) === "video" ? "video" : "play", 18)}</span></a>`;
}
export const eps = list => `<div class="eps">${list.map(lessonCard).join("")}</div>`;

/* inside its own series a lesson's title need not repeat the series name: «شرح سلم الوصول — الدرس السابع» → «الدرس السابع» */
const shortTitle = (l, s, withBook) => {
  const t = mainTitle(l, withBook);
  for (const p of [s.title, s.title.replace(/^شرح\s+/, "")]) if (t.startsWith(p + " — ") && !/^[٠-٩0-9]/.test(t.slice(p.length + 3))) return t.slice(p.length + 3);   // a bare date stays whole (the date line below repeats it)
  return t;
};
export function row(l, opts = {}) {
  const s = seriesById[l.series];
  const sub = (opts.showSeries ? `${esc(s.title)}` : "") + (opts.showSeries && ldate(l) ? "، " : "") + (ldate(l) ? `<span class="nw">${ldate(l)}</span>` : "");
  const pg = opts.prog;   // this browser's listening progress {done, p} (series lists in the browser only)
  return `<a class="row${opts.now ? " now" : ""}${pg?.done ? " done" : ""}" href="${href.lesson(l.id)}" style="--i:${Math.min(opts.i || 0, 24)}"${opts.now ? ' aria-current="page"' : ""}${lang(l)}>
    <span class="no">${l.n != null ? fmtNum(l.n) : ic(kindIcon(l) === "video" ? "video" : opts.now ? "headphones" : "play", 17)}</span>
    <span class="tt"><span class="t">${esc(opts.inSeries ? shortTitle(l, s, !opts.noSection) : mainTitle(l, !opts.noSection))}</span><span class="s">${sub}${pg?.done ? `<span class="mk">${ic("circle-check", 14)} تم الاستماع</span>` : ""}</span></span>
    ${l.duration ? `<span class="d">${dur(l.duration)}</span>` : ""}${pg && !pg.done && pg.p > 0 ? `<span class="pgb" style="--p:${Math.round(Math.min(1, pg.p) * 100)}%" title="استمعت إلى جزء منه"></span>` : ""}</a>`;
}
const chip = (s, n, i = 0) => `<a class="chip" href="${href.section(s)}" style="--i:${i}">${ic(s.icon, 18)}<span>${s.title}</span><small>${fmtNum(n)}</small></a>`;
const tile = (s, n) => `<a class="tile" href="${href.section(s)}"><span class="tile-ic">${ic(s.icon, 24)}</span>
    <span class="tile-b"><strong>${s.title}</strong><span>${s.desc}</span></span><span class="tile-n">${fmtNum(n)}</span></a>`;
/* announcement posters: a strip on the home page, a grid on /announcements/ */
const poster = (a, i = 0, big = false) => `<figure class="poster" id="a-${a.id}" style="--i:${i}">
    <a class="poster-img" href="${big ? a.image : href.announcements() + "#a-" + a.id}"${big ? ' target="_blank" rel="noopener"' : ""}><img src="${big ? a.image : a.thumb}" alt="${esc(a.title)}" width="${a.w}" height="${a.h}" loading="lazy" decoding="async"></a>
    <figcaption><span class="t">${esc(a.title)}</span>${a.until ? `<span class="s">${ic("calendar", 14)} حتى ${fmtDate(a.until)}</span>` : ""}
    ${big ? `<a class="btn sm" href="${a.image}" download>${ic("download", 15)} تحميل الإعلان</a>` : ""}</figcaption></figure>`;
const head2 = (t, link) => `<div class="sec"><h2>${t}</h2>${link || ""}</div>`;
const more = (h, t) => `<a href="${h}">${t} ${ic("chevron-left", 15)}</a>`;

/* crumbs -> { html, ld } ; items: [{t, h?}] (last one has no href) */
function crumbs(items) {
  const all = [{ t: "الرئيسية", h: "/" }, ...items];
  const html = `<nav class="crumb" aria-label="مسار الصفحة">${all.map((x, i) => x.h && i < all.length - 1 ? `<a href="${x.h}">${esc(x.t)}</a>` : `<span${i === all.length - 1 ? ' aria-current="page"' : ""}>${esc(x.t)}</span>`).join(" / ")}</nav>`;
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: all.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.t, ...(x.h && i < all.length - 1 ? { item: SITE + x.h } : {}) })) };
  return { html, ld };
}
/* a page = an optional full-width dark band (o.band) + the content in the page column (o.html) */
/* links that open Telegram, WhatsApp or YouTube in a new tab say so to screen readers (WCAG 3.2.5 advisory) */
const newTab = h => h.replace(/(<a\b[^>]*target="_blank"[^>]*>)([\s\S]*?)(<\/a>)/g, (m, a, b, c) => /aria-label=/.test(a) ? m : `${a}${b}<span class="sr-only"> (يفتح في نافذة جديدة)</span>${c}`);
const mkPage = o => ({ status: 200, noindex: false, jsonld: [], image: OG_DEFAULT, ogType: "website", nav: "", wire: { t: "none" }, ...o,
  html: newTab(`${o.band ? `<div class="band">${o.band}</div>` : ""}<div class="wrap page">${o.html}</div>`) });
const band = (inner, cls = "") => `<div class="wrap band-in${cls ? " " + cls : ""}">${inner}</div>`;
const SITE_SUFFIX = ` | ${NAME}`;   // short, so search results show the page's own title; the full official name is on the home page and in og:site_name
const withSite = t => t + SITE_SUFFIX;
/* link previews (WhatsApp, Telegram, X): the page's own title; the site name comes from og:site_name */
export const ogTitle = p => p.title.endsWith(SITE_SUFFIX) ? p.title.slice(0, -SITE_SUFFIX.length) : p.title;

/* ───────── Pages ───────── */
function home() {
  const DB = state.DB, vis = visible();
  /* the videos have their own section (owner 2026-11-22: «المرئيات»), so the home lists, tiles and counts are the audio library */
  const aud = DB.lessons.filter(l => l.kind !== "video"), audSeries = DB.series.filter(s => s.sec !== "duroos");
  const top = audSeries.slice().sort((a, b) => b.count - a.count).slice(0, 8);
  const recent = aud.filter(l => l.date).slice(0, 9), f = recent[0], latest = recent.slice(1), fs = f && seriesById[f.series];
  const bio = state.bio;
  const hours_ = Math.floor(aud.reduce((a, l) => a + (l.duration || 0), 0) / 36e4) * 100;
  const feat = f ? `<a class="feat" href="${href.lesson(f.id)}">${art(fs)}<span class="feat-b"><span class="k">أحدث درس${ldate(f) ? "، " + ldate(f) : ""}</span>
      <span class="ft">${esc(fullTitle(f))}</span>${f.duration ? `<span class="m">${ic("clock", 14)} ${dur(f.duration)}</span>` : ""}<span class="go">${ic("play", 17)} استمع الآن</span></span></a>` : "";
  const bandHtml = band(`<div class="beams" aria-hidden="true"></div><div class="roshan" aria-hidden="true">${ROSHAN}</div><div class="hero-t">
      <h1 class="hero-h"><span class="pre">${OFFICIAL_PRE}</span> <span class="nm">${FULL_NAME}</span> <span class="hf">حفظه الله ورعاه</span></h1>
      ${ROLE ? `<p class="role">${ROLE}</p>` : ""}
      <p class="hero-p">دروس الشيخ في التفسير والحديث والعقيدة، وخطبه ومحاضراته، مرتّبة في سلاسل للاستماع والتحميل.</p>
      ${searchBox("ابحث عن درس أو كتاب أو باب…", "", "q", true)}
      <ul class="stats"><li><b>${fmtNum(aud.length)}</b>مادة صوتية</li><li><b>${fmtNum(audSeries.length)}</b>سلسلة علمية</li>${hours_ ? `<li><b>${fmtNum(hours_)}</b>ساعة وأكثر</li>` : ""}${DB.books.length ? `<li><b>${fmtNum(DB.books.length)}</b>كتابًا</li>` : ""}</ul></div>
    ${feat}`, "hero");
  const html = `
    <nav class="chips" aria-label="أقسام المكتبة">${vis.map((s, i) => chip(s, sectionCount(s.id), i)).join("")}</nav>
    ${SCHEDULE.items.length ? `${head2("جدول الدروس الأسبوعي", more(href.schedule(), "الجدول كاملًا"))}${scheduleTable()}` : ""}
    ${state.ann.length ? `${head2("إعلانات الدروس", more(href.announcements(), "كل الإعلانات"))}<div class="posters strip">${state.ann.slice(0, 6).map((a, i) => poster(a, i)).join("")}</div>` : ""}
    ${hasDocs() ? `${head2("التزكيات والوصايا", more(href.documents(), "عرض الكل"))}<div class="posters strip">${docsHome()}</div>` : ""}
    ${bio ? `<section class="about-teaser" aria-labelledby="ab-h"><h2 id="ab-h">عن الشيخ</h2>${bio.summary ? `<p>${esc(bio.summary)}</p>` : ""}<a class="btn" href="${href.about()}">اقرأ المزيد ${ic("chevron-left", 16)}</a></section>` : ""}
    ${head2("السلاسل", more(href.library(), "كل الأقسام"))}${tiles(top)}
    ${head2("أحدث الدروس", more(href.search(), "الكل"))}${eps(latest)}`;
  return mkPage({
    nav: "home", path: "/", band: bandHtml, html, wire: { t: "home" },
    title: `${OFFICIAL_NAME} حفظه الله — دروس ومحاضرات وخطب`,
    description: `${OFFICIAL_NAME} حفظه الله: شروح كتاب التوحيد وسلم الوصول والأربعين النووية وعمدة الأحكام، وخطب الجمعة بجدة، ومحاضراته وكلماته، للاستماع والتحميل.`,
    jsonld: [
      { "@context": "https://schema.org", "@type": "WebSite", name: OFFICIAL_NAME, alternateName: ["دروس الشيخ حسن حدادي", NAME_FULL], url: SITE + "/", inLanguage: "ar",
        potentialAction: { "@type": "SearchAction", target: `${SITE}/search/?q={search_term_string}`, "query-input": "required name=search_term_string" } },
      { "@context": "https://schema.org", "@type": "Person", name: FULL_NAME, alternateName: ["حسن بن علي حدادي", "حسن حدادي", "الشيخ حسن حدادي", "الشيخ حسن بن علي حدادي"], honorificPrefix: "الشيخ", url: SITE + "/", sameAs: LINKS.map(x => x.h) },
    ],
  });
}

const pageBand = (c, icon, title, lede, extra = "") => band(`${icon}<div class="pb-t">${c.html}<h1 class="page-h">${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}${extra}</div>`, "page-band");
const secIcon = sec => `<span class="sec-ic" aria-hidden="true">${ic(sec.icon, 34)}</span>`;

function library() {
  const c = crumbs([{ t: "الأقسام" }]);
  return mkPage({
    nav: "library", path: "/library/", wire: { t: "none" },
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("layout-grid", 34)}</span>`, "المكتبة", "اختر قسمًا لتصفّح سلاسله ودروسه."),
    html: `<div class="tiles">${visible().map(s => tile(s, sectionCount(s.id))).join("")}</div>`,
    title: withSite("المكتبة — أقسام الدروس والمحاضرات والكتب"), description: `أقسام موقع ${NAME_FULL}: التفسير والحديث والعقيدة والفقه والخطب والمحاضرات.`, jsonld: [c.ld],
  });
}

function sectionPage(id) {
  const sec = secById[id], ser = sec ? seriesIn(id) : [];
  if (!sec || id === "books" || ser.length < 2) return null;     // flat sections link straight to their only series
  const items = state.DB.lessons.filter(l => secOfLesson(l).id === id), latest = items.filter(l => l.date).slice(0, 8);
  const c = crumbs([{ t: sec.title }]);
  return mkPage({
    nav: id, path: `/section/${id}/`,
    band: pageBand(c, secIcon(sec), sec.title, `${sec.desc} — ${count(ser.length, "series")}، ${count(items.length, "item")}`),
    html: `${head2("السلاسل")}${tiles(ser.slice().sort((a, b) => b.count - a.count), "grid")}
      ${latest.length ? `${head2("أحدث الدروس", more(href.search(`?sec=${id}`), "الكل"))}${eps(latest)}` : ""}`,
    title: withSite(`${sec.title} — ${ser.length} سلسلة`), description: clip(`${sec.desc} ${fmtNum(ser.length)} سلسلة و${fmtNum(items.length)} مادة من ${NAME_FULL}.`, 160),
    jsonld: [c.ld],
  });
}

/* series info (memoised) + list renderer shared by the static page and the client-side filters */
const _info = new Map();
export function seriesInfo(id) {
  if (_info.has(id)) return _info.get(id);
  const s = seriesById[id]; if (!s) return null;
  const all = state.DB.lessons.filter(l => l.series === id);
  const ordered = !!s.ordered || all.some(l => l.n != null);
  const when = l => l.date || String(l.o).padStart(8, "0"), first = {};
  all.forEach(l => { if (l.section && (!first[l.section] || when(l) < first[l.section])) first[l.section] = when(l); });
  const sections = Object.keys(first).sort((x, y) => first[x].localeCompare(first[y]));   // chronological: by when each book was first taught
  const o = { s, sec: secOfSeries(s), flat: isFlat(s.sec), all, ordered, sections, sib: all.slice().sort(ordered ? seriesOrder : (a, b) => (b.date || "").localeCompare(a.date || "") || a.o - b.o) };
  _info.set(id, o); return o;
}
/* the order a series is listened in: by lesson number when it has them; collections (khutab, lectures …) newest first; books oldest first */
export const listenOrder = info => info.ordered ? info.sib : NEWEST_FIRST.has(info.s.id) ? info.sib : oldFirst(info.sib);
const oldFirst = list => list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.o - b.o);   // and in posting order within a day
export const SERIES_PAGE = 50;
const DIGITS = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
/* a query that is only a number ("١١١", "111") finds that lesson by its own number: the lesson's n, a number written in its title as a
   whole (so ١١ does not find ١١١), or the ordinal word this site's titles use («الدرس السابع» for ٧); never its position in the list */
const numQuery = q => { const m = /^\s*(\d{1,4})\s*$/.exec(DIGITS(q || "")); return m ? +m[1] : null; };
const DATES = /\d{1,4}\s*[/\-.ا]\s*\d{1,2}\s*[/\-.ا]\s*\d{1,4}|\d{1,2}\s+\d{1,2}\s+1[34]\d\d|1[34]\d\d|\d{1,2}\s+(?=محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو)/g;   // ٥/٨/١٤٤٦, years, «١٩ ربيع»
const UNITS = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
const TENS = ["", "", "العشرون", "الثلاثون", "الأربعون", "الخمسون", "الستون", "السبعون", "الثمانون", "التسعون"];
const ordinal = n => n <= 10 ? UNITS[n] : n === 11 ? "الحادي عشر" : n < 20 ? `${UNITS[n - 10]} عشر` : n < 100 ? (n % 10 ? `${n % 10 === 1 ? "الحادي" : UNITS[n % 10]} و${TENS[Math.floor(n / 10)]}` : TENS[n / 10]) : "";
const AR = "\\u0621-\\u064A", alef = t => t.replace(/[أإآ]/g, "ا");
/* «الثاني» must not find «الثاني عشر» or «الثاني والعشرون» */
const hasOrd = (l, n) => { const w = ordinal(n); return !!w && new RegExp(`(^|[^${AR}])${alef(w)}(?![${AR}])(?!\\s+(?:عشر|و))`).test(alef(l.title)); };
/* the lesson's own number is the one after the first «الدرس / المجلس / اللقاء / الحلقة / الحديث» in its title, so «٢» finds «الدرس الثاني»
   but not «الدرس الرابع: المجلس الثاني» or «… — الجزء ٢»; titles without such a word fall back to any number in them */
const LW = /(?:الدرس|المجلس|اللقاء|الحلقة|الحديث|الشريط)\s*[:،]?\s*/;
const startsWithNum = (t, n) => { const d = /^(\d+)/.exec(DIGITS(t)); if (d) return +d[1] === n; const w = ordinal(n); return !!w && new RegExp(`^${alef(w)}(?![${AR}])(?!\\s+(?:عشر|و))`).test(alef(t)); };
const hasNum = (l, n) => {
  if (l.n != null) return l.n === n;
  const m = LW.exec(l.title);
  if (m) return startsWithNum(l.title.slice(m.index + m[0].length), n);
  return (DIGITS(l.title).replace(DATES, " ").match(/\d+/g) || []).some(x => +x === n) || hasOrd(l, n);
};
/* st: { q, sec, sort: new|old|num, only: ""|new|part, shown, prog: id -> {done, p} | undefined } -> the matching lessons and the first st.shown rows */
export function seriesList(info, st) {
  const n = numQuery(st.q), prog = st.prog || (() => undefined);
  let r = info.all.filter(l => (!st.sec || l.section === st.sec) && (n != null ? hasNum(l, n) : match(l, st.q)));
  if (st.only === "new") r = r.filter(l => { const p = prog(l.id); return !p || (!p.done && !p.p); });
  else if (st.only === "part") r = r.filter(l => { const p = prog(l.id); return p && !p.done && p.p > 0; });
  r = st.sort === "num" ? r.slice().sort(seriesOrder) : st.sort === "old" ? oldFirst(r) : r;
  const shown = r.slice(0, st.shown || SERIES_PAGE);
  let html = "", last, k = 0;
  for (const l of shown) {
    if (st.sort === "num" && !st.sec && info.sections.length > 1 && l.section !== last) { last = l.section; html += `<h2 class="sect">${esc(l.section || "أخرى")}</h2>`; }
    html += row(l, { noSection: true, inSeries: true, i: k++, prog: prog(l.id) });
  }
  return { count: r.length, items: r, more: r.length > shown.length,
    html: r.length ? `<div class="list cols">${html}</div>` : `<p class="empty">${st.only ? "لا توجد دروس بهذا الوصف." : "لا توجد نتائج."}</p>` };
}
export const moreBtn = left => `<button type="button" class="more" id="more">عرض المزيد (${fmtNum(left)})</button>`;

const NEWEST_FIRST = new Set(["khutab", "lectures", "tilawa", "fatawa", "tafsir", "v-khutab", "v-lectures", "v-fawaid"]);   // collections, not books: newest first
function seriesPage(id) {
  const info = seriesInfo(id); if (!info) return null;
  const { s, sec, flat, ordered, sections } = info;
  const st = { q: "", sec: "", sort: ordered ? "num" : NEWEST_FIRST.has(s.id) ? "new" : "old" };   // owner 2026-11-17: a book is followed from lesson 1
  const list = seriesList(info, st);
  // no invented blurbs: a series without its own description says what the data says (how many lessons, from when to when)
  const dated = info.all.filter(l => l.date).sort((a, b) => a.date.localeCompare(b.date));
  const d1 = dated.length ? rawDate(dated[0]) : "", d2 = dated.length ? rawDate(dated[dated.length - 1]) : "";
  const span = (dated.length && dated.every(l => l.posted) ? "نُشرت " : "") + (!d1 ? "" : d1 === d2 ? `في ${d1}` : `من ${d1} إلى ${d2}`);
  const c = crumbs(flat ? [{ t: sec.title }] : [{ t: sec.title, h: href.section(sec) }, { t: s.title }]);
  const audio = info.all.some(l => l.src);
  const html = `
    ${audio ? `<div class="plays" id="plays" hidden><button type="button" class="btn pri" id="play-all">${ic("play", 17)} تشغيل السلسلة</button><button type="button" class="btn" id="resume" hidden></button><p class="plays-n" id="plays-n"></p></div>` : ""}
    <div class="bar sbar">${searchBox("ابحث داخل السلسلة: رقم الدرس أو الباب…")}
      <select id="sort" aria-label="الترتيب"><option value="new"${st.sort === "new" ? " selected" : ""}>الأحدث أولًا</option><option value="old"${st.sort === "old" ? " selected" : ""}>الأقدم أولًا</option>${ordered ? `<option value="num"${st.sort === "num" ? " selected" : ""}>بالترتيب (الأول فالأخير)</option>` : ""}</select>
      ${audio ? `<select id="only" aria-label="تصفية حسب الاستماع" hidden><option value="">كل الدروس</option><option value="new">لم أستمع إليها</option><option value="part">لم أكملها</option></select>` : ""}</div>
    ${sections.length > 1 ? `<div class="pill-row" id="secs" role="group" aria-label="تصفية حسب الكتاب"><button type="button" class="pill on" aria-pressed="true" data-s="">الكل</button>${sections.map(x => `<button type="button" class="pill" aria-pressed="false" data-s="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}
    <p class="count" id="count" role="status">${count(list.count, itemKind(s.id))}</p><div id="out">${list.html}${list.more ? moreBtn(list.count - SERIES_PAGE) : ""}</div>
    ${list.more ? `<noscript>${seriesList(info, { ...st, shown: 1e9 }).html}</noscript>` : ""}`;   // visitors without scripts get the whole list; with scripts the browser never builds it, so big series stay light
  return mkPage({
    nav: s.sec, path: href.series(s.id), html, wire: { t: "series", id: s.id }, ogType: "website",
    band: pageBand(c, art(s, "big"), esc(s.title), `${s.description ? esc(s.description) + " — " : ""}${count(s.count, itemKind(s.id))}${span ? " " + span : ""}${hours(s.seconds) ? "، " + hours(s.seconds) : ""}.`,
      s.extra ? `<a class="btn" href="${esc(safeUrl(s.extra.url))}" target="_blank" rel="noopener">${ic("external-link", 17)} ${esc(s.extra.label)}</a>` : ""),
    title: withSite(`${s.title} — ${count(s.count, itemKind(s.id))}`),
    description: clip(`${s.title}: ${s.description ? s.description + " " : ""}${count(s.count, itemKind(s.id))}${span ? " " + span : ""}${hours(s.seconds) ? " (" + hours(s.seconds) + ")" : ""} — ${NAME_FULL}.`, 160),
    jsonld: [c.ld, { "@context": "https://schema.org", "@type": "CollectionPage", name: s.title, url: SITE + href.series(s.id), inLanguage: "ar",
      mainEntity: { "@type": "ItemList", numberOfItems: info.sib.length, itemListElement: info.sib.map((l, i) => ({ "@type": "ListItem", position: i + 1, url: SITE + href.lesson(l.id), name: fullTitle(l) })) } }],
  });
}

const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };
const cbtn = (id, icon, label, size = 26, cls = "cb") => `<button type="button" class="${cls}" id="${id}" aria-label="${label}">${ic(icon, size)}</button>`;
export const SPEEDS = [1, 1.25, 1.5, 2];
export const speedLabel = v => fmtNum(v).replace("٫", ".") + "×";
function lessonPage(id) {
  const l = byId[id]; if (!l) return null;
  const info = seriesInfo(l.series), { s, sec, flat } = info, sib = listenOrder(info);   // previous/next and «الدرس ٣ من ٤٢» follow the order the series is listened in
  const i = sib.findIndex(x => x.id === l.id), prev = sib[i - 1], next = sib[i + 1];
  const W = 12, win = sib.slice(Math.max(0, i - W), i + W + 1), title = fullTitle(l);
  const tg = l.tg ? safeUrl(l.tg) : "";
  /* hosted audio: a native <audio> for visitors without JavaScript, replaced by app.js with controls bound to the docked player */
  const vid = l.yt && byId[l.yt] ? href.lesson(l.yt) : "";   // a gap filled from the video (tools/video_gaps.py): its video page
  const player = l.kind === "audio" && !l.src && !tg && vid
    ? `<div class="lp lp-tg"><p>${ic("video", 18)} لم يُنشر صوت هذا الدرس على تيليجرام، وتسجيله المرئي متاح على الموقع.</p>
         <a class="btn brass" id="tg-listen" href="${vid}">${ic("play", 17)} شاهد الدرس</a></div>`
    : l.kind === "audio" && !l.src
    ? `<div class="lp lp-tg"><p>${ic("headphones", 18)} هذا الدرس متاح الآن على قناة الشيخ في تيليجرام.</p>
         <a class="btn brass" id="tg-listen" href="${esc(tg)}" target="_blank" rel="noopener">${ic("external-link", 17)} استمع على تيليجرام</a></div>`
    : l.kind === "audio"
    ? `<div class="lp" id="lp" data-id="${esc(l.id)}">
         <audio id="aud" class="native" controls preload="none" src="${esc(safeUrl(l.src))}"${l.src_alt ? ` data-alt="${esc(safeUrl(l.src_alt))}"` : ""} aria-label="${esc(title)}"></audio>
         <div class="lp-ui"><input type="range" class="seek" id="lp-seek" min="0" max="${l.duration || 0}" value="0" step="1" aria-label="موضع التشغيل">
           <div class="times"><span id="lp-cur">٠:٠٠</span><span id="lp-dur">${dur(l.duration) || ""}</span></div>
           <div class="ctl">${cbtn("lp-fwd", "rotate-cw", "تقديم ١٥ ثانية")}${cbtn("lp-play", "play", "تشغيل", 28, "cb play")}${cbtn("lp-back", "rotate-ccw", "رجوع ١٥ ثانية")}
             <div class="speeds" role="group" aria-label="سرعة التشغيل">${SPEEDS.map(v => `<button type="button" data-v="${v}" class="${v === 1 ? "on" : ""}" aria-pressed="${v === 1}">${speedLabel(v)}</button>`).join("")}</div></div></div></div>`
    : `<div class="frame"><div class="player lite" data-yt="${safeYt(l.id)}"><img src="https://i.ytimg.com/vi/${safeYt(l.id)}/hqdefault.jpg" alt="" width="480" height="360"><button type="button" class="lite-play" aria-label="تشغيل الفيديو: ${esc(title)}"><i>${ic("play", 30)}</i></button></div></div>`;
  const ext = l.kind === "audio" && !l.src
    ? ""   // the band's «استمع على تيليجرام» already opens the same post
    : l.kind === "audio"
    ? dlLink(l.src, title) + (tg ? `<a class="btn" href="${esc(tg)}" target="_blank" rel="noopener">${ic("external-link", 17)} المنشور على تيليجرام</a>` : "") + (vid ? `<a class="btn" href="${vid}">${ic("video", 17)} التسجيل المرئي</a>` : "")
    : `<a class="btn" href="https://www.youtube.com/watch?v=${safeYt(l.id)}" target="_blank" rel="noopener">${ic("external-link", 17)} فتح في يوتيوب</a>`;
  const c = crumbs(flat ? [{ t: sec.title, h: href.series(s.id) }, { t: title }] : [{ t: sec.title, h: href.section(sec) }, { t: s.title, h: href.series(s.id) }, { t: title }]);
  const bandHtml = band(`<a class="lart" href="${href.series(s.id)}" aria-label="${esc(s.title)}">${art(s, "big")}</a><div class="pb-t">${c.html}
      <h1 class="w-title"${lang(l)}>${esc(title)}</h1>
      <div class="w-meta">${l.section ? `<span>${esc(l.section)}</span>` : ""}${ldate(l) ? `<span>${ic("calendar", 15)}${ldate(l)}</span>` : ""}${l.duration ? `<span>${ic("clock", 15)}${dur(l.duration)}</span>` : ""}<span>${ic("list-music", 15)}${itemKind(s.id) === "khutba" ? "الخطبة" : itemKind(s.id) === "lesson" ? "الدرس" : "المادة"} ${fmtNum(i + 1)} من ${fmtNum(sib.length)}</span></div>
      ${useLabel(l) ? `<p class="orig">${esc(l.title)}</p>` : ""}${player}</div>`, "lesson-band");
  const html = `<div class="btns">
        ${next ? `<a class="btn pri" id="next" rel="next" href="${href.lesson(next.id)}">التالي ${ic("chevron-left", 17)}</a>` : `<span class="btn pri" aria-disabled="true">التالي ${ic("chevron-left", 17)}</span>`}
        ${prev ? `<a class="btn" rel="prev" href="${href.lesson(prev.id)}">${ic("chevron-left", 17, "flip")} السابق</a>` : `<span class="btn" aria-disabled="true">${ic("chevron-left", 17, "flip")} السابق</span>`}
        ${ext}<button type="button" class="btn" id="share">${ic("link", 17)} نسخ الرابط</button></div>
    <section class="side" aria-labelledby="side-h">${head2(`<span id="side-h">دروس السلسلة</span>`, more(href.series(s.id), `كل الدروس (${fmtNum(sib.length)})`))}
      <div class="list">${win.map(x => row(x, { now: x.id === l.id, inSeries: true })).join("")}</div></section>`;
  const desc = clip(`${title}${title.includes(s.title) ? "" : " — " + s.title}${ldate(l) ? "، " + ldate(l) : ""}. ${l.kind === "audio" ? "درس صوتي" : "درس مرئي"} لفضيلة الشيخ ${FULL_NAME} حفظه الله، للاستماع والتحميل.`, 200);
  const ld = l.kind === "audio"
    ? !l.src ? { "@type": "AudioObject", url: tg || SITE + (vid || href.lesson(l.id)) }
    : { "@type": "AudioObject", contentUrl: safeUrl(l.src), encodingFormat: MIME[(l.src.split("?")[0].split(".").pop() || "").toLowerCase()] || "audio/mpeg" }
    : { "@type": "VideoObject", thumbnailUrl: [`https://i.ytimg.com/vi/${safeYt(l.id)}/hqdefault.jpg`], embedUrl: `https://www.youtube.com/embed/${safeYt(l.id)}` };
  const when = /^\d{4}-\d\d-\d\d$/.test(l.date || "") ? `${l.date}T00:00:00+03:00` : l.date;   // Google wants a full datetime with a zone; our dates are Riyadh days
  return mkPage({
    nav: s.sec, path: href.lesson(l.id), band: bandHtml, html, wire: { t: "lesson", id: l.id, next: next ? href.lesson(next.id) : "" }, ogType: "article",
    image: l.kind === "video" ? `https://i.ytimg.com/vi/${safeYt(l.id)}/hqdefault.jpg` : OG_DEFAULT,
    title: withSite(title), description: desc,
    jsonld: [c.ld, { "@context": "https://schema.org", ...ld, name: title, description: desc, inLanguage: "ar",
      ...(l.date ? (l.kind === "video" ? { uploadDate: when } : { dateCreated: when }) : {}), ...(l.duration ? { duration: isoDur(l.duration) } : {}),
      author: { "@type": "Person", name: FULL_NAME, url: SITE + (state.bio ? href.about() : "/") }, isPartOf: { "@type": "CreativeWorkSeries", name: s.title, url: SITE + href.series(s.id) } }],
  });
}

/* the next lesson after l in its series' listening order (oldest first, or by number) */
export const nextLesson = l => { const info = seriesInfo(l.series); if (!info) return null; const o = listenOrder(info); return o[o.indexOf(l) + 1] || null; };

/* search: client-side only (noindex); this is the shell, the results are painted by app.js */
export function searchResults(st) {
  const r0 = state.DB.lessons.filter(l => (!st.sec || secOfLesson(l).id === st.sec) && match(l, st.q));
  const r = st.sort === "old" ? r0.slice().reverse() : r0;
  return { count: r.length, more: r.length > st.shown,
    html: r.length ? `<div class="list cols">${r.slice(0, st.shown).map((l, i) => row(l, { showSeries: true, i })).join("")}</div>` : `<p class="empty">لا توجد نتائج مطابقة. جرّب كلمات أقل أو اكتب اسم الكتاب فقط.</p>` };
}
function searchPage(params) {
  const st = { q: cleanQuery(params.get("q")), sec: oneOf(params.get("sec"), SECTIONS.map(s => s.id)), sort: oneOf(params.get("sort"), ["new", "old"], "new"), shown: PAGE };
  const vis = visible().filter(s => s.id !== "books"), c = crumbs([{ t: "بحث" }]);
  return mkPage({
    nav: "search", path: "/search/", noindex: true, wire: { t: "search" },
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("search", 34)}</span>`, "البحث في المكتبة", ""),
    html: `
      <div class="bar">${searchBox("ابحث في كل الدروس والمحاضرات…", st.q)}
        <select id="sort" aria-label="الترتيب"><option value="new">الأحدث أولًا</option><option value="old"${st.sort === "old" ? " selected" : ""}>الأقدم أولًا</option></select></div>
      <div class="pill-row" id="secs" role="group" aria-label="تصفية حسب القسم"><button type="button" class="pill${st.sec ? "" : " on"}" aria-pressed="${!st.sec}" data-s="">الكل</button>${vis.map(s => `<button type="button" class="pill${st.sec === s.id ? " on" : ""}" aria-pressed="${st.sec === s.id}" data-s="${s.id}">${s.title}</button>`).join("")}</div>
      <p class="count" id="count" role="status"></p><div id="out"><noscript><p class="empty">البحث يحتاج إلى تفعيل جافاسكربت في المتصفح.</p></noscript></div>`,
    title: withSite("البحث في المكتبة"), description: `ابحث في دروس ومحاضرات وخطب ${NAME_FULL}.`,
  });
}

function booksPage() {
  const DB = state.DB; if (!DB.books.length) return null;
  const groups = [];
  DB.books.forEach(k => { const g = k.group || "الكتب"; let e = groups.find(x => x.g === g); if (!e) groups.push(e = { g, items: [] }); e.items.push(k); });
  const files = k => k.files || (k.url ? [{ label: "تحميل", url: k.url }] : []);
  const card = (k, i) => {
    const f = files(k), multi = f.length > 1, main = k.title.split(/\s[–—-]\s/)[0].replace(/\s*\(.*$/, "");
    return `<article class="book" style="--i:${Math.min(i, 12)}"${safeLang(k.lang) ? ` lang="${safeLang(k.lang)}"` : ""}>
      <div class="cover">${k.cover ? `<img loading="lazy" src="${esc(safeUrl(k.cover))}" alt="">` : `<span class="cover-t" aria-hidden="true">${esc(main)}</span>`}</div>
      <div class="book-b"><h3>${esc(k.title)}</h3>${k.desc ? `<p>${esc(k.desc)}</p>` : ""}${k.note ? `<p class="note">${esc(k.note)}</p>` : ""}
        <div class="btns">${f.map((x, n) => `<a class="btn${n === 0 && !multi ? " pri" : " sm"}" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" aria-label="${esc((multi ? x.label : "تحميل") + " — " + k.title)}">${n === 0 || !multi ? ic("download", 16) + " " : ""}${esc(multi ? x.label : (x.label || "تحميل"))}</a>`).join("")}</div></div></article>`;
  };
  const c = crumbs([{ t: "الكتب" }]);
  return mkPage({
    nav: "books", path: "/books/",
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("book-open", 34)}</span>`, "الكتب", `${secById.books.desc} — ${count(DB.books.length, "book")}`),
    html: `${groups.map(g => `<section>${head2(esc(g.g))}<div class="books">${g.items.map(card).join("")}</div></section>`).join("")}`,
    title: withSite(`الكتب — ${count(DB.books.length, "book")} للقراءة والتحميل`), description: `مؤلفات ${NAME_FULL} وتحقيقاته وبحوثه للقراءة والتحميل (PDF).`, jsonld: [c.ld],
  });
}

function announcementsPage() {
  const c = crumbs([{ t: "الإعلانات" }]), list = state.ann;
  return mkPage({
    nav: "announcements", path: href.announcements(),
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("calendar", 34)}</span>`, "إعلانات الدروس", "مواعيد دروس الشيخ وأماكنها. اضغط على الإعلان لعرضه بالحجم الكامل."),
    html: list.length ? `<div class="posters">${list.map((a, i) => poster(a, i, true)).join("")}</div>` : `<p class="empty">لا توجد إعلانات حالية.</p>`,
    title: withSite("إعلانات الدروس"), description: `مواعيد دروس ${NAME_FULL} وأماكنها.`, jsonld: [c.ld],
  });
}

/* «تواصل معنا» (owner 2026-11-18): an anonymous form, no mail app. worker/contact.js checks Turnstile, saves it in D1 and emails
   info@h-haddadi.com. Works without JavaScript as a plain form post (the Worker redirects back with ?s=<result>); app.js sends it with fetch. */
export const CONTACT_MSG = { sent: "وصلت رسالتك، جزاك الله خيرًا. سنرد عليك إن تركت وسيلة للتواصل.", body: "اكتب رسالتك أولًا (خمسة أحرف على الأقل).",
  captcha: "لم يكتمل التحقق من أنك لست برنامجًا آليًا. أعد المحاولة.", down: "تعذّر إرسال الرسالة الآن. حاول مرة أخرى بعد قليل.", bad: "تعذّر إرسال الرسالة. حاول مرة أخرى." };
function contactPage(params) {
  const c = crumbs([{ t: "تواصل معنا" }]), s = params.get("s"), msg = CONTACT_MSG[s] ? CONTACT_MSG[s] : "";
  return mkPage({
    nav: "contact", path: href.contact(),
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("mail", 34)}</span>`, "تواصل معنا", "اكتب رسالتك إلى القائمين على الموقع. لا يلزمك ذكر اسمك ولا بريدك، ولا نحفظ عنك شيئًا سوى ما تكتبه."),
    html: `<div class="contact"><form class="cform" id="cform" method="post" action="/api/contact" novalidate>
      <p class="cform-st${s === "sent" ? " ok" : msg ? " err" : ""}" id="cform-st" role="status" aria-live="polite">${esc(msg)}</p>
      <div class="fld"><label for="cf-name">الاسم <small>(اختياري)</small></label><input id="cf-name" name="name" type="text" maxlength="80" autocomplete="name"></div>
      <div class="fld"><label for="cf-reply">البريد أو رقم الجوال <small>(اختياري، إن أردت أن نرد عليك)</small></label><input id="cf-reply" name="reply" type="text" maxlength="120" dir="auto" inputmode="email" autocomplete="email"></div>
      <div class="fld"><label for="cf-body">الرسالة</label><textarea id="cf-body" name="body" rows="7" maxlength="4000" required aria-required="true" aria-describedby="cf-body-h"></textarea><small id="cf-body-h" class="hint">من خمسة أحرف إلى ٤٬٠٠٠ حرف.</small></div>
      <div class="hp" aria-hidden="true"><label for="cf-web">اترك هذا الحقل فارغًا</label><input id="cf-web" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <div class="cf-ts" id="cf-ts" data-sitekey="${esc(tsKey())}"></div>
      <noscript><p class="hint">يحتاج التحقق من أنك لست برنامجًا آليًا إلى تفعيل JavaScript.</p></noscript>
      <button type="submit" class="btn cform-go" id="cform-go">${ic("send", 19)}<span>إرسال الرسالة</span></button>
    </form>
    <aside class="c-side" aria-labelledby="c-side-h"><h2 id="c-side-h">قنوات الشيخ</h2><p>تُنشر الدروس والإعلانات أولًا بأول في:</p>
      <ul class="c-links" role="list">${LINKS.map(x => `<li><a class="c-${x.b}" href="${x.h}" target="_blank" rel="noopener" aria-label="${esc(x.t)} (يفتح في نافذة جديدة)">${brand(x.b, 22)}<span>${{ telegram: "قناة تيليجرام", whatsapp: "مجموعة واتساب", youtube: "قناة يوتيوب" }[x.b] || esc(x.s)}</span>${ic("external-link", 15)}</a></li>`).join("")}</ul>
      <p class="c-note">${ic("shield-check", 17)} رسالتك تصل إلى القائمين على الموقع وحدهم، ولا نعرضها لأحد.</p></aside></div>`,
    title: withSite("تواصل معنا"), description: `راسل القائمين على موقع ${NAME_FULL}، دون الحاجة إلى بريد إلكتروني.`, jsonld: [c.ld], wire: { t: "contact" },
  });
}

/* The weekly schedule (SCHEDULE in core.js): the book links to its series, the number to the latest lesson given at that mosque.
   «جديد» marks a series whose latest lesson is under NEW_DAYS days old; app.js hides it once that date passes (pages are pre-rendered). */
const NEW_DAYS = 7;
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function schedLatest(x) {
  if (!x.series || !seriesById[x.series]) return null;
  const re = x.match ? new RegExp(x.match) : null;
  const ls = state.DB.lessons.filter(l => l.series === x.series && (!re || re.test(l.title)));
  return ls.length ? { n: ls.length, last: ls.reduce((a, l) => (l.date || "") > (a.date || "") ? l : a) } : null;
}
export function scheduleTable(cls = "") {
  const today = todayRiyadh();
  const rows = SCHEDULE.items.map(x => {
    const s = x.series && seriesById[x.series], got = schedLatest(x);
    const until = got && /^\d{4}-\d\d-\d\d$/.test(got.last.date || "") ? addDays(got.last.date, NEW_DAYS) : "";
    const fresh = until && until >= today ? `<span class="sc-new" data-until="${until}">جديد</span>` : "";
    const book = s ? `<a href="${href.series(s.id)}">${esc(x.book)}</a>${fresh}` : `<span>${esc(x.book)}</span>`;
    const lastT = x.series === "khutab" ? "آخر خطبة" : "آخر درس";
    const last = got ? `<a class="sc-n" href="${href.lesson(got.last.id)}" title="${lastT}: ${esc(fullTitle(got.last))}" aria-label="${lastT}: ${esc(fullTitle(got.last))}">${ic("play", 14)}${lastT}</a>`
      : `<span class="sc-n none" title="لم تُنشر دروس منه بعد" aria-label="لم تُنشر دروس منه بعد">—</span>`;
    return `<tr><td class="sc-day">${esc(x.when)}</td><td class="sc-time">${esc(x.time)}</td>
      <td class="sc-book">${book}<span class="sc-place">${ic("map-pin", 14)} ${esc(x.mosque)}، ${esc(x.area)}${got ? `<span class="sc-count">${ic("list-music", 14)} ${count(got.n, itemKind(x.series))}</span>` : ""}</span></td><td class="sc-last">${last}</td></tr>`;
  }).join("");
  const tog = (v, i, t, on) => `<button type="button" data-sv="${v}" aria-pressed="${on}">${ic(i, 16)} ${t}</button>`;
  return `<div class="sv" role="group" aria-label="طريقة عرض الجدول">${tog("cards", "layout-list", "بطاقات", true)}${tog("table", "table-2", "جدول", false)}</div>
    <div class="sched-w${cls ? " " + cls : ""}"><table class="sched"><caption class="sr-only">${esc(SCHEDULE.title)} ${esc(SCHEDULE.year)}</caption>
    <thead><tr><th scope="col">اليوم</th><th scope="col">الوقت</th><th scope="col">الدرس والمكان</th><th scope="col"><span class="sr-only">الاستماع</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function schedulePage() {
  const c = crumbs([{ t: "جدول الدروس" }]), pin = state.ann.find(a => a.pin);
  return mkPage({
    nav: "schedule", path: href.schedule(),
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("calendar-days", 34)}</span>`, "جدول الدروس الأسبوعي",
      `${esc(SCHEDULE.title)} ${esc(SCHEDULE.year)}، من ${esc(SCHEDULE.from)}. اضغط اسم الكتاب لفتح سلسلته، أو «آخر درس» للاستماع إلى أحدث ما نُشر منه.`),
    html: `<div class="sched-page">${scheduleTable()}</div>${pin ? `${head2("إعلان الجدول")}<div class="posters">${poster(pin, 0, true)}</div>` : ""}`,
    title: withSite(`جدول الدروس الأسبوعي — ${SCHEDULE.title}`), description: clip(`مواعيد دروس ${NAME_FULL} الأسبوعية وأماكنها: ${SCHEDULE.items.map(x => x.book).join("، ")}.`, 200), jsonld: [c.ld],
  });
}

/* Scholars' recommendations (photos + transcription) and written advice (PDFs), from DOCS in core.js */
const docTile = (d, i) => `<figure class="poster" style="--i:${i}"><a class="poster-img" href="${href.documents()}#${d.id}"><img src="${d.thumb}" alt="${esc(d.title)}" width="560" height="${d.h ? Math.round(d.h * 560 / d.w) : 725}" loading="lazy" decoding="async"></a>
    <figcaption><span class="t">${esc(d.title)}</span><span class="s">${ic("calendar", 14)} ${esc(d.date)}</span></figcaption></figure>`;
export const hasDocs = () => DOCS.tazkiyat.length + DOCS.wasaya.length > 0;
export const docsHome = () => [...DOCS.tazkiyat, ...DOCS.wasaya].slice(0, 4).map(docTile).join("");
function documentsPage() {
  const c = crumbs([{ t: "التزكيات والوصايا" }]);
  const letter = (d, i) => `<article class="doc" id="${d.id}" style="--i:${i}" aria-labelledby="${d.id}-h">
      <a class="doc-img" href="${d.image}" target="_blank" rel="noopener" aria-label="عرض الصورة بالحجم الكامل: ${esc(d.title)}"><img src="${d.thumb}" alt="صورة ${esc(d.title)}" width="560" height="${Math.round(d.h * 560 / d.w)}" loading="lazy" decoding="async"></a>
      <div class="doc-b"><h3 id="${d.id}-h">${esc(d.title)}</h3><p class="doc-m">${ic("calendar", 15)} ${esc(d.date)}</p>
        <div class="doc-text">${d.text.map(t => `<p>${esc(t)}</p>`).join("")}</div>${d.note ? `<p class="doc-note">${esc(d.note)}</p>` : ""}
        <div class="btns"><a class="btn" href="${d.image}" target="_blank" rel="noopener">${ic("external-link", 16)} الصورة بالحجم الكامل</a><a class="btn" href="${d.image}" download="${esc(d.title)}.jpg">${ic("download", 16)} تحميل الصورة</a></div></div></article>`;
  const advice = (d, i) => `<article class="book" id="${d.id}" style="--i:${i}"><a class="doc-pdf" href="${d.pdf}" target="_blank" rel="noopener" aria-label="قراءة: ${esc(d.title)}"><img src="${d.thumb}" alt="" width="560" height="725" loading="lazy" decoding="async"></a>
      <div class="book-b"><h3>${esc(d.title)}</h3><p class="doc-m">${ic("file-text", 15)} كتبها: ${esc(d.by)}</p><p class="doc-m">${ic("calendar", 15)} ${esc(d.date)}</p>${d.desc ? `<p>${esc(d.desc)}</p>` : ""}
        <div class="btns"><a class="btn pri" href="${d.pdf}" target="_blank" rel="noopener">${ic("book-open", 16)} قراءة (PDF، ${fmtNum(d.pages)} ${d.pages === 1 ? "صفحة" : "صفحات"})</a><a class="btn sm" href="${d.pdf}" download>${ic("download", 15)} تحميل</a></div></div></article>`;
  return mkPage({
    nav: "documents", path: href.documents(),
    band: pageBand(c, `<span class="sec-ic" aria-hidden="true">${ic("award", 34)}</span>`, "التزكيات والوصايا", "تزكيات أهل العلم للشيخ، ووصاياه التي نقلها عنه طلابه مكتوبة."),
    html: `<section aria-labelledby="tz-h">${head2('<span id="tz-h">تزكيات أهل العلم للشيخ</span>')}<div class="docs">${DOCS.tazkiyat.map(letter).join("")}</div></section>
      <section aria-labelledby="ws-h">${head2('<span id="ws-h">وصايا الشيخ مكتوبة</span>')}<div class="books">${DOCS.wasaya.map(advice).join("")}</div></section>`,
    title: withSite("التزكيات والوصايا"), description: `تزكيات أهل العلم ل${NAME_FULL.slice(1)} ووصاياه مكتوبة.`, jsonld: [c.ld],
  });
}

/* Bio text blocks: a string is a paragraph, an array a bullet list, {ol:[…]} a numbered list, {h:"…"} a sub-heading, {links:[{label,url}]} a list of links.
   Older bio.json files with `paragraphs` + `items` still work. Links: https URLs, or a path on this site (e.g. a PDF under /files/). */
const aboutLink = x => {
  const own = typeof x.url === "string" && /^\/[\w./-]+$/.test(x.url);
  const href = esc(own ? x.url : safeUrl(x.url)), ext = own ? "" : ' target="_blank" rel="noopener"';
  if (!x.kind) return `<a href="${href}"${ext}>${esc(x.label || x.url)}</a>`;
  return `<a class="linkcard" href="${href}"${ext}><span class="lc-ic" aria-hidden="true">${ic(x.kind === "pdf" ? "file-text" : "external-link", 22)}</span><span class="lc-tx"><span class="lc-t">${esc(x.label || x.url)}</span>${x.note ? `<span class="lc-n">${esc(x.note)}</span>` : ""}</span><span class="lc-go" aria-hidden="true">${ic("chevron-left", 18)}</span></a>`;
};
const aboutBlocks = sec => {
  const blocks = Array.isArray(sec.blocks) ? sec.blocks : [...(sec.paragraphs || []), ...(sec.items && sec.items.length ? [sec.items] : [])];
  const li = x => `<li>${esc(x).replace(/ \(([^()]+)\)$/, ' <span class="note">($1)</span>')}</li>`;   // a trailing «(مرتين)» is drawn quieter
  return blocks.map(b => Array.isArray(b) ? `<ul>${b.map(li).join("")}</ul>`
    : b && typeof b.h === "string" ? `<h3>${esc(b.h)}</h3>`
    : b && Array.isArray(b.ol) ? `<ol>${b.ol.map(x => `<li>${esc(x)}</li>`).join("")}</ol>`
    : b && Array.isArray(b.links) ? `<ul class="links">${b.links.map(x => `<li>${aboutLink(x)}</li>`).join("")}</ul>`
    : `<p>${esc(b)}</p>`).join("");
};

function aboutPage() {
  const b = state.bio; if (!b) return null;
  const c = crumbs([{ t: "عن الشيخ" }]);
  const photo = b.photo && /^(\/[\w./-]+|https:\/\/.+)$/.test(b.photo) ? b.photo : "";
  const pre = Array.isArray(b.preface) ? b.preface.filter(x => typeof x === "string") : [];   // opening paragraphs before the first section
  const html = `<div class="about">${c.html}
    <header class="about-h">${photo ? `<img class="about-photo" src="${esc(photo)}" alt="${esc(NAME)}" width="220" height="220">` : ""}<div>${b.basmala ? `<p class="about-basmala">${esc(b.basmala)}</p>` : ""}<h1 class="page-h">${esc(b.title || NAME)}<span class="dua"> حفظه الله</span></h1>${!pre.length && (b.lede || b.summary) ? `<p class="lede">${esc(b.lede || b.summary)}</p>` : ""}</div></header>
    ${pre.length ? `<div class="about-pre">${pre.map(x => `<p>${esc(x)}</p>`).join("")}</div>` : ""}
    ${(b.sections || []).map(sec => `<section class="about-sec${sec.extra ? " about-extra" : ""}${sec.cols ? " about-cols" : ""}"><h2>${esc(sec.title || "")}</h2>${sec.intro ? `<p class="about-intro">${esc(sec.intro)}</p>` : ""}${aboutBlocks(sec)}</section>`).join("")}
    ${b.sources && b.sources.length ? `<section class="about-sec"><h2>المصادر</h2><ul>${b.sources.map(x => `<li>${x.url ? `${aboutLink(x)}` : esc(x.label || "")}</li>`).join("")}</ul></section>` : ""}</div>`;
  return mkPage({
    nav: "about", path: "/about/", html, ogType: "profile",
    title: withSite("عن الشيخ"), description: clip(b.summary || `نبذة عن ${NAME_FULL}.`, 160),
    jsonld: [c.ld, { "@context": "https://schema.org", "@type": "Person", name: FULL_NAME, alternateName: ["حسن بن علي حدادي", "حسن حدادي", "الشيخ حسن حدادي", "الشيخ حسن بن علي حدادي"], honorificPrefix: "الشيخ", url: SITE + "/about/", ...(photo ? { image: photo.startsWith("/") ? SITE + photo : photo } : {}), sameAs: LINKS.map(x => x.h) }],
  });
}

export function notFoundPage() {
  return mkPage({ status: 404, noindex: true, nav: "", path: "/404.html", title: withSite("الصفحة غير موجودة"), description: "الصفحة المطلوبة غير موجودة.",
    html: `<div class="empty"><h1>الصفحة غير موجودة</h1><p><a class="btn pri" href="/">العودة للرئيسية</a> <a class="btn" href="/search/">البحث في المكتبة</a></p></div>` });
}

/* path -> page. Unknown or malformed paths give the 404 page. */
export function resolve(pathname, params = new URLSearchParams()) {
  const raw = String(pathname).split("/").filter(Boolean);
  const segs = raw.map(x => safeDecode(x).slice(0, 80));
  if (segs.some((x, i) => x === "" && raw[i] !== "")) return notFoundPage();      // malformed %-encoding
  const [a, b] = segs;
  let p = null;
  if (!a || a === "index.html") p = home();
  else if (segs.length === 1 && a === "library") p = library();
  else if (segs.length === 1 && a === "books") p = booksPage();
  else if (segs.length === 1 && a === "about") p = aboutPage();
  else if (segs.length === 1 && a === "announcements") p = announcementsPage();
  else if (segs.length === 1 && a === "schedule" && SCHEDULE.items.length) p = schedulePage();
  else if (segs.length === 1 && a === "tazkiyat" && hasDocs()) p = documentsPage();
  else if (segs.length === 1 && a === "search") p = searchPage(params);
  else if (segs.length === 1 && a === "contact" && hasContact()) p = contactPage(params);
  else if (segs.length === 2 && a === "section") p = sectionPage(b);
  else if (segs.length === 2 && a === "series") p = seriesPage(b);
  else if (segs.length === 2 && a === "lesson") p = lessonPage(b);
  return p || notFoundPage();
}


/* ───────── Chrome: header, drawer, docked player, bottom bar, footer, <head> ───────── */
const navItems = () => {
  const items = [...visible().map(s => ({ id: s.id, t: s.title, i: s.icon, h: href.section(s), n: s.id === "books" ? 0 : sectionCount(s.id) }))];
  if (state.bio) items.push({ id: "about", t: "عن الشيخ", i: "book-marked", h: href.about() });
  return items;
};
const extraItems = () => [...(SCHEDULE.items.length ? [{ id: "schedule", t: "جدول الدروس", i: "calendar-days", h: href.schedule() }] : []), ...(state.ann.length ? [{ id: "announcements", t: "إعلانات الدروس", i: "calendar", h: href.announcements(), n: state.ann.length }] : []),
  ...(hasDocs() ? [{ id: "documents", t: "التزكيات والوصايا", i: "award", h: href.documents() }] : [])];
const cur = (nav, id) => nav === id ? ' class="on" aria-current="page"' : "";
export function chromeTop(nav) {
  const items = navItems();
  const drawerItems = [{ id: "home", t: "الرئيسية", i: "house", h: "/" }, { id: "library", t: "كل الأقسام", i: "layout-grid", h: href.library() }, { id: "search", t: "بحث", i: "search", h: href.search() }, ...extraItems(), ...items];
  return `<header class="top"><div class="wrap top-in">
    <a class="brand" href="/" aria-label="${esc(NAME_FULL)} — الرئيسية"><span class="mark" aria-hidden="true">${LOGO}</span><span><strong>${NAME} <span class="hd">حفظه الله</span></strong><small>دروس ومحاضرات وخطب</small></span></a>
    <nav class="nav" id="nav" aria-label="الأقسام"><a href="/" data-nav="home"${cur(nav, "home")}>الرئيسية</a>${items.map(x => `<a href="${x.h}" data-nav="${x.id}"${cur(nav, x.id)}>${x.t}</a>`).join("")}</nav>
    <a class="icon-btn" id="hsearch" href="${href.search()}" aria-label="بحث">${ic("search", 19)}</a>
    <button type="button" class="icon-btn" id="theme" aria-label="تبديل الوضع الليلي">${ic("moon", 19)}</button>
    <button type="button" class="icon-btn burger" id="burger" aria-label="القائمة" aria-expanded="false" aria-controls="drawer">${ic("menu", 21)}</button>
  </div></header>
  <div class="scrim" id="scrim" hidden></div>
  <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="القائمة الرئيسية" aria-hidden="true">
    <div class="drawer-h"><span>القائمة</span><button type="button" class="icon-btn" id="drawer-x" aria-label="إغلاق">${ic("x", 21)}</button></div>
    <nav class="drawer-nav" id="drawer-nav" aria-label="القائمة">${drawerItems.map(x => `<a href="${x.h}" data-nav="${x.id}"${cur(nav, x.id)}>${ic(x.i, 21)}<span>${x.t}</span>${x.n ? `<small>${fmtNum(x.n)}</small>` : ""}</a>`).join("")}</nav>
    <div class="drawer-f">${newTab(LINKS.map(x => `<a href="${x.h}" target="_blank" rel="noopener">${brand(x.b, 18)} ${x.t}</a>`).join(""))}${hasContact() ? `<a href="${href.contact()}">${ic("mail", 18)} تواصل معنا</a>` : ""}</div>
  </aside>`;
}
/* The docked player: one <audio> for the whole visit, so listening carries on while the visitor browses. Filled by app.js. */
const dock = () => `<div class="dock" id="dock" hidden><div class="wrap dock-in">
    <a class="d-l" id="d-link" href="/"><span class="art mini" id="d-art" aria-hidden="true"></span><span class="tt"><span class="t" id="d-title"></span><span class="s" id="d-sub"></span></span></a>
    <div class="d-ctl">${cbtn("d-next", "skip-forward", "الدرس التالي", 20)}${cbtn("d-fwd", "rotate-cw", "تقديم ١٥ ثانية", 22)}${cbtn("d-play", "play", "تشغيل", 22, "cb play")}${cbtn("d-back", "rotate-ccw", "رجوع ١٥ ثانية", 22)}${cbtn("d-prev", "skip-back", "الدرس السابق", 20)}</div>
    <div class="d-pr"><span id="d-cur">٠:٠٠</span><input type="range" class="seek" id="d-seek" min="0" max="0" value="0" step="1" aria-label="موضع التشغيل"><span id="d-dur"></span></div>
    <button type="button" class="d-rate" id="d-rate" aria-label="سرعة التشغيل">${speedLabel(1)}</button>
    ${cbtn("d-q", "list-video", "قائمة التشغيل", 21)}${cbtn("d-x", "x", "إغلاق المشغل", 20)}
    <audio id="d-aud" preload="none"></audio></div>
    <div class="qp" id="qp" hidden role="dialog" aria-label="قائمة التشغيل"><div class="qp-h"><span><strong>قائمة التشغيل</strong><small id="qp-sub"></small></span>${cbtn("qp-x", "x", "إغلاق قائمة التشغيل", 20)}</div><ol class="qp-l" id="qp-l"></ol></div></div>`;
export function chromeBottom(nav) {
  const vis = navItems(), extra = ["lectures", "khutab", "books"].map(id => vis.find(s => s.id === id)).filter(Boolean)[0];
  const items = [{ id: "home", t: "الرئيسية", i: "house", h: "/" }, { id: "library", t: "الأقسام", i: "layout-grid", h: href.library() }, { id: "search", t: "بحث", i: "search", h: href.search(), mid: true }];
  if (SCHEDULE.items.length) items.push({ id: "schedule", t: "الجدول", i: "calendar-days", h: href.schedule() });
  else if (extra) items.push({ id: extra.id, t: extra.t.replace("الدروس ", ""), i: extra.i, h: extra.h });
  return `${dock()}<nav class="bottom" id="bottom" aria-label="التنقل السريع">${items.map(x => `<a class="bn${x.mid ? " mid" : ""}" href="${x.h}" data-nav="${x.id}"${nav === x.id ? ' aria-current="page"' : ""}><span class="bn-i">${ic(x.i, x.mid ? 24 : 22)}</span><span>${x.t}</span></a>`).join("")}
    <a class="bn" href="#" role="button" data-nav="more" id="bn-more"><span class="bn-i">${ic("menu", 22)}</span><span>المزيد</span></a></nav>`;
}
/* Social links as icon buttons: the official Telegram and WhatsApp marks (owner 2026-11-18). Contact is the «تواصل معنا» button beside them. */
export const socials = () => `<ul class="soc" role="list">${LINKS.map(x => `<li><a class="soc-${x.b}" href="${x.h}" target="_blank" rel="noopener" title="${esc(x.t)}" aria-label="${esc(x.t)} (يفتح في نافذة جديدة)">${brand(x.b, 22)}</a></li>`).join("")}</ul>`;
export function footer() {
  return `<footer class="foot"><div class="wrap foot-in">
  <div class="foot-brand">
    <a class="foot-id" href="/"><span class="mark" aria-hidden="true">${LOGO}</span><span><small>${esc(OFFICIAL_PRE)}</small><strong>${esc(FULL_NAME)}</strong><span class="hd">حفظه الله ورعاه</span></span></a>
    <p class="foot-tag">دروس ومحاضرات وخطب الشيخ في جدة، مرتبة في سلاسل يسهل الاستماع إليها ومتابعتها.</p>
  </div>
  <div class="foot-reach">
    ${socials()}
    ${hasContact() ? `<a class="foot-cta" href="${href.contact()}">${ic("mail", 19)}<span>تواصل معنا</span></a>` : ""}
  </div>
  </div>
  <div class="foot-bar"><div class="wrap foot-bar-in">
    <p>التسجيلات من قناة الشيخ على تيليجرام، وآخر تحديث للفهرس ${fmtDate(state.DB.updated)}</p>
    <a class="foot-top" href="#app">${ic("arrow-up", 17)}<span>أعلى الصفحة</span></a>
  </div></div></footer>`;
}

export function headHtml(p) {
  const url = SITE + p.path;
  return `<title>${esc(p.title)}</title>
<meta id="m-desc" name="description" content="${esc(p.description)}">
<link id="m-canon" rel="canonical" href="${esc(url)}">
<meta id="m-robots" name="robots" content="${p.noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}">
<meta property="og:site_name" content="${esc(OFFICIAL_NAME)}"><meta property="og:locale" content="ar_SA"><meta id="og-type" property="og:type" content="${p.ogType}">
<meta id="og-title" property="og:title" content="${esc(ogTitle(p))}"><meta id="og-desc" property="og:description" content="${esc(p.description)}">
<meta id="og-url" property="og:url" content="${esc(url)}"><meta id="og-img" property="og:image" content="${esc(p.image)}">${p.image === OG_DEFAULT ? `
<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(OFFICIAL_NAME)} حفظه الله ورعاه">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta id="tw-title" name="twitter:title" content="${esc(ogTitle(p))}"><meta id="tw-desc" name="twitter:description" content="${esc(p.description)}"><meta id="tw-img" name="twitter:image" content="${esc(p.image)}">
<meta name="theme-color" content="#3a2a1e">
${p.jsonld.length ? `<script id="ld" type="application/ld+json">${jsonLd(p.jsonld)}</script>` : '<script id="ld" type="application/ld+json">[]</script>'}`;
}
