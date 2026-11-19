/* Browser code of the upload forms (served as /admin/admin.js; the CSP allows script-src 'self' only, no inline scripts).
   Ported from Mohamed-AH/drwasiullah admin/src/client.mjs, cut down to one file per form. Text goes in with textContent only. */
import { COMPRESS_JS } from "./compress.mjs";

const BODY = String.raw`
const form = document.getElementById("up");
if (!form) return;
const PART = 8 * 1024 * 1024, MAX_MB = 200;
const $ = id => document.getElementById(id);
const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const file = $("file"), note = $("note"), prog = $("prog"), msg = $("msg"), go = $("go");
let busy = false, seconds = 0;
const say = t => { msg.textContent = t; msg.hidden = !t; };
addEventListener("beforeunload", e => { if (busy) { e.preventDefault(); e.returnValue = ""; } });

/* Hijri (Umm al-Qura, as the site shows it) -> Gregorian YYYY-MM-DD, through Intl */
const HP = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Riyadh" });
const RIYADH = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Riyadh" });
const hparts = t => { const o = {}; for (const p of HP.formatToParts(t)) if (p.type !== "literal" && p.type !== "era") o[p.type] = +p.value; return o; };
function hijriToGregorian(y, m, d) {
  const est = Date.UTC(622, 6, 16, 9) + ((y - 1) * 354.36709 + (m - 1) * 29.5306 + (d - 1)) * 864e5;
  for (const off of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    const t = new Date(est + off * 864e5), p = hparts(t);
    if (p.year === y && p.month === m && p.day === d) return RIYADH.format(t);
  }
  return "";
}

file.addEventListener("change", () => {                   // duration and a size/bitrate hint, from the browser itself
  say(""); note.textContent = ""; seconds = 0;
  const f = file.files[0]; if (!f) return;
  if (!/\.(mp3|m4a)$/i.test(f.name)) { say("الملف يجب أن يكون m4a أو mp3."); return; }
  if (f.size > MAX_MB * 1048576) { say("الملف أكبر من ٢٠٠ ميغابايت."); return; }
  const url = URL.createObjectURL(f), a = new Audio();
  a.preload = "metadata";
  a.onloadedmetadata = () => {
    seconds = isFinite(a.duration) ? Math.round(a.duration) : 0;
    const kbps = seconds ? Math.round(f.size * 8 / seconds / 1000) : 0;
    note.textContent = AR((f.size / 1048576).toFixed(1)) + " ميغابايت" + (seconds ? " · " + AR(Math.round(seconds / 60)) + " دقيقة" : "") + (kbps ? " · " + AR(kbps) + " كب/ث" : "") + (kbps > 80 ? " (أكبر من المعتاد ٤٨ كب/ث، لكنه يُقبل)" : "");
    URL.revokeObjectURL(url);
  };
  a.onerror = () => { note.textContent = "تعذّرت قراءة مدة الملف (سيُرفع كما هو)."; URL.revokeObjectURL(url); };
  a.src = url;
});

async function sha256hex(f) {
  const h = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function post(path, body) {
  const r = await fetch("/admin/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
function putPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url); x.responseType = "json";
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded);
    x.onload = () => x.status === 200 ? resolve(x.response) : reject(new Error((x.response && x.response.error) || "HTTP " + x.status));
    x.onerror = () => reject(new Error("انقطع الاتصال"));
    x.send(blob);
  });
}
async function upload(f) {
  const ext = f.name.split(".").pop().toLowerCase();
  prog.textContent = "جارٍ حساب البصمة…";
  const st = await post("upload/start", { size: f.size, ext, sha256: await sha256hex(f) });
  if (st.exists) { prog.textContent = "الملف موجود مسبقًا في المخزن ✓"; return st.key; }
  const parts = [], total = Math.ceil(f.size / PART);
  try {
    for (let i = 0; i < total; i++) {
      const blob = f.slice(i * PART, (i + 1) * PART);
      let res, tries = 0;
      for (;;) {
        try {
          res = await putPart("/admin/api/upload/part?key=" + encodeURIComponent(st.key) + "&uploadId=" + encodeURIComponent(st.uploadId) + "&n=" + (i + 1), blob,
            loaded => { prog.textContent = "رفع… " + AR(Math.min(99, Math.round((i * PART + loaded) / f.size * 100))) + "٪"; });
          break;
        } catch (e) { if (++tries >= 3) throw e; await new Promise(ok => setTimeout(ok, 1500 * tries)); }
      }
      parts.push({ partNumber: res.partNumber, etag: res.etag });
    }
    await post("upload/complete", { key: st.key, uploadId: st.uploadId, parts });
  } catch (e) { post("upload/abort", { key: st.key, uploadId: st.uploadId }).catch(() => {}); throw e; }
  prog.textContent = "تم الرفع ✓";
  return st.key;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  say("");
  const f = file.files[0], mode = form.dataset.mode;
  if (!f || !/\.(mp3|m4a)$/i.test(f.name) || f.size > MAX_MB * 1048576) { say("اختر ملف m4a أو mp3 حتى ٢٠٠ ميغابايت."); return; }
  let extra = {};
  if (mode === "new") {
    const title = $("title").value.trim(), y = $("hd-y").value, m = $("hd-m").value, d = $("hd-d").value;
    if (title.length < 3) { say("اكتب عنوان الدرس."); $("title").focus(); return; }
    extra = { series: form.dataset.series, title, hd: "", date: "" };
    if (y || m || d) {
      if (!(+y >= 1300 && +y <= 1600 && +m >= 1 && +m <= 12 && +d >= 1 && +d <= 30)) { say("التاريخ الهجري غير صالح."); return; }
      extra.hd = +y + "-" + +m + "-" + +d; extra.date = hijriToGregorian(+y, +m, +d);
      if (!extra.date) { say("هذا التاريخ الهجري غير موجود في تقويم أم القرى."); return; }
    }
  } else extra = { lesson: form.dataset.lesson };
  busy = true; go.disabled = true;
  try {
    let up = f, secs = seconds;
    prog.textContent = "جارٍ ضغط الملف…";
    const c = await compress(f, x => { prog.textContent = "جارٍ ضغط الملف… " + AR(Math.round(x * 100)) + "٪"; }).catch(e => { console.warn(e); return null; });
    if (c && c.blob.size < f.size * 0.9) {                   // keep the original when compressing would not save much
      up = new File([c.blob], f.name.replace(/\.[^.]+$/, "") + ".m4a", { type: "audio/mp4" }); secs = c.seconds || seconds;
      note.textContent = "بعد الضغط: " + AR((up.size / 1048576).toFixed(1)) + " ميغابايت (" + AR(c.kbps) + " كب/ث، أحادي) بدل " + AR((f.size / 1048576).toFixed(1)) + ".";
    } else if (c || (seconds && f.size * 8 / seconds <= 64000)) note.textContent = "الملف خفيف أصلًا، سيُرفع كما هو.";
    else {                                                   // owner 2026-11-19: no heavy files on the site
      throw new Error(seconds ? "لم يتمكن هذا المتصفح من ضغط الملف، والملف أثقل من المسموح (" + AR(Math.round(f.size * 8 / seconds / 1000)) + " كب/ث). افتح اللوحة في Chrome أو Edge على الحاسوب وأعد المحاولة"
                              : "لم يتمكن هذا المتصفح من قراءة الملف أو ضغطه. افتح اللوحة في Chrome أو Edge على الحاسوب وأعد المحاولة");
    }
    const key = await upload(up);
    seconds = secs;
    prog.textContent = "جارٍ الحفظ…";
    await post(mode === "new" ? "lessons" : "audio", { ...extra, key, duration: seconds });
    busy = false;
    location.href = "/admin/series/" + encodeURIComponent(form.dataset.series) + "?ok=" + (mode === "new" ? "lesson_added" : "audio_added");
  } catch (err) {
    busy = false; go.disabled = false; prog.textContent = "";
    say("لم يكتمل: " + err.message + ". حاول مرة أخرى (ما رُفع لن يُعاد رفعه).");
  }
});
`;
/* one script: the compressor (compress.mjs, with the m4a writer) and the form code, inside one function scope */
export const JS = "(() => {\n\"use strict\";\n" + COMPRESS_JS + "\n(() => {" + BODY + "})();\n})();\n";
