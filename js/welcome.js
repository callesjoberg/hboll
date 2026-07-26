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
      // finished>0 (inte bara matches>0) — en upplaga vars matcher är
      // schemalagda men inte spelade än (t ex en 2026-upplaga som just
      // lagts upp) ska varken räknas som "arkiverad" eller bidra med
      // sina ospelade matcher till totalen. Räknar bara faktiskt SPELADE
      // matcher (e.finished, inte e.matches som även inkluderar kommande).
      const editions = (entry.editions || []).filter((e) => e.finished > 0);
      if (!editions.length) continue;
      cups++;
      let cupMatches = 0;
      const cupYears = [];
      for (const e of editions) {
        teams += e.teams || 0;
        matches += e.finished || 0;
        cupMatches += e.finished || 0;
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

  async function startMapAnimation(mapEl, dotCanvas, nameEl, cupsData, animState, onCupChange, cupPickerBtn, cupDropup, playPauseBtn) {
    // "_meta" (se build_landing_map.py) är metadata om HELA filen, inte
    // en cup — ska aldrig hamna i cykeln eller cup-väljaren.
    const cupIds = shuffleCupOrder(Object.keys(cupsData).filter((id) => !id.startsWith("_")));
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

    // Live-justerbara parametrar. På localhost (eller med ?tune i URL:en)
    // ritas en slider-panel som ändrar dessa i realtid, se buildTunePanel
    // längst ner — så man kan känna sig fram till bra värden och kopiera
    // dem hit. I produktion används bara defaultvärdena nedan.
    //   maxZoomAbove: hur mycket mer än "hemvyns" zoom en koncentrerad cup
    //     får zooma IN (för högt = prickar flyter ihop till en klump).
    //   minZoom: absolut lägsta zoom — en internationell cup (Partille,
    //     ~67 länder) måste få zooma UT så här långt för att alla länder
    //     ska synas (annars klipps hela den europeiska spridningen bort).
    //   panDuration: hur länge kameran glider mellan cuper (panorering).
    //   drift/driftZoom: jordglobsdriftens styrka, se frame().
    const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) ||
      new URLSearchParams(location.search).has("tune");
    const TUNE = {
      maxZoomAbove: 1.4, minZoom: 2.4, panDuration: 5200,
      drift: 1, driftZoom: 0.7,
      // Markörernas livscykel (se frame): igniteLead = hur långt före
      // kamerans framkomst tändningen börjar; igniteSpread = slumpfönster
      // för när varje enskild prick tänds; dotFade = en pricks in-/uttonings-
      // tid; holdBase = "framme"-tid (skalas efter cup-storlek); outMs =
      // släckningstid vid avfärd; pulseAmp = pulsstyrka (0 = ingen puls);
      // pulseSpeed = pulshastighet.
      igniteLead: 250, igniteSpread: 650, dotFade: 420, holdBase: 3600, outMs: 900,
      pulseAmp: 0.3, pulseSpeed: 1,
    };

    // Färgkonfig PER TEMA (redigeras live i testpanelen på localhost, se
    // buildTunePanel). Defaultvärdena speglar EXAKT nuvarande CSS/markör-
    // färger, så produktion (där panelen aldrig byggs) ser likadant ut.
    // markN = markörens glödfärg för tier N; mittprickens färg härleds
    // (deriveDot) mot vitt i mörkt tema, mot mörkt i ljust.
    const COLORS = {
      dark: {
        accent: "#f6c410", ink: "#e8edf4", inkSoft: "#9fadbf",
        cardBg: "#0c121c", cardBgA: 0.68, border: "#ffffff", borderA: 0.12,
        mark0: "#f6c410", mark1: "#5ab4f0", mark2: "#96a0af",
      },
      light: {
        accent: "#17417e", ink: "#16283f", inkSoft: "#4a5a70",
        cardBg: "#ffffff", cardBgA: 0.82, border: "#16283f", borderA: 0.14,
        mark0: "#d62f27", mark1: "#1e64c8", mark2: "#6e7888",
      },
    };
    const themeColors = () => (isDarkTheme() ? COLORS.dark : COLORS.light);
    function hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }
    function hexA(hex, a) {
      return `rgba(${hexToRgb(hex)}, ${a})`;
    }
    function deriveDot(hex, dark) {
      const n = parseInt(hex.slice(1), 16);
      const t = dark ? 255 : 24, amt = 0.55;
      const mix = (c) => Math.round(c + (t - c) * amt);
      return `${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)}`;
    }

    const cupCam = {};
    function recomputeCupCam() {
      for (const id of cupIds) {
        const pts = cupsData[id].points;
        // Bredare percentil (0.02–0.98, inte 0.1–0.9) för själva ramen: för
        // en cup där de allra flesta lag är svenska men hundratals kommer
        // från övriga Europa/världen (Partille) trimmade 0.1–0.9 bort ALLA
        // utländska lag och gav en ram stor som bara Skandinavien. 0.02–0.98
        // behåller den internationella spridningen men kapar fortfarande en
        // enstaka felgeokodad singelpunkt.
        const bb = inflateBBox(percentileBBox(pts, 0.02, 0.98), 0.6);
        const bounds = new maplibregl.LngLatBounds([bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]);
        const c = map.cameraForBounds(bounds, { padding: 90, maxZoom: baseZoom + TUNE.maxZoomAbove });
        cupCam[id] = {
          lng: c ? c.center.lng : (bb.minLng + bb.maxLng) / 2,
          lat: c ? c.center.lat : (bb.minLat + bb.maxLat) / 2,
          zoom: Math.max(TUNE.minZoom, Math.min(baseZoom + TUNE.maxZoomAbove, c ? c.zoom : baseZoom)),
        };
      }
    }
    recomputeCupCam();

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
    // över en FAST, garanterad tid (TUNE.panDuration) — inte en öppen
    // exponentiell utjämning. Den första versionen (öppen, oändligt lång
    // tidskonstant) visade sig kunna hamna så långt efter att prickarna
    // för den "aktuella" cupen ritades helt utanför synligt läge när
    // kameran aldrig hann ikapp — en fast, easead varaktighet garanterar
    // i stället att kameran verkligen ANLÄNDER innan cupen byts igen.
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    const cam = { lng: first.lng, lat: first.lat, zoom: baseZoom };
    let camStart = { lng: first.lng, lat: first.lat, zoom: baseZoom };
    let panStart = performance.now();
    map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom });

    let cupIndex = 0;
    let lastReportedCupId = null;

    // --- prick-livscykeln, knuten till kamerans resa (inte egna timers) --
    // Under panoreringen mellan cuper är prickarna SLÄCKTA. Först när
    // kameran nästan är framme tänds de, individuellt och slumpat spritt
    // över IGNITE_SPREAD ms; sedan pulserar var och en i sin EGEN takt
    // under hela "framme"-tiden (holdFor, skalad efter cupens storlek);
    // och SLÄCKS när kameran ska lämna cupen — varpå nästa panorering
    // börjar med släckt karta igen.
    // Tidskonstanterna för livscykeln bor i TUNE (live-justerbara på
    // localhost, se buildTunePanel) — defaultvärdena är desamma som förr
    // så produktion beter sig oförändrat.
    const MAX_PTS = Math.max(2, ...cupIds.map((id) => cupsData[id].points.length));
    function holdFor(id) {
      const n = Math.max(1, cupsData[id].points.length);
      const mult = 1 + 1.4 * (Math.log(n) / Math.log(MAX_PTS));
      return Math.max(1800, TUNE.holdBase * mult);
    }

    // Per prick: eget tändnings-dröjsmål (0..igniteSpread) + egen pulstakt/
    // -fas, så de varken tänds eller pulserar i takt. Dröjsmålen lagras som
    // ANDEL (0..1) av igniteSpread så en live-ändring av spread slår igenom
    // även på nuvarande cup. Genereras om vid varje cup-byte.
    let dotDelays = [], dotRate = [], dotPhase = [];
    function genDots(id) {
      const pts = cupsData[id].points;
      dotDelays = pts.map(() => Math.random());               // andel av igniteSpread
      dotRate = pts.map(() => 0.0016 + Math.random() * 0.0028); // rad/ms ≈ en puls var 2–4 s
      dotPhase = pts.map(() => Math.random() * Math.PI * 2);
    }
    genDots(cupIds[0]);

    // Manuellt val via dropupen (se cupPickerBtn/cupDropup i openWelcome)
    // — samma övergångsstart som en naturlig cup-växling (ny stagger,
    // kameran tweenar från sitt NUVARANDE läge, inte ett hopp), plus en
    // automatisk paus så den valda cupen inte genast rullar vidare av
    // sig själv innan man hunnit titta på den.
    //
    // Pausar INTE direkt — det frös tidigare animationen mitt i själva
    // växlingen (kameran hann bara halvvägs, prickarna bara delvis
    // tända), vilket i praktiken såg ut som att "inget händer" förrän
    // man själv tryckte play. animState.pauseAfterArrival flaggar i
    // stället att pausen ska slå till FÖRST när både prick-intoningen
    // och kamera-panoreringen faktiskt hunnit landa, se frame().
    function syncPlayPauseButton() {
      if (!playPauseBtn) return;
      playPauseBtn.textContent = animState.paused ? "▶" : "⏸";
      playPauseBtn.setAttribute("aria-label", animState.paused ? "Fortsätt animationen" : "Pausa animationen");
    }
    function selectCup(id) {
      const idx = cupIds.indexOf(id);
      if (idx < 0) return;
      cupIndex = idx;
      camStart = { lng: cam.lng, lat: cam.lat, zoom: cam.zoom };
      panStart = performance.now(); // starta en normal panorering→tändning mot den valda cupen
      genDots(id);
      lastReportedCupId = null; // tvingar fram en onCupChange-uppdatering nästa bildruta
      animState.paused = false; // se till att en ev. redan aktiv paus inte fryser växlingen
      animState.pauseAfterArrival = true; // pausa när den hunnit tändas klart (se frame)
      syncPlayPauseButton();
      cupDropup.setAttribute("hidden", "");
      cupPickerBtn.setAttribute("aria-expanded", "false");
    }
    if (cupDropup) {
      // Alfabetisk ordning i listan (inte den slumpade visningsordningen)
      // — mycket lättare att hitta en specifik cup i.
      const sortedIds = [...cupIds].sort((a, b) => cupsData[a].name.localeCompare(cupsData[b].name, "sv"));
      cupDropup.replaceChildren(...sortedIds.map((id) =>
        h("li", { role: "presentation" },
          h("button", { type: "button", role: "option", onclick: () => selectCup(id) }, cupsData[id].name))));
    }

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

      const freezeTarget = animState.paused ? 1 : 0;
      const freezeStep = dt / FREEZE_MS;
      freezeT = freezeTarget > freezeT
        ? Math.min(freezeTarget, freezeT + freezeStep)
        : Math.max(freezeTarget, freezeT - freezeStep);

      // Cykelklockan (panStart) skiftas framåt i takt med hur "fryst" vi är
      // — så pan + prick-livscykeln saktar mjukt ner mot stillastående vid
      // paus, medan driften och pulsen längre ner går på RÅ nu-tid och
      // fortsätter oavsett (en paus känns levande, inte död).
      panStart += dt * freezeT;

      const panDur = TUNE.panDuration;
      const holdMs = reduceMotion ? 1e9 : holdFor(cupIds[cupIndex]);
      const igniteBase = Math.max(0, panDur - TUNE.igniteLead); // tändningen börjar strax före framkomst
      const litAt = igniteBase + TUNE.igniteSpread + TUNE.dotFade; // alla prickar helt tända
      const outStart = litAt + holdMs;                      // släckningen börjar
      const cycleEnd = outStart + TUNE.outMs;               // dags för nästa cup
      const tp = now - panStart; // tid sedan panoreringen mot denna cup började

      // Kamerapanorering — bara medan tp < panDur; sedan sitter kameran
      // still (bara driften nedan rör den).
      if (!reduceMotion) {
        const target = cupCam[cupIds[cupIndex]];
        const te = easeInOutCubic(Math.min(1, tp / panDur));
        cam.lng = camStart.lng + (target.lng - camStart.lng) * te;
        cam.lat = camStart.lat + (target.lat - camStart.lat) * te;
        cam.zoom = camStart.zoom + (target.zoom - camStart.zoom) * te;
      }

      // Manuellt vald cup (se selectCup) — pausa FÖRST när prickarna hunnit
      // tändas helt, så man ser den färdigt upplysta cupen.
      if (animState.pauseAfterArrival && tp >= litAt) {
        animState.pauseAfterArrival = false;
        animState.paused = true;
        syncPlayPauseButton();
      }

      // Nästa cup — först när släckningen är klar (och vi inte är pausade).
      if (!reduceMotion && !animState.paused && tp >= cycleEnd) {
        cupIndex = (cupIndex + 1) % cupIds.length;
        camStart = { lng: cam.lng, lat: cam.lat, zoom: cam.zoom };
        panStart = now;
        genDots(cupIds[cupIndex]);
      }

      // Långsam, avgränsad "jordglobs-drift" — två sinusar med olika
      // period/fas så rörelsen inte känns som ett enkelt fram-och-tillbaka.
      // Räknas alltid på RÅ tid (now), oavsett paus. Amplituden skalas UPP
      // ju mer inzoomad en cup är (driftFactor): en hårt inzoomad cup
      // kändes annars nästan stillastående.
      const driftFactor = TUNE.drift * (1 + Math.max(0, cam.zoom - baseZoom) * TUNE.driftZoom);
      const driftLat = reduceMotion ? 0 : Math.sin(now / 142000 + 1.3) * 0.55 * driftFactor;
      const driftLng = reduceMotion ? 0 : Math.sin(now / 106000) * 0.9 * driftFactor;

      // Robust mot ogiltiga centrum: en uppskruvad drift (testreglagen kan
      // gå högt) kan annars putta latituden utanför Web Mercators ±85 och
      // få MapLibre att kasta. Klamra latitud, wrappa longitud, och fall
      // tillbaka på ett säkert värde om något blivit NaN.
      let clat = cam.lat + driftLat, clng = cam.lng + driftLng;
      if (!Number.isFinite(clat)) clat = Number.isFinite(cam.lat) ? cam.lat : 60;
      if (!Number.isFinite(clng)) clng = Number.isFinite(cam.lng) ? cam.lng : 15;
      clat = Math.max(-85, Math.min(85, clat));
      clng = ((clng + 180) % 360 + 360) % 360 - 180;
      map.jumpTo({ center: [clng, clat], zoom: Number.isFinite(cam.zoom) ? cam.zoom : baseZoom });

      // Prickarna: EGET transparent lager ovanpå den riktiga kartan —
      // clearRect (inte en halvtransparent fyllning) så den underliggande
      // kartan aldrig tonas, och varje pricks tändning syns exakt som den är.
      ctx.clearRect(0, 0, dw, dh);

      // Tre färger efter hur exakt en punkt är placerad (tredje talet i
      // varje [lat,lng,tier], se build_landing_map.py): tier 0 = känd
      // klubbadress, tier 1 = bara land känt (slumpad inom landet), tier 2
      // = ingen geodata (grupperad nära övriga). Ljust tema behöver mörkare/
      // mättade färger som syns mot en ljus, ofiltrerad karta; mörkt tema
      // ljusa glödande. Avläst live varje bildruta så en temaväxling (se
      // themeToggleBtn) slår igenom direkt även medan överlägget är öppet.
      // På localhost styrs färgerna av testpanelens COLORS (live-justerbara);
      // i produktion används samma värden fast hårdkodade (byte-identiskt).
      const dark = isDarkTheme();
      let tierSprites;
      if (isLocal) {
        const c = themeColors();
        tierSprites = [0, 1, 2].map((i) =>
          glowSprite(hexToRgb(c["mark" + i]), deriveDot(c["mark" + i], dark)));
      } else {
        tierSprites = dark
          ? [glowSprite("246, 196, 16", "255, 232, 150"),  // adress — guld
             glowSprite("90, 180, 240", "190, 225, 255"),  // land — blå
             glowSprite("150, 160, 175", "205, 212, 224")] // okänd — grå
          : [glowSprite("214, 47, 39", "130, 18, 13"),      // adress — röd
             glowSprite("30, 100, 200", "12, 45, 110"),     // land — blå
             glowSprite("110, 120, 138", "70, 80, 96")];    // okänd — grå
      }

      const cup = cupsData[cupIds[cupIndex]];
      const half = SPRITE_SIZE / 2;

      // Cup-nivåns kuvert (samma tändnings-/släcknings-envelope men utan
      // per-prick-stagger) — driver inforutans opacitet och när stat-korten
      // uppdateras.
      let cupAlpha;
      if (reduceMotion) cupAlpha = 1;
      else if (tp < igniteBase) cupAlpha = 0;
      else if (tp >= outStart) cupAlpha = Math.max(0, 1 - (tp - outStart) / TUNE.outMs);
      else cupAlpha = Math.min(1, (tp - igniteBase) / (TUNE.igniteSpread + TUNE.dotFade));

      cup.points.forEach(([lat, lng, tier], i) => {
        const p = map.project([lng, lat]);
        const x = p.x, y = p.y;
        if (x < -20 || y < -20 || x > dw + 20 || y > dh + 20) return; // utanför synligt läge
        // Grund-opacitet ur pricken EGNA livscykel: släckt under
        // panoreringen, tänds vid sitt egna (slumpade) dröjsmål nära
        // framkomst, full under "framme", släcks vid avfärd.
        let base;
        if (reduceMotion) {
          base = 1;
        } else {
          const ig = igniteBase + (dotDelays[i] || 0) * TUNE.igniteSpread;
          if (tp < ig) base = 0;
          else if (tp >= outStart) base = Math.max(0, 1 - (tp - outStart) / TUNE.outMs);
          else base = Math.min(1, (tp - ig) / TUNE.dotFade);
        }
        if (base <= 0.01) return;
        // Egen pulstakt/-fas per prick (rå tid → pulsen fortsätter även vid
        // paus), så de "tindrar" i otakt i stället för att andas synkront.
        // pulseAmp styr styrkan (0 = ingen puls), pulseSpeed hastigheten.
        const pulse = reduceMotion ? 1
          : (1 - TUNE.pulseAmp) + TUNE.pulseAmp * Math.sin(now * dotRate[i] * TUNE.pulseSpeed + dotPhase[i]);
        const alpha = base * pulse;
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(tierSprites[tier] || tierSprites[0], x - half, y - half, SPRITE_SIZE, SPRITE_SIZE);
      });
      ctx.globalAlpha = 1;

      // Inforutan i hörnet — tonar in/ut med cupens kuvert.
      nameTitleEl.textContent = cup.name;
      nameCountEl.textContent = fmtNum(cup.count || cup.points.length) + " lag";
      nameEl.style.opacity = String(0.85 * cupAlpha);

      // Hero-texten och stat-korten uppdateras när den nya cupen börjar
      // tändas (inte redan när kameran lämnar den förra), så namn/siffror
      // byts i takt med att prickarna dyker upp.
      if (onCupChange && cupAlpha > 0 && lastReportedCupId !== cupIds[cupIndex]) {
        lastReportedCupId = cupIds[cupIndex];
        onCupChange(cup, cupIds[cupIndex]);
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    // --- utvecklar-panel (bara localhost / ?tune) ----------------------
    // Live-reglage för att känna sig fram till bra värden på drift,
    // panorering, zoom OCH färger + testa olika kartstilar/filter, med en
    // knapp som kopierar de valda värdena så de kan klistras in och bakas
    // in inför deploy. Byggs ALDRIG i produktion (isLocal, se ovan).
    const OFM = "https://tiles.openfreemap.org/styles/";
    const MAP_STYLES = ["liberty", "bright", "positron", "dark", "fiord"];
    const DARK_FILTER = "invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.92) saturate(0.85)";
    let curStyle = "liberty";
    let curFilter = "auto"; // auto = låt CSS-temavariabeln styra; on/off = tvinga
    function mapCanvas() { return mapEl.querySelector(".maplibregl-canvas"); }
    function applyFilter() {
      const cv = mapCanvas();
      if (!cv) return;
      cv.style.filter = curFilter === "auto" ? "" : (curFilter === "on" ? DARK_FILTER : "none");
    }
    map.on("styledata", applyFilter);

    let tuneCleanup = null;
    if (isLocal) buildTunePanel();

    function buildTunePanel() {
      const overlayEl = mapEl.closest(".welcome-overlay");
      const panel = h("div", { class: "welcome-tune" });
      const syncers = []; // funktioner som läser om aktivt temas värden till widgetarna

      // Sätter CSS-variablerna för AKTIVT tema inline på överlägget (bara
      // localhost) — markörfärgerna läses direkt ur COLORS i frame().
      function applyColors() {
        const c = themeColors();
        overlayEl.style.setProperty("--welcome-accent", c.accent);
        overlayEl.style.setProperty("--ink", c.ink);
        overlayEl.style.setProperty("--ink-soft", c.inkSoft);
        overlayEl.style.setProperty("--welcome-card-bg", hexA(c.cardBg, c.cardBgA));
        overlayEl.style.setProperty("--welcome-border", hexA(c.border, c.borderA));
      }

      function numRow(obj, key, label, min, max, step, after) {
        const val = h("span", { class: "welcome-tune-val" }, String(obj()[key]));
        const input = h("input", {
          type: "range", min: String(min), max: String(max), step: String(step),
          value: String(obj()[key]), autocomplete: "off",
          oninput: (e) => { obj()[key] = parseFloat(e.target.value); val.textContent = e.target.value; if (after) after(); },
        });
        syncers.push(() => { input.value = String(obj()[key]); val.textContent = String(obj()[key]); });
        return h("label", { class: "welcome-tune-row" }, h("span", null, label), val, input);
      }
      function colorRow(key, label) {
        const input = h("input", {
          type: "color", value: themeColors()[key], autocomplete: "off",
          oninput: (e) => { themeColors()[key] = e.target.value; applyColors(); },
        });
        syncers.push(() => { input.value = themeColors()[key]; });
        return h("label", { class: "welcome-tune-row" }, h("span", null, label), h("span", null, ""), input);
      }

      const tune = () => TUNE;
      const styleSel = h("select", {
        autocomplete: "off",
        onchange: (e) => { curStyle = e.target.value; map.setStyle(OFM + curStyle); },
      }, MAP_STYLES.map((s) => h("option", { value: s }, s)));
      styleSel.value = curStyle; // undvik att Chrome återställer ett gammalt widget-val vid reload
      const filterSel = h("select", {
        autocomplete: "off",
        onchange: (e) => { curFilter = e.target.value; applyFilter(); },
      }, ["auto", "on", "off"].map((f) => h("option", { value: f }, "filter: " + f)));
      filterSel.value = curFilter;
      // Chrome kan återställa ett tidigare valt dropdown-värde vid reload —
      // låt då KARTAN följa widgeten (behåll senaste val) i stället för att
      // de glider isär. Läses efter att widgetarna byggts.
      curStyle = styleSel.value;
      if (curStyle !== "liberty") map.setStyle(OFM + curStyle);
      curFilter = filterSel.value;
      applyFilter();

      const copyBtn = h("button", {
        type: "button",
        onclick: () => {
          const c = themeColors();
          const theme = isDarkTheme() ? "mörkt" : "ljust";
          const txt =
            `tema=${theme} stil=${curStyle} filter=${curFilter}\n` +
            `drift=${TUNE.drift} driftZoom=${TUNE.driftZoom} panDuration=${TUNE.panDuration} ` +
            `maxZoomAbove=${TUNE.maxZoomAbove} minZoom=${TUNE.minZoom}\n` +
            `igniteLead=${TUNE.igniteLead} igniteSpread=${TUNE.igniteSpread} dotFade=${TUNE.dotFade} ` +
            `holdBase=${TUNE.holdBase} outMs=${TUNE.outMs} pulseAmp=${TUNE.pulseAmp} pulseSpeed=${TUNE.pulseSpeed}\n` +
            `accent=${c.accent} ink=${c.ink} inkSoft=${c.inkSoft} ` +
            `cardBg=${c.cardBg}@${c.cardBgA} border=${c.border}@${c.borderA} ` +
            `mark0=${c.mark0} mark1=${c.mark1} mark2=${c.mark2}`;
          navigator.clipboard.writeText(txt).then(
            () => { copyBtn.textContent = "kopierat! ✓"; setTimeout(() => (copyBtn.textContent = "kopiera inställningar"), 1500); },
            () => { copyBtn.textContent = "kunde ej kopiera"; });
        },
      }, "kopiera inställningar");

      panel.append(
        h("div", { class: "welcome-tune-head" }, "⚙ testreglage (localhost)"),
        h("div", { class: "welcome-tune-sub" }, "Rörelse & zoom"),
        numRow(tune, "drift", "Drift-styrka", 0, 4, 0.1),
        numRow(tune, "driftZoom", "Drift × inzoom", 0, 3, 0.1),
        numRow(tune, "panDuration", "Panorering (ms)", 1000, 15000, 250),
        numRow(tune, "maxZoomAbove", "Max inzoom", 0, 4, 0.1),
        numRow(tune, "minZoom", "Min utzoom", 1, 6, 0.1),
        h("div", { class: "welcome-tune-sub" }, "Markörer: tändning & puls"),
        numRow(tune, "igniteLead", "Tänd före framkomst (ms)", 0, 3000, 50),
        numRow(tune, "igniteSpread", "Tändnings-spridning (ms)", 0, 4000, 50),
        numRow(tune, "dotFade", "Tonings­tid per prick (ms)", 50, 2000, 50),
        numRow(tune, "holdBase", "Framme-tid, bas (ms)", 800, 12000, 200),
        numRow(tune, "outMs", "Släcknings­tid (ms)", 100, 4000, 50),
        numRow(tune, "pulseAmp", "Pulsstyrka", 0, 0.6, 0.02),
        numRow(tune, "pulseSpeed", "Pulshastighet", 0.2, 4, 0.1),
        h("div", { class: "welcome-tune-sub" }, "Karta"),
        h("label", { class: "welcome-tune-row" }, h("span", null, "Kartstil"), h("span", null, ""), styleSel),
        h("label", { class: "welcome-tune-row" }, h("span", null, "Mörkläggning"), h("span", null, ""), filterSel),
        h("div", { class: "welcome-tune-sub" }, "Färger (aktivt tema)"),
        colorRow("accent", "Accent (text)"),
        colorRow("ink", "Rubriktext"),
        colorRow("inkSoft", "Brödtext"),
        colorRow("cardBg", "Kortbakgrund"),
        numRow(themeColors, "cardBgA", "— genomskinl.", 0, 1, 0.02, applyColors),
        colorRow("border", "Kortkant"),
        numRow(themeColors, "borderA", "— genomskinl.", 0, 1, 0.02, applyColors),
        colorRow("mark0", "Markör adress"),
        colorRow("mark1", "Markör land"),
        colorRow("mark2", "Markör okänd"),
        copyBtn);
      mapEl.parentNode.append(panel);
      applyColors();

      // När temat växlas (temaknappen sätter data-theme på <html>) ska
      // panelen visa OCH tillämpa det nya temats färger.
      const obs = new MutationObserver(() => { applyColors(); syncers.forEach((fn) => fn()); });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      tuneCleanup = () => obs.disconnect();
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      if (tuneCleanup) tuneCleanup();
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
    document.removeEventListener("click", onOutsideClick);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      const overlay = document.querySelector(".welcome-overlay");
      if (overlay) closeWelcome(overlay);
    }
  }

  // Stänger cup-väljarens dropup vid klick utanför den — hittar den
  // aktuella instansens element via querySelector (i stället för att
  // stänga över en specifik instans) så samma modulnivå-lyssnare kan
  // läggas på/tas bort en gång per öppning, precis som onKeydown ovan.
  function onOutsideClick(e) {
    const dropup = document.querySelector(".welcome-cup-dropup");
    const picker = document.querySelector(".welcome-cup-picker");
    if (!dropup || !picker) return;
    if (!dropup.hasAttribute("hidden") && !picker.contains(e.target) && !dropup.contains(e.target)) {
      dropup.setAttribute("hidden", "");
      picker.setAttribute("aria-expanded", "false");
    }
  }

  async function openWelcome() {
    if (document.querySelector(".welcome-overlay")) return; // redan öppet

    const mapEl = h("div", { class: "welcome-map" });
    const dotCanvas = h("canvas", { class: "welcome-dots" });
    const nameEl = h("div", { class: "welcome-cup-text" });
    const animState = { paused: false, pauseAfterArrival: false };
    const playPauseBtn = h("button", {
      class: "welcome-playpause", type: "button", "aria-label": "Pausa animationen",
      onclick: () => {
        // Ett manuellt klick vinner alltid över en väntande auto-paus
        // (se pauseAfterArrival i startMapAnimation/selectCup) — annars
        // skulle en nyss vald cup kunna återpausas av sig själv strax
        // efter att man själv tryckt play.
        animState.pauseAfterArrival = false;
        animState.paused = !animState.paused;
        playPauseBtn.textContent = animState.paused ? "▶" : "⏸";
        playPauseBtn.setAttribute("aria-label", animState.paused ? "Fortsätt animationen" : "Pausa animationen");
      },
    }, "⏸");

    // Klick på cupnamnet öppnar en "dropup" (öppnas UPPÅT, inte neråt —
    // rutan sitter redan längst ner i bilden) där man själv kan välja
    // vilken cup som visas, i stället för att bara vänta på att den
    // rullar förbi. Listan fylls i av startMapAnimation (som är den enda
    // som känner till cupIds/cupsData när de väl laddats).
    const cupDropup = h("ul", { class: "welcome-cup-dropup", role: "listbox", hidden: "" });
    const cupPickerBtn = h("button", {
      class: "welcome-cup-picker", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false",
      onclick: () => {
        const open = cupDropup.hasAttribute("hidden");
        if (open) cupDropup.removeAttribute("hidden"); else cupDropup.setAttribute("hidden", "");
        cupPickerBtn.setAttribute("aria-expanded", String(open));
      },
    }, nameEl, h("span", { class: "welcome-cup-caret", "aria-hidden": "true" }, "▾"));
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
    let totalCountries = 0; // ur landing-map.json:s _meta, se fetch-anropet nedan
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
      // "år arkiverade" och "sedan X" var tidigare två separata kort —
      // slagna ihop till ett (stort tal = antal år, undertext = sedan-år)
      // för att göra plats åt LÄNDER-kortet nedan.
      const vals = [
        [pc.place || "–", "plats", fmtNum(s.cups) + " cuper totalt"],
        [fmtNum(cup.count || cup.points.length), "lag", "av " + fmtNum(s.teams) + " totalt"],
        [fmtNum(pc.matches), "matcher", "av " + fmtNum(s.matches) + " totalt"],
        [fmtNum(cup.countries || 0), "länder", "av " + fmtNum(totalCountries) + " totalt"],
        [pc.editions + " år", "sedan " + pc.sinceYear, "av " + fmtNum(s.totalYears) + " totalt"],
      ];
      vals.forEach(([v, l, sm], i) => {
        statRefs[i].strong.textContent = v; statRefs[i].span.textContent = l; statRefs[i].small.textContent = sm;
      });
    }

    const overlay = h("div", { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Välkommen" },
      mapEl,
      dotCanvas,
      h("div", { class: "welcome-cup-controls" }, cupPickerBtn, playPauseBtn, cupDropup),
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
    document.addEventListener("click", onOutsideClick);

    fetch("data/landing-map.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((cupsData) => {
        totalCountries = (cupsData && cupsData._meta && cupsData._meta.totalCountries) || 0;
        stopAnimationPromise = startMapAnimation(
          mapEl, dotCanvas, nameEl, cupsData || {}, animState, setCupStats,
          cupPickerBtn, cupDropup, playPauseBtn);
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
