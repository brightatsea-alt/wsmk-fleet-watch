/* polestar-probe.js v3 — extract 응답의 메트릭 필드명 확인 */
const fs = require("fs");
const BASE = "https://aviso-api.stratumfive.com";
const ID = process.env.POLESTAR_CLIENT_ID, SECRET = process.env.POLESTAR_CLIENT_SECRET;
const log = console.log;

async function getToken() {
  const r = await fetch(BASE + "/api/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, grant_type: "client_credentials", scope: "extract-by-imo:metrics" }).toString(),
  });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
async function api(p, tok, init = {}) {
  const r = await fetch(BASE + p, { ...init, headers: { authorization: "Bearer " + tok, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}

(async () => {
  const tok = await getToken();
  const info = await api("/api/tmln/v2/cf/timeline/info", tok);
  fs.writeFileSync("polestar-out-info-all.json", JSON.stringify(info.body, null, 2));
  const set = (info.body && info.body.tmlnInfoSet) || [];
  const spire = set.filter((x) => x.tmlnDatasource === "ais_spire");
  log("[1] 타임라인 " + set.length + "건 / ais_spire " + spire.length + "척");
  const byV = {};
  set.forEach((x) => { (byV[x.vesselName] = byV[x.vesselName] || []).push(x.tmlnDatasource); });
  log("    선박 " + Object.keys(byV).length + "척");
  const v = spire[0];
  log("    대상: " + v.vesselName + " IMO " + v.vesselIMO + " entityId " + v.entityId);
  log("    보유기간: " + v.tmlnStats.minTimestamp + " ~ " + v.tmlnStats.maxTimestamp + " (" + v.tmlnStats.totalTimestamps + "건)");

  const now = new Date(), min = new Date(Date.now() - 12 * 3600e3);
  const ex = await api("/api/tmln/v2/cf/timeline/extract", tok, {
    method: "POST",
    body: JSON.stringify({ query: { accountId: v.accountId, entityId: String(v.entityId), includeDebugInfo: false, limit: 3, minTimestamp: min.toISOString(), maxTimestamp: now.toISOString(), tmlnDatasource: "ais_spire", tmlnSeriesType: "ingested" } }),
  });
  log("\n[2] extract HTTP " + ex.status);
  fs.writeFileSync("polestar-out-extract.json", JSON.stringify(ex.body, null, 2));
  const txt = JSON.stringify(ex.body);
  log("    길이 " + txt.length);
  log("    ---- 원본 앞 1600자 ----");
  log("    " + txt.slice(0, 1600));
  const keys = [...new Set((txt.match(/"[a-zA-Z_][a-zA-Z0-9_.]{0,40}"\s*:/g) || []).map((k) => k.replace(/"\s*:/, "").replace(/"/g, "")))];
  log("    ---- 필드 " + keys.length + "개 ----");
  log("    " + keys.join(", ").slice(0, 1500));
})().catch((e) => { log("오류: " + e.message); process.exit(1); });
