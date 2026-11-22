"""tools/tg_fetch.py: Telethon messages -> Telegram Desktop export shape, and merging into the history. No network.
Run: python tests/tg_fetch_check.py  (needs telethon)"""
import sys, json
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import tg_fetch as T
from telethon.tl.types import (Message, MessageService, MessageActionPinMessage, PeerChannel, MessageMediaDocument, MessageMediaPhoto, Document,
                               DocumentAttributeAudio, DocumentAttributeFilename, MessageEntityUrl, MessageEntityTextUrl, MessageEntityBold,
                               MessageFwdHeader, Photo)

ok = fail = 0
def check(name, cond, got=None):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print("FAIL", name, got)

when = datetime.fromtimestamp(1795209442, timezone.utc)   # h_haddadi7-1341 in the owner's export: 2026-11-21T00:17:22 Riyadh
cap = "📻 مادة صوتية\n\n📚 محاضرة بعنوان: «خطورة تعظيم قبور الأموات»\n\n📍 موقع الجامع:\nhttps://maps.app.goo.gl/1ARJp5UR9G7bQBrF8?g_st=ic"
url = "https://maps.app.goo.gl/1ARJp5UR9G7bQBrF8?g_st=ic"
from telethon.helpers import add_surrogate
u16 = len(add_surrogate(cap)) - len(url)
doc = Document(id=1, access_hash=1, file_reference=b"", date=when, mime_type="audio/mpeg", size=39549398, dc_id=4,
               attributes=[DocumentAttributeAudio(duration=2509, voice=False), DocumentAttributeFilename(file_name="محاضرة.m4a")])
m = Message(id=1341, peer_id=PeerChannel(1186686748), date=when, message=cap, media=MessageMediaDocument(document=doc),
            entities=[MessageEntityUrl(offset=u16, length=len(url))])
x = T.to_export(m)
check("date is Riyadh time", x["date"] == "2026-11-21T00:17:22", x["date"])
check("unixtime", x["date_unixtime"] == "1795209442")
check("audio fields", (x["media_type"], x["duration_seconds"], x["file_size"], x["mime_type"], x["file_name"]) == ("audio_file", 2509, 39549398, "audio/mpeg", "محاضرة.m4a"), x)
check("file placeholder", x["file"].startswith("(File not included"))
check("text list with the link (emoji count as 2 UTF-16 units)", x["text"] == [cap[:-len(url)], {"type": "link", "text": url}, ""], x["text"])

voice = Document(id=2, access_hash=1, file_reference=b"", date=when, mime_type="audio/ogg", size=1000, dc_id=4, attributes=[DocumentAttributeAudio(duration=60, voice=True)])
v = T.to_export(Message(id=5, peer_id=PeerChannel(1), date=when, message="", media=MessageMediaDocument(document=voice)))
check("voice message", v["media_type"] == "voice_message" and v["text"] == "" and "file_name" not in v, v)

p = T.to_export(Message(id=6, peer_id=PeerChannel(1), date=when, message="**جدول**", media=MessageMediaPhoto(photo=None),
                        entities=[MessageEntityBold(offset=0, length=2), MessageEntityTextUrl(offset=2, length=5, url="https://x.y")]))
check("photo post has no file", "photo" in p and "file" not in p, p)
check("text_link keeps href", p["text"][1] == {"type": "text_link", "text": "جدول", "href": "https://x.y"} or p["text"][1].get("href") == "https://x.y", p["text"])

f = T.to_export(Message(id=7, peer_id=PeerChannel(1), date=when, message="x", fwd_from=MessageFwdHeader(date=when, from_name="قناة أخرى")))
check("forwarded name", f["forwarded_from"] == "قناة أخرى", f)
s = T.to_export(MessageService(id=8, peer_id=PeerChannel(1), date=when, action=MessageActionPinMessage()))
check("service", s["type"] == "service", s)

data = {"name": "n", "id": 1, "messages": [{"id": 1, "type": "message", "text": "a"}, {"id": 2, "type": "message", "text": "b"}]}
new, changed = T.merge(data, [{"id": 2, "type": "message", "text": "b2"}, {"id": 3, "type": "message", "text": "c"}])
check("merge", new == [3] and changed == [2] and [m["id"] for m in data["messages"]] == [1, 2, 3] and data["messages"][1]["text"] == "b2", data)
new, changed = T.merge(data, [])
check("never removes", len(data["messages"]) == 3 and not new and not changed)

print(f"{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
