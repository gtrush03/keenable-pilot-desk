import { search, keyed } from "./_lib/keenable.js";

const MODES = new Set(["realtime", "pro"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

// gold: list of "domain" or "domain/path-prefix"; a result counts if its host ends with the domain and path starts with the prefix
export function goldRank(results, gold) {
  if (!gold?.length) return null;
  for (let i = 0; i < results.length; i++) {
    let u; try { u = new URL(results[i].url); } catch { continue; }
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    for (const g of gold) {
      const [d, ...p] = g.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/");
      const path = p.length ? "/" + p.join("/") : "";
      if ((h === d || h.endsWith("." + d)) && u.pathname.toLowerCase().startsWith(path)) return i + 1;
    }
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !Array.isArray(body.queries)) return send(res, 400, { error: "input", message: "Send a list of queries." });

  const queries = body.queries
    .map((x) => ({ q: String(x?.q || "").trim().slice(0, 200), gold: Array.isArray(x?.gold) ? x.gold.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 5) : [] }))
    .filter((x) => x.q)
    .slice(0, 8);
  if (!queries.length) return send(res, 400, { error: "input", message: "Add at least one query." });
  const modes = (Array.isArray(body.modes) ? body.modes : ["realtime", "pro"]).filter((m) => MODES.has(m)).slice(0, 2);
  if (!modes.length) modes.push("realtime");
  const extra = {};
  if (typeof body.query_time === "string" && DATE.test(body.query_time)) extra.query_time = body.query_time;
  if (typeof body.published_after === "string" && DATE.test(body.published_after)) extra.published_after = body.published_after;

  const jobs = queries.flatMap((q, qi) => modes.map((mode) => ({ qi, mode, q })));
  const started = Date.now();
  const out = await pool(jobs, 2, async ({ q, mode }) => {
    const req = { query: q.q, mode, max_results: 10, snippet_max_length: 240, ...extra };
    let r = await search(req);
    for (let t = 0; t < 2 && !r.ok && r.error === "rate_limited"; t++) { await sleep(700 + t * 800); r = await search(req); }
    await sleep(120); // stay well under the keyless 10 req/s per IP
    if (!r.ok) return { mode, ok: false, ms: r.ms, error: r.error, status: r.status };
    return {
      mode, ok: true, ms: r.ms, served_mode: r.mode, remaining: r.remaining,
      gold_rank: goldRank(r.results, q.gold),
      results: r.results.slice(0, 10).map((x) => ({
        title: (x.title || "").slice(0, 160), url: x.url, host: host(x.url),
        snippet: (x.snippet || x.description || "").slice(0, 240),
        published_at: x.published_at || null, acquired_at: x.acquired_at || null,
      })),
    };
  });

  const rows = queries.map((q, qi) => ({ q: q.q, gold: q.gold, runs: out.filter((_, k) => jobs[k].qi === qi) }));
  const failed = out.filter((x) => !x.ok);
  if (failed.length === out.length) {
    const rl = failed.some((f) => f.error === "rate_limited");
    return send(res, rl ? 429 : 502, { error: rl ? "rate_limited" : "upstream", message: rl ? "Keenable's keyless pool is busy for this server right now." : "Keenable didn't answer in time." });
  }
  send(res, 200, {
    ran_at: new Date().toISOString(), wall_ms: Date.now() - started,
    region: process.env.VERCEL_REGION || "local", auth: keyed() ? "api key" : "keyless public endpoint",
    filters: extra, modes, rows,
  });
}
