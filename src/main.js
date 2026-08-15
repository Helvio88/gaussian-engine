import { bindLog, log, startLogShipper } from "./log.js";
import { lookAt, perspective, isMobile, tick, fmtCount } from "./math.js";
import { buildOctree, selectLod } from "./octree.js";
import { Renderer } from "./renderer.js";
import { generateRoom, resetCamera, ROOM_BOUNDS } from "./scene.js";
import { decodeSplat, encodeSplat } from "./format.js";

const FOV = 55;
const mobile = isMobile();

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const statsEl = $("stats");
const logEl = $("log");
const canvas = $("c");
const stick = $("stick");
const knob = $("stickKnob");
const lanEl = $("lan");

bindLog(logEl);
startLogShipper();

function setStatus(t) {
  statusEl.textContent = t;
}

const defaultBudget = mobile ? 70000 : 140000;
const defaultScene = mobile ? 80000 : 140000;
const defaultDpr = mobile ? 1 : Math.min(devicePixelRatio || 1, 2);

let dpr = defaultDpr;
let budget = defaultBudget;
let lodPixels = mobile ? 22 : 16;
let scaleMul = 1;
let cloud = null;
let tree = null;
let dirtySelect = true;
let lastSelectAt = 0;
let lastCamKey = "";
let fps = 0;
let frames = 0;
let fpsT = performance.now();
let last = fpsT;
let selectMs = 0;
let sortMs = 0;
let lastDrawn = 0;
let lastProxies = 0;
let userBudget = defaultBudget;
let adaptOn = true;

const cam = resetCamera();
const keys = new Set();
const view = new Float32Array(16);
const proj = new Float32Array(16);
const pointers = new Map();
let pinch0 = 0;
let drag = false;
let lx = 0,
  ly = 0;
let joy = [0, 0];
let joyActive = false;

let renderer;
try {
  renderer = new Renderer(canvas);
  log.info(`WebGL2 ok · ${mobile ? "mobile" : "desktop"} · dpr ${dpr}`);
} catch (err) {
  setStatus(String(err.message || err));
  log.error(String(err.message || err));
  throw err;
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, (w * dpr) | 0);
  canvas.height = Math.max(1, (h * dpr) | 0);
  dirtySelect = true;
}
resize();
addEventListener("resize", resize);
visualViewport?.addEventListener("resize", resize);

function camKey() {
  return [
    cam.eye[0].toFixed(2),
    cam.eye[1].toFixed(2),
    cam.eye[2].toFixed(2),
    cam.yaw.toFixed(2),
    cam.pitch.toFixed(2),
    budget,
    lodPixels,
  ].join("|");
}

function applyOrbit() {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  cam.eye[0] = cam.target[0] + cam.radius * sy * cp;
  cam.eye[1] = cam.target[1] + cam.radius * sp;
  cam.eye[2] = cam.target[2] + cam.radius * cy * cp;
}

function applyWalk(dt) {
  const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4.5 : 2) * dt;
  const fy = -Math.sin(cam.yaw);
  const fz = -Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw);
  const rz = -Math.sin(cam.yaw);
  let mx = 0,
    mz = 0;
  if (keys.has("KeyW")) {
    mx += fy;
    mz += fz;
  }
  if (keys.has("KeyS")) {
    mx -= fy;
    mz -= fz;
  }
  if (keys.has("KeyD")) {
    mx += rx;
    mz += rz;
  }
  if (keys.has("KeyA")) {
    mx -= rx;
    mz -= rz;
  }
  mx += fy * -joy[1] + rx * joy[0];
  mz += fz * -joy[1] + rz * joy[0];
  const L = Math.hypot(mx, mz);
  if (L > 0) {
    cam.eye[0] += (mx / L) * speed;
    cam.eye[2] += (mz / L) * speed;
  }
  if (keys.has("Space")) cam.eye[1] += speed;
  if (keys.has("KeyC")) cam.eye[1] -= speed;
  const b = ROOM_BOUNDS;
  cam.eye[0] = Math.min(b.max[0], Math.max(b.min[0], cam.eye[0]));
  cam.eye[1] = Math.min(b.max[1], Math.max(b.min[1], cam.eye[1]));
  cam.eye[2] = Math.min(b.max[2], Math.max(b.min[2], cam.eye[2]));
  cam.target[0] = cam.eye[0] - Math.sin(cam.yaw) * Math.cos(cam.pitch);
  cam.target[1] = cam.eye[1] + Math.sin(cam.pitch);
  cam.target[2] = cam.eye[2] - Math.cos(cam.yaw) * Math.cos(cam.pitch);
}

canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    pinch0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    drag = false;
    return;
  }
  if (joyActive) return;
  drag = true;
  lx = e.clientX;
  ly = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = 0;
  if (!pointers.size) drag = false;
});
canvas.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  drag = false;
  pinch0 = 0;
});
canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch0 && cam.mode === "orbit") {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ratio = pinch0 / Math.max(8, d);
    cam.radius = Math.max(0.5, Math.min(40, cam.radius * ratio));
    pinch0 = d;
    dirtySelect = true;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - lx;
  const dy = e.clientY - ly;
  lx = e.clientX;
  ly = e.clientY;
  if (cam.mode === "orbit") {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(0.05, Math.min(1.4, cam.pitch + dy * 0.005));
  } else {
    cam.yaw -= dx * 0.003;
    cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.003));
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (cam.mode === "orbit") {
      cam.radius = Math.max(0.5, Math.min(40, cam.radius * (1 + e.deltaY * 0.001)));
      dirtySelect = true;
    }
  },
  { passive: false }
);
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));

function setupJoystick() {
  const base = $("stickBase");
  function setFromEvent(e) {
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width * 0.5);
    let dy = (e.clientY - cy) / (r.height * 0.5);
    const L = Math.hypot(dx, dy);
    if (L > 1) {
      dx /= L;
      dy /= L;
    }
    joy[0] = dx;
    joy[1] = dy;
    knob.style.transform = `translate(${dx * 22}px, ${dy * 22}px)`;
  }
  function end() {
    joyActive = false;
    joy[0] = 0;
    joy[1] = 0;
    knob.style.transform = "translate(0,0)";
  }
  stick.addEventListener("pointerdown", (e) => {
    joyActive = true;
    stick.setPointerCapture(e.pointerId);
    setFromEvent(e);
    e.preventDefault();
  });
  stick.addEventListener("pointermove", (e) => {
    if (joyActive) setFromEvent(e);
  });
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);
}
setupJoystick();

function setMode(mode) {
  cam.mode = mode;
  $("btnOrbit").classList.toggle("active", mode === "orbit");
  $("btnWalk").classList.toggle("active", mode === "walk");
  stick.hidden = mode !== "walk";
  log.info(`mode ${mode}`);
}

async function loadCloud(next, label) {
  setStatus(`Generating ${label}…`);
  await tick();
  const t0 = performance.now();
  cloud = next;
  log.info(`${label}: ${fmtCount(cloud.count)} gaussians`);
  setStatus(`Building LoD · ${fmtCount(cloud.count)}…`);
  await tick();
  const t1 = performance.now();
  tree = buildOctree(cloud, { maxLeaf: mobile ? 64 : 48, maxDepth: 14 });
  const t2 = performance.now();
  dirtySelect = true;
  lastCamKey = "";
  setStatus(`Ready · ${fmtCount(cloud.count)} · ${fmtCount(tree.nodes.length)} nodes`);
  log.info(
    `build gen ${(t1 - t0).toFixed(0)}ms · octree ${(t2 - t1).toFixed(0)}ms · nodes ${tree.nodes.length}`
  );
}

async function loadRoom(target, label) {
  try {
    const next = generateRoom(target);
    Object.assign(cam, resetCamera(innerHeight > innerWidth));
    await loadCloud(next, label);
  } catch (err) {
    setStatus(String(err.message || err));
    log.error(String(err.message || err));
  }
}

function exportSplat() {
  if (!cloud) return;
  const buf = encodeSplat(cloud);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scene-${cloud.count}.splat`;
  a.click();
  URL.revokeObjectURL(a.href);
  log.info(`exported ${cloud.count} splats`);
}

async function importSplat(file) {
  try {
    setStatus(`Reading ${file.name}…`);
    const buf = await file.arrayBuffer();
    const next = decodeSplat(buf);
    await loadCloud(next, file.name);
  } catch (err) {
    setStatus(String(err.message || err));
    log.error(String(err.message || err));
  }
}

function rebuildDraw(now) {
  if (!cloud || !tree) return;
  const key = camKey();
  const moved = key !== lastCamKey;
  if (!dirtySelect && !moved && now - lastSelectAt < 250) return;
  if (!moved && now - lastSelectAt < 80) return;
  const t0 = performance.now();
  const picked = selectLod(tree, cam, budget, lodPixels, canvas.height);
  selectMs = performance.now() - t0;
  let proxies = 0;
  for (const k of picked) if (k < 0) proxies++;
  lastProxies = proxies;
  renderer.pack(cloud, tree, picked);
  const t1 = performance.now();
  renderer.sortBackToFront(view);
  sortMs = performance.now() - t1;
  renderer.upload();
  lastDrawn = picked.length;
  lastSelectAt = now;
  lastCamKey = key;
  dirtySelect = false;
}

function adaptBudget() {
  if (!adaptOn) return;
  if (fps < 22 && budget > 4000) {
    budget = Math.max(4000, Math.round(budget * 0.82));
    $("budget").value = budget;
    $("budgetLabel").textContent = fmtCount(budget);
    dirtySelect = true;
    log.warn(`adapt budget ↓ ${fmtCount(budget)} @ ${fps.toFixed(0)}fps`);
  } else if (fps > 52 && budget < userBudget) {
    budget = Math.min(userBudget, Math.round(budget * 1.12));
    $("budget").value = budget;
    $("budgetLabel").textContent = fmtCount(budget);
    dirtySelect = true;
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  if (now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
    adaptBudget();
  }
  if (cam.mode === "orbit") applyOrbit();
  else applyWalk(dt);
  lookAt(view, cam.eye, cam.target, [0, 1, 0]);
  perspective(proj, FOV, canvas.width / Math.max(1, canvas.height), 0.05, 200);
  rebuildDraw(now);
  renderer.draw(view, proj, canvas.width, canvas.height, FOV, scaleMul);
  statsEl.textContent =
    `${fps.toFixed(0)} fps · draw ${fmtCount(lastDrawn)} / ${cloud ? fmtCount(cloud.count) : 0}` +
    ` · lod ${lastProxies} · sel ${selectMs.toFixed(1)}ms · sort ${sortMs.toFixed(1)}ms`;
  requestAnimationFrame(frame);
}

$("btnRoom80k").onclick = () => loadRoom(80000, "Room 80k");
$("btnRoom500k").onclick = () => loadRoom(500000, "Room 0.5M");
$("btnRoom2m").onclick = () => loadRoom(mobile ? 900000 : 2000000, mobile ? "Room 0.9M" : "Room 2M");
$("btnRoom3m").onclick = () => loadRoom(mobile ? 1200000 : 3500000, mobile ? "Room 1.2M" : "Room 3.5M");
$("btnOrbit").onclick = () => setMode("orbit");
$("btnWalk").onclick = () => setMode("walk");
$("btnExport").onclick = exportSplat;
$("fileSplat").onchange = (e) => {
  const f = e.target.files?.[0];
  if (f) importSplat(f);
  e.target.value = "";
};
$("scale").oninput = (e) => {
  scaleMul = +e.target.value;
  $("scaleLabel").textContent = scaleMul.toFixed(2);
};
$("budget").oninput = (e) => {
  userBudget = +e.target.value;
  budget = userBudget;
  $("budgetLabel").textContent = fmtCount(budget);
  dirtySelect = true;
};
$("lod").oninput = (e) => {
  lodPixels = +e.target.value;
  $("lodLabel").textContent = String(lodPixels);
  dirtySelect = true;
};
$("btnLog").onclick = () => {
  $("logWrap").classList.toggle("open");
};

$("budget").value = budget;
$("budget").max = mobile ? 120000 : 400000;
$("budgetLabel").textContent = fmtCount(budget);
$("lod").value = lodPixels;
$("lodLabel").textContent = String(lodPixels);

async function showLan() {
  try {
    const info = await (await fetch("/whoami")).json();
    const port = info.port || 8080;
    const ips = (info.ips || []).filter((ip) => !ip.startsWith("172.") && !ip.startsWith("169.254."));
    const urls = ips.map((ip) => `http://${ip}:${port}/`);
    if (urls.length) {
      lanEl.textContent = `Phone · ${urls[0]}`;
      lanEl.hidden = false;
      lanEl.style.cursor = "pointer";
      lanEl.onclick = async () => {
        try {
          await navigator.clipboard.writeText(urls[0]);
          lanEl.textContent = `Copied · ${urls[0]}`;
          setTimeout(() => {
            lanEl.textContent = `Phone · ${urls[0]}`;
          }, 1200);
        } catch {
          log.warn("clipboard unavailable");
        }
      };
      log.info(`LAN ${urls.join(" ")}`);
    }
    log.info(`client ${info.client} · ${info.ua || ""}`.slice(0, 180));
  } catch (err) {
    log.warn("whoami failed " + err);
  }
}

setMode("orbit");
if (mobile) {
  document.body.classList.add("hud-min");
  $("btnHud").textContent = "Expand";
}
$("btnHud").onclick = () => {
  document.body.classList.toggle("hud-min");
  $("btnHud").textContent = document.body.classList.contains("hud-min") ? "Expand" : "Compact";
};
showLan();
requestAnimationFrame(frame);
loadRoom(defaultScene, mobile ? "Room 80k" : "Room 160k");
