/* Shared by the browser app and the Node pre-renderer: constants, helpers, data model. No DOM access here. */
import { ICONS, BRANDS } from "./icons.js";

/* Absolute base for link previews (og:image/og:url), canonical links and the sitemap: the site's domain, h-haddadi.com (attached to the
   Worker as a custom domain 2026-11-17, with www.h-haddadi.com). SITE_URL in the build environment overrides it. */
export const SITE = ((typeof process !== "undefined" && process.env && process.env.SITE_URL) || "https://h-haddadi.com").replace(/\/$/, "");
export const NAME = "الشيخ حسن بن علي حدادي";
export const NAME_FULL = `${NAME} حفظه الله`;
export const OFFICIAL_PRE = "الموقع الرسمي لفضيلة الشيخ";   // owner 2026-11-17: «الموقع الرسمي لفضيلة الشيخ حسن بن علي بن حسن حدادي»
export const FULL_NAME = "حسن بن علي بن حسن حدادي";
export const ROLE = "";
export const OFFICIAL_NAME = `${OFFICIAL_PRE} ${FULL_NAME}`;
export const YT_CHANNEL = "";
export const TG_CHANNEL = "https://t.me/h_haddadi7";
export const TG_CHANNEL_2 = "https://t.me/masothrbj47";   // lessons are still imported from it; not linked (owner 2026-11-17)
export const WA_GROUP = "https://chat.whatsapp.com/BupKFX5G3236scpMYX05L1";
export const LINKS = [
  { t: "قناة الشيخ على تيليجرام", s: "تيليجرام", b: "telegram", h: TG_CHANNEL }, { t: "مجموعة الشيخ على واتساب", s: "واتساب", b: "whatsapp", h: WA_GROUP },
];
/* «تواصل معنا»: the address the footer button and the drawer link write to. Empty = the button is not shown. */
export const CONTACT_EMAIL = "info@h-haddadi.com";   // Cloudflare Email Routing forwards it (owner 2026-11-18)

/* ───────── Site structure ─────────  Every series belongs to one section (series.sec). Books are their own collection. */
export const SECTIONS = [
  { id: "tafsir",   title: "التفسير",          icon: "book-marked",  desc: "دروس التفسير: مقدمة في أصول التفسير وتفسير قصار السور وغيرهما." },
  { id: "hadith",   title: "الحديث",           icon: "library-big",  desc: "شروح كتب الحديث: الأربعين النووية وعمدة الأحكام وكتاب الإمارة من صحيح مسلم وبهجة قلوب الأبرار." },
  { id: "aqeedah",  title: "العقيدة",          icon: "book-open",    desc: "شروح كتب العقيدة: كتاب التوحيد وسلم الوصول وكشف الشبهات والقواعد الأربع وكتب ابن القيم." },
  { id: "fiqh",     title: "الفقه",            icon: "file-text",    desc: "دروس في الفقه: مسائل الحج والعمرة وأحكام الصيام." },
  { id: "sira",     title: "السيرة",           icon: "compass",      desc: "مختصر السيرة النبوية وسيرة الخلفاء الراشدين." },
  { id: "khutab",   title: "الخطب",            icon: "scroll-text",  desc: "خطب الجمعة والعيدين بجامع عبدالله بن عمار بجدة وغيره." },
  { id: "lectures", title: "المحاضرات",        icon: "mic-vocal",    desc: "محاضرات وكلمات وندوات." },
  { id: "tilawa",   title: "التلاوات",         icon: "headphones",   desc: "تلاوات من الصلوات." },
  { id: "duroos",   title: "الدروس المرئية",   icon: "video",        desc: "الدروس المرئية من قناة الشيخ على يوتيوب." },
  { id: "books",    title: "الكتب",            icon: "book-open",    desc: "مؤلفات الشيخ للقراءة والتحميل." },
];
const UNIT = {};   // numbered-lesson label per series
/* Series covers: a fixed colour per series (COVER) or one from the palette by position. All pass AA with white text. */
export const COVER = {};
export const COVER_PALETTE = ["#1f5f5b", "#8a4a22", "#3a2a1e", "#2f4f6b", "#7a2f26", "#4f5a2a", "#1f6f6a", "#6b4a2f", "#24485a"];   /* Roshan: sea teal, clay, teak … all AA with white text */
export const PAGE = 60;

/* ───────── Data (filled by init) ─────────  lookup tables have no prototype: "__proto__" is not an id */
export const state = { DB: null, bio: null, ann: [] };
export const byId = Object.create(null), seriesById = Object.create(null), secById = Object.create(null);

/* Make our own R2 copy (tools/mirror_media.py -> data/media.json) the primary link and keep the original as src_alt / url_alt.
   The build applies this once and writes the merged library to dist/, so browsers never download the (large) manifest. */
export function applyMedia(lib = {}, media = null) {
  const mm = media && typeof media === "object" ? media : null;
  if (!mm) return lib;
  const mine = u => { const m = Object.prototype.hasOwnProperty.call(mm, u) ? mm[u] : null; return m && typeof m.url === "string" && m.url.startsWith("https://") ? m.url : ""; };
  return { ...lib,
    lessons: (lib.lessons || []).map(l => {
      if (l.src) return mine(l.src) ? { ...l, src: mine(l.src), src_alt: l.src } : l;
      const u = l.tg && mine(l.tg); if (!u) return l;   // audio fetched from its Telegram post (tools/fetch_audio.py): play ours, keep the post link
      const d = mm[l.tg].duration; return { ...l, src: u, duration: l.duration || (Number.isInteger(d) && d > 0 ? d : 0) };
    }),
    books: (lib.books || []).map(b => ({ ...b, files: b.files.map(f => mine(f.url) ? { ...f, url: mine(f.url), url_alt: f.url } : f) })) };
}

/* Library files that add to library.json (lessons imported from other sources, e.g. data/makkah.json). */
export const mergeLibraries = (...libs) => libs.filter(Boolean).reduce((a, b) => ({ ...a, ...b, series: [...(a.series || []), ...(b.series || [])], lessons: [...(a.lessons || []), ...(b.lessons || [])], books: [...(a.books || []), ...(b.books || [])] }), {});

export function init(cat, lib = {}, bio = null, media = null) {
  lib = applyMedia(lib, media);
  SECTIONS.forEach(s => secById[s.id] = s);
  const DB = {
    series: [...cat.series, ...(lib.series || [])].map(s => ({ ...s, sec: s.sec || "duroos", unit: s.unit || UNIT[s.id] })),
    lessons: [...cat.lessons, ...(lib.lessons || [])].map((l, o) => ({ ...l, kind: l.kind || "video", date: l.date || "", duration: l.duration || 0, o })),
    books: lib.books || [], updated: cat.updated || lib.updated || "",
  };
  DB.series.forEach(s => seriesById[s.id] = s);
  DB.lessons = DB.lessons.filter(l => seriesById[l.series]).sort((a, b) => b.date.localeCompare(a.date) || a.o - b.o);   // dated newest-first, undated last
  DB.lessons.forEach(l => byId[l.id] = l);
  DB.series.forEach(s => {   // uniform per-series stats, whatever the source
    const ls = DB.lessons.filter(l => l.series === s.id), ds = ls.map(l => l.date).filter(Boolean).sort();
    s.count = ls.length; s.seconds = ls.every(l => l.duration) ? ls.reduce((a, l) => a + l.duration, 0) : 0; s.first = ds[0] || ""; s.last = ds[ds.length - 1] || "";
  });
  DB.series = DB.series.filter(s => s.count > 0);
  state.DB = DB;
  state.bio = bio && typeof bio === "object" && (bio.summary || (Array.isArray(bio.sections) && bio.sections.length)) ? bio : null;   // optional: supplied by the Sheikh's team
  return DB;
}

/* ───────── Helpers ───────── */
export const brand = (n, s = 20) => `<svg class="ic brand-${n}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${BRANDS[n] || ""}"/></svg>`;
export const ic = (n, s = 20, cls = "") => `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n] || ""}</svg>`;
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Arabic-insensitive search: drop tashkeel/tatweel, unify alef/ya/ta-marbuta, Arabic digits -> latin
export const norm = s => String(s || "").toLowerCase()
  .replace(/[ً-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const nf = new Intl.NumberFormat("ar-EG", { useGrouping: false });
export const fmtNum = n => nf.format(n);
// Dates are shown in the Hijri (Umm al-Qura) calendar only. Input: YYYY-MM-DD.
const HIJRI = "ar-SA-u-ca-islamic-umalqura-nu-arab";
const hijriFull = new Intl.DateTimeFormat(HIJRI, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const hijriYear = new Intl.DateTimeFormat(HIJRI, { year: "numeric", timeZone: "UTC" });
const at = d => new Date(d + "T12:00:00Z");
export const fmtDate = d => d ? hijriFull.format(at(d)) : "";
const HM = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];
// `hd` = Hijri date taken from the source ("1433-3-2", "1427-3" or just "1426"); otherwise convert the Gregorian `date`.
const fmtHijri = hd => { const [y, m, d] = hd.split("-").map(Number); return [d ? fmtNum(d) : "", m ? HM[m - 1] : "", fmtNum(y), "هـ"].filter(Boolean).join(" "); };
export const ldate = l => l.hd ? fmtHijri(l.hd) : l.date ? fmtDate(l.date) : "";
export const fmtYear = d => d ? hijriYear.format(at(d)).replace(/\s*هـ$/, "") : "";
export const dur = s => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
export const isoDur = s => s ? `PT${Math.floor(s / 3600)}H${Math.floor(s % 3600 / 60)}M${s % 60}S` : "";
/* Arabic number agreement: ١ درس واحد، ٢ درسان، ٣–١٠ دروس، ١١–٩٩ درسًا، ١٠٠ درس، ١٠٣ دروس، ١١١ درسًا … */
export const NOUNS = { lesson: ["درس", "درسان", "دروس", "درسًا", "درس واحد"], series: ["سلسلة", "سلسلتان", "سلاسل", "سلسلة", "سلسلة واحدة"],
  hour: ["ساعة", "ساعتان", "ساعات", "ساعة", "ساعة واحدة"], book: ["كتاب", "كتابان", "كتب", "كتابًا", "كتاب واحد"], item: ["مادة", "مادتان", "مواد", "مادة", "مادة واحدة"],
  result: ["نتيجة", "نتيجتان", "نتائج", "نتيجة", "نتيجة واحدة"],
  khutba: ["خطبة", "خطبتان", "خطب", "خطبة", "خطبة واحدة"], lecture: ["محاضرة", "محاضرتان", "محاضرات", "محاضرة", "محاضرة واحدة"],
  tilawa: ["تلاوة", "تلاوتان", "تلاوات", "تلاوة", "تلاوة واحدة"] };
/* what a series' items are called when counted (owner 2026-11-17: «١٧٤ خطبة», «٧٣ محاضرة», not «درسًا») */
const ITEM = { khutab: "khutba", lectures: "lecture", tilawa: "tilawa" };
export const itemKind = sid => ITEM[sid] || "lesson";
export const count = (n, kind) => {
  const [one, two, few, many, single] = NOUNS[kind], r = n % 100;
  if (n === 1) return single;
  if (n === 2) return two;
  if (r >= 3 && r <= 10) return `${fmtNum(n)} ${few}`;
  if (r >= 11) return `${fmtNum(n)} ${many}`;
  return `${fmtNum(n)} ${one}`;   // 0, 100, 101, 102, 200 …
};
export const hours = s => { const h = Math.round(s / 3600); return h ? count(h, "hour") : ""; };
export const dg = s => String(s ?? "").replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);   // Arabic-Indic digits for titles from any source

/* ───────── Input sanitising ─────────  Everything that comes from the user (search boxes, URL) or from data files goes through these. */
export const MAXQ = 100, MAXTOKENS = 8;
// strip invisible/bidi-control characters (RLO tricks etc.) and control chars; keep ZWNJ/ZWJ used in Persian/Urdu
export const cleanQuery = s => String(s ?? "").normalize("NFC")
  .replace(/[­؜​‎‏‪-‮⁠-⁯﻿]/g, "")
  .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim()
  .slice(0, MAXQ).split(" ").slice(0, MAXTOKENS).join(" ");
export const safeDecode = s => { try { return decodeURIComponent(s); } catch { return ""; } };   // malformed %-sequences must not crash routing
export const oneOf = (v, allowed, dflt = "") => allowed.includes(v) ? v : dflt;                   // whitelist URL parameters
export const safeUrl = u => { try { const x = new URL(String(u)); return x.protocol === "https:" ? x.href : "#"; } catch { return "#"; } };   // https only: no javascript:/data:
export const safeYt = id => /^[\w-]{11}$/.test(String(id)) ? String(id) : "";                       // YouTube ids are exactly 11 chars
export const safeLang = l => /^[a-z]{2,3}$/.test(String(l)) ? String(l) : "";
export const jsonLd = o => JSON.stringify(o).replace(/</g, "\\u003c");                              // safe inside <script type="application/ld+json">

/* ───────── Model helpers ───────── */
export const kindIcon = l => l.kind === "audio" ? "headphones" : "video";
export const useLabel = l => l.kind === "video" && l.n != null && l.series !== "misc";   // YouTube titles are long; show "المجلس N" instead
export const label = l => `${seriesById[l.series].unit || "الدرس"} ${fmtNum(l.n)}`;
export const mainTitle = (l, withBook = true) => useLabel(l) ? `${label(l)}${withBook && l.section ? " — " + l.section : ""}` : dg(l.title);
export const fullTitle = l => { const s = seriesById[l.series]; return useLabel(l) ? `${label(l)} — ${s.title}` : s.ordered ? `${dg(l.title)} — ${s.title}` : dg(l.title); };
export const secOfSeries = s => secById[s.sec] || secById.duroos;
export const secOfLesson = l => secOfSeries(seriesById[l.series]);
export const seriesOrder = (a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || (a.o - b.o);
export const lang = () => "";
export const thumb = id => `https://i.ytimg.com/vi/${safeYt(id)}/mqdefault.jpg`;
/* the site's mark: a roshan (carved window) arch with its lattice, after the old houses of Jeddah's Al-Balad */
/* the big carved roshan window behind the home hero (decorative) */
export const ROSHAN = `<svg viewBox="0 0 300 560" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><defs><pattern id="rl" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M0 0L18 18M18 0L0 18M9 0L0 9L9 18L18 9Z" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="9" cy="9" r="1.6" fill="currentColor"/></pattern><clipPath id="ra"><path d="M58 330V176a92 92 0 0 1 184 0v154z"/></clipPath></defs><g fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M14 40h272M22 28h256M30 16h240" stroke-width="2"/><path d="M36 40v-12" stroke-width="1.4"/><path d="M56 40v-12" stroke-width="1.4"/><path d="M76 40v-12" stroke-width="1.4"/><path d="M96 40v-12" stroke-width="1.4"/><path d="M116 40v-12" stroke-width="1.4"/><path d="M136 40v-12" stroke-width="1.4"/><path d="M156 40v-12" stroke-width="1.4"/><path d="M176 40v-12" stroke-width="1.4"/><path d="M196 40v-12" stroke-width="1.4"/><path d="M216 40v-12" stroke-width="1.4"/><path d="M236 40v-12" stroke-width="1.4"/><path d="M256 40v-12" stroke-width="1.4"/><path d="M40 548V172a110 110 0 0 1 220 0v376z" stroke-width="3"/><path d="M50 548V174a100 100 0 0 1 200 0v374" stroke-width="1.4"/><rect x="58" y="60" width="184" height="270" fill="url(#rl)" clip-path="url(#ra)" stroke="none" opacity=".9"/><path d="M58 330V176a92 92 0 0 1 184 0v154z" stroke-width="2"/><path d="M150 84v246M58 250h184" stroke-width="2"/><path d="M46 338h208M46 352h208" stroke-width="2.4"/><path d="M58 362h184v158H58zM119 362v158M181 362v158" stroke-width="1.8"/><g stroke-width="1" opacity=".8"><path d="M58 372h184"/><path d="M58 384h184"/><path d="M58 396h184"/><path d="M58 408h184"/><path d="M58 420h184"/><path d="M58 432h184"/><path d="M58 444h184"/><path d="M58 456h184"/><path d="M58 468h184"/><path d="M58 480h184"/><path d="M58 492h184"/><path d="M58 504h184"/></g><path d="M30 548h240M24 556h252" stroke-width="2.4"/><path d="M70 556c0 0 4-20 20-22M230 556c0 0-4-20-20-22M150 556c0 0 0-16 0-16" stroke-width="1.6"/><circle cx="150" cy="150" r="14" stroke-width="1.6"/><circle cx="150" cy="150" r="5" fill="currentColor" stroke="none"/></g></svg>`;
export const STAR = `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M10 35V17a10 10 0 0 1 20 0v18z"/><path d="M10 23h20M20 7v28M14 29l6-6 6 6M14 23l6 6 6-6" stroke-width="1.4"/></g></svg>`;

export function match(l, q) {
  if (!q) return true;
  const s = seriesById[l.series];
  const hay = l._h || (l._h = norm(`${l.title} ${s.title} ${secOfSeries(s).title} ${l.section || ""} ${l.n != null ? "المجلس الدرس " + l.n : ""} ${fmtYear(l.date)}`));
  return norm(q).split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

const seriesIn = id => state.DB.series.filter(s => s.sec === id);
export const sectionCount = id => id === "books" ? state.DB.books.length : state.DB.lessons.filter(l => secOfLesson(l).id === id).length;
export const visible = () => SECTIONS.filter(s => sectionCount(s.id) > 0);
export const isFlat = secId => seriesIn(secId).length === 1;   // a section with one series has no page of its own: it links to that series

/* ───────── URLs (real paths, root-relative) ───────── */
export const href = {
  schedule: () => "/schedule/", home: () => "/", library: () => "/library/", books: () => "/books/", about: () => "/about/", announcements: () => "/announcements/", documents: () => "/tazkiyat/",
  series: id => `/series/${encodeURIComponent(id)}/`,
  lesson: id => `/lesson/${encodeURIComponent(id)}/`,
  search: (qs = "") => "/search/" + qs,
  section: sec => sec.id === "books" ? "/books/" : isFlat(sec.id) ? href.series(seriesIn(sec.id)[0].id) : `/section/${encodeURIComponent(sec.id)}/`,
};
export { seriesIn };

/* The weekly lesson schedule, typed from the channel's «🗓️ يوم …» reminders (Nov 2026); update it when they change. day: 0 = Saturday …
   6 = Friday, -1 = daily; series: the series on the site (none yet for a new book); match: picks one mosque's lessons inside a series. */
export const SCHEDULE = {
  title: "دروس الشيخ الأسبوعية بمحافظة جدة", year: "١٤٤٨هـ", from: "تذكيرات قناة الشيخ على تيليجرام",
  items: [
    { book: "كتاب التوحيد", series: "tawhid", day: 1, when: "الأحد", time: "من أذان العشاء إلى بعد الصلاة", mosque: "جامع عبدالله بن عمار", area: "الأندلس" },
    { book: "فضل الإسلام", series: "fadl-islam", day: 2, when: "الاثنين", time: "بعد العشاء", mosque: "مسجد الشيخ محمد بن عثيمين", area: "الربوة" },
    { book: "مختصر سيرة الرسول ﷺ", series: "sira", day: 3, when: "الثلاثاء", time: "بعد العشاء", mosque: "جامع الملك فهد", area: "الشرفية" },
    { book: "كتاب الكبائر للإمام محمد بن عبدالوهاب", series: "kabair", day: 4, when: "الأربعاء", time: "بعد المغرب", mosque: "جامع أسامة بن زيد", area: "الوزيرية" },
    { book: "سلم الوصول إلى علم الأصول", series: "sullam", day: 4, when: "الأربعاء", time: "بعد العشاء", mosque: "جامع طيبة", area: "الوزيرية" },
    { book: "الوابل الصيب لابن القيم", series: "wabil", day: 5, when: "الخميس", time: "بعد المغرب", mosque: "جامع البيان", area: "الصفا" },
    { book: "خطبة الجمعة", series: "khutab", day: 6, when: "الجمعة", time: "صلاة الجمعة", mosque: "جامع عبدالله بن عمار", area: "الأندلس" },
    { book: "الداء والدواء لابن القيم", series: "daa-dawa", day: 6, when: "الجمعة", time: "بعد صلاة الجمعة", mosque: "جامع عبدالله بن عمار", area: "الأندلس" },
  ],
};

/* Recommendation letters and written advice (none yet: add them here, with their files in site/docs/, when the Sheikh's side sends them). */
export const DOCS = { tazkiyat: [], wasaya: [] };

/* Announcement posters (site/data/announcements.json, written by tools/announce_bot.mjs). Only well-formed entries whose
   end date has not passed (Riyadh date) are kept, in the file's order (the bot moves them), drafts left out; the image must be
   one of ours under /ann/. */
export const todayRiyadh = (now = new Date()) => new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
export function setAnnouncements(list, day = todayRiyadh()) {
  state.ann = (Array.isArray(list) ? list : []).filter(a => a && typeof a.title === "string" && /^\/ann\/[0-9a-f]{16}\.(jpg|png|webp)$/.test(a.image)
    && a.draft !== true && (!a.until || (/^\d{4}-\d\d-\d\d$/.test(a.until) && a.until >= day)))   // in the file's order (set in the bot)
    .map(a => ({ id: String(a.id || "").replace(/[^0-9a-f]/g, "").slice(0, 16), title: a.title.slice(0, 160), image: a.image, until: a.until || "", pin: a.pin === true,
      thumb: a.image.replace(/^\/ann\/(\w+)\.\w+$/, "/ann/thumb/$1.webp"), w: Number.isInteger(a.w) && a.w > 0 ? a.w : 1131, h: Number.isInteger(a.h) && a.h > 0 ? a.h : 1600 }));
  return state.ann;
}

/* old hash URLs (#/watch/ID …) -> new paths, used to keep shared links alive */
export function hashToPath(hash) {
  const [path, qs] = String(hash).replace(/^#/, "").split("?");
  const [, a, b0] = path.split("/"), b = b0 ? safeDecode(b0).slice(0, 80) : "";
  if (!a) return "/";
  if (a === "series" && b) return href.series(b);
  if (a === "watch" && b) return href.lesson(b);
  if (a === "section" && b) return secById[b] ? href.section(secById[b]) : "/library/";
  if (a === "books" || a === "library") return `/${a}/`;
  if (a === "search" || a === "lessons") return "/search/" + (qs ? "?" + qs : "");
  return "/";
}
