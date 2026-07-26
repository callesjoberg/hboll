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

  // Räknar fram siffrorna att visa direkt ur det arkivindex/den
  // klubbkatalog som redan hämtas vid varje sidladdning (state i app.js
  // är inte åtkomlig härifrån — hämtar en egen, redan HTTP-cachad kopia)
  // i stället för att hårdkoda tal som skulle bli inaktuella så fort
  // fler cuper/år arkiveras.
  async function computeStats() {
    const [idxRes, dirRes] = await Promise.allSettled([
      fetch("data/archive/index.json").then((r) => (r.ok ? r.json() : {})),
      fetch("data/club-directory.json").then((r) => (r.ok ? r.json() : {})),
    ]);
    const idx = idxRes.status === "fulfilled" ? idxRes.value : {};
    const dir = dirRes.status === "fulfilled" ? dirRes.value : {};
    let cups = 0, teams = 0, matches = 0;
    const years = new Set();
    for (const entry of Object.values(idx)) {
      const editions = (entry.editions || []).filter((e) => e.matches > 0);
      if (!editions.length) continue;
      cups++;
      for (const e of editions) {
        teams += e.teams || 0;
        matches += e.matches || 0;
        years.add(e.edition);
      }
    }
    const sortedYears = [...years].sort();
    return {
      cups, teams, matches,
      clubs: Object.keys(dir).length,
      sinceYear: sortedYears[0] || null,
    };
  }

  function statChip(value, label) {
    return h("div", { class: "welcome-stat" }, h("strong", null, value), h("span", null, label));
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

  async function startMapAnimation(mapEl, dotCanvas, nameEl, cupsData) {
    const cupIds = Object.keys(cupsData);
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

    const cupCam = {};
    for (const id of cupIds) {
      const pts = cupsData[id].points;
      const bb = percentileBBox(pts, 0.1, 0.9);
      const bounds = new maplibregl.LngLatBounds([bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]);
      const c = map.cameraForBounds(bounds, { padding: 70, maxZoom: baseZoom + 2.6 });
      cupCam[id] = {
        lng: c ? c.center.lng : (bb.minLng + bb.maxLng) / 2,
        lat: c ? c.center.lat : (bb.minLat + bb.maxLat) / 2,
        zoom: Math.max(baseZoom - 0.5, Math.min(baseZoom + 2.6, c ? c.zoom : baseZoom)),
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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const first = cupCam[cupIds[0]];
    // Kameran (cam) är det faktiskt använda läget — glider mjukt (exponentiell
    // utjämning, bildrutetakt-oberoende, LÅNG tidskonstant = långsam,
    // stegfri rörelse utan hopp) mot target, som byts till den aktuella
    // cupens läge varje gång cupIndex ändras.
    const cam = { lng: first.lng, lat: first.lat, zoom: baseZoom };
    const CAM_TAU = 6500;
    map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom });

    let cupIndex = 0;
    let phase = "in";
    let phaseStart = performance.now();
    const DUR = reduceMotion
      ? { in: 0, hold: 1e9, out: 0 } // still bild av första cupen, ingen cykling, ingen kamerarörelse
      : { in: 1500, hold: 3000, out: 900 };
    const STAGGER_MS = 1000; // hur mycket varje prick kan slumpas att dröja innan den börjar tändas — "0-1s"
    const DOT_FADE_MS = 550; // hur lång tid en enskild prick tar att tändas, från sin egen starttid

    // Slumpad, individuell tändningsfördröjning per prick — genereras om
    // varje gång vi går vidare till en ny cup.
    let dotDelays = cupsData[cupIds[0]].points.map(() => Math.random() * STAGGER_MS);

    let rafId = null;
    let lastNow = performance.now();
    function frame(now) {
      const dt = Math.min(100, now - lastNow); // hoppar aldrig kameran vid t ex en bakgrundsflik
      lastNow = now;

      const elapsed = now - phaseStart;
      if (!reduceMotion && elapsed > DUR[phase]) {
        if (phase === "in") phase = "hold";
        else if (phase === "hold") phase = "out";
        else {
          phase = "in";
          cupIndex = (cupIndex + 1) % cupIds.length;
          dotDelays = cupsData[cupIds[cupIndex]].points.map(() => Math.random() * STAGGER_MS);
        }
        phaseStart = now;
      }

      // Mjuk, kontinuerlig glidning mot den aktuella cupens kameraläge —
      // oberoende av in/hold/out (som bara styr prickarnas opacitet), så
      // panoreringen och zoomningen aldrig hackar till vid cup-byten. Med
      // en så lång tidskonstant hinner kameran sällan ända fram innan
      // nästa cup redan blivit mål — en kontinuerlig, aldrig helt stilla-
      // stående glidning, snarare än separata hopp mellan lägen.
      if (!reduceMotion) {
        const target = cupCam[cupIds[cupIndex]];
        const k = 1 - Math.exp(-dt / CAM_TAU);
        cam.lng += (target.lng - cam.lng) * k;
        cam.lat += (target.lat - cam.lat) * k;
        cam.zoom += (target.zoom - cam.zoom) * k;
      }

      // Långsam, avgränsad "jordglobs-drift" — två sinusar med olika
      // period/fas så rörelsen inte känns som ett enkelt fram-och-tillbaka.
      // Liten amplitud med avsikt: ska kännas som att globen sakta
      // fortsätter snurra, inte konkurrera med cup-till-cup-panoreringen.
      const driftLat = reduceMotion ? 0 : Math.sin(now / 71000 + 1.3) * 0.55;
      const driftLng = reduceMotion ? 0 : Math.sin(now / 53000) * 0.9;

      map.jumpTo({ center: [cam.lng + driftLng, cam.lat + driftLat], zoom: cam.zoom });

      // Prickarna: EGET transparent lager ovanpå den riktiga kartan —
      // clearRect (inte en halvtransparent fyllning) så den underliggande
      // kartan aldrig tonas, och varje pricks tändning syns exakt som den är.
      ctx.clearRect(0, 0, dw, dh);

      const cup = cupsData[cupIds[cupIndex]];
      const inElapsed = phase === "in" ? elapsed : DUR.in;
      const outT = phase === "out" ? Math.min(1, elapsed / DUR.out) : 0;
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
        if (alpha <= 0.01) return;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
        glow.addColorStop(0, `rgba(246, 196, 16, ${0.6 * alpha})`);
        glow.addColorStop(1, "rgba(246, 196, 16, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 9, y - 9, 18, 18);
        ctx.beginPath();
        ctx.arc(x, y, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 232, 150, ${Math.min(1, alpha + 0.15)})`;
        ctx.fill();
      });

      // Cupnamnet i hörnet — knyter animationen till "X cuper"-siffran.
      const nameAlpha = phase === "out" ? 1 - outT : Math.min(1, inElapsed / DOT_FADE_MS);
      nameEl.textContent = cup.name;
      nameEl.style.opacity = String(0.85 * nameAlpha);

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
    const nameEl = h("div", { class: "welcome-cup-name" });
    const statsHost = h("div", { class: "welcome-stats" },
      h("div", { class: "welcome-stat" }, h("strong", null, "…")));
    const overlay = h("div", { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Välkommen" },
      mapEl,
      dotCanvas,
      nameEl,
      h("div", { class: "welcome-scrim" }),
      h("button", {
        class: "welcome-close", type: "button", "aria-label": "Stäng",
        onclick: () => closeWelcome(overlay),
      }, "×"),
      h("div", { class: "welcome-content" },
        h("div", { class: "welcome-scroll" },
          h("p", { class: "welcome-kicker" }, "Välkommen till"),
          h("h1", { class: "welcome-title" }, "Cupschema"),
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
        stopAnimationPromise = startMapAnimation(mapEl, dotCanvas, nameEl, cupsData || {});
      })
      .catch(() => {});

    computeStats().then((s) => {
      statsHost.replaceChildren(
        statChip(fmtNum(s.cups), s.cups === 1 ? "cup" : "cuper"),
        statChip(fmtNum(s.teams) + "+", "lag genom åren"),
        statChip(fmtNum(s.matches) + "+", "matcher"),
        statChip(fmtNum(s.clubs), "klubbar"),
        statChip("sedan " + (s.sinceYear || "–"), "historik"));
    }).catch(() => {});
  }

  HB.openWelcome = openWelcome;

  document.addEventListener("DOMContentLoaded", () => {
    if (!localStorage.getItem(SEEN_KEY) && !hasUrlFilters()) openWelcome();
  });
})();
