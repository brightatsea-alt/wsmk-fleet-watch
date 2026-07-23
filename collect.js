const fs = require("fs");
const WebSocket = require("ws");

const API_KEY = process.env.AISSTREAM_API_KEY;
const TOTAL_SECONDS = parseInt(process.env.COLLECT_SECONDS || "150", 10);
const FLEET_FILE = "fleet.json";
const POS_FILE = "fleet-positions.json";

if (!API_KEY) {
  console.error("ERROR: AISSTREAM_API_KEY is not set.");
  process.exit(1);
}

const fleet = JSON.parse(fs.readFileSync(FLEET_FILE, "utf8"));
const mmsiList = fleet.vessels.filter(v => v.mmsi).map(v => v.mmsi);
const nameByMmsi = {};
fleet.vessels.forEach(v => { if (v.mmsi) nameByMmsi[v.mmsi] = v.name; });

let store = { updated: null, vessels: {} };
try {
  store = JSON.parse(fs.readFileSync(POS_FILE, "utf8"));
  if (!store.vessels) store.vessels = {};
} catch (e) {
  console.log("No existing position file. Starting fresh.");
}

const chunks = [];
for (let i = 0; i < mmsiList.length; i += 50) {
  chunks.push(mmsiList.slice(i, i + 50));
}
const secondsPerChunk = Math.floor(TOTAL_SECONDS / chunks.length);
console.log(`Fleet: ${mmsiList.length} vessels, ${chunks.length} chunk(s), ${secondsPerChunk}s each.`);

let received = 0;

function collectChunk(mmsis, seconds) {
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    let timer = null;

    const finish = () => {
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve();
    };

    ws.on("open", () => {
      console.log(`Subscribed: ${mmsis.length} MMSIs for ${seconds}s`);
      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: mmsis,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"]
      }));
      timer = setTimeout(finish, seconds * 1000);
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      const meta = msg.MetaData || {};
      const mmsi = String(meta.MMSI || "");
      if (!nameByMmsi[mmsi]) return;

      if (!store.vessels[mmsi]) store.vessels[mmsi] = { mmsi, name: nameByMmsi[mmsi] };
      const v = store.vessels[mmsi];
      v.name = nameByMmsi[mmsi];

      if (msg.MessageType === "PositionReport" && msg.Message && msg.Message.PositionReport) {
        const p = msg.Message.PositionReport;
        v.lat = p.Latitude;
        v.lon = p.Longitude;
        v.sog = p.Sog;
        v.cog = p.Cog;
        v.heading = p.TrueHeading;
        v.navStatus = p.NavigationalStatus;
        v.lastReceived = meta.time_utc || new Date().toISOString();
        received++;
      }

      if (msg.MessageType === "ShipStaticData" && msg.Message && msg.Message.ShipStaticData) {
        const s = msg.Message.ShipStaticData;
        if (s.Destination) v.destination = String(s.Destination).trim();
        if (s.Eta) v.eta = s.Eta;
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      finish();
    });

    ws.on("close", () => resolve());
  });
}

(async () => {
  for (const chunk of chunks) {
    await collectChunk(chunk, secondsPerChunk);
  }

  store.updated = new Date().toISOString();
  fs.writeFileSync(POS_FILE, JSON.stringify(store, null, 1));

  const withPos = Object.values(store.vessels).filter(v => v.lat != null).length;
  console.log(`Done. Reports: ${received}. Vessels with position: ${withPos}/${mmsiList.length}.`);
  process.exit(0);
})();
