#!/usr/bin/env python3
"""Regenerate the extension's PNG icons — no third-party dependencies.

Renders a "document with a change/check badge" motif on a blue rounded
square, using supersampling for smooth edges, then writes 16/32/48/128 PNGs
into ../icons.

Usage:
    python3 tools/gen_icons.py
"""
import struct
import zlib
import math
import os

SS = 4  # supersample factor
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")

# Palette (RGB)
BLUE_TOP = (61, 123, 245)
BLUE_BOT = (47, 111, 237)
WHITE = (255, 255, 255)
LINE = (200, 214, 240)
GREEN = (32, 178, 92)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect_coverage(x, y, x0, y0, x1, y1, r):
    """Return 1.0 inside a rounded rect, else 0.0 (hard edge; AA via SS)."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return 0.0
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    if dx * dx + dy * dy <= r * r:
        return 1.0
    if (x0 + r <= x <= x1 - r) or (y0 + r <= y <= y1 - r):
        return 1.0
    return 0.0


def render(size):
    S = size * SS
    buf = [[(0, 0, 0, 0) for _ in range(S)] for _ in range(S)]

    margin = S * 0.06
    radius = S * 0.22

    doc_x0 = S * 0.28
    doc_y0 = S * 0.20
    doc_x1 = S * 0.72
    doc_y1 = S * 0.80
    doc_r = S * 0.05

    for py in range(S):
        for px in range(S):
            x = px + 0.5
            y = py + 0.5
            if rounded_rect_coverage(x, y, margin, margin, S - margin, S - margin, radius):
                t = (y - margin) / (S - 2 * margin)
                r, g, b = lerp(BLUE_TOP, BLUE_BOT, max(0.0, min(1.0, t)))
                buf[py][px] = (r, g, b, 255)
            if rounded_rect_coverage(x, y, doc_x0, doc_y0, doc_x1, doc_y1, doc_r):
                buf[py][px] = (WHITE[0], WHITE[1], WHITE[2], 255)

    line_x0 = doc_x0 + S * 0.05
    line_x1 = doc_x1 - S * 0.05
    line_h = S * 0.035
    for i, frac in enumerate([0.32, 0.45, 0.58, 0.71]):
        ly = doc_y0 + (doc_y1 - doc_y0) * frac
        lx1 = line_x1 if i != 3 else line_x0 + (line_x1 - line_x0) * 0.55
        for py in range(int(ly - line_h / 2), int(ly + line_h / 2)):
            for px in range(int(line_x0), int(lx1)):
                if 0 <= px < S and 0 <= py < S and buf[py][px][3] == 255 and buf[py][px][0] > 200:
                    buf[py][px] = (LINE[0], LINE[1], LINE[2], 255)

    bcx = S * 0.70
    bcy = S * 0.72
    br = S * 0.16
    for py in range(S):
        for px in range(S):
            x = px + 0.5
            y = py + 0.5
            if math.hypot(x - bcx, y - bcy) <= br:
                buf[py][px] = (GREEN[0], GREEN[1], GREEN[2], 255)

    def on_check(x, y):
        pts = [
            ((bcx - br * 0.45, bcy + br * 0.02), (bcx - br * 0.10, bcy + br * 0.38)),
            ((bcx - br * 0.10, bcy + br * 0.38), (bcx + br * 0.50, bcy - br * 0.35)),
        ]
        thick = br * 0.18
        for (ax, ay), (bx, by) in pts:
            vx, vy = bx - ax, by - ay
            L2 = vx * vx + vy * vy
            if L2 == 0:
                continue
            t = max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / L2))
            projx, projy = ax + t * vx, ay + t * vy
            if math.hypot(x - projx, y - projy) <= thick:
                return True
        return False

    for py in range(S):
        for px in range(S):
            if on_check(px + 0.5, py + 0.5):
                buf[py][px] = (255, 255, 255, 255)

    out = bytearray()
    for oy in range(size):
        row = bytearray()
        row.append(0)  # PNG filter type 0
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = buf[oy * SS + dy][ox * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            n = SS * SS
            if a > 0:
                row += bytes((r // a, g // a, b // a, a // n))
            else:
                row += bytes((0, 0, 0, 0))
        out += row
    return bytes(out)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def main():
    out_dir = os.path.abspath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        raw = render(size)
        write_png(os.path.join(out_dir, f"icon{size}.png"), size, raw)
        print("wrote", os.path.join("icons", f"icon{size}.png"))


if __name__ == "__main__":
    main()
