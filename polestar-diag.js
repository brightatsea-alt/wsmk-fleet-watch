const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const log = console.log;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const TARGETS = [
  ["HL Success", 9490911, "636025665"], ["HLS Citrine", 9938585, "636021822"],
  ["Morning Cecilie", 9477830, "440367000"], ["Morning Cello", 9329461, "441390000"]
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
  log("##### TEST 1 - PAGINATION #####");
  const base = await get("/api/tmln/v2/cf/timeline/info", tok);
  const set0 = (base.body && base.body.tmlnInfoSet) || [];
  log("baseline HTTP " + base.status + " entries " + set0.length);
  log("top keys: " + JSON.stringify(Object.keys(base.body || {})));
  const base0 = set0.map((x) => norm(x.vesselName));
  for (const q of ["?page=2","?pageNumber=2","?offset=106","?skip=106","?limit=1000","?pageSize=1000","?top=1000"]) {
    try {
      const r = await get("/api/tmln/v2/cf/timeline/info" + q, tok);
      const arr = (r.body && r.body.tmlnInfoSet) || [];
      const extra = arr.map((x) => norm(x.vesselName)).filter((x) => base0.indexOf(x) < 0);
      log("  " + q + " HTTP " + r.status + " entries " + arr.length + (extra.length ? "  NEW: " + extra.join(",") : ""));
    } catch (e) { log("  " + q + " ERR " + e.message); }
  }
  log("");
  log("##### TEST 2 - DIRECT IMO #####");
  const sample = set0[0] || {};
  log("entry keys: " + JSON.stringify(Object.keys(sample)));
  log("accountId: " + sample.accountId);
  const minT = new Date(Date.now() - 30 * 864e5).toISOString();
  const maxT = new Date(Date.now() + 6e5).toISOString();
  for (const t of TARGETS) {
    log("");
    log("--- " + t[0] + " IMO " + t[1] + " ---");
    const shapes = [
      ["vesselIMO", { vesselIMO: t[1], minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["imo", { imo: t[1], minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["acct+imo", { accountId: sample.accountId, vesselIMO: t[1], minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }],
      ["mmsi", { vesselMMSI: t[2], minTimestamp: minT, maxTimestamp: maxT, limit: 50, tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" }]
    ];
    for (const s of shapes) {
      try {
        const r = await post("/api/tmln/v2/cf/timeline/extract", tok, { query: s[1] });
        const series = (r.body && r.body.series) || [];
        const withPos = series.filter((x) => x.lat != null);
        let note = "";
        if (withPos.length) { const L = withPos[withPos.length - 1];
          note = "  >>> " + withPos.length + " rows last " + L.timestamp + " @ " + L.lat + "," + L.lon; }
        else if (r.status >= 400) { note = "  " + String(JSON.stringify(r.body)).slice(0, 110); }
        log("   " + s[0] + " HTTP " + r.status + " series " + series.length + note);
      } catch (e) { log("   " + s[0] + " ERR " + e.message); }
      await new Promise((x) => setTimeout(x, 150));
    }
  }
  log("");
  log("##### TEST 3 - OTHER ENDPOINTS #####");
  for (const p of ["/api/tmln/v2/cf/vessels", "/api/tmln/v2/cf/timeline/entities", "/api/vessels", "/api/tmln/v2/cf/accounts"]) {
    try { const r = await get(p, tok);
      const b = r.body;
      const size = Array.isArray(b) ? b.length : (b && typeof b === "object" ? Object.keys(b).length : 0);
      log("  " + p + " HTTP " + r.status + " size " + size);
    } catch (e) { log("  " + p + " ERR"); }
  }
})().catch((e) => { log("FATAL " + e.message); process.exit(1); });
