(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PRESETS = window.PRESETS || [];
  let preset = PRESETS[0];
  let last = null;

  // ---------- tabs ----------
  const tabs = document.querySelectorAll(".tabs button");
  function showTab(id) {
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + id));
    if (id === "radar") loadRadar();
    try { history.replaceState(null, "", "#" + id); } catch {}
  }
  tabs.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------- presets ----------
  function setPreset(p) {
    preset = p;
    document.querySelectorAll("#presets .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === p.id)));
    $("#preset-who").textContent = p.who + ". " + p.note;
    $("#queries").value = p.queries.map((x) => x.q + " | " + x.gold.join(", ")).join("\n");
    $("#prepared").hidden = false;
  }
  $("#presets").innerHTML = PRESETS.map((p) => `<button class="chip" data-id="${p.id}" aria-pressed="false">${esc(p.label)}</button>`).join("") +
    `<button class="chip" data-id="custom" aria-pressed="false">Your own</button>`;
  $("#presets").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    if (c.dataset.id === "custom") {
      preset = { id: "custom", label: "Custom queries", who: "Your own queries", note: "Paste up to 8, one per line", queries: [] };
      document.querySelectorAll("#presets .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
      $("#preset-who").textContent = "Paste up to 8 queries your agent really sends. Add | and the domains you'd expect, to score them.";
      $("#queries").value = ""; $("#queries").focus(); $("#prepared").hidden = true;
      return;
    }
    setPreset(PRESETS.find((p) => p.id === c.dataset.id));
  });

  function parseQueries() {
    return $("#queries").value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).map((l) => {
      const [q, g = ""] = l.split("|");
      const tag = preset.queries?.find((x) => x.q === q.trim())?.tag;
      return { q: q.trim(), gold: g.split(",").map((s) => s.trim()).filter(Boolean), tag };
    }).filter((x) => x.q);
  }

  // ---------- run ----------
  const status = (t) => ($("#status").textContent = t);
  function notice(html, kind = "warn") { const n = $("#notice"); n.innerHTML = html; n.className = "notice" + (kind === "info" ? " info" : ""); n.hidden = !html; }

  $("#run").addEventListener("click", async () => {
    const queries = parseQueries();
    if (!queries.length) { notice("Add at least one query first."); return; }
    const modes = ["realtime", "pro"].filter((m) => $("#m-" + m).checked);
    if (!modes.length) { notice("Pick at least one mode."); return; }
    const body = { queries, modes };
    if ($("#qt").value) body.query_time = $("#qt").value;
    if ($("#pa").value) body.published_after = $("#pa").value;
    $("#run").disabled = true; notice("");
    const calls = queries.length * modes.length;
    status(`Running ${calls} live searches…`);
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 55000);
    const deadline = Date.now() + 75000; // hard stop for the whole run, browser fallback included
    try {
      let j = null, serverStatus = 0;
      try {
        const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
        serverStatus = r.status;
        try { j = await r.json(); } catch {}
        if (!r.ok || !j || !j.rows) j = null;
      } catch (e) { if (e.name === "AbortError") throw e; }
      if (!j) {
        // Server path unavailable (its shared keyless pool may be busy): run everything from this browser instead.
        status("Server busy, running from your browser…");
        j = { ran_at: new Date().toISOString(), region: "your browser", auth: "keyless public endpoint", filters: {}, modes, rows: queries.map((q) => ({ q: q.q, gold: q.gold, runs: modes.map((mode) => ({ mode, ok: false, error: "pending" })) })) };
        if (body.query_time) j.filters.query_time = body.query_time;
        if (body.published_after) j.filters.published_after = body.published_after;
      }
      let retried = 0;
      for (const row of j.rows) for (let k = 0; k < row.runs.length; k++) {
        if (row.runs[k].ok) continue;
        if (Date.now() > deadline) { row.runs[k] = { mode: row.runs[k].mode, ok: false, ms: 0, error: "timeout" }; continue; }
        row.runs[k] = await browserSearch(row, row.runs[k].mode, j.filters || {}); retried++;
      }
      j.preset = preset.id === "custom" ? null : preset.id; j.label = preset.label; j.who = preset.who;
      j.queries = queries; j.prepared = false;
      if (retried && j.region !== "your browser") j.region += ` + ${retried} from your browser`;
      render(j); status("");
      const fails = j.rows.flatMap((r) => r.runs).filter((x) => !x.ok).length;
      if (fails === calls) { failNotice(serverStatus === 429 ? "Keenable's keyless pool is busy right now (1,000 searches an hour per address)." : "The live run didn't come back."); return; }
      if (fails) notice(`${fails} of ${calls} searches didn't come back (busy or timed out); they're marked in the table and left out of the numbers.`);
      else if (retried) notice(`${retried} of ${calls} searches ran from your browser because the server's shared keyless pool was busy; their latency includes your own network.`, "info");
    } catch (e) {
      failNotice(e.name === "AbortError" ? "The live run took too long." : "Couldn't reach the server."); status("");
    } finally { clearTimeout(timer); $("#run").disabled = false; }
  });

  function failNotice(msg) {
    const hasPrep = preset && preset.id !== "custom";
    notice(esc(msg) + (hasPrep ? ` <button class="btn small ghost" id="np">Show the prepared run instead</button>` : " Try again in a minute."));
    const b = $("#np"); if (b) b.addEventListener("click", showPrepared);
  }

  $("#prepared").addEventListener("click", showPrepared);
  async function showPrepared() {
    if (!preset || preset.id === "custom") return;
    status("Loading prepared run…");
    try {
      const r = await fetch(`/data/snapshot-${preset.id}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error();
      const j = await r.json();
      j.prepared = true; j.label = preset.label; j.who = preset.who; j.queries = preset.queries;
      render(j); status("");
      notice(`Prepared run: recorded live from this same server on ${fmtTime(j.ran_at)}. Press <b>Run pilot</b> for fresh numbers.`, "info");
    } catch { status(""); notice("The prepared run isn't available. Press Run pilot for a live one."); }
  }

  // ---------- browser fallback (Keenable's public endpoint allows CORS; app named via ?keenable_title=) ----------
  function goldRank(results, gold) {
    if (!gold?.length) return { rank: null, matched: null };
    for (let i = 0; i < results.length; i++) {
      let u; try { u = new URL(results[i].url); } catch { continue; }
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      for (const g of gold) {
        const [d, ...p] = g.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/");
        const path = p.length ? "/" + p.join("/") : "";
        const pth = u.pathname.toLowerCase();
        if ((h === d || h.endsWith("." + d)) && (!path || pth === path || pth.startsWith(path + "/"))) return { rank: i + 1, matched: g };
      }
    }
    return { rank: 0, matched: null };
  }
  async function browserSearch(row, mode, filters) {
    const req = { query: row.q, mode, max_results: 10, snippet_max_length: 240, ...filters };
    for (let t = 0; t < 3; t++) {
      const t0 = performance.now();
      try {
        const r = await fetch("https://api.keenable.ai/v1/search/public?keenable_title=keenable-pilot-desk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: AbortSignal.timeout(9000) });
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 800 * (t + 1))); continue; }
        if (!r.ok) return { mode, ok: false, ms: 0, error: "upstream_error", origin: "browser" };
        const j = await r.json();
        const ms = Math.round(performance.now() - t0);
        const results = (j.results || []).slice(0, 10).map((x) => { let host = ""; try { host = new URL(x.url).hostname.replace(/^www\./, ""); } catch {} return { title: (x.title || "").slice(0, 160), url: x.url, host, snippet: (x.snippet || x.description || "").slice(0, 240), published_at: x.published_at || null, acquired_at: x.acquired_at || null }; });
        const g = goldRank(results, row.gold);
        await new Promise((s) => setTimeout(s, 150));
        return { mode, ok: true, ms, served_mode: j.mode, gold_rank: g.rank, gold_matched: g.matched, results, origin: "browser" };
      } catch { return { mode, ok: false, ms: 0, error: "network", origin: "browser" }; }
    }
    return { mode, ok: false, ms: 0, error: "rate_limited", origin: "browser" };
  }

  // ---------- search -> fetch -> answer, all on Keenable (Fetch's prompt parameter does the extraction) ----------
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button.read"); if (!b) return;
    const box = b.nextElementSibling; b.disabled = true; b.textContent = "Reading…";
    const prompt = `Answer this question from the page in at most two sentences: "${b.dataset.q}". If the page does not answer it, say so.`;
    const t0 = performance.now();
    try {
      const r = await fetch(`https://api.keenable.ai/v1/fetch/public?keenable_title=keenable-pilot-desk&url=${encodeURIComponent(b.dataset.url)}&prompt=${encodeURIComponent(prompt)}`);
      const ms = Math.round(performance.now() - t0);
      if (!r.ok) throw new Error(r.status === 429 ? "Keenable's keyless pool is busy; try again in a moment." : "Fetch couldn't read that page (it may not be in the index).");
      const j = await r.json();
      box.innerHTML = `<div class="lab">Keenable Fetch with a prompt · ${ms} ms</div>${esc((j.content || "").slice(0, 600)) || "The page came back empty."}`;
    } catch (err) {
      box.innerHTML = `<span class="err">${esc(err.message && !err.message.startsWith("Failed") ? err.message : "Couldn't reach Keenable from this browser.")}</span>`;
    }
    box.hidden = false; b.hidden = true;
  });

  // ---------- metrics ----------
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
  const fmtTime = (iso) => { try { return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC"; } catch { return iso; } };
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;

  function metrics(j) {
    const m = { lat: {}, n: j.rows.length };
    for (const mode of j.modes) {
      const okRuns = j.rows.flatMap((r) => r.runs).filter((x) => x.mode === mode && x.ok);
      const server = okRuns.filter((x) => x.origin !== "browser");
      const ms = (server.length ? server : okRuns).map((x) => x.ms); // never mix server and browser latency
      m.lat[mode] = { p50: pct(ms, 50), p95: pct(ms, 95), n: ms.length };
    }
    const primary = j.modes.includes("realtime") ? "realtime" : j.modes[0];
    m.primary = primary;
    const scored = j.rows.filter((r) => r.gold?.length);
    const pr = (r) => r.runs.find((x) => x.mode === primary && x.ok); // never borrow another mode's result
    const all = j.rows.flatMap((r) => r.runs);
    m.attempted = all.length; m.failed = all.filter((x) => !x.ok).length;
    m.scoredAttempted = scored.length;
    m.scored = scored.filter((r) => pr(r)).length;
    m.byMode = {};
    for (const mode of j.modes) {
      const runs = scored.map((r) => r.runs.find((x) => x.mode === mode && x.ok)).filter(Boolean);
      m.byMode[mode] = { n: runs.length, top3: runs.filter((x) => x.gold_rank >= 1 && x.gold_rank <= 3).length };
    }
    m.top1 = scored.filter((r) => { const x = pr(r); return x && x.gold_rank === 1; }).length;
    m.top3 = scored.filter((r) => { const x = pr(r); return x && x.gold_rank >= 1 && x.gold_rank <= 3; }).length;
    m.top10 = scored.filter((r) => { const x = pr(r); return x && x.gold_rank >= 1; }).length;
    const ages = [];
    for (const r of j.rows) { const x = pr(r); if (!x) continue; for (const res of x.results.slice(0, 3)) { const d = res.acquired_at; if (d) ages.push(days(d, j.ran_at)); } }
    m.crawlAge = pct(ages, 50);
    const pubAges = [];
    for (const r of j.rows) { const x = pr(r); if (!x) continue; for (const res of x.results.slice(0, 3)) if (res.published_at) pubAges.push(days(res.published_at, j.ran_at)); }
    m.withPub = pubAges.length;
    if (j.modes.length === 2) {
      let same = 0, both = 0;
      for (const r of j.rows) {
        const a = r.runs.find((x) => x.mode === "realtime" && x.ok), b = r.runs.find((x) => x.mode === "pro" && x.ok);
        if (!a || !b) continue; both++;
        if (a.results.map((x) => x.url).join() === b.results.map((x) => x.url).join()) same++;
      }
      m.same = same; m.both = both;
    }
    m.wins = scored.filter((r) => pr(r)?.gold_rank === 1).map((r) => r.q);
    m.misses = scored.map((r) => ({ r, x: pr(r) })).filter(({ x }) => x && !(x.gold_rank >= 1 && x.gold_rank <= 3))
      .map(({ r, x }) => ({ q: r.q, rank: x.gold_rank, got: x.results.slice(0, 3).map((y) => y.host), gold: r.gold, matched: x.gold_matched || r.gold[0] }));
    return m;
  }

  // ---------- render ----------
  function render(j) {
    last = j; last.m = metrics(j);
    const m = last.m;
    $("#empty").hidden = true; $("#score").hidden = false; $("#results-wrap").hidden = false; $("#after").hidden = false;
    $("#runmeta").textContent = `${j.prepared ? "Prepared" : "Live"} · ${fmtTime(j.ran_at)} · ${j.region}`;
    const tile = (k, v, s) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const L = m.lat;
    let html = "";
    for (const mode of j.modes) html += tile(`${mode} latency`, L[mode].p50 != null ? `${L[mode].p50} ms` : "–", L[mode].p95 != null ? `p50 · p95 ${L[mode].p95} ms (n=${L[mode].n})` : "no successful calls");
    html += tile("Expected source in top 3", m.scored ? `${m.top3}/${m.scored}` : "–", m.scored ? `top 1: ${m.top1} · top 10: ${m.top10} (${m.primary})${j.modes.length === 2 ? ` · pro ${m.byMode.pro.top3}/${m.byMode.pro.n}` : ""}` : "add | domains to score");
    if (m.failed) html += tile("Searches completed", `${m.attempted - m.failed}/${m.attempted}`, "failed calls are left out, never guessed");
    html += tile("Crawl freshness", m.crawlAge != null ? `${m.crawlAge < 1 ? "<1" : Math.round(m.crawlAge)} d` : "–", "median age of the top-3 pages' crawl date");
    if (m.both != null && j.modes.length === 2) html += tile("realtime vs pro", `${m.same}/${m.both}`, "queries with the identical top-10 list");
    $("#score").innerHTML = html;

    const modes = j.modes;
    let t = `<thead><tr><th>Query</th><th>Expected source</th>${modes.map((x) => `<th>${x}</th>`).join("")}<th>Top results (${m.primary})</th></tr></thead><tbody>`;
    for (const r of j.rows) {
      const tag = (j.queries || []).find((q) => q.q === r.q)?.tag;
      const pr = r.runs.find((x) => x.mode === m.primary && x.ok);
      const rk = pr?.gold_rank;
      const rcls = !r.gold?.length || rk == null ? "na" : rk === 0 ? "bad" : rk <= 3 ? "good" : "mid";
      const rtxt = !r.gold?.length ? "not set" : rk == null ? "–" : rk === 0 ? "not in 10" : "#" + rk;
      t += `<tr><td><div class="q">${esc(r.q)}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</div><div class="fine">${esc((r.gold || []).join(", "))}</div></td>`;
      t += `<td><span class="rank ${rcls}">${rtxt}</span></td>`;
      for (const mode of modes) { const x = r.runs.find((y) => y.mode === mode); t += `<td class="num">${x?.ok ? x.ms + " ms" + (x.origin === "browser" ? `<div class="fine">from browser</div>` : "") : `<span class="err">${esc(x?.error || "–")}</span>`}</td>`; }
      if (pr) {
        const items = pr.results.slice(0, 10).map((y, i) => `<li class="${pr.gold_rank === i + 1 ? "hit" : ""}"><a href="${esc(y.url)}" target="_blank" rel="noopener nofollow">${esc(y.title || y.url)}</a>${y.snippet ? `<div class="snip">${esc(y.snippet)}</div>` : ""}<div class="h">${esc(y.host)}${y.published_at ? " · published " + esc(y.published_at.slice(0, 10)) : ""}${y.acquired_at ? " · crawled " + esc(y.acquired_at.slice(0, 10)) : ""}</div></li>`).join("");
        const top = pr.results[0];
        t += `<td><div>${pr.results.slice(0, 3).map((y) => esc(y.host)).join(" · ") || "no results"}</div><details><summary>All ${pr.results.length} results</summary><ol class="res">${items}</ol></details>${top ? `<button class="btn small ghost read" data-url="${esc(top.url)}" data-q="${esc(r.q)}">Answer from #1 with Fetch</button><div class="ans" hidden></div>` : ""}</td>`;
      } else t += `<td class="err">${m.primary} search failed</td>`;
      t += "</tr>";
    }
    $("#results").innerHTML = t + "</tbody>";
    renderCalc(); renderSnippet(); renderBringBack();
  }

  function money(x) { return x >= 1000 ? "$" + Math.round(x).toLocaleString("en-US") : "$" + x.toFixed(x < 10 ? 2 : 0); }
  function calcNums() {
    const tasks = +$("#c-tasks").value || 0, spt = +$("#c-spt").value || 0, fpt = +$("#c-fpt").value || 0;
    const perDay = tasks * (spt + fpt), perMonth = perDay * 30, rps = perDay / 86400;
    const billable = Math.max(0, perMonth - 100000);
    return { tasks, spt, fpt, perDay, perMonth, rps, builder: (billable / 1000) * 4, frontier: (perMonth / 1000) * 1 };
  }
  function renderCalc() {
    const c = calcNums();
    const tile = (k, v, s) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $("#calc-out").innerHTML = tile("Requests / month", (c.perMonth / 1e6).toFixed(c.perMonth < 1e7 ? 1 : 0) + "M", `avg ${c.rps.toFixed(1)} req/s`) +
      tile("Builder list price", money(c.builder), "$4 / 1k after 100k free") +
      tile("Frontier list rate", money(c.frontier), "$1 / 1k, listed for 100+ RPS");
    if (last) $("#memo").textContent = memo(last);
  }
  ["#c-tasks", "#c-spt", "#c-fpt"].forEach((s) => $(s).addEventListener("input", renderCalc));

  function snippetFor(q, qt) {
    return `// Keyless Keenable search tool for a JS agent harness (Node 18+, Bun, Deno).
// Production swaps in /v1/search with an X-API-Key header (docs.keenable.ai/api-reference).
async function keenableSearch(query, { mode = "realtime", maxResults = 10, queryTime } = {}) {
  const r = await fetch("https://api.keenable.ai/v1/search/public", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Keenable-Title": "my-eval" },
    body: JSON.stringify({ query, mode, max_results: maxResults, ...(queryTime && { query_time: queryTime }) }),
  });
  if (!r.ok) throw new Error(\`keenable \${r.status}\`);
  const { results } = await r.json();
  return results.map(({ title, url, snippet, published_at }) => ({ title, url, snippet, published_at }));
}

console.log(await keenableSearch(${JSON.stringify(q)}${qt ? `, { queryTime: ${JSON.stringify(qt)} }` : ""}));

// Or give any MCP agent the tools, no key needed to try it (docs.keenable.ai/mcp-server):
// claude mcp add keenable --transport http https://api.keenable.ai/mcp`;
  }
  function renderSnippet() {
    $("#snippet").textContent = snippetFor(last?.rows?.[0]?.q || "your query", last?.filters?.query_time);
  }

  function memo(j) {
    const m = j.m, c = calcNums(), L = m.lat;
    const lat = j.modes.map((x) => L[x].n ? `${x}: p50 ${L[x].p50} ms, p95 ${L[x].p95} ms (n=${L[x].n})` : `${x}: no successful calls`).join("; ");
    const rate = m.scored ? m.top3 / m.scored : 0;
    const lines = [];
    lines.push(`PILOT READ (exploratory): ${j.label || "Custom queries"}`);
    lines.push(`${fmtTime(j.ran_at)}${j.prepared ? " (prepared run)" : ""}`);
    lines.push(`Prospect: ${j.who || "custom"}`);
    lines.push(`Setup: ${j.rows.length} queries x ${j.modes.join(" + ")}, Keenable Search API (${j.auth}), server region ${j.region}${j.filters?.query_time ? `, index frozen at ${j.filters.query_time}` : ""}${j.filters?.published_after ? `, published after ${j.filters.published_after}` : ""}.`);
    lines.push("");
    lines.push("RESULTS");
    lines.push(`- Searches completed: ${m.attempted - m.failed}/${m.attempted}.`);
    lines.push(`- Latency, end to end incl. reading the response: ${lat}. Small sample; treat as indicative.`);
    if (m.scored) lines.push(`- Expected source in the top 3 (${m.primary}): ${m.top3}/${m.scored} (top 1: ${m.top1}, top 10: ${m.top10}). A domain match is a proxy for relevance, not a graded answer.`);
    if (m.crawlAge != null) lines.push(`- Crawl freshness: the top-3 pages were crawled a median ${m.crawlAge < 1 ? "under 1" : Math.round(m.crawlAge)} day(s) before the run.`);
    if (m.both) lines.push(`- realtime vs pro: identical top-10 on ${m.same}/${m.both} queries${m.same === m.both ? " on the keyless tier; worth asking the team how the modes differ on keyed traffic" : ""}.`);
    if (m.wins.length) { lines.push(""); lines.push("WHERE IT WINS"); m.wins.forEach((q) => lines.push(`- ${q}`)); }
    if (m.misses.length) {
      lines.push(""); lines.push("WHERE TO DIG IN (take to the search team)");
      m.misses.forEach((x) => lines.push(`- ${x.q}: ${x.rank ? `first expected source (${x.matched}) at #${x.rank}` : `none of ${x.gold.join(", ")} in the top 10`}; top 3 were ${x.got.join(", ")}`));
    }
    lines.push(""); lines.push("READ");
    if (m.failed) lines.push(`- Incomplete: ${m.failed} of ${m.attempted} searches failed. Rerun before drawing any conclusion.`);
    else if (m.scored < 3) lines.push("- Too few scored queries to read anything. Add the domains an evaluator would expect to each query and rerun.");
    else if (rate >= 0.8) lines.push("- Promising on this sample. Lead with latency and the wins above.");
    else if (rate >= 0.5) lines.push("- Mixed on this sample. Take the misses to the search team before the prospect finds them.");
    else lines.push("- Weak on this sample. Understand the misses with the search team before proposing a pilot.");
    lines.push("- Before any pilot: run their current provider on the same queries as the baseline, and agree acceptance criteria and a decision date.");
    lines.push(`- Proposed pilot shape: 2 weeks on their own benchmark with graded answers, retrieval pinned with query_time so reruns see the same index, success = answer quality at least equal to the baseline, p95 under their latency budget, total cost per 1,000 tasks including tokens read.`);
    lines.push(""); lines.push("SIZE (illustrative, list prices from keenable.ai/pricing)");
    lines.push(`- ${c.tasks.toLocaleString("en-US")} tasks/day x (${c.spt} searches + ${c.fpt} fetches) = ${(c.perMonth / 1e6).toFixed(1)}M requests/month, avg ${c.rps.toFixed(1)} req/s.`);
    lines.push(`- Builder tier ${money(c.builder)}/month; frontier rate ${money(c.frontier)}/month (listed for 100+ RPS; this workload averages ${c.rps.toFixed(1)} req/s, so that rate is a negotiation, not a given).`);
    return lines.join("\n");
  }

  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#memo").textContent); $("#copy").textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents($("#memo")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("#copy").textContent = "Selected, press copy"; }
    setTimeout(() => ($("#copy").textContent = "Copy"), 1800);
  });

  function renderBringBack() {
    const m = last?.m; if (!m) return;
    const el = $("#bringback");
    if (!m.misses.length) { el.textContent = "Log every query where the expected source missed the top 3 and bring that list to the team every week. Your last run had no misses."; return; }
    el.innerHTML = "Log every query where the expected source missed the top 3 and bring that list to Matthias and the team every week. From your last run:<br>" +
      m.misses.map((x) => `&middot; <b>${esc(x.q)}</b>: ${x.rank ? `${esc(x.matched)} at #${x.rank}` : "no expected source in the top 10"}`).join("<br>");
  }

  // ---------- radar ----------
  let radarLoaded = false, radar = [], radarKind = "all";
  async function loadRadar() {
    if (radarLoaded) return; radarLoaded = true;
    try {
      const [r, meta] = await Promise.all([fetch("/data/radar.json").then((x) => { if (!x.ok) throw 0; return x.json(); }), fetch("/data/radar.meta.json").then((x) => (x.ok ? x.json() : null)).catch(() => null)]);
      radar = Array.isArray(r) ? r : [];
      if (meta?.prepared_at) $("#radar-meta").textContent = `Prepared ${fmtTime(meta.prepared_at)}. ${meta.method || ""} Every provider claim links to the page it came from. First-touch notes are drafts for this demo; nothing was sent.`;
      const kinds = ["all", ...new Set(radar.map((x) => x.kind))];
      $("#radar-filter").innerHTML = kinds.map((k) => `<button class="chip" data-k="${esc(k)}" aria-pressed="${k === "all"}">${esc(k === "all" ? `All (${radar.length})` : k)}</button>`).join("");
      $("#radar-filter").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; radarKind = c.dataset.k; document.querySelectorAll("#radar-filter .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c))); drawRadar(); });
      drawRadar();
    } catch { radarLoaded = false; $("#radar-empty").hidden = false; }
  }
  function drawRadar() {
    const list = radar.filter((x) => radarKind === "all" || x.kind === radarKind);
    $("#radar").innerHTML = list.map((x) => `<article class="rc">
      <div class="kind">${esc(x.kind)} · <span class="play">${esc(x.play)}</span></div>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></h3>
      <div class="prov">${(x.search_today || []).length ? x.search_today.map((p) => `<span>${esc(p)}</span>`).join("") : `<span class="none">no built-in search</span>`}${x.keyless_fallback === true ? `<span>has a no-key option</span>` : ""}</div>
      <blockquote class="quote">"${esc(x.evidence)}" <a href="${esc(x.source)}" target="_blank" rel="noopener">source</a></blockquote>
      <div class="act"><b>Week one:</b> ${esc(x.week1_action)}</div>
      <div class="fine">${esc(x.why)}</div>
      <details><summary>First-touch draft</summary><div class="draft"><div class="lab">Draft, as I would write it in the role. Not sent.</div>${esc(x.first_touch)}</div></details>
    </article>`).join("");
  }

  // ---------- init ----------
  if (PRESETS.length) setPreset(PRESETS[0]);
  const h = location.hash.slice(1);
  if (["pilot", "radar", "week"].includes(h)) showTab(h);
})();
