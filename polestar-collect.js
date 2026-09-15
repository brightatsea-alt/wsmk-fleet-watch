/* polestar-collect.js v3 — Pole Star(StratumFive) 위성/지상 AIS 최신 위치 수집
 * v3: 데이터소스·시리즈타입 제한 제거, 7일 컷오프 완화, 미매칭 선박 진단 로그 추가
 * 주의: extract 는 기간 내 "오래된 순"으로 반환하므로, 여러 건을 받아 최신 1건을 고른다.
 */
const fs = require("fs");
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const log = console.log;
if (!ID || !SECRET) { log("polestar: not configured. skip."); process.exit(0); }
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function getToken() {
  const r = await fetch(BASE + "/api/identity/connect/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, grant_type: "client_credentials", scope: "extract-by-imo:metrics" }).toString() });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
async function api(p, tok, init = {}) {
  const r = await fetch(BASE + p, { ...init, headers: { authorization: "Bearer " + tok, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}
const col = (row, key) => { const c = (row.columns || []).find((x) => x.name === key); return c && c.value !== "" && c.value != null ? parseFloat(c.value) : null; };

async function latest(t, tok) {
  /* Pole Star 위치 폴링 주기 6h — 3h 창은 대부분 비어 있어 8h 부터 시작 */
  for (const [hrs, lim] of [[8, 200], [24, 500], [72, 800], [24 * 14, 1000], [24 * 60, 1000]]) {
    const ex = await api("/api/tmln/v2/cf/timeline/extract", tok, { method: "POST", body: JSON.stringify({ query: {
      accountId: t.accountId, entityId: String(t.entityId), includeDebugInfo: false, limit: lim,
      minTimestamp: new Date(Date.now() - hrs * 3600e3).toISOString(), maxTimestamp: new Date(Date.now() + 6e5).toISOString(),
      tmlnDatasource: t.tmlnDatasource, tmlnSeriesType: t.tmlnSeriesType || "ingested" } }) });
    if (!ex.ok) { if (hrs === 3) log("  extract " + t.vesselName + " HTTP " + ex.status + " " + String(JSON.stringify(ex.body)).slice(0, 120)); }
    const s = (ex.body && ex.body.series) || [];
    const valid = s.filter((r) => r.lat != null && r.lon != null);
    if (valid.length) return valid.reduce((a, b) => (new Date(b.timestamp) > new Date(a.timestamp) ? b : a));
  }
  return null;
}

(async () => {
  const tok = await getToken();
  const info = await api("/api/tmln/v2/cf/timeline/info", tok);
  if (!info.ok) { log("polestar: info " + info.status); process.exit(0); }
  const set = (info.body && info.body.tmlnInfoSet) || [];
  /* 진단: 계정이 반환하는 데이터소스/시리즈타입 분포 */
  const dsCount = {}, stCount = {};
  set.forEach((x) => { dsCount[x.tmlnDatasource] = (dsCount[x.tmlnDatasource] || 0) + 1;
                       stCount[x.tmlnSeriesType] = (stCount[x.tmlnSeriesType] || 0) + 1; });
  log("polestar: tmlnInfoSet " + set.length + " entries | datasource " + JSON.stringify(dsCount) + " | seriesType " + JSON.stringify(stCount));

  /* v3: 데이터소스를 제한하지 않는다. 우선순위만 둔다 (위성 > 기타 > 최신) */
  const PRIO = { ais_spire: 3e13, ais_terrestrial: 1e13, inm_c: 2e13 };
  const best = {};
  set.forEach((x) => {
    const k = norm(x.vesselName);
    const maxT = new Date((x.tmlnStats && x.tmlnStats.maxTimestamp) || 0).getTime();
    const score = (PRIO[x.tmlnDatasource] || 0) + maxT;
    if (!best[k] || score > best[k]._score) best[k] = { ...x, _score: score, _maxT: maxT };
  });
  const targets = Object.values(best);
  const fleet = JSON.parse(fs.readFileSync("fleet.json", "utf8")).vessels || [];
  const byName = {}; fleet.forEach((v) => { byName[norm(v.name.split("(")[0])] = v; });
  log(`polestar: ${targets.length} vessels in account`);

  /* 진단: 우리 선대인데 계정 목록에 없는 선박 */
  const notReturned = fleet.filter((v) => !best[norm(v.name.split("(")[0])]);
  if (notReturned.length) log("polestar: NOT in tmlnInfoSet (" + notReturned.length + "): " + notReturned.map((v) => v.name).join(", "));
  const notOurs = targets.filter((t) => !byName[norm(t.vesselName)]);
  if (notOurs.length) log("polestar: returned but not in fleet.json (" + notOurs.length + "): " + notOurs.map((t) => t.vesselName).join(", "));

  const out = {}; let ok = 0, skip = 0, fresh = 0, stale = 0;
  for (const t of targets) {
    const mine = byName[norm(t.vesselName)];
    if (!mine) { skip++; continue; }
    /* v3: 7일 → 60일. 오래된 데이터라도 마지막 위치는 확보한다 */
    if (t._maxT && Date.now() - t._maxT > 60 * 864e5) { stale++; continue; }
    try {
      const r = await latest(t, tok);
      if (!r) { skip++; continue; }
      const ageH = (Date.now() - new Date(r.timestamp).getTime()) / 3600e3;
      if (ageH < 8) fresh++;   /* 폴링 1주기 이내 */
      out[mine.mmsi || String(t.vesselIMO)] = { mmsi: mine.mmsi || null, imo: t.vesselIMO, name: mine.name,
        lat: r.lat, lon: r.lon, sog: col(r, "sensor.sog"), cog: col(r, "sensor.course"), heading: col(r, "sensor.heading"),
        lastReceived: r.timestamp, source: "polestar:" + t.tmlnDatasource };
      ok++;
    } catch (e) { skip++; }
    await new Promise((s) => setTimeout(s, 100));
  }
  log(`polestar: ${ok} positions (${fresh} within 8h = 1 polling cycle), skipped ${skip}, stale>60d ${stale}`);
  fs.writeFileSync("polestar-positions.json", JSON.stringify({ updated: new Date().toISOString(), count: ok, fresh, vessels: out }, null, 1));

  let store = { vessels: {} };
  try { store = JSON.parse(fs.readFileSync("fleet-positions.json", "utf8")); } catch (e) {}
  store.vessels = store.vessels || {};
  let merged = 0;
  for (const [mmsi, p] of Object.entries(out)) {
    const cur = store.vessels[mmsi] || {};
    if (new Date(p.lastReceived).getTime() > new Date(cur.lastReceived || 0).getTime()) {
      store.vessels[mmsi] = { ...cur, ...p, destination: cur.destination, eta: cur.eta, navStatus: cur.navStatus };
      merged++;
    }
  }
  store.updated = new Date().toISOString(); store.polestarUpdated = new Date().toISOString();
  fs.writeFileSync("fleet-positions.json", JSON.stringify(store, null, 1));
  log(`polestar: merged ${merged} (store total ${Object.keys(store.vessels).length})`);
})().catch((e) => { log("polestar error: " + e.message); process.exit(0); });
