"""Add the Sheikh's new videos on «تسجيلات دروس جدة» to data/youtube.json (the sync job's video step).

Reads the channel's video list with yt-dlp (no API key; Arabic titles), keeps the videos whose title names the Sheikh
(حدادي), and for each one not yet in data/youtube.json works out from its own title:
  series  a book this channel already has a series for («شرح الداء والدواء 12» -> v-daa-dawa, lesson 12), a khutba
          («خطبة الجمعة …» -> v-khutab), a new book («شرح <book> 1» -> a new series v-<hash> titled «شرح <book>»), or
          v-lectures for anything else;
  hd      the Hijri date written in the title («الجمعة 10 جمادى الآخرة 1448هـ» or «17/5/1448»); a video without one is
          held (reported, not added).
Videos already in the file are never changed or removed (hand edits win; a video taken down stays until removed by hand).

Then the Sheikh's own channel «قناة فوائد ودروس الشيخ حسن الحدادي أبو عمار» (CHANNEL_2, run by a student; owner 2026-11-22, option A of
the plan): its titles carry no date and often don't name him, and it also reposts other scholars. So a new video whose title names him
(and no other scholar) is added with "posted" = its upload day from the channel feed (the newest 15; "" when not there) to v-khutab
(«خطبة…»), v-lectures (15 minutes or more) or v-fawaid; any other new video is held for review, except those in "skip"; those in
"hold" (unclear, to be checked by the team) are held until moved to the videos or to "skip".
Then run: node tools/import_youtube.mjs

Usage: python tools/youtube_sync.py [--listing file.json] [--listing2 file.json] [--feed feed.xml] [--dry-run]   -> JSON summary on stdout
"""
import argparse, hashlib, json, re, subprocess, sys, urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "youtube.json"
CHANNEL = "https://www.youtube.com/channel/UCVY9jqheVfH7OlrBYiLyQVQ/videos"
CH2 = "UCiXQI1paZlPXOMco8mwvGZQ"
CHANNEL_2 = [f"https://www.youtube.com/channel/{CH2}/videos", f"https://www.youtube.com/channel/{CH2}/shorts"]
FEED_2 = f"https://www.youtube.com/feeds/videos.xml?channel_id={CH2}"
# another scholar named in the title: the clip is his, not the Sheikh's (these channels repost them)
OTHERS = re.compile(r"عثيمين|الفوزان|برجس|الهاجري|آل الشيخ|ابن باز|بن باز|الألباني|العباد|الراجحي|الركابي|السحيمي|البخاري|اللحيدان|ربيع|الجابري")
# the Sheikh's name and the channel's extras, cut from a title (kept in the title only when nothing else is left)
NAME_TAIL = re.compile(r"(?:مختارات من خطب ودروس|كلمات)?\s*(?:الشيخ|الشبخ)?\s*(?:حسن\s+)?(?:بن\s+)?(?:علي\s+)?(?:بن حسن\s+)?(?:ال)?حد+ادي(?:\s*(?:ابو|أبو) عمار)?|(?:ابو|أبو) عمار(?:\s+الحدادي)?")
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


def listing(url=CHANNEL):
    out = subprocess.run(["yt-dlp", "--flat-playlist", "-J", "--extractor-args", "youtube:lang=ar", url],
                         capture_output=True, text=True, timeout=600)
    if out.returncode != 0: raise RuntimeError("yt-dlp: " + (out.stderr.strip().splitlines() or ["failed"])[-1][:300])
    return json.loads(out.stdout)


def entries(j):
    for e in j.get("entries") or []:
        if e.get("_type") == "playlist" or e.get("entries"):
            yield from entries(e)
        else:
            yield e


def feed_dates(xml):
    """the channel feed (its newest 15 uploads) -> {id: upload day in Riyadh, YYYY-MM-DD}"""
    out = {}
    for e in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid, pub = re.search(r"<yt:videoId>([^<]+)", e), re.search(r"<published>([^<]+)", e)
        if vid and pub:
            try: out[vid.group(1)] = (datetime.fromisoformat(pub.group(1)) + timedelta(hours=3)).strftime("%Y-%m-%d")
            except ValueError: pass
    return out


def tidy2(title):
    """a title from the Sheikh's own channel, without his name, the channel's extras or the stray punctuation"""
    t = re.sub(r"\s+", " ", title).strip()
    u = clean(NAME_TAIL.sub(" ", t)).strip(" .،,؛")
    u = re.sub(r"\.{2,}|؟{2,}", lambda m: m.group(0)[0], u)
    u = re.sub(r"\(\s*|\s*\)", lambda m: m.group(0).strip(), u)
    return re.sub(r"\s+", " ", u).strip() or t


def classify2(title, dur):
    """-> (series, title) for a video on the Sheikh's own channel that names him, or None (held for review)"""
    if not SHEIKH.search(title) and not re.search(r"(?:ابو|أبو) عمار", title): return None
    if OTHERS.search(title): return None
    t = tidy2(title)
    if t.startswith("خطبة"): return "v-khutab", t
    return ("v-lectures" if dur >= 900 else "v-fawaid"), t


def own_channel(data, have, listings, dates):
    added, held = [], []
    skip, hold = set(data.get("skip") or []), set(data.get("hold") or [])
    for j in listings:
        for e in entries(j):
            vid, title, dur = e.get("id", ""), " ".join((e.get("title") or "").split()), e.get("duration")
            if not YT.match(vid) or vid in have or vid in skip: continue
            if vid in hold: held.append({"id": vid, "title": title, "why": "waiting for the team's check (\"hold\" in data/youtube.json)"}); continue
            if not (isinstance(dur, (int, float)) and dur > 0): held.append({"id": vid, "title": title, "why": "no duration yet (live or upcoming)"}); continue
            c = classify2(title, dur)
            if not c: held.append({"id": vid, "title": title, "why": "the Sheikh's channel, but the title doesn't name him (add to data/youtube.json or to \"skip\")"}); continue
            v = {"id": vid, "series": c[0], "title": c[1], "posted": dates.get(vid, ""), "duration": int(dur)}
            data["videos"].append(v); have.add(vid)
            added.append({"id": vid, "series": c[0], "title": c[1]})
    return added, held


def vkey(v):   # dated videos by Hijri date, then the posted ones by upload day, undated last
    return [int(x) for x in v["hd"].split("-")] if v.get("hd") else [9999, 0, 0, v.get("posted") or "9999"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--listing", help="a saved yt-dlp listing instead of asking YouTube")
    ap.add_argument("--listing2", help="a saved yt-dlp listing of the Sheikh's own channel (videos and shorts in one file)")
    ap.add_argument("--feed", help="a saved feed of the Sheikh's own channel")
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
    errors = []
    if a.listing2: l2 = [json.loads(Path(a.listing2).read_text(encoding="utf-8"))]
    elif a.listing: l2 = []   # a test of the first channel only
    else:
        try: l2 = [listing(u) for u in CHANNEL_2]
        except Exception as e: l2 = []; errors.append("the Sheikh's YouTube channel (retried next run): " + str(e)[:300])
    if a.feed: xml = Path(a.feed).read_text(encoding="utf-8")
    elif l2 and not a.listing2:
        try: xml = urllib.request.urlopen(FEED_2, timeout=60).read().decode("utf-8")
        except Exception: xml = ""   # no dates this run: the videos are still added, undated
    else: xml = ""
    a2, h2 = own_channel(data, have, l2, feed_dates(xml))
    added += a2; held += h2
    if added and not a.dry_run:
        order = [s["id"] for s in data["series"]]
        data["videos"].sort(key=lambda v: (order.index(v["series"]), v.get("n") or 999, vkey(v)))
        s = json.dumps({k: data[k] for k in data if k != "videos"}, ensure_ascii=False, indent=2)[:-2]
        s += ',\n  "videos": [\n' + ",\n".join("    " + json.dumps(v, ensure_ascii=False) for v in data["videos"]) + "\n  ]\n}\n"
        DATA.write_text(s, encoding="utf-8")
    print(json.dumps({"added": added, "held": held, "errors": errors}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
