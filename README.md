# Gaussian Engine

High-capacity **3D Gaussian Splatting** viewer for the web.

**Live demo:** https://helvio88.github.io/gaussian-engine/

## Features

- Hierarchical octree Level-of-Detail
- Fixed per-frame draw budget (handles multi-million scenes)
- WebGL2 projected covariance (true elliptical splats, with rotation)
- Budget-only depth sort with camera-motion throttling
- Adaptive budget when FPS drops (important on phones)
- Load / export standard `.splat` files
- Procedural room stress tests (80k → multi-million)
- Phone-friendly orbit, pinch-zoom, and walk joystick
- Phone capture/upload → CUDA reconstruct on this PC (COLMAP + gsplat)

## Run locally (LAN + phone)

```bash
py -3 serve.py --port 8080
```

On this PC: http://127.0.0.1:8080/

On your phone (same Wi-Fi / LAN as the PC):

```
http://<this-computer-lan-ip>:8080/
```

The page prints the LAN URL in the HUD. Windows firewall is opened for TCP 8080.

Plain `python -m http.server` also works, but `serve.py` logs every request (including phone User-Agents) to `server.log`.

## Controls

- **Orbit** — drag to look, scroll or pinch to zoom
- **Walk** — WASD, Space / C for up-down, drag to look; on a phone use the on-screen stick
- Budget slider — how many gaussians drawn per frame
- Scale slider — splat size multiplier
- LoD slider — screen-size threshold for collapsing octree nodes

## Architecture

Scene size can be tens of millions. Only a fixed budget is selected via LoD, sorted, and drawn each frame.

## Phone recording → GPU splat

The viewer uses **WebGL** on whatever GPU is in the phone/browser. That path only *draws* gaussians.

Building a splat from a phone clip is a different job: **CUDA on this PC** (RTX 5070 Ti).

```
phone  --upload-->  serve.py  --job-->  reconstruct.py
                                      ├─ ffmpeg        extract frames
                                      ├─ COLMAP (CUDA) camera poses + sparse cloud
                                      ├─ gsplat (CUDA) train 3D Gaussians
                                      └─ ply_to_splat  pack result.splat
viewer  <-- GET /api/jobs/<id>/splat --
```

1. One-time GPU env:

```powershell
powershell -File scripts/setup_gpu.ps1
```

2. Install the [COLMAP CUDA Windows build](https://github.com/colmap/colmap/releases) and put `colmap.exe` on `PATH`.

3. On the phone, open the LAN URL, tap **Capture** (or **Upload clip**), record a slow orbit of one room, send it. Status shows upload % then `GPU frames / colmap / train / export`. When it finishes the viewer loads the splat.

Capture that actually reconstructs:

- 20–60 seconds, walking *around* the subject
- lots of overlap, no whip pans
- lights on, hold the phone with two hands
- one room first — not a whole house in one clip

`GET /api/gpu` reports whether ffmpeg, COLMAP, torch, and CUDA are ready. Jobs land in `jobs/<id>/`.
