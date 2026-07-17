/* api.js — klient mot Cup Managers results-API.
   API:t är GraphQL-likt: ett anrop returnerar en platt entitets-store
   {href: {entity}} där entiteter refererar varandra via {href: "..."}. */

window.HB = window.HB || {};

(function () {
  const PAGE = 1000;     // matcher per sida
  const CONC = 4;        // parallella sidor per våg
  const MAX_PAGES = 40;  // säkerhetstak

  function apiUrl(cup, query) {
    // &_ cache-bustar: cupmanagers proxycache saknar "Vary: Origin" och
    // serverar annars cachade svar med fel CORS-origin (static.cupmanager.net).
    return (
      "https://" + cup.host + "/rest/results_api/call?call=" +
      encodeURIComponent(query) + "&lang=sv&tournamentId=" + cup.tournamentId +
      "&_=" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  async function call(cup, query, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(apiUrl(cup, query), {
          headers: { accept: "application/json" },
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 800 * (i + 1)));
      }
    }
    throw lastErr;
  }

  // --- entitetshjälpare -----------------------------------------------

  function refId(node) {
    if (node && typeof node === "object") {
      const m = /id:(\d+)/.exec(node.href || "");
      if (m) return +m[1];
    }
    return null;
  }

  function nameOf(entity) {
    const n = entity && entity.name;
    if (n && typeof n === "object") {
      return n.sv || n.en || Object.values(n)[0] || "";
    }
    return n || "";
  }

  function storeGet(store, ref) {
    if (!ref) return null;
    return store[typeof ref === "string" ? ref : ref.href] || null;
  }

  function matchQuery(cup, limit, offset) {
    return (
      "MatchWindow({limit:" + limit + ",offset:" + offset +
      ",tournamentId:" + cup.tournamentId + "})" +
      "{matches:[{... on Match:{start:{},arena:{},round:{}," +
      "away:{team:{}},division:{category:{},name:{}}," +
      "home:{team:{}},result:{}}}]}"
    );
  }

  // --- hämta + normalisera alla matcher --------------------------------

  async function fetchStore(cup, onProgress) {
    // Sidor hämtas i vågor om CONC parallella anrop tills en sida är kort.
    const store = {};
    let matchCount = 0;

    function absorb(resp) {
      let pageMatches = 0;
      for (const [k, v] of Object.entries(resp || {})) {
        if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
          store[k] = v.entity;
          if (v.entity.__typename === "Match") pageMatches++;
        }
      }
      return pageMatches;
    }

    let offset = 0;
    for (let wave = 0; wave * CONC < MAX_PAGES; wave++) {
      const offsets = [];
      for (let i = 0; i < CONC; i++) offsets.push(offset + i * PAGE);
      const results = await Promise.all(
        offsets.map((o) => call(cup, matchQuery(cup, PAGE, o))));
      let short = false;
      for (const r of results) {
        const n = absorb(r.responses);
        matchCount += n;
        if (n < PAGE) short = true;
      }
      if (onProgress) onProgress(matchCount);
      if (short) break;
      offset += CONC * PAGE;
    }
    return store;
  }

  function normalizeResult(res) {
    if (!res || res.__typename !== "MatchResult") return null;
    return {
      fin: !!res.finished,
      live: !!res.live,
      hg: res.homeGoals || 0,
      ag: res.awayGoals || 0,
      hsw: res.homeSetsWon || 0,
      asw: res.awaySetsWon || 0,
      winByPeriods: !!res.winByPeriods,
      per: (res.periodScores || []).map((p) => ({ h: p.homeGoals, a: p.awayGoals })),
      wo: !!res.walkover,
      winner: res.winner || null,
      hidden: !!res.hideGoalResults,
    };
  }

  function normalize(store) {
    const matches = [];
    for (const e of Object.values(store)) {
      if (e.__typename !== "Match") continue;
      const home = storeGet(store, e.home) || {};
      const away = storeGet(store, e.away) || {};
      const arena = storeGet(store, e.arena) || {};
      const division = storeGet(store, e.division) || {};
      const category = storeGet(store, division.category) || {};
      const round = storeGet(store, e.round) || {};
      const result = normalizeResult(storeGet(store, e.result));
      const catId = refId(division.category);
      matches.push({
        id: e.id,
        start: e.start || 0, // svensk väggtid kodad som UTC-epoch-ms
        arena: arena.completeName || arena.fieldName || "",
        divId: division.id || refId(e.division),
        divName: nameOf(division),
        catId: catId,
        catName: nameOf(category),
        roundName: nameOf(round),
        home: { id: home.id || refId(home.team), name: nameOf(home) },
        away: { id: away.id || refId(away.team), name: nameOf(away) },
        res: result,
      });
    }
    matches.sort((a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"));
    return matches;
  }

  // --- förhämtad data (ProCup-cuper utan API/CORS) -----------------------

  const localTables = {};   // cupId -> {divId: rows}
  const localDataTs = {};   // cupId -> när skrapan senast kördes

  async function fetchLocal(cup) {
    const r = await fetch(cup.dataUrl + "?_=" + Date.now().toString(36), {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    localTables[cup.id] = j.tables || {};
    localDataTs[cup.id] = j.ts || 0;
    return j.matches || [];
  }

  async function fetchMatches(cup, onProgress) {
    if (cup.dataUrl) return fetchLocal(cup);
    return normalize(await fetchStore(cup, onProgress));
  }

  // --- tabeller ---------------------------------------------------------

  async function fetchTable(cup, divisionId) {
    if (cup.dataUrl) return (localTables[cup.id] || {})[divisionId] || [];
    const q = "Division({id:" + divisionId + "})$table";
    const resp = (await call(cup, q)).responses || {};
    let ent = resp[q] && resp[q].entity;
    if (!ent) {
      for (const v of Object.values(resp)) {
        if (v && v.entity && v.entity.__typename === "Division$ConferenceTable") {
          ent = v.entity;
          break;
        }
      }
    }
    if (!ent || !Array.isArray(ent.rows)) return [];
    return ent.rows.map((r) => ({
      name: nameOf(r),
      teamId: refId(r.team),
      played: r.played || 0,
      won: r.won || 0,
      tied: r.tied || 0,
      lost: r.lost || 0,
      gf: r.goalsWon || 0,
      ga: Math.abs(r.goalsLost || 0), // API:t ger insläppta mål som negativt tal
      points: r.points || 0,
    }));
  }

  // --- cache i localStorage ----------------------------------------------

  function cacheKey(cup) {
    return "hb:matches:" + cup.id + ":" + cup.tournamentId;
  }

  function readCache(cup) {
    try {
      const raw = localStorage.getItem(cacheKey(cup));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeCache(cup, matches, ts) {
    const payload = JSON.stringify({ ts: ts || Date.now(), matches });
    try {
      localStorage.setItem(cacheKey(cup), payload);
    } catch {
      // Fullt: släng andra cupers cache och försök en gång till.
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("hb:matches:") && k !== cacheKey(cup)) {
            localStorage.removeItem(k);
          }
        }
        localStorage.setItem(cacheKey(cup), payload);
      } catch { /* kör vidare utan cache */ }
    }
  }

  HB.api = { call, refId, nameOf, storeGet, fetchMatches, fetchTable,
             readCache, writeCache, localDataTs };
})();
