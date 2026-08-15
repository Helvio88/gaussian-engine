const MAX = 120;
const lines = [];
let el = null;
const pending = [];

function flush() {
  if (!el) return;
  el.textContent = lines.join("\n");
  el.scrollTop = el.scrollHeight;
}

function emit(level, msg) {
  const t = new Date().toLocaleTimeString();
  const line = `${t} ${level} ${msg}`;
  lines.push(line);
  if (lines.length > MAX) lines.shift();
  flush();
  if (level === "error" || level === "warn" || level === "info") {
    pending.push({ level, msg, t: Date.now() });
    if (pending.length > 20) pending.shift();
  }
}

export function bindLog(node) {
  el = node;
  flush();
}

export const log = {
  info: (m) => emit("info", m),
  warn: (m) => emit("warn", m),
  error: (m) => emit("error", m),
  debug: (m) => emit("dbg", m),
};

let drainTimer = 0;
function drain() {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  fetch("/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => {});
}

export function startLogShipper() {
  if (drainTimer) return;
  drainTimer = setInterval(drain, 1500);
  addEventListener("pagehide", drain);
  addEventListener("error", (e) => {
    log.error(e.message || "window error");
  });
  addEventListener("unhandledrejection", (e) => {
    log.error(String(e.reason || "unhandled rejection"));
  });
}
