/* schema.js — schema-, tidslinje- och bana-vyer. */

import { h, $ } from "../dom.js";
import { cohortKey } from "../domain/category.js";
import { slugifySv } from "../domain/club.js";
import {
  fmtTime, fmtDay, fmtDayLong, hasScheduledStart, matchTimeLabel, dayKey,
} from "../time.js";
import { chrome } from "./chrome.js";
import { renderHero, matchCard, countdownText } from "./match-ui.js";
import {
  splitRecentPlayedByCount, splitScheduleWindow, showAllPlayedButtonCount,
  loadMorePlayedButtons, loadMoreUpcomingButtons, isRetrospective,
  SCHEMA_RETRO_BATCH, SCHEMA_UPCOMING_BATCH,
} from "./reveal.js";
import { sheetMode, syncBottomStack } from "./sheets.js";

let state, cup, saveUi, render, renderContent, filtered, sorted, scoped;
let hasFilterSelection, isClubMatch, isFavoriteTeam, allActiveMatches;
let matchesViewFilter, clearViewFilters, outcomeRank, ensureMapLibre;
let getBracketSort, setBracketSort;

export function initSchema(deps) {
  ({
    state, cup, saveUi, render, renderContent, filtered, sorted, scoped,
    hasFilterSelection, isClubMatch, isFavoriteTeam, allActiveMatches,
    matchesViewFilter, clearViewFilters, outcomeRank, ensureMapLibre,
    getBracketSort, setBracketSort,
  } = deps);
}

let autoScrolledToNow = false;
let untimedPanelOpen = true;

export function setSchemaAutoScrolled(value) {
  autoScrolledToNow = value;
}

export function isSchemaView() {
  return state.view === "schema";
}

export function resetSchemaUi() {
  autoScrolledToNow = false;
  untimedPanelOpen = true;
  schemaSearchOpen = false;
  schemaSearchQuery = "";
  schemaSearchRenderDeferred = false;
  clearTimeout(schemaSearchDebounceTimer);
  schemaSearchDebounceTimer = null;
  destroyArenaMap();
}

export function schemaSearchFocusValue(active) {
  if (!active || active.id !== "schemaStartSearch") return null;
  return String(active.value ?? "");
}

export function captureSchemaSearchFocus() {
  const value = schemaSearchFocusValue(document.activeElement);
  if (value == null) return false;
  schemaSearchQuery = value;
  schemaSearchRenderDeferred = true;
  return true;
}

export function schemaUiSnapshot() {
  return {
    autoScrolledToNow,
    untimedPanelOpen,
    searchOpen: schemaSearchOpen,
    searchQuery: schemaSearchQuery,
    searchDeferred: schemaSearchRenderDeferred,
  };
}

function timeGroups(list, multiDay) {
  const groups = [];
  for (const m of list) {
    const key = hasScheduledStart(m)
      ? (multiDay ? dayKey(m.start) + " " + matchTimeLabel(m) : matchTimeLabel(m))
      : "Tid ej satt";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, start: m.start, items: [m] });
  }
  return groups;
}

function formatBreakDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours + " tim" + (rest ? " " + rest + " min" : "");
}

// Tidslinje (dagshuvuden, NU-linje, vätskepaus-indikator) — bruten ut ur
// renderSchema() så den kan återanvändas rakt av för Bana-vyn (alltid
// tidssorterad, oavsett state.sort som annars styr schemat).
function renderTimeline(main, list) {
  // Dagshuvuden/veckodagsetiketter visas när listan faktiskt spänner
  // över mer än en kalenderdag — oavsett om det beror på att inget
  // dagfilter är satt eller att flera dagar valts samtidigt.
  const multiDay = new Set(list.filter(hasScheduledStart).map((m) => dayKey(m.start))).size > 1;
  const now = Date.now();
  const today = dayKey(now);
  let nowPlaced = false;
  let lastDay = "";
  let prevGroupStart = null; // för vätskepaus-indikatorn
  const wrap = h("div", { class: "timeline" });
  for (const g of timeGroups(list, multiDay)) {
    const timed = hasScheduledStart(g.start);
    if (!timed) {
      const panel = h("details", {
        class: "untimed-panel",
        ...(untimedPanelOpen ? { open: "" } : {}),
      },
      h("summary", { class: "untimed-summary" },
        h("span", { class: "untimed-summary-title" }, "Tid ej satt"),
        h("span", { class: "untimed-summary-count" },
          g.items.length + " " + (g.items.length === 1 ? "match" : "matcher"))),
      h("div", { class: "untimed-panel-body" },
        h("div", { class: "slot-matches" }, g.items.map((m) => matchCard(m)))));
      panel.addEventListener("toggle", () => { untimedPanelOpen = panel.open; });
      wrap.append(panel);
      prevGroupStart = null;
      continue;
    }
    const gDay = dayKey(g.start);
    if (timed && multiDay && gDay !== lastDay) {
      lastDay = gDay;
      nowPlaced = nowPlaced || gDay > today;
      wrap.append(h("h2", { class: "day-h" },
        fmtDayLong.format(new Date(g.start))));
      prevGroupStart = null; // ny dag: räkna inte paus över dagsgränsen
    }
    if (timed && state.breakMinutes > 0 && prevGroupStart != null) {
      // Ledig tid = tid till nästa match minus föregåendes speltid,
      // inte bara mellanrummet mellan två starttider.
      const rawGapMin = Math.round((g.start - prevGroupStart) / 60000);
      const gapMin = rawGapMin - state.matchMinutes;
      if (gapMin >= state.breakMinutes) {
        wrap.append(h("div", { class: "break-line" },
          h("span", null,
            "🥤 " + formatBreakDuration(gapMin) +
            " till nästa match — dags för mat/vätska")));
      }
    }
    prevGroupStart = timed ? g.start : null;
    // Linjen ska passera en tidslucka först när matcherna i den är SLUT,
    // inte i samma sekund som de börjar. Utan speltiden hoppade den förbi
    // hela blocket en minut efter avkast, och en match som pågick låg
    // plötsligt ovanför "nu".
    // Rutan är t.ex. 40 minuter i Göteborg Cup, men SJÄLVA matchen är
    // kortare — 2×15 med halvlek tar drygt trettio, resten är planbyte.
    // Schemat säger bara rutans längd, aldrig speltiden, så "pågår" får
    // avgöras av resultaten i stället för av klockan: så länge någon
    // match i blocket saknar slutresultat spelas det. Är alla klara står
    // vi i bytet före nästa avspark, och då hör "nu" hemma längre ner.
    const slutar = g.start + state.matchMinutes * 60000;
    const framtida = g.start > now;
    const alltKlart = g.items.every((m) => m.res && m.res.fin);
    // "Nu" ligger antingen i en LUCKA mellan två block eller MITT I ett.
    // En linje mellan blocken duger bara i det första fallet: ritad
    // ovanför ett block som redan spelar läses den som att 10:20-
    // matcherna inte börjat, fast klockan är 10:44. Pågår blocket märks
    // det därför upp självt i stället, och linjen uteblir.
    const pågår = !framtida && slutar > now && !alltKlart;
    const nuHär = timed && !nowPlaced && gDay === today && (pågår || framtida);
    if (nuHär) {
      nowPlaced = true;
      if (!pågår) {
        wrap.append(h("div", { class: "nowline", id: "nowline" },
          h("span", null,
            "NU " + fmtTime.format(new Date(now)) +
            " · nästa match " + countdownText(g.start))));
      }
    }
    wrap.append(h("div", { class: "slot" + (pågår ? " now" : "") },
      h("div", { class: "rail" },
        timed ? matchTimeLabel({ start: g.start }) : "Tid ej satt",
        timed && multiDay
          ? h("small", null, fmtDay.format(new Date(g.start))) : null),
      h("div", { class: "slot-matches" },
        // id="nowline" följer med hit så automatskrollen hittar rätt
        // ställe även när ingen linje ritats.
        // Ingen sluttid här: den enda vi känner till är rutans, och den
        // ligger några minuter efter slutsignalen.
        pågår ? h("div", { class: "slot-now", id: "nowline" },
          "NU " + fmtTime.format(new Date(now)) + " · pågår") : null,
        g.items.map((m) => matchCard(m)))));
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

// Hur många speldagar cupen BRUKAR ha, ur arkivindexets färdigspelade år
// (max av de tre senaste — snittet skulle dras ner av corona-år och
// enstaka nedbantade upplagor). null = ingen historik att jämföra med.
function typicalMatchDays() {
  const eds = ((state.archiveIndex && state.archiveIndex[state.cupId] || {}).editions || [])
    .filter((e) => !e.preliminary && e.matches > 0 && e.days > 0);
  if (!eds.length) return null;
  return Math.max(...eds.slice(-3).map((e) => e.days));
}

// Innevarande cups schema är publicerat men inte färdigt: inget spelat än
// OCH schemat är kortare/glesare än en färdig upplaga brukar vara.
// Arrangören släpper klasser och tider löpande fram till cupstart, så
// talen man ser är en ögonblicksbild som växer.
//
// Antalet SPELDAGAR mot historiken är den signal som faktiskt skiljer ett
// halvpublicerat schema från ett färdigt: andelen otidsatta matcher duger
// inte ensam. Göteborg Cup 2026 hade 47 % otidsatta (bara första helgen av
// två publicerad, 3 av normalt 6 dagar) — under en ren 50 %-tröskel, alltså
// osynlig precis när upplysningen behövs som mest. Örebro 2026 har tvärtom
// ett komplett schema där bara slutspelsmatcherna väntar på tid (12 av 416),
// och dess 3 dagar ÄR dess normala. null = inget att flagga.
function pendingSchedule() {
  const ms = state.matches;
  if (!ms.length) return null;
  if (ms.some((m) => m.res && (m.res.fin || m.res.live))) return null;
  const timed = ms.filter(hasScheduledStart).length;
  const untimed = ms.length - timed;
  if (!untimed) return null;
  // start = svensk väggtid kodad som UTC-epoch-ms (se normalize i api.js),
  // så heltalsdivisionen ger rätt svenskt kalenderdatum direkt.
  const days = new Set();
  for (const m of ms) if (hasScheduledStart(m)) days.add(Math.floor(m.start / 86400000));
  const typicalDays = typicalMatchDays();
  const short = typicalDays != null && days.size < typicalDays;
  // Utan historik att jämföra med får andelen otidsatta avgöra (samma
  // trubbiga fallback som tidigare — en cup utan arkiv har inget bättre).
  if (!short && timed * 2 > ms.length) return null;
  const classes = new Set();
  for (const m of ms) if (m.catName) classes.add(m.catName);
  return {
    total: ms.length, timed, untimed, classes: classes.size,
    days: days.size, typicalDays: short ? typicalDays : null,
  };
}

// Ett kryss gömmer upplysningen för resten av den här appsessionen,
// per cup. Spara den inte permanent: när arrangören fyllt på schemat
// kan innehållet vara relevant igen vid ett senare besök.
const dismissedPendingScheduleCups = new Set();

// För den som ännu inte har valt favoritlag är frågan "vilket lag?"
// själva ingången till schemat. Sökningen använder samma state-filter som
// verktygsraden, men ritar bara om sin redan monterade träfflista medan man
// skriver — en render per tangent skulle bygga om inputen och tappa fokus.
// Öppnad via "Sök annat lag" (till skillnad från när den visas för att
// appen inte vet något om besökaren). Modulnivå, inte state: rent
// UI-läge som ska nollställas vid sidladdning och cupbyte.
let schemaSearchOpen = false;
let schemaSearchQuery = "";
let schemaSearchDebounceTimer = null;
let schemaSearchRenderDeferred = false;
const SCHEMA_SEARCH_MIN_LENGTH = 2;
const SCHEMA_SEARCH_DEBOUNCE_MS = 180;

// medTillbaka: sökrutan öppnades av någon som HAR ett favoriturval att
// återvända till, och behöver därför en väg tillbaka.
function renderSchemaStartSearch(main, medTillbaka) {
  const candidates = [];
  const teams = new Map();
  const cats = new Map();
  const clubs = new Map();
  // Bara den laddade cupens matcher: arkivår och andra cuper ska inte smyga
  // in bland förslagen i den här första vägen in i det aktuella schemat.
  for (const m of state.matches) {
    if (m.catId != null && m.catName && !cats.has(m.catId)) cats.set(m.catId, m.catName);
    for (const side of [m.home, m.away]) {
      if (side.club && side.club.trim() && side.id != null) {
        const clubName = side.club.trim();
        const key = slugifySv(clubName);
        if (!clubs.has(key)) clubs.set(key, { name: clubName, teamIds: new Set() });
        clubs.get(key).teamIds.add(side.id);
      }
      if (side.id != null && side.name && !teams.has(side.id)) {
        // Klassen måste följa med: samma lagnamn finns i flera klasser
        // (104 av namnen i Göteborg Cup 2026), och utan den blir listan
        // tre identiska rader där bara en är laget man menar.
        teams.set(side.id, { name: side.name, club: side.club || "", catName: m.catName });
      }
    }
  }
  // Klubb är en egen träfftyp: valet visar samtliga klubbens lag i
  // cupen. Lägg den före de enskilda lagen så en sökning på t.ex.
  // "Sävehof" inte begraver klubbvalet under tolv lagträffar.
  for (const club of clubs.values()) {
    candidates.push({
      type: "club", label: club.name,
      hint: club.teamIds.size + " lag",
      teamIds: [...club.teamIds], search: slugifySv(club.name),
    });
  }
  for (const [id, team] of teams) {
    // Födelseåret är stabilt mellan cupupplagor; "F15" blir fel
    // redan nästa säsong medan "F2011" fortfarande beskriver samma kull.
    // Falla bara tillbaka på ålderskoden när arrangörens klassnamn
    // faktiskt saknar ett entydigt födelseår.
    const kull = team.catName
      ? (cohortKey(team.catName) || HB.shortCat(team.catName)) : "";
    candidates.push({
      type: "team", id, label: team.name, hint: kull,
      // Klubbnamnet ingår inte alltid i arrangörens lagnamn. Laget ska
      // ändå hittas när man skriver klubbens namn.
      search: slugifySv(team.name + " " + team.club + " " + kull + " " +
        (team.catName || "")),
    });
  }
  for (const [id, name] of cats) {
    const kull = cohortKey(name) || HB.shortCat(name);
    candidates.push({
      type: "cat", id, label: name, hint: kull,
      // "F2011" ska hitta det långa arrangörsnamnet oavsett vilken
      // åldersetikett just den här cupupplagan använder.
      search: slugifySv(kull + " " + name),
    });
  }

  const inputId = "schemaStartSearch";
  const listId = "schemaStartSearchResults";
  const input = h("input", {
    id: inputId, class: "search", type: "search",
    placeholder: "Skriv en klubb, ett lag eller en klass, t.ex. F2011",
    autocomplete: "off", "aria-autocomplete": "list", "aria-controls": listId,
  });
  input.value = schemaSearchQuery;
  const list = h("div", {
    id: listId, class: "autocomplete-list schema-start-results", role: "listbox",
    "aria-label": "Klubbar, lag och klasser",
  });
  list.hidden = true;

  const choose = (candidate) => {
    clearTimeout(schemaSearchDebounceTimer);
    schemaSearchQuery = "";
    schemaSearchRenderDeferred = false;
    // Hela cupens lag och klasser söks igenom. Växla därför även till
    // cupomfattning så att scoped() inte tar bort den valda träffen igen.
    state.scope = "all";
    if (candidate.type === "club") state.teams = new Set(candidate.teamIds);
    else if (candidate.type === "team") state.teams = new Set([candidate.id]);
    else state.cats = new Set([candidate.id]);
    saveUi();
    render();
  };
  const showMatches = (q, allowDetached = false) => {
    // Timern kan hinna löpa precis efter att en bakgrundsomritning bytt
    // ut fältet. Den gamla instansen ska då inte bygga en osynlig lista.
    if ((!allowDetached && !input.isConnected) ||
        q !== slugifySv(schemaSearchQuery.trim())) return;
    const matches = candidates
      .filter((candidate) => candidate.search.includes(q))
      .sort((a, b) => {
        const exactA = slugifySv(a.label) === q ? 0 : 1;
        const exactB = slugifySv(b.label) === q ? 0 : 1;
        if (exactA !== exactB) return exactA - exactB;
        const ai = a.search.indexOf(q);
        const bi = b.search.indexOf(q);
        const typeRank = { club: 0, team: 1, cat: 2 };
        return ai - bi || typeRank[a.type] - typeRank[b.type] ||
          a.label.localeCompare(b.label, "sv");
      })
      .slice(0, 12);
    list.hidden = !matches.length;
    list.replaceChildren(...matches.map((candidate) =>
      h("button", {
        class: "autocomplete-item schema-start-result", type: "button", role: "option",
        onclick: () => choose(candidate),
      },
      h("span", null, candidate.label,
        candidate.hint
          ? h("span", { class: "schema-start-result-cat" }, " " + candidate.hint)
          : null),
      h("span", { class: "schema-start-result-kind" },
        candidate.type === "club" ? "Klubb" :
          candidate.type === "team" ? "Lag" : "Klass"))));
  };
  input.addEventListener("input", () => {
    schemaSearchQuery = input.value;
    const q = slugifySv(schemaSearchQuery.trim());
    clearTimeout(schemaSearchDebounceTimer);
    if (q.length < SCHEMA_SEARCH_MIN_LENGTH) {
      list.hidden = true;
      list.replaceChildren();
      return;
    }
    schemaSearchDebounceTimer = setTimeout(
      () => showMatches(q), SCHEMA_SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener("blur", () => setTimeout(() => {
    // Ett val i förslagslistan hinner köra först och tar bort fältet.
    // Bara en vanlig blur (t.ex. tryck utanför eller "Klar" på mobilens
    // tangentbord) ska verkställa den uppskjutna bakgrundsomritningen.
    if (!schemaSearchRenderDeferred || !input.isConnected) return;
    schemaSearchRenderDeferred = false;
    renderContent();
  }, 0));
  // Om en bakgrundsomritning skedde medan användaren skrev finns texten
  // redan kvar. Återskapa förslagen direkt; debounce har redan skett på
  // tangenttryckningen som satte värdet.
  const initialQuery = slugifySv(schemaSearchQuery.trim());
  if (initialQuery.length >= SCHEMA_SEARCH_MIN_LENGTH) showMatches(initialQuery, true);

  main.append(h("section", { class: "schema-start-search", "aria-labelledby": inputId + "Label" },
    h("label", { id: inputId + "Label", for: inputId }, "Vad vill du följa?"),
    h("div", { class: "autocomplete-wrap" }, input, list),
    h("div", { class: "row" },
      h("button", {
        class: "btn", type: "button",
        onclick: () => {
          schemaSearchOpen = false; schemaSearchQuery = "";
          schemaSearchRenderDeferred = false;
          state.schemaShowAllCup = true; renderContent();
        },
      }, "Visa hela cupen"),
      medTillbaka ? h("button", {
        class: "btn", type: "button",
        onclick: () => {
          schemaSearchOpen = false; schemaSearchQuery = "";
          schemaSearchRenderDeferred = false; renderContent();
        },
      }, "Tillbaka till dina lag") : null)));
}

// Tredje mobilraden består av en scrollbar urvalsdel och en fast
// ordningsknapp längst till höger. Knappen ska alltid gå att nå utan att
// ta bort någon klass-/lagflik ur DOM:et eller påverka "Alla"-läget.
function mobileSelectionOrderControls(kind) {
  const schema = kind === "schema";
  const tables = kind === "tabeller";
  const playoffSort = !schema && !tables
    ? (getBracketSort() || {
        col: "tid", dir: state.playoffTimeOrder === "desc" ? -1 : 1,
      }) : null;
  const desc = schema ? state.timeOrder === "desc"
    : tables ? state.tableSortOrder === "desc"
    : playoffSort.dir < 0;
  if (tables) {
    const labels = { rank: "Nummer", name: "Namn", points: "Poäng" };
    const select = h("select", {
      class: "selection-sort-select", "aria-label": "Sortera tabellen efter",
      onchange: (event) => {
        state.tableSortKey = event.target.value;
        // Naturligt för nummer/namn är stigande; för poäng vill man se
        // topplagen först. Användaren kan vända direkt med pilen bredvid.
        state.tableSortOrder = state.tableSortKey === "points" ? "desc" : "asc";
        saveUi(); renderContent();
      },
    }, Object.entries(labels).map(([value, label]) => h("option", {
      value, ...(state.tableSortKey === value ? { selected: "" } : {}),
    }, label)));
    const title = (desc ? "Fallande" : "Stigande") + " ordning efter " +
      labels[state.tableSortKey].toLowerCase();
    const direction = h("button", {
      class: "selection-order-toggle", type: "button", title,
      "aria-label": title + " — byt riktning",
      onclick: () => {
        state.tableSortOrder = desc ? "asc" : "desc";
        saveUi(); renderContent();
      },
    }, desc ? "↓" : "↑");
    return h("div", { class: "selection-order-controls" }, select, direction);
  }

  const playoffLabels = {
    omgang: "Omgång", nr: "Nummer", lag: "Lag",
    resultat: "Resultat", tid: "Tid", bana: "Bana",
  };
  const sortLabel = schema ? "Tid" : (playoffLabels[playoffSort.col] || "Tid");
  const title = schema
    ? (desc
        ? "Senaste match först — byt till tidigaste först"
        : "Tidigaste match först — byt till senaste först")
    : (desc ? "Fallande ordning efter " : "Stigande ordning efter ") +
      sortLabel.toLowerCase() + " — byt riktning";
  return h("button", {
    class: "selection-order-toggle", type: "button", title,
    "aria-label": title,
    onclick: () => {
      if (schema) {
        state.timeOrder = desc ? "asc" : "desc";
        saveUi();
      } else {
        setBracketSort({ col: playoffSort.col, dir: desc ? 1 : -1 });
        if (getBracketSort().col === "tid") {
          state.playoffTimeOrder = getBracketSort().dir > 0 ? "asc" : "desc";
        }
        saveUi();
      }
      renderContent();
    },
  }, sortLabel + (desc ? " ↓" : " ↑"));
}

function renderMobileSelectionBar(buttons, kind) {
  if (!sheetMode()) return;
  const selectionBar = $("#currentSelectionBar");
  if (!selectionBar) return;
  selectionBar.replaceChildren(
    h("span", { class: "selection-view-label", "aria-hidden": "true" }, "Visa:"),
    h("div", {
      class: "selection-tabs-scroll",
      // group, inte tablist: i Schema är brickorna ikryssbara växlar
      // (aria-pressed) och flera kan vara på samtidigt.
      role: kind === "schema" ? "group" : "tablist",
      "aria-label": kind === "schema"
        ? "Visa alla, eller kryssa i de klasser och lag du vill se"
        : "Visa alla eller en vald grupp",
    }, ...buttons),
    mobileSelectionOrderControls(kind));
  selectionBar.hidden = !chrome.currentMenuOpen;
  requestAnimationFrame(syncBottomStack);
}

// Samma tredje navigationsnivå i båda layouterna. På mobil får den även
// plats med sorteringskontrollerna; på dator ligger klass-/lagvalen som
// en egen rad direkt under Schema/Tabeller/Slutspel/Bana.
export function renderSelectionBar(buttons, kind) {
  if (sheetMode()) {
    renderMobileSelectionBar(buttons, kind);
    return;
  }
  const subNav = $("#desktopSubNav");
  if (!subNav) return;
  subNav.querySelector(".desktop-selection-group")?.remove();
  if (!buttons.length) return;
  subNav.append(h("span", {
    class: "desktop-selection-group",
    role: kind === "schema" ? "group" : "tablist",
    "aria-label": kind === "schema"
      ? "Visa alla, eller kryssa i de klasser och lag du vill se"
      : "Visa alla eller en vald grupp",
  }, ...buttons));
}

// Urvalet sparas som en STRÄNG, inte en mängd: "all", "none" eller en
// kommaseparerad lista med nycklar. Då går den oförändrad genom sparning,
// delningslänk (?ssel=) och tillbaka-stacken utan att en enda rad utanför
// den här filen behöver veta att den kan innehålla flera värden. En gammal
// länk med ett ensamt värde är en lista med ett element.
function selectedKeys() {
  const raw = state.schemaSelectionKey || "all";
  if (raw === "all" || raw === "none") return raw;
  return new Set(raw.split(",").filter(Boolean));
}

function setSelectedKeys(set) {
  state.schemaSelectionKey = set.size ? [...set].join(",") : "none";
}

function applySchemaSelection(main, matches) {
  const choices = [];
  for (const id of state.cats) {
    const match = matches.find((m) => m.catId === id);
    if (!match) continue;
    choices.push({
      key: "cat:" + String(id),
      label: cohortKey(match.catName) || HB.shortCat(match.catName) || match.catName,
      title: match.catName,
      matches: (m) => m.catId === id,
    });
  }
  for (const id of state.teams) {
    const match = matches.find((m) => m.home.id === id || m.away.id === id);
    if (!match) continue;
    const side = match.home.id === id ? match.home : match.away;
    const cohort = cohortKey(match.catName) || HB.shortCat(match.catName);
    choices.push({
      key: "team:" + String(id),
      label: side.name + (cohort ? " · " + cohort : ""),
      title: side.name + (match.catName ? " · " + match.catName : ""),
      matches: (m) => m.home.id === id || m.away.id === id,
    });
  }

  // Ett enda val ger samma resultat i "Alla" och i valets egen bricka.
  // Visa därför tredje nivån först när det faktiskt finns något att växla.
  if (choices.length < 2) {
    state.schemaSelectionKey = "all";
    renderSelectionBar([], "schema");
    return matches;
  }
  // Nycklar som inte längre finns i filtret städas bort; blir inget kvar
  // faller vi tillbaka på alla i stället för att visa en tom vy man inte
  // valt själv.
  let valda = selectedKeys();
  if (valda instanceof Set) {
    const giltiga = new Set(choices.map((c) => c.key));
    valda = new Set([...valda].filter((k) => giltiga.has(k)));
    if (!valda.size) state.schemaSelectionKey = "all";
    else setSelectedKeys(valda);
  }

  const alltValt = state.schemaSelectionKey === "all";
  const inget = state.schemaSelectionKey === "none";
  const isOn = (key) => alltValt || (valda instanceof Set && valda.has(key));
  const toggla = (key) => {
    // Från "alla" betyder första trycket "bara den här" — annars hade man
    // fått bocka ur allt man inte ville se, ett i taget.
    const bas = alltValt ? new Set() : new Set(valda instanceof Set ? valda : []);
    if (bas.has(key)) bas.delete(key);
    else bas.add(key);
    // Alla ibockade är samma sak som "alla", och sparas som det.
    if (bas.size === choices.length) state.schemaSelectionKey = "all";
    else setSelectedKeys(bas);
    saveUi(); renderContent();
  };

  const buttons = [
    h("button", {
      class: "table-group-tab selection-all" + (alltValt ? " on" : ""),
      type: "button", "aria-pressed": String(alltValt),
      title: "Alla valda matcher",
      onclick: () => { state.schemaSelectionKey = "all"; saveUi(); renderContent(); },
    }, "Alla"),
    ...choices.map((choice) => h("button", {
      class: "table-group-tab" + (isOn(choice.key) ? " on" : ""),
      type: "button", "aria-pressed": String(isOn(choice.key)),
      title: choice.title, "aria-label": choice.title,
      onclick: () => toggla(choice.key),
    }, choice.label)),
  ];
  renderSelectionBar(buttons, "schema");

  if (alltValt) return matches;
  if (inget) return [];
  return matches.filter((m) => choices.some((c) => valda.has(c.key) && c.matches(m)));
}

export function renderSchema(main) {
  renderHero(main);
  const pending = pendingSchedule();
  if (pending && !dismissedPendingScheduleCups.has(state.cupId)) {
    const info = h("div", { class: "banner banner-info" },
      h("button", {
        class: "banner-close", type: "button",
        "aria-label": "Stäng informationen om schemat",
        onclick: () => {
          dismissedPendingScheduleCups.add(state.cupId);
          info.remove();
        },
      }, "×"),
      h("p", null,
        h("strong", null, "Schemat är inte klart än. "),
        pending.timed === 0
          ? "Inga speltider är satta ännu (" + pending.total + " matcher i " +
            pending.classes + " klasser är publicerade)"
          : pending.typicalDays
            // Det mest talande: cupen brukar spelas över fler dagar än det
            // som hunnit publiceras (Göteborg Cup: en av två helger).
            ? "Hittills är " + pending.days + " speldagar publicerade — " +
              cup().name + " brukar spelas över " + pending.typicalDays +
              " — och " + pending.untimed + " av " + pending.total +
              " matcher saknar fortfarande tid"
            : pending.untimed + " av " + pending.total +
              " matcher saknar fortfarande speltid",
        ". Arrangören fyller på med fler klasser och tider ända fram till cupstart, " +
        "så antalen här växer de närmaste veckorna."),
      h("p", null,
        "Titta in igen om några dagar. När tiderna är på plats kan du filtrera fram " +
        "just dina matcher och lägga dem i kalendern via “Dela”" +
        " → “📅 Kalender (.ics)” — de följer sedan med automatiskt i din telefon."));
    main.append(info);
  }
  // Har man bett om sökrutan går den före det automatiska favoriturvalet.
  // Utan den vägen fanns bara "Visa hela cupen" (över tusen kort) för den
  // som ville titta på ett ANNAT lag än sina egna — och ingen väg alls
  // tillbaka till frågan "vilket lag?".
  if (!hasFilterSelection() && schemaSearchOpen) {
    renderSchemaStartSearch(main, true);
    return;
  }
  const hasSelection = hasFilterSelection();
  let automaticMatches = null;
  let automaticLabel = "";
  if (!hasSelection) {
    const cupMatches = allActiveMatches();
    const isFavoriteMatch = (m) =>
      isFavoriteTeam(m.home.name, m.catName) ||
      isFavoriteTeam(m.away.name, m.catName);
    const favoriteMatches = cupMatches.filter(isFavoriteMatch);
    // Samma klubbkälla måste styra både hero-karusellen och schemalistan.
    // Tidigare krävde listan dessutom en localStorage-flagga
    // (hasChosenClub), medan karusellen nöjde sig med klubbnamnet i
    // headern. I en ny webbläsare kunde karusellen därför visa fem
    // Alingsås-matcher samtidigt som listan frågade "Vad vill du följa?".
    // Har headerns klubb matcher i cupen är det det urvalet som gäller.
    const clubMatches = favoriteMatches.length
      ? [] : cupMatches.filter(isClubMatch);
    // Dag och matchstatus räcker avsiktligt inte för att öppna schemat på
    // egen hand (se hasFilterSelection), men om användaren redan valt dem
    // ska även det automatiska favorit-/klubburvalet respektera valet.
    const visibleCupMatches = cupMatches.filter((m) => {
      if (state.days.size && !state.days.has(dayKey(m.start))) return false;
      if (state.matchFilter === "upcoming" && m.res && m.res.fin) return false;
      if (state.matchFilter === "played" && !(m.res && m.res.fin)) return false;
      return true;
    });

    if (state.schemaShowAllCup) {
      // filtered() börjar i scoped(), vilket normalt är favoritklubben.
      // Här är avsikten uttryckligen hela cupen, så behåll bara de övriga
      // vyvalen som fortfarande kan vara aktiva (dag/matchstatus).
      automaticMatches = visibleCupMatches;
      // Hela cupen är över tusen matcher i en stor cup — vägen tillbaka
      // måste finnas kvar, annars sitter man fast i den listan tills man
      // laddar om eller byter cup. Etiketten sätts bara när det FINNS ett
      // favoriturval att gå tillbaka till.
      if (favoriteMatches.length) automaticLabel = "back:dina lag";
      else if (cupMatches.some(isClubMatch)) automaticLabel = "back:din klubb";
    } else if (favoriteMatches.length) {
      automaticMatches = visibleCupMatches.filter(isFavoriteMatch);
      automaticLabel = "Visar dina lag";
    } else if (clubMatches.length) {
      automaticMatches = visibleCupMatches.filter(isClubMatch);
      automaticLabel = "Visar din klubb";
    } else {
      // Klubben ÄR vald, men förekommer inte i den publicerade delen av
      // cupen. Den generiska startfrågan ensam såg då ut som om länken
      // hade tappat klubbvalet, trots att både URL och header var rätt.
      // Förklara skillnaden och låt sökrutan finnas kvar för den som vill
      // följa ett annat lag i just den här cupen.
      if (cupMatches.length) {
        main.append(h("div", { class: "banner banner-info" },
          h("p", null,
            h("strong", null, state.favoriteClub + " är vald. "),
            "Klubben finns ännu inte bland de lag som " + cup().name +
              " har publicerat matcher för."),
          h("p", null,
            "Klubbvalet ligger kvar. Om fler lag publiceras visas " +
              state.favoriteClub + " automatiskt här.")));
      }
      renderSchemaStartSearch(main);
      return;
    }
  }

  if (automaticLabel) {
    const tillbaka = automaticLabel.startsWith("back:");
    main.append(h("div", { class: "banner" },
      h("div", { class: "row" },
        h("span", null, tillbaka ? "Visar hela cupen" : automaticLabel),
        h("button", {
          class: "btn", type: "button",
          onclick: () => {
            state.schemaShowAllCup = !tillbaka;
            state.schemaOlderRevealCount = 0;
            state.schemaNewerRevealCount = 0;
            renderContent();
          },
        }, tillbaka ? "Visa bara " + automaticLabel.slice(5) : "Visa hela cupen"),
        // Vägen till frågan "vilket lag?" för den som vill titta på ett
        // ANNAT lag än sina egna — utan den fanns bara hela cupens
        // tusen kort att bläddra i.
        h("button", {
          class: "btn", type: "button",
          onclick: () => {
            schemaSearchOpen = true;
            state.schemaShowAllCup = false;
            renderContent();
          },
        }, "Sök annat lag"))));
  }
  const schemaMatches = (automaticMatches || filtered()).filter(matchesViewFilter);
  const list = sorted(applySchemaSelection(main, schemaMatches));
  if (!list.length) {
    if (state.schemaSelectionKey === "none") {
      main.append(h("div", { class: "banner" },
        h("p", null, "Inga klasser eller lag är ibockade."),
        h("button", {
          class: "btn", type: "button",
          onclick: () => { state.schemaSelectionKey = "all"; saveUi(); renderContent(); },
        }, "Visa alla")));
      return;
    }
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
        h("p", null, "Inga matcher matchar filtren."),
        h("button", {
          class: "btn", type: "button",
          onclick: clearViewFilters,
        }, "Rensa filter")));
    }
    return;
  }

  const { visible, pastBtn, futureBtn } = schemaMatchWindow(list);
  // Äldre matcher hamnar överst i asc-ordning (äldst→nyast) och underst
  // i desc-ordning (nyast/kommande överst) — knapparna placeras därefter.
  // Grupperad sortering vänder inte DOM:en, men samma knappar speglar
  // ändå tidslinjens riktning så "visa fler kommande" sitter där de nya
  // korten dyker upp.
  const desc = state.sort === "tid" && state.timeOrder === "desc";
  if (!desc && pastBtn) main.append(pastBtn);
  if (desc && futureBtn) main.append(futureBtn);
  if (state.sort === "tid") {
    renderTimeline(main, visible);
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
    for (const m of visible) {
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
      card.prepend(h("div", { class: "when" }, matchTimeLabel(m, fmtDay)));
      sect.append(card);
    }
    main.append(wrap);
  }
  if (!desc && futureBtn) main.append(futureBtn);
  if (desc && pastBtn) main.append(pastBtn);
}

// Antalsbaserat fönster runt NU: senast spelade + nästa 20 kommande.
// "Senaste timmen" gav noll matcher i en gles cup och femtio i en tät;
// Åhus-dagen är 600+ kommande kort om man inte tar ett tak.
function schemaMatchWindow(list) {
  const retro = isRetrospective(list);
  const recentCount = retro ? SCHEMA_RETRO_BATCH : state.recentMatchCount;
  const pastBatch = retro ? SCHEMA_RETRO_BATCH : state.revealBatchSize;
  const futureBatch = SCHEMA_UPCOMING_BATCH;
  const { visible, hiddenPast, hiddenFuture } = splitScheduleWindow(list, {
    recentCount,
    olderExtra: state.schemaOlderRevealCount,
    upcomingCount: SCHEMA_UPCOMING_BATCH,
    newerExtra: state.schemaNewerRevealCount,
  });
  const pastBtn = loadMorePlayedButtons(hiddenPast, pastBatch,
    state.timeOrder === "desc" ? "↓" : "↑",
    () => { state.schemaOlderRevealCount += pastBatch; renderContent(); },
    () => { state.schemaOlderRevealCount = Infinity; renderContent(); });
  const futureBtn = loadMoreUpcomingButtons(hiddenFuture, futureBatch,
    state.timeOrder === "desc" ? "↑" : "↓",
    () => { state.schemaNewerRevealCount += futureBatch; renderContent(); },
    () => { state.schemaNewerRevealCount = Infinity; renderContent(); });
  return { visible, pastBtn, futureBtn };
}

// Döljer gamla spelade matcher bakom en knapp, så en lång lista (ett fullt
// schema) blir överskådlig — behåller alltid ALLA kommande/pågående
// matcher plus spelade matcher från de senaste cutoffHours timmarna.
// revealExtra öppnar upp DE NÄRMAST cutoff (dvs de senast spelade av de
export function renderArenaView(main) {
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

  renderArenaPlaceBlock(main, arenas);

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

// --- Bana-vyns platsblock (adress + karta) -------------------------------
// Banorna bär bara ett NAMN i matchdatan ("Bana 14", "Noltorpshallen 2").
// HB.api.arenaGeo (se arenaGeoFromStore i api.js / arenas_from_store i
// scripts/fetch_cupmanager.py) kopplar namnet till en PLATS med adress och
// koordinater. Bara klassiska Cup Manager-cuper har datan — ProCup och
// Gothia exponerar ingen arenaadress alls, och deras banor får därför
// inget platsblock (samma begränsning som Karta-flikens klubbadresser).
//
// Flera banor delar ofta plats: Åhus Beach har 19 banor på EN adress
// eftersom de ligger utspridda på samma inhägnade festivalområde, och
// Noltorpshallen 1/2/3 är en hall. Därför grupperas nålarna på loc
// (location-id), inte på banans namn — annars hade de lagts i en hög på
// exakt samma punkt.
function arenaGeoFor(name) {
  return (HB.api.arenaGeo[state.cupId] || {})[name] || null;
}

// Adressdatan kan saknas trots att cupen i övrigt är laddad: loadCup()
// läser i FÖRSTA hand localStorage-cachen, och poster skrivna innan
// arenas-fältet infördes (2026-08-07) har det inte. Snapshot-vägen som
// annars fyller fältet körs bara när det inte finns NÅGON cache, och för
// en avslutad cup görs ingen live-hämtning heller (refreshTtl är lång) —
// utan den här lata hämtningen skulle Bana-vyn sakna adress ända tills
// cachen en dag naturligt förnyas. Samma princip som ensureCupClubGeo.
const arenaGeoStatus = {}; // cupId -> "loading" | "done"

export function ensureCupArenaGeo(cupId) {
  if (HB.api.arenaGeo[cupId] || arenaGeoStatus[cupId]) return;
  const c = HB.allCups().find((x) => x.id === cupId);
  // ProCup/Gothia (dataUrl-cuper) har ingen arenaadress i källan alls —
  // markera som färdig direkt i stället för att hämta en snapshot som
  // inte finns.
  if (!c || c.dataUrl) { arenaGeoStatus[cupId] = "done"; return; }
  arenaGeoStatus[cupId] = "loading";
  HB.api.fetchSharedSnapshot(c, 0)
    .then((snapshot) => {
      HB.api.arenaGeo[cupId] = snapshot.arenas || {};
      arenaGeoStatus[cupId] = "done";
      // Skriv tillbaka till cachen så nästa besök slipper hämta om hela
      // snapshotten (Åhus är 6382 matcher) bara för adresserna.
      if (state.cupId === cupId && state.matches.length) {
        HB.api.writeCache(c, state.matches, state.loadedAt);
      }
      if (state.view === "bana" && state.cupId === cupId) renderContent();
    })
    .catch(() => { HB.api.arenaGeo[cupId] = {}; arenaGeoStatus[cupId] = "done"; });
}

// [{loc, venue, street, city, lat, lng, arenas:[banor], matches:n}] för
// cupens alla banor med känd adress — en post per PLATS.
function arenaPlaces(arenas) {
  const byLoc = new Map();
  for (const a of arenas) {
    const g = arenaGeoFor(a);
    if (!g) continue;
    const key = g.loc != null ? String(g.loc) : g.lat + "," + g.lng;
    if (!byLoc.has(key)) {
      byLoc.set(key, { key, venue: g.venue, street: g.street, city: g.city,
                        lat: g.lat, lng: g.lng, arenas: [], matches: 0 });
    }
    byLoc.get(key).arenas.push(a);
  }
  for (const p of byLoc.values()) {
    p.matches = scoped().filter((m) => p.arenas.includes(m.arena)).length;
  }
  return [...byLoc.values()];
}

// Platsens rubrik: location-namnet ("Estrad", "Noltorpshallen"), med
// gatan som reserv när platsen saknar namn. Popupen visar adressen på
// egen rad under, så rubriken utelämnas när den skulle bli en ren
// dubblett av den (en namnlös plats där rubrik och adress är samma gata).
function placeLabel(place) {
  return (place.venue || "").trim() || place.street || place.city || "";
}

function addressText(place) {
  return [place.street, place.city].filter(Boolean).join(", ");
}

function renderArenaPlaceBlock(main, arenas) {
  ensureCupArenaGeo(state.cupId); // ritar om själv när datan landat
  const places = arenaPlaces(arenas);
  if (!places.length) return; // ProCup/Gothia: ingen adressdata att visa
  const sel = state.viewArena ? arenaGeoFor(state.viewArena) : null;
  const selKey = sel ? (sel.loc != null ? String(sel.loc) : sel.lat + "," + sel.lng) : null;

  if (sel) {
    const place = places.find((p) => p.key === selKey);
    const siblings = place ? place.arenas.filter((a) => a !== state.viewArena) : [];
    // Räkna i stället för att räkna upp när platsen har många banor —
    // Åhus 18 syskon skulle annars bli en rad text som dränker adressen.
    const siblingText = !siblings.length ? null
      : siblings.length > ARENA_SIBLING_NAMES
        ? " · " + siblings.length + " andra banor på samma plats"
        : " · samma plats som " + siblings.join(", ");
    main.append(h("p", { class: "muted arena-address" },
      h("span", { class: "arena-pin" }, "📍"),
      addressText(sel),
      siblingText ? h("span", { class: "arena-siblings" }, siblingText) : null));
  }

  main.append(h("div", { class: "row" },
    h("button", {
      class: "chip" + (state.arenaMapOpen ? " on" : ""), type: "button",
      "aria-expanded": state.arenaMapOpen ? "true" : "false",
      onclick: () => { state.arenaMapOpen = !state.arenaMapOpen; renderContent(); },
    }, (state.arenaMapOpen ? "▾ " : "▸ ") + "Visa på karta"
       + (places.length > 1 ? " (" + places.length + " platser)" : ""))));

  if (!state.arenaMapOpen) return;
  const box = h("div", { class: "arena-map-box" });
  main.append(box);
  ensureMapLibre().then((maplibregl) => {
    // Vyn kan ha bytts ut medan MapLibre laddades — rita då ingenting.
    if (!box.isConnected) return;
    createArenaMap(maplibregl, box, places, selKey);
  }).catch((e) => {
    box.replaceChildren(h("p", { class: "muted" },
      "Kartan kunde inte laddas: " + e.message));
  });
}

// Egen kartinstans, HELT skild från Karta-flikens currentMap — de två kan
// aldrig vara synliga samtidigt (olika toppnivåflikar), men att dela
// variabel hade gjort att den enas städning rev den andras karta.
let arenaMap = null;
const ARENA_POPUP_COURTS = 12; // hur många banchips en platspopup visar
const ARENA_SIBLING_NAMES = 4; // fler syskonbanor än så räknas i stället för att räknas upp

let arenaMapResizeObserver = null;

export function destroyArenaMap() {
  // Koppla ner observern FÖRST: den anropar arenaMap.resize(), och en
  // resize på en redan borttagen karta kastar inifrån MapLibre — ett fel
  // som dessutom bara syns som "Script error." eftersom biblioteket
  // laddas från unpkg (se crossOrigin i ensureMapLibre).
  if (arenaMapResizeObserver) { arenaMapResizeObserver.disconnect(); arenaMapResizeObserver = null; }
  if (!arenaMap) return;
  arenaMap.remove();
  arenaMap = null;
}

function createArenaMap(maplibregl, container, places, selKey) {
  destroyArenaMap();
  arenaMap = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [places[0].lng, places[0].lat],
    zoom: 11,
  });
  arenaMap.addControl(new maplibregl.NavigationControl(), "top-right");
  // Boxen ligger i ett innehåll som just ritats om, så MapLibre hinner
  // mäta containern innan layouten satt sig — utan den här omstorleken
  // ritas rutorna i en mindre yta än canvasen och lämnar tomma marginaler.
  // ResizeObserver (inte bara ett engångsanrop) täcker även fönsterbyten
  // och att verktygsraden fälls ut/ihop ovanför medan kartan är öppen.
  // MapLibre har INGEN "remove"-händelse att haka av på, så observern
  // måste ägas på modulnivå och kopplas ner explicit i destroyArenaMap.
  // Tidigare låg den i en once("remove")-callback som aldrig kördes,
  // vilket lämnade en observer per öppnad karta vid liv.
  arenaMapResizeObserver = new ResizeObserver(() => {
    if (arenaMap) arenaMap.resize();
  });
  arenaMapResizeObserver.observe(container);
  const bounds = new maplibregl.LngLatBounds();
  for (const p of places) {
    bounds.extend([p.lng, p.lat]);
    const el = h("div", { class: "arena-marker" + (p.key === selKey ? " on" : "") });
    const label = placeLabel(p);
    const addr = addressText(p);
    // Ett stort område (Åhus: 19 banor på en adress) skulle ge en popup
    // längre än kartan — visa ett hanterbart urval, med den valda banan
    // alltid med så man ser var man står.
    const courts = p.arenas.length > ARENA_POPUP_COURTS
      ? [...new Set([...(p.arenas.includes(state.viewArena) ? [state.viewArena] : []),
                      ...p.arenas])].slice(0, ARENA_POPUP_COURTS)
      : p.arenas;
    const body = h("div", { class: "arena-popup" },
      h("strong", null, label),
      addr && addr !== label ? h("div", { class: "muted" }, addr) : null,
      h("div", { class: "muted" },
        p.arenas.length + (p.arenas.length === 1 ? " bana" : " banor") +
        " · " + p.matches + " matcher"),
      h("div", { class: "arena-popup-courts" },
        courts.map((a) => h("button", {
          class: "chip" + (a === state.viewArena ? " on" : ""), type: "button",
          onclick: () => {
            state.viewArena = a; state.showAllPlayedArena = false;
            saveUi(); renderContent();
          },
        }, a)),
        courts.length < p.arenas.length
          ? h("span", { class: "muted" }, "+" + (p.arenas.length - courts.length) + " till")
          : null));
    new maplibregl.Marker({ element: el })
      .setLngLat([p.lng, p.lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setDOMContent(body))
      .addTo(arenaMap);
  }
  // En enda plats (t.ex. hela Åhus-området) ger tomma bounds att zooma
  // till — centrera i stället på den med en läsbar kvartersnivå.
  if (places.length > 1) {
    arenaMap.fitBounds(bounds, { padding: 60, maxZoom: 14 });
  } else {
    arenaMap.setCenter([places[0].lng, places[0].lat]);
    arenaMap.setZoom(14);
  }
}
