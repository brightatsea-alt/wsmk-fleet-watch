/* polestar-probe.js — Pole Star(StratumFive) Podium API 연결 확인용 (GitHub Actions에서 실행)
 * 비밀정보는 화면에 출력하지 않습니다. 토큰도 앞 12자만 표시합니다.
 */
const fs = require("fs");
const BASE = "https://aviso-api.stratumfive.com";
const TOKEN_URL = BASE + "/api/identity/connect/token";
const SCOPE = "extract-by-imo:metrics";
const ID = process.env.POLESTAR_CLIENT_ID;
const SECRET = process.env.POLESTAR_CLIENT_SECRET;

const line = (s = "") => console.log(s);
const save = (n, o) => { try { fs.writeFileSync(`polestar-out-${n}.json`, JSON.stringify(o, null, 2)); } catch (e) {} };

async function getToken() {
  const f = { client_id: ID, client_secret: SECRET, grant_type: "client_credentials", scope: SCOPE };
  let how = "urlencoded";
  let r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString(),
  });
  if (!r.ok) {
    const first = `${r.status} ${(await r.text()).slice(0, 150)}`;
    line(`   (urlencoded 방식 실패: ${first} → form-data 방식으로 재시도)`);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    r = await fetch(TOKEN_URL, { method: "POST", body: fd });
    how = "form-data";
    if (!r.ok) throw new Error(`토큰 발급 실패 (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error("응답에 access_token 없음: " + JSON.stringify(j).slice(0, 200));
  return { ...j, how };
}

async function api(path, token, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}

/* 응답 구조를 모르므로 재귀 탐색으로 선박 식별자를 모은다 */
function harvest(node, acc, depth = 0) {
  if (!node || depth > 6) return acc;
  if (Array.isArray(node)) { node.forEach((n) => harvest(n, acc, depth + 1)); return acc; }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v);
        if (key.includes("imo") && /^\d{7}$/.test(s)) acc.imo.add(s);
        else if (key === "name" || key.includes("vesselname") || key.includes("shipname")) acc.name.add(s);
        else if (key.includes("entityid")) acc.entity.add(s);
        else if (key.includes("accountid")) acc.account.add(s);
        else if (key.includes("seriestype")) acc.series.add(s);
        else if (key.includes("datasource")) acc.ds.add(s);
      } else harvest(v, acc, depth + 1);
    }
  }
  return acc;
}

(async () => {
  line("===== Pole Star Podium API 연결 확인 =====");
  if (!ID || !SECRET) {
    line("❌ GitHub Secrets 에 POLESTAR_CLIENT_ID / POLESTAR_CLIENT_SECRET 이 없습니다.");
    line("   Settings → Secrets and variables → Actions 에서 두 개를 등록한 뒤 다시 실행하세요.");
    process.exit(1);
  }
  try {
    line("\n[1] 토큰 발급");
    const t = await getToken();
    line(`   ✅ 성공 — 방식: ${t.how} · 유효 ${Math.round((t.expires_in || 0) / 60)}분 · 토큰 ${String(t.access_token).slice(0, 12)}…`);

    line("\n[2] 계정에 등록된 선박/타임라인 조회");
    const all = await api("/api/tmln/v2/cf/timeline/info", t.access_token);
    line(`   HTTP ${all.status}`);
    save("info-all", all.body);

    if (!all.ok) {
      line("   ⚠ 조회 실패 — 응답: " + JSON.stringify(all.body).slice(0, 400));
      line("   (403 이면 이 계정에 timeline 조회 권한이 없을 수 있습니다. Pole Star 확인 필요)");
    } else {
      const acc = harvest(all.body, { imo: new Set(), name: new Set(), entity: new Set(), account: new Set(), series: new Set(), ds: new Set() });
      line(`   ✅ 응답 수신 (${JSON.stringify(all.body).length} bytes)`);
      line("");
      line(`   ■ 선박 수(IMO 기준): ${acc.imo.size} 척`);
      line(`   ■ entityId 수      : ${acc.entity.size}`);
      line(`   ■ accountId        : ${[...acc.account].join(", ") || "미확인"}`);
      line(`   ■ seriesType       : ${[...acc.series].join(", ") || "미확인"}`);
      line(`   ■ datasource       : ${[...acc.ds].join(", ") || "미확인"}`);
      if (acc.imo.size) { const l = [...acc.imo]; line(`   ■ IMO 목록 (${l.length}): ${l.slice(0, 60).join(", ")}`); }
      if (acc.name.size) { const n = [...acc.name]; line(`   ■ 선박명 (${n.length}): ${n.slice(0, 60).join(", ")}`); }
      if (!acc.imo.size && !acc.name.size) {
        line("   ※ 선박 식별자를 찾지 못했습니다. 응답 앞부분:");
        line("   " + JSON.stringify(all.body).slice(0, 600));
      }
      line("");
      line("   ▶ 우리 관리 선대는 56척입니다. 위 숫자와 비교하면 계약 범위를 알 수 있습니다.");
    }

    line("\n[3] 판정");
    line("   토큰 발급이 성공했다면 API 연동은 가능합니다.");
    line("   전체 원본 응답은 Artifacts(polestar-raw)에서 내려받을 수 있습니다.");
    line("\n===== 완료 =====");
  } catch (e) {
    line("\n❌ 오류: " + e.message);
    line("   400 → Client ID/Secret 오타 · 401 → 토큰 문제 · 403 → 권한(scope) 문제");
    process.exit(1);
  }
})();
