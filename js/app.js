/* app.js — vy, filter och rendering för cupschemat. */

window.HB = window.HB || {};

(function () {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // --- tid: matchstart är en äkta UTC-epok — visa i Europe/Stockholm -----

  const TZ = "Europe/Stockholm";

  const fmtTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
  const fmtDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short",
  });
  const fmtDayLong = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long",
  });
  const fmtClock = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });

  function dayKey(ms) {
    // Svensk kalenderdag (en-CA ger yyyy-mm-dd), inte UTC-datumet — en match
    // strax efter midnatt svensk tid kan annars hamna på fel dag.
    return dayKeyFmt.format(new Date(ms));
  }

  // --- kategori-hjälpare -------------------------------------------------

  function parseCat(catName) {
    // "F12", "P 12", "Flickor 12 år Classic (födda 2014)", "U12" → {g, age}
    const s = catName || "";
    let m = /\b([PFU])\s?(\d{1,2})\b/.exec(s);
    if (m) return { g: m[1].toUpperCase(), age: +m[2] };
    m = /(Flickor|Pojkar|Damer|Herrar)\s*(\d{1,2})?/i.exec(s);
    if (m) {
      const g = { f: "F", p: "P", d: "D", h: "H" }[m[1][0].toLowerCase()];
      return { g, age: m[2] ? +m[2] : 0 };
    }
    return null;
  }

  HB.shortCat = function (catName) {
    const p = parseCat(catName);
    if (!p) return (catName || "").slice(0, 8);
    return p.g + (p.age || "");
  };

  function catSortKey(catName) {
    const p = parseCat(catName);
    if (!p) return 9999;
    const gOrder = { F: 0, P: 1, U: 2, D: 3, H: 4 };
    return p.age * 10 + (gOrder[p.g] ?? 5);
  }

  function teamSuffix(name) {
    const stripped = name.replace(HB.CLUB.pattern, "").trim();
    return stripped || name;
  }

  function isClubName(name) {
    return HB.CLUB.pattern.test(name || "");
  }

  // Filnamnssäker version av ett lag-id — måste vara EXAKT samma algoritm
  // som slugify_team_id() i scripts/_ics.py, annars pekar länken fel.
  function slugifyTeamId(teamId) {
    let s = String(teamId)
      .replace(/[åä]/g, "a").replace(/ö/g, "o")
      .replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");
    s = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return s || "lag";
  }

  // Prenumererbar kalender-URL för ETT lags matcher, eller null om ingen
  // finns för den här cupen/laget. Cup Manager har en egen inbyggd
  // livetjänst (regenereras vid varje hämtning, alltid färsk) som funkar
  // för ALLA lag; dataUrl-cuper (ProCup/Gothia) saknar en sådan tjänst, så
  // där finns bara statiska filer (byggda av scripts/_ics.py, uppdaterade
  // i samma takt som resten av cupens data) och bara för klubbens egna lag
  // (annars skulle t.ex. Partilles ~1400 lag ge lika många småfiler).
  function calendarSubscribeUrl(team) {
    const c = cup();
    if (!c.dataUrl) {
      return "https://" + c.host + "/service/GetTeamCalendarService?teamId=" + team.id;
    }
    if (isClubName(team.name)) {
      return "data/ics/" + c.id + "/" + slugifyTeamId(team.id) + ".ics";
    }
    return null;
  }

  // Färgord i lagnamnet (t.ex. "Alingsås HK Blå", "Lödde Vikings HK Svart/Röd")
  // → en representativ hex-färg, för en liten prick bredvid lagnamnet.
  const TEAM_COLOR_WORDS = {
    bla: "#1f5fbf", vit: "#c9c2b4", svart: "#23303a", orange: "#e8730c",
    gul: "#f2bd0c", rod: "#d22f27", gron: "#2f9e44", rosa: "#e864a4",
    lila: "#8b5cf6", brun: "#6b4423", silver: "#9aa5b1", turkos: "#0e9aa7",
  };

  function slugifySv(s) {
    return (s || "").toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // Ett specifikt eget lag (inte hela klubben) att hålla extra koll på —
  // markeras med en ⭐ på matchkort och i nästa match-kortet. Jämförs
  // slugifierat (som lagfärgsöverstyrningarna) så stavning/skiftläge inte
  // spelar roll.
  function isFavoriteTeamName(name) {
    return !!state.favoriteTeam && slugifySv(name) === slugifySv(state.favoriteTeam);
  }

  function detectTeamColor(name) {
    for (const t of slugifySv(name).split("-")) {
      if (TEAM_COLOR_WORDS[t]) return TEAM_COLOR_WORDS[t];
    }
    return null;
  }

  // Prick bredvid lagnamnet — styrs av inställningen "Färgkoda lag".
  function teamColor(name) {
    return state.teamColors ? detectTeamColor(name) : null;
  }

  // Manuellt tilldelad färg för ett specifikt lag (exakt namn, slugifierat
  // så stavning/skiftläge inte spelar roll), oavsett cup — sparas i
  // state.teamColorOverrides som {slugifieratNamn: hexfärg}.
  function manualTeamColor(name) {
    return state.teamColorOverrides[slugifySv(name)] || null;
  }

  // Färg för HELA matchkortet: manuell lagfärg vinner alltid; annars, om
  // inställningen är på, ett upptäckt färgord i favoritklubbens eget lag.
  function cardTintColor(m) {
    const manual = manualTeamColor(m.home.name) || manualTeamColor(m.away.name);
    if (manual) return manual;
    if (!state.fullCardColors) return null;
    if (isClubName(m.home.name)) {
      const c = detectTeamColor(m.home.name);
      if (c) return c;
    }
    if (isClubName(m.away.name)) {
      const c = detectTeamColor(m.away.name);
      if (c) return c;
    }
    return null;
  }

  function isClubMatch(m) {
    return isClubName(m.home.name) || isClubName(m.away.name);
  }

  // --- klubblogga: genererad badge när favoritklubben inte är Alingsås HK -

  // Samma deterministiska fallbackpalett oavsett dator/webbläsare — ett
  // klubbnamn ger alltid samma färg (om det inte redan har ett färgord,
  // t.ex. "Lödde HK Blå", då vinner det ordet precis som lagfärgprickarna).
  const CLUB_BADGE_PALETTE = [
    "#1f5fbf", "#d22f27", "#2f9e44", "#e8730c", "#8b5cf6", "#0e9aa7", "#c9384f", "#5b6b7a",
  ];

  function clubBadgeColor(name) {
    const detected = detectTeamColor(name);
    if (detected) return detected;
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return CLUB_BADGE_PALETTE[Math.abs(hash) % CLUB_BADGE_PALETTE.length];
  }

  // "Alingsås HK" → "AHK", "IFK Kristianstad" → "IK", "Lugi HF" → "LHF" —
  // sista ordet är ofta en versal klubbförkortning (HK/IF/IK/HF/BK …); då
  // blir initialerna första bokstaven + hela den förkortningen, annars
  // första bokstaven i varje ord.
  function clubInitials(name) {
    const words = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    const last = words[words.length - 1];
    if (/^[A-ZÅÄÖ]{2,3}$/.test(last)) return (words[0][0] + last).toUpperCase().slice(0, 4);
    return words.map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
  }

  // Ren inline-SVG (ingen extern bild att hämta/spara) — en färgad cirkel
  // med klubbens initialer, samma idé som avatar-bokstäver i t.ex. Gmail.
  function clubBadgeDataUri(name) {
    const initials = clubInitials(name);
    const color = clubBadgeColor(name);
    const fontSize = initials.length >= 4 ? 13 : 15;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="20" fill="' + color + '"/>' +
      '<text x="20" y="21" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="Barlow Condensed, Arial, sans-serif" font-weight="700" ' +
      'font-size="' + fontSize + '" fill="#fff">' + escapeXml(initials) + '</text></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  // Bytt ut mot en genererad badge så fort favoritklubben skiljer sig från
  // sajtens förvalda (Alingsås HK, med sin riktiga logga) — annars ingen
  // logga att visa för en godtycklig klubb. Uppdaterar både sidhuvudets
  // <img> och webbläsarflikens favicon.
  function updateClubLogo() {
    const name = (state.favoriteClub || HB.CLUB.name).trim();
    const isDefaultClub = name.toLowerCase() === HB.CLUB.name.toLowerCase();
    const src = isDefaultClub ? HB.CLUB.logo : clubBadgeDataUri(name);
    const img = $("#clubLogo");
    if (img) { img.src = src; img.alt = isDefaultClub ? "" : name; }
    const favicon = $("#faviconLink");
    if (favicon) favicon.href = src;
  }

  // --- resultatvisning ----------------------------------------------------

  function isLive(m) {
    // Yngre klasser rapporterar inga resultat: deras matcher blir stående
    // "live" med nollor. Räkna bara pågående, ej färdiga, nutida matcher.
    return !!(m.res && m.res.live && !m.res.fin &&
      Math.abs(m.start - Date.now()) < 6 * 3600000);
  }

  function scoreText(res) {
    if (!res || (!res.fin && !res.live)) return null;
    if (res.wo) return "WO";
    if (res.hidden) return res.fin ? "spelad" : null;
    if (res.hg || res.ag) return res.hg + "–" + res.ag;
    if (res.hsw || res.asw) return res.hsw + "–" + res.asw;
    const per = (res.per || []).filter((p) => p.h || p.a);
    if (per.length) return per.map((p) => p.h + "–" + p.a).join(", ");
    // Spelad utan rapporterat resultat (yngre klasser).
    return res.fin ? "spelad" : null;
  }

  // Vilket lag som är "vårt" perspektiv för resultatmärke/sortering: det
  // filtrerade laget om exakt ett är valt, annars klubben, annars hemmalaget.
  function referenceSide(m) {
    if (state.teams.size === 1) {
      const [id] = state.teams;
      if (m.home.id === id) return "home";
      if (m.away.id === id) return "away";
    }
    if (isClubName(m.home.name)) return "home";
    if (isClubName(m.away.name)) return "away";
    return "home";
  }

  function hasReference(m) {
    return state.teams.size === 1
      ? (m.home.id === [...state.teams][0] || m.away.id === [...state.teams][0])
      : isClubMatch(m);
  }

  // "V"/"O"/"F" (vunnet/oavgjort/förlorat) ur referenslagets perspektiv, eller
  // null om matchen inte är avgjord eller inte rör referenslaget.
  function outcomeLetter(m) {
    if (!hasReference(m) || !(m.res && m.res.fin) || m.res.wo) return null;
    if (!m.res.winner) return "O";
    return m.res.winner === referenceSide(m) ? "V" : "F";
  }

  // 0=vunnet, 1=oavgjort, 2=förlorat, 3=ospelat/ej relevant — för "Sortera: resultat".
  function outcomeRank(m) {
    if (!(m.res && m.res.fin)) return 3;
    const o = outcomeLetter(m);
    return o === "V" ? 0 : o === "O" ? 1 : o === "F" ? 2 : 3;
  }

  function totalGoals(m) {
    if (!(m.res && m.res.fin) || m.res.wo) return -1; // ospelade/WO sist
    return (m.res.hg || 0) + (m.res.ag || 0);
  }

  // --- state ---------------------------------------------------------------

  const state = {
    cupId: localStorage.getItem("hb:cup") || (HB.allCups()[0] || {}).id,
    view: "schema",          // schema | tabeller
    scope: "club",           // club | all
    days: new Set(),         // tom = alla dagar
    cats: new Set(),
    teams: new Set(),
    // Ytterligare avsmalning OVANPÅ bas-filtret (cats/teams), bara för att
    // styra vad som VISAS i Schema/Tabeller/Slutspel — inte en del av
    // bas-urvalet. Tänkt för när bas-filtret är låst (se filterLocked
    // nedan): fyller det tomrum som annars uppstår när verktygsradens
    // egna klass-/lagväljare göms bort, så man kan bläddra inom sitt
    // låsta urval utan att låsa upp det. Session, sparas ej.
    viewCats: new Set(),
    viewTeams: new Set(),
    arena: "",
    viewArena: "",           // vald bana i Bana-fliken (separat från arena-filtret ovan)
    q: "",
    sort: "tid",             // tid | klass | plan
    timeOrder: "asc",        // asc (äldst→nyast) | desc (nyast/kommande överst)
    matchFilter: "all",      // all | upcoming | played
    toolbarOpen: true,       // filter-/sorteringsmenyn expanderad? (session, sparas ej)
    heroMinimized: false,    // nästa match-karusellen minimerad? (session, sparas ej)
    bracketZoom: 1,          // zoomnivå för slutspelsträdet (session, sparas ej)
    playoffDivTab: {},       // catId -> vald slutspelsdivision (A-/B-/C-Slutspel) när en klass har flera (session, sparas ej)
    playoffCatTab: null,     // vald klass i Slutspel-vyn när fler än en klass är filtrerad fram (session, sparas ej)
    // Fryser dagar/klasser/lag (fälls ihop till en chip bredvid "Filter och
    // sortering", se renderToolbar) så att morgonens inställning inte rubbas
    // av misstag när man går in och kollar saker under dagen — sparas
    // därför per cup precis som filtren själva, INTE bara för sessionen.
    filterLocked: false,
    // Extra upplagor (tidigare år) vars matcher blandas in i den vanliga
    // vyn OVANPÅ innevarande års live-data — tom = bara innevarande år,
    // precis som idag. Sparas per cup (som cats/teams) eftersom det är en
    // medveten "sök över flera år"-inställning man vill behålla, inte bara
    // för sessionen. De faktiska matcherna cachas INTE i localStorage (för
    // stora payloads) utan hämtas om vid varje sidladdning — statiska
    // arkivfiler är billiga att hämta om (webbläsarens HTTP-cache räcker).
    years: new Set(),
    // Innevarande upplaga är förvald men går att stänga av separat (egen
    // växel bredvid årsväljaren, inte en del av years-flervalet ovan) —
    // annars fanns inget sätt att titta på ENBART tidigare år i
    // huvudgränssnittet, bara via Historik-modalen.
    includeCurrentYear: true,
    yearMatches: {},         // "cupId:edition" -> {status, matches} (session, sparas ej)
    yearRosters: {},         // "cupId:edition" -> {teamId: [{name,shirtNr,position,goals}]} (session, sparas ej)
    archiveEditions: {},     // cupId -> {status, editions: [årtal, nyast först]} (session, sparas ej)
    showAllPlayedArena: false,   // Bana-vyn: visa alla spelade i stället för bara senaste timmarna
    showAllPlayedBracket: false, // slutspelstabellen: samma, men för dess egna rader
    schemaOlderRevealCount: 0,   // schemat: hur många extra äldre matcher "visa fler tidigare" öppnat upp
    matches: [],
    loadedAt: 0,
    loading: false,
    error: null,
    tables: {},              // divId -> {status, rows}
    playoffs: {},            // catId -> {status, divisions}
    groupTables: {},         // catId -> {status, byGroupNum, teamStrength} (för slutspelsprognos)
    // Globala inställningar (gäller alla cuper, sparas separat från
    // per-cup-filtren i saveUi()/loadUi()).
    theme: localStorage.getItem("hb:theme") || "auto",       // light | dark | auto
    teamColors: localStorage.getItem("hb:teamColors") !== "off",
    breakMinutes: +(localStorage.getItem("hb:breakMinutes") || 0), // 0 = av
    matchMinutes: +(localStorage.getItem("hb:matchMinutes") || 30), // schemarutans längd
    revealBatchSize: +(localStorage.getItem("hb:revealBatchSize") || 4), // "visa fler tidigare": antal per klick
    recentMatchCount: +(localStorage.getItem("hb:recentMatchCount") || 2), // Bana/slutspelstabell: visa senast spelade N st
    advancedPlayoffTable: localStorage.getItem("hb:advancedPlayoffTable") === "on",
    showPlayoffProjection: localStorage.getItem("hb:showPlayoffProjection") === "on",
    favoriteClub: localStorage.getItem("hb:favoriteClub") || HB.CLUB.name,
    favoriteTeam: localStorage.getItem("hb:favoriteTeam") || "", // tomt = ingen stjärna
    fullCardColors: localStorage.getItem("hb:fullCardColors") === "on",
    teamColorOverrides: (() => {
      try { return JSON.parse(localStorage.getItem("hb:teamColorOverrides") || "{}"); }
      catch { return {}; }
    })(),
  };

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme === "auto" ? "" : state.theme;
  }

  // Bygger om HB.CLUB.pattern från den valfria favoritklubben i inställ-
  // ningarna (förvalt: samma klubb sajten är byggd för). Håller å/ä/ö
  // toleranta som den ursprungliga hårdkodade regexen gjorde.
  function rebuildClubPattern() {
    const raw = (state.favoriteClub || HB.CLUB.name).trim();
    const escaped = raw
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[åäÅÄ]/g, "[åäa]")
      .replace(/[öÖ]/g, "[öo]")
      .replace(/\s+/g, "\\s*");
    HB.CLUB.pattern = escaped ? new RegExp("^" + escaped, "i") : /^$/;
  }
  rebuildClubPattern();

  function saveSettings() {
    localStorage.setItem("hb:theme", state.theme);
    localStorage.setItem("hb:favoriteClub", state.favoriteClub);
    localStorage.setItem("hb:favoriteTeam", state.favoriteTeam);
    rebuildClubPattern();
    updateClubLogo();
    localStorage.setItem("hb:teamColors", state.teamColors ? "on" : "off");
    localStorage.setItem("hb:breakMinutes", String(state.breakMinutes));
    localStorage.setItem("hb:matchMinutes", String(state.matchMinutes));
    localStorage.setItem("hb:revealBatchSize", String(state.revealBatchSize));
    localStorage.setItem("hb:recentMatchCount", String(state.recentMatchCount));
    localStorage.setItem("hb:advancedPlayoffTable", state.advancedPlayoffTable ? "on" : "off");
    localStorage.setItem("hb:showPlayoffProjection", state.showPlayoffProjection ? "on" : "off");
    localStorage.setItem("hb:fullCardColors", state.fullCardColors ? "on" : "off");
    localStorage.setItem("hb:teamColorOverrides", JSON.stringify(state.teamColorOverrides));
    applyTheme();
  }

  // Sätts direkt vid skriptkörning (inte i async init()) så temat är rätt
  // redan vid första målningen — annars hinner sidan flimra i fel tema.
  applyTheme();

  function cup() {
    return HB.allCups().find((c) => c.id === state.cupId) || HB.allCups()[0];
  }

  function uiKey() { return "hb:ui:" + state.cupId; }

  function saveUi() {
    localStorage.setItem("hb:cup", state.cupId);
    localStorage.setItem(uiKey(), JSON.stringify({
      view: state.view, scope: state.scope, days: [...state.days],
      cats: [...state.cats], teams: [...state.teams], years: [...state.years],
      includeCurrentYear: state.includeCurrentYear,
      arena: state.arena, viewArena: state.viewArena,
      sort: state.sort, timeOrder: state.timeOrder, matchFilter: state.matchFilter,
      filterLocked: state.filterLocked,
    }));
    syncUrl();
  }

  // Speglar aktuellt filter/sortering i adressfältet (utan att lägga till
  // historik-poster) så att en delad/bokmärkt länk återskapar exakt samma
  // vy. Bara icke-default värden tas med, för korta URL:er. q (fritextsök)
  // sparas INTE i localStorage (den är avsiktligt tillfällig mellan besök)
  // men tas med här eftersom en delad länk ska återge sökningen också.
  function syncUrl() {
    const p = new URLSearchParams();
    p.set("cup", state.cupId);
    if (state.view !== "schema") p.set("view", state.view);
    if (state.scope !== "club") p.set("scope", state.scope);
    if (state.days.size) p.set("days", [...state.days].join(","));
    if (state.cats.size) p.set("cats", [...state.cats].join(","));
    if (state.teams.size) p.set("teams", [...state.teams].join(","));
    if (state.years.size) p.set("years", [...state.years].join(","));
    if (!state.includeCurrentYear) p.set("curYear", "0");
    if (state.arena) p.set("arena", state.arena);
    if (state.viewArena) p.set("viewArena", state.viewArena);
    if (state.sort !== "tid") p.set("sort", state.sort);
    if (state.timeOrder !== "asc") p.set("order", state.timeOrder);
    if (state.matchFilter !== "all") p.set("mf", state.matchFilter);
    if (state.q) p.set("q", state.q);
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function loadUi() {
    state.view = "schema"; state.scope = "club"; state.days = new Set();
    state.cats = new Set(); state.teams = new Set(); state.years = new Set();
    state.includeCurrentYear = true;
    state.viewCats = new Set(); state.viewTeams = new Set();
    state.arena = ""; state.viewArena = ""; state.q = ""; state.sort = "tid"; state.matchFilter = "all";
    state.timeOrder = "asc"; state.schemaOlderRevealCount = 0; state.filterLocked = false;
    try {
      const s = JSON.parse(localStorage.getItem(uiKey()) || "{}");
      if (s.view) state.view = s.view;
      if (s.scope) state.scope = s.scope;
      if (Array.isArray(s.days)) state.days = new Set(s.days);
      else if (typeof s.day === "string" && s.day !== "all") state.days = new Set([s.day]); // migrera gammalt format
      if (Array.isArray(s.cats)) state.cats = new Set(s.cats);
      if (Array.isArray(s.teams)) state.teams = new Set(s.teams);
      if (Array.isArray(s.years)) state.years = new Set(s.years);
      if (s.includeCurrentYear === false) state.includeCurrentYear = false;
      if (s.arena) state.arena = s.arena;
      if (s.viewArena) state.viewArena = s.viewArena;
      if (s.sort) state.sort = s.sort;
      if (s.timeOrder === "desc") state.timeOrder = "desc";
      if (["all", "upcoming", "played"].includes(s.matchFilter)) state.matchFilter = s.matchFilter;
      else if (s.played === false) state.matchFilter = "upcoming"; // migrera gammal boolean
      if (s.filterLocked) state.filterLocked = true;
    } catch { /* trasig state: kör default */ }
  }

  // --- datainläsning --------------------------------------------------------

  function refreshTtl(matches) {
    // Hur gammal data vi accepterar utan omhämtning:
    // avslutad cup ändras aldrig; framtida cuper justeras sällan;
    // pågående cuper live-uppdateras.
    if (!matches.length) return 0;
    const now = Date.now();
    const first = matches[0].start;
    const last = matches[matches.length - 1].start;
    if (now > last + 24 * 3600000) return Infinity;   // färdigspelad
    if (now < first - 24 * 3600000) return 6 * 3600000; // framtida
    return 60000;                                      // pågår
  }

  // Är ALLA matcher i listan klara (har ett slutgiltigt resultat)? Styr om
  // gruppställningar/slutspelsträd (ensureTable/ensurePlayoffs/
  // ensureGroupTables nedan) kan cachas i localStorage för evigt — samma
  // "avslutad = ändras aldrig"-tanke som refreshTtl() ovan, fast per
  // division/kategori i stället för för hela cupen (de hämtas ju var för
  // sig, inte i samma anrop som schemat).
  function allMatchesFinished(list) {
    return list.length > 0 && list.every((m) => m.res && m.res.fin);
  }

  function loadWeather() {
    const c = cup();
    HB.weather.fetchForecast(c).then(() => {
      if (state.cupId === c.id) renderContent();
    });
  }

  // Antal matcher hämtade hittills av den pågående fetchMatches()-anropet
  // — visas i verktygsradens metatext så en flerasekunders hämtning för en
  // stor cup känns aktiv i stället för att se ut som att sidan hängt sig.
  let loadProgress = 0;

  // Sidan visar alltid den sparade cachen direkt (kan vara flera timmar
  // gammal) och synkar sedan i bakgrunden — men NU-linjens auto-skroll
  // (autoScrolledToNow) får bara köra EN gång per sidladdning, annars
  // skulle en periodisk bakgrundssync rycka undan mattan för användaren
  // varje gång. Problemet: om den FÖRSTA synken (rätt efter cachen visats)
  // faktiskt ändrar layouten (nya matcher, ändrade tider) hamnar den redan
  // gjorda skrollningen fel utan att rättas till. Lösning: tillåt EN extra
  // auto-skroll specifikt efter den allra första lyckade bakgrundssynken —
  // därefter (periodiska uppdateringar, manuell "Uppdatera") rör vi inte
  // scrollpositionen igen.
  let hasSyncedFreshData = false;

  async function loadCup(force) {
    const c = cup();
    if (!c) return;
    loadWeather(); // oberoende av matchdata — hämtas parallellt
    // Förhämtade cuper (dataUrl) läses alltid färskt — filen ligger lokalt.
    const cached = c.dataUrl ? null : HB.api.readCache(c);
    if (cached && cached.matches) {
      state.matches = cached.matches;
      state.loadedAt = cached.ts;
    } else if (!c.dataUrl) {
      // Ingen lokal cache: starta från CI-byggd snapshot i repot,
      // så att förstabesöket slipper vänta på cupmanager-API:t.
      try {
        const r = await fetch("data/snapshot-" + c.id + ".json?_=" +
          Date.now().toString(36));
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.matches) && j.matches.length) {
            state.matches = j.matches;
            state.loadedAt = j.ts || 0;
            HB.api.writeCache(c, j.matches, j.ts);
          }
        }
      } catch { /* ingen snapshot — hämta från API:t nedan */ }
    }
    const fresh = state.matches.length &&
      Date.now() - state.loadedAt < refreshTtl(state.matches);
    if (fresh && !force) { render(); return; }

    state.loading = true;
    state.error = null;
    loadProgress = 0;
    render();
    try {
      // De flesta matcherna i en cup är redan avgjorda och kan aldrig
      // ändras — har vi redan en cache att bygga vidare på, försök bara
      // hämta om de OSPELADE matcherna (mycket snabbare) i stället för
      // att alltid slå om hela MatchWindow-fönstret. fetchIncremental()
      // ger null om det inte lönar sig (för många ospelade, eller ProCup
      // som saknar stöd) — då faller vi tillbaka på den fulla hämtningen.
      let matches = null;
      if (state.matches.length) {
        matches = await HB.api.fetchIncremental(c, state.matches, (done, total) => {
          loadProgress = done + "/" + total + " ospelade";
          renderMeta();
        });
      }
      if (!matches) {
        matches = await HB.api.fetchMatches(c, (n) => {
          loadProgress = n + "+";
          const el = $("#loadNote");
          if (el) el.textContent = "Hämtar schema … " + n + "+ matcher";
          // Live-uppdatera "hämtar nytt …"-texten även vid en
          // bakgrundsuppdatering (befintlig data ligger redan kvar på
          // skärmen, #loadNote finns då inte) — annars ser en flera
          // sekunder lång hämtning av en stor cup ut som att sidan hängt
          // sig i stället för att faktiskt jobba.
          renderMeta();
        });
      }
      state.matches = matches;
      state.loadedAt = Date.now();
      if (!c.dataUrl) HB.api.writeCache(c, matches);
      if (!hasSyncedFreshData) {
        hasSyncedFreshData = true;
        autoScrolledToNow = false; // en chans att rätta till en skroll som blev fel mot cachens gamla data
      }
    } catch (e) {
      state.error = "Kunde inte hämta schemat från " + c.host +
        ". Kontrollera nätet och försök igen.";
      console.error(e);
    }
    state.loading = false;
    render();
  }

  function switchCup(id) {
    if (id === state.cupId) return;
    state.cupId = id;
    state.tables = {};
    state.playoffs = {};
    state.groupTables = {};
    dialogTableCache = {};
    state.matches = [];
    state.loadedAt = 0;
    heroIndex = 0;
    stashedFilter = null;
    autoScrolledToNow = false;
    hasSyncedFreshData = false;
    loadUi();
    saveUi();
    loadCup();
    const dlg = $("#settingsDialog");
    if (dlg && dlg.open) dlg.close();
  }

  // --- härledningar ------------------------------------------------------

  // Tillgängliga tidigare upplagor (år) för INNEVARANDE cup, ur det
  // statiska arkivindexet (samma data/archive/index.json som Historik-
  // modalen använder) — populerar årsväljaren i verktygsraden. Innevarande
  // (live) upplaga filtreras bort här: den ingår redan alltid i
  // allActiveMatches() utan att behöva kryssas i.
  function ensureArchiveEditions() {
    const cupId = state.cupId;
    if (state.archiveEditions[cupId]) return;
    state.archiveEditions[cupId] = { status: "loading", editions: [] };
    HB.api.fetchArchiveIndex().then((idx) => {
      const entry = idx[cupId];
      const editions = ((entry && entry.editions) || [])
        .map((e) => e.edition)
        .filter((e) => e !== cup().edition)
        .sort((a, b) => b.localeCompare(a, "sv", { numeric: true }));
      state.archiveEditions[cupId] = { status: "done", editions };
      render();
    }).catch(() => {
      state.archiveEditions[cupId] = { status: "done", editions: [] };
      render();
    });
  }

  // Hämtar en hel arkiverad upplagas matcher (en gång, cachas i minnet för
  // sessionen) när den kryssas i årsväljaren. Nyckeln inkluderar cupId —
  // annars skulle t.ex. "2024" för två olika cuper krocka i samma cache.
  // Varje match stämplas med .edition så Schema/Tabeller/Slutspel kan
  // visa/gruppera per år och skilja arkiverade divisioner/kategorier
  // (som måste räknas fram lokalt, se ensureTable/ensurePlayoffs) från
  // innevarande års live-hämtade (odefinierad .edition = live).
  function ensureYearMatches(edition) {
    const key = state.cupId + ":" + edition;
    if (state.yearMatches[key]) return;
    state.yearMatches[key] = { status: "loading", matches: [] };
    HB.api.fetchArchiveEdition(state.cupId, edition).then((data) => {
      const matches = ((data && data.matches) || []).map((m) => ({ ...m, edition }));
      state.yearMatches[key] = { status: "done", matches };
      state.yearRosters[key] = (data && data.rosters) || {};
      render();
    }).catch(() => {
      state.yearMatches[key] = { status: "error", matches: [] };
      render();
    });
  }

  // Truppdata för ETT lag — antingen innevarande år (via HB.api.fetchRoster,
  // ur den redan hämtade dataUrl-filen) eller ett arkiverat år (ur
  // state.yearRosters, se ensureYearMatches). `edition` kommer från
  // matchens .edition-fält (odefinierad = innevarande år, se allActiveMatches).
  function rosterFor(team, edition) {
    if (!cup().hasRosters) return [];
    if (!edition) return HB.api.fetchRoster(cup(), team.id);
    const yr = state.yearRosters[state.cupId + ":" + edition];
    return (yr && yr[team.id]) || [];
  }

  // Innevarande års live-matcher (state.matches) PLUS matcherna från varje
  // extra år som kryssats i årsväljaren (state.years) — den kombinerade
  // pool som scoped()/filtered()/divisionsToShow()/categoriesToShow() alla
  // arbetar vidare på. Match-/kategori-/lag-ID:n krockar aldrig mellan år
  // (verifierat mot faktisk arkivdata — Cup Manager delar ut nya ID:n varje
  // upplaga), så poolen kan bara slås ihop rakt av utan omskrivning.
  function allActiveMatches() {
    const base = state.includeCurrentYear ? state.matches : [];
    if (!state.years.size) return base;
    const extra = [];
    for (const edition of state.years) {
      const ym = state.yearMatches[state.cupId + ":" + edition];
      if (ym && ym.status === "done") extra.push(...ym.matches);
    }
    return extra.length ? base.concat(extra) : base;
  }

  function scoped() {
    const pool = allActiveMatches();
    return state.scope === "club" ? pool.filter(isClubMatch) : pool;
  }

  // Har användaren gjort ett AKTIVT val av klass(er), lag och/eller en
  // fritextsökning? Styr om Schema/Tabeller/Slutspel visar sitt fulla
  // innehåll — annars skulle appen by default rendera samtliga klasser/
  // lag/tabeller/slutspelsträd för hela klubben (eller hela cupen), vilket
  // är onödigt tungt och sällan det man faktiskt vill se. Bana-fliken har
  // redan sin egen motsvarande spärr (kräver en vald bana) och Hero-kortet
  // (nästa match) är en lättviktig teaser som ska synas oavsett — bara de
  // fulla listorna/tabellerna spärras. Fritextsökningen räknades tidigare
  // INTE som ett aktivt val här — man kunde skriva ett lagnamn i sökrutan
  // utan att kryssa någon klass/lag och bara få tomt/"välj klass"-meddelan-
  // det tillbaka, trots träffar.
  function hasFilterSelection() {
    return state.cats.size > 0 || state.teams.size > 0 || !!state.q.trim();
  }

  // Boolesk fritextsökning, delad av alla sökrutor (huvudsökrutan och
  // klass/lag/år-väljarnas sökfält): "&" = OCH (alla termer i en grupp
  // måste matcha), "/" eller "," = ELLER (någon grupp räcker). Ex:
  // "2011&flickor/2013" matchar allt som innehåller ("2011" OCH "flickor")
  // ELLER "2013".
  function matchesBooleanQuery(haystack, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const orGroups = q.split(/[/,]/).map((g) => g.trim()).filter(Boolean);
    if (!orGroups.length) return true;
    return orGroups.some((group) =>
      group.split("&").map((t) => t.trim()).filter(Boolean).every((t) => haystack.includes(t)));
  }

  // Matchar en match mot fritextsökningen (lag, plan, klass, grupp, omgång)
  // — delad av filtered() (Schema/Bana) och Tabeller/Slutspels egna
  // urvalsfunktioner (divisionsToShow/categoriesToShow) så att sökrutan
  // beter sig likadant i alla flikar i stället för att bara fungera i
  // Schema, trots att den syns i verktygsraden överallt.
  function matchesSearchQuery(m) {
    if (!state.q.trim()) return true;
    const hay = (m.home.name + " " + m.away.name + " " + m.arena + " " +
      m.catName + " " + m.divName + " " + m.roundName).toLowerCase();
    return matchesBooleanQuery(hay, state.q);
  }

  // Ett gemensamt "vy-filter" (viewCats/viewTeams) — se state ovan.
  // isFilterLocked() delas mellan renderToolbar (som bygger låsknappen)
  // och Schema/Tabeller/Slutspel (som avgör om vy-filterraden ska visas).
  function hasLockableSelection() {
    return state.days.size > 0 || state.cats.size > 0 || state.teams.size > 0 ||
      state.years.size > 0 || !state.includeCurrentYear;
  }
  function isFilterLocked() {
    return state.filterLocked && hasLockableSelection();
  }

  function matchesViewFilter(m) {
    if (state.viewCats.size && !state.viewCats.has(m.catId)) return false;
    if (state.viewTeams.size &&
        !state.viewTeams.has(m.home.id) && !state.viewTeams.has(m.away.id)) return false;
    return true;
  }

  // Kandidater för vy-filtrets klass-/lagväljare: allt inom bas-filtret
  // (scope+dagar+bas-klasser+bas-lag) — INTE fritextsök/plan/matchstatus,
  // de är Schema-specifika och ska inte påverka vad Tabeller/Slutspel
  // erbjuder att bläddra bland.
  function viewFilterCandidates() {
    const base = scoped().filter((m) => {
      if (state.days.size && !state.days.has(dayKey(m.start))) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      return true;
    });
    const catMap = new Map();
    const teamMap = new Map();
    for (const m of base) {
      if (m.catId) catMap.set(m.catId, m.catName);
      for (const side of [m.home, m.away]) {
        if (side.id && !teamMap.has(side.id)) {
          teamMap.set(side.id, {
            id: side.id, name: side.name, suffix: teamSuffix(side.name),
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    const catEntries = [...catMap.entries()].sort((a, b) =>
      catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));
    const teams = [...teamMap.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) || a.suffix.localeCompare(b.suffix, "sv"));
    return { catEntries, teams };
  }

  // Vy-filterraden: klass- och lagväljare (samma sök-/sorterbara
  // dropdown-komponent som verktygsradens, se buildPicker) som fyller det
  // tomrum som uppstår i Schema/Tabeller/Slutspel när bas-filtret är låst
  // och verktygsradens egna klass-/lagväljare därför göms bort — så man
  // kan bläddra inom sitt låsta urval utan att låsa upp det. Bara synlig
  // när bas-filtret faktiskt är låst OCH det finns mer än en klass/ett lag
  // att välja bland — annars gör verktygsradens egna, redan synliga
  // pickers exakt samma jobb, och en andra uppsättning skulle bara vara en
  // förvirrande dubblett. Lagkandidaterna smalnas av av vald(a) vy-klass(er)
  // (samma nivå1/nivå2-mönster som verktygsradens bas-pickers) — annars
  // skulle t.ex. en F12-klubb dyka upp i lagvalet trots att vyn redan
  // smalnats till F13, en garanterad återvändsgränd (noll träffar).
  //
  // Byggs och lever i renderToolbar (INTE i respektive vy) trots att den
  // logiskt hör till Schema/Tabeller/Slutspel — renderContent() (som
  // uppdaterar själva matchlistan/tabellerna/trädet när valet ändras)
  // bygger om HELA huvudinnehållet, vilket skulle stänga en öppen
  // dropdown om den låg där. I verktygsraden, som bara render() bygger
  // om, kan pickerns egen <details> hållas vid liv över ändringar precis
  // som bas-filtrets klass-/lagväljare gör.
  function buildViewFilterRow() {
    if (!isFilterLocked() || state.view === "bana") return null;
    const { catEntries, teams: allTeams } = viewFilterCandidates();
    if (catEntries.length <= 1 && allTeams.length <= 1) return null;

    const teamSlot = h("span", { style: "display:contents" });
    const refreshViewTeamSlot = () => {
      const teams = state.viewCats.size
        ? allTeams.filter((t) => state.viewCats.has(t.catId))
        : allTeams;
      teamSlot.replaceChildren(...(teams.length > 1 ? [buildPicker({
        items: teams.map((t) => ({
          id: t.id, label: HB.shortCat(t.catName) + " " + t.suffix,
          sortKey: catSortKey(t.catName), sortName: t.suffix,
        })),
        selected: state.viewTeams,
        emptyLabel: "Visa: alla lag",
        countLabel: (n) => "Visar " + n + " lag",
        searchPlaceholder: "Sök lag …",
        onChange: renderContent,
      })] : []));
    };

    const row = h("div", { class: "row" });
    if (catEntries.length > 1) {
      row.append(buildPicker({
        items: catEntries.map(([id, name]) => ({
          id, label: name, sortKey: catSortKey(name), sortName: name,
        })),
        selected: state.viewCats,
        emptyLabel: "Visa: alla klasser",
        countLabel: (n) => n === 1 ? "Visar 1 klass" : "Visar " + n + " klasser",
        searchPlaceholder: "Sök klass …",
        genderQuickSelect: true,
        onChange: () => { renderContent(); refreshViewTeamSlot(); },
      }));
    }
    refreshViewTeamSlot();
    row.append(teamSlot);
    return row;
  }

  function clubTeams() {
    const map = new Map();
    // allActiveMatches() (inte state.matches direkt) — annars skulle
    // klubbens lagväljare fortsätta visa INNEVARANDE års lag även när man
    // stängt av det (state.includeCurrentYear) och bara tittar på tidigare
    // år, vilket hade räknat upp lag som inte ens spelar i den valda vyn.
    for (const m of allActiveMatches()) {
      for (const side of [m.home, m.away]) {
        if (side.id && isClubName(side.name) && !map.has(side.id)) {
          map.set(side.id, {
            id: side.id, name: side.name, suffix: teamSuffix(side.name),
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) ||
      a.suffix.localeCompare(b.suffix, "sv"));
  }

  // Alla lag (oavsett klubb) inom nuvarande scope — clubTeams() räcker
  // inte i "Hela cupen"-läge, där lagväljarens nivå 2 (se renderToolbar)
  // ska kunna smalna av bland SAMTLIGA lag i cupen, inte bara egna klubbens.
  function allScopedTeams() {
    const map = new Map();
    for (const m of scoped()) {
      for (const side of [m.home, m.away]) {
        if (side.id && !map.has(side.id)) {
          map.set(side.id, {
            id: side.id, name: side.name, suffix: teamSuffix(side.name),
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) ||
      a.suffix.localeCompare(b.suffix, "sv"));
  }

  // Kandidater för favoritklubb-autocomplete: lagnamn utan sista ordet
  // (som oftast är en färg/siffra), plus hela namnet — klubbar skrivs olika
  // i olika cuper ("AHK" vs "Alingsås HK"), så förslagen hämtas ur den
  // cup som just nu är öppen i stället för att gissas generellt.
  function clubPrefixCandidates() {
    const set = new Set();
    for (const m of state.matches) {
      for (const side of [m.home, m.away]) {
        const name = (side.name || "").trim();
        if (!name) continue;
        set.add(name);
        const words = name.split(/\s+/);
        if (words.length > 1) set.add(words.slice(0, -1).join(" "));
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "sv"));
  }

  // arenaOverride: Bana-fliken har sin EGEN banväljare (state.viewArena,
  // medvetet frikopplad från verktygsradens "Alla planer"-filter, se
  // renderArenaView) men ska annars lyda under exakt samma filter som
  // schemat (klubb/hela cupen, dagar, klasser, egna lag, matchstatus,
  // fritextsök) — annars "renderar"/beter den fliken sig annorlunda än
  // resten av appen trots att verktygsraden ser likadan ut överallt.
  function filtered(arenaOverride) {
    const arena = arenaOverride !== undefined ? arenaOverride : state.arena;
    return scoped().filter((m) => {
      if (state.days.size && !state.days.has(dayKey(m.start))) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (arena && m.arena !== arena) return false;
      if (state.matchFilter === "upcoming" && m.res && m.res.fin) return false;
      if (state.matchFilter === "played" && !(m.res && m.res.fin)) return false;
      if (!matchesSearchQuery(m)) return false;
      return true;
    });
  }

  function sorted(list) {
    const bySort = {
      tid: (a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"),
      klass: (a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
        a.catName.localeCompare(b.catName, "sv") ||
        a.divName.localeCompare(b.divName, "sv") || a.start - b.start,
      plan: (a, b) => a.arena.localeCompare(b.arena, "sv", { numeric: true }) ||
        a.start - b.start,
      resultat: (a, b) => outcomeRank(a) - outcomeRank(b) || a.start - b.start,
      mal: (a, b) => totalGoals(b) - totalGoals(a) || a.start - b.start,
    };
    return [...list].sort(bySort[state.sort] || bySort.tid);
  }

  // --- DOM-byggare -----------------------------------------------------------

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

  function chip(label, active, onClick, cls) {
    return h("button", {
      class: "chip" + (active ? " on" : "") + (cls ? " " + cls : ""),
      type: "button", "aria-pressed": String(!!active), onclick: onClick,
    }, label);
  }

  // Slår in ett text-/sökfält i en wrapper med en ×-knapp som rensar det —
  // återanvänds för alla sök-/filterfält i appen i stället för att förlita
  // sig på webbläsarens inbyggda (bara Chrome/Safari, olika utseende,
  // saknas helt i Firefox) rensa-knapp för type="search". Knappen syns
  // bara när fältet faktiskt har ett värde (CSS :placeholder-shown, kräver
  // att inputen har en placeholder). Skickar ett riktigt "input"-event vid
  // rensning så befintliga lyssnare/filter reagerar som om användaren
  // själv raderat texten — onClear (valfritt) för extra städning
  // (t.ex. att stänga en öppen autocomplete-lista).
  function withClearButton(input, onClear) {
    return h("div", { class: "search-wrap" }, input,
      h("button", {
        class: "search-clear", type: "button", "aria-label": "Rensa",
        tabindex: "-1",
        onclick: () => {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
          if (onClear) onClear();
        },
      }, "×"));
  }

  // --- render: toppnivå ----------------------------------------------------

  function render() {
    renderCups();
    renderTabs();
    renderMeta();
    renderToolbar();
    renderContent();
  }

  // Ritar bara matchlistan/tabellerna. Används av allt som inte ska rubba
  // verktygsraden — fritextsökning och bakgrundsuppdateringar — så att
  // fokus i sökfältet (och en öppen lag-dropdown) inte går förlorat.
  function renderContent() {
    const main = $("#content");
    main.replaceChildren();
    if (state.error) {
      main.append(h("div", { class: "banner error" },
        h("p", null, state.error),
        h("button", { class: "btn", type: "button", onclick: () => loadCup(true) },
          "Försök igen")));
    }
    if (state.loading && !state.matches.length) {
      main.append(h("div", { class: "banner", id: "loadNote" }, "Hämtar schema …"));
      return;
    }
    if (!state.matches.length && !state.loading && !state.error) {
      main.append(h("div", { class: "banner" },
        cup().name + " har inte publicerat något spelschema ännu."));
      return;
    }
    if (state.view === "schema") renderSchema(main);
    else if (state.view === "slutspel") renderPlayoffs(main);
    else if (state.view === "bana") renderArenaView(main);
    else renderTables(main);
  }

  function renderCups() {
    const row = $("#cupRow");
    row.replaceChildren(
      ...HB.allCups().map((c) =>
        h("button", {
          class: "cup" + (c.id === state.cupId ? " on" : ""),
          type: "button", onclick: () => switchCup(c.id),
        },
          h("span", { class: "cup-name" }, c.name),
          h("span", { class: "cup-place" }, c.place + " " + c.edition))
      ));
    // Cupväljaren själv bor i inställningarna (för att inte ta plats högst
    // upp på sidan) — den här knappen i headern visar bara vilken cup som
    // är vald just nu och öppnar samma dialog för att byta.
    const btn = $("#currentCupBtn");
    if (btn) btn.textContent = cup().name;
  }

  function renderTabs() {
    // Slutspelsdata finns för Cup Manager-cuper och de dataUrl-cuper vars
    // skrapa faktiskt bygger en playoffs-struktur (cup.hasPlayoffs, se
    // scripts/fetch_gothia.py) — INTE ProCup (fetch_procup.py stödjer det
    // inte än).
    const playoffsSupported = !cup().dataUrl || !!cup().hasPlayoffs;
    if (!playoffsSupported && state.view === "slutspel") state.view = "schema";
    $$("#viewTabs .tab").forEach((b) => {
      const isPlayoffTab = b.dataset.view === "slutspel";
      b.hidden = isPlayoffTab && !playoffsSupported;
      b.classList.toggle("on", b.dataset.view === state.view);
      b.setAttribute("aria-selected", String(b.dataset.view === state.view));
    });
  }

  function renderMeta() {
    // Uppdatera-knappen ger tydlig feedback direkt vid klick — annars
    // syns en pågående bakgrundsuppdatering (kan ta 20-30 s för en stor
    // cup) bara som en liten textändring längst upp, vilket lätt ser ut
    // som att sidan hängt sig i stället för att faktiskt jobba.
    const btn = $("#refreshBtn");
    if (btn) {
      btn.disabled = state.loading;
      btn.textContent = state.loading ? "↻ Uppdaterar …" : "↻ Uppdatera";
    }
    const el = $("#meta");
    if (!state.loadedAt) { el.textContent = ""; return; }
    const n = scoped().length;
    const dataTs = HB.api.localDataTs[state.cupId];
    el.textContent = (dataTs
      ? "Data hämtad " + new Intl.DateTimeFormat("sv-SE", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(new Date(dataTs))
      : "Uppdaterad " + fmtClock.format(new Date(state.loadedAt))) +
      " · " + n + " matcher" + (state.loading
        ? " · hämtar nytt … (" + (loadProgress || "0") + ")" : "");
  }

  // --- generisk sök-, filter- och sorterbar flervalsdropdown ------------------

  // Egen, självstyrande komponent: sökning/sortering/bockning inuti den sköts
  // med direkt DOM-manipulation i stället för renderToolbar(), så att den kan
  // hållas öppen genom flera val utan att byggas om. items: [{id, label,
  // sortKey (numeriskt), sortName (för alfabetisk sortering)}].
  function buildPicker(opts) {
    const dd = h("details", { class: "team-picker-dd" });
    const summary = h("summary", { class: "chip team-picker-summary" });
    const setSummary = () => {
      summary.textContent = opts.selected.size
        ? opts.countLabel(opts.selected.size) : opts.emptyLabel;
    };
    setSummary();

    const search = h("input", {
      class: "team-picker-search", type: "search", placeholder: opts.searchPlaceholder,
      title: "Stöder & (och) och / eller , (eller), t.ex. 2011&flickor/2013",
    });
    const clearBtn = h("button", {
      class: "btn small", type: "button",
      onclick: () => {
        opts.selected.clear();
        saveUi(); setSummary(); opts.onChange();
        list.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
      },
    }, "Rensa");

    let sortMode = "klass";
    const sortBtns = {};
    const applySort = () => {
      const cmp = sortMode === "namn"
        ? (a, b) => a.dataset.name.localeCompare(b.dataset.name, "sv")
        : (a, b) => (+a.dataset.catkey - +b.dataset.catkey) ||
            a.dataset.name.localeCompare(b.dataset.name, "sv");
      [...list.children].sort(cmp).forEach((el) => list.append(el));
    };
    const sortRow = h("div", { class: "team-picker-sort-row" },
      ["klass", "namn"].map((key) => {
        const b = h("button", {
          class: "chip small" + (key === sortMode ? " on" : ""),
          type: "button",
          onclick: () => {
            sortMode = key;
            Object.entries(sortBtns).forEach(([k, el]) => el.classList.toggle("on", k === key));
            applySort();
          },
        }, "Sortera: " + (key === "namn" ? "namn" : "klass"));
        sortBtns[key] = b;
        return b;
      }));

    const list = h("div", { class: "team-picker-list" },
      opts.items.map((it) => {
        const cb = h("input", {
          type: "checkbox", ...(opts.selected.has(it.id) ? { checked: "" } : {}),
          onchange: (e) => {
            e.target.checked ? opts.selected.add(it.id) : opts.selected.delete(it.id);
            saveUi(); setSummary(); opts.onChange();
            syncGenderBoxes();
          },
        });
        const row = h("label", { class: "team-picker-item" }, cb, it.label);
        row.dataset.name = it.sortName;
        row.dataset.catkey = String(it.sortKey);
        row.dataset.search = it.label.toLowerCase();
        row._id = it.id; // rådata (kan vara nummer) — dataset tvingar sträng
        row._checkbox = cb;
        if (opts.genderQuickSelect) row.dataset.gender = (parseCat(it.label) || {}).g || "";
        return row;
      }));

    // Snabbval Flickor/Pojkar (bara klassväljaren, se buildCatPicker): kryssar
    // eller kryssar ur ALLA just nu SYNLIGA (sökfiltrerade) klasser av det
    // könet i ett klick — praktiskt när t.ex. en sökning på "2013" ger
    // träffar utspridda över flera år/åldrar och man bara vill ha
    // flickornas eller bara pojkarnas av dem. Reflekterar aktuellt urval
    // (ikryssad om ALLA synliga av könet redan är valda, streckad om BARA
    // några är det) i stället för att vara en engångsknapp utan status.
    let genderRow = null;
    const syncGenderBoxes = () => {
      if (!genderRow) return;
      for (const g of ["F", "P"]) {
        const box = genderRow.querySelector('input[data-gender-toggle="' + g + '"]');
        const visible = [...list.children].filter((row) => !row.hidden && row.dataset.gender === g);
        box.disabled = !visible.length;
        const allSelected = visible.length > 0 && visible.every((row) => opts.selected.has(row._id));
        box.checked = allSelected;
        box.indeterminate = !allSelected && visible.some((row) => opts.selected.has(row._id));
      }
    };
    if (opts.genderQuickSelect) {
      genderRow = h("div", { class: "team-picker-gender-row" },
        [["F", "Flickor"], ["P", "Pojkar"]].map(([g, label]) =>
          h("label", { class: "team-picker-gender-item" },
            h("input", {
              type: "checkbox", "data-gender-toggle": g,
              onchange: (e) => {
                const visible = [...list.children].filter((row) => !row.hidden && row.dataset.gender === g);
                for (const row of visible) {
                  row._checkbox.checked = e.target.checked;
                  e.target.checked ? opts.selected.add(row._id) : opts.selected.delete(row._id);
                }
                saveUi(); setSummary(); opts.onChange();
                syncGenderBoxes();
              },
            }),
            label)));
    }

    search.addEventListener("input", () => {
      const q = search.value;
      for (const item of list.children) item.hidden = !matchesBooleanQuery(item.dataset.search, q);
      syncGenderBoxes();
    });
    syncGenderBoxes();

    dd.append(summary, h("div", { class: "team-picker-panel" },
      h("div", { class: "team-picker-search-row" }, withClearButton(search), clearBtn),
      genderRow, sortRow, list));
    return dd;
  }

  function buildTeamPicker(teams, onChange) {
    return buildPicker({
      items: teams.map((t) => ({
        id: t.id, label: HB.shortCat(t.catName) + " " + t.suffix,
        sortKey: catSortKey(t.catName), sortName: t.suffix,
      })),
      selected: state.teams,
      emptyLabel: "Alla lag",
      countLabel: (n) => "Lag (" + n + ")",
      searchPlaceholder: "Sök lag …",
      onChange: onChange || renderContent,
    });
  }

  function buildDayPicker(days, onChange) {
    return buildPicker({
      items: days.map((d) => ({
        id: d, label: fmtDay.format(new Date(d + "T00:00:00Z")),
        sortKey: Date.parse(d + "T00:00:00Z"), sortName: d, // dayKey (ÅÅÅÅ-MM-DD) sorterar redan kronologiskt
      })),
      selected: state.days,
      emptyLabel: "Alla dagar",
      countLabel: (n) => "Dagar (" + n + ")",
      searchPlaceholder: "Sök dag …",
      onChange: onChange || renderContent,
    });
  }

  function buildCatPicker(catEntries, onChange) {
    return buildPicker({
      items: catEntries.map(([id, name]) => ({
        id, label: name, sortKey: catSortKey(name), sortName: name,
      })),
      selected: state.cats,
      emptyLabel: "Alla klasser",
      countLabel: (n) => "Klasser (" + n + ")",
      searchPlaceholder: "Sök klass …",
      genderQuickSelect: true,
      onChange: onChange || renderContent,
    });
  }

  // Årsväljaren — flerval där INNEVARANDE upplaga är en vanlig kryssruta
  // bland de arkiverade åren (inte en separat knapp bredvid) — kryssad som
  // förval. De facto två olika lagringsplatser (state.includeCurrentYear
  // för just den raden, state.years för resten) presenteras som EN
  // sömlös lista genom yearSelectionProxy nedan, som efterliknar ett
  // Set (size/has/add/delete/clear) men dirigerar innevarande upplagas
  // id till den booleanen i stället för till Set:et — buildPicker() bryr
  // sig aldrig om skillnaden. Kryssade år blandas in i hela appen (Schema/
  // Tabeller/Slutspel) OVANPÅ (eller i stället för, om innevarande år
  // kryssas ur) live-datan, se allActiveMatches().
  //
  // Till skillnad från dag-/klass-/lag-väljarna ovan (som håller sin egen
  // <details> vid liv över ändringar) anropar onChange en full render()
  // direkt — att ändra årsvalet kan ändra VILKA dagar/klasser/lag som ens
  // finns att välja bland, vilket ändå kräver att hela verktygsraden byggs
  // om. Känd konsekvens: dropdownen stängs efter varje enskilt årkryss
  // (måste öppnas igen för nästa val) — en medveten avvägning för v1.
  function buildYearPicker(editions, currentEdition) {
    const yearSelectionProxy = {
      get size() { return state.years.size + (state.includeCurrentYear ? 1 : 0); },
      has: (id) => id === currentEdition ? state.includeCurrentYear : state.years.has(id),
      add: (id) => { if (id === currentEdition) state.includeCurrentYear = true; else state.years.add(id); },
      delete: (id) => { if (id === currentEdition) state.includeCurrentYear = false; else state.years.delete(id); },
      clear: () => { state.years.clear(); state.includeCurrentYear = false; },
    };
    const items = [currentEdition, ...editions].map((y) => ({
      id: y, label: y, sortKey: -Number(y) || 0, sortName: y,
    }));
    return buildPicker({
      items,
      selected: yearSelectionProxy,
      emptyLabel: "Inga år valda",
      // Standardläget (bara innevarande år) ska fortfarande läsas som
      // "Innevarande år", inte det generiska "1 år" — annars ser den
      // vanligaste inställningen ut som ett aktivt urval i onödan.
      countLabel: (n) => (n === 1 && state.includeCurrentYear) ? "Innevarande år" : n + " år",
      searchPlaceholder: "Sök år …",
      onChange: () => {
        for (const y of state.years) ensureYearMatches(y);
        render();
      },
    });
  }

  // --- render: verktygsrad ----------------------------------------------------

  function renderToolbar() {
    const bar = $("#toolbar");
    bar.replaceChildren();
    if (!state.matches.length) return;
    const clubTeamsList = clubTeams();
    ensureArchiveEditions();
    const archiveEntry = state.archiveEditions[state.cupId];
    const archiveYears = (archiveEntry && archiveEntry.editions) || [];
    // state.years (vilka extra år som ska blandas in) sparas i localStorage
    // och överlever en omladdning, men de FAKTISKA matcherna
    // (state.yearMatches) gör det medvetet inte (se state-kommentaren) —
    // så varje redan valt år måste hämtas om här. ensureYearMatches() är
    // billig att anropa upprepade gånger (no-op om redan hämtat/hämtas).
    for (const edition of state.years) ensureYearMatches(edition);

    // Hela verktygsraden går i en expanderbar meny — så att den kan
    // minimeras när man valt filter/sortering klart, i stället för att
    // permanent ta plats högst upp i schemat. state.toolbarOpen styr
    // öppet/stängt över omritningar (annars skulle varje filterbyte,
    // som anropar render(), öppna den igen).
    const dd = h("details", {
      class: "toolbar-collapse",
      ...(state.toolbarOpen ? { open: "" } : {}),
    });
    dd.addEventListener("toggle", () => { state.toolbarOpen = dd.open; });
    const bodyEl = h("div", { class: "toolbar-body" });
    // lockSlot sitter INUTI <summary>, bredvid etikett-pillen, och hålls
    // vid liv separat (se längre ner) — så att låsknappen/den låsta klass-
    // chippen förblir synlig och klickbar även när man fällt ihop hela
    // filterpanelen, i stället för att gömmas undan med resten av
    // filtren. display:contents på wrappern gör att den inte syns som en
    // egen tom pill innan den fyllts. Klick på dess innehåll stoppas från
    // att bubbla upp (stopPropagation) så det inte råkar trigga <summary>s
    // inbyggda öppna/stäng-toggle.
    const lockSlot = h("span", { style: "display:contents", onclick: (e) => e.stopPropagation() });
    dd.append(
      h("summary", { class: "toolbar-summary" },
        h("span", { class: "toolbar-summary-label" }, "Filter och sortering"),
        lockSlot),
      bodyEl);
    bar.append(dd);
    const body = bodyEl;

    // Tillbaka-knapp: syns så snart man hoppat till en tillfällig
    // filtrering — ett lags kommande/spelade matcher (matchdialogens
    // snabblänkar, ett klickbart lagnamn i tabellerna eller på ett
    // matchkort) eller en specifik plan — oavsett vad som utlöste hoppet.
    // Ett enda tydligt sätt att komma tillbaka till sin egen vy, i stället
    // för att behöva pilla ihop filtren för hand.
    if (stashedFilter) {
      body.append(h("div", { class: "row" },
        h("button", {
          class: "chip back-chip", type: "button",
          onclick: () => restoreStashedFilter(),
        }, "← Tillbaka till din vy")));
    }

    // Aktivt filter på ett motståndarlag (satt via matchdialogens
    // snabblänkar) — klubbens egna lag hanteras redan synligt av
    // lagväljaren nedan, så den här raden visar bara lag som INTE är våra.
    const clubTeamIds = new Set(clubTeamsList.map((t) => t.id));
    const foreignTeamIds = [...state.teams].filter((id) => !clubTeamIds.has(id));
    if (foreignTeamIds.length) {
      body.append(h("div", { class: "row" },
        foreignTeamIds.map((id) =>
          chip((teamNameById(id) || "Okänt lag") + "  ✕", true, () => {
            if (!restoreStashedFilter()) { state.teams.delete(id); saveUi(); render(); }
          }))));
    }

    // Dagar och klasser — dropdown-väljare (sök-, filter- och sorterbara)
    // i stället för en knapp per dag/klass, som blir orimligt rörigt när
    // en cup spänner över många dagar eller klasser.
    const days = [...new Set(scoped().map((m) => dayKey(m.start)))].sort();
    const cats = new Map();
    for (const m of scoped()) if (m.catId) cats.set(m.catId, m.catName);
    const catEntries = [...cats.entries()].sort((a, b) =>
      catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));

    // Lagväljaren: nivå 2 i ett tvånivåfilter där klasserna ovan är
    // grundinställningen (nivå 1). I "Hela cupen"-läge (potentiellt
    // hundratals lag i en stor cup) visas lagväljaren först sedan minst en
    // klass valts, annars blir listan orimligt lång; i klubbläge (fåtal
    // egna lag) är den synlig direkt som förut, men smalnas ändå av om
    // klasser valts.
    function teamPickerCandidates() {
      const pool = state.scope === "club" ? clubTeamsList : allScopedTeams();
      return state.cats.size
        ? pool.filter((t) => state.cats.has(t.catId))
        : (state.scope === "club" ? pool : []);
    }

    // Klubb/hela cupen inleder raden. Matchstatus (alla/kommande/spelade)
    // följer i stället direkt efter filterkedjan, avskild med en tunn
    // vertikal linje (.row-sep) i stället för att pressas till högerkanten
    // — pressat till kanten såg konstigt/obalanserat ut på breda skärmar
    // (stort tomrum innan den), en avdelare räcker för att visa att den
    // hör till en annan kategori (läge, inte "vad ska visas").
    const scopeSeg = h("div", { class: "seg", role: "group", "aria-label": "Omfattning" },
      chip(state.favoriteClub, state.scope === "club", () => {
        state.scope = "club"; saveUi(); render();
      }),
      chip("Hela cupen", state.scope === "all", () => {
        state.scope = "all"; saveUi(); render();
      }));
    const statusSeg = h("div", { class: "seg", role: "group", "aria-label": "Matchstatus" },
      [["all", "Alla"], ["upcoming", "Kommande"], ["played", "Spelade"]].map(([v, l]) =>
        chip(l, state.matchFilter === v, () => {
          state.matchFilter = v; saveUi(); render();
        })));

    // Ett enda lås fryser år+dagar+klasser+lag TILLSAMMANS (till en chip
    // bredvid "Filter och sortering", se dd/lockSlot ovan) — tanken är att
    // man gör sin inställning en gång (t.ex. på morgonen) och sedan under
    // dagens återkommande snabbtitt inte råkar rubba den. Scope och
    // matchstatus räknas INTE in — de är ett visningsläge, inte en del av
    // grundinställningen som ska skyddas.
    function lockSummary() {
      const parts = [];
      if (!state.includeCurrentYear) {
        // Utan innevarande år (state.includeCurrentYear=false) blir "+"-
        // prefixet missvisande (inget att lägga OVANPÅ) — lista bara åren.
        const years = [...state.years].sort().reverse();
        parts.push(years.length ? years.join(", ") : "inget år valt");
      } else if (state.years.size) {
        const years = [...state.years].sort().reverse();
        parts.push("+" + (years.length <= 3 ? years.join(", ") : years.length + " extra år"));
      }
      if (state.days.size) {
        const names = days.filter((d) => state.days.has(d))
          .map((d) => fmtDay.format(new Date(d + "T00:00:00Z")));
        parts.push(names.length <= 2 ? names.join(", ") : names.length + " dagar");
      }
      if (state.cats.size) {
        const names = catEntries.filter(([id]) => state.cats.has(id)).map(([, name]) => HB.shortCat(name));
        parts.push(names.length <= 3 ? names.join(", ") : names.length + " klasser");
      }
      if (state.teams.size) {
        const names = [...state.teams].map((id) => teamNameById(id)).filter(Boolean);
        parts.push(names.length <= 2 ? names.join(", ") : names.length + " lag");
      }
      return parts.join(" · ");
    }
    const isLocked = isFilterLocked();

    // teamSlot hålls vid liv separat och bara ombyggd via replaceChildren()
    // (inte hela raden) så att ett enskilt klasskryss — som INTE bygger om
    // sin egen <details>-dropdown, se buildPicker ovan — ändå kan uppdatera
    // vilka lag som blir valbara utan att hela verktygsraden (och därmed
    // öppna dropdowns) byggs om.
    const teamSlot = h("span", { style: "display:contents" });
    const refreshTeamRow = () => {
      const candidates = teamPickerCandidates();
      teamSlot.replaceChildren(...(candidates.length > 1 ? [buildTeamPicker(candidates, onTeamOrDayChange)] : []));
    };

    // Låskontrollen (knapp när upplåst, klickbar sammanfattnings-chip när
    // låst) byggs här men lever i lockSlot bredvid "Filter och sortering"
    // (se ovan) i stället för i filterraden — där gjorde den sig konstigt
    // placerad mitt i eller sist i en lång kedja av chips, och försvann
    // dessutom ur sikte så fort man fällde ihop panelen.
    const refreshLockSlot = () => {
      if (days.length <= 1 && catEntries.length <= 1 && !archiveYears.length) {
        lockSlot.replaceChildren(); return;
      }
      if (isFilterLocked()) {
        lockSlot.replaceChildren(
          // Nollställ vy-filtret (viewCats/viewTeams) vid upplåsning — annars
          // fortsätter det osynligt att smalna av resultatet (ingen rad kvar
          // som visar/styr det, den försvinner ju med låset) trots att
          // bas-filtrets egna, nu synliga pickers ser ut att styra allt.
          chip("🔒 " + lockSummary(), true, () => {
            state.filterLocked = false;
            state.viewCats = new Set(); state.viewTeams = new Set();
            saveUi(); render();
          }));
      } else {
        lockSlot.replaceChildren(h("button", {
          class: "btn small", type: "button",
          ...(hasLockableSelection() ? {} : { disabled: "" }),
          title: "Lås dagar, klasser och lag så att inställningen inte ändras av misstag",
          onclick: () => {
            state.filterLocked = true;
            state.viewCats = new Set(); state.viewTeams = new Set();
            saveUi(); render();
          },
        }, "🔒 Lås"));
      }
    };
    // onCatChange bygger om lagväljarens kandidater (klassvalet styr vilka
    // lag som är valbara) — onTeamOrDayChange gör INTE det, för att undvika
    // att bygga om (och därmed stänga) lagväljarens egen öppna dropdown när
    // man kryssar i den.
    const onCatChange = () => { renderContent(); refreshLockSlot(); refreshTeamRow(); };
    const onTeamOrDayChange = () => { renderContent(); refreshLockSlot(); };
    refreshLockSlot();

    if (days.length > 1 || catEntries.length > 1) {
      const row = h("div", { class: "row" }, scopeSeg);
      if (!isLocked) {
        // Element.append() (till skillnad från h()) stringifierar null/
        // undefined till en bokstavlig "null"-textnod i stället för att
        // hoppa över dem — filtrera bort inaktuella delar (ingen arkiverad
        // historik/en enda dag/en enda klass) innan de skickas in.
        row.append(...[
          archiveYears.length ? buildYearPicker(archiveYears, cup().edition) : null,
          days.length > 1 ? buildDayPicker(days, onTeamOrDayChange) : null,
          catEntries.length > 1 ? buildCatPicker(catEntries, onCatChange) : null,
        ].filter((el) => el != null));
        refreshTeamRow();
        row.append(teamSlot);
      }
      row.append(h("span", { class: "row-sep" }), statusSeg);
      body.append(row);
    } else {
      if (!isLocked) refreshTeamRow();
      body.append(h("div", { class: "row" }, scopeSeg,
        (!isLocked && archiveYears.length) ? buildYearPicker(archiveYears, cup().edition) : null,
        isLocked ? null : teamSlot,
        h("span", { class: "row-sep" }), statusSeg));
    }

    const viewFilterRow = buildViewFilterRow();
    if (viewFilterRow) body.append(viewFilterRow);

    // Sök · plan · sortering · export
    const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
    // Autocomplete-förslag: lagnamn, planer och klasser ur den synliga listan.
    const suggestSet = new Set();
    for (const m of scoped()) {
      if (m.home.name) suggestSet.add(m.home.name);
      if (m.away.name) suggestSet.add(m.away.name);
      if (m.arena) suggestSet.add(m.arena);
      if (m.catName) suggestSet.add(m.catName);
    }
    const suggestions = [...suggestSet].sort((a, b) => a.localeCompare(b, "sv"));
    const searchInput = h("input", {
      class: "search", type: "search", placeholder: "Sök lag, plan, grupp …",
      title: "Stöder & (och) och / eller , (eller), t.ex. 2011&flickor/2013",
      value: state.q, list: "search-suggestions",
      // renderContent() (inte render()) — annars byggs sökfältet om vid
      // varje tangenttryckning och tappar fokus/mobiltangentbordet.
      oninput: (e) => {
        state.q = e.target.value;
        syncUrl(); // inte saveUi() — q ska inte fastna i localStorage mellan besök
        renderContent();
      },
    });
    body.append(h("div", { class: "row tools-row" },
      withClearButton(searchInput),
      h("datalist", { id: "search-suggestions" },
        suggestions.map((s) => h("option", { value: s }))),
      arenas.length > 1 ? h("select", {
        class: "select", "aria-label": "Plan",
        onchange: (e) => { state.arena = e.target.value; saveUi(); render(); },
      },
        h("option", { value: "" }, "Alla planer"),
        arenas.map((a) => h("option",
          { value: a, ...(state.arena === a ? { selected: "" } : {}) }, a))) : null,
      // Sorteringsvalet och Äldst/Nyast-knappen styr bara sorted()/state.sort,
      // som enbart renderSchema() läser — meningslösa (och missvisande, som
      // om de skulle kunna omordna slutspelstabellen/standings) på övriga
      // flikar, så de visas bara i Schema.
      state.view === "schema" ? h("select", {
        class: "select", "aria-label": "Sortering",
        onchange: (e) => { state.sort = e.target.value; saveUi(); render(); },
      },
        [["tid", "Sortera: tid"], ["klass", "Sortera: klass"], ["plan", "Sortera: plan"],
         ["resultat", "Sortera: resultat"], ["mal", "Sortera: mål"]]
          .map(([v, l]) => h("option",
            { value: v, ...(state.sort === v ? { selected: "" } : {}) }, l))) : null,
      // Bara meningsfull för tidssortering — klass/plan/resultat-grupperingen
      // har ingen enskild kronologisk riktning att vända på.
      state.view === "schema" && state.sort === "tid" ? h("button", {
        class: "chip", type: "button",
        title: state.timeOrder === "desc"
          ? "Nyast/kommande överst — klicka för äldst överst"
          : "Äldst överst — klicka för nyast/kommande överst",
        onclick: () => {
          state.timeOrder = state.timeOrder === "desc" ? "asc" : "desc";
          state.schemaOlderRevealCount = 0; // ny riktning: börja om med "visa fler tidigare"
          // render() (inte renderContent()) — knappens egen etikett/state
          // ligger i verktygsraden, som bara render() bygger om.
          saveUi(); render();
        },
      }, state.timeOrder === "desc" ? "↓ Nyast överst" : "↑ Äldst överst") : null,
      buildExportPicker(),
    ));
  }

  // Exporterar exakt den synliga, filtrerade (och för Schema: sorterade)
  // datan för den flik man står på — inga dolda undantag. Schema/Bana
  // exporterar matchlistan (samma urval i alla format); Tabeller exporterar
  // de tabeller som faktiskt visas; Slutspel exporterar den visade
  // slutspelstabellen eller — om man väljer det — samtliga.
  function exportBaseName() {
    return cup().id + "-" + (state.scope === "club" ? "ahk" : "alla");
  }

  function buildExportPicker() {
    const dd = h("details", { class: "team-picker-dd export-dd" });
    const summary = h("summary", { class: "chip team-picker-summary" }, "Exportera");
    const item = (label, onClick) => h("button", {
      class: "export-item", type: "button",
      onclick: () => { onClick(); dd.open = false; },
    }, label);
    const panel = state.view === "tabeller" ? buildTablesExportPanel(item)
      : state.view === "slutspel" ? buildPlayoffExportPanel(item)
      : buildMatchExportPanel(item);
    dd.append(summary, panel);
    return dd;
  }

  function buildMatchExportPanel(item) {
    return h("div", { class: "team-picker-panel export-panel" },
      item("📅 Kalender (.ics)", () => {
        const list = sorted(filtered());
        if (list.length) HB.ics.download(cup(), list, exportBaseName() + ".ics", state.matchMinutes);
      }),
      item("📊 Kalkylark (.xlsx)", () => {
        const list = sorted(filtered());
        if (list.length) HB.xlsx.download(cup(), list, exportBaseName() + ".xlsx");
      }),
      item("CSV (.csv)", () => {
        const list = sorted(filtered());
        if (list.length) HB.csv.download(cup(), list, exportBaseName() + ".csv");
      }),
      item("JSON (.json)", () => {
        const list = sorted(filtered());
        if (list.length) HB.json.downloadTable(HB.matchExportFields, HB.exportRows(list), exportBaseName() + ".json");
      }),
      item("XML (.xml)", () => {
        const list = sorted(filtered());
        if (list.length) {
          HB.xmlExport.downloadTable(HB.matchExportFields, HB.exportRows(list),
            "matcher", "match", exportBaseName() + ".xml");
        }
      }));
  }

  const TABLE_EXPORT_FIELDS = [
    { label: "Klass", key: "klass" }, { label: "Grupp", key: "grupp" },
    { label: "#", key: "plac" }, { label: "Lag", key: "lag" },
    { label: "S", key: "spelade" }, { label: "V", key: "vunna" },
    { label: "O", key: "oavgjorda" }, { label: "F", key: "forlorade" },
    { label: "+/-", key: "malskillnad" }, { label: "P", key: "poang" },
  ];

  // Samma divisioner som renderTables() faktiskt visar (divisionsToShow()),
  // med samma tabelldata (state.tables, redan hämtad av renderTables) —
  // ingen egen fetch, exporten är alltid i synk med det man ser på skärmen.
  function tablesExportData() {
    const rows = [];
    for (const d of divisionsToShow()) {
      const t = state.tables[d.id];
      if (!t || t.status !== "done" || !t.rows.length) continue;
      const klass = d.catName + (state.years.size ? " " + (d.edition || cup().edition) : "");
      t.rows.forEach((r, i) => {
        rows.push({
          klass, grupp: d.name || "Grupp", plac: i + 1, lag: r.name,
          spelade: r.played, vunna: r.won, oavgjorda: r.tied, forlorade: r.lost,
          malskillnad: r.gf - r.ga, poang: r.points,
        });
      });
    }
    return { fields: TABLE_EXPORT_FIELDS, rows };
  }

  function buildTablesExportPanel(item) {
    return h("div", { class: "team-picker-panel export-panel" },
      item("📊 Kalkylark (.xlsx)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.xlsx.downloadTable(fields, rows, exportBaseName() + "-tabeller.xlsx", "Tabeller");
      }),
      item("CSV (.csv)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.csv.downloadTable(fields, rows, exportBaseName() + "-tabeller.csv");
      }),
      item("JSON (.json)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.json.downloadTable(fields, rows, exportBaseName() + "-tabeller.json");
      }),
      item("XML (.xml)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.xmlExport.downloadTable(fields, rows, "tabeller", "rad", exportBaseName() + "-tabeller.xml");
      }));
  }

  const PLAYOFF_EXPORT_FIELDS = [
    { label: "Klass", key: "klass" }, { label: "Slutspel", key: "slutspel" },
    { label: "Omgång", key: "omgang" }, { label: "Nr", key: "nr" },
    { label: "Hemmalag", key: "hemmalag" }, { label: "Bortalag", key: "bortalag" },
    { label: "Resultat", key: "resultat" }, { label: "Tid", key: "tid" }, { label: "Bana", key: "bana" },
  ];

  // Vilken klass/division renderPlayoffs() just nu faktiskt visar — samma
  // urvalslogik som där (state.playoffCatTab/state.playoffDivTab), men
  // fristående av den fungerar oavsett om trädet eller tabellen är byggd.
  function currentPlayoffSelection() {
    const cats = categoriesToShow();
    if (!cats.length) return null;
    const selCat = cats.length > 1 ? (cats.find((c) => c.catId === state.playoffCatTab) || cats[0]) : cats[0];
    const p = state.playoffs[selCat.catId];
    if (!p || p.status !== "done" || !p.divisions.length) return { cat: selCat, div: null };
    const selDiv = p.divisions.length > 1
      ? (p.divisions.find((d) => d.id === state.playoffDivTab[selCat.catId]) || p.divisions[0])
      : p.divisions[0];
    return { cat: selCat, div: selDiv };
  }

  // Naturlig ordning (finalen överst) — samma princip som bracketTableBlock().
  function playoffDivExportRows(cat, div) {
    const klass = cat.catName + (state.years.size ? " " + (cat.edition || cup().edition) : "");
    return groupPlayoffRounds(div).flatMap(([, ms]) => ms).reverse().map((m) => ({
      klass, slutspel: div.name || "", omgang: m.roundName || "", nr: m.matchNr || "",
      hemmalag: m.home.name || "TBD", bortalag: m.away.name || "TBD",
      resultat: scoreText(m.res) || "",
      tid: dayKeyFmt.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)),
      bana: m.arena || "",
    }));
  }

  function playoffExportData(scopeAll) {
    let rows = [];
    if (scopeAll) {
      for (const cat of categoriesToShow()) {
        const p = state.playoffs[cat.catId];
        if (!p || p.status !== "done") continue;
        for (const div of p.divisions) rows = rows.concat(playoffDivExportRows(cat, div));
      }
    } else {
      const sel = currentPlayoffSelection();
      if (sel && sel.div) rows = playoffDivExportRows(sel.cat, sel.div);
    }
    return { fields: PLAYOFF_EXPORT_FIELDS, rows };
  }

  // "Samtliga tabeller" kan innebära klasser vars slutspel aldrig hämtats
  // (renderPlayoffs laddar bara den just visade klassen) — startar hämtning
  // för alla och väntar kort in dem innan export, i stället för att tyst
  // exportera ett ofullständigt urval.
  async function ensureAllPlayoffsLoaded(cats) {
    for (const cat of cats) ensurePlayoffs(cat.catId, cat.edition);
    for (let i = 0; i < 50; i++) {
      if (cats.every((cat) => state.playoffs[cat.catId] && state.playoffs[cat.catId].status !== "loading")) return;
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  let exportPlayoffScope = "current"; // session, sparas ej — samma princip som bracketSort

  function buildPlayoffExportPanel(item) {
    const scopeBtnCurrent = h("button", { class: "chip", type: "button" }, "Visad tabell");
    const scopeBtnAll = h("button", { class: "chip", type: "button" }, "Samtliga tabeller");
    const syncScope = () => {
      scopeBtnCurrent.classList.toggle("on", exportPlayoffScope === "current");
      scopeBtnAll.classList.toggle("on", exportPlayoffScope === "all");
    };
    scopeBtnCurrent.onclick = () => { exportPlayoffScope = "current"; syncScope(); };
    scopeBtnAll.onclick = () => { exportPlayoffScope = "all"; syncScope(); };
    syncScope();
    const run = async (fn) => {
      const all = exportPlayoffScope === "all";
      if (all) await ensureAllPlayoffsLoaded(categoriesToShow());
      const { fields, rows } = playoffExportData(all);
      if (rows.length) fn(fields, rows);
    };
    return h("div", { class: "team-picker-panel export-panel" },
      h("div", { class: "team-picker-sort-row" }, scopeBtnCurrent, scopeBtnAll),
      item("📊 Kalkylark (.xlsx)", () => run((fields, rows) =>
        HB.xlsx.downloadTable(fields, rows, exportBaseName() + "-slutspel.xlsx", "Slutspel"))),
      item("CSV (.csv)", () => run((fields, rows) =>
        HB.csv.downloadTable(fields, rows, exportBaseName() + "-slutspel.csv"))),
      item("JSON (.json)", () => run((fields, rows) =>
        HB.json.downloadTable(fields, rows, exportBaseName() + "-slutspel.json"))),
      item("XML (.xml)", () => run((fields, rows) =>
        HB.xmlExport.downloadTable(fields, rows, "slutspel", "match", exportBaseName() + "-slutspel.xml"))));
  }

  // --- render: hero (nästa match) ------------------------------------------

  const HERO_MAX = 5;

  // Klubbens närmast kommande matcher (upp till HERO_MAX stycken), tidigast
  // först — inte bara EN godtyckligt plockad match, så heron kan visa dem
  // som en karusell att bläddra igenom (t.ex. flera lag som spelar samma
  // dag, eller flera som råkar starta exakt samtidigt på olika planer).
  function nextClubMatches() {
    const now = Date.now();
    const pool = state.matches.filter(isClubMatch).filter((m) => {
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      return !(m.res && m.res.fin) && m.start >= now - 30 * 60000;
    });
    return pool
      .sort((a, b) => a.start - b.start ||
        (a.arena || "").localeCompare(b.arena || "", "sv", { numeric: true }))
      .slice(0, HERO_MAX);
  }

  function nextClubMatch() {
    return nextClubMatches()[0] || null;
  }

  function countdownText(ms) {
    const diff = ms - Date.now();
    if (diff <= 0) return "nu";
    const min = Math.round(diff / 60000);
    if (min < 60) return "om " + min + " min";
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return "om " + hrs + " h " + (min % 60) + " min";
    return "om " + Math.floor(hrs / 24) + " d";
  }

  // Vilket kort i karusellen som visas — modulvariabel (inte i state) så
  // den överlever renderContent()-omritningar men glöms bort vid cupbyte.
  let heroIndex = 0;

  // Auto-skrollet till NU-linjen ska bara ske en gång per sidladdning/
  // cupbyte — inte vid VARJE renderContent() (annars rycker sidan iväg
  // varje gång man t.ex. swipear i nästa match-karusellen, söker, eller
  // byter filter). Nollställs i switchCup().
  let autoScrolledToNow = false;

  // Auto-rotationens timer måste rensas vid VARJE renderHero()-anrop
  // (inte bara när karusellen försvinner) — annars pekar en gammal
  // timer-closure på en förlegad matches-array från en tidigare omritning.
  let heroAutoTimer = null;
  const HERO_AUTO_MS = 6000;

  // Riktningen på det senaste bytet (1 = framåt/nästa, -1 = bakåt/förra) —
  // styr vilket håll det nya kortet glider in ifrån. En fristående modul-
  // variabel (som heroIndex) eftersom den ska överleva renderContent().
  let heroDir = 1;

  // Vilket index som senast fick glid-in-animationen — så en omritning
  // som INTE beror på ett karusellbyte (t.ex. ett filterval någon
  // annanstans på sidan) inte råkar spela upp animationen i onödan.
  let heroLastAnimatedIdx = null;

  function renderHero(main) {
    clearInterval(heroAutoTimer);
    const matches = nextClubMatches();
    if (!matches.length) return;
    if (heroIndex >= matches.length) heroIndex = 0;
    const isNewCard = heroLastAnimatedIdx !== heroIndex;
    heroLastAnimatedIdx = heroIndex;
    const m = matches[heroIndex];
    const live = isLive(m);
    const carousel = matches.length > 1;
    const step = (dir) => {
      heroDir = dir;
      heroIndex = (heroIndex + dir + matches.length) % matches.length;
      renderContent();
    };
    const goTo = (i) => {
      heroDir = i > heroIndex ? 1 : -1;
      heroIndex = i;
      renderContent();
    };
    // <details> ger minimera/expandera gratis (samma mönster som
    // toolbar-collapse) — state.heroMinimized överlever omritningar så en
    // manuell minimering inte studsar tillbaka öppen vid nästa render().
    const heroEl = h("details", {
      class: "hero" + (carousel ? " hero-carousel" : ""), id: "hero",
      ...(state.heroMinimized ? {} : { open: "" }),
    },
      h("summary", { class: "hero-summary" },
        live ? h("span", { class: "live-dot" }) : null,
        live ? "Pågår nu" : (heroIndex === 0 ? "Nästa match" : "Kommande match"),
        h("span", { class: "hero-count" }, live ? "" : countdownText(m.start))),
      carousel ? h("button", {
        class: "hero-nav hero-prev", type: "button", "aria-label": "Föregående match",
        onclick: () => step(-1),
      }, "‹") : null,
      carousel ? h("button", {
        class: "hero-nav hero-next", type: "button", "aria-label": "Nästa match",
        onclick: () => step(1),
      }, "›") : null,
      h("div", {
        class: "hero-card" +
          (isNewCard ? (heroDir < 0 ? " hero-card-prev" : " hero-card-next") : ""),
      },
        h("div", { class: "hero-teams" },
          h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name,
            isFavoriteTeamName(m.home.name) ? h("span", { class: "fav-team-star" }, "⭐") : null),
          h("span", { class: "vs" }, live && scoreText(m.res) ? scoreText(m.res) : "mot"),
          h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name,
            isFavoriteTeamName(m.away.name) ? h("span", { class: "fav-team-star" }, "⭐") : null)),
        h("div", { class: "hero-info" },
          fmtDayLong.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)),
          h("span", { class: "dot" }, "·"), m.arena || "plan ej satt",
          h("span", { class: "dot" }, "·"),
          HB.shortCat(m.catName) + (m.divName ? " " + m.divName : ""),
          (() => {
            const w = HB.weather.at(HB.weather.cached(cup()), m.start);
            return w ? [h("span", { class: "dot" }, "·"), w.icon + " " + w.temp + "°"] : null;
          })())),
      carousel ? h("div", { class: "hero-dots" },
        matches.map((_, i) => h("button", {
          class: "hero-dot" + (i === heroIndex ? " on" : ""), type: "button",
          "aria-label": "Match " + (i + 1) + " av " + matches.length,
          onclick: () => goTo(i),
        }))) : null);
    heroEl.addEventListener("toggle", () => { state.heroMinimized = !heroEl.open; });
    main.append(heroEl);
    if (!carousel) return;

    // Auto-rotation — pausar när fliken inte är synlig (ingen anledning
    // att bläddra i bakgrunden) och nollställs vid varje omritning, så en
    // manuell swipe/klick/prick skjuter naturligt upp nästa auto-steg.
    // Självstädande: om man byter bort från schemavyn slutar heron
    // renderas (och renderHero() slutar därmed rensa timern), så den
    // kollar själv och stänger av sig i stället för att tugga i bakgrunden.
    heroAutoTimer = setInterval(() => {
      if (state.view !== "schema") { clearInterval(heroAutoTimer); return; }
      if (document.visibilityState === "visible") step(1);
    }, HERO_AUTO_MS);

    // Swipe (touch) — vänster/höger byter kort. Kräver en tydligt
    // horisontell rörelse (annars tolkas det som vanlig vertikal
    // sidskrollning, inte ett byte).
    let touchX = null, touchY = null;
    heroEl.addEventListener("touchstart", (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }, { passive: true });
    heroEl.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        step(dx < 0 ? 1 : -1);
      }
    });
  }

  // --- matchdialog: lagstatistik + snabblänkar --------------------------------

  function teamMatchCounts(teamId) {
    let played = 0, upcoming = 0;
    for (const m of state.matches) {
      if (m.home.id !== teamId && m.away.id !== teamId) continue;
      if (m.res && m.res.fin) played++; else upcoming++;
    }
    return { total: played + upcoming, played, upcoming };
  }

  function findTableRow(rows, team) {
    return rows.find((r) => r.teamId === team.id) ||
      rows.find((r) => r.name === team.name);
  }

  // Sparar det filter (scope, dagar, klasser, lag, plan, matchstatus,
  // sortering) som gällde INNAN man hoppade till en enskild matchs/lags
  // schema via gotoMatch()/gotoTeamMatches() — så grundinställningen kan
  // återställas efteråt i stället för att bara försvinna. Skrivs bara om
  // det inte redan finns ett sparat läge, så flera hopp i följd (t.ex.
  // klicka vidare från en matchdialog till en annan) alltid går tillbaka
  // till den UR­SPRUNGLIGA grundinställningen, inte den senaste mellanvyn.
  let stashedFilter = null;

  function stashFilterIfNeeded() {
    if (stashedFilter) return;
    stashedFilter = {
      scope: state.scope, days: new Set(state.days), cats: new Set(state.cats),
      teams: new Set(state.teams), arena: state.arena,
      matchFilter: state.matchFilter, sort: state.sort,
    };
  }

  function restoreStashedFilter() {
    if (!stashedFilter) return false;
    state.scope = stashedFilter.scope;
    state.days = new Set(stashedFilter.days);
    state.cats = new Set(stashedFilter.cats);
    state.teams = new Set(stashedFilter.teams);
    state.arena = stashedFilter.arena;
    state.matchFilter = stashedFilter.matchFilter;
    state.sort = stashedFilter.sort;
    stashedFilter = null;
    saveUi();
    render();
    return true;
  }

  // Navigerar till schemavyn med båda lagen i en specifik match filtrerade
  // fram (klubb- eller motståndarlag, oavsett) — så en slutspelsmatch går
  // att se i sitt naturliga sammanhang bland lagens övriga matcher, i
  // stället för bara i en isolerad dialogruta.
  function gotoMatch(m) {
    stashFilterIfNeeded();
    state.scope = "all";
    state.q = "";
    state.teams = new Set([m.home.id, m.away.id].filter((id) => id != null));
    state.cats = new Set();
    state.days = new Set();
    state.arena = "";
    state.matchFilter = "all";
    state.sort = "tid";
    state.view = "schema";
    saveUi();
    render();
  }

  function gotoTeamMatches(team, mode) {
    // Filtrera på exakt lag-id, inte namnsökning — flera lag delar ofta
    // prefix ("Alingsås HK" är ett substräng-delnamn av "Alingsås HK Blå"
    // m.fl.), så en textsökning skulle dra in alla syskonlagens matcher.
    stashFilterIfNeeded();
    state.scope = "all";
    state.q = "";
    state.teams = new Set([team.id]);
    state.cats = new Set();
    state.days = new Set();
    state.arena = "";
    state.matchFilter = mode;
    state.view = "schema";
    saveUi();
    closeMatchDialog();
    render();
  }

  function teamNameById(id) {
    const m = state.matches.find((mm) => mm.home.id === id || mm.away.id === id);
    if (!m) return null;
    return m.home.id === id ? m.home.name : m.away.name;
  }

  function closeMatchDialog() {
    const dlg = $(".match-dialog");
    if (dlg) dlg.close();
  }

  // Trupplista (om cupen har sådan data, se cup.hasRosters) — shirtnummer,
  // position, mål. Bara Partille/Gothia-cuper hittills, och bara för lag
  // som faktiskt matat in en trupp (de flesta yngre/mindre lag har ingen).
  function rosterBlock(team, edition) {
    if (!cup().hasRosters) return null;
    const players = rosterFor(team, edition);
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) =>
      (a.shirtNr == null ? 999 : a.shirtNr) - (b.shirtNr == null ? 999 : b.shirtNr));
    return h("div", { class: "team-roster" },
      h("h4", null, "Trupp"),
      h("ul", { class: "team-roster-list" },
        sorted.map((p) => h("li", null,
          h("span", { class: "roster-nr" }, p.shirtNr != null ? String(p.shirtNr) : "–"),
          h("span", { class: "roster-name" }, p.name),
          p.position ? h("span", { class: "roster-pos" }, p.position) : null,
          p.goals ? h("span", { class: "roster-goals" }, p.goals + " mål") : null))));
  }

  function teamStatBlock(m, team, side) {
    const counts = teamMatchCounts(team.id);
    const statLine = h("p", { class: "muted team-stat-line" }, "Hämtar tabellplacering …");
    const calUrl = calendarSubscribeUrl(team);
    const box = h("div", { class: "team-stat-block" },
      h("h3", { class: isClubName(team.name) ? "us" : "" }, team.name),
      statLine,
      h("p", { class: "muted" },
        counts.total + " matcher totalt · " + counts.played + " spelade · " +
        counts.upcoming + " kommande"),
      h("div", { class: "team-stat-actions" },
        h("button", {
          class: "btn small", type: "button",
          disabled: counts.upcoming === 0 ? "" : null,
          onclick: () => gotoTeamMatches(team, "upcoming"),
        }, "Kommande matcher"),
        h("button", {
          class: "btn small", type: "button",
          disabled: counts.played === 0 ? "" : null,
          onclick: () => gotoTeamMatches(team, "played"),
        }, "Spelade matcher"),
        calUrl ? h("a", {
          class: "btn small", href: calUrl, target: "_blank", rel: "noopener",
          title: "Lägg till i din kalenderapp för att prenumerera — nya/ändrade matcher dyker upp automatiskt",
        }, "📅 Prenumerera") : null),
      rosterBlock(team, m.edition));

    if (!m.divId) {
      statLine.textContent = "Ingen tabell tillgänglig för den här klassen.";
      return box;
    }
    ensureDialogTable(m.divId).then((rows) => {
      if (!rows.length) {
        statLine.textContent = "Ingen tabell tillgänglig för den här gruppen.";
        return;
      }
      const idx = rows.findIndex((r) => r === findTableRow(rows, team));
      if (idx < 0) {
        statLine.textContent = "Laget hittades inte i gruppens tabell.";
        return;
      }
      const r = rows[idx];
      statLine.textContent = "#" + (idx + 1) + " i " + m.divName + " · " +
        r.played + " S, " + r.won + "V–" + r.tied + "O–" + r.lost + "F · " +
        r.gf + "–" + r.ga + " · " + r.points + " p";
    });
    return box;
  }

  let dialogTableCache = {};

  function ensureDialogTable(divId) {
    if (!dialogTableCache[divId]) {
      dialogTableCache[divId] = HB.api.fetchTable(cup(), divId).catch(() => []);
    }
    return dialogTableCache[divId];
  }

  function previousMeetingsBlock(m) {
    const box = h("div", { class: "prev-meetings" });
    HB.api.fetchPreviousMeetings(cup(), m.id).then((meetings) => {
      if (!meetings.length) { box.remove(); return; }
      box.append(
        h("h4", null, "Tidigare möten"),
        h("ul", { class: "prev-meetings-list" },
          meetings.map((pm) => h("li", null,
            fmtDay.format(new Date(pm.start)) + ": " + pm.home.name + " " +
            (scoreText(pm.res) || "–") + " " + pm.away.name))));
    }).catch(() => box.remove());
    return box;
  }

  // Lättviktig snabbvy för ETT lag (tabellplacering + kommande/spelade),
  // öppnad genom att klicka direkt på ett lagnamn i ett matchkort — utan
  // att behöva öppna hela matchdialogen (som visar båda lagen).
  function openTeamQuickView(m, team) {
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      teamStatBlock(m, team));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // Filtrerar schemat till en specifik plan — återanvänder samma
  // state.arena som plan-dropdownen i verktygsraden, så "Alla planer"
  // där är den naturliga vägen tillbaka. Anropas numera bara explicit
  // (knappen i openArenaQuickView), inte direkt vid klick på en bana —
  // se den funktionen för varför.
  function filterByArena(arena) {
    stashFilterIfNeeded();
    state.arena = arena;
    saveUi();
    render();
  }

  // Snabbtitt på en specifik plan — UTAN att röra det aktuella filtret.
  // Tänkt för att stå vid en bana och snabbt se vad som spelas där, sedan
  // stänga och vara kvar exakt där man var — till skillnad från
  // filterByArena() (som byter hela schemavyn och kräver "Tillbaka" för
  // att ångra). Listar ALLA matcher på banan, oavsett aktuellt filter.
  function openArenaQuickView(arena) {
    const matches = state.matches
      .filter((m) => m.arena === arena)
      .sort((a, b) => a.start - b.start);
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      h("div", { class: "match-dialog-head" },
        h("span", { class: "cat" }, arena),
        h("span", null, matches.length + " matcher")),
      h("button", {
        class: "btn small", type: "button",
        onclick: () => { dlg.close(); filterByArena(arena); },
      }, "Filtrera schemat till " + arena),
      h("div", { class: "arena-quick-list" }, matches.map(matchCard)));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // --- historik: jämför resultat mellan cupens år -------------------------

  // Plockar ut matcher för lag vars namn innehåller `query` (case-
  // insensitive delsträng — så "Alingsås HK" fångar alla klubbens lag,
  // medan ett mer specifikt namn ger ett enskilt lag) och berikar varje
  // rad med `opponent`/`outcome`/`homeIsUs` för filtrering/sortering.
  // Ingen teamId att matcha mot: id:n är inte stabila mellan cupens år.
  function summarizeArchiveMatches(matches, query) {
    const q = query.trim().toLowerCase();
    const rows = [];
    if (!q) return rows;
    for (const m of matches) {
      const homeIsUs = m.home.name.toLowerCase().includes(q);
      const awayIsUs = m.away.name.toLowerCase().includes(q);
      if (!homeIsUs && !awayIsUs) continue;
      let outcome = null;
      if (m.res && m.res.fin) {
        outcome = !m.res.winner ? "O" : ((m.res.winner === "home") === homeIsUs ? "V" : "F");
      }
      rows.push({ ...m, homeIsUs, opponent: homeIsUs ? m.away.name : m.home.name, outcome });
    }
    return rows;
  }

  function archiveStats(rows) {
    let played = 0, won = 0, tied = 0, lost = 0, gf = 0, ga = 0;
    for (const r of rows) {
      if (!r.res || !r.res.fin) continue;
      played++;
      gf += (r.homeIsUs ? r.res.hg : r.res.ag) || 0;
      ga += (r.homeIsUs ? r.res.ag : r.res.hg) || 0;
      if (r.outcome === "V") won++;
      else if (r.outcome === "F") lost++;
      else if (r.outcome === "O") tied++;
    }
    return { played, won, tied, lost, gf, ga };
  }

  const ARCHIVE_SORTS = [
    ["tid_desc", "Sortera: nyast"], ["tid_asc", "Sortera: äldst"],
    ["resultat", "Sortera: resultat"], ["motstandare", "Sortera: motståndare"],
    ["klass", "Sortera: klass"],
  ];

  function sortArchiveRows(rows, sortKey) {
    const arr = rows.slice();
    const rank = { V: 0, O: 1, F: 2 };
    if (sortKey === "tid_asc") arr.sort((a, b) => a.start - b.start);
    else if (sortKey === "resultat") {
      arr.sort((a, b) => (rank[a.outcome] ?? 3) - (rank[b.outcome] ?? 3) || b.start - a.start);
    } else if (sortKey === "motstandare") {
      arr.sort((a, b) => a.opponent.localeCompare(b.opponent, "sv"));
    } else if (sortKey === "klass") {
      arr.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
        a.opponent.localeCompare(b.opponent, "sv"));
    } else {
      arr.sort((a, b) => b.start - a.start); // tid_desc (förval)
    }
    return arr;
  }

  function archiveMatchRow(m) {
    const sc = scoreText(m.res);
    return h("div", { class: "arch-row" },
      h("span", { class: "arch-date" },
        fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))),
      h("span", { class: "arch-teams" },
        h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name),
        " – ",
        h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name)),
      m.outcome ? h("span",
        { class: "outcome-badge outcome-" + m.outcome.toLowerCase() }, m.outcome) : null,
      h("span", { class: "arch-score" }, sc || "–"),
      m.catName ? h("span", { class: "arch-cat" }, HB.shortCat(m.catName)) : null);
  }

  // Grupperar en lista matcher per divId — samma divisionsform
  // ({id,name,matches}) som HB.api.fetchPlayoffs() ger live, så
  // bracketBlock/groupPlayoffRounds/drawBracketConnectors kan återanvändas
  // rakt av oavsett källa (arkiverad edition via historicalPlayoffDivisions
  // nedan, ELLER ett extra år inblandat i huvudappen, se ensurePlayoffs()).
  function groupPlayoffDivisionsById(matches) {
    const byDiv = new Map();
    for (const m of matches) {
      if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
      byDiv.get(m.divId).matches.push(m);
    }
    return [...byDiv.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
  }

  // Grupperar en arkiverad edition ALLA matcher (inte bara den sökta
  // klubbens) för en given klass i slutspelsträd. divType (satt av
  // scripts/fetch_cupmanager.py sedan 2026-07) är det enda tillförlitliga
  // sättet att skilja slutspel från gruppspel — roundRank kan vara 0 för
  // båda.
  function historicalPlayoffDivisions(matches, catName) {
    return groupPlayoffDivisionsById(
      matches.filter((m) => m.divType === "Playoff" && m.catName === catName));
  }

  // Räknar fram gruppställning (S/V/O/F/mål/poäng) från matchresultat för
  // EN division — cupens egen slutgiltiga tabell arkiveras inte (bara
  // matcherna), så det här är en lokal, förenklad rekonstruktion (2 poäng
  // vinst/1 oavgjort, standard i svensk ungdomshandboll) — kan skilja sig
  // från originalets exakta regler vid t.ex. inbördes möte-särskiljning.
  // Delad av historicalGroupTables (Historik-modalen) och ensureTable()
  // (huvudappens Tabeller-flik, för divisioner som hör till ett extra
  // inblandat år i stället för innevarande live-upplaga).
  function computeGroupTableRows(divMatches) {
    const teams = new Map();
    const ensure = (id, name) => {
      if (!teams.has(id)) {
        teams.set(id, { teamId: id, name, played: 0, won: 0, tied: 0, lost: 0, gf: 0, ga: 0 });
      }
      return teams.get(id);
    };
    for (const m of divMatches) {
      if (!m.res || !m.res.fin || m.res.wo) continue;
      if (m.home.id == null || m.away.id == null) continue;
      const home = ensure(m.home.id, m.home.name), away = ensure(m.away.id, m.away.name);
      home.played++; away.played++;
      home.gf += m.res.hg || 0; home.ga += m.res.ag || 0;
      away.gf += m.res.ag || 0; away.ga += m.res.hg || 0;
      if (m.res.winner === "home") { home.won++; away.lost++; }
      else if (m.res.winner === "away") { away.won++; home.lost++; }
      else { home.tied++; away.tied++; }
    }
    const rows = [...teams.values()].map((t) => ({ ...t, points: t.won * 2 + t.tied }));
    rows.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf ||
      a.name.localeCompare(b.name, "sv"));
    return rows;
  }

  function historicalGroupTables(matches, catName) {
    const byDiv = new Map();
    for (const m of matches) {
      if (m.divType !== "Conference" || m.catName !== catName) continue;
      if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
      byDiv.get(m.divId).matches.push(m);
    }
    const tables = [];
    for (const d of byDiv.values()) {
      const rows = computeGroupTableRows(d.matches);
      if (rows.length) tables.push({ id: d.id, name: d.name, rows });
    }
    tables.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
    return tables;
  }

  function historicalTableBlock(t) {
    return h("section", { class: "table-box" },
      h("h3", null, t.name || "Grupp"),
      h("table", { class: "standings" },
        h("thead", null, h("tr", null,
          ["#", "Lag", "S", "V", "O", "F", "+/-", "P"].map((c, i) =>
            h("th", { class: i < 2 ? "l" : "" }, c)))),
        h("tbody", null, t.rows.map((r, i) =>
          h("tr", { class: isClubName(r.name) ? "us" : "" },
            h("td", null, String(i + 1)),
            h("td", { class: "l" }, r.name),
            h("td", null, String(r.played)),
            h("td", null, String(r.won)),
            h("td", null, String(r.tied)),
            h("td", null, String(r.lost)),
            h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
            h("td", { class: "pts" }, String(r.points)))))));
  }

  // Bygger slutspelsträd + tabeller för EN klass i en arkiverad edition —
  // hela editionens matcher (inte bara den sökta klubbens), eftersom ett
  // träd/en tabell behöver alla lag för att bli meningsfull. Returnerar
  // {nodes, redraw}: nodes bifogas efter matchlistan i historik-dialogen
  // (tomt om klassen varken har slutspel eller grupptabeller arkiverade);
  // redraw (null om inget träd) MÅSTE anropas av den som lägger till
  // noderna, både efter att de sitter i det levande DOM-trädet OCH varje
  // gång de blir synliga igen — boxarna ligger inuti en <details> som är
  // stängd för alla år utom det första, och getBoundingClientRect() ger
  // meningslösa (0×0) mått på dolt innehåll.
  function historicalExtras(matches, catName) {
    const nodes = [];
    let redraw = null;
    const playoffDivs = historicalPlayoffDivisions(matches, catName);
    if (playoffDivs.length) {
      const boxes = playoffDivs.map((d) => bracketBlock(d, null, () => {}));
      nodes.push(h("h4", { class: "history-sub-h" }, "Slutspel"),
        h("div", { class: "bracket-row" }, boxes));
      redraw = () => playoffDivs.forEach((d, i) => drawBracketConnectors(boxes[i], d, 1));
    }
    const tables = historicalGroupTables(matches, catName);
    if (tables.length) {
      nodes.push(h("h4", { class: "history-sub-h" }, "Tabeller"), ...tables.map(historicalTableBlock));
    }
    return { nodes, redraw };
  }

  // Grupperar en lista arkiverade matcher per kalenderdag (dayKey) —
  // enklare variant av timeGroups(), utan NU-linje/auto-scroll som inte
  // är meningsfullt för redan avgjorda historiska matcher.
  function groupArchiveByDay(matches) {
    const groups = [];
    for (const m of matches.slice().sort((a, b) => a.start - b.start)) {
      const key = dayKey(m.start);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, items: [m] });
    }
    return groups;
  }

  function archiveClassOptions(matches, divType) {
    const set = new Set();
    for (const m of matches) {
      if (divType && m.divType !== divType) continue;
      if (m.catName) set.add(m.catName);
    }
    return [...set].sort((a, b) => catSortKey(a) - catSortKey(b));
  }

  // --- historik, läge "Bläddra i ett år": full mini-app (Schema/Tabeller/
  // Slutspel/Bana) för EN vald cup+edition, med egen lokal state (hs) helt
  // frikopplad från huvudappens `state` — kan alltså inte störa/krocka med
  // den vanliga live-vyn, samtidigt som den återanvänder samma byggstenar
  // (bracketBlock, historicalGroupTables, archiveMatchRow) som resten av
  // historiken och live-Slutspel.

  function renderHistorySchemaTab(root, hs) {
    const classes = archiveClassOptions(hs.matches);
    const list = h("div", { class: "history-schema-list" });
    function refresh() {
      let matches = hs.matches;
      if (hs.catFilter) matches = matches.filter((m) => m.catName === hs.catFilter);
      const q = hs.teamQuery.trim().toLowerCase();
      if (q) matches = matches.filter((m) =>
        m.home.name.toLowerCase().includes(q) || m.away.name.toLowerCase().includes(q));
      const groups = groupArchiveByDay(matches);
      if (!groups.length) {
        list.replaceChildren(h("p", { class: "muted" }, "Inga matcher matchar filtret."));
        return;
      }
      list.replaceChildren(...groups.flatMap((g) => [
        h("h2", { class: "day-h" }, fmtDayLong.format(new Date(g.items[0].start))),
        h("div", { class: "arena-quick-list" }, g.items.map(archiveMatchRow)),
      ]));
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); });
    const search = h("input", { type: "text", placeholder: "Sök lag …", value: hs.teamQuery });
    search.addEventListener("input", () => { hs.teamQuery = search.value; refresh(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel, withClearButton(search)), list);
    refresh();
  }

  function renderHistoryTablesTab(root, hs) {
    const classes = archiveClassOptions(hs.matches, "Conference");
    if (!classes.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Inga grupptabeller arkiverade för den här editionen."));
      return;
    }
    if (!classes.includes(hs.catFilter)) hs.catFilter = "";
    const content = h("div", { class: "history-tables-content" });
    function refresh() {
      const cats = hs.catFilter ? [hs.catFilter] : classes;
      const nodes = [];
      for (const cat of cats) {
        const tables = historicalGroupTables(hs.matches, cat);
        if (!tables.length) continue;
        nodes.push(h("h2", { class: "day-h" }, cat), ...tables.map(historicalTableBlock));
      }
      content.replaceChildren(...(nodes.length ? nodes : [h("p", { class: "muted" }, "Inga tabeller för valet.")]));
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel), content);
    refresh();
  }

  function renderHistoryPlayoffsTab(root, hs) {
    const classes = archiveClassOptions(hs.matches, "Playoff");
    if (!classes.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Inget slutspel arkiverat för den här editionen."));
      return;
    }
    if (!classes.includes(hs.catFilter)) hs.catFilter = "";
    const content = h("div", { class: "history-tables-content" });
    function refresh() {
      const cats = hs.catFilter ? [hs.catFilter] : classes;
      const nodes = [];
      const pending = [];
      for (const cat of cats) {
        const divs = historicalPlayoffDivisions(hs.matches, cat);
        if (!divs.length) continue;
        const boxes = divs.map((d) => bracketBlock(d, null, () => {}));
        nodes.push(h("h2", { class: "day-h" }, cat), h("div", { class: "bracket-row" }, boxes));
        divs.forEach((d, i) => pending.push({ el: boxes[i], div: d }));
      }
      content.replaceChildren(...(nodes.length ? nodes : [h("p", { class: "muted" }, "Inget slutspel för valet.")]));
      if (pending.length) {
        requestAnimationFrame(() => pending.forEach(({ el, div }) => drawBracketConnectors(el, div, 1)));
      }
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel), content);
    refresh();
  }

  function renderHistoryArenaTab(root, hs) {
    const arenas = [...new Set(hs.matches.map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv"));
    if (!arenas.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Ingen banainformation arkiverad."));
      return;
    }
    if (!arenas.includes(hs.arena)) hs.arena = arenas[0];
    const list = h("div", { class: "arena-quick-list" });
    function refresh() {
      const matches = hs.matches.filter((m) => m.arena === hs.arena)
        .slice().sort((a, b) => a.start - b.start);
      list.replaceChildren(...matches.map(archiveMatchRow));
    }
    const arenaSel = h("select", { class: "select", "aria-label": "Välj bana" },
      arenas.map((a) => h("option", { value: a, ...(a === hs.arena ? { selected: "" } : {}) }, a)));
    arenaSel.addEventListener("change", () => { hs.arena = arenaSel.value; refresh(); });
    root.replaceChildren(h("div", { class: "history-controls" }, arenaSel), list);
    refresh();
  }

  const HISTORY_TABS = [
    ["schema", "Schema", renderHistorySchemaTab],
    ["tabeller", "Tabeller", renderHistoryTablesTab],
    ["slutspel", "Slutspel", renderHistoryPlayoffsTab],
    ["bana", "Bana", renderHistoryArenaTab],
  ];

  function renderBrowseMode(root, idx, cupIds) {
    // hs = lokal, isolerad "state" för EN vald cup+edition — motsvarar
    // huvudappens state.matches/state.view men rör aldrig den riktiga
    // state, så bläddring i historik kan inte läcka in i eller störa
    // den vanliga live-cupen.
    const hs = {
      cupId: cupIds.includes(state.cupId) ? state.cupId : cupIds[0],
      edition: null, cupName: "", matches: [],
      view: "schema", catFilter: "", teamQuery: state.favoriteClub || "", arena: "",
    };

    function renderPicker() {
      const editions = idx[hs.cupId].editions.slice().sort((a, b) => b.edition.localeCompare(a.edition));
      const cupSel = h("select", { class: "select", "aria-label": "Välj cup" },
        cupIds.map((id) => h("option", { value: id, ...(id === hs.cupId ? { selected: "" } : {}) }, idx[id].cupName)));
      const edSel = h("select", { class: "select", "aria-label": "Välj år" },
        editions.map((e) => h("option", { value: e.edition }, e.edition + " (" + e.matches + " matcher)")));
      cupSel.addEventListener("change", () => { hs.cupId = cupSel.value; renderPicker(); });
      const browseBtn = h("button", {
        class: "btn primary", type: "button",
        onclick: async () => {
          const edition = edSel.value;
          root.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
          const data = await HB.api.fetchArchiveEdition(hs.cupId, edition);
          hs.edition = edition;
          hs.cupName = idx[hs.cupId].cupName;
          hs.matches = (data && data.matches) || [];
          hs.view = "schema"; hs.catFilter = ""; hs.arena = "";
          renderViewer();
        },
      }, "Bläddra i " + idx[hs.cupId].cupName + " " + edSel.value);
      // Etiketten ska följa vald årtal, inte alltid det nyaste — edSel.value
      // är ännu tomt vid skapandet (första <option> sätts av webbläsaren
      // efter att elementet är i DOM:et), så sätt om texten en gång direkt
      // efter att den faktiskt fått ett värde, och sen vid varje ändring.
      const updateBrowseLabel = () => {
        browseBtn.textContent = "Bläddra i " + idx[hs.cupId].cupName + " " + edSel.value;
      };
      edSel.addEventListener("change", updateBrowseLabel);
      root.replaceChildren(h("div", { class: "history-picker" },
        h("p", { class: "muted" }, "Välj cup och år för att bläddra precis som i den vanliga appen — " +
          "Schema, Tabeller, Slutspel och Bana, men för en tidigare upplaga."),
        h("div", { class: "history-controls" }, cupSel, edSel),
        browseBtn));
      updateBrowseLabel();
    }

    function renderViewer() {
      const tabBar = h("nav", { class: "history-tabs", role: "tablist", "aria-label": "Historikvy" },
        HISTORY_TABS.map(([v, label]) => h("button", {
          class: "tab" + (hs.view === v ? " on" : ""), role: "tab", type: "button",
          onclick: () => { hs.view = v; renderViewer(); },
        }, label)));
      const content = h("div", { class: "history-viewer-body" });
      root.replaceChildren(
        h("div", { class: "history-viewer-head" },
          h("button", { class: "chip", type: "button", onclick: renderPicker }, "← Byt cup/år"),
          h("span", { class: "cat" }, hs.cupName + " " + hs.edition),
          h("span", { class: "muted" }, hs.matches.length + " matcher")),
        tabBar, content);
      const tabFn = (HISTORY_TABS.find(([v]) => v === hs.view) || HISTORY_TABS[0])[2];
      tabFn(content, hs);
    }

    renderPicker();
  }

  async function openHistoryDialog() {
    const idx = await HB.api.fetchArchiveIndex();
    const cupIds = Object.keys(idx).filter((id) => (idx[id].editions || []).length)
      .sort((a, b) => idx[a].cupName.localeCompare(idx[b].cupName, "sv"));

    const dlg = h("dialog", { class: "match-dialog history-dialog" });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);

    if (!cupIds.length) {
      dlg.append(
        h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng", onclick: () => dlg.close() }, "×"),
        h("div", { class: "match-dialog-head" }, h("span", { class: "cat" }, "Historik")),
        h("p", { class: "muted" },
          "Ingen historik arkiverad än — byggs upp automatiskt allteftersom cuperna spelas."));
      dlg.showModal();
      return;
    }

    let mode = "compare"; // "compare" (jämför lag mellan år) | "browse" (bläddra i ett helt år)

    function renderShell() {
      dlg.replaceChildren(
        h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng", onclick: () => dlg.close() }, "×"),
        h("div", { class: "match-dialog-head history-head" },
          h("span", { class: "cat" }, "Historik"),
          h("div", { class: "seg", role: "group", "aria-label": "Historikläge" },
            chip("Jämför lag", mode === "compare", () => { mode = "compare"; renderShell(); }),
            chip("Bläddra i ett år", mode === "browse", () => { mode = "browse"; renderShell(); }))),
        h("div", { class: "history-mode-body" }));
      const modeBody = dlg.querySelector(".history-mode-body");
      if (mode === "compare") renderCompareMode(modeBody);
      else renderBrowseMode(modeBody, idx, cupIds);
      if (!dlg.open) dlg.showModal();
    }

    function renderCompareMode(root) {
      let selCup = cupIds.includes(state.cupId) ? state.cupId : cupIds[0];
      let query = state.favoriteClub || "";
      let classFilter = "";
      let sortKey = "tid_desc";
      let allTeamNames = [];
      let editionsData = []; // [{edition, matches}] för selCup — hämtas bara vid cupbyte

      const cupSel = h("select", { class: "select", "aria-label": "Välj cup" },
        ...cupIds.map((id) => h("option", { value: id }, idx[id].cupName)));
      cupSel.value = selCup;

      const teamInput = h("input", {
        type: "text", placeholder: "Lag/klubb, t.ex. Alingsås HK",
      });
      teamInput.value = query;
      const teamOptions = h("div", { class: "autocomplete-list" });
      teamOptions.hidden = true;
      // teamInput.value läses bara i "change"/Enter-lyssnarna nedan (inte
      // "input", för att inte söka om vid varje tangenttryckning) — ×-
      // knappen skickar bara ett "input"-event, så onClear måste själv
      // uppdatera query/renderFiltered i stället för att förlita sig på
      // de vanliga lyssnarna.
      const teamWrap = h("div", { class: "autocomplete-wrap" },
        withClearButton(teamInput, () => { query = ""; classFilter = ""; renderFiltered(); }),
        teamOptions);

      const classSel = h("select", { class: "select", "aria-label": "Klass" },
        h("option", { value: "" }, "Alla klasser"));
      const sortSel = h("select", { class: "select", "aria-label": "Sortering" },
        ARCHIVE_SORTS.map(([v, l]) => h("option",
          { value: v, ...(v === sortKey ? { selected: "" } : {}) }, l)));

      const body = h("div", { class: "history-body" });
      root.replaceChildren(
        h("div", { class: "history-controls" }, cupSel, teamWrap, classSel, sortSel),
        body);

      // Filtrerar/sorterar redan hämtad data — ingen ny nätverksfråga, så
      // klass-/sorteringsbyten känns direkta.
      function renderFiltered() {
        if (!query.trim()) {
          classSel.replaceChildren(h("option", { value: "" }, "Alla klasser"));
          classSel.disabled = true;
          body.replaceChildren(h("p", { class: "muted" },
            "Skriv ett lag- eller klubbnamn ovan för att se resultat år för år."));
          return;
        }
        classSel.disabled = false;
        const rowsByYear = editionsData.map((d) =>
          ({ edition: d.edition, rows: summarizeArchiveMatches(d.matches, query) }));

        const classes = new Set();
        rowsByYear.forEach((y) => y.rows.forEach((r) => { if (r.catName) classes.add(r.catName); }));
        const classList = [...classes].sort((a, b) => catSortKey(a) - catSortKey(b));
        if (!classList.includes(classFilter)) classFilter = "";
        classSel.replaceChildren(
          h("option", { value: "" }, "Alla klasser"),
          ...classList.map((c) => h("option",
            { value: c, ...(c === classFilter ? { selected: "" } : {}) }, HB.shortCat(c))));

        const summaries = rowsByYear.map((y) => {
          const filtered = classFilter ? y.rows.filter((r) => r.catName === classFilter) : y.rows;
          const sorted = sortArchiveRows(filtered, sortKey);
          return { edition: y.edition, rows: sorted, ...archiveStats(sorted) };
        }).filter((s) => s.rows.length);

        if (!summaries.length) {
          body.replaceChildren(h("p", { class: "muted" },
            'Inga matcher hittades för "' + query + '"' +
            (classFilter ? " i " + HB.shortCat(classFilter) : "") +
            " i " + idx[selCup].cupName + "."));
          return;
        }
        body.replaceChildren(...summaries.map((s, i) => {
          const children = [
            h("summary", null,
              h("span", { class: "history-year-label" }, s.edition),
              h("span", { class: "history-year-stats" },
                s.played + " sp · " + s.won + "V " + s.tied + "O " + s.lost +
                "F · mål " + s.gf + "–" + s.ga)),
            h("div", { class: "arena-quick-list" }, s.rows.map(archiveMatchRow)),
          ];
          // Slutspelsträd/tabeller kräver ALLA lag i klassen, inte bara den
          // sökta klubbens — bara meningsfullt (och görligt att bygga rimligt
          // brett) när man smalnat av till en enda klass.
          let redraw = null;
          if (classFilter) {
            const yearMatches = (editionsData.find((d) => d.edition === s.edition) || {}).matches || [];
            const extra = historicalExtras(yearMatches, classFilter);
            if (extra.nodes.length) children.push(h("div", { class: "history-extra" }, extra.nodes));
            redraw = extra.redraw;
          }
          const isOpen = i === 0;
          const detailsEl = h("details", { class: "history-year", open: isOpen ? "" : null }, children);
          if (redraw) {
            if (isOpen) requestAnimationFrame(redraw);
            // Stängda år ritas om (rätt mått) först när de faktiskt fälls ut.
            detailsEl.addEventListener("toggle", () => { if (detailsEl.open) redraw(); });
          }
          return detailsEl;
        }));
      }

      async function loadCupData() {
        body.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
        const editions = idx[selCup].editions.slice()
          .sort((a, b) => b.edition.localeCompare(a.edition));
        const loaded = await Promise.all(
          editions.map((e) => HB.api.fetchArchiveEdition(selCup, e.edition)));
        editionsData = editions.map((e, i) =>
          ({ edition: e.edition, matches: (loaded[i] && loaded[i].matches) || [] }));
        const names = new Set();
        editionsData.forEach((d) => d.matches.forEach((m) => {
          names.add(m.home.name); names.add(m.away.name);
        }));
        allTeamNames = [...names].sort((a, b) => a.localeCompare(b, "sv"));
        classFilter = "";
        renderFiltered();
      }

      attachAutocomplete(teamInput, teamOptions, () => allTeamNames, (name) => {
        query = name; classFilter = ""; renderFiltered();
      });
      teamInput.addEventListener("change", () => {
        query = teamInput.value; classFilter = ""; renderFiltered();
      });
      teamInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault(); query = teamInput.value; classFilter = ""; renderFiltered();
        }
      });
      cupSel.addEventListener("change", () => { selCup = cupSel.value; loadCupData(); });
      classSel.addEventListener("change", () => { classFilter = classSel.value; renderFiltered(); });
      sortSel.addEventListener("change", () => { sortKey = sortSel.value; renderFiltered(); });

      loadCupData();
    }

    renderShell();
  }

  function setupHistory() {
    $("#historyBtn").addEventListener("click", () => openHistoryDialog());
  }

  function openMatchDialog(m) {
    const sc = scoreText(m.res);
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      h("div", { class: "match-dialog-head" },
        h("span", { class: "cat" }, HB.shortCat(m.catName)),
        m.divName ? h("span", { class: "div" }, m.divName) : null,
        h("span", null,
          fmtDayLong.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))),
        m.arena ? h("span", null, m.arena) : null,
        sc ? h("span", { class: "match-dialog-score" }, sc) : null),
      teamStatBlock(m, m.home, "home"),
      teamStatBlock(m, m.away, "away"),
      previousMeetingsBlock(m));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // --- render: schema --------------------------------------------------------

  function matchCard(m) {
    const sc = scoreText(m.res);
    const live = isLive(m);
    // Väder bara meningsfullt för matcher som inte redan är spelade.
    const weather = (!m.res || !m.res.fin)
      ? HB.weather.at(HB.weather.cached(cup()), m.start) : null;
    const teamEl = (side, other) => {
      const color = teamColor(side.name);
      return h("div", {
        class: "team" + (isClubName(side.name) ? " us" : "") +
          (m.res && m.res.fin && m.res.winner &&
            ((m.res.winner === "home") === (side === m.home)) ? " won" : ""),
        // stopPropagation: klick på ett lagnamn ska öppna EN­ dast lagets
        // egen snabbvy, inte trigga hela kortets onclick (matchdialogen
        // med båda lagen) ovanpå.
        ...(side.id ? {
          role: "button", tabindex: "0",
          onclick: (e) => { e.stopPropagation(); openTeamQuickView(m, side); },
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault(); e.stopPropagation(); openTeamQuickView(m, side);
            }
          },
        } : {}),
      },
        color ? h("span", { class: "team-color-dot", style: "background:" + color }) : null,
        side.name || "–",
        isFavoriteTeamName(side.name) ? h("span", { class: "fav-team-star" }, "⭐") : null);
    };
    const tint = cardTintColor(m);
    return h("article", {
      class: "match" + (isClubMatch(m) ? " ours" : "") + (tint ? " tinted" : ""),
      style: tint ? ("--card-tint:" + tint) : null,
      role: "button", tabindex: "0",
      "aria-label": "Visa lagstatistik för " + m.home.name + " mot " + m.away.name,
      onclick: () => openMatchDialog(m),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchDialog(m); }
      },
    },
      h("div", { class: "match-head" },
        h("span", { class: "cat" }, HB.shortCat(m.catName)),
        // m.edition är bara satt för matcher som blandats in från ett
        // extra år (state.years, se allActiveMatches) — odefinierad för
        // innevarande live-upplaga, som därför inte får någon badge (den
        // gemensamma/underförstådda "vanliga" kortlayouten).
        m.edition ? h("span", { class: "match-year-badge" }, m.edition) : null,
        m.divName ? h("span", { class: "div" }, m.divName) : null,
        m.roundName && m.roundName !== m.divName
          ? h("span", { class: "div" }, m.roundName) : null,
        outcomeLetter(m)
          ? h("span", { class: "outcome-badge outcome-" + outcomeLetter(m).toLowerCase() },
              outcomeLetter(m)) : null,
        h("span", { class: "match-head-right" },
          weather ? h("span", { class: "weather", title: weather.temp + "°C" },
            weather.icon, weather.temp + "°") : null,
          m.arena ? h("span", {
            class: "arena arena-link", role: "button", tabindex: "0",
            title: "Visa alla matcher på " + m.arena,
            onclick: (e) => { e.stopPropagation(); openArenaQuickView(m.arena); },
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault(); e.stopPropagation(); openArenaQuickView(m.arena);
              }
            },
          }, m.arena) : h("span", { class: "arena" }, m.arena))),
      h("div", { class: "match-body" },
        h("div", { class: "teams" }, teamEl(m.home), teamEl(m.away)),
        h("div", {
          // Tiden visas redan en gång ovanför/till vänster (räls i tid-läge,
          // "when"-prefix i övriga sorteringar) — upprepa den inte på kortet.
          class: "score" + (live ? " live" : "") +
            (sc === "spelad" ? " played" : "") + (!sc && !live ? " pending" : ""),
        },
          live ? h("span", { class: "live-tag" }, h("span", { class: "live-dot" }), "LIVE") : null,
          sc || (live ? "" : "–"))));
  }

  function timeGroups(list, multiDay) {
    const groups = [];
    for (const m of list) {
      const key = multiDay
        ? dayKey(m.start) + " " + fmtTime.format(new Date(m.start))
        : fmtTime.format(new Date(m.start));
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, start: m.start, items: [m] });
    }
    return groups;
  }

  // Tidslinje (dagshuvuden, NU-linje, vätskepaus-indikator) — bruten ut ur
  // renderSchema() så den kan återanvändas rakt av för Bana-vyn (alltid
  // tidssorterad, oavsett state.sort som annars styr schemat).
  function renderTimeline(main, list) {
    // Dagshuvuden/veckodagsetiketter visas när listan faktiskt spänner
    // över mer än en kalenderdag — oavsett om det beror på att inget
    // dagfilter är satt eller att flera dagar valts samtidigt.
    const multiDay = new Set(list.map((m) => dayKey(m.start))).size > 1;
    const now = Date.now();
    const today = dayKey(now);
    let nowPlaced = false;
    let lastDay = "";
    let prevGroupStart = null; // för vätskepaus-indikatorn
    const wrap = h("div", { class: "timeline" });
    for (const g of timeGroups(list, multiDay)) {
      const gDay = dayKey(g.start);
      if (multiDay && gDay !== lastDay) {
        lastDay = gDay;
        nowPlaced = nowPlaced || gDay > today;
        wrap.append(h("h2", { class: "day-h" },
          fmtDayLong.format(new Date(g.start))));
        prevGroupStart = null; // ny dag: räkna inte paus över dagsgränsen
      }
      if (state.breakMinutes > 0 && prevGroupStart != null) {
        // Ledig tid = tid till nästa match minus föregåendes speltid,
        // inte bara mellanrummet mellan två starttider.
        const rawGapMin = Math.round((g.start - prevGroupStart) / 60000);
        const gapMin = rawGapMin - state.matchMinutes;
        if (gapMin >= state.breakMinutes) {
          wrap.append(h("div", { class: "break-line" },
            h("span", null,
              "🥤 " + gapMin + " min till nästa match — dags för mat/vätska")));
        }
      }
      prevGroupStart = g.start;
      if (!nowPlaced && gDay === today && g.start > now) {
        nowPlaced = true;
        wrap.append(h("div", { class: "nowline", id: "nowline" },
          h("span", null,
            "NU " + fmtTime.format(new Date(now)) +
            " · nästa match " + countdownText(g.start))));
      }
      wrap.append(h("div", { class: "slot" },
        h("div", { class: "rail" },
          fmtTime.format(new Date(g.start)),
          multiDay
            ? h("small", null, fmtDay.format(new Date(g.start))) : null),
        h("div", { class: "slot-matches" }, g.items.map(matchCard))));
    }
    main.append(wrap);
    // Nyast/kommande överst: bygg allt i den vanliga (äldst→nyast) ordningen
    // ovan helt oförändrat (dagshuvuden/NU-linje/vätskepaus räknas rätt då)
    // och vänd bara den FÄRDIGA DOM-ordningen på barnen efteråt — enklare
    // och säkrare än att skriva om hela den temporala logiken två gånger.
    if (state.timeOrder === "desc") {
      [...wrap.children].reverse().forEach((c) => wrap.appendChild(c));
    }
    // Flaggan sätts INNE i timeouten (inte här) och #nowline slås upp på
    // nytt då — under den första sidladdningen hinner flera
    // renderContent()-anrop rulla in i rad (laddningsläge → data → väder),
    // som var och en byter ut #content. Om flaggan sattes redan här och
    // just DEN HÄR renderingens nl-referens hann bli en losskopplad nod
    // innan timeouten körde, skulle scrollIntoView() tyst misslyckas och
    // aldrig försöka igen.
    if (!autoScrolledToNow && $("#nowline") &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTimeout(() => {
        if (autoScrolledToNow) return;
        const freshNl = $("#nowline");
        if (!freshNl) return;
        autoScrolledToNow = true;
        freshNl.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }

  function renderSchema(main) {
    renderHero(main);
    if (!hasFilterSelection()) {
      main.append(h("div", { class: "banner" },
        "Välj en eller flera klasser eller lag ovan (“Filter och sortering”) för att visa schemat."));
      return;
    }
    const list = sorted(filtered().filter(matchesViewFilter));
    if (!list.length) {
      if (state.scope === "club" && !scoped().length && state.matches.length) {
        main.append(h("div", { class: "banner" },
          h("p", null, state.favoriteClub + " verkar inte ha några matcher i " +
            cup().name + "."),
          h("button", {
            class: "btn", type: "button",
            onclick: () => { state.scope = "all"; saveUi(); render(); },
          }, "Visa hela cupen")));
      } else {
        main.append(h("div", { class: "banner" },
          "Inga matcher matchar filtren. Prova att rensa något filter."));
      }
      return;
    }

    if (state.sort === "tid") {
      const { visible, hiddenCount } = splitRecentPlayed(
        list, SCHEMA_RECENT_HOURS, state.schemaOlderRevealCount);
      const loadMoreBtn = loadMorePlayedButtons(hiddenCount, state.revealBatchSize,
        state.timeOrder === "desc" ? "↓" : "↑",
        () => { state.schemaOlderRevealCount += state.revealBatchSize; renderContent(); },
        () => { state.schemaOlderRevealCount = Infinity; renderContent(); });
      // Äldre matcher hamnar överst i asc-ordning (äldst→nyast) och underst
      // i desc-ordning (nyast/kommande överst) — knappen placeras därefter.
      if (loadMoreBtn && state.timeOrder === "asc") main.append(loadMoreBtn);
      renderTimeline(main, visible);
      if (loadMoreBtn && state.timeOrder === "desc") main.append(loadMoreBtn);
    } else {
      const outcomeLabels = ["Vunnet", "Oavgjort", "Förlorat", "Ospelat"];
      const keyOf = {
        klass: (m) => m.catName + (m.divName ? " · " + m.divName : ""),
        plan: (m) => m.arena || "Plan ej satt",
        resultat: (m) => outcomeLabels[outcomeRank(m)],
      }[state.sort] || (() => null); // "mal": ingen gruppering, bara löpande lista
      let lastKey; // undefined ≠ null: tvingar fram en första sektion
      const wrap = h("div", { class: "grouped" });
      let sect = null;
      for (const m of list) {
        const k = keyOf(m);
        if (k !== lastKey || !sect) {
          lastKey = k;
          sect = h("div", { class: "slot-matches" });
          // Samma Element.append()-fälla som ovan (stringifierar null till
          // "null") — hoppa över rubriken helt i stället för att skicka in
          // ett null-argument när "Sortera: mål" (ingen gruppering) är valt.
          if (k !== null) wrap.append(h("h2", { class: "day-h" }, k));
          wrap.append(sect);
        }
        const card = matchCard(m);
        card.prepend(h("div", { class: "when" },
          fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))));
        sect.append(card);
      }
      main.append(wrap);
    }
  }

  // Döljer gamla spelade matcher bakom en knapp, så en lång lista (ett fullt
  // schema) blir överskådlig — behåller alltid ALLA kommande/pågående
  // matcher plus spelade matcher från de senaste cutoffHours timmarna.
  // revealExtra öppnar upp DE NÄRMAST cutoff (dvs de senast spelade av de
  // gömda) — antingen ett fast antal i taget ("visa fler tidigare",
  // schemat) eller Infinity ("visa alla"). Bana/slutspelstabellen använder
  // i stället den antalsbaserade splitRecentPlayedByCount() nedan, se dess
  // kommentar för varför.

  // "Visa fler/alla tidigare"-knapparna kan lägga till matcher antingen
  // OVANFÖR eller NEDANFÖR där man redan tittar, beroende på
  // sorteringsordning (stigande/fallande) — att försöka bevara exakt
  // skärmposition (tidigare försök) blir därför inkonsekvent och svårt
  // att förutsäga, och kan dessutom krocka med renderTimeline()s egen
  // engångs-auto-scroll till NU-linjen. Enklare, tydligare regel:
  // - Schemat: scrolla till NU-linjen, som en tidslinje — några
  //   föregående matcher, aktuell, och kommande, enligt aktuellt filter.
  //   Samma idé som det vanliga förstagångs-scrollet, fast upprepad.
  // - Övriga vyer (Bana, slutspelstabellen): stanna högst upp i
  //   innehållet — förutsägbart oavsett åt vilket håll nytt innehåll
  //   landade.
  function preserveScrollOnExpand(rerenderFn) {
    autoScrolledToNow = true; // hindra renderTimeline() från att scrolla dit SJÄLV också
    rerenderFn();
    if (state.view === "schema") {
      const nl = $("#nowline");
      if (nl) { nl.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function splitRecentPlayed(list, cutoffHours, revealExtra) {
    const cutoff = Date.now() - cutoffHours * 3600000;
    const always = [];
    const older = []; // äldre spelade, i samma stigande tidsordning som list
    for (const m of list) {
      if (m.res && m.res.fin && m.start < cutoff) older.push(m);
      else always.push(m);
    }
    const revealed = revealExtra > 0 ? older.slice(Math.max(0, older.length - revealExtra)) : [];
    const hiddenCount = older.length - revealed.length;
    const visible = [...revealed, ...always].sort((a, b) => a.start - b.start);
    return { visible, hiddenCount };
  }

  function showAllPlayedButton(hiddenCount, cutoffHours, onClick) {
    if (!hiddenCount) return null;
    return h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onClick),
    }, "Visa " + hiddenCount + " äldre spelade matcher (senaste " +
      cutoffHours + " tim visas alltid)");
  }

  // Antalsbaserad variant av splitRecentPlayed() — för Bana och slutspels-
  // tabellen. Ett fast timfönster är opålitligt där: matchlängden varierar
  // för mycket mellan cuper (korta beachmatcher kontra långa 11-manna-
  // matcher) för att t.ex. "senaste 2 tim" ska ge samma antal synliga
  // matcher överallt. Visar i stället alltid de N SENAST SPELADE matcherna
  // (oavsett hur länge sedan de spelades) plus alla ännu ospelade — man
  // ser matchflödet (senaste resultatet + vad som är på gång) lika bra på
  // en kort som en lång cup. N styrs av inställningen state.recentMatchCount.
  function splitRecentPlayedByCount(list, recentCount, revealExtra) {
    const finished = [];
    const rest = [];
    for (const m of list) {
      if (m.res && m.res.fin) finished.push(m); else rest.push(m);
    }
    finished.sort((a, b) => a.start - b.start);
    const keep = revealExtra === Infinity ? finished.length : recentCount + revealExtra;
    const always = finished.slice(Math.max(0, finished.length - keep));
    const hiddenCount = finished.length - always.length;
    const visible = [...always, ...rest].sort((a, b) => a.start - b.start);
    return { visible, hiddenCount };
  }

  function showAllPlayedButtonCount(hiddenCount, recentCount, onClick) {
    if (!hiddenCount) return null;
    return h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onClick),
    }, "Visa " + hiddenCount + " äldre spelade matcher (senaste " +
      recentCount + " visas alltid)");
  }

  // Samma idé men laddar bara BATCH matcher i taget (klicka flera gånger
  // för att gå längre bakåt, eller "Visa alla" för att hoppa hela vägen)
  // — bättre för schemats ofta mycket längre historik än bana/slutspelets
  // "visa allt på en gång". batchSize styrs av inställningen
  // state.revealBatchSize (förval 4, valfritt tal).
  function loadMorePlayedButtons(hiddenCount, batchSize, arrow, onLoadMore, onLoadAll) {
    if (!hiddenCount) return null;
    const moreBtn = h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onLoadMore),
    }, arrow + " Visa " + Math.min(batchSize, hiddenCount) + " tidigare matcher (" +
      hiddenCount + " till)");
    const allBtn = hiddenCount > batchSize ? h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onLoadAll),
    }, "Visa alla (" + hiddenCount + ")") : null;
    return h("div", { class: "load-more-row" }, moreBtn, allBtn);
  }

  const SCHEMA_RECENT_HOURS = 1; // schemat: hur långt bakåt spelade matcher visas som standard

  // --- render: bana -----------------------------------------------------------

  // Egen flik för att snabbt välja en bana och se dess kommande/spelade
  // matcher — till skillnad från openArenaQuickView() (en tillfällig
  // dialog som inte rör filtret) är det här en riktig vy man kan stanna
  // kvar i. Lyder under EXAKT samma verktygsradsfilter (klubb/hela cupen,
  // dagar, klasser, egna lag, matchstatus, sök) som schema/tabeller/
  // slutspel via filtered() — hade tidigare en egen inline-kopia av bara
  // matchstatus-växlaren (dubblett av verktygsradens) och struntade helt
  // i klubbfiltret, vilket gjorde att fliken både såg och betedde sig
  // annorlunda än resten av appen.
  function renderArenaView(main) {
    const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
    if (!arenas.length) {
      main.append(h("div", { class: "banner" }, "Inga planer hittades för den här cupen."));
      return;
    }
    if (state.viewArena && !arenas.includes(state.viewArena)) state.viewArena = "";
    main.append(h("div", { class: "row" },
      h("select", {
        class: "select", "aria-label": "Välj bana",
        onchange: (e) => {
          state.viewArena = e.target.value; state.showAllPlayedArena = false;
          saveUi(); renderContent();
        },
      },
        h("option", { value: "" }, "Välj bana …"),
        arenas.map((a) => h("option",
          { value: a, ...(state.viewArena === a ? { selected: "" } : {}) }, a)))));

    if (!state.viewArena) {
      main.append(h("div", { class: "banner" }, "Välj en bana ovan för att se dess matcher."));
      return;
    }
    const list = filtered(state.viewArena);
    if (!list.length) {
      main.append(h("div", { class: "banner" },
        "Inga matcher matchar filtret på " + state.viewArena + "."));
      return;
    }
    const { visible, hiddenCount } = splitRecentPlayedByCount(
      list, state.recentMatchCount, state.showAllPlayedArena ? Infinity : 0);
    renderTimeline(main, visible);
    const btn = showAllPlayedButtonCount(hiddenCount, state.recentMatchCount, () => {
      state.showAllPlayedArena = true; renderContent();
    });
    if (btn) main.append(btn);
  }

  // --- render: tabeller -------------------------------------------------------

  function divisionsToShow() {
    // Grupper (divisioner) ur de filtrerade matcherna, med klubbens först.
    // Slutspelsdivisioner (divType "Playoff") hör hemma i Slutspel-fliken,
    // inte här — Division$table för dem är inte en meningsfull tabell.
    // m.divType saknas för gammal cachad data (fylls i vid nästa synk) och
    // för ProCup — då räknas matchen in som förr (odiskriminerat).
    const map = new Map();
    for (const m of scoped()) {
      if (state.cats.size && !state.cats.has(m.catId)) continue;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) continue;
      if (!matchesSearchQuery(m)) continue;
      if (!matchesViewFilter(m)) continue;
      if (!m.divId) continue;
      if (m.divType === "Playoff") continue;
      if (!map.has(m.divId)) {
        map.set(m.divId, {
          // edition: null för innevarande (live) upplaga, annars årtalet —
          // avgör i renderTables()/ensureTable() om tabellen ska hämtas
          // live från Cup Manager eller räknas fram lokalt ur redan
          // inladdade arkivmatcher (samma divId-rymd krockar aldrig
          // mellan upplagor, se allActiveMatches()).
          id: m.divId, name: m.divName, catId: m.catId, catName: m.catName,
          edition: m.edition || null, ours: false,
        });
      }
      const d = map.get(m.divId);
      if (isClubMatch(m)) d.ours = true;
    }
    let divs = [...map.values()];
    if (state.scope === "club") divs = divs.filter((d) => d.ours);
    divs.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
      a.catName.localeCompare(b.catName, "sv") ||
      (b.edition || "").localeCompare(a.edition || "") ||
      a.name.localeCompare(b.name, "sv", { numeric: true }));
    return divs;
  }

  let tableQueue = Promise.resolve();

  function ensureTable(divId, edition) {
    if (state.tables[divId]) return;
    if (edition) {
      // Arkiverat år: all data redan hämtad (state.yearMatches), ingen
      // fetch — cupens egen slutgiltiga tabell arkiveras inte (bara
      // matcherna), så räkna fram den lokalt precis som Historik gör
      // (computeGroupTableRows, delad med historicalGroupTables).
      const divMatches = allActiveMatches().filter((m) => m.divId === divId);
      state.tables[divId] = { status: "done", rows: computeGroupTableRows(divMatches) };
      return;
    }
    state.tables[divId] = { status: "loading", rows: [] };
    const complete = allMatchesFinished(state.matches.filter((m) => m.divId === divId));
    tableQueue = tableQueue.then(async () => {
      try {
        const rows = await HB.api.fetchTable(cup(), divId, complete);
        state.tables[divId] = { status: "done", rows };
      } catch {
        state.tables[divId] = { status: "error", rows: [] };
      }
      if (state.view === "tabeller") renderContent();
    });
  }

  function renderTables(main) {
    if (!hasFilterSelection()) {
      main.append(h("div", { class: "banner" },
        "Välj en eller flera klasser eller lag ovan för att visa tabeller."));
      return;
    }
    const divs = divisionsToShow();
    if (!divs.length) {
      main.append(h("div", { class: "banner" }, "Inga grupper att visa."));
      return;
    }
    let lastGroupKey = null;
    let groupEl = null;
    for (const d of divs) {
      ensureTable(d.id, d.edition);
      // Gruppnyckeln inkluderar årtal — annars skulle två olika års
      // klasser med IDENTISKT namn (typ vuxenklasser utan födelseår i
      // namnet) råka slås ihop under samma rubrik när flera år är aktiva.
      const groupKey = d.catName + "|" + (d.edition || "");
      if (groupKey !== lastGroupKey) {
        lastGroupKey = groupKey;
        const heading = d.catName + (state.years.size ? " · " + (d.edition || cup().edition) : "");
        main.append(h("h2", { class: "day-h" }, heading));
        groupEl = h("div", { class: "table-group" });
        main.append(groupEl);
      }
      const t = state.tables[d.id];
      const box = h("section", { class: "table-box" },
        h("h3", null, d.name || "Grupp"));
      if (!t || t.status === "loading") {
        box.append(h("p", { class: "muted" }, "Hämtar tabell …"));
      } else if (t.status === "error") {
        box.append(h("p", { class: "muted" }, "Ingen tabell för den här gruppen."));
      } else if (!t.rows.length) {
        box.append(h("p", { class: "muted" }, "Tabellen är tom ännu."));
      } else {
        box.append(h("table", { class: "standings" },
          h("thead", null, h("tr", null,
            ["#", "Lag", "S", "V", "O", "F", "+/-", "P"].map((c, i) =>
              h("th", { class: i < 2 ? "l" : "" }, c)))),
          h("tbody", null, t.rows.map((r, i) =>
            h("tr", { class: isClubName(r.name) ? "us" : "" },
              h("td", null, String(i + 1)),
              h("td", { class: "l" },
                r.teamId != null
                  ? h("button", {
                      class: "team-link", type: "button",
                      title: "Visa " + r.name + "s matcher",
                      onclick: () => gotoTeamMatches({ id: r.teamId }, "all"),
                    }, r.name)
                  : r.name),
              h("td", null, String(r.played)),
              h("td", null, String(r.won)),
              h("td", null, String(r.tied)),
              h("td", null, String(r.lost)),
              h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
              h("td", { class: "pts" }, String(r.points)))))));
      }
      groupEl.append(box);
    }
  }

  // --- render: slutspel --------------------------------------------------------

  function categoriesToShow() {
    // Kategorier ur de filtrerade matcherna, med klubbens först — samma
    // urvalslogik som divisionsToShow(), fast per kategori (en kategori kan
    // ha flera slutspelsträd: A-/B-/C-Slutspel).
    const map = new Map();
    for (const m of scoped()) {
      if (state.cats.size && !state.cats.has(m.catId)) continue;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) continue;
      if (!matchesSearchQuery(m)) continue;
      if (!matchesViewFilter(m)) continue;
      if (!m.catId) continue;
      if (!map.has(m.catId)) {
        // edition: se motsvarande kommentar i divisionsToShow().
        map.set(m.catId, { catId: m.catId, catName: m.catName, edition: m.edition || null, ours: false });
      }
      if (isClubMatch(m)) map.get(m.catId).ours = true;
    }
    let cats = [...map.values()];
    if (state.scope === "club") cats = cats.filter((c) => c.ours);
    cats.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
      a.catName.localeCompare(b.catName, "sv") ||
      (b.edition || "").localeCompare(a.edition || ""));
    return cats;
  }

  let playoffQueue = Promise.resolve();

  function ensurePlayoffs(catId, edition) {
    if (state.playoffs[catId]) return;
    if (edition) {
      // Arkiverat år: matcherna är redan hämtade (state.yearMatches) och
      // bär redan roundRank/matchRank/nextWinnerId/nextLoserId — samma
      // fält HB.api.fetchPlayoffs() ger live — så trädet kan byggas lokalt
      // utan ny fetch, med samma gruppering (groupPlayoffDivisionsById)
      // som Historik-modalen använder.
      const catMatches = allActiveMatches()
        .filter((m) => m.catId === catId && m.divType === "Playoff");
      state.playoffs[catId] = { status: "done", divisions: groupPlayoffDivisionsById(catMatches) };
      return;
    }
    state.playoffs[catId] = { status: "loading", divisions: [] };
    const complete = allMatchesFinished(
      state.matches.filter((m) => m.catId === catId && m.divType === "Playoff"));
    playoffQueue = playoffQueue.then(async () => {
      try {
        const divisions = await HB.api.fetchPlayoffs(cup(), catId, complete);
        state.playoffs[catId] = { status: "done", divisions };
      } catch {
        state.playoffs[catId] = { status: "error", divisions: [] };
      }
      if (state.view === "slutspel") renderContent();
    });
  }

  // --- slutspelsprognos: fyller i platshållarplatser ("N:an i Grupp M",
  // "Bästa N:an", "Vinn. X") med nuvarande tabellplacering, och förutspår
  // vinnare av ospelade möten (bäst placerade laget — poäng, sen
  // målskillnad, sen gjorda mål — antas gå vidare). Rör aldrig
  // originaldatan i state.playoffs; bygger en separat projektionskarta som
  // bracketMatchBox/bracketTableBlock läser om inställningen är på.
  //
  // OBS: siffran i "Vinn. 18072137" är INTE samma id-rymd som Match.id —
  // det är en Cup Manager-intern etikett vi inte kan slå upp direkt
  // (verifierat: en semifinals "Vinn. 18072137" refererar till en
  // kvartsfinal vars riktiga id är 82143330). Vi använder i stället
  // matchens EGNA nextWinnerId-fält (redan i datan) för att koppla ihop
  // matcher framåt i trädet, positionerat via matchRank när en match har
  // två olösta sidor (t.ex. finalen).

  const PLACEHOLDER_WINNER_OF = /^vinn/i;
  const PLACEHOLDER_NTH_BEST_OF_RANK = /^(\d+)\s*:\s*\w+\s+b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
  const PLACEHOLDER_BEST_OF_RANK = /^b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
  const PLACEHOLDER_RANK_IN_GROUP = /^(\d+)\s*:\s*\w+\s+i\s+grupp\s+(\d+)$/i;

  let groupTablesQueue = Promise.resolve();

  function ensureGroupTables(catId) {
    if (state.groupTables[catId]) return;
    state.groupTables[catId] = { status: "loading" };
    const complete = allMatchesFinished(
      state.matches.filter((m) => m.catId === catId && m.divType !== "Playoff"));
    groupTablesQueue = groupTablesQueue.then(async () => {
      try {
        const groups = await HB.api.fetchGroupDivisions(cup(), catId, complete);
        const byGroupNum = {};
        const teamStrength = {};
        await Promise.all(groups.map(async (g) => {
          const gm = /grupp\s*(\d+)/i.exec(g.name || "");
          if (!gm) return;
          const rows = await HB.api.fetchTable(cup(), g.id, complete);
          byGroupNum[+gm[1]] = rows;
          for (const r of rows) {
            if (r.teamId) teamStrength[r.teamId] = { points: r.points, gf: r.gf, ga: r.ga, name: r.name };
          }
        }));
        state.groupTables[catId] = { status: "done", byGroupNum, teamStrength };
      } catch {
        state.groupTables[catId] = { status: "error" };
      }
      if (state.view === "slutspel") renderContent();
    });
  }

  // En grupp räknas som klar (dess tabellplats INTE längre kan ändras) när
  // alla lag spelat lika många matcher som en fulltalig serie kräver
  // (grupp­storlek − 1, dvs alla mot alla en gång) — den vanliga
  // gruppspelsformen i de här cuperna. Styr om ett gruppbaserat
  // platshållarlag ("N:an i Grupp M") ska visas som en SÄKER deltagare
  // (normal stil) eller en osäker prognos (kursiv), se buildPlayoffProjection.
  function isGroupComplete(rows) {
    return rows.length > 0 && rows.every((r) => r.played === rows.length - 1);
  }

  // Wildcard-poolen för en given tabellposition (t.ex. alla 5:or, en per
  // grupp) — sorterad efter samma kriterier som en vanlig tabell, så
  // "Bästa 5:an"/"2:a bästa 5:an" kan plockas ur rätt position. Cachad per
  // anrop av buildPlayoffProjection (wcCache), inte globalt.
  function wildcardPool(byGroupNum, rank, wcCache) {
    if (wcCache.has(rank)) return wcCache.get(rank);
    const pool = Object.values(byGroupNum)
      .map((rows) => ({ row: rows[rank - 1], groupComplete: isGroupComplete(rows) }))
      .filter((e) => e.row)
      .sort((a, b) => b.row.points - a.row.points ||
        (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga) || b.row.gf - a.row.gf);
    wcCache.set(rank, pool);
    return pool;
  }

  // Löser upp ETT gruppbaserat platshållarnamn ("N:an i Grupp M"/"Bästa
  // N:an") mot aktuell tabellplacering. Returnerar null om strängen inte
  // känns igen — antingen redan ett riktigt lagnamn, eller en "Vinn. X"-
  // platshållare (hanteras separat i buildPlayoffProjection via
  // nextWinnerId, se kommentaren ovanför regexarna). `certain` är true bara
  // om HELA gruppen (för N:an i Grupp M) eller ALLA bidragande grupper (för
  // wildcards) redan är färdigspelade — annars kan ordningen fortfarande
  // ändras och laget är en gissning, inte ett säkert faktum.
  function resolvePlaceholderTeam(name, gd, wcCache) {
    const s = (name || "").trim();
    let m;
    if ((m = PLACEHOLDER_NTH_BEST_OF_RANK.exec(s))) {
      const pool = wildcardPool(gd.byGroupNum, +m[2], wcCache);
      const e = pool[+m[1] - 1];
      return e ? { teamId: e.row.teamId, name: e.row.name, points: e.row.points,
        gf: e.row.gf, ga: e.row.ga, certain: pool.every((x) => x.groupComplete) } : null;
    }
    if ((m = PLACEHOLDER_BEST_OF_RANK.exec(s))) {
      const pool = wildcardPool(gd.byGroupNum, +m[1], wcCache);
      const e = pool[0];
      return e ? { teamId: e.row.teamId, name: e.row.name, points: e.row.points,
        gf: e.row.gf, ga: e.row.ga, certain: pool.every((x) => x.groupComplete) } : null;
    }
    if ((m = PLACEHOLDER_RANK_IN_GROUP.exec(s))) {
      const rows = gd.byGroupNum[+m[2]] || [];
      const row = rows[+m[1] - 1];
      return row ? { teamId: row.teamId, name: row.name, points: row.points, gf: row.gf, ga: row.ga,
        certain: isGroupComplete(rows) } : null;
    }
    return null;
  }

  // Bäst placerade laget (poäng, sen målskillnad, sen gjorda mål) — en
  // enkel, öppet deklarerad "formen håller i sig"-prognos, inte en
  // matchspecifik gissning.
  function betterTeam(a, b) {
    if (a.points !== b.points) return a.points > b.points ? a : b;
    const ad = a.gf - a.ga, bd = b.gf - b.ga;
    if (ad !== bd) return ad > bd ? a : b;
    return a.gf >= b.gf ? a : b;
  }

  // Bygger en prognoskarta (matchId -> {home, away, winnerSide}) för EN
  // slutspelsdivision. Går igenom omgångarna tidigast→senast (samma
  // ordning som groupPlayoffRounds ger) och matar vinnare framåt via
  // nextWinnerId — så en "Vinn. X"-platshållare i en senare omgång alltid
  // redan har sin matarmatch upplöst när den behövs. Redan spelade matcher
  // projiceras inte (deras VERKLIGA vinnare används rakt av som grund för
  // senare omgångar) — bara ospelade matcher hamnar i kartan.
  function buildPlayoffProjection(div, gd) {
    const wcCache = new Map();
    // targetMatchId -> [{matchRank, winner}], i ankomstordning (tidigast
    // omgång först); sorteras på matchRank innan den konsumeras nedan så
    // matcher med TVÅ olösta sidor (t.ex. finalen) får en stabil
    // hemma/borta-tilldelning.
    const feederQueue = new Map();
    const proj = new Map();
    for (const [, ms] of groupPlayoffRounds(div)) {
      for (const m of ms) {
        const feeders = (feederQueue.get(m.id) || []).sort((a, b) => a.matchRank - b.matchRank);
        let feederIdx = 0;
        // `certain`: false = laget självt är en gissning (kursiv i UI:t);
        // true = laget är ett säkert faktum (redan bestämt), även om
        // MATCHEN de ska spela inte är avgjord än. En "Vinn. X"-sida ärver
        // matchcertainty från matarmatchen (f.certain) — INTE lagets egen
        // certain-flagga — eftersom vem som vinner alltid är en gissning
        // tills den matchen faktiskt är spelad.
        const resolveSide = (side) => {
          const r = resolvePlaceholderTeam(side.name, gd, wcCache);
          if (r) return r;
          if (PLACEHOLDER_WINNER_OF.test((side.name || "").trim())) {
            const f = feeders[feederIdx++];
            return f ? { ...f.winner, certain: f.certain } : null;
          }
          if (side.id == null || !side.name) return null;
          const strength = gd.teamStrength[side.id];
          return {
            teamId: side.id, name: side.name,
            points: strength ? strength.points : -1,
            gf: strength ? strength.gf : 0, ga: strength ? strength.ga : 0,
            certain: true,
          };
        };
        const home = resolveSide(m.home);
        const away = resolveSide(m.away);
        let winner = null;
        const realResult = !!(m.res && m.res.fin);
        if (realResult) {
          winner = m.res.winner === "home"
            ? (home || { teamId: m.home.id, name: m.home.name, points: -1, gf: 0, ga: 0, certain: true })
            : (away || { teamId: m.away.id, name: m.away.name, points: -1, gf: 0, ga: 0, certain: true });
        } else if (home && away) {
          winner = betterTeam(home, away);
          proj.set(m.id, { home, away, winnerSide: winner === home ? "home" : "away" });
        }
        if (winner && m.nextWinnerId != null) {
          if (!feederQueue.has(m.nextWinnerId)) feederQueue.set(m.nextWinnerId, []);
          feederQueue.get(m.nextWinnerId).push({ matchRank: m.matchRank, winner, certain: realResult });
        }
      }
    }
    return proj;
  }

  // projMap: matchId -> {home, away, winnerSide} från buildPlayoffProjection()
  // — ospelade matcher som kunnat lösas upp visar ett prognosticerat lagnamn
  // (tydligt markerat, class "predicted") i stället för det råa
  // platshållarnamnet ("N:an i Grupp M" osv).
  // onClick: valfri override — historikens brackettrad matar in matcher
  // som inte finns i state.matches (fel år), så gotoMatch(m) skulle inte
  // hitta något att hoppa till där.
  function bracketMatchBox(m, projMap, onClick) {
    const sc = scoreText(m.res);
    const handleClick = onClick || (() => gotoMatch(m));
    const proj = projMap ? projMap.get(m.id) : null;
    const teamRow = (side, isHome) => {
      const projSide = proj ? (isHome ? proj.home : proj.away) : null;
      const name = projSide ? projSide.name : (side.name || "TBD");
      const won = proj
        ? proj.winnerSide === (isHome ? "home" : "away")
        : (m.res && m.res.fin && m.res.winner &&
            ((m.res.winner === "home") === isHome));
      // Kursiv "predicted"-stil bara om LAGET SJÄLVT är en gissning (t.ex.
      // en grupp som fortfarande spelas) — inte bara för att MATCHEN de ska
      // mötas i är ospelad. Ett redan säkert lag (grupp klar, eller vann en
      // riktigt spelad tidigare omgång) visas normalt även i en prognosmatch.
      const uncertain = projSide && projSide.certain === false;
      return h("div", {
        class: "bracket-team" + (isClubName(name) ? " us" : "") +
          (won ? " won" : "") + (uncertain ? " predicted" : ""),
      }, name);
    };
    return h("div", {
      class: "bracket-match" + (isClubMatch(m) ? " ours" : "") + (proj ? " predicted-match" : ""),
      "data-match-id": String(m.id),
      role: "button", tabindex: "0",
      title: onClick ? undefined : "Visa i schemat",
      "aria-label": "Visa " + (m.home.name || "TBD") + " mot " + (m.away.name || "TBD") +
        (onClick ? "" : " i schemat"),
      onclick: handleClick,
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); }
      },
    },
      h("div", { class: "bracket-teams" }, teamRow(m.home, true), teamRow(m.away, false)),
      h("div", { class: "bracket-score" }, proj ? "Prognos" : (sc || "–")),
      h("div", { class: "bracket-meta" },
        (m.matchNr ? "Match " + m.matchNr + " · " : "") +
        fmtTime.format(new Date(m.start)) + (m.arena ? " · " + m.arena : "")));
  }

  function groupPlayoffRounds(div) {
    const byRound = new Map();
    for (const m of div.matches) {
      if (!byRound.has(m.roundRank)) byRound.set(m.roundRank, []);
      byRound.get(m.roundRank).push(m);
    }
    // Högre rank = tidigare omgång; sorterat så finalen (rank 0) hamnar sist/till höger.
    const rounds = [...byRound.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, ms] of rounds) ms.sort((a, b) => a.matchRank - b.matchRank);
    return rounds;
  }

  // Ritar linjer mellan en match och matchen dess vinnare går vidare till
  // (m.nextWinnerId) — en SVG-overlay i stället för en ren CSS-lösning,
  // eftersom nextWinnerId ger den FAKTISKA kopplingen (byes/ojämna
  // trädformer gör att man inte kan anta att match 0+1 i en omgång alltid
  // matar match 0 i nästa). Måste köras EFTER att .bracket-box:en är
  // inklistrad i det levande DOM-trädet, annars ger getBoundingClientRect()
  // meningslösa mått — anropas via requestAnimationFrame från renderPlayoffs.
  // Mjukt rundade hörn i stället för raka 90°-vinklar — samma tre-segments-
  // elbow som förut (rakt ut, rakt över, rakt in) men med en liten kurva i
  // svängarna, som i välgjorda bracket-visualiseringar. Om käll- och
  // målmatchen råkar ligga i exakt samma höjd blir det bara en rak linje.
  function roundedElbowPath(x1, y1, midX, y2, x2, r) {
    if (Math.abs(y2 - y1) < 1) return "M" + x1 + "," + y1 + " L" + x2 + "," + y2;
    const dir = y2 > y1 ? 1 : -1;
    const rr = Math.max(0, Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX)));
    return [
      "M" + x1 + "," + y1,
      "L" + (midX - rr) + "," + y1,
      "Q" + midX + "," + y1 + " " + midX + "," + (y1 + rr * dir),
      "L" + midX + "," + (y2 - rr * dir),
      "Q" + midX + "," + y2 + " " + (midX + rr) + "," + y2,
      "L" + x2 + "," + y2,
    ].join(" ");
  }

  // zoomOverride: historikens brackettrad har ingen egen zoomreglering
  // (renderas alltid utan CSS zoom) och ska inte påverkas av vad
  // användaren råkar ha ställt in på live-Slutspel-fliken.
  function drawBracketConnectors(boxEl, div, zoomOverride) {
    const bracketEl = boxEl.querySelector(".bracket");
    if (!bracketEl) return;
    const old = bracketEl.querySelector(".bracket-connectors");
    if (old) old.remove();
    // SVG:n hamnar SJÄLV inuti .bracket-row (samma element som får CSS
    // zoom:X) — webbläsaren skalar alltså SVG:ns egen box en gång TILL när
    // den renderas, utöver den zoomning som redan syns i
    // getBoundingClientRect(). Sätter man koordinater direkt i redan-
    // zoomade skärmpixlar dubbel-skalas allt (stämmer bara vid 100 %,
    // driftar isär i takt med zoomnivån) — dela bort zoom-faktorn för
    // path-koordinaterna nedan så de är i samma "ozoomade" enheter som
    // webbläsaren själv multiplicerar med zoom vid rendering.
    //
    // Bredd/höjd på SVG:n är ett SEPARAT problem: .bracket-box har
    // overflow-x:auto (för att kunna scrolla breda träd i sidled i stället
    // för att svälla hela sidan) — .bracket:s getBoundingClientRect()
    // ger då bara den SYNLIGA (ev. scrollade) bredden, inte trädets
    // fulla innehållsyta. Sätter man SVG:ns viewBox till den synliga
    // bredden klipper SVG:n själv bort alla linjer som ligger bortom vad
    // som råkar synas just nu (upptäckt 2026-07-19: linjerna "försvann"
    // efter första omgången). scrollWidth/scrollHeight ger den fulla
    // innehållsytan OCH är redan i lokala (ozoomade) enheter — behöver
    // alltså inte delas med zoom, till skillnad från positionsmåtten.
    const zoom = zoomOverride != null ? zoomOverride : (state.bracketZoom || 1);
    const raw = bracketEl.getBoundingClientRect();
    const base = {
      left: raw.left, top: raw.top,
      width: bracketEl.scrollWidth, height: bracketEl.scrollHeight,
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bracket-connectors");
    svg.setAttribute("width", String(base.width));
    svg.setAttribute("height", String(base.height));
    svg.setAttribute("viewBox", "0 0 " + base.width + " " + base.height);
    for (const m of div.matches) {
      if (m.nextWinnerId == null) continue;
      const src = bracketEl.querySelector('[data-match-id="' + m.id + '"]');
      const dst = bracketEl.querySelector('[data-match-id="' + m.nextWinnerId + '"]');
      if (!src || !dst) continue;
      const sr = src.getBoundingClientRect(), dr = dst.getBoundingClientRect();
      const x1 = (sr.right - base.left) / zoom, y1 = (sr.top + sr.height / 2 - base.top) / zoom;
      const x2 = (dr.left - base.left) / zoom, y2 = (dr.top + dr.height / 2 - base.top) / zoom;
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "bracket-connector-line" + (isClubMatch(m) ? " ours" : ""));
      path.setAttribute("d", roundedElbowPath(x1, y1, midX, y2, x2, 10));
      svg.appendChild(path);
    }
    bracketEl.prepend(svg);
  }

  function bracketBlock(div, projMap, matchOnClick) {
    return h("section", { class: "bracket-box" },
      h("h3", null, div.name),
      h("div", { class: "bracket" },
        groupPlayoffRounds(div).map(([, ms]) =>
          h("div", { class: "bracket-round" },
            h("div", { class: "bracket-round-label" }, ms[0].roundName || ""),
            ms.map((m) => bracketMatchBox(m, projMap, matchOnClick))))));
  }

  // Sortering av den avancerade slutspelstabellen — delad mellan alla
  // synliga A-/B-/C-tabeller (session, sparas ej). null = trädets naturliga
  // omgångsordning (tidigast→final); annars {col, dir}.
  let bracketSort = null;

  const BRACKET_SORT_COLS = {
    // roundRank: lägre = senare omgång (finalen = 0) — se groupPlayoffRounds().
    // Stigande sortering på detta ger alltså finalen överst, samma ordning
    // som det naturliga (ej klickade) läget nedan.
    omgang: (m) => m.roundRank * 1000 + (m.matchRank || 0),
    nr: (m) => m.matchNr || "",
    lag: (m) => (m.home.name || "").toLowerCase(),
    resultat: (m) => (m.res && m.res.fin && !m.res.wo) ? (m.res.hg || 0) + (m.res.ag || 0) : -1,
    tid: (m) => m.start,
    bana: (m) => m.arena || "",
  };

  function sortBracketRows(rows) {
    if (!bracketSort) return rows;
    const key = BRACKET_SORT_COLS[bracketSort.col];
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const ka = key(a), kb = key(b);
      const cmp = typeof ka === "string" ? ka.localeCompare(kb, "sv", { numeric: true }) : ka - kb;
      return bracketSort.dir * cmp;
    });
  }

  // "Avancerad tabell": samma slutspelsmatcher som bracketBlock, men som en
  // radbaserad tabell med tid/plan — mer detaljer och lättare att scrolla
  // på smala skärmar än trädets sidledes kolumner. Kolumnrubrikerna är
  // klickbara och sorterar (klick igen växlar riktning). "Omgång" är
  // förvalt (utan att en egen sortering behöver klickas fram) i samma
  // ordning som trädet fast omvänd — finalen överst.
  function bracketTableBlock(div, projMap) {
    const allRows = groupPlayoffRounds(div).flatMap(([, ms]) => ms);
    const { visible: splitRows, hiddenCount } = splitRecentPlayedByCount(
      allRows, state.recentMatchCount, state.showAllPlayedBracket ? Infinity : 0);
    // splitRecentPlayedByCount sorterar alltid kronologiskt stigande internt
    // (för att avgöra äldst/nyast) — den egentliga sorteringen (bracketSort,
    // eller naturlig omgångsordning) måste därför läggas på EFTER, annars
    // skrivs den över och kolumnklick/riktningsbyten ser ut att inte ha
    // någon effekt.
    const rows = bracketSort ? sortBracketRows(splitRows) : [...splitRows].reverse();
    const headerCell = (label, col, wide) => {
      const active = bracketSort ? bracketSort.col === col : col === "omgang";
      return h("th", {
        class: (wide ? "l " : "") + "bracket-th-sort" + (active ? " on" : ""),
        role: "button", tabindex: "0",
        onclick: () => {
          if (bracketSort && bracketSort.col === col) { bracketSort.dir *= -1; }
          else { bracketSort = { col, dir: 1 }; }
          renderContent();
        },
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); }
        },
      }, label, active ? h("span", { class: "sort-arrow" }, bracketSort ? (bracketSort.dir > 0 ? " ▲" : " ▼") : "") : null);
    };
    return h("section", { class: "table-box" },
      h("h3", null, div.name),
      h("table", { class: "standings bracket-table" },
        h("thead", null, h("tr", null,
          headerCell("Omgång", "omgang", true),
          headerCell("Nr", "nr"),
          headerCell("Lag", "lag", true),
          headerCell("Resultat", "resultat"),
          headerCell("Tid", "tid"),
          headerCell("Bana", "bana"))),
        h("tbody", null, rows.map((m) => {
          const sc = scoreText(m.res);
          const proj = projMap ? projMap.get(m.id) : null;
          const homeName = proj ? proj.home.name : (m.home.name || "TBD");
          const awayName = proj ? proj.away.name : (m.away.name || "TBD");
          return h("tr", {
            class: "bracket-table-row" + (isClubMatch(m) ? " us" : "") + (proj ? " predicted-match" : ""),
            role: "button", tabindex: "0",
            onclick: () => gotoMatch(m),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gotoMatch(m); }
            },
          },
            h("td", { class: "l" }, m.roundName || ""),
            h("td", null, m.matchNr || "–"),
            h("td", { class: "l" },
              h("span", {
                class: (isClubName(homeName) ? "us " : "") +
                  (proj && proj.home.certain === false ? "predicted" : ""),
              }, homeName),
              " – ",
              h("span", {
                class: (isClubName(awayName) ? "us " : "") +
                  (proj && proj.away.certain === false ? "predicted" : ""),
              }, awayName)),
            h("td", { class: "pts" }, proj ? "Prognos" : (sc || "–")),
            h("td", null, fmtTime.format(new Date(m.start))),
            h("td", null, m.arena || ""));
        }))),
      showAllPlayedButtonCount(hiddenCount, state.recentMatchCount, () => {
        state.showAllPlayedBracket = true; renderContent();
      }));
  }

  function renderPlayoffs(main) {
    if (!hasFilterSelection()) {
      main.append(h("div", { class: "banner" },
        "Välj en eller flera klasser eller lag ovan för att visa slutspel."));
      return;
    }
    const cats = categoriesToShow();
    if (!cats.length) {
      main.append(h("div", { class: "banner" }, "Inga klasser att visa."));
      return;
    }

    // Flera klasser filtrerade fram samtidigt (t.ex. både pojkar och
    // flickor) visades tidigare staplade under varandra — en klassväljare
    // (dropdown, eftersom antalet klasser kan bli stort — till skillnad
    // från A-/B-/C-fliken som alltid är max tre) gör i stället att bara EN
    // klass byggs/visas åt gången, precis som divisionsvalet nedan.
    let selCat = cats[0];
    if (cats.length > 1) {
      selCat = cats.find((c) => c.catId === state.playoffCatTab) || cats[0];
    }

    // Klass-etiketten får ett årtal på slutet så fort mer än innevarande
    // år är inblandat (state.years) — annars kan t.ex. "Damer Elit" 2024
    // och 2025 se ut som samma alternativ i listan.
    const catLabel = (c) => c.catName + (state.years.size ? " · " + (c.edition || cup().edition) : "");
    if (cats.length > 1) {
      main.append(h("div", { class: "row" },
        h("select", {
          class: "select", "aria-label": "Välj klass",
          onchange: (e) => { state.playoffCatTab = +e.target.value; renderContent(); },
        }, cats.map((c) => h("option", {
          value: String(c.catId), ...(c.catId === selCat.catId ? { selected: "" } : {}),
        }, catLabel(c))))));
    }
    let any = false, anyLoading = false;
    const pendingConnectors = []; // {el, div} — träden vars kopplingslinjer ska ritas efter insättning
    const c = selCat;
    ensurePlayoffs(c.catId, c.edition);
    const p = state.playoffs[c.catId];
    if (!p || p.status === "loading") {
      anyLoading = true;
      main.append(h("h2", { class: "day-h" }, catLabel(c)),
        h("p", { class: "muted" }, "Hämtar slutspel …"));
    } else if (p.status === "error" || !p.divisions.length) {
      // inget slutspel ännu — hoppa tyst
    } else {
      any = true;
      main.append(h("h2", { class: "day-h" }, catLabel(c)));

      // Flera slutspelsträd i samma klass (A-/B-/C-Slutspel) visas som
      // flikar i stället för alla staplade ovanpå varandra — bara den
      // valda divisionen byggs (kopplingslinjer, ev. prognos), så växling
      // mellan A/B/C kostar inget förrän man faktiskt klickar dit.
      let selDiv = p.divisions[0];
      const divTabs = p.divisions.length > 1
        ? (() => {
            const curId = state.playoffDivTab[c.catId];
            selDiv = p.divisions.find((d) => d.id === curId) || p.divisions[0];
            return h("div", { class: "seg playoff-div-tabs", role: "tablist", "aria-label": "Slutspelsträd" },
              p.divisions.map((d) => chip(d.name, d.id === selDiv.id, () => {
                state.playoffDivTab[c.catId] = d.id; renderContent();
              })));
          })()
        : null;

      // Träd/Tabell-växlaren och zoomen (samma state.advancedPlayoffTable
      // som inställningens kryssruta, så de två alltid är i synk) delar rad
      // med A-/B-/C-Slutspel-flikarna i stället för att ligga på en egen
      // rad ovanför — en tunn vertikal avdelare (.row-sep, bara när det
      // faktiskt finns flikar att skilja från) visar att de hör till en
      // annan kategori, utan att pressas hela vägen till högerkanten.
      main.append(h("div", { class: "row playoff-tabs-row" }, divTabs, divTabs ? h("span", { class: "row-sep" }) : null,
        h("div", { class: "seg-group" },
          h("div", { class: "seg", role: "group", "aria-label": "Slutspelsvy" },
            chip("Träd", !state.advancedPlayoffTable, () => {
              state.advancedPlayoffTable = false; saveSettings(); renderContent();
            }),
            chip("Tabell", state.advancedPlayoffTable, () => {
              state.advancedPlayoffTable = true; saveSettings(); renderContent();
            })),
          // Zoom är bara meningsfull i trädvyn — tabellen radbryter/scrollar
          // redan naturligt och behöver ingen skalning.
          !state.advancedPlayoffTable ? h("div", { class: "seg bracket-zoom", role: "group", "aria-label": "Zoom" },
            h("button", {
              class: "chip", type: "button", "aria-label": "Zooma ut",
              disabled: state.bracketZoom <= 0.6 ? "" : null,
              onclick: () => { state.bracketZoom = Math.max(0.6, +(state.bracketZoom - 0.2).toFixed(2)); renderContent(); },
            }, "−"),
            h("button", {
              class: "chip", type: "button", title: "Återställ zoom",
              onclick: () => { state.bracketZoom = 1; renderContent(); },
            }, Math.round(state.bracketZoom * 100) + "%"),
            h("button", {
              class: "chip", type: "button", "aria-label": "Zooma in",
              disabled: state.bracketZoom >= 3 ? "" : null,
              onclick: () => { state.bracketZoom = Math.min(3, +(state.bracketZoom + 0.2).toFixed(2)); renderContent(); },
            }, "+")) : null)));

      // Prognosen bygger på ANNU OSPELADE mötens sannolika utgång — inget
      // ett arkiverat (avslutat) år har, och ensureGroupTables() skulle
      // ändå fråga live-API:t om en kategori som inte finns i innevarande
      // tournamentId. Bara meningsfull/möjlig för innevarande upplaga.
      let gd = null;
      if (state.showPlayoffProjection && !c.edition) {
        ensureGroupTables(c.catId);
        const gt = state.groupTables[c.catId];
        if (gt && gt.status === "done") gd = gt;
      }
      const projMap = gd ? buildPlayoffProjection(selDiv, gd) : null;
      if (state.showPlayoffProjection && !c.edition && state.groupTables[c.catId] &&
          state.groupTables[c.catId].status === "loading") {
        main.append(h("p", { class: "muted" }, "Hämtar tabeller för prognosen …"));
      }
      if (state.advancedPlayoffTable) {
        main.append(bracketTableBlock(selDiv, projMap));
      } else {
        const box = bracketBlock(selDiv, projMap);
        main.append(h("div", { class: "bracket-row", style: "zoom:" + state.bracketZoom }, [box]));
        pendingConnectors.push({ el: box, div: selDiv });
      }
    }
    if (!any && !anyLoading) {
      main.append(h("div", { class: "banner" },
        "Inget slutspel publicerat för de valda klasserna ännu."));
    }
    if (pendingConnectors.length) {
      // Måste vänta tills boxarna faktiskt sitter i det levande DOM-trädet
      // (main.append ovan) innan getBoundingClientRect() ger meningsfulla
      // mått — requestAnimationFrame räcker, kräver ingen extra timeout.
      requestAnimationFrame(() => {
        pendingConnectors.forEach(({ el, div }) => drawBracketConnectors(el, div));
      });
    }
  }

  // Greppa-och-dra-panorering i slutspelsträdet: .bracket-box scrollar redan
  // vågrätt (overflow-x:auto) och sidan lodrätt som vanligt, men bara via
  // scrollbar/hjul/touch. En delegerad pointerdown/move/up (satt upp en gång,
  // inte per rendering) ger samma "greppa kartan"-känsla. Bara musen — touch
  // har redan sin egen naturliga scroll/pinch, och att kapa pointermove där
  // skulle bara krocka med den.
  function setupBracketPan() {
    let box = null, dragging = false, moved = false;
    let startX = 0, startY = 0, startScrollLeft = 0, startScrollY = 0;
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const b = e.target.closest(".bracket-box");
      if (!b) return;
      box = b; dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      startScrollLeft = box.scrollLeft; startScrollY = window.scrollY;
    });
    document.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        box.classList.add("panning");
        document.documentElement.classList.add("bracket-panning");
      }
      box.scrollLeft = startScrollLeft - dx;
      window.scrollTo(window.scrollX, startScrollY - dy);
      e.preventDefault();
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove("bracket-panning");
      if (box) {
        box.classList.remove("panning");
        if (moved) {
          // Sväljer klicket efter en drag så matchkortet under muspekaren
          // inte öppnas som om man klickat det.
          const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
          box.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => box.removeEventListener("click", swallow, { capture: true }), 0);
        }
      }
      box = null;
    }
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
  }

  // --- lägg till cup ----------------------------------------------------------

  function setupAddCup() {
    const dlg = $("#addCupDialog");
    $("#addCupBtn").addEventListener("click", () => {
      renderCustomCupList();
      dlg.showModal();
    });
    $("#addCupForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const host = f.host.value.trim()
        .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const cupDef = {
        id: "custom-" + Date.now(),
        name: f.cupname.value.trim(),
        place: f.place.value.trim() || "–",
        edition: f.edition.value.trim() || "",
        host,
        tournamentId: +f.tid.value.trim(),
        custom: true,
      };
      if (!cupDef.name || !cupDef.host || !cupDef.tournamentId) return;
      const list = HB.customCups();
      list.push(cupDef);
      localStorage.setItem("hb:customCups", JSON.stringify(list));
      f.reset();
      dlg.close();
      switchCup(cupDef.id);
    });
    $("#addCupClose").addEventListener("click", () => dlg.close());
  }

  // Egen, webbläsaroberoende autocomplete — native <datalist> stöds inte
  // tillförlitligt för textfält på Safari/iOS (visar ofta inga förslag
  // alls), så inställningarnas fält bygger sin egen minimala dropdown.
  // getCandidates: () => string[], anropas vid varje input för att alltid
  // spegla den cup som råkar vara laddad just då.
  function attachAutocomplete(input, list, getCandidates, onPick) {
    const hide = () => { list.hidden = true; list.replaceChildren(); };
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { hide(); return; }
      const matches = getCandidates()
        .filter((c) => c.toLowerCase().includes(q))
        .slice(0, 8);
      if (!matches.length) { hide(); return; }
      list.hidden = false;
      list.replaceChildren(...matches.map((m) =>
        h("div", {
          class: "autocomplete-item",
          // mousedown (inte click) så den hinner före inputs "blur"-döljning
          onmousedown: (e) => { e.preventDefault(); input.value = m; hide(); onPick(m); },
        }, m)));
    });
    input.addEventListener("blur", () => setTimeout(hide, 150));
  }

  function setupSettings() {
    const dlg = $("#settingsDialog");

    const clubInput = $("#favoriteClubInput");
    clubInput.value = state.favoriteClub;
    const applyFavoriteClub = () => {
      const v = clubInput.value.trim();
      state.favoriteClub = v || HB.CLUB.name;
      clubInput.value = state.favoriteClub;
      saveSettings();
      render();
    };
    clubInput.addEventListener("change", applyFavoriteClub);
    attachAutocomplete($("#favoriteClubInput"), $("#favoriteClubOptions"),
      clubPrefixCandidates, applyFavoriteClub);
    $("#favoriteClubClear").addEventListener("click", () => {
      clubInput.value = ""; applyFavoriteClub(); clubInput.focus();
    });

    const teamInput = $("#favoriteTeamInput");
    teamInput.value = state.favoriteTeam;
    const applyFavoriteTeam = () => {
      state.favoriteTeam = teamInput.value.trim();
      saveSettings();
      renderContent();
    };
    teamInput.addEventListener("change", applyFavoriteTeam);
    attachAutocomplete($("#favoriteTeamInput"), $("#favoriteTeamOptions"),
      () => [...new Set(clubTeams().map((t) => t.name))], applyFavoriteTeam);
    $("#favoriteTeamClear").addEventListener("click", () => {
      teamInput.value = ""; applyFavoriteTeam(); teamInput.focus();
    });

    const themeBtns = $$("#themeSeg [data-theme-opt]");
    const syncThemeBtns = () => {
      themeBtns.forEach((b) =>
        b.classList.toggle("on", b.dataset.themeOpt === state.theme));
    };
    syncThemeBtns();
    themeBtns.forEach((b) => b.addEventListener("click", () => {
      state.theme = b.dataset.themeOpt;
      saveSettings();
      syncThemeBtns();
    }));

    const colorsBox = $("#teamColorsToggle");
    colorsBox.checked = state.teamColors;
    colorsBox.addEventListener("change", () => {
      state.teamColors = colorsBox.checked;
      saveSettings();
      render();
    });

    const fullCardBox = $("#fullCardColorsToggle");
    fullCardBox.checked = state.fullCardColors;
    fullCardBox.addEventListener("change", () => {
      state.fullCardColors = fullCardBox.checked;
      saveSettings();
      render();
    });

    const advTableBox = $("#advancedPlayoffTableToggle");
    advTableBox.checked = state.advancedPlayoffTable;
    advTableBox.addEventListener("change", () => {
      state.advancedPlayoffTable = advTableBox.checked;
      saveSettings();
      renderContent();
    });

    const projBox = $("#playoffProjectionToggle");
    projBox.checked = state.showPlayoffProjection;
    projBox.addEventListener("change", () => {
      state.showPlayoffProjection = projBox.checked;
      saveSettings();
      renderContent();
    });

    // Egna lagfärger: fritextnamn (slugifierat, cup-oberoende) → hexfärg.
    const renderTeamColorList = () => {
      const box = $("#teamColorList");
      const entries = Object.entries(state.teamColorOverrides);
      box.replaceChildren(...entries.map(([slug, color]) =>
        h("div", { class: "team-color-item" },
          h("span", { class: "team-color-swatch", style: "background:" + color }),
          h("span", { class: "name" }, slug),
          h("button", {
            class: "btn small", type: "button",
            onclick: () => {
              delete state.teamColorOverrides[slug];
              saveSettings(); renderTeamColorList(); render();
            },
          }, "Ta bort"))));
    };
    renderTeamColorList();
    const teamColorNameInput = $("#teamColorNameInput");
    attachAutocomplete(teamColorNameInput, $("#teamColorOptions"), () =>
      [...new Set(state.matches.flatMap((m) =>
        [m.home.name, m.away.name].filter(Boolean)))].sort((a, b) => a.localeCompare(b, "sv")),
      () => {});
    $("#teamColorNameClear").addEventListener("click", () => {
      teamColorNameInput.value = "";
      teamColorNameInput.dispatchEvent(new Event("input", { bubbles: true }));
      teamColorNameInput.focus();
    });
    $("#teamColorAddBtn").addEventListener("click", () => {
      const nameInp = $("#teamColorNameInput");
      const colorInp = $("#teamColorPickerInput");
      const name = nameInp.value.trim();
      if (!name) return;
      state.teamColorOverrides[slugifySv(name)] = colorInp.value;
      nameInp.value = "";
      saveSettings();
      renderTeamColorList();
      render();
    });

    const matchMinInput = $("#matchMinutesInput");
    matchMinInput.value = state.matchMinutes;
    matchMinInput.addEventListener("change", () => {
      state.matchMinutes = Math.max(5, +matchMinInput.value || 30);
      matchMinInput.value = state.matchMinutes;
      saveSettings();
      renderContent();
    });

    const breakInput = $("#breakMinutesInput");
    breakInput.value = state.breakMinutes || "";
    breakInput.addEventListener("change", () => {
      state.breakMinutes = Math.max(0, +breakInput.value || 0);
      breakInput.value = state.breakMinutes || "";
      saveSettings();
      renderContent();
    });

    const revealBatchInput = $("#revealBatchInput");
    revealBatchInput.value = state.revealBatchSize;
    revealBatchInput.addEventListener("change", () => {
      state.revealBatchSize = Math.max(1, +revealBatchInput.value || 4);
      revealBatchInput.value = state.revealBatchSize;
      saveSettings();
      renderContent();
    });

    const recentMatchCountInput = $("#recentMatchCountInput");
    recentMatchCountInput.value = state.recentMatchCount;
    recentMatchCountInput.addEventListener("change", () => {
      state.recentMatchCount = Math.max(1, +recentMatchCountInput.value || 2);
      recentMatchCountInput.value = state.recentMatchCount;
      saveSettings();
      renderContent();
    });

    // advancedPlayoffTable kan numera ändras utanför dialogen (snabbväxlingen
    // i slutspelsvyn) — synka kryssrutan mot state igen varje gång dialogen
    // öppnas, annars kan den visa fel läge efter en sådan ändring.
    const openSettings = () => {
      advTableBox.checked = state.advancedPlayoffTable;
      dlg.showModal();
    };
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#currentCupBtn").addEventListener("click", openSettings);
    $("#settingsClose").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  function renderCustomCupList() {
    const box = $("#customCupList");
    const list = HB.customCups();
    box.replaceChildren(...list.map((c) =>
      h("div", { class: "custom-cup" },
        h("span", null, c.name + " (" + c.host + ")"),
        h("button", {
          class: "btn small", type: "button",
          onclick: () => {
            localStorage.setItem("hb:customCups",
              JSON.stringify(HB.customCups().filter((x) => x.id !== c.id)));
            if (state.cupId === c.id) state.cupId = HB.CUPS[0].id;
            renderCustomCupList(); renderCups();
          },
        }, "Ta bort"))));
  }

  // --- uppstart ------------------------------------------------------------------

  async function init() {
    // PWA: relativ sökväg (inte "/sw.js") så det funkar under en undermapp,
    // t.ex. GitHub Pages-projektsidor (callesjoberg.github.io/hboll/).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    // Scrolla-till-toppen: syns när man scrollat mer än en skärmhöjd.
    const scrollTopBtn = $("#scrollTopBtn");
    document.addEventListener("scroll", () => {
      scrollTopBtn.classList.toggle("visible", window.scrollY > window.innerHeight);
    }, { passive: true });
    scrollTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto" : "smooth",
      });
    });

    // Skarp cuplista från data/cups.json (redigeras via admin.html);
    // HB.CUPS i config.js är reserv om filen saknas eller är trasig.
    try {
      const r = await fetch("data/cups.json?_=" + Date.now().toString(36));
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.cups) && j.cups.length) HB.CUPS = j.cups;
      }
    } catch { /* kör på reservlistan */ }

    // Djuplänk: ?cup=potatis&view=...&scope=...&days=...&cats=...&teams=...
    // &arena=...&sort=...&mf=...&q=... — hela filtret/sorteringen kan delas.
    const params = new URLSearchParams(location.search);
    const urlCup = params.get("cup");
    if (urlCup && HB.allCups().some((c) => c.id === urlCup)) {
      state.cupId = urlCup;
    }
    // Cup Manager-id:n är numeriska, ProCup-id:n är textsträngar (lagnamn) —
    // bevara rätt typ så Set.has()-jämförelser mot matchdatan funkar.
    const toId = (s) => (/^\d+$/.test(s) ? +s : s);
    const hasUrlFilters = ["view", "scope", "days", "cats", "teams", "arena",
      "viewArena", "sort", "order", "mf", "q"].some((k) => params.has(k));
    $$("#viewTabs .tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view; saveUi(); render();
      }));
    $("#refreshBtn").addEventListener("click", () => loadCup(true));
    setupAddCup();
    setupSettings();
    setupHistory();
    setupBracketPan();

    // Stäng en öppen lag-dropdown vid klick utanför den. En enda global
    // lyssnare (i stället för en per renderToolbar-anrop) hittar alltid
    // den dropdown som råkar vara monterad just nu.
    document.addEventListener("click", (e) => {
      const dd = document.querySelector(".team-picker-dd[open]");
      if (dd && !dd.contains(e.target)) dd.open = false;
    });
    loadUi();
    updateClubLogo();
    if (hasUrlFilters) {
      // En delad länk vinner över det som råkar ligga sparat i webbläsaren.
      if (params.get("view")) state.view = params.get("view");
      if (params.get("scope")) state.scope = params.get("scope");
      if (params.get("days")) state.days = new Set(params.get("days").split(","));
      if (params.get("cats")) state.cats = new Set(params.get("cats").split(",").map(toId));
      if (params.get("teams")) state.teams = new Set(params.get("teams").split(",").map(toId));
      if (params.get("years")) state.years = new Set(params.get("years").split(","));
      if (params.get("curYear") === "0") state.includeCurrentYear = false;
      if (params.get("arena")) state.arena = params.get("arena");
      if (params.get("viewArena")) state.viewArena = params.get("viewArena");
      if (params.get("sort")) state.sort = params.get("sort");
      if (params.get("order") === "desc") state.timeOrder = "desc";
      if (["all", "upcoming", "played"].includes(params.get("mf"))) {
        state.matchFilter = params.get("mf");
      }
      if (params.get("q")) state.q = params.get("q");
      saveUi(); // spara den delade vyn som din egen, och normalisera URL:en
    }
    loadCup();

    // Auto-uppdatera var tredje minut — men bara cuper som faktiskt pågår.
    const isLiveCup = () => refreshTtl(state.matches) <= 180000;
    setInterval(() => {
      if (document.visibilityState === "visible" && isLiveCup() &&
          Date.now() - state.loadedAt > 170000) loadCup(true);
    }, 180000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isLiveCup() &&
          Date.now() - state.loadedAt > 300000) loadCup(true);
    });
    // Nedräkningen i heron tickar utan full omrendering — för det kort
    // (heroIndex) som just nu visas i karusellen, inte alltid det första.
    setInterval(() => {
      const el = $(".hero-count");
      const matches = nextClubMatches();
      const m = matches[heroIndex] || matches[0];
      if (el && m) el.textContent = countdownText(m.start);
    }, 30000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
