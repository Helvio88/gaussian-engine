import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Chromium\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8080/";
const outDir = path.resolve("C:\\Users\\helvio\\projects\\gaussian-engine\\tmp");
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: [
    "--use-gl=angle",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    "--window-size=1280,800",
  ],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on("console", (msg) => logs.push(`console.${msg.type()} ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror ${err.message}`));
page.on("requestfailed", (req) =>
  logs.push(`requestfailed ${req.url()} ${req.failure()?.errorText || ""}`)
);

await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent || "").includes("Ready"),
  { timeout: 20000 }
);
await new Promise((r) => setTimeout(r, 800));

const desktop = path.join(outDir, "desktop.png");
await page.screenshot({ path: desktop, type: "png" });

await page.click("#btnWalk");
await new Promise((r) => setTimeout(r, 400));
const walk = path.join(outDir, "walk.png");
await page.screenshot({ path: walk, type: "png" });
await page.click("#btnOrbit");

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: "networkidle0" });
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent || "").includes("Ready"),
  { timeout: 20000 }
);
await new Promise((r) => setTimeout(r, 800));
const mobile = path.join(outDir, "mobile.png");
await page.screenshot({ path: mobile, type: "png" });

const state = await page.evaluate(() => ({
  title: document.title,
  status: document.getElementById("status")?.textContent,
  stats: document.getElementById("stats")?.textContent,
  lan: document.getElementById("lan")?.textContent,
  log: document.getElementById("log")?.textContent,
}));

console.log(JSON.stringify({ desktop, walk, mobile, state, logs }, null, 2));
await browser.close();
