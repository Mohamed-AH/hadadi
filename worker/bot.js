/* The announcements bot, answering instantly (Telegram webhook -> POST /bot on this Worker). Admins (BOT_ADMINS) get a menu:
   see the posters in site order, add one (a guided draft: picture, title, end date, then publish at the top or bottom),
   change a poster's text or end date, move it, delete it. Everything is kept on Cloudflare (worker/poster_store.js): the list
   in D1, the pictures in R2; a change visitors would see rebuilds the site through the deploy hook (about two minutes).

   Worker settings: TELEGRAM_BOT_TOKEN (secret), BOT_ADMINS (comma-separated Telegram user ids), DEPLOY_HOOK (secret, shared
   with the portal's «نشر»); bindings DB and MEDIA. The webhook is registered once by tools/setup_bot.sh (docs/announcements.md).
   Nothing here trusts message text as code: titles are plain text, cleaned by cleanTitle(), and the site escapes them again. */
import { today, parseCaption, parseDate, cleanTitle, hijriLabel, move, publish, draftId, webhookSecret } from "./posters.js";
import { store, savePicture } from "./poster_store.js";

const SITE = "https://h-haddadi.com";
const IMG = /^image\/(jpeg|png|webp)$/, MAX_BYTES = 10e6;
const AR = n => new Intl.NumberFormat("ar-EG", { useGrouping: false }).format(n);
const short = (s, n = 28) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const when = res => res && res.deployed ? "خلال دقيقتين تقريبًا" : "عند التحديث القادم للموقع";

/* ---- Telegram ---- */
function telegram(env, fetcher) {
  const api = env.TELEGRAM_API || "https://api.telegram.org";
  return async (method, params) => {
    const r = await fetcher(`${api}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
  };
}

const kb = rows => ({ inline_keyboard: rows });
const MENU = kb([[{ text: "📋 الإعلانات", callback_data: "l" }], [{ text: "➕ إضافة إعلان", callback_data: "a" }], [{ text: "❓ طريقة الاستخدام", callback_data: "h" }]]);
const HELP = "• 📋 الإعلانات: كل الإعلانات بترتيبها في الموقع؛ اضغط على أيٍّ منها لتعديل نصه أو تاريخ انتهائه أو موضعه أو لحذفه.\n"
  + "• ➕ إضافة إعلان: أرسل الصورة، ثم اكتب العنوان وتاريخ الانتهاء، ثم اختر النشر في الأعلى أو الأسفل. لا يظهر في الموقع قبل «نشر».\n"
  + "• إذا بدأ العنوان بكلمة «جدول» صار الإعلانُ جدولَ الدروس، ويحلّ محل الجدول السابق عند نشره.\n"
  + "• يظهر كل تغيير في الموقع بعد دقيقتين تقريبًا. القائمة: /menu";

function status(a, day) {
  if (a.draft) return "مسودة (لم يُنشر بعد)";
  if (a.until && a.until < day) return "انتهى (سيُزال)";
  return "منشور";
}
function caption(list, a, day = today()) {
  const i = list.findIndex(x => x.id === a.id);
  return `«${a.title}»${a.pin ? "\n(جدول الدروس)" : ""}\nالموضع: ${AR(i + 1)} من ${AR(list.length)}\nالحالة: ${status(a, day)}\n`
    + (a.until ? `ينتهي بعد: ${hijriLabel(a.until)}` : "بدون تاريخ انتهاء");
}
function cardKeyboard(a) {
  const id = a.id;
  return kb([
    [{ text: "✏️ تعديل النص", callback_data: "t:" + id }, { text: "📅 تاريخ الانتهاء", callback_data: "d:" + id }],
    [{ text: "⬆️ أعلى", callback_data: "u:" + id }, { text: "⬇️ أسفل", callback_data: "w:" + id }, { text: "⏫ الأول", callback_data: "T:" + id }],
    ...(a.draft ? [[{ text: "✅ نشر في الأعلى", callback_data: "P:" + id }, { text: "✅ نشر في الأسفل", callback_data: "B:" + id }]] : []),
    [{ text: "🗑 حذف", callback_data: "x:" + id }, { text: "📋 القائمة", callback_data: "l" }],
  ]);
}
function listView(list, day = today()) {
  if (!list.length) return { text: "لا توجد إعلانات الآن.", reply_markup: kb([[{ text: "➕ إضافة إعلان", callback_data: "a" }]]) };
  const lines = list.map((a, i) => `${AR(i + 1)}. ${a.title}${a.pin ? " (الجدول)" : ""} — ${status(a, day)}${a.until && !a.draft ? "، ينتهي بعد " + hijriLabel(a.until) : ""}`);
  const rows = list.map((a, i) => [{ text: `${AR(i + 1)}. ${short(a.title)}`, callback_data: "v:" + a.id }]);
  return { text: "الإعلانات بترتيبها في الموقع (اضغط على إعلان لتعديله):\n\n" + lines.join("\n"), reply_markup: kb([...rows, [{ text: "➕ إضافة إعلان", callback_data: "a" }]]) };
}
const photoOf = a => a.file_id || (a.image ? SITE + a.image : "");

/* Telegram's photo sizes (smallest first) -> { big, small }: the largest, and a preview size of at least 480 px if there is one */
function pictureOf(m) {
  if (m.photo && m.photo.length) {
    const big = m.photo[m.photo.length - 1], small = m.photo.find(p => Math.max(p.width || 0, p.height || 0) >= 480 && p !== big);
    return { ph: big, big: big.file_id, small: small ? small.file_id : "" };
  }
  if (m.document && IMG.test(m.document.mime_type || "")) {
    const th = m.document.thumbnail || m.document.thumb;
    return { ph: m.document, big: m.document.file_id, small: th ? th.file_id : "" };
  }
  return null;
}

export async function handleUpdate(u, env, { fetcher = fetch, day = today() } = {}) {
  const tg = telegram(env, fetcher), ps = store(env, { fetcher, day });
  const admins = new Set(String(env.BOT_ADMINS || "").split(/[,\s]+/).filter(Boolean));
  const say = (chat_id, text, extra = {}) => tg("sendMessage", { chat_id, text, link_preview_options: { is_disabled: true }, ...extra });

  async function showCard(chat, list, a, edit) {
    const cap = caption(list, a, day), reply_markup = cardKeyboard(a);
    if (edit) {
      const m = edit.message;
      try { return m.photo ? await tg("editMessageCaption", { chat_id: chat, message_id: m.message_id, caption: cap, reply_markup })
                           : await tg("editMessageText", { chat_id: chat, message_id: m.message_id, text: cap, reply_markup }); }
      catch (e) { if (/not modified/.test(e.message)) return; }
    }
    const p = photoOf(a);
    if (p) try { return await tg("sendPhoto", { chat_id: chat, photo: p, caption: cap, reply_markup }); } catch { /* fall back to text */ }
    return say(chat, cap, { reply_markup });
  }
  const ask = (chat, kind, a) => say(chat, kind === "t"
    ? `✏️ اكتب عنوان الإعلان «${a.title}» كما تريده أن يظهر، وأرسله ردًّا على هذه الرسالة.\n#t-${a.id}`
    : `📅 اكتب تاريخ انتهاء «${a.title}» بالهجري مثل ١٤٤٨/٧/٢ (يختفي من الموقع بعده)، أو اكتب: بدون\n#d-${a.id}`,
    { reply_markup: { force_reply: true, input_field_placeholder: kind === "t" ? "العنوان" : "١٤٤٨/٧/٢ أو بدون" } });

  /* ---------- button presses ---------- */
  if (u.callback_query) {
    const q = u.callback_query, chat = q.message && q.message.chat.id, who = String(q.from.id);
    const answer = (text, alert) => tg("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text, show_alert: !!alert } : {}) }).catch(() => {});
    if (!admins.has(who) || !chat) return answer("غير مصرّح لك.", true);
    const [op, id] = String(q.data || "").split(":");
    try {
      if (op === "l") { await answer(); const list = await ps.read(), v = listView(list, day); return say(chat, v.text, { reply_markup: v.reply_markup }); }
      if (op === "a") { await answer(); return say(chat, "أرسل صورة الإعلان الآن.\nيمكنك كتابة العنوان في تعليق الصورة (وتاريخ الانتهاء مثل: حتى ١٤٤٨/٧/٢)، وإلا سألتك عنهما."); }
      if (op === "h") { await answer(); return say(chat, HELP, { reply_markup: MENU }); }
      if (op === "m") { await answer(); return say(chat, "القائمة:", { reply_markup: MENU }); }
      const list = await ps.read(), a = list.find(x => x.id === id);
      if (!a) { await answer("هذا الإعلان لم يعد موجودًا.", true); return; }
      if (op === "v") { await answer(); return showCard(chat, list, a); }
      if (op === "t" || op === "d") { await answer(); return ask(chat, op, a); }
      if (op === "x") {
        await answer();
        const text = `هل تريد حذف «${a.title}» من الموقع؟`, reply_markup = kb([[{ text: "🗑 نعم، احذفه", callback_data: "X:" + id }, { text: "إلغاء", callback_data: "v:" + id }]]);
        return say(chat, text, { reply_markup });
      }
      if (op === "X") {
        const res = await ps.update(l => ({ list: l.filter(x => x.id !== id) }));
        await answer("حُذف.");
        return say(chat, `حُذف «${a.title}».` + (a.draft ? "" : ` سيختفي من الموقع ${when(res)}.`), { reply_markup: MENU });
      }
      if ("uwT".includes(op) && op.length === 1) {
        const where = op === "u" ? -1 : op === "w" ? 1 : "top";
        const res = await ps.update(l => { const n = move(l, id, where); return n.findIndex(x => x.id === id) === l.findIndex(x => x.id === id) ? null : { list: n }; });
        await answer(res ? "تم النقل." : "هو في هذا الموضع أصلًا.");
        if (res) return showCard(chat, res.list, res.list.find(x => x.id === id), q);
        return;
      }
      if (op === "P" || op === "B") {
        if (!a.draft) return answer("منشور من قبل.");
        if (!a.image) return answer("الصورة قيد التجهيز، حاول بعد دقيقة.", true);
        if (a.until && a.until < day) return answer("تاريخ الانتهاء في الماضي، عدّله أولًا.", true);
        let replaced = [];
        const res = await ps.update(l => { const r = publish(l, id, op === "P" ? "top" : "bottom"); replaced = r.replaced; return { list: r.list }; });
        await answer("نُشر.");
        return say(chat, `✅ نُشر «${a.title}» ${op === "P" ? "في أول" : "في آخر"} الإعلانات، وسيظهر في الموقع ${when(res)}.`
          + (replaced.length ? `\nوحُذف الجدول السابق: «${replaced.map(x => x.title).join("»، «")}».` : ""), { reply_markup: MENU });
      }
      return answer();
    } catch (e) { await answer(); return say(chat, "تعذّر تنفيذ ذلك: " + e.message); }
  }

  /* ---------- messages ---------- */
  const m = u.message;
  if (!m || !m.from || !m.chat || m.chat.type !== "private") return;
  const chat = m.chat.id, who = String(m.from.id);
  if (!admins.has(who)) return say(chat, `غير مصرّح لك بتعديل إعلانات الموقع. رقمك في تيليجرام: ${who} (أرسله لمسؤول الموقع).`);
  const text = (m.text || "").trim();
  try {
    // an answer to one of the bot's questions (#t-<id>: the title, #d-<id>: the end date)
    const tag = m.reply_to_message && m.reply_to_message.from && m.reply_to_message.from.is_bot && /#([td])-([0-9a-f]{12})\s*$/.exec(m.reply_to_message.text || "");
    if (tag && text) {
      const [, kind, id] = tag;
      let value;
      if (kind === "t") { value = cleanTitle(text); if (!value) return say(chat, "العنوان فارغ. اكتب العنوان ردًّا على السؤال."); }
      else if (/^(بدون|لا|لايوجد|لا يوجد|-)$/.test(text)) value = "";
      else { value = parseDate(text); if (!value) return say(chat, "لم أفهم التاريخ. اكتبه بالهجري مثل ١٤٤٨/٧/٢ أو اكتب: بدون (ردًّا على السؤال)."); if (value < day) return say(chat, "هذا التاريخ مضى. اكتب تاريخًا قادمًا أو: بدون."); }
      const res = await ps.update(l => {
        const a = l.find(x => x.id === id); if (!a) return null;
        return { list: l.map(x => x.id === id ? { ...x, ...(kind === "t" ? { title: value } : { until: value }) } : x) };
      });
      if (!res) return say(chat, "هذا الإعلان لم يعد موجودًا.", { reply_markup: MENU });
      const a = res.list.find(x => x.id === id);
      if (a.draft && kind === "t") return ask(chat, "d", a);                 // guided draft: title, then end date, then publish
      await say(chat, kind === "t" ? "تم تعديل النص." : value ? `تم: ينتهي بعد ${hijriLabel(value)}.` : "تم: بدون تاريخ انتهاء.");
      return showCard(chat, res.list, a);
    }
    if (/^\/(start|menu|help)/.test(text) || /^(القائمة|قائمة)$/.test(text)) return say(chat, /^\/help/.test(text) ? HELP : "قائمة إعلانات الموقع:", { reply_markup: MENU });
    if (/^\/list/.test(text)) { const list = await ps.read(), v = listView(list, day); return say(chat, v.text, { reply_markup: v.reply_markup }); }
    if (/^حذف/.test(text) && m.reply_to_message) {   // the old way: reply «حذف» to the poster's picture
      const list = await ps.read(), a = list.find(x => x.tg && x.tg.chat === chat && x.tg.msg === m.reply_to_message.message_id);
      if (!a) return say(chat, "لم أجد إعلانًا لهذه الرسالة. استعمل القائمة: /menu");
      return say(chat, `هل تريد حذف «${a.title}» من الموقع؟`, { reply_markup: kb([[{ text: "🗑 نعم، احذفه", callback_data: "X:" + a.id }, { text: "إلغاء", callback_data: "v:" + a.id }]]) });
    }
    const pic = pictureOf(m);
    if (!pic) return say(chat, "اختر من القائمة، أو أرسل صورة إعلان جديد.", { reply_markup: MENU });
    const ph = pic.ph;
    if (ph.file_size && ph.file_size > MAX_BYTES) return say(chat, "الصورة أكبر من ١٠ ميغابايت.");
    const id = await draftId(ph.file_unique_id || ph.file_id);
    const isDup = l => l.find(x => x.id === id || (x.file_uid && x.file_uid === ph.file_unique_id));
    const showDup = async () => { await say(chat, "هذه الصورة موجودة من قبل:"); const list = await ps.read(), a = isDup(list); return a && showCard(chat, list, a); };
    if (isDup(await ps.read())) return showDup();
    const cap = parseCaption(m.caption || ""), hasTitle = !!(m.caption || "").replace(/#جدول\S*/g, "").trim();
    const until = cap.until && cap.until >= day ? cap.until : "";
    let pictureSaved;
    try { pictureSaved = await savePicture(tg, env, pic, { fetcher, max: MAX_BYTES }); }
    catch (e) { return say(chat, "لم أستطع حفظ الصورة: " + e.message); }
    const res = await ps.update(l => {
      if (isDup(l)) return null;
      const a = { id, title: cap.title, ...pictureSaved, until, added: day, draft: true, file_id: ph.file_id, file_uid: ph.file_unique_id || "",
                  tg: { chat, msg: m.message_id }, ...(cap.pin ? { pin: true } : {}) };
      return { list: [a, ...l] };
    });
    if (!res) return showDup();
    const a = res.list.find(x => x.id === id);
    await say(chat, "حُفظ الإعلان مسودةً، ولن يظهر في الموقع قبل أن تضغط «نشر»." + (cap.until && !until ? "\n(تاريخ الانتهاء في التعليق مضى، فلم يُعتمد.)" : ""));
    if (!hasTitle) return ask(chat, "t", a);
    if (!until) return ask(chat, "d", a);
    return showCard(chat, res.list, a);
  } catch (e) { return say(chat, "تعذّر تنفيذ ذلك: " + e.message); }
}

/* POST /bot from Telegram: check the secret header, handle the update, always answer 200 (else Telegram repeats it) */
export async function webhook(req, env, deps) {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB || !env.MEDIA) return new Response("bot not configured", { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await webhookSecret(env.TELEGRAM_BOT_TOKEN)) return new Response("forbidden", { status: 403 });
  let u; try { u = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  try { await handleUpdate(u, env, deps); } catch (e) { console.log("bot: " + e.message); }
  return new Response("ok");
}
