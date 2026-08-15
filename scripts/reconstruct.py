#!/usr/bin/env python3
"""
Phone video / image set → frames → COLMAP poses → GPU 3DGS train → .splat

This is the CUDA path. The web viewer only *displays* the result.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from ply_to_splat import convert as ply_to_splat  # noqa: E402


def write_status(job: Path, **fields) -> None:
    path = job / "status.json"
    cur = {}
    if path.exists():
        try:
            cur = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cur = {}
    cur.update(fields)
    cur["updated"] = time.time()
    path.write_text(json.dumps(cur, indent=2), encoding="utf-8")


def which(name: str) -> str | None:
    return shutil.which(name)


def run(cmd: list[str], cwd: Path | None, log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write("\n$ " + " ".join(cmd) + "\n")
        fh.flush()
        proc = subprocess.run(cmd, cwd=cwd, stdout=fh, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(cmd)}")


def gpu_venv_python() -> Path | None:
    cand = ROOT / ".venv-gpu" / "Scripts" / "python.exe"
    if cand.exists():
        return cand
    cand = ROOT / ".venv-gpu" / "bin" / "python"
    if cand.exists():
        return cand
    return None


def probe() -> dict:
    nv = which("nvidia-smi")
    gpu = None
    if nv:
        try:
            out = subprocess.check_output(
                [
                    nv,
                    "--query-gpu=name,memory.total,memory.used,utilization.gpu",
                    "--format=csv,noheader,nounits",
                ],
                text=True,
                timeout=8,
            ).strip()
            parts = [p.strip() for p in out.split(",")]
            if len(parts) >= 4:
                gpu = {
                    "name": parts[0],
                    "vram_mb": int(float(parts[1])),
                    "vram_used_mb": int(float(parts[2])),
                    "util": int(float(parts[3])),
                }
        except (subprocess.SubprocessError, ValueError):
            gpu = {"name": "nvidia-smi present", "error": "query failed"}
    py = gpu_venv_python()
    torch_ok = False
    cuda_ok = False
    if py:
        try:
            chk = subprocess.check_output(
                [str(py), "-c", "import torch; print(torch.__version__, int(torch.cuda.is_available()))"],
                text=True,
                timeout=20,
            ).strip()
            torch_ok = True
            cuda_ok = chk.endswith(" 1")
        except subprocess.SubprocessError:
            torch_ok = False
    return {
        "gpu": gpu,
        "ffmpeg": which("ffmpeg"),
        "colmap": which("colmap"),
        "gpu_python": str(py) if py else None,
        "torch": torch_ok,
        "cuda": cuda_ok,
        "ready": bool(gpu and which("ffmpeg") and which("colmap") and torch_ok and cuda_ok),
    }


def extract_frames(src: Path, frames: Path, fps: float = 2.0, width: int = 1280) -> int:
    frames.mkdir(parents=True, exist_ok=True)
    # Phone clips: 2 fps is a good overlap/speed tradeoff for a room walk.
    vf = f"fps={fps},scale={width}:-2"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vf",
        vf,
        "-q:v",
        "2",
        str(frames / "%05d.jpg"),
    ]
    run(cmd, None, src.parent / "reconstruct.log")
    n = len(list(frames.glob("*.jpg"))) + len(list(frames.glob("*.png")))
    if n < 8:
        raise RuntimeError(f"only {n} frames extracted — record a longer, slower orbit (need ≥ 8)")
    return n


def copy_images(images: list[Path], frames: Path) -> int:
    frames.mkdir(parents=True, exist_ok=True)
    n = 0
    for i, src in enumerate(images, 1):
        ext = src.suffix.lower() or ".jpg"
        dest = frames / f"{i:05d}{ext}"
        shutil.copy2(src, dest)
        n += 1
    if n < 8:
        raise RuntimeError(f"only {n} images — need at least 8 overlapping views")
    return n


def run_colmap(job: Path, frames: Path) -> Path:
    colmap = which("colmap")
    if not colmap:
        raise RuntimeError(
            "COLMAP is not on PATH. Install the CUDA Windows build from "
            "https://github.com/colmap/colmap/releases and re-run."
        )
    db = job / "colmap" / "database.db"
    sparse = job / "colmap" / "sparse"
    db.parent.mkdir(parents=True, exist_ok=True)
    sparse.mkdir(parents=True, exist_ok=True)
    log = job / "reconstruct.log"
    run(
        [
            colmap,
            "feature_extractor",
            "--database_path",
            str(db),
            "--image_path",
            str(frames),
            "--ImageReader.single_camera",
            "1",
            "--ImageReader.camera_model",
            "OPENCV",
            "--SiftExtraction.use_gpu",
            "1",
        ],
        job,
        log,
    )
    run(
        [
            colmap,
            "exhaustive_matcher",
            "--database_path",
            str(db),
            "--SiftMatching.use_gpu",
            "1",
        ],
        job,
        log,
    )
    run(
        [
            colmap,
            "mapper",
            "--database_path",
            str(db),
            "--image_path",
            str(frames),
            "--output_path",
            str(sparse),
        ],
        job,
        log,
    )
    models = [p for p in sparse.iterdir() if p.is_dir()]
    if not models:
        raise RuntimeError("COLMAP produced no reconstruction — more overlap / slower motion needed")
    # Use the largest model.
    models.sort(key=lambda p: sum(1 for _ in p.glob("*")), reverse=True)
    model = models[0]
    run(
        [
            colmap,
            "model_converter",
            "--input_path",
            str(model),
            "--output_path",
            str(model),
            "--output_type",
            "TXT",
        ],
        job,
        log,
    )
    return model


def run_gsplat(job: Path, frames: Path, sparse: Path) -> Path:
    py = gpu_venv_python()
    if not py:
        raise RuntimeError(
            "GPU venv missing. From the repo root run:  powershell -File scripts/setup_gpu.ps1"
        )
    result_dir = job / "gsplat"
    result_dir.mkdir(parents=True, exist_ok=True)
    # gsplat examples expect a COLMAP folder with images/ + sparse/0
    data = job / "gsplat_data"
    img_link = data / "images"
    spr_link = data / "sparse" / "0"
    if data.exists():
        shutil.rmtree(data)
    spr_link.parent.mkdir(parents=True)
    shutil.copytree(frames, img_link)
    shutil.copytree(sparse, spr_link)
    trainer = None
    for cand in (
        ROOT / ".venv-gpu" / "Lib" / "site-packages" / "gsplat" / "examples" / "simple_trainer.py",
        HERE / "vendor" / "simple_trainer.py",
    ):
        if cand.exists():
            trainer = cand
            break
    # Prefer a small local trainer that does not depend on gsplat examples layout.
    trainer = HERE / "train_gsplat.py"
    cmd = [
        str(py),
        str(trainer),
        "--data_dir",
        str(data),
        "--result_dir",
        str(result_dir),
        "--max_steps",
        os.environ.get("GSPLAT_STEPS", "3000"),
    ]
    run(cmd, job, job / "reconstruct.log")
    plys = sorted(result_dir.rglob("*.ply"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not plys:
        raise RuntimeError("training finished but no .ply was written")
    return plys[0]


def reconstruct(job: Path) -> Path:
    write_status(job, state="running", stage="probe", progress=0.02)
    info = probe()
    write_status(job, tools=info, progress=0.05)
    frames = job / "frames"
    video = next(iter(job.glob("input.*")), None)
    images = sorted((job / "images").glob("*")) if (job / "images").exists() else []

    write_status(job, stage="frames", progress=0.08)
    if video:
        n = extract_frames(video, frames)
    elif images:
        n = copy_images(images, frames)
    else:
        existing = list(frames.glob("*.jpg")) + list(frames.glob("*.png"))
        if len(existing) < 8:
            raise RuntimeError("job has no input video or images")
        n = len(existing)
    write_status(job, frames=n, stage="colmap", progress=0.2)

    sparse = run_colmap(job, frames)
    write_status(job, stage="train", colmap=str(sparse), progress=0.45)

    ply = run_gsplat(job, frames, sparse)
    write_status(job, stage="export", ply=str(ply), progress=0.9)

    splat = job / "result.splat"
    count = ply_to_splat(ply, splat)
    write_status(
        job,
        state="done",
        stage="done",
        progress=1.0,
        splat="result.splat",
        count=count,
    )
    return splat


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps(probe(), indent=2))
        return 0
    job = Path(sys.argv[1]).resolve()
    job.mkdir(parents=True, exist_ok=True)
    try:
        reconstruct(job)
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any trainer/COLMAP failure to status.json
        write_status(job, state="error", error=str(exc), stage="error")
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
