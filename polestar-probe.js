/* polestar-probe.js v4 — 목적지(destination) 관련 필드 존재 여부 조사 */
const BASE="https://aviso-api.stratumfive.com";
const ID=process.env.POLESTAR_CLIENT_ID, SECRET=process.env.POLESTAR_CLIENT_SECRET;
const log=console.log;
async function tok(){
  const r=await fetch(BASE+"/api/identity/connect/token",{method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:ID,client_secret:SECRET,grant_type:"client_credentials",scope:"extract-by-imo:metrics"}).toString()});
  if(!r.ok) throw new Error("token "+r.status);
  return (await r.json()).access_token;
}
async function api(p,t,init={}){
  const r=await fetch(BASE+p,{...init,headers:{authorization:"Bearer "+t,accept:"application/json",...(init.body?{"content-type":"application/json"}:{})}});
  const x=await r.text(); let b; try{b=JSON.parse(x);}catch(e){b=x;}
  return {ok:r.ok,status:r.status,body:b};
}
(async()=>{
  const t=await tok();
  const info=await api("/api/tmln/v2/cf/timeline/info",t);
  const set=(info.body&&info.body.tmlnInfoSet)||[];
  log("[1] "+set.length+" timelines");
  const types={}, dss={};
  set.forEach(x=>{ types[x.tmlnSeriesType]=(types[x.tmlnSeriesType]||0)+1; dss[x.tmlnDatasource]=(dss[x.tmlnDatasource]||0)+1; });
  log("    seriesType: "+JSON.stringify(types));
  log("    datasource: "+JSON.stringify(dss));
  const now=new Date(), min=new Date(Date.now()-48*3600e3);
  const cols={};
  const targets=set.filter(x=>x.tmlnStats&&x.tmlnStats.maxTimestamp).slice(0,6);
  for(const x of targets){
    const ex=await api("/api/tmln/v2/cf/timeline/extract",t,{method:"POST",body:JSON.stringify({query:{
      accountId:x.accountId, entityId:String(x.entityId), includeDebugInfo:true, limit:300,
      minTimestamp:min.toISOString(), maxTimestamp:now.toISOString(),
      tmlnDatasource:x.tmlnDatasource, tmlnSeriesType:x.tmlnSeriesType }})});
    const s=(ex.body&&ex.body.series)||[];
    s.forEach(row=>{ (row.columns||[]).forEach(c=>{ const k=x.tmlnDatasource+" :: "+c.name; cols[k]=(cols[k]||0)+1; });
      Object.keys(row).forEach(k=>{ if(k!=='columns'){ const kk=x.tmlnDatasource+" :: [row]"+k; cols[kk]=(cols[kk]||0)+1; } }); });
    log("    "+x.vesselName+" / "+x.tmlnDatasource+" -> "+s.length+" rows");
  }
  log("\n[2] all fields");
  Object.keys(cols).sort().forEach(k=>log("    "+k+"  ("+cols[k]+")"));
  const cand=Object.keys(cols).filter(k=>/dest|eta|port|voyage|next|nav|stat/i.test(k));
  log("\n[3] destination/ETA candidates: "+(cand.length?cand.join(", "):"NONE"));
})().catch(e=>{log("error: "+e.message);process.exit(1);});
