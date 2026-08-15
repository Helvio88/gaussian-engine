# Gaussian Engine

High-capacity **3D Gaussian Splatting** viewer for the web.

**Live demo:** https://helvio88.github.io/gaussian-engine/

## Features

- Hierarchical octree Level-of-Detail
- Fixed per-frame draw budget (handles multi-million scenes)
- WebGL2 projected covariance (true elliptical splats)
- Budget-only depth sort with camera-motion throttling
- Load / export standard `.splat` files
- Procedural room stress tests (0.5M → multi-million)

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/
```

## Controls

- **Orbit** — drag to look, scroll to zoom
- **Walk** — WASD, Space / C for up-down, drag to look
- Budget slider — how many gaussians drawn per frame
- Scale slider — splat size multiplier

## Architecture

Scene size can be tens of millions. Only a fixed budget is selected via LoD, sorted, and drawn each frame.
