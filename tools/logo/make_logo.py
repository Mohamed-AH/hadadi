"""Draws the Sheikh's logo (arch over an open book) as clean SVG: marks, lockups, colour variants.
Geometry follows the team's original artwork (IMG_8508, 640px); x is relative to the centre line, y to the outer apex.
Text is converted to outlines from the site's own fonts (uharfbuzz + fontTools), so the files need no font.
Run: python3 tools/logo/make_logo.py <out_dir>   (needs: pip install fonttools brotli uharfbuzz)"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
F = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")

def arch(w, ys, ya, r, yb, tip=0.0):
    """Shouldered pointed arch: vertical sides at ±w from yb up to ys, a round shoulder of radius r,
    then straight to the apex (0, ya). tip>0 bends the last part into a small ogee point."""
    cx, cy = -w + r, ys
    px, py = 0.0, ya
    d = math.hypot(px - cx, py - cy)
    phi = math.atan2(py - cy, px - cx)
    a = math.acos(r / d)
    cands = [(cx + r * math.cos(phi + s * a), cy + r * math.sin(phi + s * a)) for s in (1, -1)]
    tx, ty = min(cands, key=lambda p: p[0] + p[1])
    if tip:
        # ogee tip: the straight run ends a little before the apex and the apex is reached with a concave curve
        k = 1 - tip
        mx, my = tx + (px - tx) * k, ty + (py - ty) * k
        c1x, c1y = mx + (px - mx) * 0.5, my + (py - my) * 0.5      # keeps the straight run's direction
        c2x, c2y = px - (px - mx) * 0.3, py + (my - py) * 0.35   # arrives steeper than the run: a small flame point
        top_l = f"L{F(mx)} {F(my)}C{F(c1x)} {F(c1y)} {F(c2x)} {F(c2y)} {F(px)} {F(py)}"
        top_r = f"C{F(-c2x)} {F(c2y)} {F(-c1x)} {F(c1y)} {F(-mx)} {F(my)}L{F(-tx)} {F(ty)}"
    else:
        top_l, top_r = f"L{F(px)} {F(py)}", f"L{F(-tx)} {F(ty)}"
    left = f"M{F(-w)} {F(yb)}V{F(ys)}A{F(r)} {F(r)} 0 0 1 {F(tx)} {F(ty)}{top_l}"
    right = f"{top_r}A{F(r)} {F(r)} 0 0 1 {F(w)} {F(ys)}V{F(yb)}"
    return left + right

def offset_arch(base, g):
    """The same arch moved inward by g everywhere (a true parallel curve)."""
    w, ys, ya, r = base
    # the straight run's direction from the shoulder to the apex keeps its angle; the apex drops by g / sin(angle)
    cx, cy = -w + r, ys
    d = math.hypot(-cx, ya - cy); phi = math.atan2(ya - cy, -cx); a = math.acos(r / d)
    cands = [(cx + r * math.cos(phi + s * a), cy + r * math.sin(phi + s * a)) for s in (1, -1)]
    tx, ty = min(cands, key=lambda p: p[0] + p[1])
    ang = math.atan2(ty - ya, -tx)  # angle of the straight run to the horizontal
    return (w - g, ys, ya + g / math.cos(ang), r - g)

def mark_paths(v):
    """v: 'A' faithful, 'B' even spacing. Returns a list of path strings, units = original pixels, apex at y=0."""
    P = []
    if v == "A":
        outer = (93, 97, 0, 62); mid = (62, 133, 49, 40); inn = (44.5, 150, 83, 30)
        tip = 0.3
    else:
        outer = (93, 100, 0, 64); mid = offset_arch(outer, 28 if v == "B" else 36); inn = offset_arch(outer, 46)
        tip = 0.0
    if v == "C":
        return mark_c(outer, mid)
    W, top_o, top_c = 111, 220, 232            # book: outer page corner half-width, its top at the corner and at the spine side
    xm = mid[0]
    # top edge of the outer page runs from the corner (W, top_o) to the middle arch's foot (xm, top_c)
    y_at = lambda x: top_o + (W - x) / (W - xm) * (top_c - top_o)
    # outer arch: sides end on the page edge
    P.append(arch(outer[0], outer[1], outer[2], outer[3], y_at(outer[0])))
    # outer page outline + middle arch as one line: corner → foot → up the middle arch → foot → corner → down → spine → up
    bot_o, spine = 297, 314
    m = arch(mid[0], mid[1], mid[2], mid[3], top_c)
    P.append(f"M{F(-W)} {F(top_o)}L{m[1:]}L{F(W)} {F(top_o)}V{bot_o}"
             f"Q{F(W*0.42)} {F(bot_o+2)} 0 {spine}Q{F(-W*0.42)} {F(bot_o+2)} {F(-W)} {bot_o}Z")
    # inner arch closes in a V that echoes the pages
    iw, foot, vy = inn[0], 228, 258
    a_in = arch(inn[0], inn[1], inn[2], inn[3], foot, tip if v == 'A' else 0)
    if v != "C":
        P.append(a_in + f"Q{F(iw*0.45)} {F(foot+10)} 0 {vy}Q{F(-iw*0.45)} {F(foot+10)} {F(-iw)} {foot}Z")
    # inner page
    ip, it, ib, ic_, ib_c = 96, 242, 281, 287, 305
    P.append(f"M{-ip} {it}Q{F(-ip*0.45)} {it-2} 0 {ic_}Q{F(ip*0.45)} {it-2} {ip} {it}V{ib}"
             f"Q{F(ip*0.45)} {ib+3} 0 {ib_c}Q{F(-ip*0.45)} {ib+3} {-ip} {ib}Z")
    return P

def mark_c(outer, mid):
    """Compact mark for small sizes: the outer arch, one inner arch closing in a V, and the open book as a single outline."""
    W, top_o, bot_o, spine, dip = 111, 220, 297, 314, 262
    # top edge of the book: from the corner, down to the spine (dip); the outer arch's sides end on it
    def y_at(x):  # quadratic Q(-W,top_o) c(-W*0.42, top_o+4) (0,dip), solved for x by bisection
        lo, hi = 0.0, 1.0
        for _ in range(40):
            t = (lo + hi) / 2
            xx = (1-t)**2 * (-W) + 2*(1-t)*t*(-W*0.42)
            lo, hi = (t, hi) if xx < -x else (lo, t)
        t = (lo + hi) / 2
        return (1-t)**2 * top_o + 2*(1-t)*t*(top_o + 4) + t*t*dip
    P = [arch(outer[0], outer[1], outer[2], outer[3], y_at(outer[0]))]
    iw, foot, vy = mid[0], 226, 252
    P.append(arch(mid[0], mid[1], mid[2], mid[3], foot) + f"Q{F(iw*0.45)} {F(foot+10)} 0 {vy}Q{F(-iw*0.45)} {F(foot+10)} {F(-iw)} {foot}Z")
    P.append(f"M{-W} {top_o}Q{F(-W*0.42)} {top_o+4} 0 {dip}Q{F(W*0.42)} {top_o+4} {W} {top_o}V{bot_o}"
             f"Q{F(W*0.42)} {bot_o+2} 0 {spine}Q{F(-W*0.42)} {bot_o+2} {-W} {bot_o}Z")
    return P

DIAMOND = lambda y, s: f"M0 {F(y-s)}L{F(s)} {F(y)}L0 {F(y+s)}L{F(-s)} {F(y)}Z"

def svg_mark(v, color, sw, diamond=True, pad=8, bg=None, extra=""):
    paths = mark_paths(v)
    top, bot = -sw - 2, 314 + sw + (24 if diamond else 2)
    x0, w, h = -111 - sw - pad, 222 + 2 * (sw + pad), bot - top + 2 * pad
    y0 = top - pad
    g = "".join(f'<path d="{p}"/>' for p in paths)
    dm = f'<path d="{DIAMOND(326, 6)}" fill="{color}"/>' if diamond else ""
    b = f'<rect x="{F(x0)}" y="{F(y0)}" width="{F(w)}" height="{F(h)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{F(x0)} {F(y0)} {F(w)} {F(h)}">{b}'
            f'<g fill="none" stroke="{color}" stroke-width="{sw}" stroke-linejoin="miter" stroke-miterlimit="8">{g}</g>{dm}{extra}</svg>')

# ---- text to outlines
_fonts = {}
def font(name):
    if name not in _fonts:
        path = os.path.join(ROOT, "site/fonts", name)
        tt = TTFont(path)
        data = open(path, "rb").read()
        if path.endswith(".woff2"):
            import io; buf = io.BytesIO(); tt.flavor = None; tt.save(buf); data = buf.getvalue(); tt = TTFont(io.BytesIO(data))
        face = hb.Face(data); f = hb.Font(face)
        _fonts[name] = (tt, f, tt["head"].unitsPerEm)
    return _fonts[name]

def text_path(txt, fname, size, cx, baseline, tracking=0):
    """Shapes Arabic text with HarfBuzz and returns (svg path d, width). Centred on cx. tracking adds kashida-free spacing
    only between unjoined words (letter-spacing is never used on Arabic)."""
    tt, f, upm = font(fname)
    buf = hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties()
    hb.shape(f, buf, {})
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    s = size / upm
    total = sum(p.x_advance for p in buf.glyph_positions) * s
    x = cx + total / 2  # RTL: HarfBuzz returns visual order left→right, so start at the left edge
    x = cx - total / 2
    pen = SVGPathPen(gs, ntos=lambda v: F(v))
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        tp = TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, baseline - pos.y_offset * s))
        gs[name].draw(tp)
        x += pos.x_advance * s
    return pen.getCommands(), total

def ink_box(d):
    import re
    nums = list(map(float, re.findall(r"-?\d+(?:\.\d+)?", d)))
    xs, ys = nums[0::2], nums[1::2]
    return min(xs), max(xs), min(ys), max(ys)

NAME = "الشيخ حسن بن علي حدادي"
FONTS = {"messiri": "el-messiri-arabic-700-normal.woff2", "ruqaa": "aref-ruqaa-arabic-700-subset.woff2",
         "kufi": "reem-kufi-arabic-700-normal.woff2", "messiri5": "el-messiri-arabic-500-normal.woff2"}

def svg_lockup(v, color, sw, top="قناة", namefont="messiri", sub=None, bg=None, ink=None, layout="stack"):
    """Full lockup: mark, a small top line between rules, the name, a closing rule with a diamond (as the original)."""
    ink = ink or color
    paths = mark_paths(v)
    g = "".join(f'<path d="{p}"/>' for p in paths)
    parts = []
    y = 352
    rule = lambda yy, half, gap=0: (f'<path d="M{-half} {yy}H{-gap}M{gap} {yy}H{half}" stroke="{color}" stroke-width="{F(sw*0.55)}"/>' if gap
                                    else f'<path d="M{-half} {yy}H{half}" stroke="{color}" stroke-width="{F(sw*0.55)}"/>')
    parts.append(f'<path d="{DIAMOND(326, 6)}" fill="{color}"/>')
    if top:
        d, tw = text_path(top, FONTS["messiri5"], 21, 0, y + 20)
        parts.append(f'<path d="{d}" fill="{ink}"/>')
        parts.append(rule(y + 12, 132, tw / 2 + 14))
        y += 28
    nsize = 31 if namefont != "ruqaa" else 34
    d, nw = text_path(NAME, FONTS[namefont], nsize, 0, y + 32)
    parts.append(f'<path d="{d}" fill="{ink}"/>')
    y += 46 if namefont != "ruqaa" else 52
    if sub:
        d2, _ = text_path(sub, FONTS["messiri5"], 22, 0, y + 20)
        parts.append(f'<path d="{d2}" fill="{color}"/>'); y += 30
    half = max(132, nw / 2)
    parts.append(rule(y, half))
    parts.append(f'<path d="{DIAMOND(y + 12, 5)}" fill="{color}"/>')
    y += 20
    x0 = -max(half, 111 + sw) - 24; w = -2 * x0; y0 = -sw - 22; h = y - y0 + 22
    b = f'<rect x="{F(x0)}" y="{F(y0)}" width="{F(w)}" height="{F(h)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{F(x0)} {F(y0)} {F(w)} {F(h)}">{b}'
            f'<g fill="none" stroke="{color}" stroke-width="{sw}" stroke-miterlimit="8">{g}</g>{"".join(parts)}</svg>')

def svg_tile(v, fg, bg, sw, size=512, radius=0.18):
    """Icon tile: the mark (no diamond) centred on a square with rounded corners — favicon / app icon."""
    paths = mark_paths(v)
    g = "".join(f'<path d="{p}"/>' for p in paths)
    S = 380  # square side in mark units; mark is 222+ wide × 318 tall
    x0, y0 = -S / 2, 157 - S / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{F(x0)} {F(y0)} {S} {S}">'
            f'<rect x="{F(x0)}" y="{F(y0)}" width="{S}" height="{S}" rx="{F(S*radius)}" fill="{bg}"/>'
            f'<g fill="none" stroke="{fg}" stroke-width="{sw}" stroke-miterlimit="8">{g}</g></svg>')

GOLD, BRASS, TEAK, STONE = "#a8823a", "#e0b48a", "#3a2a1e", "#f3ece1"
CHOSEN, SMALL = "B", "C"           # the team's choice: B for the logo, C (compact) for icons under ~40 px
SW = {"A": 4, "B": 5.5, "C": 7}

def site_mark():
    """The header/footer mark for core.js: option B in currentColor, stroke weighted for 38–48 px."""
    s = svg_mark(CHOSEN, "currentColor", 11, diamond=False, pad=0)
    return s.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg').replace("<svg ", '<svg aria-hidden="true" focusable="false" ', 1)

def brand_files(out):
    """The files the team uses elsewhere (social media, print): SVG, transparent, light and dark versions."""
    os.makedirs(out, exist_ok=True)
    sw = SW[CHOSEN]
    files = {
        "logo-gold.svg": svg_lockup(CHOSEN, GOLD, sw, ink=TEAK),
        "logo-gold-site.svg": svg_lockup(CHOSEN, GOLD, sw, top="الموقع الرسمي لفضيلة", ink=TEAK),
        "logo-dark-bg.svg": svg_lockup(CHOSEN, BRASS, sw, ink=STONE),
        "logo-all-gold.svg": svg_lockup(CHOSEN, GOLD, sw),
        "mark-gold.svg": svg_mark(CHOSEN, GOLD, sw),
        "mark-brass.svg": svg_mark(CHOSEN, BRASS, sw),
        "mark-teak.svg": svg_mark(CHOSEN, TEAK, sw),
        "icon.svg": svg_tile(SMALL, BRASS, TEAK, SW[SMALL] * 2.0),
        "icon-square.svg": svg_tile(SMALL, BRASS, TEAK, SW[SMALL] * 2.0, radius=0),   # for platforms that round the corners themselves
    }
    for n, svg in files.items():
        open(os.path.join(out, n), "w").write(svg)
    return files

if __name__ == "__main__":
    # python3 tools/logo/make_logo.py            → brand/ files, site/favicon.svg, and prints the LOGO constant for core.js
    # python3 tools/logo/make_logo.py --options D → every option (A, B, C) into D, for comparing
    if len(sys.argv) > 2 and sys.argv[1] == "--options":
        out = sys.argv[2]; os.makedirs(out, exist_ok=True)
        for v, sw in SW.items():
            for n, svg in ((f"mark-{v}-gold.svg", svg_mark(v, GOLD, sw)), (f"mark-{v}-brass.svg", svg_mark(v, BRASS, sw)),
                           (f"lockup-{v}-gold.svg", svg_lockup(v, GOLD, sw, ink=TEAK)), (f"lockup-{v}-brass.svg", svg_lockup(v, BRASS, sw, ink=STONE)),
                           (f"lockup-{v}-ruqaa.svg", svg_lockup(v, GOLD, sw, namefont="ruqaa", ink=TEAK)),
                           (f"tile-{v}.svg", svg_tile(v, BRASS, TEAK, sw * (2.0 if v == "C" else 1.6)))):
                open(os.path.join(out, n), "w").write(svg)
        sys.exit()
    brand_files(os.path.join(ROOT, "brand"))
    open(os.path.join(ROOT, "site/favicon.svg"), "w").write(svg_tile(SMALL, BRASS, TEAK, SW[SMALL] * 2.0) + "\n")
    print(site_mark())
