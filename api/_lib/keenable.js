// Server-side client for Keenable's documented keyless endpoints (docs.keenable.ai/api-reference).
// If KEENABLE_API_KEY is set as a Vercel secret, the keyed endpoint is used instead.
const BASE = "https://api.keenable.ai/v1";
const TITLE = "keenable-pilot-desk";

export async function search(body, { timeoutMs = 9000 } = {}) {
  const key = process.env.KEENABLE_API_KEY;
  const url = key ? `${BASE}/search` : `${BASE}/search/public`;
  const headers = { "content-type": "application/json", "X-Keenable-Title": TITLE };
  if (key) headers["X-API-Key"] = key;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const ms = Math.round(performance.now() - t0);
    const remaining = r.headers.get("x-ratelimit-remaining");
    let json = null;
    try { json = await r.json(); } catch {}
    if (!r.ok) return { ok: false, status: r.status, ms, remaining, error: errorText(r.status, json) };
    return { ok: true, status: r.status, ms, remaining, mode: json?.mode, results: json?.results || [] };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), error: e.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}

function errorText(status, json) {
  if (status === 429) return "rate_limited";
  if (status === 400) return "bad_request";
  if (status === 402) return "no_credits";
  if (status >= 500) return "upstream_error";
  return "error";
}

export const keyed = () => !!process.env.KEENABLE_API_KEY;
