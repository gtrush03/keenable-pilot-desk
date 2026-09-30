# Pilot Desk

Run a prospect's own queries through Keenable's Search API and get a pilot verdict: latency (p50/p95) in `realtime` and `pro`
mode, whether the source an evaluator expects comes back in the top 3, crawl freshness, point-in-time runs with
`query_time`, a sized deal at list prices, and a copy-ready verdict memo. A second tab maps agent frameworks and inference
platforms that could ship Keenable next (sourced, prepared in advance).

Built by George Trushevskiy (george.trusynth.com, github.com/gtrush03) for Keenable's Founding GTM role. Independent
prototype on Keenable's documented keyless endpoint (`/v1/search/public`); not made or endorsed by Keenable.

- `api/run.js`: server-side runner (2 in flight, paced under the keyless 10 req/s, retries on 429). Uses a key if
  `KEENABLE_API_KEY` is set as a Vercel secret.
- `public/`: static UI. `public/data/`: prepared runs and the radar data.
- Local: `bun scripts/dev.mjs`, or `bun scripts/local-run.mjs lab`.
