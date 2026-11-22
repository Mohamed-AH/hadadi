"""Add the Sheikh's new videos on «تسجيلات دروس جدة» to data/youtube.json (the sync job's video step).

Reads the channel's video list with yt-dlp (no API key; Arabic titles), keeps the videos whose title names the Sheikh
(حدادي), and for each one not yet in data/youtube.json works out from its own title:
  series  a book this channel already has a series for («شرح الداء والدواء 12» -> v-daa-dawa, lesson 12), a khutba
          («خطبة الجمعة …» -> v-khutab), a new book («شرح <book> 1» -> a new series v-<hash> titled «شرح <book>»), or
          v-lectures for anything else;
  hd      the Hijri date written in the title («الجمعة 10 جمادى الآخرة 1448هـ» or «17/5/1448»); a video without one is
          held (reported, not added).
Videos already in the file are never changed or removed (hand edits win; a video taken down stays until removed by hand).
Then run: node tools/import_youtube.mjs

Usage: python tools/youtube_sync.py [--listing file.json] [--dry-run]   -> JSON summary on stdout
"""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "youtube.json"
CHANNEL = "https://www.youtube.com/channel/UCVY9jqheVfH7OlrBYiLyQVQ/videos"
SHEIKH = re.compile(r"حدادي|حدّادي")
YT = re.compile(r"^[\w-]{11}$")
MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"]
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
# a book series: a phrase in the first part of the title -> its series id (the existing ones; a new book gets its own)
BOOKS = [("الداء والدواء", "v-daa-dawa"), ("الوابل الصيب", "v-wabil"), ("الكبائر", "v-kabair"), ("سيرة الرسول", "v-sira")]
TO_AR = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def norm_month(s):
    s = re.sub(r"[أإآ]", "ا", s).replace("ى", "ي").replace("ة", "ه").replace("  ", " ")
    return s


def month_no(word):
    w = norm_month(word.strip())
    for i, m in enumerate(MONTHS, 1):
        if norm_month(m) == w: return i
    if w in ("جمادي الاخره", "جمادي الثاني", "جمادي الثانيه"): return 6
    if w in ("جمادي الاول",): return 5
    if w in ("ربيع الثاني",): return 4
    return 0


def hijri_of(title):
    t = title.translate(AR_DIGITS)
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(14\d\d)", t)
    if m: return f"{m.group(3)}-{int(m.group(2))}-{int(m.group(1))}"
    names = "|".join(re.escape(x) for x in MONTHS) + r"|جمادى الأخرة|جمادي الآخرة|جمادى الثانية|ربيع الثاني"
    m = re.search(r"(\d{1,2})\s+(" + names + r")\s+(14\d\d)", t)
    if m and month_no(m.group(2)): return f"{m.group(3)}-{month_no(m.group(2))}-{int(m.group(1))}"
    return ""


def clean(s):
    s = re.sub(r"#\s*", "", s)
    s = re.sub(r"\s+", " ", s).strip(" -–|:")
    return s


def slug(title):
    return "v-" + hashlib.sha1(title.encode("utf-8")).hexdigest()[:8]


def classify(title, series_titles):
    """-> dict(series, n?, title?, new_series?) from a video title, or None when it is not one of the Sheikh's."""
    if not SHEIKH.search(title): return None
    head = clean(title.split("|")[0])
    head_digits = head.translate(AR_DIGITS)
    if head.startswith("خطبة"):
        topic = re.search(r"\(([^)]+)\)", head)
        if topic: return {"series": "v-khutab", "title": f"خطبة الجمعة: {clean(topic.group(1))}"}
        hd = hijri_of(title)
        if hd:
            y, m, d = map(int, hd.split("-"))
            return {"series": "v-khutab", "title": f"خطبة الجمعة {str(d).translate(TO_AR)} {MONTHS[m - 1]}"}
        return {"series": "v-khutab", "title": "خطبة الجمعة"}
    num = re.search(r"(\d+)\s*$", head_digits)
    for phrase, sid in BOOKS:
        if phrase in head:
            if num: return {"series": sid, "n": int(num.group(1))}
            hd = hijri_of(title)   # no lesson number: the date tells it apart, as done by hand for «شرح الوابل الصيب (١٨ جمادى الأولى)»
            if hd:
                y, m, d = map(int, hd.split("-"))
                return {"series": sid, "title": f"{head} ({str(d).translate(TO_AR)} {MONTHS[m - 1]})"}
            return {"series": sid, "title": head}
    if num and head.startswith("شرح"):
        book = clean(head_digits[: num.start()])
        for sid, st in series_titles.items():
            if st == book: return {"series": sid, "n": int(num.group(1))}
        return {"series": slug(book), "n": int(num.group(1)), "new_series": book}
    return {"series": "v-lectures", "title": head}


def listing():
    out = subprocess.run(["yt-dlp", "--flat-playlist", "-J", "--extractor-args", "youtube:lang=ar", CHANNEL],
                         capture_output=True, text=True, timeout=600)
    if out.returncode != 0: raise RuntimeError("yt-dlp: " + (out.stderr.strip().splitlines() or ["failed"])[-1][:300])
    return json.loads(out.stdout)


def entries(j):
    for e in j.get("entries") or []:
        if e.get("_type") == "playlist" or e.get("entries"):
            yield from entries(e)
        else:
            yield e


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--listing", help="a saved yt-dlp listing instead of asking YouTube")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    data = json.loads(DATA.read_text(encoding="utf-8"))
    have = {v["id"] for v in data["videos"]}
    titles = {s["id"]: s["title"] for s in data["series"]}
    j = json.loads(Path(a.listing).read_text(encoding="utf-8")) if a.listing else listing()
    added, held = [], []
    for e in entries(j):
        vid, title, dur = e.get("id", ""), e.get("title") or "", e.get("duration")
        if not YT.match(vid) or vid in have: continue
        c = classify(title, titles)
        if not c: continue
        if not (isinstance(dur, (int, float)) and dur > 0): held.append({"id": vid, "title": title, "why": "no duration yet (live or upcoming)"}); continue
        hd = hijri_of(title)
        if not hd: held.append({"id": vid, "title": title, "why": "no Hijri date in the title"}); continue
        if c.get("new_series"):
            data["series"].append({"id": c["series"], "title": c["new_series"], "subject": "دروس"})
            titles[c["series"]] = c["new_series"]
        v = {"id": vid, "series": c["series"]}
        if "n" in c: v["n"] = c["n"]
        if "title" in c: v["title"] = c["title"]
        v.update(hd=hd, duration=int(dur))
        data["videos"].append(v); have.add(vid)
        added.append({"id": vid, "series": c["series"], "title": c.get("title") or f"{titles[c['series']]} {c.get('n', '')}".strip()})
    if added and not a.dry_run:
        order = [s["id"] for s in data["series"]]
        data["videos"].sort(key=lambda v: (order.index(v["series"]), v.get("n") or 999, [int(x) for x in v["hd"].split("-")]))
        s = json.dumps({k: data[k] for k in data if k != "videos"}, ensure_ascii=False, indent=2)[:-2]
        s += ',\n  "videos": [\n' + ",\n".join("    " + json.dumps(v, ensure_ascii=False) for v in data["videos"]) + "\n  ]\n}\n"
        DATA.write_text(s, encoding="utf-8")
    print(json.dumps({"added": added, "held": held}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
