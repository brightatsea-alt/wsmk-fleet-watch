/* polestar-probe.js v2 — 응답 구조 및 메트릭 필드명 확인 */
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
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 150));
  return (await r.json()).access_token;
}
async function api(p, tok, init = {}) {
  const r = await fetch(BASE + p, { ...init, headers: { authorization: "Bearer " + tok, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}
/* imo 와 entityId 를 함께 가진 객체를 수집 */
function findVessels(n, out = [], d = 0) {
  if (!n || d > 7) return out;
  if (Array.isArray(n)) { n.forEach((x) => findVessels(x, out, d + 1)); return out; }
  if (typeof n === "object") {
    const s = JSON.stringify(n);
    const hasImo = /"[a-zA-Z]*[iI]mo[a-zA-Z]*"\s*:\s*"?\d{7}/.test(s);
    const hasEnt = /"entityId"/.test(s);
    if (hasImo && hasEnt && s.length < 3000) out.push(n);
    else Object.values(n).forEach((v) => findVessels(v, out, d + 1));
  }
  return out;
}

(async () => {
  const tok = await getToken();
  log("[1] 토큰 OK");

  const info = await api("/api/tmln/v2/cf/timeline/info", tok);
  fs.writeFileSync("polestar-out-info-all.json", JSON.stringify(info.body, null, 2));
  const b = info.body;
  log("[2] info HTTP " + info.status + " / 최상위: " + (Array.isArray(b) ? "array(" + b.length + ")" : Object.keys(b).join(",")));

  const vs = findVessels(b);
  log("    선박 객체 " + vs.length + "건 발견");
  log("    ---- 첫 번째 선박 원본 ----");
  log("    " + JSON.stringify(vs[0] || b).slice(0, 900));

  const s0 = JSON.stringify(vs[0] || {});
  const accountId = (JSON.stringify(b).match(/"accountId"\s*:\s*"([^"]+)"/) || [])[1];
  const entityId = (s0.match(/"entityId"\s*:\s*"?([^",}]+)"?/) || [])[1];
  const imo = (s0.match(/[iI]mo[a-zA-Z]*"\s*:\s*"?(\d{7})/) || [])[1];
  log("    accountId=" + accountId + " entityId=" + entityId + " imo=" + imo);

  if (!accountId || !entityId) { log("!! accountId/entityId 미확인"); return; }

  const now = new Date(), min = new Date(Date.now() - 36 * 3600e3);
  for (const ds of ["ais_spire", "inm_c"]) {
    const ex = await api("/api/tmln/v2/cf/timeline/extract", tok, {
      method: "POST",
      body: JSON.stringify({ query: { accountId, entityId, includeDebugInfo: false, limit: 3, minTimestamp: min.toISOString(), maxTimestamp: now.toISOString(), tmlnDatasource: ds, tmlnSeriesType: "ingested" } }),
    });
    log("\n[3] extract " + ds + " → HTTP " + ex.status);
    fs.writeFileSync("polestar-out-extract-" + ds + ".json", JSON.stringify(ex.body, null, 2));
    const txt = JSON.stringify(ex.body);
    log("    길이 " + txt.length + " bytes");
    log("    ---- 응답 원본 (앞 1400자) ----");
    log("    " + txt.slice(0, 1400));
    const keys = [...new Set((txt.match(/"[a-zA-Z_][a-zA-Z0-9_.]{1,40}"\s*:/g) || []).map((k) => k.replace(/"\s*:/, "").replace(/"/g, "")))];
    log("    ---- 필드명 " + keys.length + "개 ----");
    log("    " + keys.join(", ").slice(0, 1200));
    if (txt.length > 60) break;
  }
  log("\n완료 — 원본은 Artifacts(polestar-raw)에 저장됨");
})().catch((e) => { log("오류: " + e.message); process.exit(1); });
