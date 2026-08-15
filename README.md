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
