// Record prepared runs from the deployed server: bun scripts/snapshot.mjs https://keenable-pilot-desk.vercel.app
globalThis.window = {}; await import("../public/presets.js");
const base = process.argv[2];
for (const p of window.PRESETS) {
  const r = await fetch(base + "/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: p.queries, modes: ["realtime", "pro"] }) });
  const j = await r.json();
  const fails = j.rows ? j.rows.flatMap((x) => x.runs).filter((x) => !x.ok).length : -1;
  console.log(p.id, r.status, j.region, "wall", j.wall_ms, "fails", fails);
  if (r.ok && fails === 0) await Bun.write(`public/data/snapshot-${p.id}.json`, JSON.stringify(j));
  for (const row of j.rows || []) console.log("  ", row.runs.map((x) => `${x.mode}:${x.ok ? x.ms : x.error}`).join(" "), "rank", row.runs[0]?.gold_rank, "|", row.q);
  await new Promise((s) => setTimeout(s, 3000));
}
