// UI check with a local headless Chrome: bun tests/ui.mjs <base> <outdir>
import { chromium } from "/home/chief/Projects/tavus-synth-v5/node_modules/playwright-core/index.mjs";
const base = process.argv[2] || "http://127.0.0.1:7431", out = process.argv[3] || "/tmp";
import fs from "fs";
const root = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1243/";
const bin = fs.readdirSync(root).map((d) => root + d + "/chrome-headless-shell").find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: bin });
const errors = [];
for (const [name, vp, scheme] of [["desk", { width: 1280, height: 900 }, "light"], ["phone", { width: 390, height: 844 }, "dark"]]) {
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(name + ": " + e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(name + " console: " + m.text()));
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.screenshot({ path: `${out}/${name}-0-start.png`, fullPage: false });
  await p.click("#run");
  await p.waitForSelector("#results tbody tr", { timeout: 60000 });
  await p.waitForTimeout(300);
  const tiles = await p.$$eval("#score .tile", (t) => t.map((x) => x.innerText.replace(/\n/g, " | ")));
  console.log(name, "tiles:", tiles);
  const hasHScroll = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(name, "page h-scroll:", hasHScroll);
  await p.screenshot({ path: `${out}/${name}-1-run.png`, fullPage: true });
  if (name === "desk") console.log((await p.$eval("#memo", (e) => e.textContent)));
  await p.click('.tabs button[data-tab="radar"]');
  await p.waitForSelector(".rc", { timeout: 10000 });
  console.log(name, "radar cards:", await p.$$eval(".rc", (x) => x.length));
  await p.screenshot({ path: `${out}/${name}-2-radar.png`, fullPage: false });
  await p.click('.tabs button[data-tab="week"]');
  await p.screenshot({ path: `${out}/${name}-3-week.png`, fullPage: true });
  await ctx.close();
}
console.log("errors:", errors);
await b.close();
