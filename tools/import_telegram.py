import re
"""lessons.json (from tools/telegram_lessons.py) -> site/data/library.json.

Lessons that still carry a review flag (no title, another speaker, ...) are left out until a person fixes them;
corrections go in data/telegram_overrides.json: {"<lesson id>": {"title": "...", "series": "<id>", "publish": true|false, "hd": "1445-4-12"}};
spelling-only title fixes in data/title_spelling.json: {"<lesson id>": "<title>"} (an override title wins).
"""
import json, os, sys, collections

sys.path.insert(0, os.path.dirname(__file__))
from telegram_lessons import SERIES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TELEGRAM_EXPORTS', 'telegram'), 'lessons.json')
lessons = json.load(open(src, encoding='utf-8'))
ov_path = os.path.join(ROOT, 'data', 'telegram_overrides.json')
overrides = json.load(open(ov_path, encoding='utf-8')) if os.path.exists(ov_path) else {}
sp_path = os.path.join(ROOT, 'data', 'title_spelling.json')   # {"<id>": "<title>"}: spelling-only fixes (2026-10-09 pass); an override title wins
spelling = json.load(open(sp_path, encoding='utf-8')) if os.path.exists(sp_path) else {}
meta = {sid: (title, sec) for sid, title, sec, _ in SERIES}
meta['misc'] = ('دروس ومحاضرات متفرقة', 'lectures')
MERGE = {'misc': 'lectures'}     # 2026-10-06 (owner): the one-off talks and «محاضرات وكلمات» are one series

def tidy(t):
    """Typography only (2026-11-22 audit): «باب : X» / «:-» / «موضوع :» from the posts' captions, a detached «و», repeated ?!,
    hashtags, the speaker's name at the end, and Arabic-Indic digits like the rest of the site. Words are never changed here."""
    t = t.replace('#', ' ')
    t = re.sub(r'\s*:\s*-\s*', ': ', t)
    t = re.sub(r'\s+:', ':', t)
    t = re.sub(r':(?=[^\s\d])', ': ', t)
    t = re.sub(r'(?<=: )(?:الموضوع|موضوع|العنوان|بعنوان):\s*', '', t)
    t = re.sub(r'(?<!\S)باب:\s*', 'باب ', t)
    t = re.sub(r'(?<=\s)و\s+(?=\S)', 'و', t)
    t = re.sub(r'\s*[!؟?]*[؟?][!؟?]*', '؟', t)
    t = re.sub(r'\s*!+', '!', t)
    t = re.sub(r'\s*(?:للشيخ|الشيخ)\s+حسن(?:\s+بن)?\s+علي.*$|\s+الشيخ\s+حسن\s+حدادي$', '', t)
    t = re.sub(r'\d', lambda m: '٠١٢٣٤٥٦٧٨٩'[int(m.group())], t)
    return re.sub(r'\s{2,}', ' ', t).strip()


out_lessons, skipped = [], collections.Counter()
for l in lessons:
    o = overrides.get(l['id'], {})
    if not o.get('title') and spelling.get(l['id']): l['title'] = spelling[l['id']]
    if o.get('title'): l['title'], l['flags'] = o['title'], [f for f in l['flags'] if f not in ('no title', 'no series')]
    if o.get('series'): l['series'], l['flags'] = o['series'], [f for f in l['flags'] if f != 'no series']
    l['title'] = tidy(l['title'])
    publish = o.get('publish', not l['flags'])
    if not publish or l['series'] not in meta:
        skipped['flagged' if l['flags'] else 'excluded'] += 1
        continue
    l['series'] = MERGE.get(l['series'], l['series'])
    hd = o.get('hd') or l.get('hijri') or ''   # an override hd fixes a slip in the post's own date (owner 2026-11-17: the post's date wins otherwise)
    out_lessons.append({k: v for k, v in {
        'id': l['id'], 'title': l['title'], 'series': l['series'], 'kind': 'audio',
        'src': '',                                   # filled by tools/mirror_media.py once the audio is in R2
        'tg': l['posts'][0], 'hd': hd, 'date': l['date'],
        'duration': int(round(l['duration_min'] * 60)) if l.get('duration_min') and l.get('duration_exact') else 0,
    }.items() if v not in ('', None) or k == 'src'})

used = collections.Counter(l['series'] for l in out_lessons)
series = [{'id': sid, 'title': meta[sid][0], 'sec': meta[sid][1]} for sid in meta if used[sid]]
lib = {'series': series, 'lessons': out_lessons, 'books': [], 'updated': max((l['date'] for l in out_lessons), default='')}
json.dump(lib, open(os.path.join(ROOT, 'site', 'data', 'library.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{len(out_lessons)} lessons in {len(series)} series -> site/data/library.json; left out: {dict(skipped)}")
