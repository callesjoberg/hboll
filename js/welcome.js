/* welcome.js — välkomstöverlägg för nya besökare: en kort presentation av
   appen, riktiga (inte hårdkodade) siffror räknade ur redan hämtad data,
   och en animerad kartbakgrund (riktig MapLibre-karta, samma källa som
   Karta-fliken) där klubbpunkter tänds cup för cup
   (data/landing-map.json, byggd av scripts/build_landing_map.py).

   Visas EN gång per webbläsare (localStorage-flagga) — men ALDRIG om
   sidan öppnades via en delad länk med filter (samma
   hasUrlFilters-resonemang som app.js/init(): den som klickat en delad
   länk vill se DET innehållet direkt, inte avbrytas av en introskärm).
   Går att öppna igen när som helst via en liten länk i sidfoten
   (HB.openWelcome, kopplad i app.js/setupFooterLinks). */

window.HB = window.HB || {};

(function () {
  const SEEN_KEY = "hb:welcomeSeen";

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  // Samma filterparametrar som hasUrlFilters i app.js/init() — hålls
  // medvetet som en egen kopia (inte en delad konstant) eftersom de två
  // filerna laddas oberoende av varandra och skriptordningen inte ska
  // behöva spela någon roll.
  function hasUrlFilters() {
    const params = new URLSearchParams(location.search);
    return ["view", "stats", "scope", "days", "cats", "teams", "arena",
      "viewArena", "sort", "order", "mf", "q"].some((k) => params.has(k));
  }

  function fmtNum(n) {
    return n.toLocaleString("sv-SE");
  }

  // Samma tre-lägessystem (ljust/mörkt/auto) och samma localStorage-nyckel
  // som appens egna inställningsmeny (state.theme/applyTheme i app.js) —
  // en växling här ska hänga kvar även efter man stängt välkomstskärmen.
  const THEME_KEY = "hb:theme";

  function currentThemeSetting() {
    return localStorage.getItem(THEME_KEY) || "auto";
  }

  function isDarkTheme() {
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyThemeSetting(value) {
    localStorage.setItem(THEME_KEY, value);
    document.documentElement.dataset.theme = value === "auto" ? "" : value;
  }

  function themeIcon(value) {
    return value === "light" ? "☀" : value === "dark" ? "🌙" : "🌓";
  }

  // Räknar fram siffrorna att visa direkt ur det arkivindex/den
  // klubbkatalog som redan hämtas vid varje sidladdning (state i app.js
  // är inte åtkomlig härifrån — hämtar en egen, redan HTTP-cachad kopia)
  // i stället för att hårdkoda tal som skulle bli inaktuella så fort
  // fler cuper/år arkiveras.
  // perCup byggs ur SAMMA arkivindex som totalsumman (inget extra
  // nätverksanrop för det) — används för att låta stat-korten visa den
  // just nu rullande cupens EGNA siffror i stället för de globala
  // totalerna (se startMapAnimation/onCupChange).
  async function computeStats() {
    const [idxRes, dirRes, cupsRes] = await Promise.allSettled([
      fetch("data/archive/index.json").then((r) => (r.ok ? r.json() : {})),
      fetch("data/club-directory.json").then((r) => (r.ok ? r.json() : {})),
      fetch("data/cups.json").then((r) => (r.ok ? r.json() : { cups: [] })),
    ]);
    const idx = idxRes.status === "fulfilled" ? idxRes.value : {};
    const dir = dirRes.status === "fulfilled" ? dirRes.value : {};
    const placeByCup = {};
    if (cupsRes.status === "fulfilled") {
      for (const c of cupsRes.value.cups || []) placeByCup[c.id] = c.place;
    }
    let cups = 0, teams = 0, matches = 0;
    const years = new Set();
    const perCup = {};
    for (const [cupId, entry] of Object.entries(idx)) {
      const editions = (entry.editions || []).filter((e) => e.matches > 0);
      if (!editions.length) continue;
      cups++;
      let cupMatches = 0;
      const cupYears = [];
      for (const e of editions) {
        teams += e.teams || 0;
        matches += e.matches || 0;
        cupMatches += e.matches || 0;
        cupYears.push(e.edition);
        years.add(e.edition);
      }
      cupYears.sort();
      perCup[cupId] = {
        matches: cupMatches,
        editions: editions.length,
        sinceYear: cupYears[0],
        place: placeByCup[cupId] || null,
      };
    }
    const sortedYears = [...years].sort();
    return {
      cups, teams, matches,
      clubs: Object.keys(dir).length,
      sinceYear: sortedYears[0] || null,
      totalYears: sortedYears.length,
      perCup,
    };
  }

  // Skapar en stat-ruta vars strong/span/small går att uppdatera i
  // efterhand (inte bygga om) — samma 5 rutor återanvänds för både de
  // globala totalerna och (medan en cup rullar på kartbakgrunden) den
  // cupens egna siffror, se setOverallStats/setCupStats i openWelcome.
  // "small" (t ex "11 241 av 248 005 totalt") ger en känsla för aktuell
  // cup i förhållande till hela sajten — tom i det globala baslägets kort,
  // annars skulle den bara upprepa samma tal som redan står i strong.
  function statChipRef() {
    const strong = h("strong", null, "…");
    const span = h("span", null, "");
    const small = h("small", null, "");
    return { el: h("div", { class: "welcome-stat" }, strong, span, small), strong, span, small };
  }

  function feature(emoji, title, body) {
    return h("div", { class: "welcome-feature" },
      h("h3", { "data-emoji": emoji }, title),
      h("p", null, body));
  }

  // --- animerad kartbakgrund ------------------------------------------
  //
  // Riktig kartbakgrund (MapLibre GL + OpenFreeMap, samma gratis källa
  // appens Karta-flik redan använder — se ensureMapLibre i app.js, som
  // den här är en medvetet fristående kopia av) i stället för en
  // handritad kustlinje. Kameran styrs helt själva (map.jumpTo varje
  // bildruta) i stället för MapLibres egna flyTo/easeTo, eftersom det
  // ger full kontroll över en långsam, aldrig hackig glidning som aldrig
  // snärtar till vid cup-byten. Klubbprickarna ritas i ett separat,
  // TRANSPARENT canvas-lager ovanpå (map.project() varje bildruta) —
  // en riktig karta får inte tonas ner av samma halvtransparenta
  // "svans"-trick som den gamla handritade bakgrunden använde.

  const MAPLIBRE_VERSION = "4.7.1";
  let mapLibreLoadPromise = null;

  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibreLoadPromise) return mapLibreLoadPromise;
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.css";
      document.head.append(css);
      const script = document.createElement("script");
      script.src = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.js";
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error("maplibre kunde inte laddas"));
      document.head.append(script);
    });
    return mapLibreLoadPromise;
  }

  // Percentil i stället för rent min/max — en enstaka felgeokodad klubb
  // (t ex en adress som hamnat i fel land) ska inte få hela kartutsnittet
  // att zooma ut till absurdum. loPct/hiPct=0.1/0.9 trimmar bort de yttersta
  // 10 % i varje ände innan vi mäter spridningen.
  function percentileBBox(points, loPct, hiPct) {
    const lats = points.map((p) => p[0]).sort((a, b) => a - b);
    const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
    const pick = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(p * (arr.length - 1))))];
    return {
      minLat: pick(lats, loPct), maxLat: pick(lats, hiPct),
      minLng: pick(lngs, loPct), maxLng: pick(lngs, hiPct),
    };
  }

  // En del cuper representeras av EN enda punkt (bara värdortens läge,
  // inga klubbadresser eller landslag i datan — se build_landing_map.py)
  // — en sådan bbox har noll utbredning, vilket annars ger MapLibre en
  // urartad (odefinierad zoom) ram. Ett golv på minSpan grader garanterar
  // en rimlig, "stads-nära" inzoomning även för de cuperna.
  function inflateBBox(bb, minSpan) {
    const latPad = Math.max(0, (minSpan - (bb.maxLat - bb.minLat)) / 2);
    const lngPad = Math.max(0, (minSpan - (bb.maxLng - bb.minLng)) / 2);
    return {
      minLat: bb.minLat - latPad, maxLat: bb.maxLat + latPad,
      minLng: bb.minLng - lngPad, maxLng: bb.maxLng + lngPad,
    };
  }

  // Börjar alltid med Alingsås HK:s egen cup (klubben sajten är byggd
  // för) — resten slumpas om varje sidladdning, så det inte alltid är
  // samma ordning/samma första intryck varje gång man ser skärmen.
  function shuffleCupOrder(ids) {
    const rest = ids.filter((id) => id !== "potatis");
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return ids.includes("potatis") ? ["potatis", ...rest] : rest;
  }

  async function startMapAnimation(mapEl, dotCanvas, nameEl, cupsData, animState, onCupChange) {
    const cupIds = shuffleCupOrder(Object.keys(cupsData));
    if (!cupIds.length) return () => {};

    const maplibregl = await ensureMapLibre();
    if (!mapEl.isConnected) return () => {}; // stängdes medan biblioteket laddades

    const map = new maplibregl.Map({
      container: mapEl,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [15, 62],
      zoom: 4,
      interactive: false, // dekorativ bakgrund, inte ett navigerbart kartverktyg
      attributionControl: { compact: true },
    });

    // Varje cups egen kamerainställning (centrum + zoom) räknas ut EN gång
    // via MapLibres egen cameraForBounds — mer träffsäkert än att själva
    // approximera zoomnivåer ur breddgrader. Zoomen klipps till ett smalt
    // band runt "hemvyns" egen zoom: en lokalt koncentrerad cup (t ex en
    // enda ort) zoomar in tydligt mer, en geografiskt spridd cup (flera
    // landsdelar) zoomar ut något — men aldrig så mycket att bytet mellan
    // cuper känns som ett hopp.
    const allBounds = new maplibregl.LngLatBounds();
    for (const id of cupIds) {
      const pts = cupsData[id].points;
      const bb = percentileBBox(pts, 0.1, 0.9);
      allBounds.extend([bb.minLng, bb.minLat]);
      allBounds.extend([bb.maxLng, bb.maxLat]);
    }
    const baseCam = map.cameraForBounds(allBounds, { padding: 40, maxZoom: 6.5 });
    const baseZoom = baseCam ? baseCam.zoom : 4.5;

    // MAX_ZOOM_ABOVE_BASE hölls först på +2.6 — för koncentrerade kluster
    // (t ex Järnvägen Cups jitter kring en enda värdort) zoomade det in SÅ
    // hårt att punkternas fasta pixelstorlek (se SPRITE_R nedan) fick dem
    // att helt överlappa till en enda solid klump i stället för synligt
    // åtskilda prickar. Ett lägre tak + mer padding ger mer "luft" runt
    // klustret oavsett hur tätt själva jittret (build_landing_map.py) är.
    const MAX_ZOOM_ABOVE_BASE = 1.4;
    const cupCam = {};
    for (const id of cupIds) {
      const pts = cupsData[id].points;
      const bb = inflateBBox(percentileBBox(pts, 0.1, 0.9), 0.6);
      const bounds = new maplibregl.LngLatBounds([bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]);
      const c = map.cameraForBounds(bounds, { padding: 90, maxZoom: baseZoom + MAX_ZOOM_ABOVE_BASE });
      cupCam[id] = {
        lng: c ? c.center.lng : (bb.minLng + bb.maxLng) / 2,
        lat: c ? c.center.lat : (bb.minLat + bb.maxLat) / 2,
        zoom: Math.max(baseZoom - 0.5, Math.min(baseZoom + MAX_ZOOM_ABOVE_BASE, c ? c.zoom : baseZoom)),
      };
    }

    const ctx = dotCanvas.getContext("2d");
    let dw = 0, dh = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      dw = dotCanvas.clientWidth; dh = dotCanvas.clientHeight;
      dotCanvas.width = Math.round(dw * dpr);
      dotCanvas.height = Math.round(dh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      map.resize();
    }
    resize();
    window.addEventListener("resize", resize);

    // En förrenderad glöd-"sprite" per tema (glödgradient + mittprick) —
    // ritas EN gång till en offscreen-canvas och kopieras sedan billigt med
    // drawImage per prick, i stället för att bygga en ny createRadialGradient
    // för var och en av upp till 320 prickar VARJE bildruta. Det senare var
    // den stora flaskhalsen på mobil: bildrutor tappades så illa att
    // prickarnas slumpade tändning såg ut att ske på en gång (hela
    // in-fasen hann passera mellan två renderade rutor). Cachad per
    // temanyckel så en temaväxling bygger om spriten men inget annat.
    const SPRITE_R = 6.5; // glödradie i css-px — mindre än förr så täta kluster (se MAX_ZOOM_ABOVE_BASE ovan) inte flyter ihop till en klump
    const SPRITE_SIZE = (SPRITE_R + 1) * 2;
    let spriteCache = {};
    function glowSprite(glowRgb, dotRgb) {
      const key = glowRgb + "|" + dotRgb;
      if (spriteCache[key]) return spriteCache[key];
      const s = document.createElement("canvas");
      s.width = Math.round(SPRITE_SIZE * dpr);
      s.height = Math.round(SPRITE_SIZE * dpr);
      const sc = s.getContext("2d");
      sc.scale(dpr, dpr);
      const c = SPRITE_SIZE / 2;
      const g = sc.createRadialGradient(c, c, 0, c, c, SPRITE_R);
      g.addColorStop(0, `rgba(${glowRgb}, 0.6)`);
      g.addColorStop(1, `rgba(${glowRgb}, 0)`);
      sc.fillStyle = g;
      sc.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
      sc.beginPath();
      sc.arc(c, c, 1.7, 0, Math.PI * 2);
      sc.fillStyle = `rgb(${dotRgb})`;
      sc.fill();
      spriteCache[key] = s;
      return s;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const first = cupCam[cupIds[0]];
    // Kameran (cam) tweenas mellan camStart och den aktuella cupens läge
    // över en FAST, garanterad tid (PAN_DURATION) — inte en öppen
    // exponentiell utjämning. Den första versionen (öppen, oändligt lång
    // tidskonstant) visade sig kunna hamna så långt efter att prickarna
    // för den "aktuella" cupen ritades helt utanför synligt läge när
    // kameran aldrig hann ikapp — en fast, easead varaktighet garanterar
    // i stället att kameran verkligen ANLÄNDER innan cupen byts igen.
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    const PAN_DURATION = 5200;
    const cam = { lng: first.lng, lat: first.lat, zoom: baseZoom };
    let camStart = { lng: first.lng, lat: first.lat, zoom: baseZoom };
    let panStart = performance.now();
    map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom });

    let cupIndex = 0;
    let lastReportedCupId = null;
    let phase = "in";
    let phaseStart = performance.now();
    const IN_MS = 3200, OUT_MS = 1400;
    const STAGGER_MS = 2000; // hur mycket varje prick kan slumpas att dröja innan den börjar tändas — dubblat efter feedback
    const DOT_FADE_MS = 1100; // hur lång tid en enskild prick tar att tändas, från sin egen starttid — dubblat

    // Hur länge en cup visas (hold-fasen) skalas efter hur MYCKET den har
    // att visa — en cup med en enda punkt (inget klubbregister, bara
    // värdorten, se build_landing_map.py) visas ungefär lika länge som
    // innan den här skalningen fanns, en typisk cup ungefär dubbelt så
    // länge, och de allra tätaste (Partille, Lundaspelen...) längst av
    // alla — både för att kameran hinner panorera/zooma ordentligt OCH
    // för att det helt enkelt är mer att titta på. Logaritmisk skala
    // eftersom punktantalet spänner över två storleksordningar (1–320).
    const BASE_TOTAL = IN_MS + 3800 + OUT_MS; // = det tidigare, oskalade cykel-taket
    const MAX_PTS = Math.max(2, ...cupIds.map((id) => cupsData[id].points.length));
    function holdFor(id) {
      const n = Math.max(1, cupsData[id].points.length);
      const mult = 1 + 1.4 * (Math.log(n) / Math.log(MAX_PTS));
      return Math.max(1500, BASE_TOTAL * mult - IN_MS - OUT_MS);
    }

    // Slumpad, individuell tändningsfördröjning per prick — genereras om
    // varje gång vi går vidare till en ny cup.
    let dotDelays = cupsData[cupIds[0]].points.map(() => Math.random() * STAGGER_MS);

    // Inforutan (cupnamn + hur många lag som faktiskt visas) — byggs en
    // gång, uppdateras sedan bara som textContent varje bildruta.
    const nameTitleEl = h("div", { class: "welcome-cup-title" });
    const nameCountEl = h("div", { class: "welcome-cup-count" });
    nameEl.append(nameTitleEl, nameCountEl);

    let rafId = null;
    let lastNow = performance.now();
    // 0 = full fart, 1 = helt fryst — glider mjukt mellan de två över
    // FREEZE_MS i stället för att paus/play hoppar direkt mellan lägena,
    // så en paus känns som att animationen SAKTAR NER till en stilla
    // drift snarare än att den tvärstannar.
    let freezeT = 0;
    const FREEZE_MS = 320;
    function frame(now) {
      const dt = Math.min(100, now - lastNow); // hoppar aldrig kameran vid t ex en bakgrundsflik
      lastNow = now;
      const dur = reduceMotion
        ? { in: 0, hold: 1e9, out: 0 } // still bild av första cupen, ingen cykling, ingen kamerarörelse
        : { in: IN_MS, hold: holdFor(cupIds[cupIndex]), out: OUT_MS };

      const freezeTarget = animState.paused ? 1 : 0;
      const freezeStep = dt / FREEZE_MS;
      freezeT = freezeTarget > freezeT
        ? Math.min(freezeTarget, freezeT + freezeStep)
        : Math.max(freezeTarget, freezeT - freezeStep);

      // phaseStart/panStart skiftas framåt i proportion till hur "fryst"
      // vi är just nu (0 vid full fart, hela dt vid full paus, nåt
      // däremellan under in/ut-rampen) — cup-cykeln och kamera-tweenen
      // (som båda mäts som now-minus-start) saktar då ner mjukt i stället
      // för att hugga till. Jordglobs-driften längre ner räknas alltid på
      // RÅ tid, oavsett frysgrad, så kartan aldrig blir helt livlös.
      const frozenDt = dt * freezeT;
      phaseStart += frozenDt;
      panStart += frozenDt;

      if (!reduceMotion) {
        const elapsedCheck = now - phaseStart;
        if (elapsedCheck > dur[phase]) {
          if (phase === "in") phase = "hold";
          else if (phase === "hold") phase = "out";
          else {
            phase = "in";
            cupIndex = (cupIndex + 1) % cupIds.length;
            dotDelays = cupsData[cupIds[cupIndex]].points.map(() => Math.random() * STAGGER_MS);
            camStart = { lng: cam.lng, lat: cam.lat, zoom: cam.zoom };
            panStart = now;
          }
          phaseStart = now;
        }
      }
      const elapsed = now - phaseStart;

      if (!reduceMotion) {
        const target = cupCam[cupIds[cupIndex]];
        const te = easeInOutCubic(Math.min(1, (now - panStart) / PAN_DURATION));
        cam.lng = camStart.lng + (target.lng - camStart.lng) * te;
        cam.lat = camStart.lat + (target.lat - camStart.lat) * te;
        cam.zoom = camStart.zoom + (target.zoom - camStart.zoom) * te;
      }

      // Långsam, avgränsad "jordglobs-drift" — två sinusar med olika
      // period/fas så rörelsen inte känns som ett enkelt fram-och-tillbaka.
      // Räknas alltid på RÅ tid (now), oavsett paus — se ovan.
      // Liten amplitud med avsikt: ska kännas som att globen sakta
      // fortsätter snurra, inte konkurrera med cup-till-cup-panoreringen.
      const driftLat = reduceMotion ? 0 : Math.sin(now / 142000 + 1.3) * 0.55;
      const driftLng = reduceMotion ? 0 : Math.sin(now / 106000) * 0.9;

      map.jumpTo({ center: [cam.lng + driftLng, cam.lat + driftLat], zoom: cam.zoom });

      // Prickarna: EGET transparent lager ovanpå den riktiga kartan —
      // clearRect (inte en halvtransparent fyllning) så den underliggande
      // kartan aldrig tonas, och varje pricks tändning syns exakt som den är.
      ctx.clearRect(0, 0, dw, dh);

      // Gula/gyllene markörer läses knappt mot en ljus, ofiltrerad karta
      // (se --welcome-map-filter i css/style.css — bara mörkt tema
      // mörklägger kartan) — röda markörer i ljust tema i stället, som
      // syns tydligt mot både land och hav. Avläst live varje bildruta så
      // en temaväxling (se themeToggleBtn) syns direkt även medan
      // överlägget redan är öppet.
      const dark = isDarkTheme();
      const sprite = dark
        ? glowSprite("246, 196, 16", "255, 232, 150")
        : glowSprite("214, 47, 39", "130, 18, 13");

      const cup = cupsData[cupIds[cupIndex]];
      const inElapsed = phase === "in" ? elapsed : dur.in;
      const outT = phase === "out" ? Math.min(1, elapsed / dur.out) : 0;
      const half = SPRITE_SIZE / 2;
      cup.points.forEach(([lat, lng], i) => {
        const p = map.project([lng, lat]);
        const x = p.x, y = p.y;
        if (x < -20 || y < -20 || x > dw + 20 || y > dh + 20) return; // utanför synligt läge
        let alpha;
        if (phase === "out") {
          alpha = 1 - outT;
        } else {
          const localT = reduceMotion ? DOT_FADE_MS : inElapsed - (dotDelays[i] || 0);
          alpha = Math.max(0, Math.min(1, localT / DOT_FADE_MS));
        }
        // Paus fryser annars ALLT — en stilla, pulserande glöd (fasförskjuten
        // per prick för ett organiskt "tindrande" intryck i stället för att
        // alla pulserar i exakt takt) gör att skärmen ändå känns levande.
        // freezeT (inte den råa animState.paused) så pulsen glider in/ur i
        // takt med samma in/ur-ramp som kameran/cup-cykeln (se ovan).
        if (freezeT > 0.01) {
          const pulse = 0.72 + 0.28 * Math.sin(now / 900 + i * 0.37);
          alpha *= (1 - freezeT) + freezeT * pulse;
        }
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, x - half, y - half, SPRITE_SIZE, SPRITE_SIZE);
      });
      ctx.globalAlpha = 1;

      // Inforutan i hörnet — knyter animationen till "X cuper"-siffran och
      // visar hur många lag just den här cupen faktiskt har (real.count,
      // inte bara den renderade — och ibland nedcappade — punktmängden).
      const nameAlpha = phase === "out" ? 1 - outT : Math.min(1, inElapsed / DOT_FADE_MS);
      nameTitleEl.textContent = cup.name;
      nameCountEl.textContent = fmtNum(cup.count || cup.points.length) + " lag";
      nameEl.style.opacity = String(0.85 * nameAlpha);

      // Hero-texten och stat-korten uppdateras bara VID cup-byte (inte
      // varje bildruta som ovan, som redan är fasförskjuten mot
      // dot-tändningen) — en enkel, odramatisk textväxling räcker där.
      if (onCupChange && lastReportedCupId !== cupIds[cupIndex]) {
        lastReportedCupId = cupIds[cupIndex];
        onCupChange(cup, cupIds[cupIndex]);
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      map.remove();
    };
  }

  // --- överlägget --------------------------------------------------------

  let stopAnimationPromise = null;

  function closeWelcome(overlay) {
    localStorage.setItem(SEEN_KEY, "1");
    if (stopAnimationPromise) {
      stopAnimationPromise.then((stop) => stop && stop()).catch(() => {});
      stopAnimationPromise = null;
    }
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      const overlay = document.querySelector(".welcome-overlay");
      if (overlay) closeWelcome(overlay);
    }
  }

  async function openWelcome() {
    if (document.querySelector(".welcome-overlay")) return; // redan öppet

    const mapEl = h("div", { class: "welcome-map" });
    const dotCanvas = h("canvas", { class: "welcome-dots" });
    const nameEl = h("div", { class: "welcome-cup-text" });
    const animState = { paused: false };
    const playPauseBtn = h("button", {
      class: "welcome-playpause", type: "button", "aria-label": "Pausa animationen",
      onclick: () => {
        animState.paused = !animState.paused;
        playPauseBtn.textContent = animState.paused ? "▶" : "⏸";
        playPauseBtn.setAttribute("aria-label", animState.paused ? "Fortsätt animationen" : "Pausa animationen");
      },
    }, "⏸");
    const themeToggleBtn = h("button", {
      class: "welcome-theme-toggle", type: "button", "aria-label": "Byt färgtema",
      onclick: () => {
        const order = ["auto", "light", "dark"];
        const next = order[(order.indexOf(currentThemeSetting()) + 1) % order.length];
        applyThemeSetting(next);
        themeToggleBtn.textContent = themeIcon(next);
      },
    }, themeIcon(currentThemeSetting()));

    // Cupnamnet under själva "Cupschema"-titeln + stat-korten nedanför
    // knyts till kartanimationens aktuella cup (se onCupChange nedan) —
    // samma 5 rutor återanvänds, bara siffrorna/etiketterna byts.
    const liveCupEl = h("p", { class: "welcome-live-cup" });
    const statRefs = [statChipRef(), statChipRef(), statChipRef(), statChipRef(), statChipRef()];
    const statsHost = h("div", { class: "welcome-stats" }, statRefs.map((r) => r.el));

    let statsData = null;
    function setOverallStats(s) {
      const vals = [
        [fmtNum(s.cups), s.cups === 1 ? "cup" : "cuper"],
        [fmtNum(s.teams) + "+", "lag genom åren"],
        [fmtNum(s.matches) + "+", "matcher"],
        [fmtNum(s.clubs), "klubbar"],
        ["sedan " + (s.sinceYear || "–"), "historik"],
      ];
      // Inget "small"-tal här — det globala baslägets kort ÄR redan
      // totalerna, en repeterad rad skulle bara upprepa samma siffra.
      vals.forEach(([v, l], i) => {
        statRefs[i].strong.textContent = v; statRefs[i].span.textContent = l; statRefs[i].small.textContent = "";
      });
    }
    function setCupStats(cup, cupId) {
      liveCupEl.textContent = "Visar just nu: " + cup.name;
      const pc = statsData && statsData.perCup[cupId];
      if (!pc) { if (statsData) setOverallStats(statsData); return; } // saknar arkivdata för just den cupen — visa totalerna i stället
      const s = statsData;
      const vals = [
        [pc.place || "–", "plats", fmtNum(s.cups) + " cuper totalt"],
        [fmtNum(cup.count || cup.points.length), "lag", "av " + fmtNum(s.teams) + " totalt"],
        [fmtNum(pc.matches), "matcher", "av " + fmtNum(s.matches) + " totalt"],
        [pc.editions, pc.editions === 1 ? "år arkiverat" : "år arkiverade", "av " + fmtNum(s.totalYears) + " totalt"],
        ["sedan " + pc.sinceYear, "historik", "hela sajten sedan " + (s.sinceYear || "–")],
      ];
      vals.forEach(([v, l, sm], i) => {
        statRefs[i].strong.textContent = v; statRefs[i].span.textContent = l; statRefs[i].small.textContent = sm;
      });
    }

    const overlay = h("div", { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Välkommen" },
      mapEl,
      dotCanvas,
      h("div", { class: "welcome-cup-controls" }, nameEl, playPauseBtn),
      h("div", { class: "welcome-scrim" }),
      themeToggleBtn,
      h("button", {
        class: "welcome-close", type: "button", "aria-label": "Stäng",
        onclick: () => closeWelcome(overlay),
      }, "×"),
      h("div", { class: "welcome-content" },
        h("div", { class: "welcome-scroll" },
          h("p", { class: "welcome-kicker" }, "Välkommen till"),
          h("h1", { class: "welcome-title" }, "Cupschema"),
          liveCupEl,
          h("p", { class: "welcome-lead" },
            "Live-schema, resultat och ställning för handbollscuper — och över tio " +
            "års historik att gräva i när matchen är slut."),
          statsHost,
          h("div", { class: "welcome-features" },
            feature("📅", "Live, dag för dag",
              "Schema, tabeller, slutspel och en banöversikt för cupen som pågår just nu — filtrera på din klubb eller hela cupen."),
            feature("📊", "Stats — hela historiken på en gång",
              "Trend visar hur en cup växt över åren, Karta var klubbarna kommer ifrån, " +
              "Klubb/Lag söker en klubbs hela resa över ALLA cuper, Klubbjämförelse ställer " +
              "flera klubbar sida vid sida, Cuper jämför alla cuper i en tabell, och Historik " +
              "låter dig bläddra i gamla år som om de vore idag."),
            feature("⭐", "Din klubb i fokus",
              "Favoritmarkera din klubb, exportera schemat till din egen kalender, och välj mörkt eller ljust tema.")),
          h("div", { class: "welcome-cta-row" },
            h("button", { class: "welcome-cta", type: "button", onclick: () => closeWelcome(overlay) },
              "Utforska →")))));

    document.body.append(overlay);
    document.addEventListener("keydown", onKeydown);

    fetch("data/landing-map.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((cupsData) => {
        stopAnimationPromise = startMapAnimation(mapEl, dotCanvas, nameEl, cupsData || {}, animState, setCupStats);
      })
      .catch(() => {});

    computeStats().then((s) => {
      statsData = s;
      setOverallStats(s);
    }).catch(() => {});
  }

  HB.openWelcome = openWelcome;

  document.addEventListener("DOMContentLoaded", () => {
    if (!localStorage.getItem(SEEN_KEY) && !hasUrlFilters()) openWelcome();
  });
})();
