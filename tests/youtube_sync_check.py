"""tools/youtube_sync.py: titles -> series / lesson number / Hijri date. No network. Run: python tests/youtube_sync_check.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import youtube_sync as Y

S = {"v-daa-dawa": "شرح الداء والدواء لابن القيم", "v-lectures": "محاضرات وندوات ودروس"}
cases = [
    ("شرح الداء والدواء 13 | فضيلة الشيخ حسن بن علي حدادي | الجمعة 17 جمادى الآخرة 1448هـ", {"series": "v-daa-dawa", "n": 13}, "1448-6-17"),
    ("شرح كتاب #الكبائر 6 | فضيلة الشيخ حسن بن علي حدادي | الأربعاء 15 جمادى الأخرة 1448هـ", {"series": "v-kabair", "n": 6}, "1448-6-15"),
    ("خطبة الجمعة 17 جمادى الآخرة 1448هـ | فضيلة الشيخ حسن بن علي حدادي", {"series": "v-khutab", "title": "خطبة الجمعة ١٧ جمادى الآخرة"}, "1448-6-17"),
    ("خطبة الجمعة (فضل الصدقة) | فضيلة الشيخ حسن بن علي حدادي | الجمعة 24 جمادى الآخرة 1448", {"series": "v-khutab", "title": "خطبة الجمعة: فضل الصدقة"}, "1448-6-24"),
    ("محاضرة بعنوان: الثبات | الشيخ حسن حدادي | الأحد 5/7/1448", {"series": "v-lectures", "title": "محاضرة بعنوان: الثبات"}, "1448-7-5"),
    ("شرح الوابل الصيب | فضيلة الشيخ حسن بن علي حدادي | الخميس 18 جمادى الأولى 1448هـ", {"series": "v-wabil", "title": "شرح الوابل الصيب (١٨ جمادى الأولى)"}, "1448-5-18"),
    ("شرح الأصول الثلاثة 1 | فضيلة الشيخ حسن بن علي حدادي | السبت ٣ رجب ١٤٤٨هـ", {"series": Y.slug("شرح الأصول الثلاثة"), "n": 1, "new_series": "شرح الأصول الثلاثة"}, "1448-7-3"),
    ("شرح كتاب التوحيد 3 | الشيخ عبدالله البخاري", None, ""),
]
ok = fail = 0
for title, exp, hd in cases:
    got = Y.classify(title, S)
    if got == exp and (exp is None or Y.hijri_of(title) == hd): ok += 1
    else: fail += 1; print("FAIL", title, "\n  got", got, Y.hijri_of(title), "\n  exp", exp, hd)

# the Sheikh's own channel: his name -> added without it; another scholar or no name -> held; skip / hold / known ids respected
def check(name, got, exp):
    global ok, fail
    if got == exp: ok += 1
    else: fail += 1; print("FAIL", name, "\n  got", got, "\n  exp", exp)

check("own: name cut", Y.classify2("سر النجاح  وأساس الفلاح   الشيخ حسن علي حدادي", 91), ("v-fawaid", "سر النجاح وأساس الفلاح"))
check("own: abu ammar", Y.classify2("محبطات الأعمال  يستخف به كثير من الناس  الشيخ حسن علي حدادي ابو عمار", 257), ("v-fawaid", "محبطات الأعمال يستخف به كثير من الناس"))
check("own: long talk", Y.classify2("فضل العلم والعلماء وواجبات المعلمين والمعلمات الشيخ حسن حدادي", 2503), ("v-lectures", "فضل العلم والعلماء وواجبات المعلمين والمعلمات"))
check("own: khutba", Y.classify2("خطبة الجمعة فضل الصدقة الشيخ حسن بن علي حدادي", 1300), ("v-khutab", "خطبة الجمعة فضل الصدقة"))
check("own: dots", Y.classify2("ما الذي يتمناه الكافر بعد الموت؟؟.    مختارات من خطب ودروس    الشيخ   حسن بن علي حدادي", 119), ("v-fawaid", "ما الذي يتمناه الكافر بعد الموت؟"))
check("own: other scholar", Y.classify2("كلام ابن عثيمين في الصبر الشيخ حسن حدادي", 100), None)
check("own: no name", Y.classify2("هل حياتك كلها مشاكل  اسمع الحل", 184), None)
FEED = "<feed><entry><yt:videoId>aaaaaaaaaa1</yt:videoId><published>2025-03-08T22:40:43+00:00</published></entry></feed>"
check("feed: Riyadh day", Y.feed_dates(FEED), {"aaaaaaaaaa1": "2025-03-09"})
data = {"videos": [{"id": "known000001"}], "skip": ["skipped0001"], "hold": ["holding0001"]}
L = {"entries": [{"id": "aaaaaaaaaa1", "title": "سر النجاح الشيخ حسن علي حدادي", "duration": 91},
                 {"id": "aaaaaaaaaa2", "title": "أبواب جهنم الشيخ حسن علي حدادي", "duration": 121},
                 {"id": "aaaaaaaaaa3", "title": "هل حياتك كلها مشاكل", "duration": 184},
                 {"id": "known000001", "title": "x الشيخ حسن حدادي", "duration": 9},
                 {"id": "skipped0001", "title": "الفوزان", "duration": 9},
                 {"id": "holding0001", "title": "٧ مارس، ٢٠٢٤", "duration": 9}]}
added, held = Y.own_channel(data, {"known000001"}, [L], Y.feed_dates(FEED))
check("own: added", [(v["id"], v["series"]) for v in added], [("aaaaaaaaaa1", "v-fawaid"), ("aaaaaaaaaa2", "v-fawaid")])
check("own: posted", [v.get("posted") for v in data["videos"][1:]], ["2025-03-09", ""])
check("own: held", sorted(h["id"] for h in held), ["aaaaaaaaaa3", "holding0001"])
check("sort key", sorted([{"hd": "1448-3-1"}, {"posted": ""}, {"posted": "2024-06-11"}], key=Y.vkey), [{"hd": "1448-3-1"}, {"posted": "2024-06-11"}, {"posted": ""}])
print(f"{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
