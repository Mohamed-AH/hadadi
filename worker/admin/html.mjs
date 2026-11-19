/* Admin portal HTML: server-rendered Arabic RTL, no inline script or style (strict CSP), the site's Roshan colours. */
import { can } from "./roles.mjs";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const AR = s => String(s).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
export const num = n => AR(Number(n || 0).toLocaleString("en-US"));
const HIJRI = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-arab", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
/* UTC timestamps ("YYYY-MM-DD HH:MM:SS" or ISO) -> Hijri date · Makkah time */
export const stamp = s => {
  const d = new Date(/[TZ]/.test(String(s)) ? String(s) : String(s).replace(" ", "T") + "Z");
  return isNaN(d) ? esc(s) : esc(HIJRI.format(d) + " · " + AR(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })));
};
export const hijriOf = (hd, date) => {
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(hd || "");
  if (m) return AR(`${+m[3]}/${+m[2]}/${m[1]}`) + " هـ";
  const d = date ? new Date(date + "T12:00:00+03:00") : null;
  return d && !isNaN(d) ? HIJRI.format(d) : "—";
};

const NAV = [
  ["/", "الرئيسية", "view"],
  ["/messages", "الرسائل", "messages.view"],
  ["/series", "السلاسل", "view"],
  ["/users", "المستخدمون", "users.editors"],
  ["/audit", "السجل", "audit.view"],
];

export const FLASH = {
  added: "تمت إضافة المستخدم. أضف بريده أيضًا إلى سياسة Cloudflare Access ليتمكن من الدخول.", updated: "تم حفظ التعديل.",
  invalid: "البيانات غير صحيحة.", exists: "هذا البريد مسجّل من قبل.", last_super: "لا يمكن ترك اللوحة بلا مدير عام فعّال.", unknown: "غير موجود.",
  not_yours: "لا تملك صلاحية تعديل هذا المستخدم.", self: "لا يمكنك تغيير دورك أو إيقاف نفسك من هنا.",
  status_saved: "تم تغيير حالة الرسالة.", deleted: "تم حذف الرسالة.",
};

export function layout({ title, user, path, body, flash }) {
  const nav = NAV.filter(([, , perm]) => can(user.role, perm))
    .map(([href, label]) => `<a href="/admin${href === "/" ? "/" : href}"${(href === "/" ? path === "/" : path.startsWith(href)) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const f = flash && FLASH[flash.code] ? `<p class="flash ${flash.kind === "ok" ? "ok" : "err"}" role="status">${esc(FLASH[flash.code])}</p>` : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — لوحة التحرير</title><link rel="icon" href="https://h-haddadi.com/favicon.svg"><link rel="stylesheet" href="/admin/admin.css"></head><body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<header class="top"><div class="brand">لوحة التحرير <small>موقع الشيخ حسن بن علي حدادي</small></div>
<nav aria-label="التنقل">${nav}</nav>
<div class="who"><span dir="ltr">${esc(user.email)}</span> · <a href="https://h-haddadi.com/">الموقع</a> · <a href="/cdn-cgi/access/logout">خروج</a></div></header>
<main id="main" tabindex="-1"><h1>${esc(title)}</h1>${f}${body}</main></body></html>`;
}

const HTML = { "content-type": "text/html; charset=utf-8" };
export const page = (html, status = 200) => new Response(html, { status, headers: HTML });
export const message = (title, text, status) => page(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/admin/admin.css"></head><body><main class="narrow" id="main"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/cdn-cgi/access/logout">تسجيل الخروج</a> · <a href="https://h-haddadi.com/">الموقع</a></p></main></body></html>`, status);

export const CSS = `
:root{--bg:#f3ece1;--card:#fffaf2;--ink:#2b2119;--mute:#6b5846;--line:#e3d5c0;--night:#3a2a1e;--on-night:#f6ead8;--brass:#e0b48a;--link:#1d6a65;--clay:#b5652e;--ok:#2f6b3a;--bad:#9a3412;--focus:#b5652e}
@media (prefers-color-scheme:dark){:root{--bg:#120d09;--card:#1c140d;--ink:#f0e6d8;--mute:#b9a690;--line:#3a2c20;--night:#0b0805;--on-night:#f6ead8;--link:#7cc7bd;--ok:#7fc58b;--bad:#f0a77a;--focus:#e0b48a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.75 "Segoe UI",Tahoma,"Noto Naskh Arabic",sans-serif}
a{color:var(--link)}h1{font-size:1.5rem;margin:.2rem 0 1rem}h2{font-size:1.15rem;margin:1.6rem 0 .6rem}
.skip{position:absolute;inset-inline-start:-999px;top:0;background:var(--brass);color:#2b1d12;padding:8px 14px;z-index:9}.skip:focus{inset-inline-start:8px}
.top{display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;align-items:center;padding:.7rem 1rem;background:var(--night);color:var(--on-night);border-bottom:3px solid var(--clay)}
.top a{color:var(--brass)}.brand{font-weight:700}.brand small{display:block;font-weight:400;opacity:.8;font-size:.8rem}
nav{display:flex;flex-wrap:wrap;gap:.2rem .3rem;flex:1 1 100%;order:3}@media (min-width:900px){nav{flex:1;order:0}}
nav a{padding:.25rem .8rem;border-radius:6px;text-decoration:none;color:var(--on-night)!important}nav a[aria-current]{background:var(--brass);color:#2b1d12!important}
.who{font-size:.85rem;opacity:.9}main{max-width:1100px;margin:0 auto;padding:1rem}main.narrow{max-width:560px;margin-top:4rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.8rem 1rem;text-decoration:none;color:inherit}
.card b{display:block;font-size:1.7rem;color:var(--clay)}.card span{color:var(--mute);font-size:.9rem}a.card:hover{border-color:var(--clay)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}
th,td{padding:.45rem .7rem;text-align:start;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--bg);font-size:.85rem;color:var(--mute)}
tr.unread td{font-weight:700}.scroll{overflow-x:auto}
.tag{font-size:.78rem;padding:.05rem .5rem;border-radius:6px;border:1px solid var(--line);white-space:nowrap}
.tag-new{color:var(--clay);border-color:var(--clay)}.tag-answered{color:var(--ok);border-color:var(--ok)}.tag-archived{color:var(--mute)}
form.inline{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
input,select,button,textarea{font:inherit;padding:.35rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}
button{background:var(--night);color:var(--brass);border-color:var(--night);cursor:pointer}button.secondary{background:var(--card);color:var(--ink);border-color:var(--line)}
button.danger{background:var(--card);color:var(--bad);border-color:var(--bad)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.flash{padding:.5rem .9rem;border-radius:8px;border:1px solid}.flash.ok{color:var(--ok);border-color:var(--ok)}.flash.err{color:var(--bad);border-color:var(--bad)}
.msg{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem 1.2rem;white-space:pre-wrap;overflow-wrap:anywhere}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:.2rem 1rem;margin:0 0 1rem}.meta dt{color:var(--mute)}.meta dd{margin:0;overflow-wrap:anywhere}
.filters{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1rem}.filters a{padding:.2rem .8rem;border:1px solid var(--line);border-radius:6px;text-decoration:none;background:var(--card)}.filters a[aria-current]{border-color:var(--clay);color:var(--clay);font-weight:700}
.muted{color:var(--mute)}.pager{display:flex;gap:1rem;margin:1rem 0}code,.ltr{direction:ltr;unicode-bidi:embed}label{display:inline-block;margin:.2rem .6rem .2rem 0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
