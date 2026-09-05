/* api.js — klient mot Cup Managers results-API.
   API:t är GraphQL-likt: ett anrop returnerar en platt entitets-store
   {href: {entity}} där entiteter refererar varandra via {href: "..."}. */

window.HB = window.HB || {};

(function () {
  const PAGE = 1000;     // matcher per sida
  const CONC = 4;        // parallella sidor per våg
  const MAX_PAGES = 40;  // säkerhetstak
  const CACHE_SCHEMA_VERSION = 3;
  const SUBCACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const SNAPSHOT_BUCKET_MS = 60 * 1000;
  let snapshotIndexBucket = -1;
  let snapshotIndexPromise = null;
  const snapshotFilePromises = new Map();

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

  // Publika klienter läser cupens GEMENSAMMA, CI-byggda snapshot i stället
  // för att varje webbläsare ska belasta källsystemet. Query-parametern är
  // avsiktligt minut-bucketad (inte slumpad): den bryter en gammal
  // webbläsarcache men ger alla användare samma CDN-nyckel under minuten.
  // Ett stort antal samtidiga klick på "Kontrollera senaste" kan därmed
  // absorberas av GitHub Pages/CDN och leder aldrig till motsvarande antal
  // anrop mot Cup Manager.
  function sharedSnapshotPath(cup) {
    return cup.dataUrl || ("data/snapshot-" + cup.id + ".json");
  }

  function versionedUrl(base, version) {
    const sep = base.includes("?") ? "&" : "?";
    return base + sep + "v=" + encodeURIComponent(version);
  }

  async function fetchSnapshotIndex(now = Date.now()) {
    const bucket = Math.floor(now / SNAPSHOT_BUCKET_MS);
    if (snapshotIndexPromise && snapshotIndexBucket === bucket) return snapshotIndexPromise;
    snapshotIndexBucket = bucket;
    snapshotIndexPromise = fetch(versionedUrl("data/snapshot-index.json", bucket), {
      headers: { accept: "application/json" }, cache: "default",
    }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then((j) => (j && j.cups) || {});
    return snapshotIndexPromise;
  }

  async function fetchSharedSnapshot(cup, knownDataTs = 0) {
    let entry = null;
    try {
      const index = await fetchSnapshotIndex();
      entry = index[cup.id] || null;
    } catch {
      // Övergång/offline mot en äldre deploy utan index: prova själva
      // snapshotfilen med en delad minutversion i stället.
    }
    const sourceTs = Number(entry && entry.ts) || 0;
    if (knownDataTs > 0 && sourceTs > 0 && sourceTs === knownDataTs) {
      return { unchanged: true, ts: sourceTs };
    }

    const base = (entry && entry.url) || sharedSnapshotPath(cup);
    const version = sourceTs || Math.floor(Date.now() / SNAPSHOT_BUCKET_MS);
    const requestUrl = versionedUrl(base, version);
    let pending = snapshotFilePromises.get(requestUrl);
    if (!pending) {
      pending = fetch(requestUrl, {
        headers: { accept: "application/json" }, cache: "default",
      }).then(async (r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).finally(() => snapshotFilePromises.delete(requestUrl));
      snapshotFilePromises.set(requestUrl, pending);
    }
    const j = await pending;
    if (!j || !Array.isArray(j.matches)) throw new Error("Ogiltig snapshot");

    if (cup.dataUrl) {
      localTables[cup.id] = j.tables || {};
      localPlayoffs[cup.id] = j.playoffs || {};
      localRosters[cup.id] = j.rosters || {};
    }
    localDataTs[cup.id] = Number(j.ts) || 0;
    const hasClubs = Object.prototype.hasOwnProperty.call(j, "clubs");
    const hasArenas = Object.prototype.hasOwnProperty.call(j, "arenas");
    // ProCup/Gothia saknar normalt dessa fält. Lämna då objekten OSETTA så
    // appens klubbkatalog-/arenafallback faktiskt får köra; en truthy `{}`
    // hade felaktigt signalerat "redan laddat".
    if (hasClubs) clubGeo[cup.id] = j.clubs || {};
    else delete clubGeo[cup.id];
    if (hasArenas) arenaGeo[cup.id] = j.arenas || {};
    else delete arenaGeo[cup.id];
    return {
      unchanged: false,
      ts: Number(j.ts) || sourceTs || 0,
      matches: j.matches,
      clubs: j.clubs || {},
      arenas: j.arenas || {},
      hasClubs,
      hasArenas,
    };
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

  // club:{address:...} ger klubbens registrerade postadress (stad+
  // koordinater+land), gratis att hänga med här eftersom store:n redan
  // deduplicerar per NameClub-entitet oavsett hur många lag/matcher som
  // refererar samma klubb (se clubGeoFromStore). Används av Karta-vyn.
  //
  // club:{nation:...} (UTAN adress-hoppet) är ett andra, oberoende fält —
  // en klubb kan sakna registrerad adress helt (vanligt för utländska lag)
  // men ändå ha en nation ifylld direkt på NameClub-entiteten. Ger en
  // landskod på VARJE match (se normalize() nedan) helt utan namnmatchning
  // mot klubbkatalogen — håll i synk med scripts/fetch_cupmanager.py.
  const TEAM_FIELDS =
    "{club:{address:{address:{city:{},lat:{},lng:{},nation:{name:{},code:{}}}},nation:{code:{}}}}";

  // Arena (BANAN) -> Location (PLATSEN) -> Address. Samma "gratis"-princip
  // som TEAM_FIELDS klubbadress: store:n deduplicerar per entitet, så
  // uppslaget kostar inga extra anrop hur många matcher banan än har.
  // Flera banor delar ofta location — Åhus Beach har 18 arenor på EN,
  // eftersom banorna ligger utspridda på samma inhägnade område. Håll i
  // synk med scripts/fetch_cupmanager.py:s arenas_from_store.
  const ARENA_FIELDS =
    "{completeName:{},fieldName:{},location:{name:{},address:{street:{},city:{},lat:{},lng:{}}}}";

  function matchQuery(cup, limit, offset) {
    return (
      "MatchWindow({limit:" + limit + ",offset:" + offset +
      ",tournamentId:" + cup.tournamentId + "})" +
      "{matches:[{... on Match:{start:{},arena:" + ARENA_FIELDS + ",round:{}," +
      "away:{team:" + TEAM_FIELDS + "},division:{category:{},name:{}}," +
      "home:{team:" + TEAM_FIELDS + "},result:{}}}]}"
    );
  }

  // Lätt census: samma MatchWindow, men bara ett billigt Match-fält.
  // Entitetens id och __typename kommer alltid med i store-svaret. Den gör
  // att inkrementell synk kan upptäcka HELT NYA matcher utan att först
  // hämta alla lag, arenor, divisioner och resultat igen.
  function matchIdQuery(cup, limit, offset) {
    return (
      "MatchWindow({limit:" + limit + ",offset:" + offset +
      ",tournamentId:" + cup.tournamentId + "})" +
      "{matches:[{... on Match:{start:{}}}]}"
    );
  }

  async function fetchMatchIds(cup) {
    const ids = new Set();
    function absorb(resp) {
      let count = 0;
      for (const value of Object.values((resp && resp.responses) || {})) {
        const entity = value && value.entity;
        if (!entity || entity.__typename !== "Match") continue;
        if (entity.id != null) ids.add(String(entity.id));
        count++;
      }
      return count;
    }

    // De flesta cuper ryms på en sida. Hämta den ensam först i stället
    // för att alltid starta fyra anrop som den fulla, tunga hämtningen gör.
    let offset = 0;
    const firstCount = absorb(await call(cup, matchIdQuery(cup, PAGE, offset)));
    if (firstCount < PAGE) return ids;
    offset += PAGE;

    // Även sida två tas ensam: cuper med 1 000–1 999 matcher är vanliga,
    // och ska inte behöva tre tomma sidfrågor bara för att sida ett var full.
    const secondCount = absorb(await call(cup, matchIdQuery(cup, PAGE, offset)));
    if (secondCount < PAGE) return ids;
    offset += PAGE;

    while (offset / PAGE < MAX_PAGES) {
      const offsets = [];
      for (let i = 0; i < CONC && (offset / PAGE) + i < MAX_PAGES; i++) {
        offsets.push(offset + i * PAGE);
      }
      const counts = await Promise.all(offsets.map(async (pageOffset) =>
        absorb(await call(cup, matchIdQuery(cup, PAGE, pageOffset)))));
      if (counts.some((count) => count < PAGE)) break;
      offset += offsets.length * PAGE;
    }
    return ids;
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

  function normalizeStart(value) {
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  // Landskod direkt från en matchsidas (home/away) team.club.nation, utan
  // att gå via adressen — samma tvåstegs-hopp som clubGeoFromStore (club ->
  // nation), håll i synk med scripts/fetch_cupmanager.py:s club_nation_code.
  function clubNationCode(store, side) {
    const club = storeGet(store, (storeGet(store, side.team) || {}).club) || {};
    const nation = storeGet(store, club.nation) || {};
    return nation.code || null;
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
        start: normalizeStart(e.start), // 0 = tid ej satt
        arena: arena.completeName || arena.fieldName || "",
        divId: division.id || refId(e.division),
        divName: nameOf(division),
        // "Conference" (gruppspel) eller "Playoff" (slutspel) — enda
        // tillförlitliga sättet att skilja dem åt för t.ex. divisionsToShow()
        // (Tabeller-vyn ska bara visa grupptabeller, inte slutspelsträd).
        divType: division.__typename || "",
        catId: catId,
        catName: nameOf(category),
        roundName: nameOf(round),
        // club: rena klubbnamnet (NameClub.name) UTAN lagsuffix, till
        // skillnad från "name" (fullt lagnamn, t.ex. "Alingsås HK Blå") —
        // kräver ingen extra fråga, home/away:s team:{club:{...}} är redan
        // hämtat för Karta-vyns adress (se TEAM_FIELDS), bara ett extra
        // steg genom store:n. Används av Trends klubbräkning.
        home: {
          id: home.id || refId(home.team), name: nameOf(home),
          club: (storeGet(store, (storeGet(store, home.team) || {}).club) || {}).name || null,
          country: clubNationCode(store, home),
        },
        away: {
          id: away.id || refId(away.team), name: nameOf(away),
          club: (storeGet(store, (storeGet(store, away.team) || {}).club) || {}).name || null,
          country: clubNationCode(store, away),
        },
        res: result,
      });
    }
    matches.sort((a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"));
    return matches;
  }

  // cupId -> {klubbnamn: {city, lat, lng}} — Karta-vyn i app.js läser
  // direkt ur det här (delat, muterbart) objektet. Fylls antingen här
  // (live/inkrementell hämtning, se nedan) eller direkt av app.js:s
  // loadCup() när en CI-byggd snapshot redan har fältet färdigt.
  const clubGeo = {};

  // {klubbnamn: {city, lat, lng, country}} — bara klubbar med en ifylld
  // adress (saknas för enstaka lag utan klubbadress). Två hopp: NameClub.
  // address är en referens till en NameClub$NameClubAddress-wrapper vars
  // EGET address-fält pekar på den riktiga Address-entiteten (samma
  // indirektion som scripts/fetch_cupmanager.py:s clubs_from_store — håll
  // dem i synk). country: landskoden (t.ex. "SE") — stabil oavsett språk,
  // till skillnad från nationens översatta namn.
  function clubGeoFromStore(store) {
    const geo = {};
    for (const e of Object.values(store)) {
      if (e.__typename !== "NameClub" || !e.name) continue;
      const wrap = storeGet(store, e.address);
      const addr = wrap && storeGet(store, wrap.address);
      if (!addr || addr.lat == null || addr.lng == null) continue;
      const nation = storeGet(store, addr.nation) || {};
      geo[e.name] = {
        city: addr.city || "", lat: addr.lat, lng: addr.lng,
        country: nation.code || "",
      };
    }
    return geo;
  }

  // cupId -> {banans namn: {venue, street, city, lat, lng, loc}} — Bana-vyn
  // i app.js läser direkt ur det här (delat, muterbart) objektet, precis som
  // Karta-vyn gör med clubGeo. Nyckeln är SAMMA sträng som matchernas
  // arena-fält bär, så uppslaget blir en ren dict-slagning.
  const arenaGeo = {};

  // {banans namn: {venue, street, city, lat, lng, loc}} — bara banor med
  // ifylld adress. Ett hopp mindre än clubGeoFromStore: Location.address
  // pekar direkt på Address-entiteten. venue/loc är PLATSEN banan tillhör,
  // se ARENA_FIELDS. Håll i synk med arenas_from_store i
  // scripts/fetch_cupmanager.py.
  function arenaGeoFromStore(store) {
    const geo = {};
    for (const e of Object.values(store)) {
      if (e.__typename !== "Arena") continue;
      const name = e.completeName || e.fieldName || "";
      if (!name) continue;
      const loc = storeGet(store, e.location);
      const addr = loc && storeGet(store, loc.address);
      if (!addr || addr.lat == null || addr.lng == null) continue;
      geo[name] = {
        venue: loc.name || "", street: addr.street || "", city: addr.city || "",
        lat: addr.lat, lng: addr.lng, loc: loc.id,
      };
    }
    return geo;
  }

  // --- förhämtad data (ProCup-cuper utan API/CORS) -----------------------

  const localTables = {};   // cupId -> {divId: rows}
  const localPlayoffs = {}; // cupId -> {catId: [{id, name, matches}]} (bara cuper som har det, se cup.hasPlayoffs)
  const localRosters = {};  // cupId -> {teamId: [{name, shirtNr, position, goals}]} (bara Gothia-cuper hittills)
  const localDataTs = {};   // cupId -> när skrapan senast kördes

  async function fetchLocal(cup) {
    const r = await fetch(cup.dataUrl + "?_=" + Date.now().toString(36), {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    localTables[cup.id] = j.tables || {};
    localPlayoffs[cup.id] = j.playoffs || {};
    localRosters[cup.id] = j.rosters || {};
    localDataTs[cup.id] = j.ts || 0;
    return j.matches || [];
  }

  // Truppdata finns bara för dataUrl-cuper vars skrapa faktiskt bygger den
  // (Partille/Gothia, se scripts/fetch_gothia.py) — [] annars, tyst.
  function fetchRoster(cup, teamId) {
    if (!cup.dataUrl) return [];
    return (localRosters[cup.id] || {})[teamId] || [];
  }

  function snapshotTable(cup, divisionId) {
    return ((localTables[cup.id] || {})[divisionId] || []).slice();
  }

  function snapshotPlayoffs(cup, categoryId) {
    return ((localPlayoffs[cup.id] || {})[categoryId] || []).slice();
  }

  // Samma fältlista som matchQuery() ger per match i MatchWindow — håller
  // enskilda Match({id})-anrop och den stora fönsterfrågan strukturellt
  // identiska så normalize() kan användas rakt av på båda.
  function singleMatchFields() {
    return "{start:{},arena:" + ARENA_FIELDS + ",round:{},away:{team:" + TEAM_FIELDS + "}," +
      "division:{category:{},name:{}},home:{team:" + TEAM_FIELDS + "},result:{}}";
  }

  // Cup Managers API stödjer inte att slå ihop flera Match({id})-frågor i
  // ETT anrop (testat: kommatecken/array-syntax/ids-parameter ger antingen
  // bara första matchen eller HTTP 500) — varje match kräver ett eget
  // anrop. Lönar sig ändå: de allra flesta matcherna i en cup är redan
  // AVGJORDA ändras sällan, så bara de OSPELADE behöver hämtas om vid
  // vanliga liveuppdateringar. app.js gör fortfarande en full kontroll när
  // en avslutad cups långa TTL löper ut, så efterhandsrättningar tappas inte.
  const INCREMENTAL_MAX = 300; // fler ospelade än så: enskilda anrop lönar sig inte längre

  async function fetchIncremental(cup, cachedMatches, onProgress) {
    if (cup.dataUrl) return null; // ProCup: stöds inte, kör full hämtning
    const knownIds = new Set(cachedMatches
      .map((match) => match.id)
      .filter((id) => id != null)
      .map(String));
    const sourceIds = await fetchMatchIds(cup);
    if (sourceIds.size !== knownIds.size ||
        [...sourceIds].some((id) => !knownIds.has(id))) {
      return null; // anroparen faller tillbaka på full fetchMatches()
    }
    const unfinished = cachedMatches.filter((m) => !(m.res && m.res.fin));
    if (!unfinished.length) return cachedMatches; // inget kan ha ändrats — inget att hämta
    if (unfinished.length > INCREMENTAL_MAX) return null; // för många — full hämtning är snabbare
    const fresh = await fetchMatchesByIds(cup, unfinished.map((m) => m.id), onProgress);
    const freshById = new Map(fresh.map((m) => [m.id, m]));
    const merged = cachedMatches.map((m) => freshById.get(m.id) || m);
    merged.sort((a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"));
    return merged;
  }

  // Hämta ett fåtal namngivna matcher direkt från källan. Används dels av
  // fetchIncremental ovan, dels av liveifyllnaden i app.js: den
  // gemensamma snapshotten byggs av CI och kan ligga några minuter efter,
  // och under matchtid frågar appen därför källan själv om just de
  // matcher som saknar slutresultat (se domain/live-gap.js).
  //
  // ProCup/Gothia (dataUrl-cuper) har ingen webbläsarvänlig väg till
  // källan — de returnerar tomt och faller tillbaka på snapshotten.
  async function fetchMatchesByIds(cup, ids, onProgress) {
    if (cup.dataUrl || !ids || !ids.length) return [];
    const combinedStore = {};
    let done = 0;
    for (let i = 0; i < ids.length; i += CONC) {
      const batch = ids.slice(i, i + CONC);
      const results = await Promise.all(
        batch.map((id) => call(cup, "Match({id:" + id + "})" + singleMatchFields())));
      for (const r of results) {
        for (const [k, v] of Object.entries(r.responses || {})) {
          if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
            combinedStore[k] = v.entity;
          }
        }
      }
      done += batch.length;
      if (onProgress) onProgress(done, ids.length);
    }
    // Slå ihop (inte ersätt): combinedStore täcker bara de efterfrågade
    // matchernas lag/klubbar — att skriva över hela clubGeo[cup.id] här
    // skulle tappa alla klubbar från övriga matcher.
    Object.assign(clubGeo[cup.id] = clubGeo[cup.id] || {}, clubGeoFromStore(combinedStore));
    // Samma sammanslagning för banorna: en bana utan efterfrågade matcher
    // finns inte i combinedStore, och skulle tappas av en rak överskrivning.
    Object.assign(arenaGeo[cup.id] = arenaGeo[cup.id] || {}, arenaGeoFromStore(combinedStore));
    return normalize(combinedStore);
  }

  async function fetchMatches(cup, onProgress) {
    if (cup.dataUrl) return fetchLocal(cup);
    const store = await fetchStore(cup, onProgress);
    clubGeo[cup.id] = clubGeoFromStore(store);
    arenaGeo[cup.id] = arenaGeoFromStore(store);
    const matches = normalize(store);
    return matches;
  }

  // --- tabeller ---------------------------------------------------------

  // `cacheable` skickas in av app.js (som känner till matchresultaten) och
  // är bara true när ALLA matcher i divisionen/kategorin redan är klara —
  // då ändras svaret sällan och får sparas i localStorage. readSubCache
  // har en 24-timmars TTL och manuell/full refresh invaliderar posterna. Är det
  // inte klarspelat hämtas alltid färskt (ingen cache-läsning, ingen skrivning).
  async function fetchTable(cup, divisionId, cacheable) {
    if (cup.dataUrl) return (localTables[cup.id] || {})[divisionId] || [];
    if (cacheable) {
      const cached = readSubCache(cup, "table", divisionId);
      if (cached) return cached;
    }
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
    const rows = (!ent || !Array.isArray(ent.rows)) ? [] : ent.rows.map((r) => ({
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
    if (cacheable && rows.length) writeSubCache(cup, "table", divisionId, rows);
    return rows;
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
  async function fetchGroupDivisions(cup, categoryId, cacheable) {
    if (cup.dataUrl) return [];
    if (cacheable) {
      const cached = readSubCache(cup, "groupdivs", categoryId);
      if (cached) return cached;
    }
    const resp = (await call(cup, groupDivisionsQuery(categoryId, cup.tournamentId))).responses || {};
    const flatStore = {};
    for (const [k, v] of Object.entries(resp)) {
      if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
        flatStore[k] = v.entity;
      }
    }
    const divs = Object.values(flatStore)
      .filter((e) => e.__typename === "Conference" && e.id != null)
      .map((d) => ({ id: d.id, name: nameOf(d) }));
    if (cacheable && divs.length) writeSubCache(cup, "groupdivs", categoryId, divs);
    return divs;
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
      start: normalizeStart(e.start),
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
  async function fetchPlayoffs(cup, categoryId, cacheable) {
    // Bara några dataUrl-cuper (t.ex. Partille, skrapad av
    // scripts/fetch_gothia.py) har en playoffs-struktur i sin JSON —
    // ProCup-skrapan (fetch_procup.py) bygger ingen sådan än.
    if (cup.dataUrl) return (localPlayoffs[cup.id] || {})[categoryId] || [];
    if (cacheable) {
      const cached = readSubCache(cup, "playoffs", categoryId);
      if (cached) return cached;
    }
    const resp = (await call(cup, playoffQuery(categoryId, cup.tournamentId))).responses || {};
    const flatStore = {};
    for (const [k, v] of Object.entries(resp)) {
      if (v && typeof v === "object" && v.entity && typeof v.entity === "object") {
        flatStore[k] = v.entity;
      }
    }
    // Object.values ger ingen garanterad ordning (beror på JSON-svarets
    // nyckelordning) — utan den här sorteringen kunde A-/B-/C-Slutspel
    // komma i vilken ordning som helst (t.ex. A/C/B). Namnen sorterar
    // redan rätt bokstavsordning (A- före B- före C-Slutspel).
    const divisions = Object.values(flatStore)
      .filter((e) => e.__typename === "Playoff")
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "sv", { numeric: true }));
    const result = divisions.map((div) => {
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
    if (cacheable && result.length) writeSubCache(cup, "playoffs", categoryId, result);
    return result;
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
        start: normalizeStart(m.start),
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
      const cached = JSON.parse(raw);
      if (!cached || cached.schema !== CACHE_SCHEMA_VERSION ||
          !Array.isArray(cached.matches)) {
        localStorage.removeItem(cacheKey(cup));
        return null;
      }
      return cached;
    } catch {
      return null;
    }
  }

  // Största cache-post vi ens FÖRSÖKER skriva. Firefox ger 5 MB per origin
  // (Chrome ~10), och en enda stor cup kan spränga hela budgeten på egen
  // hand — Åhus Beach är 6382 matcher ≈ 8,7 MB som UTF-16. En sådan post
  // får ALDRIG plats i Firefox, men försöket slänger ut alla andra cupers
  // cache på vägen (reservlogiken nedan) och lämnar kvoten spikad, så att
  // nästa ofarliga localStorage-skrivning (saveUi/saveSettings i app.js)
  // kastar. Hoppa hellre över cachen helt: loadCup() faller då tillbaka på
  // den CI-byggda snapshotten, exakt som vid ett förstabesök.
  //
  // 2 MB: lämnar plats för två cachade cuper inom Firefox budget. Bara de
  // riktigt stora (Åhus, Eken, Göteborg Fotboll) hamnar över — resten
  // cachas som förut, och kolliderar de ändå tar den befintliga
  // utrymmesröjningen nedan hand om det.
  const MAX_CACHE_BYTES = 2e6;

  function writeCache(cup, matches, checkedAt, dataTs) {
    // clubs (Karta-vyns adressdata) och arenas (Bana-vyns) hänger med i
    // samma cache-post — de
    // fylls redan (live/inkrementellt eller från snapshotten) i
    // clubGeo[cup.id] innan writeCache() anropas, se fetchMatches/
    // fetchIncremental ovan och loadCup() i app.js.
    const payload = JSON.stringify({ schema: CACHE_SCHEMA_VERSION,
                                     ts: checkedAt || Date.now(),
                                     dataTs: dataTs || localDataTs[cup.id] || 0, matches,
                                     clubs: clubGeo[cup.id], arenas: arenaGeo[cup.id] });
    if (payload.length * 2 > MAX_CACHE_BYTES) { // *2: localStorage lagrar UTF-16
      try { localStorage.removeItem(cacheKey(cup)); } catch { /* ingen lagring alls */ }
      return;
    }
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

  // Samma cache-mönster som ovan, men generellt för mindre delsvar
  // (gruppställning/slutspelsträd/gruppdivisioner) som app.js bara skickar
  // in som `cacheable` när ALLA berörda matcher redan är klara — se
  // fetchTable/fetchGroupDivisions/fetchPlayoffs ovan.
  function subCacheKey(cup, kind, id) {
    return "hb:" + kind + ":" + cup.id + ":" + cup.tournamentId + ":" + id;
  }

  function readSubCache(cup, kind, id) {
    try {
      const raw = localStorage.getItem(subCacheKey(cup, kind, id));
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || cached.schema !== CACHE_SCHEMA_VERSION ||
          !Number.isFinite(cached.ts) || Date.now() - cached.ts > SUBCACHE_MAX_AGE_MS) {
        localStorage.removeItem(subCacheKey(cup, kind, id));
        return null;
      }
      return cached.data;
    } catch {
      return null;
    }
  }

  function writeSubCache(cup, kind, id, data) {
    const payload = JSON.stringify({ schema: CACHE_SCHEMA_VERSION, ts: Date.now(), data });
    const key = subCacheKey(cup, kind, id);
    try {
      localStorage.setItem(key, payload);
    } catch {
      // Fullt: släng andra sparade delsvar av samma slag och försök igen.
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("hb:" + kind + ":") && k !== key) localStorage.removeItem(k);
        }
        localStorage.setItem(key, payload);
      } catch { /* kör vidare utan cache */ }
    }
  }

  function invalidateSubCaches(cup) {
    const prefixes = ["table", "playoffs", "groupdivs"].map((kind) =>
      "hb:" + kind + ":" + cup.id + ":" + cup.tournamentId + ":");
    try {
      for (const key of Object.keys(localStorage)) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) {
          localStorage.removeItem(key);
        }
      }
    } catch { /* blockerad lagring: minnesstate rensas fortfarande av appen */ }
  }

  // --- historik: arkiverade resultat från tidigare cupupplagor -------------
  // data/archive/index.json + data/archive/<cupId>-<edition>.json byggs av
  // scripts/archive_results.py vid varje CI-körning. index.json är litet och
  // ändras ofta (nya upplagor/pågående cuper) — hämtas alltid färskt, ingen
  // egen cache. De enskilda upplagefilerna är däremot STORA (flera MB var,
  // ~150 MB totalt över alla ~190 cup-år i skrivande stund) och en AVSLUTAD
  // upplaga (entry.finished === entry.matches, dvs alla matcher klara) kan
  // aldrig ändras igen — cachas därför permanent i en egen IndexedDB-databas
  // (se archiveDbGet/Set nedan), INTE localStorage (för litet kvot-tak för
  // såna här filstorlekar) eller webbläsarens vanliga HTTP-cache (GitHub
  // Pages cache-control är bara 10 min, för kort för att lita på ensam). En
  // PÅGÅENDE upplaga (innevarande säsong) hämtas alltid färskt.

  let archiveIndexPromise = null;

  function fetchArchiveIndex() {
    if (!archiveIndexPromise) {
      archiveIndexPromise = fetch("data/archive/index.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return archiveIndexPromise;
  }

  // {cupId: {edition: [rå lagnamn, ...]}}, byggd av scripts/build_team_
  // index.py — under 1 MB (bara namn, ingen matchdata), till skillnad från
  // de fulla arkivfilerna (flera MB var). Klubb/Lag (app.js: computeClubRows)
  // slår upp den HÄR först för att avgöra vilka cup-år som ens KAN innehålla
  // en sökning, i stället för att hämta ALLA arkiverade upplagor av ALLA
  // cuper och filtrera efteråt. Cachas i sig via webbläsarens vanliga HTTP-
  // cache (ingen no-store) — liten och ändras sällan (bara när en NY
  // arkiverad upplaga tillkommer), så ingen egen IndexedDB-logik behövs.
  let teamIndexPromise = null;

  function fetchTeamIndex() {
    if (!teamIndexPromise) {
      teamIndexPromise = fetch("data/archive/team-index.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return teamIndexPromise;
  }

  // Minimal IndexedDB-wrapper — en enda "editions"-store, nyckel
  // "cupId:edition". Faller tyst tillbaka till "ingen cache" (null) om
  // IndexedDB saknas eller inte går att öppna (t.ex. privat läge i vissa
  // äldre webbläsare) i stället för att krascha något.
  const ARCHIVE_DB_NAME = "hboll-archive";
  const ARCHIVE_DB_VERSION = 1;
  const ARCHIVE_STORE = "editions";
  let archiveDbPromise = null;

  function openArchiveDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (!archiveDbPromise) {
      archiveDbPromise = new Promise((resolve) => {
        let req;
        try {
          req = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION);
        } catch {
          resolve(null);
          return;
        }
        req.onupgradeneeded = () => req.result.createObjectStore(ARCHIVE_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    }
    return archiveDbPromise;
  }

  function archiveDbGet(key) {
    return openArchiveDb().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = db.transaction(ARCHIVE_STORE, "readonly").objectStore(ARCHIVE_STORE).get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  function archiveDbSet(key, value) {
    openArchiveDb().then((db) => {
      if (!db) return;
      try {
        db.transaction(ARCHIVE_STORE, "readwrite").objectStore(ARCHIVE_STORE).put(value, key);
      } catch { /* full kvot eller liknande — kör vidare utan att cacha just den här */ }
    });
  }

  async function fetchArchiveEdition(cupId, edition) {
    const idx = await fetchArchiveIndex();
    const entry = (idx[cupId] && idx[cupId].editions || [])
      .find((e) => e.edition === edition);
    if (!entry) return null;
    // "Alla KÄNDA matcher är klara" räcker INTE ensamt — cupens EGEN, just
    // nu pågående upplaga (HB.CUPS[].edition) kan fortfarande få NYA matcher
    // tillagda av skraparen (nya klasser, sena anmälningar) även om allt som
    // redan finns i filen råkar vara avgjort just i detta ögonblick. Uteslut
    // den uttryckligen, annars skulle den kunna cachas permanent för tidigt
    // och aldrig se de nya matcherna.
    const cup = (HB.allCups() || []).find((c) => c.id === cupId);
    const isLiveEdition = cup && String(cup.edition) === String(edition);
    const finished = entry.matches > 0 && entry.finished === entry.matches && !isLiveEdition;
    const dbKey = cupId + ":" + edition;
    if (finished) {
      const cached = await archiveDbGet(dbKey);
      // ts-jämförelse: entry.ts kommer från index.json och byts av
      // scripts/archive_results.py varje gång FILEN faktiskt skrivs om —
      // en cachad post vars ts inte matchar är inaktuell (t.ex. en
      // efterhandsrättning av redan "avslutad" data, som
      // landsbakåtskrapningen som redan hänt en gång i det här projektet)
      // och ska hämtas om, INTE tas som god fast "finished" fortfarande
      // stämmer. Gamla cacheposter (innan detta fält fanns) saknar .ts och
      // räknas därför också som inaktuella — självläkande, ingen separat
      // migrering behövs.
      if (cached && cached.ts === entry.ts) return cached.data;
    }
    try {
      // Ingen cache:"no-store" längre — en pågående upplaga får då åtminstone
      // webbläsarens vanliga (kortlivade) HTTP-cache under en session.
      const r = await fetch(entry.file);
      if (!r.ok) return null;
      const data = await r.json();
      if (finished) archiveDbSet(dbKey, { ts: entry.ts, data });
      return data;
    } catch {
      return null;
    }
  }

  // Mästarlistan (data/champions.json, byggd av scripts/archive_results.py) —
  // en rad per A-slutspelsfinal över alla arkiverade cup-upplagor. Liten
  // (~100 kB) och ändras bara när en ny final avgjorts, så samma lätta
  // no-store-hämtning som arkivindexet; Vinnare-fliken (app.js) läser den.
  let championsPromise = null;

  function fetchChampions() {
    if (!championsPromise) {
      championsPromise = fetch("data/champions.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .catch(() => ({ rows: [] }));
    }
    return championsPromise;
  }

  // {klubbnamn: {city,lat,lng,country}} slagit ihop från ALLA klassiska Cup
  // Manager-cupers klubbadresser (scripts/build_club_directory.py) — Karta-
  // vyn i app.js slår upp ProCup/Gothia-cupernas lagnamn mot den här (de
  // saknar egen adressdata helt) via samma prefixmatchning som clubTeamCounts.
  let clubDirectoryPromise = null;

  function fetchClubDirectory() {
    if (!clubDirectoryPromise) {
      clubDirectoryPromise = fetch("data/club-directory.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return clubDirectoryPromise;
  }

  HB.api = { call, refId, nameOf, storeGet, fetchSharedSnapshot,
             fetchMatches, fetchIncremental, fetchMatchesByIds, fetchTable,
             fetchPlayoffs, fetchGroupDivisions, fetchPreviousMeetings, fetchRoster,
             snapshotTable, snapshotPlayoffs,
             readCache, writeCache, localDataTs, clubGeo, arenaGeo,
             invalidateSubCaches,
             fetchArchiveIndex, fetchArchiveEdition, fetchClubDirectory, fetchTeamIndex,
             fetchChampions };
})();
