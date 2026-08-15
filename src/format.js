/**
 * Packed gaussian: 32 bytes (antimatter15 / INRIA .splat compatible)
 *  float32 x,y,z
 *  float32 sx,sy,sz
 *  uint8 r,g,b,a
 *  uint8 qx,qy,qz,qw  (mapped [-1,1] → [0,255])
 */

export const SPLAT_STRIDE = 32;

export function createCloud(count) {
  return {
    count,
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    colors: new Float32Array(count * 4),
    rotations: new Float32Array(count * 4),
    bbox: {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
  };
}

export function finalizeBBox(cloud) {
  const { positions, count, bbox } = cloud;
  bbox.min = [Infinity, Infinity, Infinity];
  bbox.max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < bbox.min[0]) bbox.min[0] = x;
    if (y < bbox.min[1]) bbox.min[1] = y;
    if (z < bbox.min[2]) bbox.min[2] = z;
    if (x > bbox.max[0]) bbox.max[0] = x;
    if (y > bbox.max[1]) bbox.max[1] = y;
    if (z > bbox.max[2]) bbox.max[2] = z;
  }
  return cloud;
}

export function encodeSplat(cloud) {
  const out = new ArrayBuffer(cloud.count * SPLAT_STRIDE);
  const f32 = new Float32Array(out);
  const u8 = new Uint8Array(out);
  for (let i = 0; i < cloud.count; i++) {
    const fo = i * 8;
    f32[fo] = cloud.positions[i * 3];
    f32[fo + 1] = cloud.positions[i * 3 + 1];
    f32[fo + 2] = cloud.positions[i * 3 + 2];
    f32[fo + 3] = cloud.scales[i * 3];
    f32[fo + 4] = cloud.scales[i * 3 + 1];
    f32[fo + 5] = cloud.scales[i * 3 + 2];
    const bo = i * SPLAT_STRIDE + 24;
    u8[bo] = clampByte(cloud.colors[i * 4] * 255);
    u8[bo + 1] = clampByte(cloud.colors[i * 4 + 1] * 255);
    u8[bo + 2] = clampByte(cloud.colors[i * 4 + 2] * 255);
    u8[bo + 3] = clampByte(cloud.colors[i * 4 + 3] * 255);
    u8[bo + 4] = packQuat(cloud.rotations[i * 4]);
    u8[bo + 5] = packQuat(cloud.rotations[i * 4 + 1]);
    u8[bo + 6] = packQuat(cloud.rotations[i * 4 + 2]);
    u8[bo + 7] = packQuat(cloud.rotations[i * 4 + 3]);
  }
  return out;
}

export function decodeSplat(buffer) {
  const count = Math.floor(buffer.byteLength / SPLAT_STRIDE);
  const cloud = createCloud(count);
  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < count; i++) {
    const fo = i * 8;
    const bo = i * SPLAT_STRIDE + 24;
    cloud.positions[i * 3] = f32[fo];
    cloud.positions[i * 3 + 1] = f32[fo + 1];
    cloud.positions[i * 3 + 2] = f32[fo + 2];
    cloud.scales[i * 3] = Math.max(f32[fo + 3], 1e-4);
    cloud.scales[i * 3 + 1] = Math.max(f32[fo + 4], 1e-4);
    cloud.scales[i * 3 + 2] = Math.max(f32[fo + 5], 1e-4);
    cloud.colors[i * 4] = u8[bo] / 255;
    cloud.colors[i * 4 + 1] = u8[bo + 1] / 255;
    cloud.colors[i * 4 + 2] = u8[bo + 2] / 255;
    cloud.colors[i * 4 + 3] = u8[bo + 3] / 255;
    cloud.rotations[i * 4] = unpackQuat(u8[bo + 4]);
    cloud.rotations[i * 4 + 1] = unpackQuat(u8[bo + 5]);
    cloud.rotations[i * 4 + 2] = unpackQuat(u8[bo + 6]);
    cloud.rotations[i * 4 + 3] = unpackQuat(u8[bo + 7]);
  }
  return finalizeBBox(cloud);
}

export async function loadSplatUrl(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(1);
    return decodeSplat(buf);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(total ? received / total : 0);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return decodeSplat(buf.buffer);
}

function clampByte(v) {
  return Math.max(0, Math.min(255, v | 0));
}
function packQuat(v) {
  return clampByte(((v * 0.5 + 0.5) * 255) | 0);
}
function unpackQuat(v) {
  return (v / 255) * 2 - 1;
}
