/* polestar-collect.js — Pole Star(StratumFive) Spire 위성 AIS 위치 수집
 * 결과를 fleet-positions.json 에 병합한다. (무료 AIS 수집기 collect.js 실행 후에 동작)
 * 필요 Secrets: POLESTAR_CLIENT_ID, POLESTAR_CLIENT_SECRET
 * 미설정 시 조용히 종료하므로 기존 파이프라인에 영향이 없다.
 */
const fs = require("fs");
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const log = console.log;
if (!ID || !SECRET) { log("polestar: not configured. skip."); process.exit(0); }

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function getToken() {
  const r = await fetch(BASE + "/api/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, grant_type: "client_credentials", scope: "extract-by-imo:metrics" }).toString(),
  });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).access_token;
}
async function api(p, tok, init = {}) {
  const r = await fetch(BASE + p, { ...init, headers: { authorization: "Bearer " + tok, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}
const col = (row, key) => {
  const c = (row.columns || []).find((x) => x.name === key);
  return c && c.value != null && c.value !== "" ? parseFloat(c.value) : null;
};

(async () => {
  const tok = await getToken();
  const info = await api("/api/tmln/v2/cf/timeline/info", tok);
  if (!info.ok) { log("polestar: info " + info.status); process.exit(0); }
  const set = (info.body && info.body.tmlnInfoSet) || [];

  // 선박별로 ais_spire 우선, 최신 데이터가 있는 타임라인 선택
  const best = {};
  set.filter((x) => x.tmlnDatasource === "ais_spire" || x.tmlnDatasource === "inm_c").forEach((x) => {
    const k = norm(x.vesselName);
    const maxT = new Date(x.tmlnStats && x.tmlnStats.maxTimestamp || 0).getTime();
    const score = (x.tmlnDatasource === "ais_spire" ? 1e13 : 0) + maxT;
    if (!best[k] || score > best[k]._score) best[k] = { ...x, _score: score, _maxT: maxT };
  });
  const targets = Object.values(best);
  log(`polestar: ${targets.length} vessels in account`);

  // 선대 명부(이름 → MMSI) 매핑
  const fleet = JSON.parse(fs.readFileSync("fleet.json", "utf8")).vessels || [];
  const byName = {};
  fleet.forEach((v) => { byName[norm(v.name.split("(")[0])] = v; });

  const now = new Date(), min = new Date(Date.now() - 24 * 3600e3);
  const out = {};
  let ok = 0, skip = 0;

  for (const t of targets) {
    const key = norm(t.vesselName);
    const mine = byName[key];
    if (!mine) { skip++; continue; }
    if (Date.now() - t._maxT > 7 * 864e5) { skip++; continue; }
    try {
      const ex = await api("/api/tmln/v2/cf/timeline/extract", tok, {
        method: "POST",
        body: JSON.stringify({ query: {
          accountId: t.accountId, entityId: String(t.entityId), includeDebugInfo: false, limit: 1,
          minTimestamp: min.toISOString(), maxTimestamp: now.toISOString(),
          tmlnDatasource: t.tmlnDatasource, tmlnSeriesType: t.tmlnSeriesType || "ingested",
        } }),
      });
      const series = (ex.body && ex.body.series) || [];
      if (!ex.ok || !series.length) { skip++; continue; }
      const r = series[series.length - 1];
      if (r.lat == null || r.lon == null) { skip++; continue; }
      out[mine.mmsi || String(t.vesselIMO)] = {
        mmsi: mine.mmsi || null, imo: t.vesselIMO, name: mine.name,
        lat: r.lat, lon: r.lon,
        sog: col(r, "sensor.sog"), cog: col(r, "sensor.course"),
        heading: col(r, "sensor.heading"),
        lastReceived: r.timestamp, source: "polestar:" + t.tmlnDatasource,
      };
      ok++;
    } catch (e) { skip++; }
    await new Promise((s) => setTimeout(s, 120));
  }

  log(`polestar: ${ok} positions collected (skipped ${skip})`);
  fs.writeFileSync("polestar-positions.json", JSON.stringify({ updated: new Date().toISOString(), count: ok, vessels: out }, null, 1));

  // fleet-positions.json 병합 — Pole Star 가 더 최신이면 덮어쓴다
  let store = { vessels: {} };
  try { store = JSON.parse(fs.readFileSync("fleet-positions.json", "utf8")); } catch (e) {}
  store.vessels = store.vessels || {};
  let merged = 0;
  for (const [mmsi, p] of Object.entries(out)) {
    const cur = store.vessels[mmsi];
    const curT = cur ? new Date(cur.lastReceived || 0).getTime() : 0;
    const newT = new Date(p.lastReceived).getTime();
    if (newT > curT) {
      store.vessels[mmsi] = { ...(cur || {}), ...p,
        destination: (cur && cur.destination) || undefined,
        eta: (cur && cur.eta) || undefined,
        navStatus: (cur && cur.navStatus) != null ? cur.navStatus : undefined };
      merged++;
    }
  }
  store.updated = new Date().toISOString();
  store.polestarUpdated = new Date().toISOString();
  fs.writeFileSync("fleet-positions.json", JSON.stringify(store, null, 1));
  log(`polestar: merged ${merged} into fleet-positions.json (total ${Object.keys(store.vessels).length})`);
})().catch((e) => { log("polestar error: " + e.message); process.exit(0); });
