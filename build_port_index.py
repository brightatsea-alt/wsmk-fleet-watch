#!/usr/bin/env python3
"""WSMK Port Information Indexer
Google Drive의 Port Info Data File.csv를 내려받아 항구별/국가별로 분류하고
지도 좌표를 붙여 ports-data.json 생성. 실패 시 기존 파일 유지."""
import csv, io, json, sys, urllib.request, re

CSV_URL = "https://drive.google.com/uc?export=download&id=1J_wLASiqcbjcWnYNGJprjgjBbDUi0OOD"
OUT = "ports-data.json"

# 항구 좌표 (isC: 국가/광역 단위 항목 여부)
C = {
"singapore ports":(1.32,103.82,1),
"singapore strait":(1.16,103.90,0),"singapore strait (phillip channel)":(1.06,103.72,0),
"singapore strait (phillip channel/eb lane)":(1.10,103.70,0),"singapore strait (eb lane)":(1.18,104.10,0),
"singapore strait (eb lane/off pulau cula)":(1.18,104.20,0),"singapore strait (off pulau cula)":(1.21,104.18,0),
"singapore strait (off pulau nongsa/cula)":(1.18,104.15,0),"phillip channel":(1.10,103.70,0),
"malacca & singapore straits":(1.60,102.80,0),
"tianjin":(38.98,117.75,0),"fujairah":(25.15,56.35,0),"usa ports":(38.0,-97.0,1),
"lome":(6.13,1.28,0),"panjang":(-5.45,105.30,0),"chattogram":(22.30,91.80,0),
"kutubdia":(21.85,91.85,0),"luanda":(-8.79,13.23,0),"lagos":(6.44,3.39,0),
"lagos (tin can island)":(6.43,3.33,0),
"suez canal":(30.45,32.35,0),"hong kong":(22.30,114.17,0),"beibu gulf":(20.5,108.5,0),
"zhoushan":(29.99,122.21,0),"kurushima kaikyo":(34.12,132.99,0),"conakry":(9.51,-13.71,0),
"panama canal":(9.08,-79.68,0),"kuala tanjung":(3.37,99.45,0),"balikpapan":(-1.27,116.83,0),
"china ports":(32.0,118.0,1),"chinese ports":(32.0,118.0,1),"china, all ports":(32.0,118.0,1),
"akashi kaikyo":(34.62,135.02,0),"korean ports":(35.5,128.5,1),
"port hedland":(-20.31,118.58,0),"dampier":(-20.66,116.71,0),"dampier port":(-20.66,116.71,0),
"ashburton / dampier":(-21.0,115.5,0),"ashburton / dampier / varanus":(-21.0,115.6,0),
"varanus island":(-20.65,115.58,0),"manila":(14.58,120.97,0),"manila bay":(14.55,120.85,0),
"batam":(1.13,104.05,0),"kandla":(23.03,70.22,0),"haldia":(22.03,88.06,0),
"callao":(-12.05,-77.15,0),"macapa":(0.03,-51.05,0),"takoradi":(4.89,-1.75,0),
"bremerhaven":(53.55,8.58,0),"australian ports":(-25.0,134.0,1),"santos":(-23.95,-46.33,0),
"sulu-celebes seas":(5.5,120.5,0),"pulau mungging":(1.37,104.10,0),"mokha":(13.32,43.25,0),
"port-au-prince":(18.55,-72.35,0),"georgetown":(6.82,-58.16,0),"norwegian ports":(62.0,7.0,1),
"norway, all ports":(62.0,7.0,1),"turkish ports":(39.0,32.0,1),"turkey, all ports":(39.0,32.0,1),
"brazilian ports":(-15.0,-47.0,1),"brazilian ports (north/ne)":(-3.0,-42.0,1),"brazil, all ports":(-15.0,-47.0,1),
"pulau cula":(1.18,104.20,0),"batangas (mabini sea oil terminal)":(13.75,120.95,0),
"bay of campeche":(19.5,-92.5,0),"bay of campeche (off sanchez magallanes)":(18.6,-93.0,0),
"california (la/long beach)":(33.73,-118.24,0),"argentine ports":(-36.0,-60.0,1),
"tarahan":(-5.57,105.38,0),"mongla":(22.49,89.60,0),"belawan":(3.78,98.68,0),"payra":(21.98,90.32,0),
"abidjan":(5.28,-4.01,0),"monrovia":(6.35,-10.76,0),"beira":(-19.83,34.84,0),
"dalian":(38.92,121.63,0),"yangtze river (shanghai/jiangsu)":(31.8,120.8,0),
"new zealand, all ports":(-41.0,173.0,1),"istanbul southern anchorage":(40.95,28.80,0),
"libyan ports":(32.0,18.0,1),"all ports":(50.0,-95.0,1),"ho chi minh":(10.77,106.72,0),
"kakinada":(16.94,82.25,0),"ras tanura":(26.64,50.16,0),"malaysia, all ports":(3.5,102.0,1),
"hokkaido":(43.0,142.5,0),"sepangar bay":(6.07,116.10,0),"cotonou":(6.35,2.43,0),
"hobyo":(5.35,48.53,0),"nansha":(22.76,113.60,0),
"antwerp (antwerp-bruges/north sea port)":(51.26,4.39,0),"dominican republic ports":(18.5,-70.0,1),
"brunswick":(31.13,-81.50,0),"lagos (algarve)":(37.10,-8.67,0),"djibouti":(11.60,43.15,0),
"ciudad del carmen":(18.65,-91.80,0),"dos bocas":(18.43,-93.19,0),"bay of campeche":(19.5,-92.5,0),
"taiwan, all ports":(23.7,121.0,1),"san antonio":(-33.59,-71.62,0),"balongan":(-6.27,108.38,0),
"tema":(5.63,0.02,0),"fiji ports":(-17.8,178.0,1),"lima (delta dock)":(-34.7,-58.4,0),
"port of bahrain":(26.20,50.60,0),"ras laffan":(25.90,51.55,0),"taicang":(31.62,121.13,0),
"san pedro":(4.74,-6.63,0),"novorossiysk":(44.72,37.78,0),"mumbai":(18.95,72.85,0),
"saldanha bay":(-33.03,17.95,0),"veracruz":(19.20,-96.13,0),"santa marta":(11.25,-74.22,0),
"santo antonio (principe is.)":(1.64,7.42,0),"owendo":(0.29,9.50,0),"libreville":(0.39,9.45,0),
"brass":(4.31,6.24,0),"shanghai":(31.23,121.49,0),
"cartagena":(10.40,-75.51,0),"mombasa":(-4.06,39.66,0),
"ghanaian ports":(7.9,-1.0,1),"indian ports":(21.0,78.0,1),
}


# ── 초정밀 인덱싱: 별칭 → 대표 항구명 통합 (모든 파일의 내용이 한 항구로 모이도록)
ALIAS = {
 "chittagong": "Chattogram",
 "dampier port": "Dampier",
 "singapore, all ports": "Singapore Ports", "singapore": "Singapore Ports",
 "china, all ports": "Chinese Ports", "china ports": "Chinese Ports",
 "turkey, all ports": "Turkish Ports",
 "brazil, all ports": "Brazilian Ports",
 "norway, all ports": "Norwegian Ports",
 "phillip channel": "Singapore Strait (Phillip Channel)",
 "singapore strait (phillip channel/eb lane)": "Singapore Strait (Phillip Channel)",
 "pulau cula": "Singapore Strait (off Pulau Cula)",
 "singapore strait (eb lane/off pulau cula)": "Singapore Strait (off Pulau Cula)",
 "singapore strait (off pulau nongsa/cula)": "Singapore Strait (off Pulau Cula)",
 "lagos (tincan)": "Lagos (Tin Can Island)",
 "lagos (eko terminal)": "Lagos",
 "ciudad del carmen (bay of campeche)": "Ciudad del Carmen",
 "dos bocas (bay of campeche)": "Dos Bocas",
 "bay of campeche (off sanchez magallanes)": "Bay of Campeche",
 "ashburton / dampier / varanus": "Ashburton / Dampier",
 "mumbai port": "Mumbai",
}
def canon(p):
    return ALIAS.get(p.strip().lower(), p.strip())

def main():
    try:
        req = urllib.request.Request(CSV_URL, headers={"User-Agent":"Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        if raw.lstrip().startswith("<"):  # HTML = 권한 없음
            print("ERROR: CSV not publicly accessible"); sys.exit(1)
    except Exception as e:
        print("Download failed:", e); sys.exit(1)

    rows = list(csv.DictReader(io.StringIO(raw)))
    ports = {}
    for r in rows:
        p = canon((r.get("Port") or "").strip())
        cn = (r.get("Country") or "").strip()
        ym = (r.get("Year-Month") or "").strip()
        d  = (r.get("Description") or "").strip()
        if not p or not d: continue
        cat = "security" if d.lower().startswith("[security]") else "general"
        d = re.sub(r"^\[(General|Security)\]\s*", "", d)
        key = p + "|" + cn
        if key not in ports:
            cc = C.get(p.lower())
            ports[key] = {"port":p,"country":cn,
                "lat":cc[0] if cc else None,"lon":cc[1] if cc else None,
                "isCountry":bool(cc[2]) if cc else False,
                "general":0,"security":0,"items":[]}
        e = ports[key]
        e[cat] += 1
        e["items"].append({"ym":ym,"cat":cat,"text":d,
            "src":(r.get("Source File") or "").strip(),
            "link":(r.get("Source Link") or "").strip()})

    plist = sorted(ports.values(), key=lambda x:-(len(x["items"])))
    for e in plist:
        e["items"].sort(key=lambda i:i["ym"], reverse=True)

    # 좌표 겹침 자동 분리(클릭 가능 보장)
    seen = {}
    for e in plist:
        if e["lat"] is None: continue
        k = (round(e["lat"],2), round(e["lon"],2))
        n = seen.get(k, 0)
        if n:
            ang = 0.9*n
            e["lat"] += 0.12*n*__import__("math").sin(ang)
            e["lon"] += 0.12*n*__import__("math").cos(ang)
        seen[k] = n+1
    countries = {}
    for e in plist:
        c = countries.setdefault(e["country"], {"country":e["country"],"general":0,"security":0,"ports":0})
        c["general"] += e["general"]; c["security"] += e["security"]; c["ports"] += 1
    out = {"generated": __import__("datetime").datetime.utcnow().isoformat()+"Z",
           "total": len(rows), "ports": plist,
           "countries": sorted(countries.values(), key=lambda x:x["country"])}
    json.dump(out, open(OUT,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    noc = [e["port"] for e in plist if e["lat"] is None]
    print(f"OK: {len(rows)} rows, {len(plist)} ports, {len(out['countries'])} countries. No-coord: {noc}")

if __name__ == "__main__":
    main()
