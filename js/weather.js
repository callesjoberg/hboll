/* weather.js — enkel väderprognos per match via Open-Meteo (gratis,
   ingen nyckel, CORS öppen för alla origins). Bara meningsfullt för
   kommande matcher — historiskt väder visas inte. */

window.HB = window.HB || {};

(function () {
  // WMO weathercode → emoji. https://open-meteo.com/en/docs (tabellen "WMO Weather interpretation codes")
  const ICONS = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️", 56: "🌦️", 57: "🌦️",
    61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
    71: "🌨️", 73: "🌨️", 75: "🌨️", 77: "🌨️",
    80: "🌦️", 81: "🌦️", 82: "🌧️",
    85: "🌨️", 86: "🌨️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
  };

  const cache = {}; // cupId -> {times:[ms...], codes:[...], temps:[...]} | null

  // Open-Meteo ger väggtid utan offset (styrd av ?timezone=). Räknar om till
  // äkta UTC-epoch (samma kodning som match.start) via den faktiska
  // Stockholm-offseten just nu — prognosfönstret är bara 16 dygn så en
  // DST-växling mitt i det är ett försumbart specialfall för en "enklare"
  // väderprognos.
  function stockholmOffsetMinutes() {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Stockholm", timeZoneName: "shortOffset",
    });
    const part = dtf.formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    const m = /GMT([+-]\d+)/.exec((part && part.value) || "");
    return m ? parseInt(m[1], 10) * 60 : 120;
  }

  async function fetchForecast(cup) {
    if (cup.id in cache) return cache[cup.id];
    if (typeof cup.lat !== "number" || typeof cup.lon !== "number") {
      return (cache[cup.id] = null);
    }
    try {
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + cup.lat +
        "&longitude=" + cup.lon + "&hourly=weathercode,temperature_2m" +
        "&timezone=Europe%2FStockholm&forecast_days=16";
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const offsetMs = stockholmOffsetMinutes() * 60000;
      const times = (j.hourly.time || []).map((t) => Date.parse(t + ":00Z") - offsetMs);
      cache[cup.id] = {
        times,
        codes: j.hourly.weathercode || [],
        temps: j.hourly.temperature_2m || [],
      };
    } catch {
      cache[cup.id] = null;
    }
    return cache[cup.id];
  }

  // Närmaste timmes väder för en given matchtid, eller null om utanför
  // prognosfönstret (mer än ~16 dygn fram, eller redan förbi/ingen data).
  function at(forecast, startMs) {
    if (!forecast || !forecast.times.length) return null;
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < forecast.times.length; i++) {
      const diff = Math.abs(forecast.times[i] - startMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestIdx < 0 || bestDiff > 90 * 60000) return null; // >90 min bort: opålitligt
    const code = forecast.codes[bestIdx];
    return {
      icon: ICONS[code] || "",
      temp: Math.round(forecast.temps[bestIdx]),
    };
  }

  // Synkron läsning av redan hämtad (eller ej ännu hämtad) prognos — för
  // rendering som inte kan/ska invänta ett async-anrop.
  function cached(cup) {
    return cache[cup.id] || null;
  }

  HB.weather = { fetchForecast, at, cached };
})();
