"""tools/video_gaps.py: audio-series gaps filled from the numbered videos. No network. python3 tests/video_gaps_check.py"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from video_gaps import number, ordinal, gaps  # noqa: E402

ok = 0
def check(c, m):
    global ok
    if not c: sys.exit("FAIL " + m)
    ok += 1

for t, n in [("شرح الداء والدواء لابن القيم — المجلس الثاني عشر", 12), ("… — الدرس الخامس", 5), ("مختصر السيرة النبوية — الدرس ٣٣", 33),
             ("مختصر السيرة النبوية — الدرس الحادي والعشرون", 21), ("— المجلس الثاني", 2), ("شرح كتاب الكبائر — ١٩ ربيع الآخر ١٤٤٨هـ", None),
             ("الدرس الأول", 1), ("المجلس العاشر", 10)]:
    check(number(t) == n, f"number({t!r}) = {number(t)}, want {n}")
check(ordinal(11) == "الحادي عشر" and ordinal(20) == "العشرون" and ordinal(32) == "الثاني والثلاثون", "ordinals")

lib = {"series": [{"id": "daa", "title": "الداء"}, {"id": "sira", "title": "السيرة"}], "lessons": [
    {"id": "a1", "series": "daa", "title": "الداء — المجلس الأول", "date": "2026-08-28"},
    {"id": "a3", "series": "daa", "title": "الداء — ١٢ ربيع", "date": "2026-09-12"},          # no number: matched by its day
    {"id": "s1", "series": "sira", "title": "السيرة — الدرس الأول", "date": "2023-11-03"},     # an older run: not this video's lesson 1
]}
cat = {"lessons": [
    {"id": "AAAAAAAAAA1", "series": "v-daa", "n": 1, "hd": "1448-3-15", "date": "2026-08-28", "duration": 60},
    {"id": "AAAAAAAAAA2", "series": "v-daa", "n": 2, "hd": "1448-3-22", "date": "2026-09-04", "duration": 61},
    {"id": "AAAAAAAAAA3", "series": "v-daa", "n": 3, "hd": "1448-3-29", "date": "2026-09-11", "duration": 62},
    {"id": "AAAAAAAAAA7", "series": "v-daa", "title": "بلا رقم", "hd": "1448-5-18", "date": "2026-10-29", "duration": 63},
    {"id": "BBBBBBBBBB1", "series": "v-sira", "n": 1, "hd": "1448-3-25", "date": "2026-09-07", "duration": 64},
    {"id": "CCCCCCCCCC1", "series": "v-khutab", "n": 1, "hd": "1448-3-25", "date": "2026-09-07", "duration": 65},
]}
g = gaps(lib, cat)
check([l["id"] for l in g] == ["yt-AAAAAAAAAA2", "yt-AAAAAAAAAA7", "yt-BBBBBBBBBB1"], f"gaps {[l['id'] for l in g]}")
check(g[1]["title"] == "الداء — ١٨ جمادى الأولى ١٤٤٨هـ", "an unnumbered video keeps its date: " + g[1]["title"])
g = [x for x in g if x["id"] != "yt-AAAAAAAAAA7"]
check(g[0]["title"] == "الداء — المجلس الثاني" and g[0]["yt"] == "AAAAAAAAAA2" and g[0]["kind"] == "audio" and g[0]["src"] == "", "gap lesson shape")
check(g[0]["duration"] == 61 and g[0]["hd"] == "1448-3-22" and g[0]["date"] == "2026-09-04", "date and duration from the video")
check(g[1]["title"] == "السيرة — الدرس الأول", "unit word falls back to the series' titles")

# the real data: the gaps reported on 2026-11-22 are filled
root = Path(__file__).resolve().parent.parent
real = gaps(json.loads((root / "site/data/library.json").read_text("utf-8")), json.loads((root / "site/catalogue.json").read_text("utf-8")))
want = {("daa-dawa", "ITWM1CNHlns"), ("daa-dawa", "Wt0MC1YbEKA"), ("daa-dawa", "npcCJmvF-t4"), ("daa-dawa", "3uPgsmRVTL8"),
        ("kabair", "8S_ncn_YKhg"), ("kabair", "EBjDGS-dmQA"), ("kabair", "saDte5a0yFA"), ("wabil", "ktxELgwlwRw")}
check(want <= {(l["series"], l["yt"]) for l in real}, "الداء والدواء 4/8/9/11, الكبائر 1/3/4 and الوابل «١٨ جمادى الأولى» filled")
check(not any(l["series"] in ("khutab", "lectures") for l in real), "khutab and talks are not sequences")
check(not any(l["series"] == "kabair" and l["yt"] == "j6V2WBLW9_k" for l in real), "الكبائر 2 is on Telegram already")
committed = json.loads((root / "site/data/from_videos.json").read_text("utf-8"))["lessons"]
check(committed == real, "site/data/from_videos.json is up to date (run tools/video_gaps.py)")
print(f"video_gaps: {ok} checks pass")
