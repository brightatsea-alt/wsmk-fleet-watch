/* polestar-diag.js — 계정이 반환하는 전체 타임라인 목록 진단 */
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const fs = require("fs"), log = console.log;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function token() {
  const r = await fetch(BASE + "/api/identity/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET,
      grant_type: "client_credentials", scope: "extract-by-imo:metrics" }).toString() });
  const j = await r.json();
  if (!j.access_token) throw new Error("token failed " + r.status);
  return j.access_token;
}

(async () => {
  const tok = await token();
  const r = await fetch(BASE + "/api/tmln/v2/cf/timeline/info", { headers: { Authorization: "Bearer " + tok } });
  const body = await r.json();
  const set = body.tmlnInfoSet || [];
  log("HTTP " + r.status + " | tmlnInfoSet entries: " + set.length);

  const ds = {}, st = {};
  set.forEach((x) => { ds[x.tmlnDatasource] = (ds[x.tmlnDatasource] || 0) + 1;
                       st[x.tmlnSeriesType] = (st[x.tmlnSeriesType] || 0) + 1; });
  log("datasource: " + JSON.stringify(ds));
  log("seriesType: " + JSON.stringify(st));

  const fleet = JSON.parse(fs.readFileSync("fleet.json", "utf8")).vessels || [];
  const byName = {}; fleet.forEach((v) => { byName[norm(v.name.split("(")[0])] = v; });
  const seen = {};
  set.forEach((x) => {
    const k = norm(x.vesselName);
    const t = new Date((x.tmlnStats && x.tmlnStats.maxTimestamp) || 0).getTime();
    if (!seen[k] || t > seen[k].t) seen[k] = { name: x.vesselName, imo: x.vesselIMO,
      ds: x.tmlnDatasource, st: x.tmlnSeriesType, t: t };
  });

  log("\n=== ACCOUNT RETURNS (" + Object.keys(seen).length + " unique vessels) ===");
  Object.values(seen).sort((a, b) => a.name.localeCompare(b.name)).forEach((v) => {
    const age = v.t ? ((Date.now() - v.t) / 86400000).toFixed(1) + "d" : "no data";
    const mine = byName[norm(v.name)] ? "" : "   [NOT IN OUR FLEET]";
    log(`  ${v.name.padEnd(26)} IMO ${String(v.imo).padEnd(9)} ${v.ds.padEnd(12)} ${String(v.st).padEnd(10)} last ${age}${mine}`);
  });

  const missing = fleet.filter((v) => !seen[norm(v.name.split("(")[0])]);
  log("\n=== OUR FLEET NOT RETURNED BY API (" + missing.length + ") ===");
  missing.forEach((v) => log(`  ${v.name.padEnd(26)} MMSI ${v.mmsi || "-"}`));

  const stale = Object.values(seen).filter((v) => Date.now() - v.t > 7 * 864e5);
  log("\n=== RETURNED BUT SKIPPED BY OUR 7-DAY FILTER (" + stale.length + ") ===");
  stale.forEach((v) => log(`  ${v.name.padEnd(26)} last ${((Date.now() - v.t) / 86400000).toFixed(0)}d ago`));
})().catch((e) => { log("ERROR " + e.message); process.exit(1); });
