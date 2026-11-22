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
print(f"{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
