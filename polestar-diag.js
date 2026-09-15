/* polestar-diag2.js */
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const log = console.log;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const TARGETS = [
  ["HL Success", 9490911, "636025665"], ["HLS Citrine", 9938585, "636021822"],
  ["Morning Cecilie", 9477830, "440367000"], ["Morning Cello", 9329461, "441390000"],
  ["Morning Chorus", 9312834, "440093000"], ["Morning Cornelia", 9519145, "440797000"],
  ["Morning Crystal", 9574080, "441320000"], ["Morning Linda", 9383106, "370567000"],
  ["Morning Pilot", 9669031, "538005521"], ["Morning Post", 9669029, "538005452"]
];
async function token() {
  const r = await fetch(BASE + "/api/identity/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET,
      grant_type: "client_credentials", scope: "extract-by-imo:metrics" }).toString() });
  const j = await r.json();
  if (!j.access_token) throw new Error("token " + r.status);
  return j.access_token;
}
async function get(path, tok) {
  const r = await fetch(BASE + path, { headers: { Authorization: "Bearer " + tok, Accept: "application/json" } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, body: b };
}
async function post(path, tok, payload) {
  const r = await fetch(BASE + path, { method: "POST",
    headers: { Authorization: "Bearer " + tok, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload) });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, body: b };
}
(async () => {
  const tok = await token();
  log("########## TEST 1 - PAGINATION ##########");
  const base = await get("/api/tmln/v2/cf/timeline/info", tok);
  const set0 = (base.body && base.body.tmlnInfoSet) || [];
  log("baseline: HTTP " + base.status + " entries " + set0.length);
  log("top-level keys: " + JSON.stringify(Object.keys(base.body || {})));
  const base0 = set0.map((x) => norm(x.vesselName));
  const variants = ["?page=2","?pageNumber=2","?offset=106","?skip=106","?limit=1000","?pageSize=1000","?top=1000"];
  for (const q of variants) {
    try {
      const r = await get("/api/tmln/v2/cf/timeline/info" + q, tok);
      const arr = (r.body && r.body.tmlnInfoSet) || [];
      const extra = arr.map((x) => norm(x.vesselName)).filter((x) => !base0.includes(x));
      log("  " + q.padEnd(18) + " HTTP " + r.status + "  entries " + arr.length + (extra.length ? "  NEW: " + [...new Set(extra)].join(", ") : ""));
    } catch (e) { log("  " + q + " ERR " + e.message); }
  }
  log("");
  log("########## TEST 2 - DIRECT IMO EXTRACT ##########");
  const sample = set0[0] || {};
  log("entry keys: " + JSON.stringify(Object.keys(sample)));
  log("accountId: " + sample.accountId);
  const minT = new Date(Date.now() - 30 * 864e5).toISOString();
  const maxT = new Date(Date.now() + 6e5).toISOString();
  for (const [name, imo, mmsi] of TARGETS.slice(0, 4)) {
    log("");
    log("--- " + name + " (IMO " + imo + ") ---");
    const shapes = [
      ["vesselIMO", { vesselIMO: imo, minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["imo",       { imo: imo, minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["acct+imo",  { accountId: sample.accountId, vesselIMO: imo, minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["mmsi",      { vesselMMSI: mmsi, minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }]
    ];
    for (const [label, q] of shapes) {
      try {
        const r = await post("/api/tmln/v2/cf/timeline/extract", tok, { query: q });
        const series = (r.body && r.body.series) || [];
        const withPos = series.filter((x) => x.lat != null);
        let note = "";
        if (withPos.length) { const last = withPos[withPos.length - 1];
          note = "  >>> " + withPos.length + " rows, last " + last.timestamp + " @ " + last.lat + "," + last.lon; }
        else if (r.status >= 400) { note = "  " + String(JSON.stringify(r.body)).slice(0, 110); }
        log("   " + label.padEnd(10) + " HTTP " + r.status + "  series " + series.length + note);
      } catch (e) { log("   " + label + " ERR " + e.message); }
      await new Promise((x) => setTimeout(x, 150));
    }
  }
  log("");
  log("########## TEST 3 - OTHER ENDPOINTS ##########");
  for (const p of ["/api/tmln/v2/cf/vessels", "/api/tmln/v2/cf/timeline/entities", "/api/vessels", "/api/tmln/v2/cf/accounts"]) {
    try { const r = await get(p, tok);
      const b = r.body;
      const size = Array.isArray(b) ? b.length : (b && typeof b === "object" ? Object.keys(b).length : 0);
      log("  " + p.padEnd(40) + " HTTP " + r.status + "  " + (size ? "len " + size : ""));
    } catch (e) { log("  " + p + " ERR"); }
  }
})().catch((e) => { log("FATAL " + e.message); process.exit(1); });
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
