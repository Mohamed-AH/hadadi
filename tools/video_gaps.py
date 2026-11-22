#!/usr/bin/env python3
"""Fill the gaps in the audio series from the Sheikh's videos: site/data/library.json + data/youtube.json -> site/data/from_videos.json.

Some lessons are recorded on «تسجيلات دروس جدة» (YouTube) but their audio is never posted on Telegram (2026-11-22: الداء والدواء
4, 8, 9, 11 and الكبائر 1, 3, 4). For every numbered video of a series `v-<id>` whose audio series `<id>` has no lesson with that
number (the number or ordinal word after «الدرس / المجلس / اللقاء / الحلقة») and no audio posted within a few days of it, this adds
an audio lesson `yt-<video id>` to the series, with the video's date and duration and `"yt": "<video id>"`.
tools/fetch_audio.py --youtube then takes its audio from the video (yt-dlp) into R2, keyed https://youtu.be/<id> in media.json;
until then the lesson page sends visitors to the video page. Nothing here is typed by hand: rerun it after every import.
"""
import datetime as dt, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY, CATALOGUE, OUT = ROOT / "site/data/library.json", ROOT / "site/catalogue.json", ROOT / "site/data/from_videos.json"
UNITS = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"]
TENS = ["", "", "العشرون", "الثلاثون", "الأربعون", "الخمسون", "الستون", "السبعون", "الثمانون", "التسعون"]
WORDS = r"الدرس|المجلس|اللقاء|الحلقة"
NEAR = 4          # days: audio posted this soon after a video's day is that lesson (a title without a number, e.g. «١٩ ربيع الآخر»)
RUN = 120         # days: a number only matches audio this close to the video (مختصر السيرة was taught 2023-24 and again from 1448)


def ordinal(n):
    if n <= 10: return UNITS[n]
    if n == 11: return "الحادي عشر"
    if n < 20: return UNITS[n - 10] + " عشر"
    one = n % 10
    return (("الحادي" if one == 1 else UNITS[one]) + " و" + TENS[n // 10]) if one else TENS[n // 10]


def alef(s): return re.sub("[أإآ]", "ا", s)


ORD = sorted(((alef(ordinal(n)), n) for n in range(1, 100)), key=lambda x: -len(x[0]))   # longest first: «الثاني عشر» before «الثاني»


def number(title):
    """The lesson's own number in its title, or None: «… — المجلس الثاني عشر» -> 12, «الدرس ٥» -> 5."""
    t = alef(title).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    m = re.search(rf"(?:{alef(WORDS)})\s*(?:رقم\s*)?[(\[]?\s*(\d+)", t)
    if m: return int(m.group(1))
    m = re.search(rf"(?:{alef(WORDS)})\s+(.+)$", t)
    if m:
        rest = m.group(1)
        for w, n in ORD:
            if rest.startswith(w) and not re.match(r"\s*(?:عشر|و)", rest[len(w):]): return n
    return None


def unit_word(lessons):
    """The word this series' own titles use («المجلس» for الداء والدواء), «الدرس» by default."""
    seen = [m.group(0) for l in lessons for m in [re.search(WORDS, l["title"])] if m]
    return max(set(seen), key=seen.count) if seen else "الدرس"


def gaps(lib, cat):
    meta = {s["id"]: s for s in lib["series"]}
    audio = {}
    for l in lib["lessons"]:
        audio.setdefault(l["series"], []).append(l)
    out = []
    for v in sorted(cat["lessons"], key=lambda v: (v["series"], v.get("n") or 0)):
        sid = v["series"][2:] if v["series"].startswith("v-") else ""
        if not sid or sid not in meta or not isinstance(v.get("n"), int): continue
        day = dt.date.fromisoformat(v["date"])
        mine = [l for l in audio.get(sid, []) if l.get("date") and abs((dt.date.fromisoformat(l["date"]) - day).days) <= RUN]
        if any(number(l["title"]) == v["n"] for l in mine): continue
        if any(l.get("date") and 0 <= (dt.date.fromisoformat(l["date"]) - day).days <= NEAR and number(l["title"]) is None for l in mine): continue
        out.append({"id": f"yt-{v['id']}", "title": f"{meta[sid]['title']} — {unit_word(mine or audio.get(sid, []))} {ordinal(v['n'])}", "series": sid,
                    "kind": "audio", "src": "", "yt": v["id"], "hd": v["hd"], "date": v["date"], "duration": v["duration"]})
    return out


def main():
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    cat = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    lessons = gaps(lib, cat)
    OUT.write_text(json.dumps({"series": [], "lessons": lessons}, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    for l in lessons: print(f"  {l['series']:12} {l['title']}  <- youtu.be/{l['yt']}", file=sys.stderr)
    print(f"{len(lessons)} lessons filled from videos -> site/data/from_videos.json")


if __name__ == "__main__":
    main()
