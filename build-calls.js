/* build-calls.js — tracks/*.json 에서 전 선박 기항 이력을 집계해 calls.json 생성
 * 항구 좌표/명칭 사전은 index.html 에 내장된 PORTXY / LOCODE / CC 를 재사용한다(단일 출처 유지).
 */
const fs = require("fs");
const log = console.log;

function loadRef() {
  const h = fs.readFileSync("index.html", "utf8");
  const pxy = h.match(/const PORTXY=\{\};[\s\S]*?function destLatLng/);
  const dict = h.match(/const LOCODE=\{\}, CC=\{\};[\s\S]*?function destLegs/);
  if (!pxy || !dict) throw new Error("reference tables not found in index.html");
  const src = dict[0].replace("function destLegs", "") + pxy[0].replace("function destLatLng", "") +
              "; return {PORTXY:PORTXY, LOCODE:LOCODE, CC:CC};";
  return new Function("window", src)({});
}
function nmDist(a, b, c, d) {
  const R = 3440.065, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
function detectCalls(pts) {
  const out = []; let i = 0;
  const moving = (p, prev) => {
    if (p[3] != null) return p[3] >= 1.0;
    if (!prev) return true;
    const dt = (new Date(p[0]) - new Date(prev[0])) / 3600e3;
    return dt > 0 ? nmDist(prev[1], prev[2], p[1], p[2]) / dt >= 1.0 : true;
  };
  while (i < pts.length) {
    if (moving(pts[i], pts[i - 1])) { i++; continue; }
    const s = i; while (i < pts.length && !moving(pts[i], pts[i - 1])) i++;
    const e = i - 1;
    const hrs = (new Date(pts[e][0]) - new Date(pts[s][0])) / 3600e3;
    if (hrs < 2.5) continue;
    let la = 0, lo = 0, n = 0;
    for (let k = s; k <= e; k++) { la += pts[k][1]; lo += pts[k][2]; n++; }
    out.push({ from: pts[s][0], to: pts[e][0], hrs: +hrs.toFixed(1), lat: la / n, lon: lo / n });
  }
  return out;
}

(async () => {
  const ref = loadRef();
  let extra = [];
  try { extra = (JSON.parse(fs.readFileSync("ports-data.json", "utf8")).ports || []).filter(p => p.lat != null); } catch (e) {}
  const codes = Object.keys(ref.PORTXY);
  function nearest(la, lo) {
    let best = null, bd = 1e9;
    for (const k of codes) { const p = ref.PORTXY[k], d = nmDist(la, lo, p[0], p[1]); if (d < bd) { bd = d; best = { code: k, name: ref.LOCODE[k] || k, country: ref.CC[k.slice(0, 2)] || "", dist: d }; } }
    for (const p of extra) { const d = nmDist(la, lo, p.lat, p.lon); if (d < bd) { bd = d; best = { code: null, name: p.port, country: p.country || "", dist: d }; } }
    return best;
  }

  const files = fs.readdirSync("tracks").filter(f => f.endsWith(".json") && f !== "index.json");
  const calls = [];
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync("tracks/" + f, "utf8")); } catch (e) { continue; }
    const pts = d.points || []; if (pts.length < 3) continue;
    for (const c of detectCalls(pts)) {
      const np = nearest(c.lat, c.lon);
      if (!np || np.dist > 35) continue;
      calls.push({ v: d.name, key: d.key, port: np.name, country: np.country, code: np.code,
                   from: c.from, to: c.to, hrs: c.hrs, berth: np.dist <= 6, dist: +np.dist.toFixed(1) });
    }
  }
  calls.sort((a, b) => new Date(a.from) - new Date(b.from));

  const ports = {};
  for (const c of calls) {
    const k = c.port + (c.country ? " / " + c.country : "");
    if (!ports[k]) ports[k] = { port: c.port, country: c.country, n: 0, vessels: [], last: null };
    ports[k].n++;
    if (ports[k].vessels.indexOf(c.v) < 0) ports[k].vessels.push(c.v);
    if (!ports[k].last || c.from > ports[k].last) ports[k].last = c.from;
  }
  const out = { updated: new Date().toISOString(), vessels: files.length, count: calls.length,
                portCount: Object.keys(ports).length, ports, calls };
  fs.writeFileSync("calls.json", JSON.stringify(out));
  log(`calls: ${calls.length} port calls, ${Object.keys(ports).length} ports, from ${files.length} tracks`);
  Object.keys(ports).sort().slice(0, 8).forEach(k => log(`   ${k}  ${ports[k].n} calls, ${ports[k].vessels.length} vessels`));
})().catch(e => { log("calls error: " + e.message); process.exit(0); });
