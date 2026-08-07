#!/usr/bin/env python3
"""Render the SwingPulse icon set (variant B: green ground, dark mark).

Rendered with PIL at 4x supersampling rather than an SVG rasterizer so the
build needs no libcairo/librsvg. The vector source of truth stays icon.svg;
this script must be kept in step with it.

Two invariants the old icons broke:
  * output is RGB, never RGBA — a transparent corner gets composited onto
    BLACK by iOS, which is what made the icon read as a black tile.
  * no baked corner radius — the art is full-bleed and the platform applies
    its own mask (iOS squircle, Android maskable crop).
"""
import math
from PIL import Image, ImageDraw

SS = 4                      # supersample factor
BASE = 512                  # design canvas
C = BASE / 2
MARK_SCALE = 0.88           # keeps every mark pixel inside the maskable
                            # safe circle (radius 40% = 204.8px); at 1.0 the
                            # pulse dot reaches 229.8 and would be cropped.

BG_TOP, BG_BOT = (0x4B, 0xE3, 0xA0), (0x1F, 0xA9, 0x7A)
MARK = (0x0E, 0x17, 0x14)

# Cubic bezier segments, matching icon.svg.
RIBBON = [((96, 334), (158, 392), (248, 396), (304, 300)),
          ((304, 300), (346, 228), (388, 202), (426, 186))]
RIBBON_MID = [((104, 300), (160, 344), (236, 348), (288, 268)),
              ((288, 268), (326, 210), (366, 190), (402, 178))]
RIBBON_TOP = [((112, 268), (162, 300), (226, 302), (272, 240))]
DOT_C, DOT_R = (426, 186), 46


def T(p, s):
    """Design coords (0..512) -> pixels on an s-wide canvas, scaled about the
    centre by MARK_SCALE.

    `s` is required: an earlier version hardcoded the factor as SS, which is
    only correct when the output happens to be 512. Every smaller icon then
    had its mark drawn outside the canvas and shipped as a blank tile.
    """
    k = s / BASE
    x, y = p
    return ((C + MARK_SCALE * (x - C)) * k, (C + MARK_SCALE * (y - C)) * k)


def bezier(p0, p1, p2, p3, n=220):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
                    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]))
    return pts


def background(size):
    """Linear gradient along SVG's x1=0,y1=0 -> x2=0.3,y2=1 direction."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    dx, dy = 0.3, 1.0
    denom = dx * dx + dy * dy
    for y in range(size):
        for x in range(size):
            t = ((x / size) * dx + (y / size) * dy) / denom
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT))
    return img


def stroke_layer(s, segs, width, alpha):
    """One ribbon on its own RGBA layer.

    Built by stamping a filled circle at every sampled point rather than with
    ImageDraw.line(joint='curve'): that lays consecutive segments down as
    separate rectangles which do not quite meet, leaving a comb of gaps along
    the edge that survives the downsample. Stamping cannot gap. ImageDraw
    overwrites rather than blends, so overlapping stamps stay a flat alpha.

    Each ribbon gets its own layer so they composite in SVG paint order —
    stamping them all onto one layer would let the last one drawn replace the
    overlap instead of blending over it.
    """
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    col = MARK + (round(255 * alpha),)
    r = max(0.5, width * MARK_SCALE * (s / BASE) / 2)
    pts = []
    for seg in segs:
        sp = bezier(*[T(p, s) for p in seg])
        pts.extend(sp if not pts else sp[1:])
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return layer


def render(size):
    s = size * SS
    img = background(s).convert('RGBA')
    for segs, width, alpha in [(RIBBON_TOP, 16, 0.20),
                               (RIBBON_MID, 22, 0.32),
                               (RIBBON, 42, 1.0)]:
        img = Image.alpha_composite(img, stroke_layer(s, segs, width, alpha))
    dot = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    cx, cy = T(DOT_C, s)
    r = DOT_R * MARK_SCALE * (s / BASE)
    ImageDraw.Draw(dot).ellipse([cx - r, cy - r, cx + r, cy + r], fill=MARK + (255,))
    img = Image.alpha_composite(img, dot)
    # LANCZOS downsample does the anti-aliasing; convert('RGB') guarantees
    # no alpha channel survives into the file.
    return img.resize((size, size), Image.LANCZOS).convert('RGB')


def check(img, name):
    """Assert the invariants that were actually violated in the wild.

    The blank-tile case is the reason this exists: a coordinate-scaling bug
    drew the mark outside every canvas smaller than 512, and the icons still
    looked plausible as files — right size, right colour, no alpha. Only the
    share-of-dark-pixels test catches it.
    """
    w, h = img.size
    errs = []

    if img.mode != 'RGB':
        errs.append(f'mode is {img.mode}, must be RGB — alpha gets composited onto black by iOS')

    px = list(img.convert('RGB').getdata())
    dark = sum(1 for r, g, b in px if r < 60 and g < 80 and b < 70)
    share = dark / len(px)
    # Measured 6.8-7.1% across all four sizes. The band is wide enough to
    # survive ordinary tweaks to stroke weight and tight enough that a blank
    # tile (0%) or a runaway fill can't pass.
    if not 0.03 <= share <= 0.40:
        errs.append(f'mark covers {share:.1%} of the tile (expected 3-40%) — blank or broken')

    rgba = img.convert('RGBA')
    if any(rgba.getpixel(p)[3] != 255 for p in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]):
        errs.append('a corner is not opaque')

    if errs:
        raise SystemExit(f'FAIL {name}: ' + '; '.join(errs))
    print(f'  ok {name:22s} {w}x{h}  mark={share:.1%}  mode={img.mode}')


if __name__ == '__main__':
    import sys
    out = sys.argv[1].rstrip('/')
    for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192),
                       ('icon-512.png', 512), ('favicon-32.png', 32)]:
        img = render(size)
        check(img, name)
        img.save(f'{out}/{name}', 'PNG', optimize=True)
    print('all icons written and verified')
