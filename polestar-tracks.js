/* polestar-tracks.js — 선박별 과거 항적을 tracks/<key>.json 으로 누적 저장
 * 첫 실행: 최근 BACKFILL_DAYS 일 백필 / 이후: 마지막 지점 이후만 추가
 * 해상도: 1시간 간격으로 다운샘플, 보관 KEEP_DAYS 일
 */
const fs = require("fs");
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || "7", 10);
const KEEP_DAYS = parseInt(process.env.KEEP_DAYS || "30", 10);
const MIN_GAP_MIN = 55;
const log = console.log;
if (!ID || !SECRET) { log("tracks: not configured. skip."); process.exit(0); }

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
  return { ok: r.ok, status: r.status, body: b };
}
const col = (row, k) => { const c = (row.columns || []).find((x) => x.name === k); return c && c.value !== "" && c.value != null ? parseFloat(c.value) : null; };
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function fetchWindow(t, tok, fromMs, toMs) {
  const out = [];
  let cur = fromMs;
  while (cur < toMs) {
    const end = Math.min(cur + 5 * 864e5, toMs);
    const ex = await api("/api/tmln/v2/cf/timeline/extract", tok, { method: "POST", body: JSON.stringify({ query: {
      accountId: t.accountId, entityId: String(t.entityId), includeDebugInfo: false, limit: 2000,
      minTimestamp: new Date(cur).toISOString(), maxTimestamp: new Date(end).toISOString(),
      tmlnDatasource: t.tmlnDatasource, tmlnSeriesType: "ingested" } }) });
    const s = (ex.body && ex.body.series) || [];
    s.forEach((r) => { if (r.lat != null && r.lon != null) out.push(r); });
    cur = end;
    await new Promise((z) => setTimeout(z, 120));
  }
  return out;
}

(async () => {
  const tok = await getToken();
  const info = await api("/api/tmln/v2/cf/timeline/info", tok);
  if (!info.ok) { log("tracks: info " + info.status); process.exit(0); }
  const set = (info.body && info.body.tmlnInfoSet) || [];

  const best = {};
  set.filter((x) => ["ais_spire", "inm_c"].includes(x.tmlnDatasource)).forEach((x) => {
    const k = norm(x.vesselName);
    const mx = new Date((x.tmlnStats && x.tmlnStats.maxTimestamp) || 0).getTime();
    const score = (x.tmlnDatasource === "ais_spire" ? 1e13 : 0) + mx;
    if (!best[k] || score > best[k]._score) best[k] = { ...x, _score: score };
  });
  const fleet = JSON.parse(fs.readFileSync("fleet.json", "utf8")).vessels || [];
  const byName = {}; fleet.forEach((v) => { byName[norm(v.name.split("(")[0])] = v; });

  if (!fs.existsSync("tracks")) fs.mkdirSync("tracks");
  const now = Date.now(), keepFrom = now - KEEP_DAYS * 864e5;
  const index = {};
  let done = 0, added = 0;

  for (const t of Object.values(best)) {
    const mine = byName[norm(t.vesselName)];
    if (!mine) continue;
    const key = mine.mmsi || String(t.vesselIMO);
    const file = "tracks/" + key + ".json";
    let prev = { points: [] };
    try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
    const pts = (prev.points || []).filter((p) => new Date(p[0]).getTime() >= keepFrom);
    const lastMs = pts.length ? new Date(pts[pts.length - 1][0]).getTime() : 0;
    const from = lastMs ? Math.max(lastMs + 6e4, now - 3 * 864e5) : now - BACKFILL_DAYS * 864e5;

    try {
      const rows = await fetchWindow(t, tok, from, now + 6e5);
      rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let lastKeep = lastMs;
      for (const r of rows) {
        const ms = new Date(r.timestamp).getTime();
        if (ms - lastKeep < MIN_GAP_MIN * 6e4) continue;
        pts.push([r.timestamp.slice(0, 19) + "Z", +r.lat.toFixed(4), +r.lon.toFixed(4),
                  col(r, "sensor.sog"), col(r, "sensor.course")]);
        lastKeep = ms; added++;
      }
      fs.writeFileSync(file, JSON.stringify({ key, imo: t.vesselIMO, name: mine.name, updated: new Date().toISOString(), points: pts }));
      index[key] = { name: mine.name, n: pts.length, first: pts.length ? pts[0][0] : null, last: pts.length ? pts[pts.length - 1][0] : null };
      done++;
    } catch (e) { log("tracks: " + mine.name + " failed - " + e.message); }
  }
  fs.writeFileSync("tracks/index.json", JSON.stringify({ updated: new Date().toISOString(), keepDays: KEEP_DAYS, vessels: index }, null, 1));
  log(`tracks: ${done} vessels, +${added} points`);
})().catch((e) => { log("tracks error: " + e.message); process.exit(0); });
