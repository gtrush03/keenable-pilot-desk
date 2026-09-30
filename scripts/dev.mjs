// Local preview: bun scripts/dev.mjs  (serves public/ and api/*.js like Vercel)
import { file } from "bun";
const port = +process.env.PORT || 7431;
Bun.serve({ port, async fetch(req) {
  const u = new URL(req.url);
  if (u.pathname.startsWith("/api/")) {
    const mod = await import("../api/" + u.pathname.slice(5).replace(/[^a-z-]/g, "") + ".js").catch(() => null);
    if (!mod) return new Response("not found", { status: 404 });
    const body = req.method === "POST" ? await req.json().catch(() => null) : null;
    return await new Promise((resolve) => {
      const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(s) { resolve(new Response(s, { status: this.statusCode, headers: this.h })); } };
      mod.default({ method: req.method, body }, res);
    });
  }
  const p = "public" + (u.pathname === "/" ? "/index.html" : u.pathname);
  const f = file(p); return (await f.exists()) ? new Response(f) : new Response(file("public/404.html"), { status: 404 });
} });
console.log("http://127.0.0.1:" + port);
