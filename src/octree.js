/**
 * In-place octree over a gaussian cloud.
 * Leaves hold original splat indices. Internal nodes hold a proxy splat
 * used when the node is small on screen or the draw budget is tight.
 */

export function buildOctree(cloud, opts = {}) {
  const maxLeaf = opts.maxLeaf ?? 48;
  const maxDepth = opts.maxDepth ?? 14;
  const count = cloud.count;
  const positions = cloud.positions;
  const scales = cloud.scales;
  const colors = cloud.colors;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;

  const nodes = [];

  function makeNode(start, n, depth) {
    let minx = Infinity,
      miny = Infinity,
      minz = Infinity;
    let maxx = -Infinity,
      maxy = -Infinity,
      maxz = -Infinity;
    let px = 0,
      py = 0,
      pz = 0;
    let sx = 0,
      sy = 0,
      sz = 0;
    let cr = 0,
      cg = 0,
      cb = 0,
      ca = 0;
    for (let i = 0; i < n; i++) {
      const id = indices[start + i];
      const o = id * 3;
      const x = positions[o],
        y = positions[o + 1],
        z = positions[o + 2];
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (z < minz) minz = z;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
      if (z > maxz) maxz = z;
      px += x;
      py += y;
      pz += z;
      sx += scales[o];
      sy += scales[o + 1];
      sz += scales[o + 2];
      const c = id * 4;
      cr += colors[c];
      cg += colors[c + 1];
      cb += colors[c + 2];
      ca += colors[c + 3];
    }
    const inv = n ? 1 / n : 1;
    px *= inv;
    py *= inv;
    pz *= inv;
    const hx = (maxx - minx) * 0.5;
    const hy = (maxy - miny) * 0.5;
    const hz = (maxz - minz) * 0.5;
    const radius = Math.hypot(hx, hy, hz);
    const node = {
      start,
      count: n,
      minx,
      miny,
      minz,
      maxx,
      maxy,
      maxz,
      cx: (minx + maxx) * 0.5,
      cy: (miny + maxy) * 0.5,
      cz: (minz + maxz) * 0.5,
      radius,
      children: null,
      px,
      py,
      pz,
      sx: Math.max(sx * inv, (maxx - minx) / 3 || 1e-4),
      sy: Math.max(sy * inv, (maxy - miny) / 3 || 1e-4),
      sz: Math.max(sz * inv, (maxz - minz) / 3 || 1e-4),
      cr: cr * inv,
      cg: cg * inv,
      cb: cb * inv,
      ca: Math.min(0.95, ca * inv * 1.15),
    };
    const idx = nodes.length;
    nodes.push(node);
    if (n <= maxLeaf || depth >= maxDepth) return idx;

    const parts = partition8(indices, start, n, positions, node.cx, node.cy, node.cz);
    let nonempty = 0;
    for (const p of parts) if (p.count) nonempty++;
    if (nonempty <= 1) return idx;

    const childIds = [];
    for (const p of parts) {
      if (!p.count) continue;
      childIds.push(makeNode(p.start, p.count, depth + 1));
    }
    node.children = childIds;
    return idx;
  }

  makeNode(0, count, 0);
  return { nodes, indices, root: 0 };
}

function partition8(indices, start, count, positions, cx, cy, cz) {
  const counts = new Uint32Array(8);
  const oct = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const id = indices[start + i];
    const o = id * 3;
    const k =
      (positions[o] >= cx ? 1 : 0) |
      (positions[o + 1] >= cy ? 2 : 0) |
      (positions[o + 2] >= cz ? 4 : 0);
    oct[i] = k;
    counts[k]++;
  }
  const cursor = new Uint32Array(8);
  const ranges = new Array(8);
  let acc = 0;
  for (let b = 0; b < 8; b++) {
    ranges[b] = { start: start + acc, count: counts[b] };
    cursor[b] = acc;
    acc += counts[b];
  }
  const tmp = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const b = oct[i];
    tmp[cursor[b]++] = indices[start + i];
  }
  indices.set(tmp, start);
  return ranges;
}

export function selectLod(tree, camera, budget, lodPixels, viewH) {
  const { nodes, indices } = tree;
  const picked = [];
  const eye = camera.eye;
  const fx = eye[0],
    fy = eye[1],
    fz = eye[2];
  const invH = viewH;

  function screenPx(node) {
    const dx = node.cx - fx;
    const dy = node.cy - fy;
    const dz = node.cz - fz;
    const dist = Math.hypot(dx, dy, dz);
    return ((node.radius + 1e-4) / Math.max(dist, 0.05)) * invH;
  }

  function emitLeaf(node, remaining) {
    const n = Math.min(node.count, remaining);
    for (let i = 0; i < n; i++) {
      picked.push(indices[node.start + i]);
    }
    return n;
  }

  function emitStride(node, remaining) {
    const n = Math.min(node.count, remaining);
    if (n <= 0) return 0;
    if (n >= node.count) return emitLeaf(node, remaining);
    const step = node.count / n;
    for (let i = 0; i < n; i++) {
      picked.push(indices[node.start + Math.min(node.count - 1, (i * step) | 0)]);
    }
    return n;
  }

  // Proxy keys are encoded as -(nodeIndex + 1).
  function visit(idx, remaining) {
    if (remaining <= 0) return 0;
    const node = nodes[idx];
    const px = screenPx(node);
    const small = px < lodPixels;
    const kids = node.children;
    if (!kids) return emitStride(node, remaining);
    // Only collapse when the node is actually small on screen.
    // A leftover slot on a large node must not become a giant orb.
    if (small) {
      picked.push(-(idx + 1));
      return 1;
    }
    if (remaining < node.count) return emitStride(node, remaining);
    // Local array — a shared buffer would be clobbered by recursive visits.
    const ordered = kids.slice();
    ordered.sort((a, b) => {
      const na = nodes[a],
        nb = nodes[b];
      const da = (na.cx - fx) ** 2 + (na.cy - fy) ** 2 + (na.cz - fz) ** 2;
      const db = (nb.cx - fx) ** 2 + (nb.cy - fy) ** 2 + (nb.cz - fz) ** 2;
      return da - db;
    });
    let used = 0;
    for (let i = 0; i < ordered.length; i++) {
      const reserved = ordered.length - 1 - i;
      const give = remaining - used - reserved;
      if (give <= 0) break;
      used += visit(ordered[i], give);
    }
    return used;
  }

  visit(tree.root, budget);
  return picked;
}
