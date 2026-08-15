import puppeteer from "puppeteer-core";

const splat = process.argv[2];
const out = process.argv[3] || "C:\\Users\\helvio\\projects\\gaussian-engine\\tmp\\recon.png";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Chromium\\Application\\chrome.exe",
  headless: "new",
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent || "").includes("Ready"),
  { timeout: 20000 }
);
const input = await page.$("#fileSplat");
await input.uploadFile(splat);
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent || "").includes("Ready ·"),
  { timeout: 30000 }
);
await new Promise((r) => setTimeout(r, 600));
const views = [
  { eye: [1.121, -0.092, -0.908], fwd: [-0.05, 0.22, -0.974] },
  { eye: [-1.392, -0.912, -2.128], fwd: [-0.738, 0.447, 0.506] },
  { eye: [-4.298, -1.016, -1.828], fwd: [-0.083, 0.566, 0.82] },
  { eye: [3.226, 0.079, -0.107], fwd: [-1.0, 0.016, -0.027] },
];
const base = out.replace(/\.png$/i, "");
for (let i = 0; i < views.length; i++) {
  await page.evaluate((v) => {
    const ge = window.__ge;
    if (!ge) return;
    ge.setMode("walk");
    ge.cam.eye = v.eye.slice();
    const pitch = Math.asin(Math.max(-0.99, Math.min(0.99, v.fwd[1])));
    const yaw = Math.atan2(-v.fwd[0], -v.fwd[2]);
    ge.cam.pitch = pitch;
    ge.cam.yaw = yaw;
    ge.cam.target = [
      v.eye[0] + v.fwd[0],
      v.eye[1] + v.fwd[1],
      v.eye[2] + v.fwd[2],
    ];
  }, views[i]);
  await new Promise((r) => setTimeout(r, 300));
  const path = `${base}_${i}.png`;
  await page.screenshot({ path, type: "png" });
  console.log("shot", path);
}
const status = await page.evaluate(() => ({
  status: document.getElementById("status")?.textContent,
  stats: document.getElementById("stats")?.textContent,
}));
console.log(JSON.stringify({ out, ...status }));
await browser.close();
