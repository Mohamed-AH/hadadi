"""Merge the two Telegram exports into one de-duplicated lesson list.

Reads  $TELEGRAM_EXPORTS/{h_haddadi7,masothrbj47}/result.json (Telegram Desktop JSON exports; a missing one is skipped)
Writes $TELEGRAM_EXPORTS/lessons.json (input of tools/import_telegram.py)
"""
import json, os, re, collections, unicodedata
from datetime import datetime

ROOT = os.environ.get('TELEGRAM_EXPORTS', 'telegram')   # folder with h_haddadi7/result.json and masothrbj47/result.json
CHANNELS = ['h_haddadi7', 'masothrbj47']   # the main channel wins when a file is in both (folder names; also the lesson-id prefix)
# the second channel's real public username is Aqar8 (owner's check 2026-11-20); the folder name and ids stay masothrbj47
PUBLIC = {'masothrbj47': 'Aqar8'}
def tme(post):                               # "folder/id" -> its public t.me link
    ch, _, n = post.partition('/')
    return f"https://t.me/{PUBLIC.get(ch, ch)}/{n}"
QA_CHANNEL = None                         # no question-and-answer channel (yet)
SHEIKH_CHANNELS = {'قناة الشيخ حسن بن علي حدادي', 'دروس الشيخ حسن بن علي حدادي ( رقم 2 ) ✍ 🎤'}
OTHER_SCHOLARS = ['الفوزان', 'ابن باز', 'بن باز', 'العثيمين', 'ابن عثيمين', 'الألباني', 'المدخلي',
                  'ربيع بن هادي', 'السحيمي', 'اللحيدان', 'آل الشيخ', 'مفتي', 'الركابي', 'علي بن يحيى الحدادي',
                  'الجنيد', 'العبيلان', 'النجمي', 'زيد المدخلي', 'الجابري']

# (series id, title, section, pattern) — first match wins, so specific before general. Patterns use \\s* between words
# because the posts often drop or add a space. Written for الشيخ حسن بن علي حدادي's two channels (2026-11-17); every book
# he explains is its own series, and anything starting with «خطبة …» is a khutba whatever its subject.
SERIES = [
    ('tilawa',      'تلاوات',                          'tilawa',   r'^\s*(?:تلاوة|صلاة\s*(?:ال)?(?:فجر|عشاء|تهجد|قيام|تراويح|مغرب))'),
    ('khutab',      'خطب الجمعة والعيدين',             'khutab',   r'^\s*(?:مقتطف\s*من\s*)?(?:\[\d+\]\s*)?(?:خطبة|خطبتا|خطبتي|خطبه|خطب\b)'),
    ('usul-tafsir', 'مقدمة في أصول التفسير',           'tafsir',   r'[أا]صول\s*التفسير'),
    ('qisar',       'تفسير قصار السور',                'tafsir',   r'قصار[ىي]?\s*السور|تفسير\s*جزء\s*عم'),
    ('saadi-hajj',  'آيات الحج من تفسير السعدي',       'tafsir',   r'آيات\s*الحج'),
    ('tafsir',      'دروس في التفسير',                 'tafsir',   r'تفسير\s*(?:سورة|قول|آية)|درس\s*تفسير'),
    ('arbain',      'شرح الأربعين النووية',            'hadith',   r'الاربعين|الأربعين|الأربعون|الاربعون'),
    ('umdah',       'شرح عمدة الأحكام',                'hadith',   r'عمدة'),
    ('imara',       'شرح كتاب الإمارة من مختصر صحيح مسلم', 'hadith', r'الإمارة|الامارة|صحيح\s*مسلم'),
    ('bahja',       'التعليق على بهجة قلوب الأبرار',   'hadith',   r'بهجة\s*قلوب'),
    ('hadith-course','الدورة العلمية في الحديث وعلومه', 'hadith',  r'الحديث\s*وعلوم|الدور[ةه]?\s*العلمية|أصول\s*الأخبار|البيقونية'),
    ('bukhari',     'التعليق على كتاب الصيام من صحيح البخاري',                'hadith',   r'صحيح\s*البخاري'),
    ('kabair',      'شرح كتاب الكبائر',                'aqeedah',  r'كتاب\s*-?\s*\[?\s*الكبائر'),
    ('sullam',      'شرح سلم الوصول',                  'aqeedah',  r'سلم\s*الوصول'),
    ('kashf',       'شرح كشف الشبهات',                 'aqeedah',  r'كشف\s*الشبهات'),
    ('qawaid',      'شرح القواعد الأربع',              'aqeedah',  r'القواعد\s*ال[أا]ربع|القاعدة\s*(?:الأولى|الاولى|الثانية|الثالثة|الرابعة)'),
    ('fadl-islam',  'شرح فضل الإسلام',                 'aqeedah',  r'فضل\s*ال[إا]سلام'),
    ('usul',        'شرح الأصول الثلاثة',              'aqeedah',  r'ال[أا]صول\s*الثلاث'),
    ('haiyya',      'شرح حائية ابن أبي داود',          'aqeedah',  r'حائية|الحائية'),
    ('daa-dawa',    'شرح الداء والدواء لابن القيم',    'aqeedah',  r'الداء\s*والدواء'),
    ('wabil',       'شرح الوابل الصيب لابن القيم',     'aqeedah',  r'الوابل\s*الصي'),
    ('tawhid',      'شرح كتاب التوحيد',                'aqeedah',  r'كتاب\s*التوحيد|^\s*باب\s*(?:قول|قوله|ما\s*جاء|من|لا|الشفاعة|الخوف)'),
    ('hajj',        'شرح التحقيق والإيضاح لمسائل الحج', 'fiqh',    r'التحقيق\s*و\s*ال[إا]يضاح|مسائل\s*الحج'),
    ('siyam',       'حقيقة الصيام لابن تيمية',                  'fiqh',     r'[أا]حكام\s*الصيام|كتاب\s*الصيام|الدرس\s*\S+\s*\(\d+\)'),
    ('khulafa',     'سيرة الخلفاء الراشدين',           'sira',     r'الخلفاء\s*الراشدين|الخليفة\s*الراشد|الخلفة\s*الراشد'),
    ('ramadan',     'مجالس الجمعة في رمضان',           'lectures', r'مجالس\s*الجمعة\s*في\s*رمضان'),
    ('sira',        'مختصر السيرة النبوية',            'sira',     r'السيرة\s*النبوية|سيرة\s*(?:النبي|الرسول)'),
    ('khutab',      'خطب الجمعة والعيدين',             'khutab',   r'خطبة|خطبه|الخطبة|خطيب'),
    ('lectures',    'محاضرات وكلمات',                  'lectures', r'محاضرة|محاضره|كلمة|كلمه|نصيحة|ندوة|لقاء\s*ب'),
    ('fatawa',      'أسئلة وأجوبة',                    'lectures', r'أسئلة|اسئلة|سؤال|فتوى'),
]
SERIES_RE = [(sid, t, sec, re.compile(p)) for sid, t, sec, p in SERIES]

AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
MONTHS = {'محرم': 1, 'صفر': 2, 'ربيع الاول': 3, 'ربيع الأول': 3, 'ربيع اول': 3, 'ربيع الآخر': 4, 'ربيع الاخر': 4,
          'ربيع الثاني': 4, 'جمادى الاولى': 5, 'جمادى الأولى': 5, 'جمادى الاخرة': 6, 'جمادى الآخرة': 6,
          'جمادى الثانية': 6, 'رجب': 7, 'شعبان': 8, 'رمضان': 9, 'شوال': 10, 'ذو القعدة': 11, 'ذي القعدة': 11,
          'ذو العقدة': 11, 'ذو الحجة': 12, 'ذي الحجة': 12}
ORDINALS = {'الأول': 1, 'الاول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7,
            'الثامن': 8, 'التاسع': 9, 'العاشر': 10, 'الحادي عشر': 11, 'الثاني عشر': 12, 'الثالث عشر': 13,
            'الرابع عشر': 14, 'الخامس عشر': 15, 'السادس عشر': 16, 'السابع عشر': 17, 'الثامن عشر': 18,
            'التاسع عشر': 19, 'العشرون': 20}
CUT_NAME = re.compile(r'-?AudioConverter')      # these file names were cut to ~15 characters before the suffix
JUNK_NAME = re.compile(r'^(AUD|PTT|audio|VID|WA|Recording|rec|voice|record|\d+$|[\d_\- ]+$)', re.I)
EMOJI = re.compile('[\U0001F000-\U0001FFFF☀-➿⬀-⯿■-◿️‍‏‎⁦-⁩]')


def text_of(x):
    t = x.get('text')
    return t if isinstance(t, str) else ''.join(p if isinstance(p, str) else p.get('text', '') for p in t)


def clean(s):
    s = unicodedata.normalize('NFC', s or '')     # some posts write ئ as ي + a combining hamza, which no pattern would match
    s = EMOJI.sub(' ', s).replace('_', ' ').replace('ـ', '').replace('ﻯ', 'ى').replace('ﻱ', 'ي')
    s = re.sub(r'[ً-ْ]', '', s)               # diacritics
    s = re.sub(r'[\u200b-\u200f\u2066-\u2069\ufeff]', '', s)   # zero-width and direction marks (some jabrih titles start with U+200B)
    return re.sub(r'\s+', ' ', s).strip()


def name_title(fn):
    if not fn:
        return ''
    stem = re.sub(r'\.(m4a|mp3|ogg|opus|aac|wav|amr|mp4)$', '', fn, flags=re.I)
    stem = re.sub(r'-?AudioConverter.*$', '', stem)
    if JUNK_NAME.match(stem.strip()) or JUNK_CAPTION.match(clean(stem)):
        return ''
    return clean(stem)


def caption_title(t):
    """First line of a caption that actually names the lesson (channel boilerplate like «جديد الدروس» is skipped)."""
    for line in (t or '').split('\n'):
        c = clean(line).strip(' -:.*#')
        if len(c) >= 6 and not re.match(r'^(فضيلة|لفضيلة|مع فضيلة|الشيخ|جامع|مسجد|http|حسن بن علي|قناة|رابط|اشترك|انشر|حفظه الله|وفقه الله|مادة صوتية|درس جديد|ألقاها|القاها|مقطع صوتي من)', c) and not JUNK_CAPTION.match(c):
            return c[:160]
    return ''


def hijri(s):
    s = s.translate(AR_DIGITS).replace('ا', 'ا')
    m = re.search(r'(\d{1,2})\s*[/\-.ا،؛]\s*(\d{1,2})\s*[/\-.ا،؛]\s*(14\d\d)', s)
    if m:
        return f'{m.group(3)}-{int(m.group(2))}-{int(m.group(1))}'
    m = re.search(r'(14\d\d)\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})', s)
    if m:
        return f'{m.group(1)}-{int(m.group(2))}-{int(m.group(3))}'
    for name, num in sorted(MONTHS.items(), key=lambda kv: -len(kv[0])):
        m = re.search(r'(\d{1,2})\s*' + name + r'\s*(14\d\d)', s)
        if m:
            return f'{m.group(2)}-{num}-{int(m.group(1))}'
    return ''


def lesson_no(s):
    s2 = s.translate(AR_DIGITS)
    m = re.search(r'(?:الدرس|درس|المجلس|الحلقة|الشريط)\s*(?:رقم)?\s*\(?(\d{1,3})\)?', s2)
    if m:
        return int(m.group(1))
    for w, n in sorted(ORDINALS.items(), key=lambda kv: -len(kv[0])):
        if re.search(r'(?:الدرس|المجلس|الحلقة)\s+' + w + r'(?!\s*عشر)', s2):
            return n
    return None


JUNK_CAPTION = re.compile(r'^(مقطع صوتي|صوت|تسجيل صوتي|جديد|الجديد|تسجيل جديد|مجموعة\s*\d+|للإستماع|للاستماع)\b')
VOICE_BPS = 18300 / 8          # bytes/s of the channels' voice notes (5.66 MB voice = 41:20 m4a, posts 5968/5969)
WINDOW = 1800                  # an announcement must precede its audio by at most 30 min
QA_WINDOW = 86400              # ... but a question is answered by the next audio, sometimes hours later
AUDIO_LINK = re.compile(r'https?://\S*(?:top4top\.net|archive\.org)/\S+\.(?:mp3|m4a|amr|ogg|aac)', re.I)


def is_audio(x):
    return x.get('media_type') in ('audio_file', 'voice_message') or (x.get('mime_type') or '').startswith('audio/')


def links_of(x):
    t = x.get('text')
    return [] if isinstance(t, str) else [p.get('href') or p.get('text', '') for p in t
                                          if isinstance(p, dict) and p.get('type') in ('link', 'text_link')]


QA_NOISE = re.compile(r'^(?:[\W_]+|و?[أاإ]حسن (?:الله )?[إا]لي(?:كم|ك|كن)|السل\S* عليكم\S*(?: \S*رحم\S*)?(?: \S*ل[لہه]\S*)?(?: \S*برك\S*)?|'
                      r'حياكم الله|بارك الله فيكم|جزاكم الله خيرا|شيخنا(?: الفاضل)?|يا شيخ(?:نا)?|فضيلة الشيخ|سؤالي|'
                      r'سائل(?:ة)? (?:يقول|تقول)|يقول|تقول|سـ?/|س/)\s*')


def announcement(t):
    """Book, Hijri date and stated length from a 'تم التسجيل' style post."""
    c = clean(t)
    book = ''
    m = re.search(r'(?:شرح|كتاب)\s*(?:كتاب)?\s*[:\-]?\s*[\(\[]\s*([^\)\]]{3,80})[\)\]]', c)
    if m:
        book = re.sub(r'\s*-\s*', ' ', m.group(1)).strip(' -')
    elif re.search(r'خطب', c):
        m = re.search(r'خطبة الجمعة\s*([^\n]{0,60})', clean(t.split('\n\n')[0] + ' ' + ' '.join(t.split('\n')[:4])))
        book = 'خطبة الجمعة'
    d = re.search(r'\(?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\)?\s*دقيق', c.translate(AR_DIGITS))
    secs = None
    if d:
        a, b, e = int(d.group(1)), int(d.group(2)), d.group(3)
        secs = a * 3600 + b * 60 + int(e) if e else a * 60 + b
    return book, hijri(c), secs, ('تم التسجيل' in c or bool(book))


BOILER = re.compile(r'العلم اشرف|العلم أشرف|اكرم من يمشي|أكرم من يمشي|تم التسجيل|دعوتكم|فضيلة|لفضيلة|الشيخ الوالد|'
                    r'جامع|مسجد|http|موقع|لشهر|اليوم|بعد صلاة|حفظه الله|القنوات|قناة|الدال على الخير|جديد|السلام عليكم|'
                    r'سائل يقول|احسن الله|أحسن الله|^\W*$')


def question(t):
    """The question asked in a Q&A post, without greetings, shortened."""
    t = re.split(r'═', t.replace('ﻯ', 'ى').replace('ﻱ', 'ي'))[0]          # the question comes before the separator
    t = re.sub(r'https?://\S+', ' ', t)
    lines = [clean(x).strip(' 【】[]-:.*') for x in t.split('\n')]
    lines = [l for l in lines if l and not re.search(r'^\W*الس\W*\d*\W*ؤال|مجموعة أسئلة|^جواب|رابط|للإستماع|للاستماع|للمشاهدة|'
                                                      r'للتحميل|للإشتراك|للاشتراك|حسن بن علي|حفظه الله', l)]
    body = re.sub(r'\.{2,}', ' ', ' '.join(lines))
    body = re.sub(r'^\d+\s*[_\-.)]?\s+', '', body.strip(' *【】'))
    for _ in range(8):
        body = QA_NOISE.sub('', body).strip()
    body = body.replace('【', '').replace('】', '').strip()
    end = re.search(r'[?؟]', body)
    body = body[:end.start() + 1] if end and end.start() > 10 else body
    return (body[:110].rsplit(' ', 1)[0] + '…') if len(body) > 120 else body


def desc_title(t):
    """A short title from a describing post: Q&A number + question, the book, or its first real line."""
    c = clean(t).translate(AR_DIGITS)
    q = re.search(r'الس\W*\(?\s*(\d{1,3})\s*\)?\W*ؤال', c)
    if q:
        body = question(t)
        return f"السؤال {int(q.group(1))}" + (': ' + body if body else '')
    g = re.search(r'مجموعة أسئلة\W*(\d{1,3})', c)
    if g:
        body = question(re.sub(r'^.*?مجموعة أسئلة\W*\d+\W*', '', t.translate(AR_DIGITS), flags=re.S))
        return f"مجموعة أسئلة {int(g.group(1))}" + (': ' + body if body else '')
    if re.match(r'\W*(?:سـ?/|س/|أحسن الله إليكم|احسن الله اليكم)', c):
        body = question(t)
        if body:
            return body
    sura = re.search(r'سورة\s+[^\s()،,]+(?:\s+(?:من|الآيات|آية)\s+[^()]{0,30}?\d+\s*(?:إلى|الى|-)\s*\d+)?', c.replace('ﻯ', 'ى').replace('إلى', ' إلى '))
    if re.search(r'تلاوة|تلاوه', c) and sura:
        return 'تلاوة ' + re.sub(r'\s+', ' ', sura.group(0)).strip()
    if 'لقاء مع' in c:
        return 'لقاء مع الشيخ' + (' والإجابة على بعض الأسئلة' if re.search(r'الإجابة|الاجابة', c) else '')
    book = announcement(t)[0]
    lines = [clean(x).strip(' -:.*#©⇦[](){}【】') for x in (t or '').split('\n')]
    for i, l in enumerate(lines):                       # "عنوان المحاضرة 🔽" then the title on the next line
        if re.search(r'عنوان|بعنوان', l):
            rest = re.sub(r'.*(?:عنوان المحاضرة|عنوان الخطبة|بعنوان)\s*:?', '', l).strip()
            nxt = rest or next((n for n in lines[i + 1:] if len(n) >= 4), '')
            if nxt:
                return (book + ': ' + nxt if book and book not in nxt else nxt)[:160]
    if book:                                            # a lesson in a book: the book name (+ date added later)
        return book
    for l in lines:
        if len(l) >= 6 and not BOILER.search(l):
            return l[:160]
    return ''


GENERIC = re.compile(r'^(?:الدرس|درس|المجلس|مجلس|اللقاء|القاء|لقاء|الحديث|الحلقة)\s*(?:رقم\s*)?(?:\S+\s*(?:عشر|والعشرون|والعشرين|والثلاثون)?|\(?\d+\)?)\s*(?:\(\s*\d+\s*\))?\s*(?:والأخير)?$')
HEADS = re.compile(r'^(?:خطبة|خطبه)\s*(?:ال)?جمع[ةه]$|^(?:محاضرة|كلمة|كلمه|ندوة)\s*(?:مهمة\s*جدا)?\s*(?:بعنوان)?$|^عنوان\s*(?:المحاضرة|الخطبة|الكلمة)$|^بعنوان$')
NOISE = re.compile(r'العلم\s*[أا]شرف|[أا]كرم\s*من\s*يمشي|[تن]م\s*التسجيل|الدرس\s*ال[أا]سبوعي|الدروس\s*ال[أا]سبوعية|^لشهر|لشهر\s*-|اسبوعيا|[أا]سبوعياً|'
                   r'^كل\s*يوم|^اليوم|^يوم\s|^من\s*بعد|^بعد\s*صلاة|^فضيلة|^لفضيلة|^مع\s*فضيلة|^الشيخ|^شرح\s*و\s*تعليق\s*الشيخ|حسن\s*(?:بن\s*)?علي|حدادي|حفظه\s*الله|'
                   r'^بمحافظة|^محافظة|^جامع|^مسجد|^بجامع|^بمسجد|^المقام\s*ب|^بحي|^حي\s|^جد[هة]$|موقع|http|^ملاحظة|تسجيل\s*الشيخ|يبث\s*الدرس|^قناة|'
                   r'مادة\s*صوتية|درس\s*جديد|دعوتكم|يسر[ّ]?نا|^الدروس\s*العلمية|^تذكير$|^مجالس\s*العلم\.?\s*وحلقات\s*الذكر|^دروس\s*الشيخ\W*$|^مقطع\s*صوتي|^هجري|^\d[\d/\-.\s]*(?:هـ|ه|هجري)?$|^ألقاها|^القاها|^في\s*برنامج|^تم\s*الشرح|^تم\s*شرح|^الدورة\s*العلمية\s*ب')
SPEAKER_TAIL = re.compile(r'\s*[-–:]?\s*(?:فضيلة\s*)?(?:ال|لل|ل)?(?:شيخ|شيح)?\s*(?:د\.?\s*)?حسن\s*(?:بن\s*)?(?:علي\s*)?(?:حسن\s*)?(?:ال)?حداد[يى].*$|\s*(?:ابو|أبو)\s*عمار.*$|\s*جامع\s*عبد\s*الله\s*بن\s*عمار.*$')
BOOK = re.compile(r'(?:شرح|التعليق\s*على)\s*(?:كتاب|متن)?\s*[-:(\[«]*\s*([^)\]»\n]{3,60}?)\s*(?:[)\]»]|\s-\s|\s*للإمام|\s*للامام|\s*لشيخ|\s*للحافظ|\s*للعلامة|$)')


def hadadi_title(t):
    """A title from one of the Sheikh's posts: the first line that names the lesson, with a bare «الدرس الرابع» or
    «خطبة الجمعة» completed by the line that follows it, and the speaker / mosque tail cut off."""
    lines = []
    for raw in (t or '').split('\n'):
        c = clean(raw).strip(' -–:.*#©⇦[](){}【】《》<>«»"\'|،,؛')
        c = re.sub(r'^\[\s*\d+\s*\]\s*', '', c).strip(' -:.')
        speaker = bool(re.search(r'حسن\s*(?:بن\s*)?علي|حدادي', c))
        c = SPEAKER_TAIL.sub('', c).strip(' -–:.*')
        if len(c) < 3 or NOISE.search(c):
            if lines and speaker:
                break                                  # the speaker line ends the title block
            continue
        lines.append(c)
        if speaker:
            break
    if not lines:
        return ''
    lines = [re.sub(r'\s+', ' ', re.sub(r'[(){}\[\]«»]+', ' ', l)).strip(' -:.!') for l in lines]
    head = lines[0]
    m = BOOK.search(clean(t))
    book = re.sub(r'\s*-\s*$', '', m.group(1)).strip() if m else ''
    nxt = next((l for l in lines[1:] if not (book and book in l) and not re.match(r'^(?:شرح|التعليق|لل|لشيخ|ل?ل?[إا]مام|الحافظ|العلامة|رحمه|تعليق)', l)), '')
    if HEADS.match(head):
        head = re.sub(r'^خطبه', 'خطبة', re.sub(r'\s*بعنوان$', '', head))
        return (head.replace('عنوان المحاضرة', 'محاضرة') + (': ' + nxt if nxt else '') if not head.startswith('بعنوان') else nxt)[:160]
    if GENERIC.match(head):
        return AUTHOR_TAIL.sub('', head + (': ' + nxt if nxt else ''))[:160]
    return AUTHOR_TAIL.sub('', head)[:160] or head[:160]


AUTHOR_TAIL = re.compile(r'\s*[-–]?\s*(?:لل[إا]مام|للحافظ|للعلامة|لشيخ\s*ال[إا]سلام|لابن|رحمه\s*الله).*$')
HM = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة']


def hijri_words(hd):
    y, m, d = (hd.split('-') + ['', ''])[:3]
    return ' '.join(x for x in [d, HM[int(m) - 1] if m and 1 <= int(m) <= 12 else '', y + 'هـ'] if x).translate(str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩'))


def hijri_year(date):
    """Hijri year of a Gregorian YYYY-MM-DD (tabular calendar; only the year is used, so a day's difference from Umm al-Qura is harmless
    except in the last days of ذو الحجة)."""
    jd = datetime.fromisoformat(date[:10]).toordinal() + 1721424.5
    return int((30 * (jd - 1948439.5) + 10646) // 10631)


def friday(date):
    return datetime.fromisoformat(date[:10]).weekday() == 4


ORD_WORDS = ['الأول', 'الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي', 'الحاديعشر']
ORD_N = {'الاول': 1, 'الواحد': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10, 'الحادي': 1}
TENS = {'العشرون': 20, 'العشرين': 20, 'الثلاثون': 30, 'الثلاثين': 30, 'الاربعون': 40, 'الاربعين': 40}
PART = re.compile(r'(المجلس|الدرس|اللقاء|القاء|الحلقة|الحديث)\s*[:،,]?\s*[\[\(«{]?\s*(?:رقم\s*)?[\[\(«{]?\s*'
                  r'((?:\d{1,3})|(?:ال[أا]ول|الواحد|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي|العشرون|الثلاثون)'
                  r'(?:\s*(?:عشر|عاشر|و\s*ال?عشر(?:و|ي)ن|و\s*ال?ثلاث(?:و|ي)ن|و\s*ال?[أا]ربع(?:و|ي)ن))?)(?![\u0621-\u064A])')
CALIPHS = [('الحسن بن علي', r'الحسن بن علي'), ('أبو بكر الصديق', r'ابو ?بكر'), ('عمر بن الخطاب', r'عمر بن الخطاب'),
           ('عثمان بن عفان', r'عثمان بن عفان'), ('علي بن أبي طالب', r'علي بن ابي طالب')]
BOOK_SERIES = {'kabair', 'umdah', 'arbain', 'imara', 'bahja', 'hadith-course', 'bukhari', 'sullam', 'kashf', 'qawaid', 'fadl-islam', 'usul', 'haiyya',
               'daa-dawa', 'wabil', 'tawhid', 'hajj', 'siyam', 'sira', 'khulafa', 'usul-tafsir', 'qisar', 'saadi-hajj', 'ramadan'}


def norm_ar(s):
    return re.sub(r'\s+', ' ', clean(s).replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ة', 'ه').replace('ى', 'ي')).strip()


def part_label(t):
    """«📎المجلس [ الثاني ]», «الدرس (3)», «اللقاء السابع عشر» anywhere in a post -> ('المجلس الثاني', 2)."""
    c = clean(t).translate(AR_DIGITS)
    ms = [m for m in PART.finditer(c) if not re.search(r'رابط\s*$', c[max(0, m.start() - 8):m.start()])]   # «رابط الدرس الأول» points elsewhere
    ms.sort(key=lambda m: '[' not in m.group(0) and '(' not in m.group(0))                               # «المجلس [ الثاني ]» first
    for m in ms:
        word, num = m.group(1).replace('القاء', 'اللقاء'), re.sub(r'\s+', ' ', m.group(2)).strip()
        num = re.sub(r'^(\S+) عاشر$', r'\1 عشر', num)
        num = re.sub(r'\s*و\s+', ' و', num)                              # «الثالث و العشرون» = الثالث والعشرون                  # «المجلس [ الثاني عاشر ]» = الثاني عشر
        if word == 'الحديث' and not num.isdigit():
            continue                                        # «الحديث الأول» is a hadith, not a sitting
        if num.isdigit():
            n = int(num)
        else:
            k = norm_ar(num).split(' ')
            n = ORD_N.get(k[0], TENS.get(k[0], 0))
            if len(k) > 1 and k[1] == 'عشر': n += 10
            elif len(k) > 1: n += TENS.get(re.sub(r'^و\s*', '', ' '.join(k[1:])).replace(' ', ''), 0) or TENS.get(k[-1], 0)
        if n:
            return f"{word} {num}" if not num.isdigit() else f"{word} {str(n).translate(str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩'))}", n
    m = re.search(r'(?:^|\n)\W*رقم\s*(\d{1,3})\s*(?:\n|$)', (t or '').translate(AR_DIGITS))   # «درس السيرة النبوية / رقم 33» on a line of its own
    if m and int(m.group(1)):
        return 'الدرس ' + m.group(1).translate(str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')), int(m.group(1))
    return '', None


def length(x):
    if x.get('duration_seconds'):
        return x['duration_seconds'], True
    if x.get('media_type') == 'voice_message' and x.get('file_size'):
        return x['file_size'] / VOICE_BPS, False
    return None, False


def fits(stated, x):
    got, exact = length(x)
    if stated is None or got is None:
        return True
    tol = max(120, stated * (0.05 if exact else 0.3))
    return abs(stated - got) <= tol


SPEAKER = re.compile(r'(فضيلة|الشيخ|حسن|بن|علي|حدادي|الحدادي|حداد|حفظه الله|ورعاه)\s*')


def merge_same_title(lessons):
    key = lambda l: re.sub(r'[^\u0621-\u064A0-9٠-٩]', '', SPEAKER.sub('', l['title']))
    out, seen = [], {}
    for l in sorted(lessons, key=lambda l: l['date']):
        k = key(l)
        o = seen.get(k)
        # only across channels: within one channel every same-titled pair checked (2026-11-17) was two different
        # recordings (lesson 23 and 24, الماعون and الكوثر, حقيقة الصيام 2 and البخاري 2), never a re-post
        if len(k) >= 12 and o and o['id'].split('-')[0] != l['id'].split('-')[0] and abs((datetime.fromisoformat(l['date']) - datetime.fromisoformat(o['date'])).days) <= 2 \
                and o['duration_min'] and l['duration_min'] \
                and abs(o['duration_min'] - l['duration_min']) <= max(2, 0.3 * max(o['duration_min'], l['duration_min'])):
            a, b = (o, l) if (o['kind'] == 'audio_file', o['duration_exact']) >= (l['kind'] == 'audio_file', l['duration_exact']) else (l, o)
            a['posts'] = a['posts'] + b['posts']
            a['alt_copy'] = b['id']
            if a is l:
                out[out.index(o)] = l; seen[k] = l
            continue
        seen[k] = l; out.append(l)
    return out


def link_post(x, ch):
    """A text post whose answer/recording is a link to an audio file elsewhere: a lesson whose own post is the description."""
    t = text_of(x)
    y = {k: x[k] for k in ('id', 'date', 'date_unixtime')}
    y.update(_ch=ch, _t='', _link=next(u for u in links_of(x) if AUDIO_LINK.match(u)),
             _ann=(f"{ch}/{x['id']}", t, announcement(t), True) if desc_title(t) else None)
    return y


def main():
    posts = []
    channels = [ch for ch in CHANNELS if os.path.exists(f'{ROOT}/{ch}/result.json')]
    for ch in channels:
        msgs = json.load(open(f'{ROOT}/{ch}/result.json'))['messages']
        prev_text = None
        for x in msgs:
            if x.get('type') != 'message':
                continue
            if not is_audio(x):
                if text_of(x).strip() and not x.get('file'):
                    prev_text = x
                    if ch == QA_CHANNEL and any(AUDIO_LINK.match(u) for u in links_of(x)):
                        posts.append(link_post(x, ch))      # the answer is a link in the post itself
                continue
            x['_ch'], x['_t'] = ch, text_of(x)
            # the post just before an audio often describes it ("تم التسجيل ..."); keep it if the
            # stated length in it matches the clip
            x['_ann'] = None
            window = QA_WINDOW if ch == QA_CHANNEL and re.search(r'ؤال|ؤَالُ|مجموعة أسئلة', text_of(prev_text or {'text': ''})) else WINDOW
            if prev_text and int(x['date_unixtime']) - int(prev_text['date_unixtime']) <= window \
                    and desc_title(text_of(prev_text)):
                info = announcement(text_of(prev_text))
                x['_ann'] = (f"{ch}/{prev_text['id']}", text_of(prev_text), info, fits(info[2], x))
            posts.append(x)
            if ch == QA_CHANNEL:
                prev_text = None                              # one question per answer
        # an audio with no description before it may be described by the post right after it
    by_id = {(p['_ch'], p['id']): p for p in posts}
    for ch in channels:
        msgs = json.load(open(f'{ROOT}/{ch}/result.json'))['messages']
        last_audio = None
        for x in msgs:
            if x.get('type') != 'message':
                continue
            if is_audio(x):
                last_audio = by_id[(ch, x['id'])]
                continue
            t = text_of(x)
            if last_audio and not last_audio['_ann'] and t.strip() and not x.get('file') \
                    and int(x['date_unixtime']) - int(last_audio['date_unixtime']) <= 600 and desc_title(t):
                info = announcement(t)
                last_audio['_ann'] = (f"{ch}/{x['id']}", t, info, fits(info[2], last_audio))
            last_audio = None

    # 1) same file (size + duration) posted more than once
    groups = collections.OrderedDict()
    for x in posts:
        groups.setdefault(x.get('_link') or (x.get('file_size'), x.get('duration_seconds')), []).append(x)
    groups = list(groups.values())
    # 2) different files described by the same announcement (voice note + m4a of one lesson)
    parent = list(range(len(groups)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    # ... but not two recordings that carry their own, different captions (one announcement over a whole
    # course: «الدرس الأول (1)», «الدرس الثاني (2)», ... posted under one «تم التسجيل» post)
    cap = lambda g: next((c for c in (re.sub(r'[^\u0621-\u064A0-9٠-٩]', '', hadadi_title(x['_t'])) for x in g if x['_t'].strip()) if c), '')
    caps_of = {i: cap(g) for i, g in enumerate(groups)}
    by_ann = {}
    for i, g in enumerate(groups):
        for x in g:
            if x['_ann'] and x['_ann'][3] and x['_ann'][2][3] and len(clean(x['_ann'][1])) > 60:
                key = clean(x['_ann'][1])
                if key in by_ann:
                    a, b = find(i), find(by_ann[key])
                    if a != b and not (caps_of[a] and caps_of[b] and caps_of[a] != caps_of[b]):
                        parent[a] = b
                        caps_of[b] = caps_of[b] or caps_of[a]
                else:
                    by_ann[key] = i
    merged = collections.OrderedDict()
    for i, g in enumerate(groups):
        merged.setdefault(find(i), []).extend(g)

    lessons = []
    for g in merged.values():
        # primary copy: a real audio file with a known length beats a voice note; then the official channel
        g.sort(key=lambda x: (x.get('media_type') != 'audio_file', not x.get('duration_seconds'), bool(x.get('_link')),
                              CHANNELS.index(x['_ch']), int(x['date_unixtime'])))
        main_post = g[0]
        dur, exact = length(main_post)
        size = main_post.get('file_size')
        caps = [x['_t'] for x in g if x['_t'].strip()]     # caption_title() skips the channel's boilerplate lines
        names = [x.get('file_name') for x in g if x.get('file_name')]
        anns = [x['_ann'] for x in g if x['_ann']]
        good_ann = next((a for a in anns if a[3]), None)
        title, source, cut = '', '', False      # cut: the title is a file name the uploader shortened, so trust the post
        for c in caps:
            title = hadadi_title(c)
            if title:
                source = 'caption'; break
        if not title:
            for n in names:
                t2 = name_title(n)
                if t2 and CUT_NAME.search(n) and len(t2) <= 18 and good_ann:
                    continue          # «التعليق على الف-AudioConverter.amr»: the uploader cut the name, the post says more
                if t2:
                    title, source, cut = t2, 'file name', bool(CUT_NAME.search(n)); break
        if not title and good_ann:
            title = desc_title(good_ann[1])
            hd0 = good_ann[2][1]
            if title and hd0 and hd0.split('-')[0] not in title.translate(AR_DIGITS):
                title += ' ' + hd0.replace('-', '/')
            source = 'description post' if title else ''
        blob = clean(' '.join(caps + [n or '' for n in names] + ([good_ann[1]] if good_ann else [])))
        tb = clean(title)
        series = ('', '', '') if cut else next(((sid, t, sec) for sid, t, sec, rx in SERIES_RE   # the title names the book
                       if rx.search(tb) or rx.search(tb.replace(' ', ''))), ('', '', ''))
        if not series[0]:                                                                   # ... else the post around it
            series = next(((sid, t, sec) for sid, t, sec, rx in SERIES_RE
                           if rx.search(blob) or rx.search(blob.replace(' ', ''))), ('', '', ''))
        if not series[0] and title:
            series = ('misc', 'دروس ومحاضرات متفرقة', 'lectures')     # titled one-offs: publish, no review
        qa = bool(re.search(r'الس\W*\(?\s*\d{1,3}\s*\)?\W*ؤال|مجموعة أسئلة', clean(' '.join(caps))))
        if re.match(r'السؤال |مجموعة أسئلة ', title) or (main_post['_ch'] == QA_CHANNEL and title and (qa or series[0] in ('misc', ''))):
            series = next((sid, t, sec) for sid, t, sec, rx in SERIES_RE if sid == 'fatawa')
        fwd = sorted({x.get('forwarded_from') for x in g if x.get('forwarded_from')} - SHEIKH_CHANNELS)
        sheikh = bool(re.search(r'حسن\s*(?:بن\s*علي\s*)?(?:ال)?حداد|حسن\.?\s*Haddadi|Hassan', blob))
        weak = series[0] in ('misc', 'lectures', 'fatawa', '')
        others = [s for s in OTHER_SCHOLARS if s in blob] if (weak and not sheikh) else []
        if sheikh: fwd = []
        flags = []
        if not title: flags.append('no title')
        if fwd: flags.append('forwarded from ' + ' / '.join(fwd))
        if others: flags.append('mentions ' + ' / '.join(others))
        if not series[0]: flags.append('no series')
        if anns and not good_ann and not title: flags.append('description length mismatch')
        part, part_n = part_label('\n'.join(caps))                   # the recording's own caption first, then the post about it
        if not part and good_ann:
            part, part_n = part_label(good_ann[1])
        if title and series[1] and len(re.findall(r'[\u0621-\u064A]{3,}', title)) <= 1:
            title = series[1] + ' ' + title            # a bare date as title: prefix the series name
        hd = hijri(blob) or (good_ann[2][1] if good_ann else '')
        lessons.append({
            'id': f"{main_post['_ch']}-{main_post['id']}",
            'title': title, 'title_source': source,
            'series': series[0], 'series_title': series[1], 'section': series[2],
            'lesson_number': part_n or lesson_no(blob), 'part': part, 'hijri': hd,
            'date': main_post['date'][:10],
            'duration_min': round(dur / 60, 1) if dur else None,
            'duration_exact': exact,
            'stated_min': round(good_ann[2][2] / 60, 1) if good_ann and good_ann[2][2] else None,
            'size_mb': round(size / 1e6, 1) if size else None,
            'kind': main_post.get('media_type') or ('link' if main_post.get('_link') else 'audio_file'),
            'file_name': main_post.get('file_name') or '',
            'posts': [tme(f"{x['_ch']}/{x['id']}") for x in g],
            'description_post': tme(good_ann[0]) if good_ann else '',
            'have_file': not str(main_post.get('file', '')).startswith('('),
            'flags': flags,
            'caption': caps[0][:300] if caps else (good_ann[1][:300] if good_ann else ''),
        })
    lessons = merge_same_title(lessons)
    for l in lessons:   # his Friday khutab at جامع عبدالله بن عمار rarely say «خطبة»: a titled Friday talk that is no lesson is a khutba
        if l['series'] in ('misc', 'lectures', '') and l['title'] and friday(l['date']) and not re.search(r'درس|الدرس|المجلس|اللقاء|شرح|محاضرة|ندوة|كلمة', clean(l['caption'])) \
                and re.search(r'جامع\s*عبد\s*الله\s*بن\s*عمار|ابو\s*عمار|أبو\s*عمار|خطب', clean(l['caption'] + ' ' + l['file_name'])):
            l['series'], l['series_title'], l['section'] = 'khutab', 'خطب الجمعة والعيدين', 'khutab'
    for l in lessons:   # سيرة الخلفاء الراشدين: each caliph's lessons restart at «الدرس الأول», so name the caliph from the post
        if l['series'] == 'khulafa':
            c = norm_ar(l['caption'])
            who = next((n for n, rx in CALIPHS if re.search(rx, c)), '')
            part, _ = part_label(l['caption'])
            if who:
                l['title'] = 'سيرة الخلفاء الراشدين — ' + who + ('، ' + part if part else '')
                l['part'] = None
    for l in lessons:   # short-surah tafsir: the post names the surahs on a line of their own («سورة الماعون», «تفسير سورتي الفلق و الناس»)
        if l['series'] == 'qisar' and l['title'] and not re.search(r'سورة\s', l['title']):
            names = []
            for m in re.finditer(r'سور(?:ة|تي)\s*([\u0621-\u064A]+)(?:\s*و\s*([\u0621-\u064A]+))?', clean(l['caption'])):
                names += [n for n in m.groups() if n and n not in names]
            if names:
                l['title'] = 'تفسير ' + ('سورة ' + names[0] if len(names) == 1 else 'سور ' + '، '.join(names[:-1]) + ' و' + names[-1])
                l['part'] = None
    for l in lessons:   # «📎المجلس [ الثاني ]» in the post (owner 2026-11-17): a bare book line becomes «<series> — المجلس الثاني»
        part = l.get('part')
        if l['title'] and part and l['series'] in BOOK_SERIES and norm_ar(part) not in norm_ar(l['title']) and not PART.search(clean(l['title']).translate(AR_DIGITS)):
            bare = re.sub(r'^(?:شرح|التعليق\s*على|درس)\s*(?:كتاب|متن)?\s*', '', l['title']).strip()
            l['title'] = (l['series_title'] if len(bare) < 40 and any(w in norm_ar(l['series_title']) for w in norm_ar(bare).split()[:2])
                          else l['title']) + ' — ' + part
        elif l['title'] and part and l['series'] in BOOK_SERIES and re.fullmatch(r'(?:شرح\s*)?' + PART.pattern + r'\s*(?:\d{1,3})?\s*(?:و?ال[أا]خير)?\s*(?:\d{1,3})?\s*(?:و?ال[أا]خير)?', clean(l['title']).translate(AR_DIGITS)):
            l['title'] = l['series_title'] + ' — ' + part      # «شرح الحديث 30» alone -> «التعليق على بهجة قلوب الأبرار — الحديث ٣٠»
    groups = collections.defaultdict(list)
    for l in lessons:
        groups[(l['series'], l['title'])].append(l)
    for (sid, t), ls in groups.items():   # still the same title: the Hijri date if they differ, else «الجزء ١ / ٢» (two recordings of one sitting)
        if not t or len(ls) < 2:
            continue
        dates = [l['hijri'] for l in ls]
        years = [hijri_year(l['date']) for l in ls]
        ar = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')
        if all(dates) and len(set(dates)) == len(dates):
            for l in ls:
                if l['hijri'].split('-')[0] not in t.translate(AR_DIGITS):
                    l['title'] += ' — ' + hijri_words(l['hijri'])
            continue
        by_year = collections.defaultdict(list)
        for l in sorted(ls, key=lambda l: (l['date'], l['id'])):
            by_year[hijri_year(l['date'])].append(l)
        for y, yl in by_year.items():   # the same book taught again another year: the year; two recordings of one sitting: الجزء ١ / ٢
            for i, l in enumerate(yl):
                l['title'] += (f' — {str(y).translate(ar)}هـ' if len(by_year) > 1 else '') + (' — الجزء ' + str(i + 1).translate(ar) if len(yl) > 1 else '')
    lessons.sort(key=lambda l: l['date'])
    json.dump(lessons, open(f'{ROOT}/lessons.json', 'w'), ensure_ascii=False, indent=1)
    return posts, lessons


if __name__ == '__main__':
    posts, lessons = main()
    c = collections.Counter(l['series'] or '(none)' for l in lessons)
    print('posts', len(posts), 'unique lessons', len(lessons))
    print('hours', round(sum(l['duration_min'] or 0 for l in lessons) / 60), 'GB', round(sum(l['size_mb'] or 0 for l in lessons) / 1e3, 1))
    print(c.most_common())
    print('title sources', collections.Counter(l['title_source'] or '(none)' for l in lessons))
    print('flags', collections.Counter(f.split(' ')[0] + ' ' + f.split(' ')[1] if ' ' in f else f for l in lessons for f in l['flags']))
    print('with hijri', sum(1 for l in lessons if l['hijri']), 'with number', sum(1 for l in lessons if l['lesson_number']))
