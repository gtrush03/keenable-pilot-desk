// Run the /api/run handler locally on a preset: bun scripts/local-run.mjs <presetId> [query_time]
import handler from "../api/run.js";
globalThis.window = {}; await import("../public/presets.js");
const p = window.PRESETS.find((x) => x.id === (process.argv[2] || "lab"));
const body = { queries: p.queries, modes: ["realtime", "pro"] };
if (process.argv[3]) body.query_time = process.argv[3];
const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
await handler({ method: "POST", body }, res);
const j = JSON.parse(res.body);
if (process.argv.includes("--json")) { console.log(res.body); process.exit(0); }
console.log(res.statusCode ?? 200, j.wall_ms, j.region, j.auth);
for (const r of j.rows) {
  console.log("-", r.q, "| gold:", r.gold.join(","));
  for (const run of r.runs) console.log("   ", run.mode, run.ok ? `${run.ms}ms rank=${run.gold_rank}` : run.error, run.ok ? run.results.slice(0, 3).map((x) => x.host).join(" ") : "");
}
