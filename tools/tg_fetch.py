"""Bring data/channels/<folder>/result.json up to date with the Telegram channels (the sync job's first step).

The files hold each channel's posts in the shape of a Telegram Desktop JSON export without media (only the fields
tools/telegram_lessons.py reads), one post per line, so tools/telegram_lessons.py and tools/import_telegram.py run on
them unchanged: TELEGRAM_EXPORTS=data/channels.

Each run asks Telegram for the posts after the newest one we have, plus the last RECHECK posts again (a caption edited
soon after posting, the usual fix of a typo, is picked up). Posts are never removed here.

Login: the owner's own Telegram account, read-only.
  TG_API_ID, TG_API_HASH   https://my.telegram.org (the same as tools/fetch_audio.py)
  TG_SESSION               a Telethon StringSession (setup_sync.sh makes it from the .telegram.session file);
                           without it the local .telegram.session file is used.
Usage: python tools/tg_fetch.py [--dry-run]   -> prints a JSON summary {"<folder>": [new ids], ...} on stdout
"""
import argparse, json, os, sys
from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "channels"
# folder (= lesson id prefix) -> the channel to read. masothrbj47 is the folder name the first export used; the
# channel's real username is Aqar8 (2026-11-20), so it is read by its numeric id.
CHANNELS = {"h_haddadi7": 1186686748, "masothrbj47": 1456637338}
RECHECK = 30
RIYADH = timezone(timedelta(hours=3))   # Telegram Desktop writes local time; the first exports were made in Riyadh
NOT_INCLUDED = "(File not included. Change data exporting settings to download.)"

# Telethon entity class -> the type name Telegram Desktop writes in "text" lists
ENTITY = {"MessageEntityUrl": "link", "MessageEntityTextUrl": "text_link", "MessageEntityBold": "bold",
          "MessageEntityItalic": "italic", "MessageEntityUnderline": "underline", "MessageEntityStrike": "strikethrough",
          "MessageEntityCode": "code", "MessageEntityPre": "pre", "MessageEntityHashtag": "hashtag",
          "MessageEntityMention": "mention", "MessageEntityMentionName": "mention_name", "MessageEntityPhone": "phone",
          "MessageEntityEmail": "email", "MessageEntityBotCommand": "bot_command", "MessageEntityCashtag": "cashtag",
          "MessageEntitySpoiler": "spoiler", "MessageEntityCustomEmoji": "custom_emoji", "MessageEntityBlockquote": "blockquote",
          "MessageEntityBankCard": "bank_card"}


def export_text(message, entities):
    """Telethon text + entities -> Telegram Desktop's "text": a plain string, or a list of strings and {type, text[, href]}."""
    from telethon.helpers import add_surrogate, del_surrogate
    if not message: return ""
    if not entities: return message
    s, out, pos = add_surrogate(message), [], 0     # entity offsets count UTF-16 units
    for e in sorted(entities, key=lambda e: e.offset):
        if e.offset < pos: continue                  # nested entities: Desktop keeps the outer one
        if e.offset > pos: out.append(del_surrogate(s[pos:e.offset]))
        part = {"type": ENTITY.get(type(e).__name__, "plain"), "text": del_surrogate(s[e.offset:e.offset + e.length])}
        if getattr(e, "url", None): part["href"] = e.url
        out.append(part)
        pos = e.offset + e.length
    out.append(del_surrogate(s[pos:]))
    return out


def to_export(msg, fwd_name=None):
    """One Telethon message -> the export fields tools/telegram_lessons.py reads."""
    from telethon.tl.types import (MessageService, DocumentAttributeAudio, DocumentAttributeVideo, DocumentAttributeFilename,
                                   DocumentAttributeSticker, DocumentAttributeAnimated, MessageMediaPhoto, MessageMediaDocument)
    t = msg.date.astimezone(RIYADH)
    x = {"id": msg.id, "type": "service" if isinstance(msg, MessageService) else "message",
         "date": t.strftime("%Y-%m-%dT%H:%M:%S"), "date_unixtime": str(int(msg.date.timestamp()))}
    if x["type"] == "service":
        x["text"] = ""; return x
    if isinstance(msg.media, MessageMediaPhoto):
        x["photo"] = NOT_INCLUDED
    elif isinstance(msg.media, MessageMediaDocument) and msg.media.document:
        doc = msg.media.document
        x["file"] = NOT_INCLUDED
        media_type, duration = None, None
        for a in doc.attributes:
            if isinstance(a, DocumentAttributeFilename): x["file_name"] = a.file_name
            elif isinstance(a, DocumentAttributeAudio):
                media_type, duration = ("voice_message" if a.voice else "audio_file"), a.duration
                if a.title: x["title"] = a.title
                if a.performer: x["performer"] = a.performer
            elif isinstance(a, DocumentAttributeVideo):
                media_type, duration = ("video_message" if a.round_message else "video_file"), int(a.duration or 0)
            elif isinstance(a, DocumentAttributeSticker): media_type = "sticker"
            elif isinstance(a, DocumentAttributeAnimated): media_type = "animation"
        x["file_size"] = doc.size
        if media_type: x["media_type"] = media_type
        x["mime_type"] = doc.mime_type
        if duration: x["duration_seconds"] = int(duration)
    if msg.fwd_from:
        x["forwarded_from"] = fwd_name or msg.fwd_from.from_name or "unknown"
    x["text"] = export_text(msg.message, msg.entities)
    return {k: x[k] for k in ("id", "type", "date", "date_unixtime", "text", "file", "file_name", "file_size", "media_type",
                              "mime_type", "duration_seconds", "forwarded_from", "photo", "title", "performer") if k in x}


def load(folder):
    f = DIR / folder / "result.json"
    return json.loads(f.read_text(encoding="utf-8"))


def save(folder, data):
    f = DIR / folder / "result.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(json.dumps(m, ensure_ascii=False, separators=(",", ":")) for m in data["messages"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text('{"name":' + json.dumps(data["name"], ensure_ascii=False) + ',"id":' + str(data["id"]) + ',"messages":[\n' + body + "\n]}\n", encoding="utf-8")
    tmp.replace(f)


def merge(data, fresh):
    """Add new posts and refresh re-read ones. Returns (new ids, changed ids). A post Telegram no longer returns stays."""
    by = {m["id"]: m for m in data["messages"]}
    new = sorted(m["id"] for m in fresh if m["id"] not in by)
    changed = sorted(m["id"] for m in fresh if m["id"] in by and by[m["id"]] != m)
    for m in fresh: by[m["id"]] = m
    data["messages"] = [by[k] for k in sorted(by)]
    return new, changed


def client():
    for k in ("TG_API_ID", "TG_API_HASH"):
        if not os.environ.get(k): sys.exit(f"missing {k}")
    from telethon.sync import TelegramClient
    from telethon.sessions import StringSession
    s = os.environ.get("TG_SESSION")
    c = TelegramClient(StringSession(s) if s else str(ROOT / ".telegram"), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"],
                       flood_sleep_threshold=600)
    c.connect()
    if not c.is_user_authorized(): sys.exit("TELEGRAM_LOGIN_EXPIRED: the saved Telegram login no longer works; run setup_sync.sh again")
    return c


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    a = ap.parse_args(argv)
    c, summary = client(), {}
    try:
        for folder, chan in CHANNELS.items():
            data = load(folder)
            last = max((m["id"] for m in data["messages"]), default=0)
            entity = c.get_entity(chan)
            msgs = c.get_messages(entity, min_id=max(0, last - RECHECK), limit=None)
            names = {}
            fresh = []
            for m in msgs:
                fwd = None
                if m.fwd_from and getattr(m.fwd_from, "from_id", None) is not None:
                    key = str(m.fwd_from.from_id)
                    if key not in names:
                        try: names[key] = getattr(c.get_entity(m.fwd_from.from_id), "title", None)
                        except Exception: names[key] = None
                    fwd = names[key]
                fresh.append(to_export(m, fwd))
            new, changed = merge(data, fresh)
            summary[folder] = {"new": new, "changed": changed}
            if not a.dry_run and (new or changed): save(folder, data)
    finally:
        c.disconnect()
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
