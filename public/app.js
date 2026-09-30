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
    try {
      const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      let j = null; try { j = await r.json(); } catch {}
      if (!r.ok || !j || !j.rows) {
        const msg = r.status === 429 ? "Keenable's keyless pool is busy for this server right now (it allows 1,000 searches an hour per address)." :
          (j && j.message) || "The live run didn't come back.";
        failNotice(msg); status(""); return;
      }
      j.preset = preset.id === "custom" ? null : preset.id; j.label = preset.label; j.who = preset.who;
      j.queries = queries; j.prepared = false;
      render(j); status("");
      const fails = j.rows.flatMap((r) => r.runs).filter((x) => !x.ok).length;
      if (fails) notice(`${fails} of ${calls} searches didn't come back (busy or timed out); they're marked in the table and left out of the numbers.`);
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

  // ---------- metrics ----------
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
  const fmtTime = (iso) => { try { return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC"; } catch { return iso; } };
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;

  function metrics(j) {
    const m = { lat: {}, n: j.rows.length };
    for (const mode of j.modes) {
      const ms = j.rows.flatMap((r) => r.runs).filter((x) => x.mode === mode && x.ok).map((x) => x.ms);
      m.lat[mode] = { p50: pct(ms, 50), p95: pct(ms, 95), n: ms.length };
    }
    const primary = j.modes.includes("realtime") ? "realtime" : j.modes[0];
    m.primary = primary;
    const scored = j.rows.filter((r) => r.gold?.length);
    const pr = (r) => r.runs.find((x) => x.mode === primary && x.ok) || r.runs.find((x) => x.ok);
    m.scored = scored.filter((r) => pr(r)).length;
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
    html += tile("Expected source in top 3", m.scored ? `${m.top3}/${m.scored}` : "–", m.scored ? `top 1: ${m.top1} · top 10: ${m.top10} (${m.primary})` : "add | domains to score");
    html += tile("Crawl freshness", m.crawlAge != null ? `${m.crawlAge < 1 ? "<1" : Math.round(m.crawlAge)} d` : "–", "median age of the top-3 pages' crawl date");
    if (m.both != null && j.modes.length === 2) html += tile("realtime vs pro", `${m.same}/${m.both}`, "queries with the identical top-10 list");
    $("#score").innerHTML = html;

    const modes = j.modes;
    let t = `<thead><tr><th>Query</th><th>Expected source</th>${modes.map((x) => `<th>${x}</th>`).join("")}<th>Top results (${m.primary})</th></tr></thead><tbody>`;
    for (const r of j.rows) {
      const tag = (j.queries || []).find((q) => q.q === r.q)?.tag;
      const pr = r.runs.find((x) => x.mode === m.primary && x.ok) || r.runs.find((x) => x.ok);
      const rk = pr?.gold_rank;
      const rcls = !r.gold?.length || rk == null ? "na" : rk === 0 ? "bad" : rk <= 3 ? "good" : "mid";
      const rtxt = !r.gold?.length ? "not set" : rk == null ? "–" : rk === 0 ? "not in 10" : "#" + rk;
      t += `<tr><td><div class="q">${esc(r.q)}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</div><div class="fine">${esc((r.gold || []).join(", "))}</div></td>`;
      t += `<td><span class="rank ${rcls}">${rtxt}</span></td>`;
      for (const mode of modes) { const x = r.runs.find((y) => y.mode === mode); t += `<td class="num">${x?.ok ? x.ms + " ms" : `<span class="err">${esc(x?.error || "–")}</span>`}</td>`; }
      if (pr) {
        const items = pr.results.slice(0, 5).map((y, i) => `<li class="${pr.gold_rank === i + 1 ? "hit" : ""}"><a href="${esc(y.url)}" target="_blank" rel="noopener nofollow">${esc(y.title || y.url)}</a><div class="h">${esc(y.host)}${y.published_at ? " · published " + esc(y.published_at.slice(0, 10)) : ""}${y.acquired_at ? " · crawled " + esc(y.acquired_at.slice(0, 10)) : ""}</div></li>`).join("");
        t += `<td><div>${pr.results.slice(0, 3).map((y) => esc(y.host)).join(" · ") || "no results"}</div><details><summary>Top 5</summary><ol class="res">${items}</ol></details></td>`;
      } else t += `<td class="err">no results</td>`;
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
      tile("Frontier list price", money(c.frontier), c.rps >= 100 ? "$1 / 1k, qualifies at 100+ RPS" : "$1 / 1k needs 100+ RPS");
    if (last) $("#memo").textContent = memo(last);
  }
  ["#c-tasks", "#c-spt", "#c-fpt"].forEach((s) => $(s).addEventListener("input", renderCalc));

  function renderSnippet() {
    const q = last?.rows?.[0]?.q || "your query";
    const qt = last?.filters?.query_time ? `, "query_time": "${last.filters.query_time}"` : "";
    $("#snippet").textContent =
`# REST, keyed (docs.keenable.ai/api-reference/search)
curl -X POST https://api.keenable.ai/v1/search \\
  -H "X-API-Key: $KEENABLE_API_KEY" -H "Content-Type: application/json" \\
  -d '{"query": ${JSON.stringify(q)}, "mode": "realtime", "max_results": 10${qt}}'

# Any MCP agent (docs.keenable.ai/authentication)
claude mcp add keenable --transport http https://api.keenable.ai/mcp \\
  --header "X-API-Key: $KEENABLE_API_KEY"`;
  }

  function memo(j) {
    const m = j.m, c = calcNums(), L = m.lat;
    const lat = j.modes.map((x) => L[x].n ? `${x}: p50 ${L[x].p50} ms, p95 ${L[x].p95} ms (n=${L[x].n})` : `${x}: no successful calls`).join("; ");
    const rate = m.scored ? m.top3 / m.scored : 0;
    const lines = [];
    lines.push(`PILOT VERDICT: ${j.label || "Custom queries"}`);
    lines.push(`${fmtTime(j.ran_at)}${j.prepared ? " (prepared run)" : ""}`);
    lines.push(`Prospect: ${j.who || "custom"}`);
    lines.push(`Setup: ${j.rows.length} queries x ${j.modes.join(" + ")}, Keenable Search API (${j.auth}), server region ${j.region}${j.filters?.query_time ? `, index frozen at ${j.filters.query_time}` : ""}${j.filters?.published_after ? `, published after ${j.filters.published_after}` : ""}.`);
    lines.push("");
    lines.push("RESULTS");
    lines.push(`- Latency, end to end from the server: ${lat}.`);
    if (m.scored) lines.push(`- Expected source in the top 3: ${m.top3}/${m.scored} (top 1: ${m.top1}, top 10: ${m.top10}).`);
    if (m.crawlAge != null) lines.push(`- Crawl freshness: the top-3 pages were crawled a median ${m.crawlAge < 1 ? "under 1" : Math.round(m.crawlAge)} day(s) before the run.`);
    if (m.both) lines.push(`- realtime vs pro: identical top-10 on ${m.same}/${m.both} queries${m.same === m.both ? " on this tier; a keyed pilot should test whether pro changes the misses" : ""}.`);
    if (m.wins.length) { lines.push(""); lines.push("WHERE IT WINS"); m.wins.forEach((q) => lines.push(`- ${q}`)); }
    if (m.misses.length) {
      lines.push(""); lines.push("WHERE TO DIG IN (take to the search team)");
      m.misses.forEach((x) => lines.push(`- ${x.q}: ${x.rank ? `first expected source (${x.matched}) at #${x.rank}` : `none of ${x.gold.join(", ")} in the top 10`}; top 3 were ${x.got.join(", ")}`));
    }
    lines.push(""); lines.push("RECOMMENDATION");
    if (!m.scored) lines.push("- Add the domains an evaluator would expect to each query, then rerun to score it.");
    else if (rate >= 0.8) lines.push("- Ready: propose the pilot now. Lead with latency and the wins above.");
    else if (rate >= 0.5) lines.push("- Ready after prep: propose the pilot, but take the misses to the search team first so we raise them before the prospect does, and rerun them with a key in pro mode.");
    else lines.push("- Not yet: this set plays to competitors' strengths. Fix or explain the misses with the search team, rerun with a key in pro mode, then book the pilot.");
    lines.push(`- Pilot shape: 2 weeks on their own benchmark, index frozen with query_time so reruns match, success = expected-source@3 at least equal to their current provider, p95 under their latency budget, cost per 1,000 tasks.`);
    lines.push(""); lines.push("SIZE (list prices, keenable.ai/pricing)");
    lines.push(`- ${c.tasks.toLocaleString("en-US")} tasks/day x (${c.spt} searches + ${c.fpt} fetches) = ${(c.perMonth / 1e6).toFixed(1)}M requests/month, avg ${c.rps.toFixed(1)} req/s.`);
    lines.push(`- Builder tier ${money(c.builder)}/month; frontier tier ${money(c.frontier)}/month${c.rps >= 100 ? " (qualifies: 100+ RPS)" : ` (the frontier rate is listed for 100+ RPS; at ${c.rps.toFixed(0)} req/s this is a volume-commitment conversation)`}.`);
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
      <details><summary>First-touch draft</summary><div class="draft"><div class="lab">Draft, not sent</div>${esc(x.first_touch)}</div></details>
    </article>`).join("");
  }

  // ---------- init ----------
  if (PRESETS.length) setPreset(PRESETS[0]);
  const h = location.hash.slice(1);
  if (["pilot", "radar", "week"].includes(h)) showTab(h);
})();
