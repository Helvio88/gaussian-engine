export function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let l = 1 / Math.hypot(zx, zy, zz);
  zx *= l;
  zy *= l;
  zz *= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = 1 / Math.hypot(xx, xy, xz);
  xx *= l;
  xy *= l;
  xz *= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function perspective(out, fovDeg, aspect, near, far) {
  const t = 1 / Math.tan((fovDeg * Math.PI) / 360);
  out[0] = t / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = t;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = (2 * far * near) / (near - far);
  out[15] = 0;
  return out;
}

export function hash(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function isMobile() {
  const ua = navigator.userAgent || "";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(innerWidth, innerHeight) < 720;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (coarse && small);
}

export function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

export function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
