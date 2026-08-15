#!/usr/bin/env python3
"""Minimal CUDA 3DGS trainer: COLMAP text model + gsplat.rasterization → .ply."""

from __future__ import annotations

import argparse
import math
import struct
from pathlib import Path

import numpy as np
import torch
from PIL import Image

SH_C0 = 0.28209479177387814


def qvec_to_rotmat(q):
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w],
            [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w],
            [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y],
        ],
        dtype=np.float64,
    )


def load_colmap(sparse: Path, image_dir: Path):
    cams = {}
    for line in (sparse / "cameras.txt").read_text(encoding="utf-8").splitlines():
        if not line or line[0] == "#":
            continue
        p = line.split()
        cid, model, w, h = int(p[0]), p[1], int(p[2]), int(p[3])
        params = list(map(float, p[4:]))
        if model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL"):
            f, cx, cy = params[0], params[1], params[2]
            fx = fy = f
        else:
            fx, fy, cx, cy = params[0], params[1], params[2], params[3]
        cams[cid] = {"w": w, "h": h, "K": np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], np.float32)}

    images = []
    lines = [ln for ln in (sparse / "images.txt").read_text(encoding="utf-8").splitlines() if ln and ln[0] != "#"]
    for i in range(0, len(lines), 2):
        p = lines[i].split()
        q = np.array(list(map(float, p[1:5])), np.float64)
        t = np.array(list(map(float, p[5:8])), np.float64)
        R = qvec_to_rotmat(q)
        view = np.eye(4, dtype=np.float32)
        view[:3, :3] = R
        view[:3, 3] = t
        name = p[9]
        path = image_dir / name
        if not path.exists():
            matches = list(image_dir.glob(Path(name).name))
            if not matches:
                continue
            path = matches[0]
        cam = cams[int(p[8])]
        images.append({"view": view, "K": cam["K"], "path": path, "w": cam["w"], "h": cam["h"]})

    pts, cols = [], []
    p3 = sparse / "points3D.txt"
    if p3.exists():
        for line in p3.read_text(encoding="utf-8").splitlines():
            if not line or line[0] == "#":
                continue
            p = line.split()
            pts.append([float(p[1]), float(p[2]), float(p[3])])
            cols.append([float(p[4]) / 255.0, float(p[5]) / 255.0, float(p[6]) / 255.0])
    if len(pts) < 32:
        raise RuntimeError("COLMAP sparse cloud is too small to seed gaussians")
    return images, np.asarray(pts, np.float32), np.asarray(cols, np.float32)


def write_ply(path: Path, means, scales, quats, opacities, colors):
    n = means.shape[0]
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {n}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property float nx\nproperty float ny\nproperty float nz\n"
        "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n"
        "property float opacity\n"
        "property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
        "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
        "end_header\n"
    ).encode("ascii")
    rec = struct.Struct("<18f")
    body = bytearray()
    for i in range(n):
        dc = (colors[i] - 0.5) / SH_C0
        o = opacities[i]
        o = min(1 - 1e-6, max(1e-6, o))
        logit = math.log(o / (1 - o))
        log_s = np.log(np.clip(scales[i], 1e-6, 10))
        q = quats[i]
        body.extend(
            rec.pack(
                means[i, 0], means[i, 1], means[i, 2],
                0, 0, 0,
                dc[0], dc[1], dc[2],
                logit,
                log_s[0], log_s[1], log_s[2],
                q[0], q[1], q[2], q[3],
            )
        )
    path.write_bytes(header + body)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data_dir", required=True)
    p.add_argument("--result_dir", required=True)
    p.add_argument("--max_steps", type=int, default=3000)
    args = p.parse_args()

    try:
        from gsplat.rendering import rasterization
    except ImportError as exc:
        raise SystemExit("gsplat is not installed in this Python. Run scripts/setup_gpu.ps1") from exc

    data = Path(args.data_dir)
    sparse = data / "sparse" / "0"
    images_dir = data / "images"
    views, pts, cols = load_colmap(sparse, images_dir)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise SystemExit("CUDA is not available in this Python — the 5070 Ti is not being used")

    means = torch.nn.Parameter(torch.tensor(pts, device=device))
    colors = torch.nn.Parameter(torch.tensor(cols, device=device).clamp(0, 1))
    # Seed scale from nearest-neighbor spacing.
    with torch.no_grad():
        d = torch.cdist(means, means)
        d.fill_diagonal_(1e6)
        nn = d.min(dim=1).values.clamp(1e-4, 0.2)
    scales = torch.nn.Parameter(nn[:, None].repeat(1, 3) * 0.5)
    quats = torch.nn.Parameter(torch.zeros(len(pts), 4, device=device))
    with torch.no_grad():
        quats[:, 0] = 1
    opacities = torch.nn.Parameter(torch.logit(torch.full((len(pts),), 0.3, device=device)))

    opt = torch.optim.Adam(
        [
            {"params": [means], "lr": 1.6e-4},
            {"params": [scales], "lr": 5e-3},
            {"params": [quats], "lr": 1e-3},
            {"params": [opacities], "lr": 5e-2},
            {"params": [colors], "lr": 2.5e-3},
        ]
    )

    loaded = []
    for v in views:
        im = np.asarray(Image.open(v["path"]).convert("RGB"), dtype=np.float32) / 255.0
        loaded.append(
            {
                "rgb": torch.tensor(im, device=device),
                "view": torch.tensor(v["view"], device=device),
                "K": torch.tensor(v["K"], device=device),
                "w": im.shape[1],
                "h": im.shape[0],
            }
        )

    for step in range(args.max_steps):
        opt.zero_grad(set_to_none=True)
        view = loaded[step % len(loaded)]
        rgb, _, _ = rasterization(
            means,
            torch.nn.functional.normalize(quats, dim=-1),
            scales.abs() + 1e-6,
            torch.sigmoid(opacities),
            colors.clamp(0, 1),
            view["view"][None],
            view["K"][None],
            view["w"],
            view["h"],
            packed=False,
        )
        pred = rgb[0]
        gt = view["rgb"]
        if pred.shape[:2] != gt.shape[:2]:
            pred = torch.nn.functional.interpolate(pred.permute(2, 0, 1)[None], size=gt.shape[:2], mode="bilinear")[0].permute(1, 2, 0)
        loss = (pred - gt).abs().mean()
        loss.backward()
        opt.step()
        if step % 100 == 0 or step + 1 == args.max_steps:
            print(f"step {step}/{args.max_steps} loss={loss.item():.4f} N={means.shape[0]}", flush=True)

    out = Path(args.result_dir)
    out.mkdir(parents=True, exist_ok=True)
    write_ply(
        out / "point_cloud.ply",
        means.detach().cpu().numpy(),
        (scales.abs() + 1e-6).detach().cpu().numpy(),
        torch.nn.functional.normalize(quats, dim=-1).detach().cpu().numpy(),
        torch.sigmoid(opacities).detach().cpu().numpy(),
        colors.clamp(0, 1).detach().cpu().numpy(),
    )
    print(f"wrote {out / 'point_cloud.ply'}", flush=True)


if __name__ == "__main__":
    main()
