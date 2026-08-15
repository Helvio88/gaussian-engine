#!/usr/bin/env python3
"""Pack a COLMAP points3D.txt sparse cloud into a .splat so we can view SfM immediately."""

from __future__ import annotations

import math
import struct
import sys
from pathlib import Path

SPLAT_STRIDE = 32


def load_points(path: Path):
    pts, cols = [], []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line[0] == "#":
            continue
        p = line.split()
        pts.append((float(p[1]), float(p[2]), float(p[3])))
        cols.append((int(p[4]), int(p[5]), int(p[6])))
    return pts, cols


def nearest_scales(pts):
    n = max(1, len(pts))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    zs = [p[2] for p in pts]
    extent = math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2)
    s = max(0.008, min(0.08, extent / (n ** (1 / 3)) * 0.35))
    return [s] * n


def write_splat(pts, cols, scales, dest: Path) -> int:
    n = len(pts)
    out = bytearray(n * SPLAT_STRIDE)
    ident = [128, 128, 128, 255]  # identity quat packed
    for i, ((x, y, z), (r, g, b), s) in enumerate(zip(pts, cols, scales)):
        struct.pack_into("<ffffff", out, i * SPLAT_STRIDE, x, y, z, s, s, s)
        out[i * SPLAT_STRIDE + 24 : i * SPLAT_STRIDE + 32] = bytes([r, g, b, 220] + ident)
    dest.write_bytes(out)
    return n


def main() -> int:
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    pts, cols = load_points(src)
    if len(pts) < 32:
        print("too few points", file=sys.stderr)
        return 1
    n = write_splat(pts, cols, nearest_scales(pts), dst)
    print(f"wrote {n} gaussians → {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
