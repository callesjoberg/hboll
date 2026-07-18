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
      // \w*[Ii]d: fångar inte bara "id:" utan även t.ex. "categoryId:" —
      // Category-referenser saknar ett rent "id"-fält (parametern heter
      // categoryId), så den strikta varianten missade dem helt (gav alltid
      // null). Första träffen är alltid entitetens primära id i den här
      // API:ts href-mönster.
      const m = /\w*[Ii]d:(\d+)/.exec(node.href || "");
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

  // Samma fältlista som matchQuery() ger per match i MatchWindow — håller
  // enskilda Match({id})-anrop och den stora fönsterfrågan strukturellt
  // identiska så normalize() kan användas rakt av på båda.
  function singleMatchFields() {
    return "{start:{},arena:{},round:{},away:{team:{}}," +
      "division:{category:{},name:{}},home:{team:{}},result:{}}";
  }

  // Cup Managers API stödjer inte att slå ihop flera Match({id})-frågor i
  // ETT anrop (testat: kommatecken/array-syntax/ids-parameter ger antingen
  // bara första matchen eller HTTP 500) — varje match kräver ett eget
  // anrop. Lönar sig ändå: de allra flesta matcherna i en cup är redan
  // AVGJORDA och kan aldrig ändras, så bara de OSPELADE behöver hämtas om
  // vid en uppdatering i stället för att slå om hela MatchWindow-fönstret.
  const INCREMENTAL_MAX = 300; // fler ospelade än så: enskilda anrop lönar sig inte längre

  async function fetchIncremental(cup, cachedMatches, onProgress) {
    if (cup.dataUrl) return null; // ProCup: stöds inte, kör full hämtning
    const unfinished = cachedMatches.filter((m) => !(m.res && m.res.fin));
    if (!unfinished.length) return cachedMatches; // inget kan ha ändrats — inget att hämta
    if (unfinished.length > INCREMENTAL_MAX) return null; // för många — full hämtning är snabbare
    const combinedStore = {};
    let done = 0;
    for (let i = 0; i < unfinished.length; i += CONC) {
      const batch = unfinished.slice(i, i + CONC);
      const results = await Promise.all(
        batch.map((m) => call(cup, "Match({id:" + m.id + "})" + singleMatchFields())));
      for (const r of results) {
        for (const [k, v] of Object.entries(r.responses || {})) {
          if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
            combinedStore[k] = v.entity;
          }
        }
      }
      done += batch.length;
      if (onProgress) onProgress(done, unfinished.length);
    }
    const freshById = new Map(normalize(combinedStore).map((m) => [m.id, m]));
    const merged = cachedMatches.map((m) => freshById.get(m.id) || m);
    merged.sort((a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"));
    return merged;
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

  // --- gruppdivisioner (för slutspelsprognos) ------------------------------

  function groupDivisionsQuery(categoryId, tournamentId) {
    return (
      "Category({categoryId:" + categoryId + ",tournamentId:" + tournamentId + "})" +
      "{stages:[{... on Stage:{divisions:[{... on Division:{name:{}}}]}}]}"
    );
  }

  // Gruppspels-divisionerna ("Grupp 1", "Grupp 2" osv, typ Conference) för
  // en kategori — id+namn, används för att slå upp respektive grupps
  // tabell via fetchTable() och därigenom lösa upp slutspelets
  // platshållarnamn ("N:an i Grupp M") mot nuvarande tabellplacering.
  async function fetchGroupDivisions(cup, categoryId) {
    if (cup.dataUrl) return [];
    const resp = (await call(cup, groupDivisionsQuery(categoryId, cup.tournamentId))).responses || {};
    const flatStore = {};
    for (const [k, v] of Object.entries(resp)) {
      if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
        flatStore[k] = v.entity;
      }
    }
    return Object.values(flatStore)
      .filter((e) => e.__typename === "Conference" && e.id != null)
      .map((d) => ({ id: d.id, name: nameOf(d) }));
  }

  // --- slutspel (A/B/C) och inbördes möten ---------------------------------

  function playoffQuery(categoryId, tournamentId) {
    return (
      "Category({categoryId:" + categoryId + ",tournamentId:" + tournamentId + "})" +
      "{stages:[{... on Stage:{divisions:[{... on Division:{name:{}," +
      "matches:[{... on Match:{start:{},arena:{},round:{},roundRank:{}," +
      "nextMatchWinner:{},nextMatchLoser:{},home:{team:{}},away:{team:{}},result:{}}}]}}]}}]}"
    );
  }

  function normPlayoffMatch(e, store) {
    const home = storeGet(store, e.home) || {};
    const away = storeGet(store, e.away) || {};
    const round = storeGet(store, e.round) || {};
    const rr = storeGet(store, e.roundRank) || {};
    const nextW = storeGet(store, e.nextMatchWinner) || {};
    const nextL = storeGet(store, e.nextMatchLoser) || {};
    return {
      id: e.id,
      start: e.start || 0,
      arena: (storeGet(store, e.arena) || {}).completeName || "",
      home: { id: home.id || refId(home.team), name: nameOf(home) },
      away: { id: away.id || refId(away.team), name: nameOf(away) },
      res: normalizeResult(storeGet(store, e.result)),
      roundRank: round.rank ?? 99,      // 0 = final, högre = tidigare omgång
      roundName: nameOf(round),
      matchRank: rr.rank ?? 0,          // position inom omgången
      nextWinnerId: refId(nextW.match),
      nextLoserId: refId(nextL.match),
      matchNr: e.matchNr || null,       // Cup Managers eget matchnummer (t.ex. "18072146"),
                                         // ingår redan i grundentiteten utan extra queryfält
    };
  }

  // Alla slutspelsträd (Playoff-divisioner, t.ex. A-/B-/C-Slutspel) för en
  // kategori, i ett enda anrop. Tomt om kategorin saknar slutspel än.
  async function fetchPlayoffs(cup, categoryId) {
    if (cup.dataUrl) return []; // ProCup: slutspelsdata stöds inte ännu
    const resp = (await call(cup, playoffQuery(categoryId, cup.tournamentId))).responses || {};
    const flatStore = {};
    for (const [k, v] of Object.entries(resp)) {
      if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
        flatStore[k] = v.entity;
      }
    }
    const divisions = Object.values(flatStore)
      .filter((e) => e.__typename === "Playoff");
    return divisions.map((div) => {
      const divName = nameOf(div);
      // div.matches är en referens till en egen topnyckel ("$matches"),
      // inte en direkt inline-array — samma platta store-mönster som
      // MatchActor$originalName, Team$statistics osv.
      const matches = (storeGet(flatStore, div.matches) || [])
        .map((ref) => storeGet(flatStore, ref))
        .filter(Boolean)
        .map((m) => {
          const nm = normPlayoffMatch(m, flatStore);
          nm.divId = div.id ?? null;
          nm.divName = divName;
          nm.catId = categoryId;
          return nm;
        });
      return { id: div.id ?? null, name: divName, matches };
    }).filter((d) => d.matches.length);
  }

  // Historiska möten mellan lagen i en given match (samma kategori/cup).
  async function fetchPreviousMeetings(cup, matchId) {
    if (cup.dataUrl) return [];
    const q = "Match({id:" + matchId + "})" +
      "{previousMeetings:[{... on Match:{start:{},home:{team:{}},away:{team:{}},result:{}}}]}";
    const resp = (await call(cup, q)).responses || {};
    const store = {};
    for (const [k, v] of Object.entries(resp)) {
      if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
        store[k] = v.entity;
      }
    }
    const outer = store["Match({id:" + matchId + "})"];
    // Samma platta store-mönster som i fetchPlayoffs: previousMeetings är
    // en referens till en egen topnyckel, inte en inline-array.
    const refs = (outer && storeGet(store, outer.previousMeetings)) || [];
    return refs.map((ref) => storeGet(store, ref)).filter(Boolean).map((m) => {
      const home = storeGet(store, m.home) || {};
      const away = storeGet(store, m.away) || {};
      return {
        id: m.id,
        start: m.start || 0,
        home: { id: home.id || refId(home.team), name: nameOf(home) },
        away: { id: away.id || refId(away.team), name: nameOf(away) },
        res: normalizeResult(storeGet(store, m.result)),
      };
    }).sort((a, b) => b.start - a.start);
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

  // --- historik: arkiverade resultat från tidigare cupupplagor -------------
  // data/archive/index.json + data/archive/<cupId>-<edition>.json byggs av
  // scripts/archive_results.py vid varje CI-körning. Ren statisk JSON, ingen
  // egen cache behövs (webbläsaren HTTP-cachar filerna som allt annat).

  let archiveIndexPromise = null;

  function fetchArchiveIndex() {
    if (!archiveIndexPromise) {
      archiveIndexPromise = fetch("data/archive/index.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return archiveIndexPromise;
  }

  async function fetchArchiveEdition(cupId, edition) {
    const idx = await fetchArchiveIndex();
    const entry = (idx[cupId] && idx[cupId].editions || [])
      .find((e) => e.edition === edition);
    if (!entry) return null;
    try {
      const r = await fetch(entry.file, { cache: "no-store" });
      return r.ok ? r.json() : null;
    } catch {
      return null;
    }
  }

  HB.api = { call, refId, nameOf, storeGet, fetchMatches, fetchIncremental, fetchTable,
             fetchPlayoffs, fetchGroupDivisions, fetchPreviousMeetings,
             readCache, writeCache, localDataTs,
             fetchArchiveIndex, fetchArchiveEdition };
})();
