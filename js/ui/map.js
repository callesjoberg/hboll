/* map.js — Stats-underfliken Karta. */

import { h, $ } from "../dom.js";
import { COUNTRY_CENTROIDS } from "../domain/countries.js";
import {
  matchClubName, clubGeoFromMatches, allClubNamesFromMatches,
  clubCountryFromMatches, teamsAndClassesFromMatches,
} from "../domain/club-match.js";
import { isPlaceholderTeam } from "../domain/placeholder.js";
import { ensureMapLibre } from "./maplibre.js";
import { MAP_SHARED_COLOR, MAP_CUP_COLORS, MULTI_COLOR_PALETTE } from "./palette.js";

let HB, state, cup, saveUi, render, renderContent, renderToolbar;
let buildPicker, chip, withClearButton, scheduleArchiveRender, ensureYearMatches;
let slugifySv, isClubName, isFavoriteTeam, renderTabs;

export function initMap(deps) {
  ({
    HB, state, cup, saveUi, render, renderContent, renderToolbar,
    buildPicker, chip, withClearButton, scheduleArchiveRender, ensureYearMatches,
    slugifySv, isClubName, isFavoriteTeam, renderTabs,
  } = deps);
}

// Hämtar en ANNAN cups (inte nödvändigtvis den just nu aktiva) klubbdata
// direkt ur dess CI-byggda snapshot — helt fristående från loadCup()/
// huvudappens matchdata, så att Karta kan visa flera cuper samtidigt utan
// att byta vilken cup som är "aktiv" i headern. state.mapCupStatus
// (session, sparas ej) förhindrar dubbletthämtningar.
export function ensureCupClubGeo(cupId, providedMatches) {
  if (HB.api.clubGeo[cupId] || state.mapCupStatus[cupId]) return;
  state.mapCupStatus[cupId] = "loading";
  const done = (geo, allClubs, teamCount, classes, countryByClub) => {
    HB.api.clubGeo[cupId] = geo;
    state.mapCupAllClubs[cupId] = allClubs;
    state.mapCupTeamCount[cupId] = teamCount;
    state.mapCupClasses[cupId] = classes;
    state.mapCupCountryByClub[cupId] = countryByClub;
    state.mapCupStatus[cupId] = "done";
    // renderTabs() alltid — kan avgöra om Stats-fliken ska visas/döljas nu
    // när vi vet säkert. render() (dyrare, ritar om hela sidan) bara om
    // man faktiskt står på Karta-underfliken just nu.
    renderTabs();
    if (state.view === "stats" && state.statsView === "karta") render();
  };
  const c = HB.allCups().find((x) => x.id === cupId);
  if (c && c.dataUrl) {
    // ProCup/Gothia: ingen egen adressdata alls — gissa via namnmatchning
    // mot klubbkatalogen i stället för att bara visa en tom karta.
    Promise.all([
      providedMatches
        ? Promise.resolve({ matches: providedMatches })
        : HB.api.fetchSharedSnapshot(c, 0),
      HB.api.fetchClubDirectory(),
    ]).then(([data, directory]) => {
      const matches = (data && data.matches) || [];
      const { teamCount, classes } = teamsAndClassesFromMatches(matches);
      done(clubGeoFromMatches(matches, directory || {}), allClubNamesFromMatches(matches, directory || {}),
        teamCount, classes, clubCountryFromMatches(matches, directory || {}));
    }).catch(() => done({}, new Set(), 0, new Set(), new Map()));
    return;
  }
  HB.api.fetchSharedSnapshot(c, 0)
    .then((j) => {
      const matches = j.matches || [];
      const { teamCount, classes } = teamsAndClassesFromMatches(matches);
      done((j && j.clubs) || {}, allClubNamesFromMatches(matches), teamCount, classes,
        clubCountryFromMatches(matches));
    })
    .catch(() => done({}, new Set(), 0, new Set(), new Map()));
}

// Slår ihop klubbdata för flera valda cuper till en enda lista, med vilka
// AV DE VALDA cuperna varje klubb faktiskt förekommer i (visas i popupen
// — svarar direkt på "vilka cuper har den här klubben deltagit i?"), som
// {id, name}-par (INTE bara namnet) så popupen kan länka rakt in i
// Schema/Tabeller/Slutspel för rätt cup (se clubDeepLinkUrl). Samma
// klubbnamn i flera cuper delar samma verkliga adress, så en enkel
// namnnyckel räcker för att deduplicera pricken på kartan.
function mergedClubGeo(cupIds) {
  const merged = {};
  for (const cupId of cupIds) {
    const geo = HB.api.clubGeo[cupId];
    if (!geo) continue;
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    for (const [name, info] of Object.entries(geo)) {
      if (!merged[name]) merged[name] = { ...info, cups: [] };
      merged[name].cups.push({ id: cupId, name: cupName });
    }
  }
  return merged;
}

// Kartans mellannivå (live-läge): klubbar UTAN känd adress (merged, se
// ovan — den vinner om en klubb har båda) men med en känd landskod,
// sammanslaget över de valda cuperna på samma sätt som mergedClubGeo.
// state.mapCupCountryByClub fylls av loadCup()/ensureCupClubGeo, se deras
// kommentarer — oberoende av merged, uteslutningen görs HÄR, inte vid
// insamlingen, så samma råa data kan användas oavsett vilka cuper som
// råkar vara valda just nu.
function mergedCountry(cupIds, merged) {
  const result = new Map();
  for (const cupId of cupIds) {
    const byClub = state.mapCupCountryByClub[cupId];
    if (!byClub) continue;
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    for (const [name, code] of byClub) {
      if (merged[name]) continue;
      if (!result.has(name)) result.set(name, { code, cups: [] });
      result.get(name).cups.push({ id: cupId, name: cupName });
    }
  }
  return result;
}

// Samma sammanslagning som mergedClubGeo, men för ETT specifikt arkiverat
// år i stället för live-data. Arkiverade matcher sparar bara ett RENT
// klubbnamn (se normalize() i fetch_cupmanager.py/fetch_gothia.py), ingen
// egen adress — så adressen slås alltid upp via klubbkatalogen
// (namnmatchning, clubGeoFromMatches), oavsett om cupen normalt har egen
// adressdata (klassisk Cup Manager) eller inte (ProCup/Gothia). Kräver
// att ensureYearMatches(year, cupId) redan körts (se renderMapView) —
// hoppar tyst över cuper vars år inte hunnit laddas än.
function mergedClubGeoForYear(cupIds, year, directory) {
  const merged = {};
  for (const cupId of cupIds) {
    const ym = state.yearMatches[cupId + ":" + year];
    if (!ym || ym.status !== "done") continue;
    const geo = clubGeoFromMatches(ym.matches, directory);
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    for (const [name, info] of Object.entries(geo)) {
      if (!merged[name]) merged[name] = { ...info, cups: [] };
      merged[name].cups.push({ id: cupId, name: cupName });
    }
  }
  return merged;
}

// mergedCountry ovan, för årsläget — landskoden är inbäddad direkt på de
// arkiverade matchernas home/away.country (se scripts/fetch_*.py).
// directory skickas vidare till clubCountryFromMatches — bara till för
// ÄLDRE arkiverade år som (till skillnad från vanliga klassiska
// Cup Manager-cuper) saknar side.club helt, se dess kommentar.
function mergedCountryForYear(cupIds, year, merged, directory) {
  const result = new Map();
  for (const cupId of cupIds) {
    const ym = state.yearMatches[cupId + ":" + year];
    if (!ym || ym.status !== "done") continue;
    const byClub = clubCountryFromMatches(ym.matches, directory);
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    for (const [name, code] of byClub) {
      if (merged[name]) continue;
      if (!result.has(name)) result.set(name, { code, cups: [] });
      result.get(name).cups.push({ id: cupId, name: cupName });
    }
  }
  return result;
}

// "Visa landshistorik"-kryssrutan (state.mapCountryHistory): för VARJE
// land som någonsin haft en klubb i de valda cuperna — över ALLA
// arkiverade år PLUS innevarande upplaga, inte bara det år Karta just nu
// råkar visa — hur många distinkta klubbar och vilka år. Landskoden är
// inbäddad direkt på varje match (home/away.country, se js/api.js
// normalize()/scripts/fetch_*.py) så det spelar ingen roll om klubben
// också har en känd adress eller ej — adressens egen .country-fält
// (clubs_from_store/clubGeoFromStore) räknas här också, annars skulle
// Sverige (där de flesta klubbar HAR adress) se tomt ut trots att det är
// just Sverige användaren oftast vill se aggregerat (se ensureCountryHistory
// nedan för vilken data som måste vara laddad innan detta anropas).
function countryYearSummary(cupIds) {
  // clubs: dedupat på klubbnamn (side.club), teams: dedupat på FULLT
  // lagnamn (side.name, med åldersklass-/färgsuffix) — två olika, båda
  // roliga tal ("X klubbar, Y lag", se countryHistoryPopupBody). Bara
  // arkiverade år (ym.matches nedan) har kvar den fulla per-match-
  // upplösningen — de förhämtade per-cup-aggregaten (mapCupCountryByClub/
  // HB.api.clubGeo) är redan hopslagna till klubbnivå innan de når hit,
  // så innevarande upplaga bidrar bara till klubb-räkningen, inte
  // lag-räkningen (teamName utelämnad = ingen extra lag-post där).
  const acc = new Map(); // landskod -> {clubs:Set(namn), teams:Set(lagnamn), years:Set(år)}
  const add = (code, name, year, teamName) => {
    if (!code || !name) return;
    if (!acc.has(code)) acc.set(code, { clubs: new Set(), teams: new Set(), years: new Set() });
    acc.get(code).clubs.add(name);
    if (teamName) acc.get(code).teams.add(teamName);
    if (year) acc.get(code).years.add(year);
  };
  for (const cupId of cupIds) {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const liveYear = cupObj && cupObj.edition;
    for (const [name, code] of (state.mapCupCountryByClub[cupId] || new Map())) add(code, name, liveYear);
    for (const [name, info] of Object.entries(HB.api.clubGeo[cupId] || {})) add(info.country, name, liveYear);
    const editions = ((state.archiveIndex[cupId] && state.archiveIndex[cupId].editions) || [])
      .filter((e) => e.matches > 0);
    for (const em of editions) {
      const ym = state.yearMatches[cupId + ":" + em.edition];
      if (!ym || ym.status !== "done") continue;
      for (const m of ym.matches) {
        for (const side of [m.home, m.away]) {
          add(side.country, side.club || side.name, em.edition, side.name);
        }
      }
    }
  }
  return acc;
}

// Ser till att ALLA arkiverade år (inte bara det just synliga, se
// ensureYearMatches/state.mapYear) är laddade för de valda cuperna, så
// countryYearSummary ovan har fullständig data — bara körs när "Visa
// landshistorik" faktiskt är ikryssad (annars onödigt tungt, en cup med
// många år kan vara flera MB). true = klart, false = fortfarande laddar.
function ensureCountryHistory(cupIds) {
  let allDone = true;
  for (const cupId of cupIds) {
    const editions = ((state.archiveIndex[cupId] && state.archiveIndex[cupId].editions) || [])
      .filter((e) => e.matches > 0);
    for (const em of editions) {
      ensureYearMatches(em.edition, cupId);
      const ym = state.yearMatches[cupId + ":" + em.edition];
      if (!ym || ym.status !== "done") allDone = false;
    }
  }
  return allDone;
}

// Klubbkatalogen (data/club-directory.json) behövs för årsläget oavsett
// cuptyp (se mergedClubGeoForYear ovan) — HB.api.fetchClubDirectory()
// cachar redan själva fetch-anropet, men vi vill dessutom trigga en
// omritning när den blir klar (annars sitter Karta fast på "Hämtar …"
// tills nästa oberoende omritning råkar ske).
let clubDirectoryCache = null;
export function ensureClubDirectory() {
  if (clubDirectoryCache) return;
  HB.api.fetchClubDirectory().then((dir) => {
    clubDirectoryCache = dir || {};
    if (state.view === "stats" && state.statsView === "karta") render();
  });
}

export function getClubDirectory() {
  return clubDirectoryCache;
}

// Tidslinje-uppspelning: klickar man "Spela upp" stegas state.mapYear
// fram genom de arkiverade åren automatiskt (loopar om från början) tills
// man pausar eller lämnar Karta-fliken (self-check i själva tickern —
// samma "inget explicit unmount-hook"-mönster som !document.body.
// contains(mapBox) används för kartan själv).
let mapPlayTimer = null;
function stopMapPlay() {
  if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; }
}
function toggleMapPlay(years) {
  if (mapPlayTimer) { stopMapPlay(); renderContent(); return; }
  mapPlayTimer = setInterval(() => {
    if (state.view !== "stats" || state.statsView !== "karta") { stopMapPlay(); return; }
    const cur = years.indexOf(state.mapYear);
    state.mapYear = years[cur === -1 || cur === years.length - 1 ? 0 : cur + 1];
    renderContent();
  }, 1400);
  renderContent();
}

let currentMap = null;        // föregående kartinstans — måste .remove()'as explicit,
                               // annars läcker en WebGL-kontext varje gång fliken byts bort
// klubbnamn -> {marker, color}: EN karta för varje klubbnål som sitter på
// currentMap just nu. Diffas mot nästa urval i stället för att rensas och
// byggas om i sin helhet (se paintMapMarkers) — en klubb som finns kvar
// mellan två år ska INTE blinka till bara för att andra klubbar
// tillkommit/försvunnit, annars går det inte att visuellt följa vad som
// faktiskt ändrats mellan åren (precis det "Spela upp" är till för).
let currentMapMarkerByKey = new Map();
let currentUnknownMarkerByKey = new Map(); // klubbnamn -> marker, samma diff-princip som currentMapMarkerByKey ovan
let currentCountryMarkerByKey = new Map(); // klubbnamn -> {marker, color}, samma diff-princip, se paintMapMarkers
let currentHistoryMarkerByKey = new Map(); // landskod -> {marker, clubCount, yearsKey}, "Visa landshistorik"
let mapBoxEl = null;          // DOM-noden kartan bor i — sparas modulnivå (INTE i renderMapView)
                               // så samma nod kan flyttas in i det nya innehållet varje
                               // omritning i stället för att byggas om från grunden; annars
                               // skulle årsbyte/"Spela upp" förstöra och återskapa hela
                               // MapLibre-instansen varje gång — synligt som att kartan
                               // "laddar om" (zoom/panorering återställs) i stället för att
                               // bara pinnarna byts ut, vilket användaren uttryckligen inte vill.
let mapBoxKey = null;         // vilka cuper (sorterad, kommaseparerad id-lista) kartan
                               // just nu byggts för — bara EN cupändring (inte årsbyte)
                               // motiverar att faktiskt återskapa kartinstansen.

// Ett tomt live-läge betyder ofta inte att kartan eller adressmatchningen
// har misslyckats, utan att arrangören bara har publicerat klasser och ett
// slutspelsskelett med "Vinn."/"Förl." som deltagare. Förklara det och
// ge en rimlig historisk jämförelse när arkivet har en äldre upplaga med
// riktiga lag. Noll i clubs betyder "uppgift saknas" i äldre arkiv, inte
// att upplagan faktiskt spelades utan klubbar (samma tolkning som Cuper-
// tabellen, se renderCupsOverviewDetail).
function mapUnpublishedParticipationNotice(cupIds) {
  const idx = state.archiveIndex || {};
  const rows = cupIds.map((cupId) => {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || (idx[cupId] && idx[cupId].cupName) || cupId;
    const currentEdition = cupObj && cupObj.edition;
    const previous = (((idx[cupId] && idx[cupId].editions) || [])
      .filter((e) => e.edition !== currentEdition && (e.teams || 0) > 0)
      .sort((a, b) => String(b.edition).localeCompare(String(a.edition), "sv", { numeric: true })))[0];
    const hasStructure = (state.mapCupClasses[cupId] || new Set()).size > 0;
    const currentText = cupName + " har ännu inte publicerat några officiella deltagande lag eller klubbar" +
      (currentEdition ? " för " + currentEdition : "") + ".";
    const structureText = hasStructure
      ? " Klasser och matchplatser finns, men deltagarna är fortfarande platshållare."
      : "";
    let historyText;
    if (!previous) {
      historyText = "CupSchema har ingen tidigare upplaga med deltagaruppgifter att jämföra med.";
    } else if (previous.clubs) {
      historyText = "I den senaste tidigare arkiverade upplagan (" + previous.edition +
        ") deltog " + previous.teams + " lag från " + previous.clubs + " klubbar.";
    } else {
      historyText = "I den senaste tidigare arkiverade upplagan (" + previous.edition +
        ") deltog " + previous.teams + " lag. Uppgift om antal klubbar saknas i arkivet.";
    }
    return h("div", { class: "map-empty-participation-row" },
      h("p", null, h("strong", null, currentText), structureText),
      h("p", { class: "muted" }, historyText));
  });
  return h("div", { class: "banner map-empty-participation" }, rows);
}

export function renderMapView(root) {
  // Alla cuper AV SAMMA SPORT som innevarande cup listas — inte bara
  // klassiska Cup Manager-cuper (ProCup/Gothia-cuper kan också få
  // (gissad) klubbdata, se ensureCupClubGeo/clubGeoFromMatches), men att
  // blanda t.ex. handbolls- och fotbollsklubbar på samma karta är
  // förvirrande snarare än informativt. Byt aktiv cup (Inställningar)
  // för att se fotbollscupernas klubbar i stället. En cup utan några
  // träffar ger bara en tom karta för just den, inget att spärra bort
  // i förväg. state.exploreCupIds delas med Trend (se dess kommentar) —
  // cupurvalet hänger alltså med om man växlar mellan de två flikarna.
  const mapCupOptions = HB.allCups().filter((c) => (c.sport || "handboll") === (cup().sport || "handboll"));
  // Städa bort ev. kvarvarande urval från en ANNAN sport, se motsvarande
  // kommentar i renderTrendView.
  for (const id of [...state.exploreCupIds]) if (!mapCupOptions.some((c) => c.id === id)) state.exploreCupIds.delete(id);
  // Förval: bara innevarande cup, en gång — renderTabs() garanterar redan
  // att man bara kan NÅ Karta-fliken när innevarande cup stödjer den, så
  // ingen ytterligare giltighetskoll behövs här.
  if (!state.exploreCupIds.size) state.exploreCupIds.add(state.cupId);

  const cupPicker = buildPicker({
    items: mapCupOptions.map((c) => ({ id: c.id, label: c.name, sortKey: 0, sortName: c.name })),
    selected: state.exploreCupIds,
    emptyLabel: "Välj cup(er)",
    countLabel: (n) => n + " cuper",
    searchPlaceholder: "Sök cup …",
    sortToggle: false, // cuper har inget "klass"-begrepp — bara namnsortering
    soloClickable: true, // klick på cupnamnet väljer bara den cupen
    onChange: () => { stopMapPlay(); renderContent(); },
  });
  root.append(h("div", { class: "history-controls" }, cupPicker));

  const selectedIds = [...state.exploreCupIds];

  // År-väljare: union av arkiverade (spelade) år över VALDA cuper — "Nu"
  // (dagens live-data) är alltid ett alternativ, även utan arkivhistorik.
  const idx = state.archiveIndex || {};
  const yearSet = new Set();
  for (const id of selectedIds) {
    for (const e of ((idx[id] && idx[id].editions) || [])) if (e.matches > 0) yearSet.add(e.edition);
  }
  const years = [...yearSet].sort();
  // t.ex. efter cupbyte. Bara när arkivindexet FAKTISKT är laddat — annars
  // är years alltid tom vid första ritningen, och ett djuplänkat ?mapYear=
  // hade nollställts innan indexet ens hunnit svara.
  if (state.archiveIndex && state.mapYear && !years.includes(state.mapYear)) state.mapYear = null;
  if (years.length) {
    const yearSelect = h("select", { class: "select", "aria-label": "År" },
      h("option", { value: "" }, "Nu"),
      years.map((y) => h("option", { value: y }, y)));
    yearSelect.value = state.mapYear || "";
    yearSelect.addEventListener("change", () => {
      stopMapPlay();
      state.mapYear = yearSelect.value || null;
      renderContent();
    });
    const playBtn = h("button", {
      class: "btn small", type: "button", ...(years.length < 2 ? { disabled: "" } : {}),
      onclick: () => toggleMapPlay(years),
    }, mapPlayTimer ? "⏸ Pausa" : "▶ Spela upp");
    root.append(h("div", { class: "row trend-baseline-row" }, yearSelect, playBtn));
  }

  // "Visa landshistorik": extra lila markörer, en per land som NÅGONSIN
  // haft en klubb i de valda cuperna (alla arkiverade år + innevarande
  // upplaga, se countryYearSummary) — oberoende av vilket enskilt år
  // (state.mapYear) Karta just nu råkar visa. Av som förval: kräver att
  // ALLA arkiverade år laddas (kan vara flera MB för en cup med lång
  // historik), inte bara det synliga året.
  const historyToggle = h("label", { class: "inline-toggle" },
    h("input", {
      type: "checkbox", ...(state.mapCountryHistory ? { checked: "" } : {}),
      onchange: (e) => { state.mapCountryHistory = e.target.checked; renderContent(); },
    }),
    " Visa landshistorik (alla år, per land)");
  root.append(h("div", { class: "row" }, historyToggle));

  let merged, countryMap, allClubs, totalTeams;
  // klubbnamn -> [{id, name}, ...] (samma form som merged/countryMaps
  // .cups) — bara till för "helt okänd"-nivåns popup-länkar
  // (unknownPopupBody), som annars inte skulle veta vilken cup en
  // adresslös/landslös klubb faktiskt hörde till.
  const allClubCups = new Map();
  const addClubCup = (name, cupId, cupName) => {
    if (!allClubCups.has(name)) allClubCups.set(name, []);
    allClubCups.get(name).push({ id: cupId, name: cupName });
  };
  const classSet = new Set();
  if (state.mapYear) {
    ensureClubDirectory();
    for (const id of selectedIds) ensureYearMatches(state.mapYear, id);
    const pending = !clubDirectoryCache || selectedIds.some((id) => {
      const ym = state.yearMatches[id + ":" + state.mapYear];
      return !ym || ym.status === "loading";
    });
    if (pending) {
      root.append(h("p", { class: "muted" }, "Hämtar arkiverad klubbdata …"));
      return;
    }
    merged = mergedClubGeoForYear(selectedIds, state.mapYear, clubDirectoryCache);
    countryMap = mergedCountryForYear(selectedIds, state.mapYear, merged, clubDirectoryCache);
    allClubs = new Set();
    totalTeams = 0;
    for (const id of selectedIds) {
      const ym = state.yearMatches[id + ":" + state.mapYear];
      if (!ym || ym.status !== "done") continue;
      const cupName = (HB.allCups().find((c) => c.id === id) || {}).name || id;
      for (const name of allClubNamesFromMatches(ym.matches, clubDirectoryCache)) {
        allClubs.add(name); addClubCup(name, id, cupName);
      }
      const tc = teamsAndClassesFromMatches(ym.matches);
      totalTeams += tc.teamCount;
      for (const c of tc.classes) classSet.add(c);
    }
  } else {
    for (const id of selectedIds) ensureCupClubGeo(id);
    if (selectedIds.some((id) => state.mapCupStatus[id] === "loading")) {
      root.append(h("p", { class: "muted" }, "Hämtar klubbdata …"));
      return;
    }
    merged = mergedClubGeo(selectedIds);
    countryMap = mergedCountry(selectedIds, merged);
    allClubs = new Set();
    totalTeams = 0;
    for (const id of selectedIds) {
      const cupName = (HB.allCups().find((c) => c.id === id) || {}).name || id;
      for (const name of (state.mapCupAllClubs[id] || [])) { allClubs.add(name); addClubCup(name, id, cupName); }
      totalTeams += state.mapCupTeamCount[id] || 0;
      for (const c of (state.mapCupClasses[id] || [])) classSet.add(c);
    }
  }

  const entries = Object.entries(merged);
  // Alla klubbar (känd adress, ungefärligt land, eller helt okänd) i de
  // valda cuperna, oavsett om vi lyckades placera dem på kartan —
  // mängdskillnaden mot merged/countryMap ger hur många som saknar
  // BÅDE adress och land (helt okänd, Atlant-rutnätet nedan).
  const unknownNames = [...allClubs].filter((name) => !merged[name] && !countryMap.has(name))
    .sort((a, b) => a.localeCompare(b, "sv"));
  if (!entries.length && !countryMap.size && !unknownNames.length) {
    if (!state.mapYear && totalTeams === 0 && allClubs.size === 0) {
      root.append(mapUnpublishedParticipationNotice(selectedIds));
    } else {
      root.append(h("p", { class: "muted" },
        "Ingen klubbdata i valda cuper" + (state.mapYear ? " för " + state.mapYear : "") + "."));
    }
    return;
  }
  const cityCount = new Set(entries.map(([, info]) => info.city).filter(Boolean)).size;
  const countryCount = new Set(entries.map(([, info]) => info.country).filter(Boolean)).size;
  const approxCountryCount = new Set([...countryMap.values()].map((v) => v.code)).size;
  root.append(h("p", { class: "muted map-count" },
    totalTeams + " lag · " +
    allClubs.size + " klubbar totalt" + (state.mapYear ? " (" + state.mapYear + ")" : "") + " · " +
    entries.length + " med känd adress (" +
    cityCount + " städer" + (countryCount > 1 ? " · " + countryCount + " länder" : "") + ")" +
    (countryMap.size ? " · " + countryMap.size + " med ungefärlig landsplacering (" +
      approxCountryCount + " länder)" : "") +
    (unknownNames.length ? " · " + unknownNames.length + " helt okänd" : "") +
    " · " + classSet.size + " klasser"));
  root.append(h("div", { class: "map-legend" },
    h("span", { class: "map-legend-item" },
      h("span", { class: "map-legend-dot", style: "background:" + MAP_SHARED_COLOR }), "Känd adress"),
    countryMap.size ? h("span", { class: "map-legend-item" },
      h("span", { class: "map-legend-dot", style: "background:" + MAP_SHARED_COLOR + ";opacity:.55" }),
      "Ungefärlig landsplacering (boll = antal)") : null,
    unknownNames.length ? h("span", { class: "map-legend-item" },
      h("span", { class: "map-legend-dot", style: "background:#8a94a3" }), "Helt okänd (Atlanten)") : null));

  // Flercupsläge: en färg per vald cup (MAP_CUP_COLORS, cykliskt) plus en
  // reserverad delad färg (MAP_SHARED_COLOR) för klubbar som spelat i
  // FLERA av de valda cuperna — se cupColorForClub/legenden nedan.
  const showCups = selectedIds.length > 1;
  const cupColorByName = new Map(selectedIds.map((id, i) => [
    (HB.allCups().find((c) => c.id === id) || {}).name || id,
    MAP_CUP_COLORS[i % MAP_CUP_COLORS.length],
  ]));
  if (showCups) {
    root.append(h("div", { class: "trend-legend" },
      [...cupColorByName.entries()].map(([name, color]) =>
        h("div", { class: "trend-legend-item" },
          h("span", { class: "trend-swatch", style: "background:" + color }),
          h("span", null, name))).concat(
        h("div", { class: "trend-legend-item" },
          h("span", { class: "trend-swatch", style: "background:" + MAP_SHARED_COLOR }),
          h("span", null, "Flera av de valda cuperna")))));
  }
  const cupColorForClub = (info) => !showCups || info.cups.length > 1
    ? MAP_SHARED_COLOR : (cupColorByName.get(info.cups[0].name) || MAP_SHARED_COLOR);

  // countryHistory: null = avstängd ELLER fortfarande laddar (samma
  // ensureYearMatches som årsväljaren ovan, men för ALLA år på en gång) —
  // paintMapMarkers/createMap hoppar bara över den extra pin-nivån tills
  // den är redo, resten av kartan renderas som vanligt under tiden.
  let countryHistory = null;
  if (state.mapCountryHistory) {
    const ready = ensureCountryHistory(selectedIds);
    if (ready) countryHistory = countryYearSummary(selectedIds);
    else root.append(h("p", { class: "muted" }, "Laddar landshistorik …"));
  }

  // Samma cupurval som senast (bara årtalet eller "spela upp" har ändrats)
  // → återanvänd den redan levande kartinstansen och byt bara ut
  // pinnarna, i stället för att förstöra och återskapa allt (skulle synas
  // som att kartan "laddar om" — panorering/zoom nollställs, se
  // mapBoxEl-kommentaren ovan).
  const cupsKey = selectedIds.slice().sort().join(",");
  const needsNewMap = !mapBoxEl || mapBoxKey !== cupsKey || !currentMap;
  if (needsNewMap) { mapBoxEl = h("div", { class: "map-box" }); mapBoxKey = cupsKey; }
  // Lokal, stabil referens för DENNA körnings async-callback — mapBoxEl
  // (modulnivå) kan hinna bytas ut av en SENARE renderMapView-körning
  // innan löftet nedan löser sig (t.ex. snabba cupbyten i rad), annars
  // skulle den gamla callbacken råka rita i/kolla fel nod.
  const box = mapBoxEl;
  root.append(box);
  ensureMapLibre().then((maplibregl) => {
    // Om användaren hunnit byta cup/flik medan biblioteket laddade från
    // CDN: box sitter inte kvar i dokumentet längre, rita inte i den.
    if (!document.body.contains(box)) return;
    if (needsNewMap) {
      createMap(maplibregl, box, merged, countryMap, unknownNames, cupColorForClub, state.mapYear, allClubCups,
        countryHistory);
    } else {
      currentMap.resize(); // återfäst nod kan ha bytt storlek medan den var frånkopplad
      paintMapMarkers(maplibregl, merged, countryMap, unknownNames, cupColorForClub, state.mapYear, allClubCups,
        countryHistory);
    }
  }).catch((e) => {
    if (!document.body.contains(box)) return;
    box.replaceChildren(h("p", { class: "muted" }, "Kunde inte ladda kartan: " + e.message));
  });
}

// "Ungefärlig plats" — klubbar UTAN känd adress men med en känd landskod
// klustras runt landets centroid i stället för att spridas ut i Atlanten
// (se UNKNOWN_GRID nedan, den nivån är för klubbar helt UTAN varken
// adress eller land). Samma stabila-slot-princip som UNKNOWN_GRID —
// slotet återanvänds ALDRIG, annars skulle en orelaterad klubb i samma
// land hoppa till en ny position bara för att en annan klubb i samma
// land försvann ur urvalet. Slotnumreringen är PER LAND (egen Map per
// landskod), inte global — annars skulle land #2 i tur och ordning börja
// sitt kluster mitt i land #1:s om många länder bara har en handfull
// klubbar var.
const COUNTRY_GRID_COLS = 4;
const COUNTRY_GRID_SPACING = [0.4, 0.3]; // [lng, lat] grader mellan klustrets punkter
let countryGridSlotByCode = new Map(); // landskod -> Map(klubbnamn -> slotindex)

// Hur långt norr om landets centroid "Visa landshistorik"-pinnen läggs
// (grader latitud) — se paintMapMarkers — bara till för att den aldrig
// ska hamna EXAKT ovanpå landsbollen/klubbnålarna på samma centroid.
const HISTORY_PIN_OFFSET = 0.9;
function countryGridLngLat(name, code) {
  const centroid = COUNTRY_CENTROIDS[code];
  if (!centroid) return null; // okänd/orimlig landskod — bör inte hända, men failsafe
  if (!countryGridSlotByCode.has(code)) countryGridSlotByCode.set(code, new Map());
  const slots = countryGridSlotByCode.get(code);
  if (!slots.has(name)) slots.set(name, slots.size);
  const slot = slots.get(name);
  const col = slot % COUNTRY_GRID_COLS;
  const row = Math.floor(slot / COUNTRY_GRID_COLS);
  // Centrerat kring centroid (inte startande FRÅN den) så klustret växer
  // åt alla håll i stället för att bara skjuta ut söderut/österut.
  const colOffset = col - (COUNTRY_GRID_COLS - 1) / 2;
  return [centroid[0] + colOffset * COUNTRY_GRID_SPACING[0],
          centroid[1] + row * COUNTRY_GRID_SPACING[1]];
}

// "Okända" klubbar (ingen adress att slå upp) plottas var för sig i ett
// rutnät långt ute i Atlanten — mitt-Atlanten (inte Nordsjön som förut)
// för att garanterat inte råka överlappa någon verklig klubbs nål ens
// vid ett stort rutnät. Ger ett direkt visuellt mått på HUR STOR andel
// av klubbarna som saknar känd adress, i stället för en enda samlad nål
// med en textlista i popupen.
const UNKNOWN_GRID_ORIGIN = [-30, 45]; // mitt-Atlanten, sydväst om Portugal
const UNKNOWN_GRID_COLS = 20;
const UNKNOWN_GRID_SPACING = [0.5, 0.3]; // [lng, lat] grader mellan rutnätspunkter

// Varje klubbnamn får en STABIL rutnätsplats (tilldelas EN gång, sedan
// aldrig omtilldelad) — annars skulle en helt orelaterad klubbs nål
// hoppa till en ny position bara för att någon ANNAN klubb försvann ur
// listan (indexbaserad placering skulle skifta alla efterföljande),
// vilket precis som paintMapMarkers ovan skulle se ut som att kartan
// "blinkar" vid varje årsbyte.
let unknownGridSlotByName = new Map();
function unknownGridLngLat(name) {
  if (!unknownGridSlotByName.has(name)) unknownGridSlotByName.set(name, unknownGridSlotByName.size);
  const slot = unknownGridSlotByName.get(name);
  const col = slot % UNKNOWN_GRID_COLS;
  const row = Math.floor(slot / UNKNOWN_GRID_COLS);
  return [UNKNOWN_GRID_ORIGIN[0] + col * UNKNOWN_GRID_SPACING[0],
          UNKNOWN_GRID_ORIGIN[1] + row * UNKNOWN_GRID_SPACING[1]];
}

// Länk rakt in i Schema (scope=all så den INTE begränsas till egna
// klubben, q=klubbnamnet som fritextsökning, samma matchning som
// sökrutan i verktygsraden — se matchesSearchQuery) för en given cup.
// mapYear: Kartans just nu valda år (state.mapYear, null = "Nu") — allt
// Karta visar just nu hör till EXAKT det året, så popupens länk ska visa
// SAMMA år, inte nödvändigtvis cupens live-upplaga. years+curYear=0
// isolerar till bara det arkiverade året (annars skulle live-upplagans
// matcher blandas in också, se allActiveMatches).
function clubDeepLinkUrl(clubName, cupId, mapYear) {
  const p = new URLSearchParams();
  p.set("cup", cupId);
  p.set("view", "schema");
  p.set("scope", "all");
  p.set("q", clubName);
  if (mapYear) { p.set("years", mapYear); p.set("curYear", "0"); }
  return "?" + p.toString();
}

// Delad av alla tre popup-nivåerna (klubbPopupBody/countryPopupBody/
// unknownPopupBody) — en klubb kan förekomma i FLERA av de valda cuperna
// samtidigt (se .cups, {id,name}-par), då blir det en länk per cup.
// target=_blank så Kartans egen zoom/panorering/utfällda-länder-state
// inte går förlorad när man bara vill kika snabbt på en klubbs matcher.
function clubCupLinksBody(clubName, cups, mapYear) {
  if (!cups || !cups.length) return null;
  const kids = [];
  cups.forEach((c, i) => {
    if (i > 0) kids.push(", ");
    kids.push(h("a", { href: clubDeepLinkUrl(clubName, c.id, mapYear), target: "_blank", rel: "noopener" }, c.name));
  });
  return h("div", { class: "muted map-popup-cups" }, "Visa matcher: ", ...kids);
}

function clubPopupBody(name, info, mapYear) {
  return h("div", { class: "map-popup" },
    h("strong", null, name),
    h("br"),
    info.city + (info.country ? ", " + info.country : ""),
    clubCupLinksBody(name, info.cups, mapYear));
}

// Intl.DisplayNames — inbyggd webbläsar-API för att slå upp landsnamn
// ("NO" -> "Norge") ur en landskod, ingen egen namntabell behövs (till
// skillnad från COUNTRY_CENTROIDS, som bara kan hämtas ur koordinater).
const countryNameLookup = (() => {
  try { return new Intl.DisplayNames(["sv"], { type: "region" }); }
  catch { return null; }
})();
export function countryDisplayName(code) {
  try { return (countryNameLookup && countryNameLookup.of(code)) || code; }
  catch { return code; }
}

// collapseFn: bara ifylld när landets kluster är UTFÄLLT (se
// expandedCountryCodes) — en chip i popupen för att fälla ihop det igen,
// annars finns inget sätt att komma tillbaka till bollen utan att byta
// cup/år (som återställer allt) eller ladda om sidan.
function countryPopupBody(name, entry, collapseFn, mapYear) {
  return h("div", { class: "map-popup" },
    h("strong", null, name),
    h("br"),
    h("span", { class: "muted" }, "Ungefärlig plats — land: " + countryDisplayName(entry.code)),
    clubCupLinksBody(name, entry.cups, mapYear),
    collapseFn ? h("button", {
      class: "chip small", type: "button", style: "margin-top:6px",
      onclick: collapseFn,
    }, "← Gruppera " + countryDisplayName(entry.code) + " igen") : null);
}

// "Helt okänd"-nivåns popup (varken adress eller land, se
// unknownGridLngLat) — cups kommer från renderMapViews allClubCups
// (samma {id,name}-form som merged/countryMap, byggd separat eftersom
// allClubNamesFromMatches/state.mapCupAllClubs annars bara ger platta
// klubbnamn utan cup-koppling).
function unknownPopupBody(name, cups, mapYear) {
  return h("div", { class: "map-popup" },
    h("strong", null, name),
    h("br"),
    h("span", { class: "muted" }, "Ingen känd adress eller land"),
    clubCupLinksBody(name, cups, mapYear));
}

// "Visa landshistorik"-pinnen: en lila RING (ihålig, INTE fylld som
// countryBubbleElement) med landskoden som text — medvetet en annan form
// OCH färg än både adressnivåns nålar och den (adresslösa) landsbollen,
// så de tre aldrig kan förväxlas när de visas samtidigt (historikpinnen
// är ett tillägg OVANPÅ resten av kartan, inte en ersättning för någon
// av de andra nivåerna).
function countryHistoryElement(code) {
  const el = document.createElement("div");
  el.className = "map-country-history-pin";
  el.textContent = code;
  return el;
}

function countryHistoryPopupBody(code, entry) {
  const years = [...entry.years].sort();
  // entry.teams kan vara tomt (bara innevarande upplaga bidrog, se
  // countryYearSummary) — visa då bara klubbantalet, ingen "0 lag".
  const teamsPart = entry.teams.size ? ", " + entry.teams.size + " lag" : "";
  return h("div", { class: "map-popup" },
    h("strong", null, countryDisplayName(code)),
    h("br"),
    h("span", { class: "muted" }, entry.clubs.size + " klubbar" + teamsPart + " totalt"),
    years.length ? h("div", { class: "muted" }, "Deltagit: " + years.join(", ")) : null);
}

// Landsklustrens boll (ihopfälld — se expandedCountryCodes): en cirkel
// med antalet klubbar som text (klubbnamn, INTE fullt lagnamn — se
// countryMap/clubCountryFromMatches, .club || .name men .club är alltid
// ifyllt för Cup Manager/Gothia, som är de enda källorna landsdata
// täcker just nu), storleken skalad (kvadratrot, inte
// linjärt — annars skulle t.ex. 40 klubbar bli en orimligt stor cirkel
// jämfört med 5) så den syns tydligt utzoomat utan att dominera kartan.
// Ett vanligt maplibregl.Marker({color}) stödjer varken text inuti eller
// dynamisk storlek — bygger därför ett eget DOM-element (stöds direkt av
// Marker via {element: ...}).
function countryBubbleElement(count, color) {
  const size = Math.round(Math.min(56, Math.max(24, 16 + Math.sqrt(count) * 8)));
  const el = document.createElement("div");
  el.className = "map-country-bubble";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.style.background = color;
  el.style.fontSize = Math.max(10, Math.min(15, Math.round(size * 0.32))) + "px";
  el.textContent = String(count);
  return el;
}

// Vilka landskoder som just nu är "utfällda" till enskilda klubbnålar i
// stället för en samlad boll (se paintMapMarkers) — klick på en boll
// lägger till, popupens "Gruppera igen"-chip tar bort. Modulnivå (inte
// state) så den överlever renderContent()-anrop under en session, precis
// som countryGridSlotByCode — nollställs bara när kartan byggs om helt
// (createMap, ny cup-/årskombination).
let expandedCountryCodes = new Set();
let currentCountryBubbleByCode = new Map(); // landskod -> {marker, count, color}

// Diffar mot markörerna som redan sitter på kartan i stället för att
// rensa och bygga om alla — en klubb som förekommer i BÅDA det gamla och
// nya urvalet (samma namn, oavsett om året eller cupvalet ändrats) rörs
// inte alls (bara popupen uppdateras om "Deltar i"-listan ändrats), så
// den INTE blinkar till. Bara faktiska tillägg/borttag ger en synlig
// förändring — det är själva poängen med "Spela upp": kunna FÖLJA vad
// som ändras mellan åren i stället för att hela kartan verkar blinka om.
// Rör INTE kartans center/zoom (ingen fitBounds här), till skillnad från
// createMap nedan.
function paintMapMarkers(maplibregl, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups, countryHistory) {
  const nextNames = new Set(Object.keys(geo));
  for (const [name, entry] of currentMapMarkerByKey) {
    if (!nextNames.has(name)) { entry.marker.remove(); currentMapMarkerByKey.delete(name); }
  }
  for (const [name, info] of Object.entries(geo)) {
    const color = cupColorForClub(info);
    const existing = currentMapMarkerByKey.get(name);
    if (existing && existing.color === color) {
      // Oförändrad position OCH färg — uppdatera bara popupinnehållet
      // (kan skilja mellan år, t.ex. "Deltar i"-listan) utan att röra
      // själva nålens DOM-element.
      existing.marker.setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(clubPopupBody(name, info, mapYear)));
      continue;
    }
    if (existing) existing.marker.remove(); // färgen bytte (sällsynt, se cupColorForClub) — måste återskapas
    const marker = new maplibregl.Marker({ color })
      .setLngLat([info.lng, info.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(clubPopupBody(name, info, mapYear)))
      .addTo(currentMap);
    currentMapMarkerByKey.set(name, { marker, color });
  }
  // Mellannivån: känt land, okänd adress — grupperas per land till EN
  // "boll" (countryBubbleElement, storlek+siffra = antal klubbar) om
  // landet inte är utfällt (expandedCountryCodes), annars enskilda
  // klubbnålar precis som förut (countryGridLngLat, scale 0.7). Klick på
  // en boll fäller ut den (se click-lyssnaren nedan), popupens "Gruppera
  // igen"-chip (countryPopupBody) fäller ihop den igen.
  const byCode = new Map(); // landskod -> [[klubbnamn, entry], ...]
  for (const [name, entry] of (countryMap || new Map())) {
    if (!byCode.has(entry.code)) byCode.set(entry.code, []);
    byCode.get(entry.code).push([name, entry]);
  }

  const nextBubbleCodes = new Set([...byCode.keys()].filter((code) => !expandedCountryCodes.has(code)));
  for (const [code, entry] of currentCountryBubbleByCode) {
    if (!nextBubbleCodes.has(code)) { entry.marker.remove(); currentCountryBubbleByCode.delete(code); }
  }
  for (const code of nextBubbleCodes) {
    const clubs = byCode.get(code);
    const colors = new Set(clubs.map(([, e]) => cupColorForClub(e)));
    // Bollen aggregerar FLERA klubbar — om de inte alla delar samma
    // cupfärg (bara möjligt när flera cuper är valda, se cupColorForClub)
    // används den delade färgen i stället för att godtyckligt välja en.
    const color = colors.size === 1 ? [...colors][0] : MAP_SHARED_COLOR;
    const centroid = COUNTRY_CENTROIDS[code];
    if (!centroid) continue;
    const existing = currentCountryBubbleByCode.get(code);
    if (existing && existing.count === clubs.length && existing.color === color) continue; // oförändrad — rör inte
    if (existing) existing.marker.remove();
    const el = countryBubbleElement(clubs.length, color);
    el.title = countryDisplayName(code) + " — " + clubs.length +
      " klubbar utan känd adress. Klicka för att visa dem enskilt.";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      expandedCountryCodes.add(code);
      renderContent();
    });
    const marker = new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(currentMap);
    currentCountryBubbleByCode.set(code, { marker, count: clubs.length, color });
  }

  const nextCountryNames = new Set([...(countryMap ? countryMap.keys() : [])]
    .filter((name) => expandedCountryCodes.has(countryMap.get(name).code)));
  for (const [name, entry] of currentCountryMarkerByKey) {
    if (!nextCountryNames.has(name)) { entry.marker.remove(); currentCountryMarkerByKey.delete(name); }
  }
  for (const name of nextCountryNames) {
    const cInfo = countryMap.get(name);
    const color = cupColorForClub(cInfo);
    const collapseFn = () => { expandedCountryCodes.delete(cInfo.code); renderContent(); };
    const existing = currentCountryMarkerByKey.get(name);
    if (existing && existing.color === color) {
      existing.marker.setPopup(
        new maplibregl.Popup({ offset: 12 }).setDOMContent(countryPopupBody(name, cInfo, collapseFn, mapYear)));
      continue;
    }
    if (existing) existing.marker.remove();
    const lngLat = countryGridLngLat(name, cInfo.code);
    if (!lngLat) continue; // okänd landskod (borde inte hända) — hoppa hellre än att krascha
    const marker = new maplibregl.Marker({ color, scale: 0.7 })
      .setLngLat(lngLat)
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(countryPopupBody(name, cInfo, collapseFn, mapYear)))
      .addTo(currentMap);
    currentCountryMarkerByKey.set(name, { marker, color });
  }
  const nextUnknown = new Set(unknownNames || []);
  for (const [name, marker] of currentUnknownMarkerByKey) {
    if (!nextUnknown.has(name)) { marker.remove(); currentUnknownMarkerByKey.delete(name); }
  }
  for (const name of nextUnknown) {
    if (currentUnknownMarkerByKey.has(name)) continue; // redan där, samma stabila rutnätsplats — rör inte
    const cups = (allClubCups && allClubCups.get(name)) || [];
    const marker = new maplibregl.Marker({ color: "#8a94a3" }) // grå — skiljer klubbarna utan känd adress från de med
      .setLngLat(unknownGridLngLat(name))
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(unknownPopupBody(name, cups, mapYear)))
      .addTo(currentMap);
    currentUnknownMarkerByKey.set(name, marker);
  }

  // "Visa landshistorik": en lila ringpin per land, förskjuten en bit
  // norr om landets centroid (HISTORY_PIN_OFFSET) så den aldrig hamnar
  // exakt ovanpå den (adresslösa) landsbollen på samma centroid — de två
  // ska gå att se och klicka på samtidigt. null = avstängd/ej redo,
  // rensa alla eventuella kvarvarande pinnar från förra gången den VAR
  // på (annars skulle de bli kvar efter att kryssrutan kryssats ur).
  const nextHistoryCodes = new Set(countryHistory ? countryHistory.keys() : []);
  for (const [code, entry] of currentHistoryMarkerByKey) {
    if (!nextHistoryCodes.has(code)) { entry.marker.remove(); currentHistoryMarkerByKey.delete(code); }
  }
  for (const [code, hEntry] of (countryHistory || new Map())) {
    const centroid = COUNTRY_CENTROIDS[code];
    if (!centroid) continue;
    const yearsKey = [...hEntry.years].sort().join(",");
    const existing = currentHistoryMarkerByKey.get(code);
    if (existing && existing.clubCount === hEntry.clubs.size && existing.teamCount === hEntry.teams.size &&
        existing.yearsKey === yearsKey) continue;
    if (existing) existing.marker.remove();
    const el = countryHistoryElement(code);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([centroid[0], centroid[1] + HISTORY_PIN_OFFSET])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(countryHistoryPopupBody(code, hEntry)))
      .addTo(currentMap);
    currentHistoryMarkerByKey.set(code, { marker, clubCount: hEntry.clubs.size, teamCount: hEntry.teams.size, yearsKey });
  }
}

// Städar upp en aktiv maplibregl.Map-instans när man lämnar Karta för en
// annan Stats-underflik (eller huvudflik) — createMap() nedan tar bara
// hand om det gamla instansen vid NÄSTA Karta-besök (currentMap.remove()
// precis innan en ny karta byggs), så en övergiven instans (kvarhållen
// WebGL-kontext + egen renderloop) kunde annars leva kvar i bakgrunden
// hur länge som helst, tills man råkade gå tillbaka till Karta. Misstänkt
// orsak till en rapporterad bugg: i Chrome (till skillnad från Safari,
// vars WebGL-/kompositorhantering verkar tåla en övergiven kontext
// bättre) kunde en sådan kvarglömd renderloop göra HELA sidans scroll
// trögstartad/låst på HELT ANDRA flikar (GPU-processen upptagen av en
// loop som aldrig fick städa sig själv), trots att varken CSS eller
// scroll-relaterad JS visade något fel. mapBoxEl/mapBoxKey nollställs
// också, så nästa Karta-besök bygger en helt ny container i stället för
// att försöka återansluta till en sedan länge bortkopplad nod.
export function destroyMapIfLeavingKarta() {
  if (!currentMap) return;
  stopMapPlay();
  currentMap.remove();
  currentMap = null;
  mapBoxEl = null;
  mapBoxKey = null;
  currentMapMarkerByKey = new Map();
  currentUnknownMarkerByKey = new Map();
  currentCountryMarkerByKey = new Map();
  currentCountryBubbleByCode = new Map();
  currentHistoryMarkerByKey = new Map();
  expandedCountryCodes = new Set();
}

function createMap(maplibregl, container, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups,
    countryHistory) {
  if (currentMap) { currentMap.remove(); currentMap = null; }
  currentMapMarkerByKey = new Map();
  currentUnknownMarkerByKey = new Map();
  currentCountryMarkerByKey = new Map();
  currentCountryBubbleByCode = new Map();
  currentHistoryMarkerByKey = new Map();
  expandedCountryCodes = new Set(); // ny karta = börja ihopfällt igen
  currentMap = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [15, 62], // ungefärligt Sverige-centrum, ersätts direkt av fitBounds nedan
    zoom: 4,
  });
  currentMap.addControl(new maplibregl.NavigationControl(), "top-right");
  paintMapMarkers(maplibregl, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups, countryHistory);
  // Landsnivåns markörer är RIKTIGA (om än ungefärliga) geografiska
  // positioner — till skillnad från Atlant-rutnätet (bara EN representativ
  // punkt räknas in där, se nedan) räknas VARJE lands centroid in i
  // inzoomningen, så t.ex. en internationell cup med lag från många länder
  // faktiskt zoomar ut till hela Europa/världen i stället för att klämma
  // ihop dem mot en enda punkt.
  const bounds = new maplibregl.LngLatBounds();
  for (const info of Object.values(geo)) bounds.extend([info.lng, info.lat]);
  for (const entry of (countryMap ? countryMap.values() : [])) {
    const centroid = COUNTRY_CENTROIDS[entry.code];
    if (centroid) bounds.extend(centroid);
  }
  // Historikpinnar för länder som HAR haft klubbar tidigare men inte i
  // det just nu visade läget (state.mapYear) skulle annars kunna hamna
  // helt utanför den automatiska inzoomningen.
  for (const code of (countryHistory ? countryHistory.keys() : [])) {
    const centroid = COUNTRY_CENTROIDS[code];
    if (centroid) bounds.extend(centroid);
  }
  if (unknownNames && unknownNames.length) bounds.extend(UNKNOWN_GRID_ORIGIN);
  if (!bounds.isEmpty()) currentMap.fitBounds(bounds, { padding: 40, maxZoom: 10 });
}
