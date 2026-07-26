/* welcome.js — välkomstöverlägg för nya besökare: en kort presentation av
   appen, riktiga (inte hårdkodade) siffror räknade ur redan hämtad data,
   och en animerad "kartbakgrund" där klubbpunkter tänds cup för cup
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

  function startMapAnimation(canvas, cupsData, worldOutline) {
    const ctx = canvas.getContext("2d");
    const cupIds = Object.keys(cupsData);
    if (!cupIds.length) return () => {};

    // Global "hemvy" — täcker (nästan) alla klubbpunkter i alla cuper.
    // Det här är den utzoomade ramen som varje enskild cups eget läge
    // sedan zoomar in eller ut ifrån, beroende på hur geografiskt spridd
    // just den cupen är.
    const allPoints = cupIds.flatMap((id) => cupsData[id].points);
    const baseBB = percentileBBox(allPoints, 0.02, 0.98);
    const baseCenterLat = (baseBB.minLat + baseBB.maxLat) / 2;
    const baseCenterLng = (baseBB.minLng + baseBB.maxLng) / 2;
    const BASE_PAD = 1.35;
    const baseSpanLat = (baseBB.maxLat - baseBB.minLat) * BASE_PAD || 4;
    const baseSpanLng = (baseBB.maxLng - baseBB.minLng) * BASE_PAD || 4;

    // Per-cup målram: centrum + spridning (med golv så att en handfull
    // punkter på samma ort inte zoomar in till ett nästan osynligt prick).
    const CUP_PAD = 1.9;
    const cupFrame = {};
    for (const id of cupIds) {
      const pts = cupsData[id].points;
      const bb = percentileBBox(pts, 0.1, 0.9);
      cupFrame[id] = {
        lat: (bb.minLat + bb.maxLat) / 2,
        lng: (bb.minLng + bb.maxLng) / 2,
        spanLat: Math.max(0.9, (bb.maxLat - bb.minLat) * CUP_PAD),
        spanLng: Math.max(0.9, (bb.maxLng - bb.minLng) * CUP_PAD),
      };
    }

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // Kameran (cam) är den faktiskt uppritade ramen — den glider mjukt
    // (exponentiell utjämning, bildrutetakt-oberoende) mot targetFrame,
    // som byts till den aktuella cupens ram varje gång cupIndex ändras.
    // driftLat/driftLng läggs ovanpå som en långsam, avgränsad, cyklisk
    // "nån snurrar sakta på en jordglob"-rörelse — helt oberoende av
    // cup-cykeln, så kartan aldrig står helt stilla.
    const cam = { lat: baseCenterLat, lng: baseCenterLng, spanLat: baseSpanLat, spanLng: baseSpanLng };
    const CAM_TAU = 3200;

    function project(lat, lng, dLat, dLng) {
      const clat = cam.lat + dLat, clng = cam.lng + dLng;
      const x = ((lng - (clng - cam.spanLng / 2)) / cam.spanLng) * w;
      const y = (1 - (lat - (clat - cam.spanLat / 2)) / cam.spanLat) * h;
      return [x, y];
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cupIndex = 0;
    let phase = "in";
    let phaseStart = performance.now();
    const DUR = reduceMotion
      ? { in: 0, hold: 1e9, out: 0 } // still bild av första cupen, ingen cykling, ingen kamerarörelse
      : { in: 1500, hold: 2200, out: 700 };
    const STAGGER_MS = 900; // hur mycket varje prick kan slumpas att dröja innan den börjar tändas
    const DOT_FADE_MS = 480; // hur lång tid en enskild prick tar att tändas, från sin egen starttid

    // Slumpad, individuell tändningsfördröjning per prick — genereras om
    // varje gång vi går vidare till en ny cup.
    let dotDelays = cupIds.length ? cupsData[cupIds[0]].points.map(() => Math.random() * STAGGER_MS) : [];

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

      // Mjuk, kontinuerlig glidning mot den aktuella cupens ram — oberoende
      // av in/hold/out (som bara styr prickarnas opacitet), så panoreringen
      // och zoomningen aldrig hackar till vid cup-byten.
      if (!reduceMotion) {
        const target = cupFrame[cupIds[cupIndex]];
        const k = 1 - Math.exp(-dt / CAM_TAU);
        cam.lat += (target.lat - cam.lat) * k;
        cam.lng += (target.lng - cam.lng) * k;
        cam.spanLat += (target.spanLat - cam.spanLat) * k;
        cam.spanLng += (target.spanLng - cam.spanLng) * k;
      }

      // Långsam, avgränsad "jordglobs-drift" — två sinusar med olika
      // period/fas så rörelsen inte känns som ett enkelt fram-och-tillbaka.
      const driftLat = reduceMotion ? 0 : Math.sin(now / 52000 + 1.3) * 2.2;
      const driftLng = reduceMotion ? 0 : Math.sin(now / 38000) * 6;

      // Halvtransparent mörk rektangel i stället för clearRect — ger
      // både prickar och kustlinjer ett svagt "svans"-släp vid rörelse,
      // snarare än ett hackigt hopp mellan bildrutor.
      ctx.fillStyle = "rgba(15, 23, 35, 0.22)";
      ctx.fillRect(0, 0, w, h);

      // Världskartans konturer — tecknas under prickarna, ger animationen
      // en faktisk geografisk kontext i stället för fritt svävande punkter.
      if (worldOutline && worldOutline.rings) {
        ctx.beginPath();
        for (const ring of worldOutline.rings) {
          let started = false;
          for (const [lat, lng] of ring) {
            const [x, y] = project(lat, lng, driftLat, driftLng);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
        ctx.fill();
        ctx.strokeStyle = "rgba(158, 190, 222, 0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const cup = cupsData[cupIds[cupIndex]];
      const inElapsed = phase === "in" ? elapsed : DUR.in;
      const outT = phase === "out" ? Math.min(1, elapsed / DUR.out) : 0;
      cup.points.forEach(([lat, lng], i) => {
        const [x, y] = project(lat, lng, driftLat, driftLng);
        let alpha;
        if (phase === "out") {
          alpha = 1 - outT;
        } else {
          const localT = reduceMotion ? DOT_FADE_MS : inElapsed - (dotDelays[i] || 0);
          alpha = Math.max(0, Math.min(1, localT / DOT_FADE_MS));
        }
        if (alpha <= 0.01) return;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
        glow.addColorStop(0, `rgba(246, 196, 16, ${0.55 * alpha})`);
        glow.addColorStop(1, "rgba(246, 196, 16, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 9, y - 9, 18, 18);
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 232, 150, ${Math.min(1, alpha + 0.15)})`;
        ctx.fill();
      });

      // Cupnamnet i hörnet — knyter animationen till "X cuper"-siffran.
      const nameAlpha = phase === "out" ? 1 - outT : Math.min(1, inElapsed / DOT_FADE_MS);
      ctx.font = "600 13px Barlow, sans-serif";
      ctx.fillStyle = `rgba(238, 242, 248, ${0.55 * nameAlpha})`;
      ctx.textBaseline = "bottom";
      ctx.fillText(cup.name, 16, h - 14);

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }

  // --- överlägget --------------------------------------------------------

  let stopAnimation = null;

  function closeWelcome(overlay) {
    localStorage.setItem(SEEN_KEY, "1");
    if (stopAnimation) { stopAnimation(); stopAnimation = null; }
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

    const canvas = h("canvas", { class: "welcome-canvas" });
    const statsHost = h("div", { class: "welcome-stats" },
      h("div", { class: "welcome-stat" }, h("strong", null, "…")));
    const overlay = h("div", { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Välkommen" },
      canvas,
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

    Promise.all([
      fetch("data/landing-map.json").then((r) => (r.ok ? r.json() : {})),
      fetch("data/world-outline.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cupsData, worldOutline]) => {
        stopAnimation = startMapAnimation(canvas, cupsData || {}, worldOutline);
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
