import { keyed } from "./_lib/keenable.js";
export default function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, auth: keyed() ? "api key" : "keyless public endpoint", region: process.env.VERCEL_REGION || "local" }));
}
