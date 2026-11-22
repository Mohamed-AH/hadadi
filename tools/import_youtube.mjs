/* data/youtube.json (the Sheikh's videos, curated) -> site/catalogue.json, the section «المرئيات» (sec "duroos").
   Each video's Gregorian date is worked out from the Hijri date in its title (hd, Umm al-Qura), so lists sort with the audio.
   Videos from the Sheikh's own channel (channel_fawaid) carry no date in the title: "posted" = the YouTube upload day (YYYY-MM-DD, or ""
   when YouTube didn't give it); the page shows it as «نُشر …», and an undated video sorts last. */
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const src = JSON.parse(readFileSync(ROOT + "data/youtube.json", "utf8"));
const YT = /^[\w-]{11}$/, HD = /^\d{4}-\d{1,2}-\d{1,2}$/, GD = /^(\d{4}-\d\d-\d\d)?$/;
const P = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
function greg(hd) {   // first Gregorian day whose Umm al-Qura date is hd (search 1445–1460 range around a rough estimate)
  const [y, m, d] = hd.split("-").map(Number), t0 = Date.UTC(622, 6, 19) + ((y - 1) * 354.367 + (m - 1) * 29.53 + d) * 864e5;
  for (let k = -40; k <= 40; k++) {
    const t = new Date(t0 + k * 864e5), p = {};
    for (const x of P.formatToParts(t)) if (/^(year|month|day)$/.test(x.type)) p[x.type] = parseInt(x.value, 10);
    if (p.year === y && p.month === m && p.day === d) return t.toISOString().slice(0, 10);
  }
  throw new Error("no Gregorian day for " + hd);
}
const series = new Map(src.series.map(s => [s.id, { ...s, sec: "duroos", description: s.description || "" }]));
const seen = new Set(), skip = new Set(src.skip || []);
const lessons = src.videos.map(v => {
  if (!YT.test(v.id) || seen.has(v.id)) throw new Error("bad or repeated id " + v.id);
  if (!series.has(v.series)) throw new Error("unknown series " + v.series + " for " + v.id);
  const posted = "posted" in v;
  if (posted ? !GD.test(v.posted) || "hd" in v : !HD.test(v.hd)) throw new Error("hd (or posted) missing or malformed for " + v.id);
  if (!(Number.isInteger(v.duration) && v.duration > 0)) throw new Error("duration missing for " + v.id);
  if (skip.has(v.id)) throw new Error("a skipped video is also listed: " + v.id);
  if (v.n == null && !v.title) throw new Error("a video needs a number or a title: " + v.id);
  seen.add(v.id);
  const s = series.get(v.series);
  const l = posted ? { id: v.id, title: v.title || `${s.title} ${v.n}`, series: v.series, subject: s.subject, kind: "video", date: v.posted, posted: true, duration: v.duration }
    : { id: v.id, title: v.title || `${s.title} ${v.n}`, series: v.series, subject: s.subject, kind: "video", date: greg(v.hd), hd: v.hd, duration: v.duration };
  if (v.n != null) l.n = v.n;
  return l;
}).sort((a, b) => b.date.localeCompare(a.date));   // undated ("") last
const used = new Set(lessons.map(l => l.series));
const out = { updated: "", channel: src.channel, subjects: [...new Set([...series.values()].filter(s => used.has(s.id)).map(s => s.subject))].sort(),
  series: [...series.values()].filter(s => used.has(s.id)), lessons };
writeFileSync(ROOT + "site/catalogue.json", JSON.stringify(out, null, 0));
console.log(`${lessons.length} videos in ${out.series.length} series -> site/catalogue.json`);
