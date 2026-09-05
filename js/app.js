/* app.js — vy, filter och rendering för cupschemat. */

import {
  fmtDayLong, fmtClock, hasScheduledStart, matchTimeLabel, dayKey,
} from "./time.js";
import {
  cohortKey, cohortLabel, shortCat, catSortKey,
} from "./domain/category.js";
import {
  slugifySv, clubPatternFromName, isClubName as nameMatchesClub,
  detectTeamColor, isFavoriteTeam as favoriteTeamMatches, favoriteTeamKey,
  favoriteTeamIndex as favoriteTeamIndexOf,
} from "./domain/club.js";
import {
  isLive, scoreText, totalGoals,
  referenceSide as matchReferenceSide, hasReference as matchHasReference,
  outcomeLetter as matchOutcomeLetter, outcomeRank as matchOutcomeRank,
} from "./domain/match.js";
import { computeGroupTableRows as tableRowsForGroup } from "./domain/tables.js";
import { pickDefaultCup as pickDefaultCupId } from "./domain/cup.js";
import { clubBadgeDataUri } from "./domain/club-badge.js";
import { isPlaceholderTeam } from "./domain/placeholder.js";
import {
  allClubNamesFromMatches, clubCountryFromMatches, teamsAndClassesFromMatches,
} from "./domain/club-match.js";
import {
  calendarSubscribeUrl as teamCalendarUrl, calendarWebcalUrl as toWebcalUrl,
} from "./domain/calendar.js";
import { refreshTtl, allMatchesFinished } from "./domain/refresh.js";
import { guessMatchMinutes } from "./domain/match-length.js";
import { liveGapMatches, resultChanged } from "./domain/live-gap.js";
import {
  groupPlayoffRounds, playoffGroupReference,
} from "./domain/playoff.js";
import {
  matchesSearchQuery as matchMatchesQuery,
  matchPassesFilters, hasFilterSelection as selectionIsActive,
  hasLockableSelection as lockableIsActive, isFilterLocked as filterLockIsOn,
} from "./filters.js";
import {
  encodeMainViewParams, decodeMainViewParams,
  splitNameList as splitNamedList, hasUrlViewParams,
  encodeSubViewParams, decodeSubViewParams, defaultSubViewSnap,
  resolveNamedUrlFilters,
} from "./url-state.js";
import { $, $$, h } from "./dom.js";
import { chrome } from "./ui/chrome.js";
import { attachAutocomplete, chip, withClearButton } from "./ui/controls.js";
import {
  initToolbar, renderToolbar, buildPicker,
} from "./ui/toolbar.js";
import {
  initSheets, sheetMode, enforceMobileMenuHost, toggleFilterSheet,
  toggleFiltersExpanded, reconcilePickerChrome,
  setupViewportOffset, setupPickerSheets,
  prototypeDialog, syncBottomStack, flattenMobileFilterBar,
  restoreFilterStripScroll, setupFilterStripScrollMemory,
  portaledPickerPanels,
} from "./ui/sheets.js";
import {
  initNav, activeFilterCount, closeSubmenuOverlays,
  scrollTopRevealY, revealSelectedSubmenuItem, setupResponsiveMenuLayout,
  renderBottomBar, setupMenuAutoCollapse, placeFooterLinks,
} from "./ui/nav.js";
import { initShare, buildExportPicker, openHeaderExportDialog } from "./ui/share.js";
import {
  initMatchUi, resetMatchUi, tickHeroCountdown, renderHero,
  openMatchDialog, openTeamQuickView, openArenaQuickView, openMatchLogDialog,
  closeMatchDialog, countdownText, uppdateraKortTäthet,
} from "./ui/match-ui.js";
import { initReveal } from "./ui/reveal.js";
import {
  initSchema, resetSchemaUi, captureSchemaSearchFocus,
  renderSchema, renderArenaView, destroyArenaMap,
  ensureCupArenaGeo, setSchemaAutoScrolled,
} from "./ui/schema.js";
import {
  initPlayoffs, clearPlayoffCandidateTimers, renderTables, renderPlayoffs,
  setupBracketPan, divisionsToShow, categoriesToShow, ensurePlayoffs,
  ensureGroupTables, playoffPlacementForTeam, svOrdinal,
  getBracketSort, setBracketSort,
} from "./ui/playoffs.js";
import { ensureMapLibre } from "./ui/maplibre.js";
import {
  initMap, destroyMapIfLeavingKarta, ensureCupClubGeo,
  ensureClubDirectory, getClubDirectory,
} from "./ui/map.js";
import {
  initStats, renderStatsView, getStatsTabs,
  getStatsUrlFields, applyStatsUrlFields, resetStatsUrlFields, ensureTeamIndex,
} from "./ui/stats.js";

window.HB = window.HB || {};
HB.shortCat = shortCat;

(function () {

  function teamSuffix(name) {
    const stripped = name.replace(HB.CLUB.pattern, "").trim();
    return stripped || name;
  }

  function isClubName(name) {
    return nameMatchesClub(name, HB.CLUB.pattern);
  }

  function calendarSubscribeUrl(team) {
    return teamCalendarUrl(team, cup(), isClubName(team.name));
  }

  function calendarWebcalUrl(team) {
    return toWebcalUrl(calendarSubscribeUrl(team), location.href);
  }

  function isFavoriteTeam(name, catName) {
    return favoriteTeamMatches(name, catName, state.favoriteTeams);
  }

  function favoriteTeamIndex(name, cohort) {
    return favoriteTeamIndexOf(name, cohort, state.favoriteTeams);
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

  // Lokalt klubbmärkesbibliotek, byggt av scripts/collect_club_logos.mjs.
  // Nycklarna använder samma normalisering som lag-/favoritmatchningen.
  // Biblioteket hämtas en gång och den genererade initialbadgen ligger kvar
  // som omedelbar och säker fallback när ett märke saknas.
  let clubLogoLibrary = {};

  function localClubLogo(name) {
    const entry = clubLogoLibrary[slugifySv(name)];
    return entry && entry.file ? entry.file : null;
  }

  async function loadClubLogoLibrary() {
    try {
      const response = await fetch("data/club-logos.json", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      clubLogoLibrary = data && data.logos && typeof data.logos === "object"
        ? data.logos : {};
      updateClubLogo();
    } catch { /* initialbadgen är en fullgod offline-fallback */ }
  }

  // Har besökaren FAKTISKT valt klubb? state.favoriteClub är alltid ifylld
  // (default HB.CLUB.name), så den kan inte användas som signal. En annan
  // förenings märke i headern gör att cuparrangörer och andra klubbar inte
  // vågar länka hit till sina föräldrar — det ser ut som en konkurrents
  // verktyg. Nyckeln hb:favoriteClub betyder "har valt", men saveSettings
  // skriver den även vid temabyte; därför läser vi EN gång vid start och
  // sätter flaggan bara när klubben faktiskt väljs (fältet i Inställningar
  // eller stjärnknappen i en lagruta).
  let hasChosenClub = false;
  try { hasChosenClub = localStorage.getItem("hb:favoriteClub") != null; }
  catch { /* privat läge / blockerad lagring: behandla som ej valt */ }

  function markClubChosen() {
    hasChosenClub = true;
  }

  // Bytt ut mot en genererad badge så fort favoritklubben skiljer sig från
  // sajtens förvalda (Alingsås HK, med sin riktiga logga) — annars ingen
  // logga att visa för en godtycklig klubb. Uppdaterar både sidhuvudets
  // <img> och webbläsarflikens favicon.
  //
  // Webbläsarflikens favicon behåller appmärket tills klubben aktivt valts,
  // men headerns kontextrad visar alltid den klubb som står i inställningen.
  const APP_FAVICON = "assets/icon-192.png";

  function updateClubLogo() {
    const name = (state.favoriteClub || HB.CLUB.name).trim();
    const isDefaultClub = name.toLowerCase() === HB.CLUB.name.toLowerCase();
    const localLogo = localClubLogo(name);
    const src = localLogo || (isDefaultClub ? HB.CLUB.logo : clubBadgeDataUri(name));
    const img = $("#clubLogo");
    const sub = $("#clubName");
    const favicon = $("#faviconLink");
    // Headern är nu appens kontextrad, inte ett klubbvarumärke. Där ska
    // värdet i Favoritklubb alltid synas — även när det är det förifyllda
    // standardvärdet och den äldre hasChosenClub-flaggan ännu är falsk.
    if (sub) { sub.textContent = name; sub.title = name; }
    if (img) { img.hidden = false; img.src = src; img.alt = isDefaultClub ? "" : name; }
    if (favicon) {
      favicon.href = hasChosenClub ? src : APP_FAVICON;
      favicon.type = hasChosenClub && (/\.svg(?:$|\?)/i.test(src) ||
        src.startsWith("data:image/svg+xml"))
        ? "image/svg+xml" : "image/png";
    }
  }

  // --- resultatvisning ----------------------------------------------------

  function outcomeSpec() {
    return {
      selectedTeamId: state.teams.size === 1 ? [...state.teams][0] : null,
      isClubName,
    };
  }

  function referenceSide(m) { return matchReferenceSide(m, outcomeSpec()); }
  function hasReference(m) { return matchHasReference(m, outcomeSpec()); }
  function outcomeLetter(m) { return matchOutcomeLetter(m, outcomeSpec()); }
  function outcomeRank(m) { return matchOutcomeRank(m, outcomeSpec()); }

  // --- state ---------------------------------------------------------------

  // Förra besökets cupval. Bor i localStorage, som är knutet till origin —
  // en ny domän (eller en ny webbläsare) ger alltså tomt blad. Saknas det
  // väljer init() den cup som ligger närmast i tiden i stället, se
  // pickDefaultCup; raden nedan är bara ett värde att stå på tills dess.
  function storageGet(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch {
      // Safari privat läge och blockerad lagring får aldrig hindra appstart.
      return fallback;
    }
  }

  function storageNumber(key, fallback, min, max) {
    const value = Number(storageGet(key, fallback));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  }

  const savedCupId = storageGet("hb:cup");

  const state = {
    cupId: savedCupId || (HB.allCups()[0] || {}).id,
    view: "schema",          // schema | tabeller
    // Vilken underflik som visas under "Stats" (se STATS_TABS/renderStatsView)
    // — trend | karta | klubb | klubbjamforelse | cuper. Sparas som en del av
    // saveUi() precis som view, så en omladdning behåller vald underflik.
    statsView: "trend",
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
    toolbarOpen: false,      // avancerade filter expanderade? (session, sparas ej)
    heroMinimized: false,    // nästa match-karusellen minimerad? (session, sparas ej)
    bracketZoom: 1,          // zoomnivå för slutspelsträdet (session, sparas ej)
    playoffDivTab: {},       // catId -> vald slutspelsdivision (A-/B-/C-Slutspel) när en klass har flera (session, sparas ej)
    playoffCatTab: null,     // vald klass i Slutspel-vyn när fler än en klass är filtrerad fram (session, sparas ej)
    tableGroupKey: "all",   // aktiv tabellklass-flik; "all" visar alla valda tabeller
    schemaSelectionKey: "all", // aktiv klass/lag-flik i Schema; "all" = kombinerad vy
    tableSortKey: "points", // tabeller: rank | name | points
    tableSortOrder: "desc", // stigande/fallande inom valt tabellfält
    playoffTimeOrder: "asc", // slutspel: tidigaste | desc = senaste match först
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
    // Hela data/archive/index.json (cupId -> {cupName, editions:[{edition,
    // matches,teams,classes,days,...}]}), laddas EN gång vid appstart (se
    // init()) — till skillnad från archiveEditions ovan (bara årtalslista,
    // per cup, exkl. innevarande år) behåller den här alla nyckeltal OCH
    // innevarande år, vilket Trend-fliken (renderTrendView) behöver.
    archiveIndex: null,
    // {cupId: {edition: [rå lagnamn, ...]}}, byggd av scripts/build_team_
    // index.py, laddas lat vid första Klubb/Lag-sökningen (se
    // ensureTeamIndex/computeClubRows) — under 1 MB, till skillnad från de
    // fulla arkivfilerna. Låter computeClubRows slå upp VILKA cup-år som
    // ens KAN innehålla en sökning innan den hämtar de tunga filerna, i
    // stället för att alltid hämta ALLA arkiverade upplagor av ALLA cuper.
    teamIndex: null,
    // Trend-fliken: eget filter, INTE state.cats/state.teams — de håller
    // id:n som bara gäller innevarande upplaga (se allActiveMatches-
    // kommentaren om att id:n aldrig är stabila mellan år), så Trend filtrerar
    // i stället på KLASSNAMN (stabilt mellan år). Session, sparas ej.
    trendCats: new Set(),
    // Trend-fliken (enskild cup): manuellt valt baslinjeår (100 %-ankaret
    // i formkurvan), null = auto (se trendBaselineIndex). Session, sparas ej.
    trendBaselineYear: null,
    // Trend-fliken (flera cuper): vilket mått jämförelsegrafen visar — en av
    // TREND_METRICS nycklarna. Session, sparas ej.
    trendCompareMetric: "matches",
    // Klubb/Lag-fliken: fritextsökning på lag-/klubbnamn, söker över ALLA
    // cuper med arkiverad historik (till skillnad från Trend, som är
    // avgränsad till valda cuper) — se renderClubView. Session, sparas ej.
    clubQuery: "",
    // Klubb/Lag-fliken: nedborrning i resultatlistan — null/null = visa
    // listan över cuper, clubDrillCup satt = visa klassnedbrytning för den
    // cupen, båda satta = visa lag/matcher för den klassen. Nollställs när
    // sökningen ändras (se renderClubView) — en ny sökterm gör den gamla
    // nedborrningen obegriplig. Session, sparas ej.
    clubDrillCup: null,
    clubDrillClass: null,
    // Klubb/Lag-fliken: börjar med innevarande kalenderår. Tomma Set = alla
    // år efter att användaren aktivt har rensat årsväljaren; syncSubViewUrl
    // skriver då clubYears=all så valet överlever delning/bakåtnavigering.
    // över alla tre nivåerna (se clubEditionsFor). Rör INTE sökningen
    // (clubQuery) — behålls medvetet när man byter sökterm, till skillnad
    // från nedborrningen ovan. Session, sparas ej.
    clubYears: new Set([String(new Date().getFullYear())]),
    // Klubb/Lag-fliken: fyll ut "År"-kolumnen med de år cupen arkiverat men
    // klubben INTE deltog i (röd text, se renderYearsWithGaps) — på som
    // förval, men valfritt: en cup med gles historik kan annars dränka
    // kolumnen i rött. Session, sparas ej.
    clubShowGaps: true,
    // Cuper-fliken (under Stats): vald cup att visa år-för-år-nedbrytning
    // för, null = visa översiktstabellen över alla cuper. Session, sparas ej.
    statsCupDrill: null,
    // Klubbjämförelse-fliken (under Stats): klubbar/lag tillagda via sökrutan
    // med autocomplete (se renderClubCompareView), jämförs sida vid sida
    // (computeClubRows). Ordning bevaras (senast tillagd sist). Session,
    // sparas ej.
    compareNames: [],
    // Klubbjämförelse har ett eget, synligt årsval. Det får inte ärva
    // Klubb/Lag-flikens state.clubYears i smyg — då kunde siffrorna vara
    // filtrerade utan att jämförelsevyn visade varför.
    compareYears: new Set([String(new Date().getFullYear())]),
    // Klubbjämförelse-fliken: vilka rader (klubb-/lagnamn) som just nu är
    // expanderade och visar sin cup-för-cup-detalj (klasser + rå lagnamn,
    // se clubCompareDetailBlock) — en klubb/lag åt gången eller flera.
    // Session, sparas ej.
    compareExpanded: new Set(),
    // DELAD mellan Karta- och Trend-fliken (tom = bara innevarande, fylls i
    // vid första besöket i ENTINGEN renderMapView ELLER renderTrendView) —
    // samma cupurval hänger med när man växlar mellan de två flikarna i
    // stället för att varje flik glömmer det andra valde. EN vald cup ger
    // Trends formkurva som vanligt, FLERA ger en jämförelsegraf i stället
    // (se renderTrendCompare) — Karta bryr sig inte om antalet, bara VILKA.
    // Varje flik prunar ändå bort cuper som inte är giltiga för just den
    // (fel sport, eller för Trend: ingen arkiverad historik alls) innan den
    // egna vyn ritas, så ett urval som blandar t.ex. en historielös cup
    // stör bara Trend, inte Karta. mapCupStatus håller reda på lata
    // hämtningar av ANDRA cupers klubbdata (se ensureCupClubGeo) så samma
    // cup inte hämtas om flera gånger — bara Kartans eget, inte delat.
    exploreCupIds: new Set(),
    mapCupStatus: {},
    // cupId -> Set(klubbnamn), ALLA deltagande klubbar (kända+okända
    // adress) — skiljer sig från HB.api.clubGeo som bara har de vars
    // adress gick att slå upp. Fylls av ensureCupClubGeo. Session, sparas ej.
    mapCupAllClubs: {},
    // cupId -> antal lag (distinkta lag-id, se teamsAndClassesFromMatches)
    // respektive Set(klassnamn) — till Kartans sammanfattningsrad. Fylls
    // av ensureCupClubGeo (och loadCup(), se dess kommentar om samma race
    // som mapCupAllClubs hade). Session, sparas ej.
    mapCupTeamCount: {},
    mapCupClasses: {},
    // cupId -> Map(klubbnamn -> landskod), OBEROENDE av om klubben även har
    // en känd adress (avgörs vid slutlig sammanslagning i renderMapView, se
    // clubCountryFromMatches) — Kartans mellannivå mellan "känd adress" och
    // "helt okänd", landskoden är inbäddad direkt på varje match (home/away.
    // country, se js/api.js normalize()/scripts/fetch_*.py), kräver alltså
    // ingen namnmatchning mot klubbkatalogen. Fylls av ensureCupClubGeo (och
    // loadCup(), samma ställen som mapCupAllClubs). Session, sparas ej.
    mapCupCountryByClub: {},
    // Karta-fliken: valt år (ett av arkivets, null = "Nu"/live data) —
    // se renderMapView/mergedClubGeoForYear. Session, sparas ej.
    mapYear: null,
    // Karta-fliken: "Visa landshistorik"-kryssrutan (av som förval — kräver
    // att ALLA arkiverade år för de valda cuperna laddas, inte bara det
    // just synliga året, se countryYearSummary). Session, sparas ej.
    mapCountryHistory: false,
    showAllPlayedArena: false,   // Bana-vyn: visa alla spelade i stället för bara senaste timmarna
    // Bana-vyn: är kartan över banornas platser utfälld? Av som förval —
    // den drar in MapLibre från CDN (appens enda externa JS-beroende), och
    // adressraden ovanför räcker för de flesta besök. Session, sparas ej.
    arenaMapOpen: false,
    showAllPlayedBracket: false, // slutspelstabellen: samma, men för dess egna rader
    schemaOlderRevealCount: 0,   // schemat: hur många extra äldre matcher "visa fler tidigare" öppnat upp
    schemaNewerRevealCount: 0,   // schemat: hur många extra kommande "visa fler kommande" öppnat upp
    // Tillfälligt avsteg från Schemas automatiska favoriturval. Sparas inte:
    // användaren har inte ändrat sina filter eller favoriter, bara bett den
    // aktuella cupvyn att visa allt tills cupen laddas om/byts.
    schemaShowAllCup: false,
    matches: [],
    loadedAt: 0,
    loading: false,
    error: null,
    tables: {},              // divId -> {status, rows}
    playoffs: {},            // catId -> {status, divisions}
    groupTables: {},         // catId -> {status, byGroupNum, teamStrength} (för upplösta slutspelsnamn)
    // Globala inställningar (gäller alla cuper, sparas separat från
    // per-cup-filtren i saveUi()/loadUi()).
    theme: ["auto", "light", "dark"].includes(storageGet("hb:theme"))
      ? storageGet("hb:theme") : "auto",                    // light | dark | auto
    // Färgtema. Tomt = appens egna färger; övriga se :root[data-palette] i
    // style.css. Ljust/mörkt gäller inom vald palett.
    palette: ["parkett", "matchur", "beach"].includes(storageGet("hb:palette"))
      ? storageGet("hb:palette") : "",
    teamColors: storageGet("hb:teamColors") !== "off",
    breakMinutes: storageNumber("hb:breakMinutes", 0, 0, 240), // 0 = av
    // Schemarutans längd. matchMinutes är en beräknad egenskap (se
    // nedanför state): är matchMinutesAuto på härleds längden ur den
    // öppna cupens eget schema, annars gäller användarens egna minuter.
    liveFilledAt: 0,        // senast liveifyllnaden gav ett nytt resultat
    matchMinutesAuto: storageGet("hb:matchMinutesAuto") !== "off",
    matchMinutesManual: storageNumber("hb:matchMinutes", 30, 1, 240),
    revealBatchSize: storageNumber("hb:revealBatchSize", 4, 1, 100),
    recentMatchCount: storageNumber("hb:recentMatchCount", 2, 0, 100),
    advancedPlayoffTable: storageGet("hb:advancedPlayoffTable") === "on",
    playoffView: ["tree", "table"].includes(storageGet("hb:playoffView"))
      ? storageGet("hb:playoffView")
      : (storageGet("hb:advancedPlayoffTable") === "on" ? "table" : "tree"),
    showPlayoffProjection: storageGet("hb:showPlayoffProjection") === "on",
    showPlayoffPath: storageGet("hb:showPlayoffPath") !== "off",
    showPossibleGroupWinners: storageGet("hb:showPossibleGroupWinners") !== "off",
    showUpcomingCarousel: storageGet("hb:showUpcomingCarousel") !== "off",
    favoriteClub: storageGet("hb:favoriteClub", HB.CLUB.name),
    // Stjärnmärkta lag: [{name, cohort}] där cohort är årskullsnyckeln ur
    // klassnamnet ("F2011", se cohortKey) eller null när klassen inte går
    // att tolka. Klubb+lagnamn ensamt räcker INTE som identitet: "Alingsås
    // HK 1" finns samtidigt i F16, P16 och Herrjunior i samma cup (104
    // lagnamn i Göteborg Cup 2026 är tvetydiga på det viset), så en ren
    // namnmatchning stjärnmärkte alla på en gång. Årskullen är däremot
    // stabil mellan både cuper och år — ett lag fött 2011 är F2011 oavsett
    // om klassen råkar heta "F13" eller "Flickor 13" det året.
    //
    // Lista, inte ett enda lag: man har ofta flera barn eller följer flera
    // årskullar. hb:favoriteTeam (en sträng) migreras in nedan och lämnas
    // kvar orörd, så en nedgradering inte tappar valet.
    favoriteTeams: (() => {
      try {
        const raw = JSON.parse(storageGet("hb:favoriteTeams", "null"));
        if (Array.isArray(raw)) {
          return raw.filter((t) => t && t.name)
            .map((t) => ({ name: String(t.name), cohort: t.cohort || null }));
        }
      } catch { /* trasigt värde: falla tillbaka på det gamla fältet */ }
      const legacy = storageGet("hb:favoriteTeam", "").trim();
      return legacy ? [{ name: legacy, cohort: null }] : [];
    })(),
    fullCardColors: storageGet("hb:fullCardColors") === "on",
    // Minuter före matchstart som .ics-exporten lägger in en påminnelse
    // (VALARM), 0 = ingen. Väljs i exportmenyn men sparas här, se
    // buildMatchExportPanel.
    icsAlarmMinutes: storageNumber("hb:icsAlarmMinutes", 0, 0, 1440),
    teamColorOverrides: (() => {
      try {
        const value = JSON.parse(storageGet("hb:teamColorOverrides", "{}"));
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      }
      catch { return {}; }
    })(),
  };

  // Cup Manager publicerar bara starttider, aldrig matchlängder — men
  // schemat bär måttet i sig (se domain/match-length.js). Räkna om bara
  // när cupen eller matchmängden ändrats; heuristiken går igenom alla
  // matcher och läses av vid varje omritning.
  let autoMinutesKey = "";
  let autoMinutes = null;
  function derivedMatchMinutes() {
    const key = state.cupId + ":" + state.matches.length;
    if (key !== autoMinutesKey) {
      autoMinutesKey = key;
      autoMinutes = guessMatchMinutes(state.matches);
    }
    return autoMinutes;
  }
  Object.defineProperty(state, "matchMinutes", {
    enumerable: true,
    get() {
      const härledd = state.matchMinutesAuto && derivedMatchMinutes();
      return (härledd && härledd.minuter) || state.matchMinutesManual;
    },
    // Att skriva till matchMinutes är alltid ett medvetet val i
    // inställningarna — då slutar värdet följa cupen.
    set(minuter) {
      state.matchMinutesManual = minuter;
      state.matchMinutesAuto = false;
    },
  });

  // Ett enda omritningsjobb per bildruta räcker när många arkivår blir
  // klara samtidigt. Utan sammanslagning byggdes hela Klubb/Lag-vyn om en
  // gång per fil och kändes låst trots att data redan strömmade in.
  let archiveRenderFrame = 0;
  function scheduleArchiveRender() {
    if (archiveRenderFrame) return;
    archiveRenderFrame = requestAnimationFrame(() => {
      archiveRenderFrame = 0;
      render();
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme === "auto" ? "" : state.theme;
    document.documentElement.dataset.palette = state.palette || "";
  }

  // Bygger om HB.CLUB.pattern från den valfria favoritklubben i inställ-
  // ningarna (förvalt: samma klubb sajten är byggd för). Håller å/ä/ö
  // toleranta som den ursprungliga hårdkodade regexen gjorde.
  function rebuildClubPattern() {
    HB.CLUB.pattern = clubPatternFromName(state.favoriteClub || HB.CLUB.name);
  }
  rebuildClubPattern();

  function saveSettings() {
    persist("hb:theme", state.theme);
    persist("hb:palette", state.palette || "");
    // Skriv inte nyckeln förrän klubben faktiskt valts — annars skulle ett
    // temabyte göra att nästa sidladdning tror att Alingsås HK är valt
    // och visa den klubbens märke för en besökare som aldrig valt.
    if (hasChosenClub) persist("hb:favoriteClub", state.favoriteClub);
    persist("hb:favoriteTeams", JSON.stringify(state.favoriteTeams));
    rebuildClubPattern();
    updateClubLogo();
    persist("hb:teamColors", state.teamColors ? "on" : "off");
    persist("hb:breakMinutes", String(state.breakMinutes));
    persist("hb:matchMinutesAuto", state.matchMinutesAuto ? "on" : "off");
    persist("hb:matchMinutes", String(state.matchMinutesManual));
    persist("hb:revealBatchSize", String(state.revealBatchSize));
    persist("hb:recentMatchCount", String(state.recentMatchCount));
    persist("hb:advancedPlayoffTable", state.advancedPlayoffTable ? "on" : "off");
    persist("hb:playoffView", state.playoffView);
    persist("hb:showPlayoffProjection", state.showPlayoffProjection ? "on" : "off");
    persist("hb:showPlayoffPath", state.showPlayoffPath ? "on" : "off");
    persist("hb:showPossibleGroupWinners", state.showPossibleGroupWinners ? "on" : "off");
    persist("hb:showUpcomingCarousel", state.showUpcomingCarousel ? "on" : "off");
    persist("hb:fullCardColors", state.fullCardColors ? "on" : "off");
    persist("hb:teamColorOverrides", JSON.stringify(state.teamColorOverrides));
    applyTheme();
  }

  // Sätts direkt vid skriptkörning (inte i async init()) så temat är rätt
  // redan vid första målningen — annars hinner sidan flimra i fel tema.
  applyTheme();
  updateClubLogo();

  function cup() {
    return HB.allCups().find((c) => c.id === state.cupId) || HB.allCups()[0];
  }

  function scoreUnit(sport) {
    return (sport || cup().sport) === "basket" ? "poäng" : "mål";
  }

  function uiKey() { return "hb:ui:" + state.cupId; }

  // localStorage kan kasta: full kvot (Firefox ger 5 MB per origin mot
  // Chromes ~10 — se MAX_CACHE_BYTES i api.js), privat läge, eller
  // blockerad lagring i webbläsarens integritetsinställningar. Ett
  // misslyckat SPARANDE av en inställning får aldrig fälla hela sidan:
  // utan den här spärren blev det ett ofångat fel vid varje sidladdning
  // och varje cupbyte, vilket i sin tur triggade "något gick fel"-rutan
  // (se felfångaren överst i index.html). Vyn fungerar ändå — den tappar
  // bara minnet till nästa besök.
  function persist(key, value) {
    try { localStorage.setItem(key, value); } catch { /* utan lagring: kör vidare */ }
  }

  function saveUi() {
    persist("hb:cup", state.cupId);
    persist(uiKey(), JSON.stringify({
      view: state.view, statsView: state.statsView, scope: state.scope, days: [...state.days],
      cats: [...state.cats], teams: [...state.teams], years: [...state.years],
      includeCurrentYear: state.includeCurrentYear,
      arena: state.arena, viewArena: state.viewArena,
      sort: state.sort, timeOrder: state.timeOrder, matchFilter: state.matchFilter,
      filterLocked: state.filterLocked,
      tableSortKey: state.tableSortKey,
      tableSortOrder: state.tableSortOrder,
      playoffTimeOrder: state.playoffTimeOrder,
    }));
    syncUrl();
    refreshFilterChrome();
  }

  // Siffran på filterknappen och Rensa-brickans synlighet speglar aktuellt
  // filter. Ett filterval anropar bara renderContent(), inte render(), så
  // utan den här lätta uppdateringen låg både siffran och brickan kvar i
  // sitt gamla läge tills något annat råkade rita om verktygsraden.
  function refreshFilterChrome() {
    const n = activeFilterCount();
    for (const el of document.querySelectorAll(".filter-clear-tile")) el.hidden = !n;
    if (document.querySelector("#bottomBar")) renderBottomBar();
  }

  // Samma urval som siffran på filterknappen räknar (se activeFilterCount).
  // En enda väg så rens-brickan, tom-filterbannern och eventuell annan
  // "rensa"-yta inte glider isär.
  function clearViewFilters() {
    state.days.clear(); state.cats.clear(); state.teams.clear(); state.years.clear();
    state.includeCurrentYear = true;
    state.viewCats = new Set(); state.viewTeams = new Set();
    state.arena = ""; state.q = ""; state.matchFilter = "all";
    state.schemaOlderRevealCount = 0;
    state.schemaNewerRevealCount = 0;
    saveUi();
    render();
  }

  // Speglar aktuellt filter/sortering i adressfältet (utan att lägga till
  // historik-poster) så att en delad/bokmärkt länk återskapar exakt samma
  // vy. Bara icke-default värden tas med, för korta URL:er. q (fritextsök)
  // sparas INTE i localStorage (den är avsiktligt tillfällig mellan besök)
  // men tas med här eftersom en delad länk ska återge sökningen också.
  // En enda källa för adressfält, bokmärken och appens Dela-knapp. Den
  // senare byter bara ut upplagebundna klass-/lag-id:n mot namn; alla andra
  // filter, sorteringar och underfliksval ska vara exakt desamma.
  function buildViewUrlParams() {
    const p = encodeMainViewParams(state, {
      defaultClubName: HB.CLUB.name,
      hasChosenClub,
    });
    syncSubViewUrl(p);
    return p;
  }

  function syncUrl() {
    const p = buildViewUrlParams();
    const qs = p.toString();
    const url = location.pathname + (qs ? "?" + qs : "");
    // Bakåtknappen: lägg BARA en historik-post när den strukturella vyn
    // ändras (cup / flik / stats-underflik) — då kan webbläsarens bakåt-/
    // framåtknapp stega mellan de vyerna. Filter-, sök- och sorterings-
    // ändringar (samma cup+flik) ersätter i stället posten, så historiken
    // inte spammas med varje litet reglage. popstate nedan läser tillbaka.
    const sig = navSig();
    if (navInitialized && !applyingPopstate && sig !== lastNavSig) {
      history.pushState(null, "", url);
      lastNavSig = sig;
      return;
    }
    lastNavSig = sig;
    // syncUrl() körs numera efter VARJE renderContent() (se dess kommentar),
    // alltså även vid bakgrundsuppdateringar som inte ändrat något. Hoppa
    // över replaceState när URL:en redan är identisk — Safari stryper
    // history-anrop (~100 per 30 s) och skulle annars kunna börja kasta.
    if (url !== location.pathname + location.search) history.replaceState(null, "", url);
  }

  // Underflikarnas EGNA val — Vinnare-läge/klubb, Klubb/Lag-sökningen och
  // dess nedborrning, Kartans år, Trends klassurval osv. De bor utanför de
  // gemensamma filtren ovan (de flesta som modulnivå-variabler eller
  // "session, sparas ej"-fält i state), men måste ändå med i URL:en för att
  // en delad länk ska visa det man faktiskt tittar på. Bara parametrar som
  // hör till den JUST NU visade fliken tas med, så en Schema-länk slipper
  // släpa på ett halvdussin stats-parametrar den ändå inte läser.
  function subViewSnap() {
    return {
      view: state.view,
      statsView: state.statsView,
      schemaSelectionKey: state.schemaSelectionKey,
      tableGroupKey: state.tableGroupKey,
      tableSortKey: state.tableSortKey,
      tableSortOrder: state.tableSortOrder,
      arenaMapOpen: state.arenaMapOpen,
      playoffTimeOrder: state.playoffTimeOrder,
      bracketSort: getBracketSort(),
      playoffCatTab: state.playoffCatTab,
      playoffDivTab: state.playoffDivTab,
      exploreCupIds: state.exploreCupIds,
      trendCats: state.trendCats,
      trendBaselineYear: state.trendBaselineYear,
      trendCompareMetric: state.trendCompareMetric,
      mapYear: state.mapYear,
      mapCountryHistory: state.mapCountryHistory,
      clubQuery: state.clubQuery,
      clubDrillCup: state.clubDrillCup,
      clubDrillClass: state.clubDrillClass,
      clubYears: state.clubYears,
      clubShowGaps: state.clubShowGaps,
      compareNames: state.compareNames,
      compareExpanded: state.compareExpanded,
      compareYears: state.compareYears,
      statsCupDrill: state.statsCupDrill,
      ...getStatsUrlFields(),
    };
  }

  function syncSubViewUrl(p) {
    encodeSubViewParams(p, subViewSnap());
  }

  // Strukturell "vy-signatur" — det som ska räknas som ett eget bakåtsteg.
  function navSig() {
    return state.cupId + "|" + state.view + "|" + (state.view === "stats" ? state.statsView : "");
  }
  let lastNavSig = null;
  let navInitialized = false;   // sätts sant när init är klar (så första synken ersätter, inte pushar)
  let applyingPopstate = false; // sant medan popstate återställer state (ingen ny push då)
  let pendingNamedUrlFilters = null;

  // Läser URL-parametrar → state (delad/bokmärkt länk och popstate delar
  // denna). Sätter bara det som faktiskt finns i URL:en; nollställning görs
  // separat (resetUrlState) före popstate-återställning.
  function applyUrlToState(params) {
    const patch = decodeMainViewParams(params);
    if (patch.favoriteClub) {
      state.favoriteClub = patch.favoriteClub;
      markClubChosen();
      persist("hb:favoriteClub", patch.favoriteClub);
      rebuildClubPattern();
      updateClubLogo();
    }
    if (patch.view) state.view = patch.view;
    if (patch.statsView) state.statsView = patch.statsView;
    normalizeStatsView();
    if (patch.scope) state.scope = patch.scope;
    if (patch.days) state.days = patch.days;
    if (patch.cats) state.cats = patch.cats;
    if (patch.teams) state.teams = patch.teams;
    if (patch.years) state.years = patch.years;
    if (patch.includeCurrentYear === false) state.includeCurrentYear = false;
    if (patch.arena) state.arena = patch.arena;
    if (patch.viewArena) state.viewArena = patch.viewArena;
    if (patch.sort) state.sort = patch.sort;
    if (patch.timeOrder) state.timeOrder = patch.timeOrder;
    if (patch.matchFilter) state.matchFilter = patch.matchFilter;
    if (patch.q) state.q = patch.q;
    applySubViewUrl(params);
  }

  // Lag- och klass-id byts mellan cupupplagor, så delningslänkar får även
  // ange stabilare namn. Namnen kan inte lösas här tillsammans med övriga
  // URL-parametrar: först efter loadCup() finns den aktuella upplagans
  // matcher och därmed dess nya id:n. Behåll därför namnvalen i minnet tills
  // matcherna har laddats. Den exakta id-formen vinner om båda finns.
  // Namnlistor separeras med NAME_SEP (~), inte komma: två lagnamn i datan
  // innehåller faktiskt komma ("Runar, IL" och "When in Europe, don't miss
  // Skurup"), och de skulle annars klyvas mitt itu och inte matcha något.
  // Samma separator som Stats-underflikarnas namnlistor redan använder.
  function splitNameList(raw) {
    return splitNamedList(raw, slugifySv);
  }

  function queueNamedUrlFilters(params) {
    const team = params.has("team") && !params.has("teams");
    const klass = params.has("klass") && !params.has("cats");
    pendingNamedUrlFilters = team || klass
      ? { cupId: state.cupId, params: new URLSearchParams(params), team, klass }
      : null;
    // En namnbaserad delningslänk ska inte blandas med ett gammalt, sparat
    // filter. Om namnet saknas i cupen blir mängden kvar tom, helt tyst.
    if (team) state.teams = new Set();
    if (klass) state.cats = new Set();
  }

  function applyPendingNamedUrlFilters() {
    const pending = pendingNamedUrlFilters;
    if (!pending || pending.cupId !== state.cupId || !state.matches.length) return false;
    const resolved = resolveNamedUrlFilters(state.matches, pending.params, slugifySv, (m) => [
      slugifySv(m.catName), slugifySv(HB.shortCat(m.catName)),
      slugifySv(cohortKey(m.catName) || ""),
    ]);
    if (pending.team && resolved.teams) state.teams = resolved.teams;
    if (pending.klass && resolved.cats) state.cats = resolved.cats;
    pendingNamedUrlFilters = null;
    return true;
  }

  // Motsvarigheten till syncSubViewUrl — läser underflikarnas egna val ur
  // URL:en. Läser ALLA nycklar oavsett vilken flik som är vald (till skillnad
  // från skrivningen): en länk som råkar bära med sig extra parametrar ska
  // ändå landa rätt om man sen växlar till den fliken.
  function applySubViewUrl(params) {
    const patch = decodeSubViewParams(params);
    if (patch.schemaSelectionKey) state.schemaSelectionKey = patch.schemaSelectionKey;
    if (patch.tableGroupKey) state.tableGroupKey = patch.tableGroupKey;
    if (patch.tableSortKey) state.tableSortKey = patch.tableSortKey;
    if (patch.tableSortOrder) state.tableSortOrder = patch.tableSortOrder;
    if (patch.arenaMapOpen) state.arenaMapOpen = true;
    if (patch.playoffCatTab != null) state.playoffCatTab = patch.playoffCatTab;
    if (patch.playoffTimeOrder) state.playoffTimeOrder = patch.playoffTimeOrder;
    if (patch.bracketSort) setBracketSort(patch.bracketSort);
    if (patch.playoffDivTab) state.playoffDivTab = patch.playoffDivTab;
    if (patch.exploreCupIds) state.exploreCupIds = patch.exploreCupIds;
    if (patch.trendCats) state.trendCats = patch.trendCats;
    if (patch.trendBaselineYear) state.trendBaselineYear = patch.trendBaselineYear;
    if (patch.trendCompareMetric) state.trendCompareMetric = patch.trendCompareMetric;
    if (patch.mapYear) state.mapYear = patch.mapYear;
    if (patch.mapCountryHistory) state.mapCountryHistory = true;
    if ("clubQuery" in patch) state.clubQuery = patch.clubQuery;
    if (patch.clubDrillCup) state.clubDrillCup = patch.clubDrillCup;
    if (patch.clubDrillClass) state.clubDrillClass = patch.clubDrillClass;
    if (patch.clubYears) state.clubYears = patch.clubYears;
    if (patch.clubShowGaps === false) state.clubShowGaps = false;
    if (patch.compareNames) state.compareNames = patch.compareNames;
    if (patch.compareExpanded) state.compareExpanded = patch.compareExpanded;
    if (patch.compareYears) state.compareYears = patch.compareYears;
    if (patch.statsCupDrill) state.statsCupDrill = patch.statsCupDrill;
    applyStatsUrlFields(patch);
  }

  // Återställer de URL-styrda fälten till default (allt som INTE finns med i
  // en bakåt-navigerad URL ska tömmas innan den läses in, annars hänger t.ex.
  // ett gammalt filter kvar). Rör inte fält utanför URL:en (filterLocked m.m.).
  function resetUrlState() {
    state.view = "schema"; state.statsView = "trend"; state.scope = "club";
    state.days = new Set(); state.cats = new Set(); state.teams = new Set(); state.years = new Set();
    state.includeCurrentYear = true; state.arena = ""; state.viewArena = ""; state.tableGroupKey = "all";
    state.tableSortKey = "points"; state.tableSortOrder = "desc"; state.playoffTimeOrder = "asc";
    state.sort = "tid"; state.timeOrder = "asc"; state.matchFilter = "all"; state.q = "";
    resetSubViewUrl();
  }

  // Samma sak för underflikarnas egna val (se syncSubViewUrl) — utan den
  // skulle t.ex. en nedborrning i Klubb/Lag eller Kartans valda år hänga
  // kvar när man backar till en URL som inte har dem.
  function resetSubViewUrl() {
    const d = defaultSubViewSnap();
    state.schemaSelectionKey = d.schemaSelectionKey;
    state.arenaMapOpen = d.arenaMapOpen;
    state.playoffCatTab = d.playoffCatTab;
    state.playoffDivTab = d.playoffDivTab;
    setBracketSort(d.bracketSort);
    state.exploreCupIds = d.exploreCupIds;
    state.trendCats = d.trendCats;
    state.trendBaselineYear = d.trendBaselineYear;
    state.trendCompareMetric = d.trendCompareMetric;
    state.mapYear = d.mapYear;
    state.mapCountryHistory = d.mapCountryHistory;
    state.clubQuery = d.clubQuery;
    state.clubDrillCup = d.clubDrillCup;
    state.clubDrillClass = d.clubDrillClass;
    state.clubYears = d.clubYears;
    state.clubShowGaps = d.clubShowGaps;
    state.compareNames = d.compareNames;
    state.compareExpanded = d.compareExpanded;
    state.compareYears = d.compareYears;
    state.statsCupDrill = d.statsCupDrill;
    resetStatsUrlFields(d);
  }

  // Trend/Karta/Klubb-Lag var tidigare egna toppnivåflikar (state.view-
  // värden) innan de 2026-07-25 slogs ihop till underflikar under en enda
  // "Stats"-flik (se STATS_TABS/renderStatsView) — gamla sparade/delade
  // länkar (view=trend/karta/klubb) ska ändå landa rätt i stället för att
  // tyst falla tillbaka på Schema.
  function normalizeStatsView() {
    if (["trend", "karta", "klubb"].includes(state.view)) {
      state.statsView = state.view;
      state.view = "stats";
    }
  }

  function loadUi() {
    state.view = "schema"; state.statsView = "trend"; state.scope = "club"; state.days = new Set();
    state.cats = new Set(); state.teams = new Set(); state.years = new Set();
    state.includeCurrentYear = true; state.tableGroupKey = "all"; state.schemaSelectionKey = "all";
    state.tableSortKey = "points"; state.tableSortOrder = "desc"; state.playoffTimeOrder = "asc";
    state.viewCats = new Set(); state.viewTeams = new Set();
    state.arena = ""; state.viewArena = ""; state.q = ""; state.sort = "tid"; state.matchFilter = "all";
    state.timeOrder = "asc"; state.schemaOlderRevealCount = 0; state.schemaNewerRevealCount = 0; state.schemaShowAllCup = false;
    state.filterLocked = false;
    try {
      const s = JSON.parse(storageGet(uiKey(), "{}"));
      if (s.view) state.view = s.view;
      if (s.statsView) state.statsView = s.statsView;
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
      if (["rank", "name", "points"].includes(s.tableSortKey)) state.tableSortKey = s.tableSortKey;
      if (s.tableSortOrder === "asc") state.tableSortOrder = "asc";
      if (s.playoffTimeOrder === "desc") state.playoffTimeOrder = "desc";
    } catch { /* trasig state: kör default */ }
    normalizeStatsView();
  }

  // --- datainläsning --------------------------------------------------------

  function loadWeather() {
    const c = cup();
    // Basket, innebandy och andra uttryckligt inomhusmarkerade cuper ska
    // inte visa utomhusväder som om det gällde inne i hallen.
    if (c.indoor) return;
    HB.weather.fetchForecast(c).then(() => {
      if (state.cupId === c.id) renderContent();
    });
  }

  // Två separata generationer skyddar asynkrona svar. cupGeneration byts
  // bara när CUPEN byts och används även av tabell-/slutspelsköerna.
  // loadGeneration byts för varje schemahämtning, så två överlappande
  // uppdateringar av samma cup inte kan skriva i omvänd ordning.
  let cupGeneration = 0;
  let loadGeneration = 0;
  const isCurrentCupWork = (c, generation) =>
    generation === cupGeneration && !!c && state.cupId === c.id;
  const isCurrentCupLoad = (c, cupGen, loadGen) =>
    isCurrentCupWork(c, cupGen) && loadGen === loadGeneration;

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
    const cupGen = cupGeneration;
    const loadGen = ++loadGeneration;
    loadWeather(); // oberoende av matchdata — hämtas parallellt
    // Förhämtade cuper (dataUrl) läses alltid färskt — filen ligger lokalt.
    const cached = c.dataUrl ? null : HB.api.readCache(c);
    if (cached && cached.matches) {
      state.matches = cached.matches;
      state.loadedAt = cached.ts;
      HB.api.localDataTs[c.id] = cached.dataTs || 0;
      // Karta-vyns klubbadresser hänger med i samma cache-post (se
      // writeCache i api.js) — utan den här raden skulle kartan vara tom
      // tills nästa live-/inkrementella hämtning råkar skriva över den.
      // ÄLDRE cache-poster (skrivna innan clubs-fältet infördes) saknar
      // den helt — sätt då INTE clubGeo till {} (ensureCupClubGeo ser en
      // redan satt, om än tom, post som "redan känt" och hämtar aldrig om,
      // så Karta-fliken skulle permanent se ut att sakna data tills cachen
      // en dag naturligt förnyas). Lämna clubGeo osatt i stället, så
      // ensureCupClubGeo hämtar riktig geodata från snapshotten.
      //
      // mapCupAllClubs/mapCupStatus sätts HÄR också (inte bara i
      // ensureCupClubGeo:s done()) — annars vinner detta snabbare, direkta
      // cache-läsvägen alltid racet mot ensureCupClubGeo:s egen (senare
      // startade) hämtning, vars guard (if HB.api.clubGeo[cupId] ...)
      // redan ser clubGeo som satt och hoppar över hela sin done()-körning
      // — så mapCupAllClubs för INNEVARANDE cup skulle aldrig fyllas i,
      // vilket visar sig som "0 klubbar totalt" i Karta trots att adresser
      // faktiskt finns (entries/merged byggs direkt ur HB.api.clubGeo, som
      // ANDRA halvan av paret, och blir därför inte tomt).
      // Bana-vyns adressdata, samma resonemang som clubs ovan: äldre
      // cache-poster (skrivna innan arenas-fältet infördes) saknar den, och
      // ska då lämna arenaGeo osatt så snapshot-vägen nedan kan fylla den.
      if (cached.arenas) HB.api.arenaGeo[c.id] = cached.arenas;
      if (cached.clubs) {
        HB.api.clubGeo[c.id] = cached.clubs;
        state.mapCupAllClubs[c.id] = allClubNamesFromMatches(cached.matches);
        state.mapCupCountryByClub[c.id] = clubCountryFromMatches(cached.matches);
        const tc = teamsAndClassesFromMatches(cached.matches);
        state.mapCupTeamCount[c.id] = tc.teamCount;
        state.mapCupClasses[c.id] = tc.classes;
        state.mapCupStatus[c.id] = "done";
      }
    }
    if (!isCurrentCupLoad(c, cupGen, loadGen)) return;
    if (applyPendingNamedUrlFilters()) saveUi();
    const currentTtl = refreshTtl(state.matches);
    const fresh = state.matches.length &&
      Date.now() - state.loadedAt < currentTtl;
    if (fresh && !force) { state.loading = false; render(); return; }
    state.loading = true;
    state.error = null;
    render();
    try {
      // En tom lokal cache får inte kortsluta själva snapshothämtningen.
      // Det kan hända när snapshotfilen har fyllts på efter att ett tomt
      // resultat redan sparats med samma versionsstämpel. I det läget vet
      // versionsindexet bara att körningen är densamma, inte att den lokala
      // nyttolasten är komplett. Skicka därför ingen känd version förrän vi
      // faktiskt har minst en match att återanvända.
      const previousDataTs = state.matches.length
        ? (HB.api.localDataTs[c.id] || 0)
        : 0;
      const snapshot = await HB.api.fetchSharedSnapshot(c, previousDataTs);
      if (!isCurrentCupLoad(c, cupGen, loadGen)) return;
      if (snapshot.unchanged) {
        state.loadedAt = Date.now();
        if (!c.dataUrl) {
          HB.api.writeCache(c, state.matches, state.loadedAt, previousDataTs);
        }
        state.loading = false;
        render();
        return;
      }
      const changed = snapshot.ts !== previousDataTs ||
        snapshot.matches.length !== state.matches.length;
      state.matches = snapshot.matches;
      state.loadedAt = Date.now();
      if (snapshot.hasClubs) {
        state.mapCupAllClubs[c.id] = allClubNamesFromMatches(snapshot.matches);
        state.mapCupCountryByClub[c.id] = clubCountryFromMatches(snapshot.matches);
        const tc = teamsAndClassesFromMatches(snapshot.matches);
        state.mapCupTeamCount[c.id] = tc.teamCount;
        state.mapCupClasses[c.id] = tc.classes;
        state.mapCupStatus[c.id] = "done";
      } else {
        // ProCup/Gothia får sina adresser via den centralt byggda
        // klubbkatalogen, men lag/klasser ur samma snapshot.
        delete state.mapCupStatus[c.id];
        ensureCupClubGeo(c.id, snapshot.matches);
      }
      // Tabeller/slutspel kan bero på ändrade resultat. Rensa dem bara när
      // den GEMENSAMMA snapshotversionen faktiskt ändrats; tusen manuella
      // kontroller av samma version ska inte skapa nytt arbete.
      if (changed) {
        state.tables = {};
        state.playoffs = {};
        state.groupTables = {};
        resetMatchUi();
        HB.api.invalidateSubCaches(c);
      }
      if (applyPendingNamedUrlFilters()) saveUi();
      if (!c.dataUrl) HB.api.writeCache(c, snapshot.matches, state.loadedAt, snapshot.ts);
      if (!hasSyncedFreshData) {
        hasSyncedFreshData = true;
        setSchemaAutoScrolled(false); // en chans att rätta till en skroll som blev fel mot cachens gamla data
      }
    } catch (e) {
      if (!isCurrentCupLoad(c, cupGen, loadGen)) return;
      // Stale-while-error: finns en lokal kopia fortsätter den fungera.
      // Ett tillfälligt Pages-/nätfel ska inte ersätta användbar cupdata
      // med en blockerande felsida.
      state.error = state.matches.length ? null :
        "Kunde inte hämta CupSchemas gemensamma schema. Kontrollera nätet och försök igen.";
      console.error(e);
    }
    state.loading = false;
    render();
  }

  // --- liveifyllnad -----------------------------------------------------
  // Den gemensamma snapshotten i data/ byggs av CI. CI-jobbet mal numera
  // vidare i femminuterstakt under matchtid (se scripts/ci_update_loop.sh),
  // men fem minuter är fortfarande en evighet mitt i en match. Därför
  // frågar appen källan direkt om just de matcher som saknar slutresultat
  // — de som pågår och de som nyss spelats klart (se domain/live-gap.js).
  //
  // Snålt med flit: ett anrop per match, högst 40 åt gången, bara medan
  // fliken är synlig, och takten trappas ner mot åtta minuter så fort ett
  // varv inte gav något nytt. En cup som aldrig rapporterar resultat ska
  // inte kosta ett anrop i minuten i tolv timmar.
  const LIVE_FILL_MS = 60000;
  const LIVE_FILL_MAX_MS = 8 * 60000;
  let liveFillNext = 0;
  let liveFillPause = LIVE_FILL_MS;
  let liveFillBusy = false;

  async function liveFill() {
    const c = cup();
    if (liveFillBusy || state.loading || !c || c.dataUrl) return;
    if (Date.now() < liveFillNext) return;
    // Fråga bara om det användaren faktiskt tittar på: det egna urvalet om
    // ett filter är aktivt, annars klubbens matcher. Med ett anrop per
    // match är skillnaden avgörande — Alingsås matcher i Göteborg Cup ger
    // två kandidater mitt i en speldag, hela cupen ger hundratals.
    const fokus = hasFilterSelection() ? filtered() : scoped();
    const kandidater = liveGapMatches(fokus.length ? fokus : state.matches);
    if (!kandidater.length) {
      liveFillNext = Date.now() + LIVE_FILL_MAX_MS;
      return;
    }
    // Står en match mitt i sin ruta ska takten ligga kvar på en minut
    // även när varvet inte gav något nytt. Minuterna mellan två mål är
    // inte ett tecken på att inget händer — och att då trappa upp till
    // åtta minuter vore precis fel läge att sluta titta.
    const spelasNu = kandidater.some((m) =>
      Date.now() < m.start + state.matchMinutes * 60000);
    const cupGen = cupGeneration;
    liveFillBusy = true;
    try {
      const färska = await HB.api.fetchMatchesByIds(c, kandidater.map((m) => m.id));
      if (cupGen !== cupGeneration) return;
      const färskById = new Map(färska.map((m) => [m.id, m]));
      let ändrade = 0;
      state.matches = state.matches.map((m) => {
        const ny = färskById.get(m.id);
        if (!ny) return m;
        if (resultChanged(m, ny)) ändrade++;
        return ny;
      });
      if (ändrade) {
        state.liveFilledAt = Date.now();
        // Ändrade resultat betyder ändrade tabeller och slutspelsträd.
        // resetMatchUi() körs INTE: inga matcher har tillkommit eller
        // försvunnit, och den skulle slänga "visa fler"-läget varje minut.
        state.tables = {};
        state.playoffs = {};
        state.groupTables = {};
        HB.api.invalidateSubCaches(c);
        HB.api.writeCache(c, state.matches, state.loadedAt,
          HB.api.localDataTs[c.id] || 0);
        render();
      }
      liveFillPause = (ändrade || spelasNu) ? LIVE_FILL_MS
        : Math.min(liveFillPause * 2, LIVE_FILL_MAX_MS);
    } catch {
      // Källan kan vara nere eller strypa oss — snapshotten duger så
      // länge, backa av och försök igen senare.
      liveFillPause = Math.min(liveFillPause * 2, LIVE_FILL_MAX_MS);
    } finally {
      liveFillBusy = false;
      liveFillNext = Date.now() + liveFillPause;
    }
  }

  // Exponerad för felsökning: HB.liveFill() i konsolen kör ett varv nu
  // i stället för att vänta ut minuttakten.
  HB.liveFill = liveFill;

  function switchCup(id) {
    if (id === state.cupId) return;
    cupGeneration++;
    state.cupId = id;
    state.tables = {};
    state.playoffs = {};
    state.groupTables = {};
    state.matches = [];
    state.loadedAt = 0;
    state.liveFilledAt = 0;
    liveFillNext = 0;
    liveFillPause = LIVE_FILL_MS;
    resetMatchUi();
    stashedFilter = null;
    // Sökrutan hör till den cup man stod i — en ny cup ska mötas av sitt
    // eget favoriturval, inte av föregående cups halvskrivna sökning.
    resetSchemaUi();
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
    const requestedCup = HB.allCups().find((candidate) => candidate.id === cupId);
    if (state.archiveEditions[cupId]) return;
    state.archiveEditions[cupId] = { status: "loading", editions: [] };
    HB.api.fetchArchiveIndex().then((idx) => {
      const entry = idx[cupId];
      const editions = ((entry && entry.editions) || [])
        .map((e) => e.edition)
        .filter((e) => !requestedCup || e !== requestedCup.edition)
        .sort((a, b) => b.localeCompare(a, "sv", { numeric: true }));
      state.archiveEditions[cupId] = { status: "done", editions };
      scheduleArchiveRender();
    }).catch(() => {
      state.archiveEditions[cupId] = { status: "done", editions: [] };
      scheduleArchiveRender();
    });
  }

  // Hämtar en hel arkiverad upplagas matcher (en gång, cachas i minnet för
  // sessionen) när den kryssas i årsväljaren. Nyckeln inkluderar cupId —
  // annars skulle t.ex. "2024" för två olika cuper krocka i samma cache.
  // Varje match stämplas med .edition så Schema/Tabeller/Slutspel kan
  // visa/gruppera per år och skilja arkiverade divisioner/kategorier
  // (som måste räknas fram lokalt, se ensureTable/ensurePlayoffs) från
  // innevarande års live-hämtade (odefinierad .edition = live).
  //
  // cupId (valfri, förval = innevarande cup): Klubb/Lag-flikens klubb-över-
  // cuper-lista (computeClubRows) och Trend-jämförelsegrafens klassfilter
  // behöver hämta arkiverade år för ANDRA cuper än den just nu aktiva —
  // samma cache (state.yearMatches) återanvänds rakt av eftersom nyckeln
  // redan är cupId-prefixad.
  function ensureYearMatches(edition, cupId) {
    cupId = cupId || state.cupId;
    const key = cupId + ":" + edition;
    if (state.yearMatches[key]) return;
    state.yearMatches[key] = { status: "loading", matches: [] };
    HB.api.fetchArchiveEdition(cupId, edition).then((data) => {
      const matches = ((data && data.matches) || []).map((m) => ({ ...m, edition }));
      state.yearMatches[key] = { status: "done", matches };
      state.yearRosters[key] = (data && data.rosters) || {};
      scheduleArchiveRender();
    }).catch(() => {
      state.yearMatches[key] = { status: "error", matches: [] };
      scheduleArchiveRender();
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
  // Spärren finns för att Schema/Tabeller/Slutspel annars skulle rendera
  // HELA cupen som förval — tusentals matcher man sällan vill se på en gång.
  // Den ska alltså fånga "har användaren smalnat av tillräckligt", inte
  // "har användaren valt just en klass".
  //
  // En vald PLAN räknas därför också: en hall är i praktiken ett par dussin
  // matcher (Örebrocupens största har 37 av 416), alltså minst lika smalt
  // som en klass. Det är dessutom precis det urval en hallansvarig vill ha —
  // cup, dag och hall, utan att bry sig om vilka klasser som spelar där.
  //
  // Dagar räknas INTE på egen hand: en enskild dag kan vara hela cupen i en
  // helgcup, och Åhus har 600+ matcher per speldag. Dag SMALNAR AV ett
  // hallval, men duger inte som enda avgränsning.
  //
  // Tabeller och Slutspel delar spärren men har ingen planväljare, så för dem
  // är villkoret oförändrat i praktiken.
  function hasFilterSelection() {
    return selectionIsActive({
      cats: state.cats, teams: state.teams, arena: state.arena, q: state.q,
    });
  }

  function matchesSearchQuery(m) {
    return matchMatchesQuery(m, state.q);
  }

  // Ett gemensamt "vy-filter" (viewCats/viewTeams) — se state ovan.
  // isFilterLocked() delas mellan renderToolbar (som bygger låsknappen)
  // och Schema/Tabeller/Slutspel (som avgör om vy-filterraden ska visas).
  function hasLockableSelection() {
    return lockableIsActive({
      days: state.days, cats: state.cats, teams: state.teams,
      years: state.years, includeCurrentYear: state.includeCurrentYear,
    });
  }
  // Låset skyddar en ALLTID SYNLIG verktygsrad från feltryck under en cupdag.
  // I mobilens ark ligger filtren tre medvetna tryck bort (Filter -> väljare
  // -> kryssruta), så skyddet köper ingenting där — det gjorde bara att
  // klass-/lag-/årsväljarna försvann utan att det var uppenbart varför.
  // Gäller alltså bara över 700 px, där raden fortfarande står framme.
  //
  // state.filterLocked NOLLSTÄLLS inte: låser man på datorn och sedan öppnar
  // telefonen ska urvalet vara detsamma, bara redigerbart. Skyddet är det
  // enda som skiljer.
  function isFilterLocked() {
    return filterLockIsOn({
      sheetMode: sheetMode(), filterLocked: state.filterLocked,
      lockable: hasLockableSelection(),
    });
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
            id: side.id, name: side.name,
            // HELA namnet, inte teamSuffix(): den strippar favoritklubbens
            // namn, vilket är rätt i klubbläget (där ALLA lag är dina, så
            // prefixet bara upprepas) men fel här. I "Hela cupen" stod
            // andra klubbars lag med fullt namn medan dina egna dök upp som
            // bara "F13 Blå" — omöjliga att hitta för den som letar efter
            // "Alingsås HK", och sorterade dessutom under B i stället för A.
            suffix: side.name,
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) ||
      a.suffix.localeCompare(b.suffix, "sv"));
  }

  // Kandidater för favoritklubb-autocomplete.
  //
  // Favoritklubben är en egenskap hos ANVÄNDAREN, inte hos den cup som
  // råkar vara vald — men listan byggdes förr enbart ur state.matches, den
  // öppna cupens matcher. Det gav två fel: en cup där ens klubb inte är
  // med i år (eller som ännu inte publicerat något, t.ex. Örebrocupen med
  // 0 matcher) erbjöd inte klubben alls, och ett ospelat slutspelsträd
  // fyllde listan med platshållare ("1:an i Grupp A", "Vinn.").
  //
  // Nu är klubbkatalogen (data/club-directory.json, alla klubbar från alla
  // cuper och år) grundkällan, med den öppna cupens egna namn ovanpå —
  // klubbar stavas olika i olika cuper ("AHK" vs "Alingsås HK") och en
  // alldeles ny klubb hinner inte in i katalogen förrän den byggts om.
  function clubNameCandidates() {
    const set = new Set(Object.keys(getClubDirectory() || {}));
    for (const m of state.matches) {
      for (const side of [m.home, m.away]) {
        const name = (side.name || "").trim();
        if (!name || isPlaceholderTeam(side)) continue;
        if (side.club) set.add(side.club);
        set.add(name);
        const words = name.split(/\s+/);
        if (words.length > 1) set.add(words.slice(0, -1).join(" "));
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "sv"));
  }

  // Kandidater för favoritlag-autocomplete.
  //
  // Ett lagnamn ensamt duger inte som val: "Alingsås HK 1" finns samtidigt i
  // F16, P16 och Herrjunior. Varje förslag bär därför sin ÅRSKULL och visas
  // som "Alingsås HK 1 (Flickor 2011)", sökbart på både namnet och kullen
  // ("f2011"). Ordningen är medveten: lagen ur cupernas INNEVARANDE upplagor
  // först — det är dem man vill följa nu — och de äldre namnen ur arkivet
  // sist, som en möjlighet att stjärnmärka ett lag man mött förr.
  //
  // Klassen finns bara i matchdatan, inte i lagnamnsindexet, så de arkiverade
  // namnen saknar årskull (cohort null) och matchar då på namnet allena.
  function favoriteTeamCandidates() {
    const club = (state.favoriteClub || "").trim().toLowerCase();
    const seen = new Set();
    const out = [];
    const add = (name, catName) => {
      const n = (name || "").trim();
      if (!n || isPlaceholderTeam({ name: n })) return;
      if (club && !n.toLowerCase().startsWith(club)) return;
      const cohort = cohortKey(catName);
      const key = favoriteTeamKey(n, cohort);
      if (seen.has(key)) return;
      seen.add(key);
      const kull = cohort ? cohortLabel(catName) : (catName || "").trim();
      out.push({
        label: n + (kull ? " (" + kull + ")" : ""),
        // sök­texten rymmer både kortformen (F2011) och den skrivna
        // ("Flickor 2011"), så båda skrivsätten hittar laget
        search: [n, cohort, kull, HB.shortCat(catName || "")].filter(Boolean).join(" "),
        value: { name: n, cohort },
      });
    };
    // Innevarande upplaga: klubbens lag med sin klass
    for (const m of state.matches) {
      for (const side of [m.home, m.away]) add(side.name, m.catName);
    }
    // Alla andra cupers lagnamn ur arkivets index (ingen klass tillgänglig)
    for (const byEdition of Object.values(state.teamIndex || {})) {
      for (const names of Object.values(byEdition || {})) {
        for (const name of names || []) add(name, null);
      }
    }
    return out;
  }

  // Valda favoritlag som borttagbara chips under sökfältet. Ritas om av
  // både inställningsfältet och stjärnknappen i lagrutan, så de två vägarna
  // in alltid visar samma lista.
  function renderFavoriteTeamList() {
    const box = $("#favoriteTeamList");
    if (!box) return;
    if (!state.favoriteTeams.length) {
      box.replaceChildren(h("span", { class: "muted" }, "Inga favoritlag valda."));
      return;
    }
    box.replaceChildren(...state.favoriteTeams.map((f, i) =>
      h("span", { class: "fav-team-chip" },
        f.name,
        f.cohort ? h("span", { class: "fav-team-cohort" }, " " + f.cohort) : null,
        h("button", {
          class: "fav-team-remove", type: "button",
          "aria-label": "Ta bort " + f.name + " ur favoritlagen",
          title: "Ta bort",
          onclick: () => {
            state.favoriteTeams.splice(i, 1);
            saveSettings();
            renderFavoriteTeamList();
            render();
          },
        }, "×"))));
  }

  // arenaOverride: Bana-fliken har sin EGEN banväljare (state.viewArena,
  // medvetet frikopplad från verktygsradens "Alla planer"-filter, se
  // renderArenaView) men ska annars lyda under exakt samma filter som
  // schemat (klubb/hela cupen, dagar, klasser, egna lag, matchstatus,
  // fritextsök) — annars "renderar"/beter den fliken sig annorlunda än
  // resten av appen trots att verktygsraden ser likadan ut överallt.
  function filtered(arenaOverride) {
    const arena = arenaOverride !== undefined ? arenaOverride : state.arena;
    return scoped().filter((m) => matchPassesFilters(m, {
      days: state.days, cats: state.cats, teams: state.teams,
      arena, matchFilter: state.matchFilter, q: state.q,
    }));
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
  //
  // Synkar också URL:en. Underflikarnas egna val (Vinnare-läge, Klubb/Lag-
  // sökningen, Kartans år …) ligger utanför saveUi():s per-cup-filter och
  // deras klickhanterare anropar bara renderContent() — utan den här
  // synken hamnade inget av det i adressfältet. Görs EFTER kroppen: flera
  // underflikar sätter sina defaults lat vid första ritningen (troféskåpets
  // klubb = favoritklubben, Kalenderns år = innevarande), och en synk före
  // hade missat dem. syncUrl() hoppar över identiska URL:er, så de många
  // "onödiga" anropen (bakgrundsuppdateringar) kostar ingenting.
  function renderContent() {
    // Startsökningen ligger inne i #content och skulle rivas vid varje
    // bakgrundsomritning (t.ex. när ny cupdata eller väder blir klart).
    // Ersätt inte en fokuserad input alls: programmatisk återfokusering på
    // den nya noden är inte tillräcklig på mobil, där tangentbordet ändå
    // kan fällas ned. Omritningen tas igen av blur-lyssnaren nedan.
    if (captureSchemaSearchFocus()) { syncUrl(); return; }
    renderContentBody();
    renderMobileContextBar();
    reconcilePickerChrome();
    syncUrl();
    revealSelectedSubmenuItem();
  }

  // Klassnamn ur ett kategori-id, för orienteringsraden nedan.
  function catNameById(id) {
    const m = allActiveMatches().find((x) => x.catId === id);
    return m ? HB.shortCat(m.catName) : null;
  }

  // Vad vyn är avsmalnad till, i ord. Sammanfattar samma sak som
  // activeFilterCount räknar, men läsbart — "Alingsås HK Blå · P13" i
  // stället för en siffra.
  // Klasser och lag som EN uppräkning, med laget under sin klass:
  // "P13 (AHK 1, AHK 2)". Var för sig ("AHK 1, AHK 2 · P13, F13") gick det
  // inte att se vilket lag som låg i vilken klass — och just den kopplingen
  // är hela poängen med att visa urvalet i en enda rad.
  function filterSelectionText() {
    if (!state.teams.size && !state.cats.size) return "";
    const grupper = new Map();
    const grupp = (id, namn) => {
      if (!grupper.has(id)) grupper.set(id, { namn, lag: [] });
      const g = grupper.get(id);
      // Klassnamnet kan komma från antingen hållet: valda klasser slås upp
      // direkt, lagens klass följer med laguppslaget.
      if (!g.namn && namn) g.namn = namn;
      return g;
    };
    // Valda klasser först, så ordningen följer menyn och inte lagens.
    for (const id of state.cats) grupp(id, catNameById(id));
    let okändaLag = 0;
    for (const id of state.teams) {
      const info = teamInfoById(id);
      if (info) grupp(info.catId, info.catName).lag.push(info.name);
      else okändaLag++;
    }
    const delar = [...grupper.values()].filter((g) => g.namn || g.lag.length);
    // Kort urval skrivs ut, långt räknas. Fyra namn är ungefär vad som ryms
    // på en rad innan den kapas med ellips ändå; ett lag som inte gick att
    // slå upp (t.ex. ett annat år som inte hämtats) gör uppräkningen
    // missvisande och faller därför också tillbaka på siffror.
    const antalNamn = delar.reduce((n, g) => n + (g.namn ? 1 : 0) + g.lag.length, 0);
    if (!okändaLag && antalNamn && antalNamn <= 4) {
      return delar.map((g) => {
        if (!g.lag.length) return g.namn;
        const lag = g.lag.join(", ");
        return g.namn ? g.namn + " (" + lag + ")" : lag;
      }).join(" · ");
    }
    const summa = [];
    if (grupper.size) summa.push(grupper.size + (grupper.size === 1 ? " klass" : " klasser"));
    if (state.teams.size) summa.push(state.teams.size + " lag");
    return summa.join(" · ");
  }

  function filterSummaryText() {
    const bits = [];
    const urval = filterSelectionText();
    if (urval) bits.push(urval);
    if (state.arena) bits.push(state.arena);
    if (state.days.size) bits.push(state.days.size + (state.days.size === 1 ? " dag" : " dagar"));
    if (state.q) bits.push("\u201d" + state.q + "\u201d");
    if (state.matchFilter !== "all") {
      bits.push(state.matchFilter === "upcoming" ? "kommande" : "spelade");
    }
    return bits.join(" · ");
  }

  // Vägen tillbaka, BARA på mobil. Klick på hall, lag eller grupp i ett
  // matchkort byter tyst ut hela filtret (gotoTeamMatches m.fl.) — på dator
  // ser man det direkt i verktygsraden, som dessutom har en "Tillbaka till
  // din vy"-chip. På mobil ligger den raden gömd bakom Filter-knappen, så
  // man landade i en avsmalnad vy utan att se hur man tog sig ur den.
  //
  // Raden visas numera BARA när det finns ett undanstoppat filter att gå
  // tillbaka till. Att den också sammanfattade helt vanlig filtrering hörde
  // till tiden då menyn låg i botten: hade man scrollat ned syntes inget av
  // filtret. Nu står Filter-knappen kvar i toppen med sin siffra hela tiden,
  // och en extra ruta som upprepade den åt bara läsyta.
  function renderMobileContextBar() {
    const main = $("#content");
    const gammal = main.querySelector(":scope > .mobile-context");
    if (gammal) gammal.remove();
    if (!sheetMode() || state.view === "stats" || chrome.settingsViewOpen) return;
    if (!stashedFilter) return;
    main.prepend(h("div", { class: "mobile-context" },
      h("button", {
        class: "mobile-context-back", type: "button",
        onclick: () => restoreStashedFilter(),
      }, "\u2190 Tillbaka"),
      h("span", { class: "mobile-context-text" },
        filterSummaryText() || "Filtrerad vy")));
  }

  function renderContentBody() {
    const main = $("#content");
    // Kandidatnamn i slutspel roterar, men gamla intervall ska inte leva
    // vidare tills var och en själv upptäcker en bortmonterad DOM-nod.
    clearPlayoffCandidateTimers();
    // På mobil bor samma dialognod tillfälligt som en vanlig innehållsvy.
    // Flytta tillbaka den före varje omritning så replaceChildren() aldrig
    // kastar bort den (och därmed alla lyssnare som setupSettings satt).
    const embeddedSettings = main.querySelector(":scope > #settingsDialog.settings-view");
    if (embeddedSettings) {
      embeddedSettings.classList.remove("settings-view");
      embeddedSettings.removeAttribute("open");
      document.body.append(embeddedSettings);
    }
    main.replaceChildren();
    const selectionBar = $("#currentSelectionBar");
    if (selectionBar) {
      const wasVisible = !selectionBar.hidden;
      selectionBar.replaceChildren(); selectionBar.hidden = true;
      if (wasVisible) requestAnimationFrame(syncBottomStack);
    }
    $("#desktopSubNav .desktop-selection-group")?.remove();
    // Städa en eventuell övergiven kartinstans så fort vi INTE ska rita
    // Karta just nu — se destroyMapIfLeavingKarta()s kommentar för varför
    // (misstänkt Chrome-specifik scrollåsning på HELT andra flikar).
    if (!(state.view === "stats" && state.statsView === "karta")) destroyMapIfLeavingKarta();
    // Samma sak för Bana-vyns egen kartinstans (se createArenaMap) — den
    // rivs så fort vi INTE ritar Bana, annars ligger en osynlig MapLibre-
    // instans kvar och äter minne/WebGL-kontext på alla andra flikar.
    if (state.view !== "bana") destroyArenaMap();
    if (chrome.settingsViewOpen && sheetMode()) {
      const dlg = $("#settingsDialog");
      dlg.classList.add("settings-view");
      dlg.setAttribute("open", "");
      main.append(dlg);
      return;
    }
    // Stats (Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper) bygger uteslutande
    // på det arkiverade data/archive/index.json (plus klubbadresser för
    // Karta) — beror INTE på om innevarande upplaga hunnit publicera ett
    // schema än, så den måste renderas innan bannern nedan ("inget schema
    // publicerat") annars skulle blockera den i onödan.
    if (state.view === "stats") { renderStatsView(main); return; }
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
    // allActiveMatches() (inte bara state.matches) — en cup vars LIVE-
    // upplaga saknar publicerat schema kan ändå ha arkiverade tidigare år
    // ikryssade i årsväljaren (se renderToolbar); bannern ska bara visas
    // om det inte finns NÅGOT att visa alls, inte bara att just innevarande
    // upplaga råkar sakna schema än.
    if (!allActiveMatches().length && !state.loading && !state.error) {
      // Rutan sa tidigare bara att schemat saknas, och Schema-fliken lade
      // dessutom sin egen "välj klass, lag eller plan under Filter" ovanpå —
      // en instruktion som pekar på en TOM filterremsa när cupen inte har
      // några matcher. Man följde den, ingenting hände, och appen såg trasig
      // ut. Nu står i stället när datan senast hämtades (så man ser att appen
      // fungerar och letat) plus en väg vidare till en annan cup. Gäller
      // alla flikar, inte bara Schema.
      const hamtad = state.loadedAt
        ? "Senast hämtat " + fmtDayLong.format(new Date(state.loadedAt)) +
          " " + fmtClock.format(new Date(state.loadedAt))
        : null;
      main.append(h("div", { class: "banner" },
        h("p", null, cup().name + " har inte publicerat något spelschema ännu."),
        hamtad ? h("p", { class: "muted" }, hamtad) : null,
        h("button", {
          class: "btn", type: "button",
          onclick: () => { toggleFilterSheet(false); $("#currentCupBtn").click(); },
        }, "Byt cup")));
      return;
    }
    if (state.view === "schema") renderSchema(main);
    else if (state.view === "slutspel") renderPlayoffs(main);
    else if (state.view === "bana") renderArenaView(main);
    else renderTables(main);
  }

  const SPORT_LABELS = {
    handboll: "Handboll",
    fotboll: "Fotboll",
    innebandy: "Innebandy",
    basket: "Basket",
    volleyboll: "Volleyboll",
  };

  // Vilken sport cupväljaren i inställningar just nu VISAR — skilt från
  // innevarande cups egen sport (state.cupId/cup().sport), så man kan bläddra
  // bland t.ex. fotbollscuper utan att först behöva byta aktiv cup. null =
  // följ innevarande cups sport (förvalet, nollställs varje gång dialogen
  // öppnas, se openSettings). Modulnivå, inte state — rent UI-tillstånd för
  // själva dialogen, inget att spara mellan besök.
  let cupSwitcherSport = null;

  // Sökningen i cupväljaren går över alla sporter så länge man skriver.
  // Minst förvånande: arrangören letar efter sitt namn/sin ort, inte efter
  // vilken sport-flik som råkar vara aktiv — "göteborg" ska lämna både
  // handbolls- och fotbollscuperna, och "sundsvall" ska gå att välja även
  // om handboll är förvalt. Sportväljaren följer INTE med automatiskt
  // (fliken skulle hoppa medan man skriver). Den fungerar som i dag när
  // fältet är tomt, och avgränsar träffarna om man klickar den under en
  // pågående sökning (annars vore knapparna döda). false efter sådant klick,
  // true igen vid nästa tecken / när dialogen öppnas.
  let cupSearchAllSports = true;

  function paintCupPicker(sportToggleEl, searchEl, row, emptyEl, onSelect) {
    const allCups = HB.allCups();
    // En sportväljare bara om det faktiskt FINNS mer än en sport bland
    // cuperna — annars bara ett meningslöst extra klick för alla som bara
    // någonsin kör handboll.
    const sports = [...new Set(allCups.map((c) => c.sport || "handboll"))];
    const activeSport = cupSwitcherSport || cup().sport || "handboll";
    if (sportToggleEl) {
      sportToggleEl.hidden = sports.length < 2;
      sportToggleEl.replaceChildren(
        ...sports.map((sp) => chip(SPORT_LABELS[sp] || sp, sp === activeSport, () => {
          cupSwitcherSport = sp;
          cupSearchAllSports = false;
          paintCupPicker(sportToggleEl, searchEl, row, emptyEl, onSelect);
        })));
    }

    // Filtrera bara kortcontainern. Sökfältet är en separat nod i arket,
    // så replaceChildren nedan river inte inputen eller dess mobilfokus.
    const query = slugifySv(searchEl && searchEl.value);
    const cups = allCups.filter((c) => {
      if ((!query || !cupSearchAllSports) &&
          (c.sport || "handboll") !== activeSport) return false;
      if (!query) return true;
      return slugifySv(c.name).includes(query) ||
             slugifySv(c.place).includes(query);
    });

    if (!row) return;
    row.replaceChildren(
      ...cups.sort((a, b) => (b.id === state.cupId) - (a.id === state.cupId)).map((c) =>
        h("button", {
          class: "cup" + (c.id === state.cupId ? " on" : ""),
          type: "button", onclick: () => onSelect(c.id),
        },
          h("span", { class: "cup-name" }, c.name),
          h("span", { class: "cup-place" }, c.place + " " + c.edition))
      ));
    row.hidden = cups.length === 0;
    if (emptyEl) emptyEl.hidden = cups.length > 0;
  }

  function renderCups() {
    // Headerns kontextrad visar redan vald cup. Den separata desktopknappen
    // ska vara en tydlig handling utan att upprepa ett potentiellt långt namn.
    const btn = $("#currentCupBtn");
    if (btn) {
      btn.textContent = "Byt cup";
      btn.title = "Byt cup (" + cup().name + ")";
      btn.setAttribute("aria-label", "Byt cup. Nu vald: " + cup().name);
    }
    const label = $("#currentCupLabel");
    if (label) {
      label.textContent = cup().name;
      label.title = "Byt cup (" + cup().name + ")";
      label.setAttribute("aria-label", "Byt cup. Nu vald: " + cup().name);
    }
  }

  function openCupPickerDialog() {
    // På mobil är #currentCupBtn dold; cupnamnet i headern är den synliga
    // kontrollen. På dator är det den utskrivna "Byt cup"-knappen.
    const anchor = sheetMode() ? $("#currentCupLabel") : $("#currentCupBtn");
    const shell = prototypeDialog("Välj cup", "cup", anchor);
    if (!shell) return;
    const { dlg, body } = shell;
    cupSwitcherSport = null;
    cupSearchAllSports = true;
    const sports = h("div", { class: "seg cup-picker-sports", role: "group",
      "aria-label": "Sport" });
    const input = h("input", { class: "search global-search-input", type: "search",
      placeholder: "Sök cup eller ort …", autocomplete: "off", "aria-label": "Sök cup" });
    const row = h("nav", { class: "cup-picker-row", "aria-label": "Välj cup" });
    const empty = h("p", { class: "muted cup-search-empty", hidden: "", role: "status" },
      "Ingen cup matchar sökningen.");
    const paint = () => paintCupPicker(sports, input, row, empty, (id) => {
      dlg.close();
      switchCup(id);
    });
    input.addEventListener("input", () => {
      cupSearchAllSports = true;
      paint();
    });
    body.append(sports, withClearButton(input), row, empty);
    paint();
    requestAnimationFrame(() => input.focus());
  }

  function renderTabs() {
    // Slutspelsdata finns för Cup Manager-cuper och de dataUrl-cuper vars
    // skrapa faktiskt bygger en playoffs-struktur (cup.hasPlayoffs, se
    // scripts/fetch_gothia.py) — INTE ProCup (fetch_procup.py stödjer det
    // inte än).
    const playoffsSupported = !cup().dataUrl || !!cup().hasPlayoffs;
    if (!playoffsSupported && state.view === "slutspel") state.view = "schema";
    // Trend kräver minst två arkiverade år för INNEVARANDE cup (samma
    // tröskel som formkurvans "kan inte visas"-meddelande) — arkivindexet
    // laddas asynkront (se init()) och kan alltså vara null första gången
    // renderTabs() körs.
    const archiveEntry = state.archiveIndex && state.archiveIndex[state.cupId];
    const trendSupported = ((archiveEntry && archiveEntry.editions) || [])
      .filter((e) => e.matches > 0).length >= 2;
    // Karta kräver klubbadresser: klassiska Cup Manager-cuper har egen
    // sådan direkt, ProCup/Gothia-cuper gissar sin via klubbkatalogen (se
    // clubGeoFromMatches/ensureCupClubGeo) — båda vägarna är asynkrona
    // (till skillnad från tidigare då bara cup().dataUrl avgjorde direkt).
    // En cup vars INNEVARANDE upplaga ännu inte publicerat något (t.ex.
    // Lundaspelen inför en ny säsong — se samma resonemang i renderToolbar/
    // renderContent) kan ändå ha gott om arkiverad historik att visa via
    // Kartans årsväljare — räcker därför att ANTINGEN live-data ELLER minst
    // ett spelat arkiverat år finns, annars göms fliken helt i onödan trots
    // att det finns massor att titta på.
    ensureCupClubGeo(state.cupId);
    const mapKnown = state.mapCupStatus[state.cupId] === "done";
    const mapHasArchive = ((archiveEntry && archiveEntry.editions) || []).some((e) => e.matches > 0);
    const mapSupported = Object.keys(HB.api.clubGeo[state.cupId] || {}).length > 0 || mapHasArchive;
    // Klubb/Lag, Klubbjämförelse och Cuper kräver alla bara "NÅGON cup
    // NÅGONSTANS har minst ett spelat arkiverat år" — samma villkor,
    // eftersom alla tre bygger direkt på state.archiveIndex.
    const clubSupported = !!state.archiveIndex && Object.values(state.archiveIndex)
      .some((c) => (c.editions || []).some((e) => e.matches > 0));
    // Stats samlar Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper som under-
    // flikar (se STATS_TABS/renderStatsView) — sparas här så renderStatsView
    // slipper räkna om samma (delvis asynkrona) stöd själv. Fliken syns så
    // fort NÅGON underflik har stöd; själva underflikväxlingen/nedgraderingen
    // (om just den valda underfliken blir ogiltig) sköts av renderStatsView.
    state.statsSupport = {
      trend: trendSupported, karta: mapSupported,
      vinnare: clubSupported, kalender: clubSupported,
      klubb: clubSupported, klubbjamforelse: clubSupported, cuper: clubSupported,
      historik: clubSupported,
    };
    const statsSupported = trendSupported || mapSupported || clubSupported;
    // Vänta tills BÅDA de asynkrona källorna (archiveIndex, mapCupStatus)
    // svarat innan ett direktlänkat view=stats/underflik nollställs — samma
    // "vänta tills vi vet säkert"-resonemang som Trend/Karta hade var för sig
    // innan de slogs ihop. Klubbadressen (mapCupStatus) hinner ofta bli klar
    // FÖRE arkivindexet (litet cup-specifikt snapshot-anrop vs det stora
    // gemensamma index.json) — utan denna "known"-spärr skulle renderStatsView
    // annars kunna hinna se "bara Karta stödd än så länge" under en enda
    // mellanliggande omritning och permanent byta bort en direktlänkad/sparad
    // underflik till Karta i onödan (se dess kommentar).
    state.statsKnown = !!state.archiveIndex && mapKnown;
    if (state.statsKnown && !statsSupported && state.view === "stats") {
      state.view = "schema";
    }
    $$("#viewTabs .tab").forEach((b) => {
      const isPlayoffTab = b.dataset.view === "slutspel";
      const isStatsTab = b.dataset.view === "stats";
      b.hidden = (isPlayoffTab && !playoffsSupported) || (isStatsTab && !statsSupported);
      b.classList.toggle("on", b.dataset.view === state.view);
      b.setAttribute("aria-selected", String(b.dataset.view === state.view));
    });
    renderBottomBar();
  }

  // Meny, ark och verktygsrad bor i js/ui/. Initiera här, efter att
  // state/persist finns, så render/saveUi kan injiceras utan cirkulär import.
  initShare({
    state, cup, persist, filtered, sorted, isClubName, isFavoriteTeam,
    calendarWebcalUrl, buildViewUrlParams,
    groupPlayoffRounds, ensurePlayoffs, ensureCupArenaGeo,
    divisionsToShow, categoriesToShow,
  });
  initMatchUi({
    state, cup, render, renderContent, saveSettings, markClubChosen,
    renderFavoriteTeamList, isClubName, isClubMatch, isFavoriteTeam,
    favoriteTeamIndex, teamColor, cardTintColor, calendarWebcalUrl, rosterFor,
    computeGroupTableRows,
    gotoTeamMatches, filterByArena, playoffPlacementForTeam, svOrdinal,
    playoffGroupReference, ensureGroupTables, scoped,
    allActiveMatches, outcomeLetter, slugifySv,
  });
  initReveal({
    setAutoScrolled: setSchemaAutoScrolled,
    isSchemaView: () => state.view === "schema",
  });
  initPlayoffs({
    state, cup, saveUi, saveSettings, render, renderContent, scoped, filtered,
    hasFilterSelection, matchesSearchQuery, matchesViewFilter,
    isClubName, isClubMatch, isFavoriteTeam, computeGroupTableRows,
    allActiveMatches, chip, openMatchDialog, openTeamQuickView,
    matchTimeLabel, scoreText, isLive, hasScheduledStart, sheetMode,
    slugifySv, cohortKey, shortCat, gotoTeamMatches,
  });
  initSchema({
    state, cup, saveUi, render, renderContent, filtered, sorted, scoped,
    hasFilterSelection, isClubMatch, isFavoriteTeam, allActiveMatches,
    matchesViewFilter, clearViewFilters, outcomeRank, ensureMapLibre,
    getBracketSort, setBracketSort,
  });
  initMap({
    HB, state, cup, saveUi, render, renderContent, renderToolbar,
    buildPicker, chip, withClearButton, scheduleArchiveRender, ensureYearMatches,
    slugifySv, isClubName, isFavoriteTeam, renderTabs,
  });
  initStats({
    HB, state, cup, saveUi, saveSettings, render, renderContent,
    renderFavoriteTeamList, ensureYearMatches, switchCup, syncUrl,
    isClubName, favoriteTeamIndex, scoreUnit, SPORT_LABELS,
  });
  initNav({
    persist, storageGet, state, render, saveUi, cup, filterSummaryText,
    getStatsTabs,
    openHeaderExportDialog,
  });
  initToolbar({
    saveUi, render, renderContent, state, cup,
    ensureArchiveEditions, ensureYearMatches, clubTeams, scoped, allScopedTeams,
    isFilterLocked, hasLockableSelection,
    teamNameById, buildExportPicker, buildViewFilterRow,
    clearViewFilters, scoreUnit, syncUrl, refreshFilterChrome,
    restoreStashedFilter, hasStashedFilter: () => !!stashedFilter,
  });
  initSheets({ persist, storageGet, state, render, renderToolbar, renderBottomBar });

  function renderMeta() {
    // Knappen ger tydlig feedback medan versionsindexet kontrolleras och,
    // bara vid en ny version, den större snapshotfilen hämtas.
    const btn = $("#refreshBtn");
    if (btn) {
      btn.disabled = state.loading;
      btn.textContent = state.loading ? "↻ Kontrollerar …" : "↻ Kontrollera senaste";
    }
    const settingsRefreshBtn = $("#settingsRefreshBtn");
    if (settingsRefreshBtn) {
      settingsRefreshBtn.disabled = state.loading;
      settingsRefreshBtn.textContent = state.loading ? "↻ Kontrollerar schema …" : "↻ Kontrollera senaste";
    }
    const el = $("#meta");
    el.replaceChildren();
    if (!state.loadedAt) return;
    const visibleMatches = scoped();
    const n = visibleMatches.length;
    const timed = visibleMatches.filter((m) => m.start).length;
    const untimed = n - timed;
    const dataTs = HB.api.localDataTs[state.cupId];
    // Har liveifyllnaden hämtat ett färskare resultat än snapshotten är
    // det DEN tidsstämpeln som gäller — annars ser appen ut att visa
    // gammal data samtidigt som ställningen tickar.
    const live = state.liveFilledAt > (dataTs || 0);
    const when = new Date(live ? state.liveFilledAt : (dataTs || state.loadedAt));
    // Visa datum om tidsstämpeln inte är idag — annars ser t.ex. en sedan
    // länge avslutad cups "12:10" ut som idag fastän datan hämtades för
    // flera dagar sen (det som förvirrade här).
    const sameDay = when.toDateString() === new Date().toDateString();
    const fmt = sameDay ? fmtClock : new Intl.DateTimeFormat("sv-SE",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const matchLabel = untimed
      ? timed + " tidsatta matcher · " + untimed + " utan tid"
      : n + " matcher";
    const label = (live ? "Live " : dataTs ? "Data hämtad " : "Uppdaterad ") +
      fmt.format(when) + " · " + matchLabel;
    // Klickbar — öppnar en logg över exakt VILKA matcher som räknas in i
    // antalet ovan (samma urval, scoped(), se openMatchLogDialog).
    el.append(h("button", {
      class: "meta-link", type: "button", title: "Visa vilka matcher som räknas i antalet (inte en ändringslogg)",
      onclick: openMatchLogDialog,
    }, label));
    if (state.loading) el.append(" · kontrollerar gemensamt schema …");
  }

  // --- matchdialog: lagstatistik + snabblänkar --------------------------------

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
      view: state.view,
      scope: state.scope, days: new Set(state.days), cats: new Set(state.cats),
      teams: new Set(state.teams), years: new Set(state.years),
      viewCats: new Set(state.viewCats), viewTeams: new Set(state.viewTeams),
      arena: state.arena, viewArena: state.viewArena, q: state.q,
      matchFilter: state.matchFilter, sort: state.sort, timeOrder: state.timeOrder,
      schemaSelectionKey: state.schemaSelectionKey,
      tableGroupKey: state.tableGroupKey,
      playoffCatTab: state.playoffCatTab,
      schemaShowAllCup: state.schemaShowAllCup,
      scrollY: window.scrollY,
    };
  }

  function restoreStashedFilter() {
    if (!stashedFilter) return false;
    const previous = stashedFilter;
    state.view = previous.view || "schema";
    state.scope = previous.scope;
    state.days = new Set(previous.days);
    state.cats = new Set(previous.cats);
    state.teams = new Set(previous.teams);
    state.years = new Set(previous.years || []);
    state.viewCats = new Set(previous.viewCats || []);
    state.viewTeams = new Set(previous.viewTeams || []);
    state.arena = previous.arena;
    state.viewArena = previous.viewArena || "";
    state.q = previous.q || "";
    state.matchFilter = previous.matchFilter;
    state.sort = previous.sort;
    state.timeOrder = previous.timeOrder || "asc";
    state.schemaSelectionKey = previous.schemaSelectionKey || "all";
    state.tableGroupKey = previous.tableGroupKey || "all";
    state.playoffCatTab = previous.playoffCatTab == null ? null : previous.playoffCatTab;
    state.schemaShowAllCup = !!previous.schemaShowAllCup;
    stashedFilter = null;
    saveUi();
    render();
    requestAnimationFrame(() => window.scrollTo({ top: previous.scrollY || 0, behavior: "auto" }));
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

  // Ett lag hör alltid till en klass, och matchen bär båda — samma uppslag
  // ger därför namnet och klassen på en gång (se filterSelectionText).
  function teamInfoById(id) {
    const m = allActiveMatches().find((mm) => mm.home.id === id || mm.away.id === id);
    if (!m) return null;
    return {
      name: m.home.id === id ? m.home.name : m.away.name,
      catId: m.catId,
      catName: m.catName ? HB.shortCat(m.catName) : null,
    };
  }

  function teamNameById(id) {
    const info = teamInfoById(id);
    return info ? info.name : null;
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

  // Räknar fram gruppställning (S/V/O/F/mål/poäng) från matchresultat för
  // EN division — cupens egen slutgiltiga tabell arkiveras inte (bara
  // matcherna), så det här är en lokal, förenklad rekonstruktion med
  // sportens normala poängmodell — kan skilja sig
  // från originalets exakta regler vid t.ex. inbördes möte-särskiljning.
  // Används av ensureTable() (Tabeller-fliken, även extra inblandade år)
  // och matchdialogen via injicering.
  function computeGroupTableRows(divMatches) {
    return tableRowsForGroup(divMatches, (cup() && cup().sport) || "handboll");
  }

  function setupSettings() {
    const dlg = $("#settingsDialog");

    const clubInput = $("#favoriteClubInput");
    clubInput.value = state.favoriteClub;
    const applyFavoriteClub = () => {
      const v = clubInput.value.trim();
      state.favoriteClub = v || HB.CLUB.name;
      clubInput.value = state.favoriteClub;
      markClubChosen();
      saveSettings();
      render();
    };
    clubInput.addEventListener("change", applyFavoriteClub);
    attachAutocomplete($("#favoriteClubInput"), $("#favoriteClubOptions"),
      clubNameCandidates, applyFavoriteClub);
    $("#favoriteClubClear").addEventListener("click", () => {
      clubInput.value = ""; applyFavoriteClub(); clubInput.focus();
    });

    // Sökfältet LÄGGER TILL i listan i stället för att hålla ett värde —
    // därför töms det efter varje val, och de valda lagen visas som chips
    // under (renderFavoriteTeamList).
    const teamInput = $("#favoriteTeamInput");
    const addFavoriteTeam = (picked) => {
      const name = (typeof picked === "string" ? picked : (picked && picked.name) || "").trim();
      if (!name) { teamInput.value = ""; return; }
      const cohort = typeof picked === "string" ? null : (picked.cohort || null);
      if (favoriteTeamIndex(name, cohort) < 0) state.favoriteTeams.push({ name, cohort });
      teamInput.value = "";
      saveSettings();
      renderFavoriteTeamList();
      render();
    };
    // Fritext (utan att välja ur listan) räknas också — men bara på Enter,
    // annars skulle varje halvskrivet ord bli ett favoritlag.
    teamInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && teamInput.value.trim()) {
        e.preventDefault();
        addFavoriteTeam(teamInput.value.trim());
      }
    });
    attachAutocomplete($("#favoriteTeamInput"), $("#favoriteTeamOptions"),
      favoriteTeamCandidates, addFavoriteTeam);
    $("#favoriteTeamClear").addEventListener("click", () => {
      teamInput.value = ""; teamInput.focus();
    });
    renderFavoriteTeamList();

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

    const paletteBtns = $$("#paletteSeg [data-palette-opt]");
    const syncPaletteBtns = () => {
      paletteBtns.forEach((b) => {
        const vald = (b.dataset.paletteOpt || "") === (state.palette || "");
        b.classList.toggle("on", vald);
        b.setAttribute("aria-checked", String(vald));
        // Provet målas från knappens egna data-attribut i stället för av en
        // regel per palett: lägger man till en palett i CSS:en räcker det
        // att lägga till knappen med sina fyra färger.
        b.style.setProperty("--sw-paper", b.dataset.pPaper);
        b.style.setProperty("--sw-card", b.dataset.pCard);
        b.style.setProperty("--sw-accent", b.dataset.pAccent);
        b.style.setProperty("--sw-mark", b.dataset.pMark);
      });
    };
    syncPaletteBtns();
    paletteBtns.forEach((b) => b.addEventListener("click", () => {
      state.palette = b.dataset.paletteOpt || "";
      applyTheme();
      saveSettings();
      syncPaletteBtns();
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
      state.playoffView = advTableBox.checked ? "table" : "tree";
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

    const pathBox = $("#playoffPathToggle");
    if (pathBox) {
      pathBox.checked = state.showPlayoffPath;
      pathBox.addEventListener("change", () => {
        state.showPlayoffPath = pathBox.checked;
        saveSettings();
        renderContent();
      });
    }

    const upcomingCarouselBox = $("#upcomingCarouselToggle");
    upcomingCarouselBox.checked = state.showUpcomingCarousel;
    upcomingCarouselBox.addEventListener("change", () => {
      state.showUpcomingCarousel = upcomingCarouselBox.checked;
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
    const matchMinAutoBox = $("#matchMinutesAutoToggle");
    const matchMinHint = $("#matchMinutesHint");
    // Cupens matchlängd kan bara läsas av när dess schema är laddat, så
    // rutan fylls i när inställningarna öppnas — inte en gång vid start.
    const syncMatchMinutes = () => {
      const härledd = derivedMatchMinutes();
      matchMinAutoBox.checked = state.matchMinutesAuto;
      matchMinInput.value = state.matchMinutes;
      matchMinInput.disabled = state.matchMinutesAuto && !!härledd;
      matchMinHint.textContent = !härledd
        ? "Den här cupens data räcker inte till för att läsa av " +
          "matchlängden — ange den själv."
        : härledd.källa === "speltid"
          ? "Cupen anger " + härledd.minuter + " minuter per match " +
            "(speltid inklusive halvlek)."
          : "Cupen anger ingen speltid. " + härledd.minuter + " minuter är " +
            "avståndet mellan avsparkarna på samma plan — speltid plus " +
            "halvlek och tid för nästa lag att ställa upp.";
    };
    syncMatchMinutes();
    matchMinInput.addEventListener("change", () => {
      state.matchMinutes = Math.max(5, +matchMinInput.value || 30);
      saveSettings();
      syncMatchMinutes();
      renderContent();
    });
    matchMinAutoBox.addEventListener("change", () => {
      // Läs av gällande längd FÖRE bytet: avbockad ska behålla det
      // avlästa värdet som utgångspunkt i stället för att kasta tillbaka
      // användaren till ett gammalt manuellt tal.
      const gällande = state.matchMinutes;
      state.matchMinutesAuto = matchMinAutoBox.checked;
      if (!state.matchMinutesAuto) state.matchMinutesManual = gällande;
      saveSettings();
      syncMatchMinutes();
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
      syncMatchMinutes();
      advTableBox.checked = state.playoffView === "table";
      projBox.checked = state.showPlayoffProjection;
      if (pathBox) pathBox.checked = state.showPlayoffPath;
      upcomingCarouselBox.checked = state.showUpcomingCarousel;
      // Favoritklubb/-lag väljs ur data som inte hör till den öppna cupen
      // (klubbkatalogen och arkivets lagnamnsindex, se clubNameCandidates/
      // favoriteTeamCandidates). Båda hämtas lat och en gång — starta dem
      // här så de finns när man börjar skriva, i stället för att listan ska
      // vara tom just i en cup som inte publicerat sina lag än.
      ensureClubDirectory();
      ensureTeamIndex();
      chrome.settingsReturnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      // En modal <dialog> hamnar i webbläsarens topplager och täcker därför
      // alltid den fasta menyn, oavsett z-index. På mobil visas
      // inställningar som en helskärmsvy under navigationslagret.
      if (sheetMode()) {
        chrome.settingsViewOpen = true;
        // Inställningar är en undersida till Mer. Behåll därför Mer-raden
        // synlig och markera Inställningar där, i stället för att släcka
        // vägen tillbaka till Cup/Export/Hjälp/Om.
        chrome.moreMenuOpen = true;
        chrome.currentMenuOpen = false;
        chrome.statsMenuOpen = false;
        closeSubmenuOverlays();
        render();
        window.scrollTo({ top: 0, behavior: "auto" });
        requestAnimationFrame(() => $("#settingsClose").focus({ preventScroll: true }));
      } else dlg.showModal();
    };
    $("#settingsBtn").addEventListener("click", openSettings);
    HB.openSettings = openSettings;
    $("#currentCupBtn").addEventListener("click", openCupPickerDialog);
    const cupLabel = $("#currentCupLabel");
    if (cupLabel) cupLabel.addEventListener("click", openCupPickerDialog);
    $("#settingsClose").addEventListener("click", () => dlg.close());
    // Samma städning oavsett om dialogen stängs med X, Escape, klick på
    // desktop-bakgrunden eller close() från annan navigation. Det hindrar
    // settingsViewOpen från att bli kvar och rita tillbaka en "låst" vy.
    dlg.addEventListener("close", () => {
      const wasEmbedded = chrome.settingsViewOpen;
      chrome.settingsViewOpen = false;
      if (wasEmbedded) {
        chrome.moreMenuOpen = false;
        chrome.currentMenuOpen = true;
        render();
      }
      const target = chrome.settingsReturnFocus;
      chrome.settingsReturnFocus = null;
      if (target && target.isConnected) {
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !chrome.settingsViewOpen) return;
      event.preventDefault();
      dlg.close();
    });
    $("#settingsRefreshBtn").addEventListener("click", () => $("#refreshBtn").click());

    placeFooterLinks();

    // Versionsmärke + nödutgång ur en envis service worker-cache. En
    // installerad PWA (eller bara en registrerad SW) kan servera gammalt
    // skal långt efter en driftsättning, och då syns inga rättningar hur
    // många gånger man än laddar om — utan att det märks att det är
    // orsaken. Knappen river SW:n och HELA dess cache; localStorage rörs
    // INTE, så filter, favoritklubb och övriga inställningar överlever.
    const verEl = $("#appVersion");
    if (verEl) verEl.textContent = "Version " + (HB.VERSION || "okänd");

    // Viewport-siffrorna uppdateras medan dialogen är öppen, så man kan
    // scrolla, se adressfältet ändra sig och läsa av vad webbläsaren
    // faktiskt rapporterar. Utan dem går den här klassen av buggar bara att
    // gissa sig till.
    const resetBtn = $("#resetAppBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = "Tömmer …";
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch { /* inget att tömma — ladda om ändå */ }
        // Cache-bust i URL:en: annars kan webbläsarens EGEN HTTP-cache
        // fortfarande servera samma gamla index.html som nyss låg i SW:n.
        const u = new URL(location.href);
        u.searchParams.set("_v", Date.now().toString(36));
        location.replace(u.toString());
      });
    }
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  // --- uppstart ------------------------------------------------------------------

  // Startcup för ett förstabesök: hellre "det som händer nu" än första
  // raden i data/cups.json, vars ordning inte har med kalendern att göra.
  // windows är data/cup-windows.json (byggd av scripts/build_cup_windows.py)
  // — varje cups matchfönster i ms epoch. Väljer i tur och ordning:
  //
  //   1. cup som pågår           — första matchen har startat och sista
  //                                spelades för mindre än ett dygn sedan
  //                                (resultaten kollas ofta dagen efter)
  //   2. annars den tidsmässigt närmaste av senast spelade cup och en cup
  //      som börjar inom två veckor
  //   3. finns ingen historisk cup alls: närmast kommande även längre bort
  //
  // Uppskattade fönster ("est") väljs aldrig: en gissad upplaga utan
  // publicerat schema ger en tom app.
  function pickDefaultCup(windows, now = Date.now()) {
    return pickDefaultCupId(HB.allCups(), windows, now);
  }

  async function init() {
    loadClubLogoLibrary();
    // PWA: relativ sökväg (inte "/sw.js") så det funkar under en undermapp,
    // t.ex. GitHub Pages-projektsidor (callesjoberg.github.io/hboll/).
    if ("serviceWorker" in navigator) {
      try {
        navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
      } catch {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      }
    }

    // Scrolla-till-toppen tänds efter ungefär en halv synlig skärmhöjd.
    const scrollTopBtn = $("#scrollTopBtn");
    document.addEventListener("scroll", () => {
      scrollTopBtn.classList.toggle("visible", window.scrollY >= scrollTopRevealY());
    }, { passive: true });
    scrollTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto" : "smooth",
      });
    });

    // Länkens cup läses redan här, synkront: då vet vi INNAN cups.json ens
    // hämtats om startcupen behöver väljas åt besökaren, och kan hämta
    // cup-windows.json parallellt i stället för i ett andra varv efteråt.
    // Själva valet sker längre ner — pickDefaultCup behöver den skarpa
    // cuplistan, som inte finns än här.
    const params = new URLSearchParams(location.search);
    const urlCup = params.get("cup");
    const windowsPromise = (urlCup || savedCupId) ? null
      : fetch("data/cup-windows.json?_=" + Date.now().toString(36))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null); // utan filen: första cupen i listan, som förr

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
    // &arena=...&sort=...&mf=...&q=... — hela filtret/sorteringen kan delas,
    // liksom underflikarnas egna val (se syncSubViewUrl för hela listan).
    if (urlCup && HB.allCups().some((c) => c.id === urlCup)) {
      state.cupId = urlCup;
    } else if (windowsPromise) {
      const picked = pickDefaultCup(await windowsPromise);
      if (picked) state.cupId = picked;
    }
    // "Har länken något MER än bara cup?" i stället för en uppräkning av
    // nycklar — listan växer med varje ny underflik, och en bortglömd nyckel
    // hade tyst gjort att just den delen av länken tappades till förmån för
    // det som råkade ligga sparat i webbläsaren. (tune tillhör välkomst-
    // överlägget, se js/welcome.js — inte ett vyval.)
    const hasUrlFilters = hasUrlViewParams(params);
    $$("#viewTabs .tab").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.view === "tabeller" && state.view !== "tabeller") {
          state.tableGroupKey = "all";
        }
        chrome.desktopMenuOpen = b.dataset.view === "stats" ? "stats" : "current";
        state.view = b.dataset.view; saveUi(); render();
      }));
    $("#refreshBtn").addEventListener("click", () => loadCup(true));
    $("#headerExportBtn").addEventListener("click", openHeaderExportDialog);
    $("#headerAboutBtn").addEventListener("click", () => HB.openWelcome());
    setupSettings();
    setupBracketPan();
    setupFilterStripScrollMemory();
    setupResponsiveMenuLayout();
    setupMenuAutoCollapse();
    // Välkomstöverlägget (js/welcome.js) visar sig självt en gång för nya
    // besökare — den här knappen (sidfoten) låter vem som helst öppna det
    // igen när de vill. Null-koll (till skillnad från övriga $(...)-anrop
    // här) — en gammal cachad index.html (t.ex. service worker-fallback
    // under en pågående ny driftsättning) som saknar knappen ska aldrig få
    // krascha HELA appens initiering för en så liten sak.
    const welcomeBtn = $("#welcomeReopenBtn");
    if (welcomeBtn) welcomeBtn.addEventListener("click", () => HB.openWelcome());

    // Stäng en öppen lag-dropdown vid klick utanför den. En enda global
    // lyssnare (i stället för en per renderToolbar-anrop) hittar alltid
    // den dropdown som råkar vara monterad just nu. Bakgrundstäckets klick
    // fångas också här: det ligger utanför <details>, så villkoret nedan
    // stänger arket precis som ett klick i matchlistan bakom.
    document.addEventListener("click", (e) => {
      const dd = document.querySelector(".team-picker-dd[open]");
      if (!dd) return;
      // Kryssar man i en post i en LAT lista (>60 val, se
      // PICKER_LAZY_THRESHOLD) bygger change-hanteraren om listan MITT I
      // klickets bubbling — den klickade kryssrutan är då redan borttagen ur
      // DOM:et när den här lyssnaren nås, contains() ger false, och panelen
      // stängdes mitt i ett val. Ett bortkopplat mål betyder att klicket kom
      // inifrån något vi själva just ritat om, alltså inte "utanför".
      if (!e.target.isConnected) return;
      // På mobil är själva panelen portalerad till body (se
      // portalPickerPanel), alltså inte längre ett DOM-barn till <details>.
      // Den tillhör fortfarande väljaren logiskt: utan den kontrollen
      // räknades varje kryss i Klasser som ett klick utanför och arket
      // minimerades efter varje val.
      const portaledPanel = portaledPickerPanels.get(dd);
      if (!dd.contains(e.target) && !(portaledPanel && portaledPanel.contains(e.target))) {
        dd.open = false;
      }
    });
    setupPickerSheets();
    setupViewportOffset();
    enforceMobileMenuHost();
    loadUi();
    updateClubLogo();
    if (hasUrlFilters) {
      // En delad länk vinner över det som råkar ligga sparat i webbläsaren.
      applyUrlToState(params);
      queueNamedUrlFilters(params);
      saveUi(); // spara den delade vyn som din egen, och normalisera URL:en
    }

    // Bakåt-/framåtknappen: läs tillbaka den strukturella vyn ur URL:en (som
    // syncUrl:s pushState skrev). Nollställ URL-fälten först så inget gammalt
    // filter hänger kvar, och byt cup med cache-nollställning om cupen ändrats.
    window.addEventListener("popstate", () => {
      // Tillfälliga paneler får aldrig överleva en historiknavigering. De
      // använder samma underliggande URL som sidan, så Bakåt kan samtidigt
      // återställa föregående vy/filter utan att lämna en grå hinna ovanpå.
      const openSheet = document.querySelector("dialog.prototype-sheet[open]");
      if (openSheet) openSheet.close();
      if (chrome.settingsViewOpen) {
        chrome.settingsViewOpen = false;
        chrome.moreMenuOpen = false;
        chrome.currentMenuOpen = true;
      }
      const pp = new URLSearchParams(location.search);
      const urlCup = pp.get("cup");
      const cupChange = urlCup && urlCup !== state.cupId && HB.allCups().some((c) => c.id === urlCup);
      applyingPopstate = true;
      resetUrlState();
      if (cupChange) {
        cupGeneration++;
        state.cupId = urlCup;
        state.tables = {}; state.playoffs = {}; state.groupTables = {};
        state.matches = []; state.loadedAt = 0; resetMatchUi(); stashedFilter = null;
        resetSchemaUi(); hasSyncedFreshData = false;
        applyUrlToState(pp);
        queueNamedUrlFilters(pp);
        lastNavSig = navSig();
        loadCup();
      } else {
        applyUrlToState(pp);
        queueNamedUrlFilters(pp);
        if (applyPendingNamedUrlFilters()) saveUi();
        lastNavSig = navSig();
        render();
      }
      applyingPopstate = false;
    });

    navInitialized = true; // härefter pushar strukturella vy-byten en historik-post
    loadCup();

    // Stats-underflikarna Trend/Klubb-Lag/Klubbjämförelse/Cuper behöver
    // arkivindexet för att veta om de ska visas alls (Trend döljs t.ex. om
    // innevarande cup har färre än två arkiverade år) — hämtas en gång,
    // oberoende av loadCup(), samma index.json som ensureArchiveEditions()/
    // Historik redan använder.
    HB.api.fetchArchiveIndex().then((idx) => {
      state.archiveIndex = idx || {};
      renderTabs();
      if (state.view === "stats") render();
    }).catch(() => { state.archiveIndex = {}; renderTabs(); });

    // Kontrollera det lilla versionsindexet efter vytypens TTL. Pågående
    // cuper kontrolleras var tionde minut; framtida/halvpublicerade scheman
    // efter 30 minuter. Storfilen hämtas bara när indexets ts har ändrats.
    const autoRefreshDue = () => {
      const ttl = refreshTtl(state.matches);
      if (!Number.isFinite(ttl) || !state.loadedAt) return false;
      return Date.now() - state.loadedAt > ttl;
    };
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (autoRefreshDue()) loadCup();
      // Liveifyllnaden har sin egen, tätare takt och sin egen paus — den
      // ska köras även när snapshottens TTL inte gått ut.
      liveFill();
    };
    setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    // Nedräkningen i heron tickar utan full omrendering.
    setInterval(tickHeroCountdown, 30000);
    // Matchkortens täthet följer klockan, inte datan: ett kort som närmar
    // sig sin starttid ska fällas ut även om ingen ny data kommit. Egen
    // tickare i stället för en omritning — 600 kort per minut vore både
    // dyrt och skulle slå sönder fokus i aktiva fält.
    setInterval(uppdateraKortTäthet, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
