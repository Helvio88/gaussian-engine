import { createCloud, finalizeBBox } from "./format.js";
import { hash } from "./math.js";

const ROOM = { w: 8, d: 10, h: 2.8 };

export const ROOM_BOUNDS = {
  min: [-ROOM.w / 2 + 0.2, 0.28, -ROOM.d / 2 + 0.2],
  max: [ROOM.w / 2 - 0.2, ROOM.h - 0.25, ROOM.d / 2 - 0.2],
};

function planeCount(wu, wv, spacing) {
  const nu = Math.max(2, Math.round(wu / spacing));
  const nv = Math.max(2, Math.round(wv / spacing));
  return (nu + 1) * (nv + 1);
}

export function generateRoom(target) {
  const { w, d, h } = ROOM;
  const area = w * d * 2 + 2 * (w * h) + 2 * (d * h);
  const dens = Math.sqrt((target * 0.75) / area);
  const sp = Math.max(0.015, 1 / dens);
  const sb = sp * 0.55;

  const specs = [
    { o: [0, 0.01, 0], u: [1, 0, 0], v: [0, 0, 1], wu: w, wv: d, spacing: sp, sc: [sb * 1.2, sb * 0.2, sb * 1.2], kind: "floor" },
    { o: [0, h - 0.01, 0], u: [1, 0, 0], v: [0, 0, 1], wu: w, wv: d, spacing: sp * 1.1, sc: [sb * 1.2, sb * 0.3, sb * 1.2], kind: "ceil" },
    { o: [-w / 2 + 0.01, h / 2, 0], u: [0, 1, 0], v: [0, 0, 1], wu: h, wv: d, spacing: sp, sc: [sb * 0.3, sb, sb], kind: "wall" },
    { o: [w / 2 - 0.01, h / 2, 0], u: [0, 1, 0], v: [0, 0, 1], wu: h, wv: d, spacing: sp, sc: [sb * 0.3, sb, sb], kind: "wall" },
    { o: [0, h / 2, -d / 2 + 0.01], u: [1, 0, 0], v: [0, 1, 0], wu: w, wv: h, spacing: sp, sc: [sb, sb, sb * 0.3], kind: "wall" },
    { o: [0, h / 2, d / 2 - 0.01], u: [1, 0, 0], v: [0, 1, 0], wu: w, wv: h, spacing: sp, sc: [sb, sb, sb * 0.3], kind: "wall" },
    { o: [0, h * 0.55, d / 2 - 0.03], u: [1, 0, 0], v: [0, 1, 0], wu: w * 0.5, wv: h * 0.5, spacing: sp * 0.65, sc: [sb * 0.9, sb * 0.9, sb * 0.25], kind: "window" },
    { o: [1.6, 0.75, 1], u: [1, 0, 0], v: [0, 0, 1], wu: 1.5, wv: 0.75, spacing: sp * 0.9, sc: [sb, sb * 0.3, sb], kind: "table" },
    { o: [0.3, 0.025, 0.4], u: [1, 0, 0], v: [0, 0, 1], wu: 2.6, wv: 1.9, spacing: sp * 0.75, sc: [sb, sb * 0.25, sb], kind: "rug" },
  ];

  let total = 0;
  for (const s of specs) total += planeCount(s.wu, s.wv, s.spacing);
  const cloud = createCloud(total);
  const P = cloud.positions,
    S = cloud.scales,
    C = cloud.colors,
    R = cloud.rotations;

  let i = 0;
  function colorAt(kind, x, y, z) {
    if (kind === "floor") {
      const g = 0.45 + 0.55 * Math.sin(x * 28 + hash(x, z) * 3);
      return [0.32 + g * 0.22, 0.18 + g * 0.12, 0.09 + g * 0.06, 0.88];
    }
    if (kind === "ceil") return [0.92, 0.9, 0.84, 0.55];
    if (kind === "wall") {
      const t = Math.max(0, Math.min(1, y / ROOM.h));
      return [0.78 + t * 0.1, 0.74 + t * 0.08, 0.66 + t * 0.06, 0.78];
    }
    if (kind === "window") {
      const s = 0.5 + (y / (ROOM.h * 0.5)) * 0.4;
      return [0.5 + s * 0.25, 0.6 + s * 0.2, 0.4 + s * 0.45, 0.95];
    }
    if (kind === "table") return [0.22, 0.13, 0.08, 0.85];
    return [0.38, 0.16, 0.12, 0.9];
  }

  function fillPlane(spec) {
    const nu = Math.max(2, Math.round(spec.wu / spec.spacing));
    const nv = Math.max(2, Math.round(spec.wv / spec.spacing));
    const { o, u, v, wu, wv, sc, kind } = spec;
    for (let iu = 0; iu <= nu; iu++) {
      for (let iv = 0; iv <= nv; iv++) {
        const tu = iu / nu - 0.5;
        const tv = iv / nv - 0.5;
        const x = o[0] + u[0] * tu * wu + v[0] * tv * wv + (hash(iu, iv) - 0.5) * spec.spacing * 0.2;
        const y = o[1] + u[1] * tu * wu + v[1] * tv * wv + (hash(iv, iu) - 0.5) * spec.spacing * 0.05;
        const z = o[2] + u[2] * tu * wu + v[2] * tv * wv + (hash(iu * 0.1, iv) - 0.5) * spec.spacing * 0.2;
        const col = colorAt(kind, x, y, z);
        const m = 0.9 + hash(x, z) * 0.2;
        const p = i * 3,
          c = i * 4;
        P[p] = x;
        P[p + 1] = y;
        P[p + 2] = z;
        S[p] = sc[0] * m;
        S[p + 1] = sc[1] * m;
        S[p + 2] = sc[2] * m;
        C[c] = col[0];
        C[c + 1] = col[1];
        C[c + 2] = col[2];
        C[c + 3] = col[3];
        R[c] = 0;
        R[c + 1] = 0;
        R[c + 2] = 0;
        R[c + 3] = 1;
        i++;
      }
    }
  }

  for (const spec of specs) fillPlane(spec);
  cloud.count = i;
  return finalizeBBox(cloud);
}

export function resetCamera(portrait = false) {
  return {
    eye: [0, 1.55, 3.5],
    target: [0, 1.15, 0],
    yaw: portrait ? 0.55 : 0.45,
    pitch: portrait ? 0.12 : 0.16,
    radius: portrait ? 3.9 : 5.2,
    mode: "orbit",
  };
}
