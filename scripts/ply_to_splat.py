#!/usr/bin/env python3
"""Convert an INRIA / gsplat 3DGS .ply into antimatter15 32-byte .splat."""

from __future__ import annotations

import argparse
import math
import struct
import sys
from pathlib import Path

SH_C0 = 0.28209479177387814
SPLAT_STRIDE = 32


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def parse_ply(path: Path) -> dict[str, list]:
    with path.open("rb") as fh:
        header: list[str] = []
        while True:
            line = fh.readline()
            if not line:
                raise ValueError("truncated PLY header")
            text = line.decode("ascii", "replace").strip()
            header.append(text)
            if text == "end_header":
                break
        if not header or header[0] != "ply":
            raise ValueError("not a PLY file")

        fmt = "ascii"
        count = 0
        props: list[tuple[str, str]] = []
        in_vertex = False
        for line in header[1:]:
            if line.startswith("format "):
                fmt = line.split()[1]
            elif line.startswith("element vertex "):
                count = int(line.split()[-1])
                in_vertex = True
            elif line.startswith("element "):
                in_vertex = False
            elif in_vertex and line.startswith("property "):
                parts = line.split()
                props.append((parts[1], parts[-1]))

        names = [n for _, n in props]
        if fmt == "ascii":
            rows = []
            for _ in range(count):
                parts = fh.readline().decode("ascii", "replace").split()
                rows.append([float(p) for p in parts[: len(names)]])
            cols = {n: [row[i] for row in rows] for i, n in enumerate(names)}
            return cols

        if fmt not in ("binary_little_endian", "binary_big_endian"):
            raise ValueError(f"unsupported ply format {fmt}")
        endian = "<" if "little" in fmt else ">"
        type_map = {
            "float": "f",
            "float32": "f",
            "double": "d",
            "float64": "d",
            "uchar": "B",
            "uint8": "B",
            "char": "b",
            "int": "i",
            "int32": "i",
            "uint": "I",
            "uint32": "I",
            "short": "h",
            "ushort": "H",
        }
        spec = endian + "".join(type_map[t] for t, _ in props)
        rec = struct.calcsize(spec)
        blob = fh.read(count * rec)
        if len(blob) < count * rec:
            raise ValueError("truncated PLY body")
        cols = {n: [] for n in names}
        unpack = struct.Struct(spec).unpack_from
        for i in range(count):
            vals = unpack(blob, i * rec)
            for n, v in zip(names, vals):
                cols[n].append(float(v))
        return cols


def cols_to_splat(cols: dict[str, list]) -> bytes:
    n = len(cols.get("x") or cols.get("X") or [])
    if n == 0:
        raise ValueError("no vertices")
    get = lambda *keys, default=0.0: next((cols[k] for k in keys if k in cols), None)

    xs, ys, zs = cols["x"], cols["y"], cols["z"]
    s0 = get("scale_0", "scale0") or [math.log(0.01)] * n
    s1 = get("scale_1", "scale1") or [math.log(0.01)] * n
    s2 = get("scale_2", "scale2") or [math.log(0.01)] * n
    r0 = get("rot_0", "rot0") or [1.0] * n
    r1 = get("rot_1", "rot1") or [0.0] * n
    r2 = get("rot_2", "rot2") or [0.0] * n
    r3 = get("rot_3", "rot3") or [0.0] * n
    op = get("opacity", "alpha") or [0.0] * n
    if "f_dc_0" in cols:
        cr = [0.5 + SH_C0 * v for v in cols["f_dc_0"]]
        cg = [0.5 + SH_C0 * v for v in cols["f_dc_1"]]
        cb = [0.5 + SH_C0 * v for v in cols["f_dc_2"]]
    else:
        cr = get("red", "r") or [0.7] * n
        cg = get("green", "g") or [0.7] * n
        cb = get("blue", "b") or [0.7] * n
        if cr and cr[0] > 1.5:
            cr = [v / 255.0 for v in cr]
            cg = [v / 255.0 for v in cg]
            cb = [v / 255.0 for v in cb]

    out = bytearray(n * SPLAT_STRIDE)
    for i in range(n):
        fo = i * 8
        struct.pack_into("<ffffff", out, i * SPLAT_STRIDE, xs[i], ys[i], zs[i], math.exp(s0[i]), math.exp(s1[i]), math.exp(s2[i]))
        a = max(0.0, min(1.0, _sigmoid(op[i])))
        rgb = [
            max(0, min(255, int(cr[i] * 255))),
            max(0, min(255, int(cg[i] * 255))),
            max(0, min(255, int(cb[i] * 255))),
            max(0, min(255, int(a * 255))),
        ]
        q = [r0[i], r1[i], r2[i], r3[i]]
        qn = math.sqrt(sum(v * v for v in q)) or 1.0
        q = [v / qn for v in q]
        qb = [max(0, min(255, int((v * 0.5 + 0.5) * 255))) for v in q]
        out[i * SPLAT_STRIDE + 24 : i * SPLAT_STRIDE + 32] = bytes(rgb + qb)
        _ = fo
    return bytes(out)


def convert(src: Path, dst: Path) -> int:
    blob = cols_to_splat(parse_ply(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(blob)
    return len(blob) // SPLAT_STRIDE


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("ply")
    p.add_argument("splat")
    args = p.parse_args()
    n = convert(Path(args.ply), Path(args.splat))
    print(f"wrote {n} gaussians → {args.splat}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
