/* toolbar.js — verktygsrad och återanvändbara flervalsväljare. */

import { h, $ } from "../dom.js";
import { chrome } from "./chrome.js";
import {
  sheetMode, flattenMobileFilterBar, restoreFilterStripScroll,
  toggleFilterSheet, toggleFiltersExpanded,
} from "./sheets.js";
import { activeFilterCount } from "./nav.js";
import {
  parseCat, cohortKey, cohortLabel, shortCat, catSortKey,
} from "../domain/category.js";
import { matchesBooleanQuery } from "../filters.js";
import { fmtDay, dayKey } from "../time.js";
import { chip, withClearButton } from "./controls.js";

let saveUi, render, renderContent, state, cup;
let ensureArchiveEditions, ensureYearMatches, clubTeams, scoped, allScopedTeams;
let isFilterLocked, hasLockableSelection;
let teamNameById, buildExportPicker, buildViewFilterRow;
let clearViewFilters, scoreUnit, syncUrl, refreshFilterChrome;
let restoreStashedFilter, hasStashedFilter;

export function initToolbar(deps) {
  ({
    saveUi, render, renderContent, state, cup,
    ensureArchiveEditions, ensureYearMatches, clubTeams, scoped, allScopedTeams,
    isFilterLocked, hasLockableSelection,
    teamNameById, buildExportPicker, buildViewFilterRow,
    clearViewFilters, scoreUnit, syncUrl, refreshFilterChrome,
    restoreStashedFilter, hasStashedFilter,
  } = deps);
}

// Cupen är det översta urvalet och ligger därför först i samma mobila
// ikonremsa som år, dag, klass och lag. Själva listan återanvänder den
// befintliga cupdialogen — då finns bara en cuplista att hålla i synk.
function buildFilterCupTile() {
  const c = cup();
  return h("button", {
    class: "filter-more-tile filter-cup-tile", type: "button", "data-icon": "🏆",
    title: "Byt cup · " + c.name,
    onclick: () => {
      toggleFilterSheet(false);
      $("#currentCupBtn").click();
    },
  }, h("span", { class: "picker-label" }, c.name));
}

function buildFilterScopeTile() {
  const clubMode = state.scope === "club";
  return h("button", {
    class: "filter-more-tile filter-scope-tile", type: "button",
    title: clubMode ? "Visar " + state.favoriteClub + " · byt till hela cupen" : "Visar hela cupen · byt till favoritklubben",
    onclick: () => {
      state.scope = clubMode ? "all" : "club";
      saveUi(); render();
    },
  }, h("span", { class: "picker-label" }, clubMode ? state.favoriteClub : "Hela cupen"));
}

function buildDisabledFilterTile(label, icon) {
  return h("button", {
    class: "filter-more-tile filter-placeholder-tile", type: "button",
    "data-icon": icon, disabled: "", title: "Tillgängligt när cupens schema är laddat",
  }, h("span", { class: "picker-label" }, label));
}

// Envalsväljare i mobilens horisontella filterremsa. Samma <details>-
// skal som år/dag/klass/lag gör att panelen får appens vanliga bottenark,
// men alternativen är ömsesidigt uteslutande och stänger efter ett val.
function buildFilterChoiceTile(label, current, choices, onChange) {
  const dd = h("details", { class: "team-picker-dd filter-choice-dd" });
  const currentChoice = choices.find((choice) => choice.id === current);
  const summary = h("summary", {
    class: "chip team-picker-summary",
    title: label + ": " + ((currentChoice && currentChoice.label) || current),
  }, h("span", { class: "picker-label" },
    (currentChoice && currentChoice.label) || label));
  const list = h("div", { class: "team-picker-list" }, choices.map((choice) =>
    h("button", {
      class: "export-item filter-choice-item" + (choice.id === current ? " on" : ""),
      type: "button", "aria-pressed": String(choice.id === current),
      onclick: () => {
        dd.open = false;
        if (choice.id !== current) onChange(choice.id);
      },
    }, h("span", { class: "filter-choice-check", "aria-hidden": "true" },
    choice.id === current ? "✓" : ""), choice.label)));
  dd.append(summary, h("div", { class: "team-picker-panel filter-choice-panel" }, list));
  return dd;
}

// --- generisk sök-, filter- och sorterbar flervalsdropdown ------------------

// Listor större än så bygger INTE alla checkboxrader direkt (tusentals
// DOM-noder för t.ex. lagväljaren i "Hela cupen"-läge på en stor cup —
// hängde webbläsaren) — i stället tomt tills man skrivit något, med en
// kort debounce så varje enskilt tangenttryck inte triggar en omritning.
// Redan ikryssade rader visas alltid (annars "försvinner" ett val ur sikte
// så fort sökrutan töms, trots att det fortfarande är valt).
const PICKER_LAZY_THRESHOLD = 60;
const PICKER_LAZY_DEBOUNCE_MS = 400;
const PICKER_LAZY_MAX_RESULTS = 200; // tak även på TRÄFFARNA (bred sökning i en jättecup)

// Egen, självstyrande komponent: sökning/sortering/bockning inuti den sköts
// med direkt DOM-manipulation i stället för renderToolbar(), så att den kan
// hållas öppen genom flera val utan att byggas om. items: [{id, label,
// sortKey (numeriskt), sortName (för alfabetisk sortering)}].
function buildPicker(opts) {
  // opts.icon: enskild emoji som mobilens filterremsa visar ovanför
  // etiketten (se .filter-group i style.css). Sätts som data-attribut i
  // stället för att byggas som ett element, så desktopvyn — där remsan
  // inte finns — förblir helt oförändrad.
  const dd = h("details", { class: "team-picker-dd" });
  // data-icon sitter på SUMMARY, inte på <details>: attr() i CSS läser bara
  // attribut från pseudoelementets EGET element, och ::before hänger på
  // summary. På <details> hade content: attr(data-icon) gett tomt.
  const summary = h("summary", {
    class: "chip team-picker-summary",
    ...(opts.icon ? { "data-icon": opts.icon } : {}),
  });
  // Etiketten i ett eget element (inte som ren textnod): mobilens brickor
  // behöver kunna korta den med ellips, och text-overflow biter inte på en
  // anonym textnod inuti en flex-container.
  const label = h("span", { class: "picker-label" });
  const setSummary = () => {
    label.textContent = opts.selected.size
      ? opts.countLabel(opts.selected.size) : opts.emptyLabel;
    if (!label.parentNode) summary.append(label);
  };
  setSummary();

  const search = h("input", {
    class: "team-picker-search", type: "search", placeholder: opts.searchPlaceholder,
    title: "Stöder & (och) och / eller , (eller), t.ex. 2011&flickor/2013",
  });

  // sortToggle: false — listor utan ett naturligt "klass"-begrepp (t.ex.
  // cupväljarna på Karta/Trend) har bara namnsortering, ingen växlingsrad.
  // sortKey/catkey blir då aldrig meningsfullt ifyllt av anroparen, men
  // det spelar ingen roll eftersom "klass"-jämförelsen aldrig körs.
  let sortMode = opts.sortToggle === false ? "namn" : "klass";
  const sortBtns = {};
  // selectedFirst: lyfter ikryssade rader överst. Körs BARA när panelen
  // öppnas (se toggle-lyssnaren nedan), aldrig vid ett enskilt klick —
  // annars hoppar raden man just kryssade i väg under fingret och nästa
  // klick landar på fel rad.
  const applySort = (selectedFirst) => {
    const base = sortMode === "namn"
      ? (a, b) => a.dataset.name.localeCompare(b.dataset.name, "sv")
      : (a, b) => (+a.dataset.catkey - +b.dataset.catkey) ||
          a.dataset.name.localeCompare(b.dataset.name, "sv");
    const cmp = selectedFirst
      ? (a, b) => (opts.selected.has(b._id) ? 1 : 0) - (opts.selected.has(a._id) ? 1 : 0) || base(a, b)
      : base;
    [...list.children].sort(cmp).forEach((el) => list.append(el));
  };
  dd.addEventListener("toggle", () => { if (dd.open) applySort(true); });
  const sortRow = opts.sortToggle === false ? null : h("div", { class: "team-picker-sort-row" },
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

  const list = h("div", { class: "team-picker-list" });
  const lazy = opts.items.length > PICKER_LAZY_THRESHOLD;
  const lazyHint = h("p", { class: "muted team-picker-hint" },
    "Skriv för att söka bland " + opts.items.length + " …");

  function buildRow(it) {
    const cb = h("input", {
      type: "checkbox", ...(opts.selected.has(it.id) ? { checked: "" } : {}),
      onchange: (e) => {
        e.target.checked ? opts.selected.add(it.id) : opts.selected.delete(it.id);
        saveUi(); setSummary(); opts.onChange();
        syncGenderBoxes();
        if (lazy && !e.target.checked) renderLazyList(search.value); // en avkryssad rad ska försvinna om den inte längre matchar sökningen
      },
    });
    // soloClickable (bara cupväljarna, se renderTrendView/renderMapView):
    // klick direkt på NAMNET väljer bara den raden (kryssar ur alla andra)
    // — snabbt sätt att hoppa till "bara den här cupen". Klick på själva
    // kryssrutan fortsätter fungera som vanligt av/på-flerval (bygger upp
    // en jämförelse). preventDefault() stoppar <label>s inbyggda
    // vidarebefordran av klicket till kryssrutan, annars skulle den även
    // togglas av vår egen hantering.
    const label = opts.soloClickable
      ? h("span", {
          class: "team-picker-item-text", title: "Klicka för att välja bara den här",
          onclick: (e) => {
            e.preventDefault();
            opts.selected.clear();
            opts.selected.add(it.id);
            saveUi(); setSummary(); opts.onChange();
            if (lazy) renderLazyList(search.value);
            else for (const r of list.children) r._checkbox.checked = opts.selected.has(r._id);
          },
        }, it.label)
      : it.label;
    const row = h("label", { class: "team-picker-item" }, cb, label);
    row.dataset.name = it.sortName;
    row.dataset.catkey = String(it.sortKey);
    row.dataset.search = it.label.toLowerCase();
    row._id = it.id; // rådata (kan vara nummer) — dataset tvingar sträng
    row._checkbox = cb;
    if (opts.genderQuickSelect) row.dataset.gender = (parseCat(it.label) || {}).g || "";
    return row;
  }

  // Bara i lat läge: redan valda (fästa överst) + sökträffar (kapade vid
  // PICKER_LAZY_MAX_RESULTS). Anropas vid varje (debouncad) sökning OCH
  // efter Rensa/avkryssning, så listan alltid speglar det faktiska urvalet.
  function renderLazyList(query) {
    const q = query.trim();
    const selectedItems = opts.items.filter((it) => opts.selected.has(it.id));
    const matched = q
      ? opts.items.filter((it) => !opts.selected.has(it.id) &&
          matchesBooleanQuery(it.label.toLowerCase(), q)).slice(0, PICKER_LAZY_MAX_RESULTS)
      : [];
    list.replaceChildren(...selectedItems.map(buildRow), ...matched.map(buildRow));
    lazyHint.hidden = !!(q || selectedItems.length);
    applySort();
    syncGenderBoxes();
  }

  const clearBtn = h("button", {
    class: "btn small", type: "button",
    onclick: () => {
      opts.selected.clear();
      saveUi(); setSummary(); opts.onChange();
      if (lazy) renderLazyList(search.value);
      else list.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
    },
  }, "Rensa");

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
              if (lazy) renderLazyList(search.value); else syncGenderBoxes();
            },
          }),
          label)));
  }

  // Måste köras EFTER syncGenderBoxes/genderRow ovan — renderLazyList
  // anropar syncGenderBoxes(), och en const-funktion går inte att nå
  // innan sin egen deklaration (temporal dead zone).
  if (lazy) renderLazyList(""); else list.append(...opts.items.map(buildRow));

  let debounceTimer = null;
  search.addEventListener("input", () => {
    if (lazy) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderLazyList(search.value), PICKER_LAZY_DEBOUNCE_MS);
      return;
    }
    const q = search.value;
    for (const item of list.children) item.hidden = !matchesBooleanQuery(item.dataset.search, q);
    syncGenderBoxes();
  });
  syncGenderBoxes();

  dd.append(summary, h("div", { class: "team-picker-panel" },
    h("div", { class: "team-picker-search-row" }, withClearButton(search), clearBtn),
    genderRow, sortRow, lazy ? lazyHint : null, list));
  return dd;
}

function buildTeamPicker(teams, onChange) {
  return buildPicker({
    items: teams.map((t) => ({
      id: t.id, label: shortCat(t.catName) + " " + t.suffix,
      sortKey: catSortKey(t.catName), sortName: t.suffix,
    })),
    icon: "👥",
    selected: state.teams,
    emptyLabel: "Lag",
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
    icon: "📆",
    selected: state.days,
    emptyLabel: "Dagar",
    countLabel: (n) => "Dagar (" + n + ")",
    searchPlaceholder: "Sök dag …",
    onChange: onChange || renderContent,
  });
}

// Klassväljaren grupperar på ÅRSKULL när det går: "Flickor 2011" i stället
// för "Flickor 13 (födda 2011) 25-27 april". Blandar man in tidigare år
// finns annars samma lag under olika etiketter — F13 år 2024 är F14 år
// 2025 — och varje upplaga får dessutom egna klass-id, så en klass vald i
// ett år filtrerade bort både matcher OCH lag från de andra.
//
// Bara PRESENTATIONEN grupperas. state.cats innehåller fortfarande klass-
// id, så filtrering, tabeller, slutspel, URL:er och sparad vy är helt
// orörda — proxyn nedan översätter mellan årskull och id, precis som
// yearSelectionProxy gör för årsväljaren.
//
// Klasser utan läsbart födelseår (alla cuper skriver det inte) blir kvar
// som egna rader med sitt fulla namn — inget val försvinner.
// Ett kullval fångar de klass-id som fanns NÄR man kryssade i det. Lägger
// man till ett år efteråt hämtas det årets matcher in, men dess klass-id
// står utanför urvalet — resultatet blev att man valde "Flickor 2011",
// la till 2025, och ändå bara såg 2026 års matcher.
//
// Här utökas därför urvalet till att omfatta ALLA nu kända id för de
// kullar som redan är valda. Körs vid varje uppbyggnad av verktygsraden,
// alltså även när ett arkivår just laddat klart (ensureYearMatches
// anropar render()). Säkert att köra om: kullproxyn kryssar ur hela
// kullen på en gång, så ett delvis urval kan aldrig vara avsiktligt.
function expandCohortSelection(catEntries) {
  if (!state.cats.size) return;
  const idsByKey = new Map();
  const valdaKullar = new Set();
  for (const [id, name] of catEntries) {
    const key = cohortKey(name);
    if (!key) continue;
    if (!idsByKey.has(key)) idsByKey.set(key, []);
    idsByKey.get(key).push(id);
    if (state.cats.has(id)) valdaKullar.add(key);
  }
  let andrat = false;
  for (const key of valdaKullar) {
    for (const id of idsByKey.get(key) || []) {
      if (!state.cats.has(id)) { state.cats.add(id); andrat = true; }
    }
  }
  if (andrat) saveUi();
}

function buildCatPicker(catEntries, onChange) {
  const idsByKey = new Map();   // årskullsnyckel (eller id) -> [catId]
  const labelByKey = new Map();
  const sortByKey = new Map();
  for (const [id, name] of catEntries) {
    const key = cohortKey(name) || ("id:" + id);
    if (!idsByKey.has(key)) {
      idsByKey.set(key, []);
      labelByKey.set(key, cohortKey(name) ? cohortLabel(name) : name);
      sortByKey.set(key, catSortKey(name));
    }
    idsByKey.get(key).push(id);
    // Sorteringen följer den YNGSTA åldersetiketten kullen har i vyn, så
    // listan står i samma ordning som när bara ett år är valt.
    sortByKey.set(key, Math.min(sortByKey.get(key), catSortKey(name)));
  }

  const idsFor = (key) => idsByKey.get(key) || [];
  const cohortSelection = {
    get size() {
      let n = 0;
      for (const ids of idsByKey.values()) if (ids.some((id) => state.cats.has(id))) n++;
      return n;
    },
    // "Vald" så snart NÅGOT av kullens id är valt — annars skulle en kull
    // vars ena år saknar matcher aldrig kunna se ikryssad ut.
    has: (key) => idsFor(key).some((id) => state.cats.has(id)),
    add: (key) => { for (const id of idsFor(key)) state.cats.add(id); },
    delete: (key) => { for (const id of idsFor(key)) state.cats.delete(id); },
    clear: () => state.cats.clear(),
  };

  return buildPicker({
    items: [...idsByKey.keys()].map((key) => ({
      id: key, label: labelByKey.get(key),
      sortKey: sortByKey.get(key), sortName: labelByKey.get(key),
    })),
    icon: "🏷️",
    selected: cohortSelection,
    emptyLabel: "Klasser",
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
    icon: "🗓️",
    selected: yearSelectionProxy,
    emptyLabel: "Inga år valda",
    // Standardläget (bara innevarande år) ska fortfarande läsas som
    // "Innevarande år", inte det generiska "1 år" — annars ser den
    // vanligaste inställningen ut som ett aktivt urval i onödan.
    // Visa ÅRTALET när exakt ett år är valt — "Innevarande år" sa varken
    // vilket år det var eller matchade de andra rader i listan, som alla
    // är årtal. Dessutom för långt för en bricka i mobilens filterremsa,
    // där det klipptes till "Innevarand…".
    countLabel: (n) => {
      if (n !== 1) return n + " år";
      if (state.includeCurrentYear) return String(currentEdition);
      return String([...state.years][0] || "1 år");
    },
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
  // Stats (Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper) bygger på HELA
  // arkivet/klubbregistret oavsett dag-/klass-/lagfilter (de filtrerar
  // inte state.matches alls) — verktygsraden vore bara missvisande brus där.
  // På desktop är Filter en fristående, expanderbar panel och får därför
  // öppnas även ovanpå Statistik. Valen påverkar de aktuella cupvyerna och
  // ligger kvar när användaren återvänder dit; Statistik själv fortsätter
  // bygga på hela arkivet. Mobilen behåller sitt tidigare beteende och
  // visar aldrig ett tomt filterark i Statistik.
  const desktopFilterOpen = !sheetMode() &&
    document.body.classList.contains("desktop-filter-open");
  if ((state.view === "stats" && !desktopFilterOpen) || chrome.settingsViewOpen) return;
  ensureArchiveEditions();
  const archiveEntry = state.archiveEditions[state.cupId];
  const archiveYears = (archiveEntry && archiveEntry.editions) || [];
  // Live-upplagan kan sakna publicerat schema (ny säsong, inget släppt
  // än) men ändå ha arkiverade tidigare år att bläddra i — årsväljaren
  // måste gå att nå ändå, annars sitter man fast på "inget schema
  // publicerat"-bannern (se renderContent) utan något sätt att komma åt
  // t.ex. förra årets data. Bara om det INTE finns något alls — varken
  // live eller arkiverat — är verktygsraden meningslös att visa.
  if (!state.matches.length && !archiveYears.length) {
    // Även en cup vars schema ännu inte publicerats måste gå att lämna via
    // Filter. Annars öppnas en tom filterremsa just när cupväljaren behövs
    // som mest.
    if (sheetMode()) bar.append(h("div", { class: "row filter-primary-row" },
      h("div", { class: "filter-group" },
        buildFilterCupTile(),
        buildFilterScopeTile(),
        buildDisabledFilterTile("År", "📆"),
        buildDisabledFilterTile("Dagar", "☀️"),
        buildDisabledFilterTile("Klasser", "🏷️"),
        buildDisabledFilterTile("Lag", "👥"))));
    flattenMobileFilterBar(bar);
    restoreFilterStripScroll();
    return;
  }
  const clubTeamsList = clubTeams();
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
  const desktopToolbar = !sheetMode();
  // Desktopfiltret är nu en enda, direkt redigerbar rad. Ett gammalt
  // sparat låsläge får inte fortsätta gömma väljare när själva låsknappen
  // inte längre visas.
  if (desktopToolbar && state.filterLocked) {
    state.filterLocked = false;
    state.viewCats = new Set();
    state.viewTeams = new Set();
    saveUi();
  }
  const dd = h(desktopToolbar ? "div" : "details", {
    class: "toolbar-collapse" +
      (desktopToolbar ? " desktop-toolbar desktop-toolbar-flat" : ""),
    ...(!desktopToolbar && state.toolbarOpen ? { open: "" } : {}),
  });
  if (!desktopToolbar) {
    dd.addEventListener("toggle", () => { state.toolbarOpen = dd.open; });
  }
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
  // Matchstatus är synlig även i kompaktläget och ska därför inte räknas
  // som ett dolt, avancerat filter i etiketten "Fler filter (n)".
  const advancedCount = activeFilterCount() - (state.matchFilter !== "all" ? 1 : 0);
  const toolbarSummary = h("summary", {
      class: "toolbar-summary",
      onclick: desktopToolbar ? (event) => {
        event.preventDefault();
        state.toolbarOpen = !state.toolbarOpen;
        renderToolbar();
      } : null,
    },
      h("span", { class: "toolbar-summary-label" }, desktopToolbar
        ? (state.toolbarOpen ? "Färre filter" :
            "Fler filter" + (advancedCount ? " (" + advancedCount + ")" : ""))
        : "Filter och sortering"),
      lockSlot);
  // Mobilarket behöver en rubrik/dragbar expanderingsnivå. På dator är
  // alla kontroller synliga direkt och varken Fler/Färre eller Lås ska
  // uppta en egen rad.
  if (desktopToolbar) dd.append(bodyEl);
  else dd.append(toolbarSummary, bodyEl);
  bar.append(dd);
  const body = bodyEl;

  // Tillbaka-knapp: syns så snart man hoppat till en tillfällig
  // filtrering — ett lags kommande/spelade matcher (matchdialogens
  // snabblänkar, ett klickbart lagnamn i tabellerna eller på ett
  // matchkort) eller en specifik plan — oavsett vad som utlöste hoppet.
  // Ett enda tydligt sätt att komma tillbaka till sin egen vy, i stället
  // för att behöva pilla ihop filtren för hand.
  if (hasStashedFilter()) {
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
  // Matcher utan satt tid (start = 0, vanligt innan arrangören spikat
  // spelordningen) hamnar på epoken och gav ett spöke i dagväljaren:
  // "tors 1 jan." bland cupens riktiga speldagar. De har ingen dag att
  // välja, så de hör inte hemma i listan — de syns fortfarande i schemat.
  const days = [...new Set(scoped().filter((m) => m.start).map((m) => dayKey(m.start)))].sort();
  const cats = new Map();
  for (const m of scoped()) if (m.catId) cats.set(m.catId, m.catName);
  const catEntries = [...cats.entries()].sort((a, b) =>
    catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));
  expandCohortSelection(catEntries);

  // Lagväljaren smalnas av om klasser redan valts, men visas alltid —
  // "Hela cupen"-lägets potentiellt tusentals lag hanteras av buildPicker
  // självt (lat sökning, se PICKER_LAZY_THRESHOLD) i stället för att gömma
  // hela väljaren tills en klass valts, som tidigare.
  function teamPickerCandidates() {
    const pool = state.scope === "club" ? clubTeamsList : allScopedTeams();
    if (!state.cats.size) return pool;
    const smalnad = pool.filter((t) => state.cats.has(t.catId));
    // Ett VALT lag som klassfiltret smalnat bort måste ändå ligga kvar i
    // listan. Annars går det inte att kryssa ur: väljer man F13 Blå och
    // sedan klassen F14 blir träffmängden tom, och sidan säger "prova att
    // rensa något filter" om ett filter man inte längre kan se.
    const kvar = new Set(smalnad.map((t) => t.id));
    const bortfiltrerade = pool.filter((t) => state.teams.has(t.id) && !kvar.has(t.id));
    return bortfiltrerade.length ? [...smalnad, ...bortfiltrerade] : smalnad;
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
  // Matchstatus: tre synliga val på dator (man ser alternativen direkt),
  // EN växlingsknapp på mobil där utrymmet är dyrast. Knappen visar alltid
  // aktuellt läge och stegar Alla -> Kommande -> Spelade -> Alla.
  const STATUS_STEG = [["all", "Alla matcher"], ["upcoming", "Kommande"], ["played", "Spelade"]];
  const statusSeg = sheetMode()
    ? (() => {
        const i = Math.max(0, STATUS_STEG.findIndex(([v]) => v === state.matchFilter));
        return chip(STATUS_STEG[i][1], state.matchFilter !== "all", () => {
          state.matchFilter = STATUS_STEG[(i + 1) % STATUS_STEG.length][0];
          saveUi(); render();
        }, "status-cycle");
      })()
    : h("div", { class: "seg", role: "group", "aria-label": "Matchstatus" },
        [["all", "Alla"], ["upcoming", "Kommande"], ["played", "Spelade"]].map(([v, l]) =>
          chip(l, state.matchFilter === v, () => {
            state.matchFilter = v; saveUi(); render();
          })));

  // Visningsvalen låg tidigare bakom Mer → Visning. På mobil hör de
  // bättre hemma i samma scrollbar filterremsa som övriga avgränsningar.
  // Desktop behåller sina redan synliga kontroller längre ned i toolbaren.
  const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  const mobileViewTiles = sheetMode() ? [
    buildFilterChoiceTile("Matchstatus", state.matchFilter, [
      { id: "all", label: "Alla matcher" },
      { id: "upcoming", label: "Kommande" },
      { id: "played", label: "Spelade" },
    ], (value) => { state.matchFilter = value; saveUi(); render(); }),
    arenas.length > 1 ? buildFilterChoiceTile("Hall/plan", state.arena, [
      { id: "", label: "Hall/plan" },
      ...arenas.map((arenaName) => ({ id: arenaName, label: arenaName })),
    ], (value) => { state.arena = value; saveUi(); render(); }) : null,
    state.view === "schema" ? buildFilterChoiceTile("Sortering", state.sort, [
      { id: "tid", label: "Sortera: tid" },
      { id: "klass", label: "Sortera: klass" },
      { id: "plan", label: "Sortera: plan" },
      { id: "resultat", label: "Sortera: resultat" },
      { id: "mal", label: "Sortera: " + scoreUnit() },
    ], (value) => {
      state.sort = value; state.schemaOlderRevealCount = 0; state.schemaNewerRevealCount = 0; saveUi(); render();
    }) : null,
    state.view === "schema" && state.sort === "tid" ? h("button", {
      class: "filter-more-tile filter-order-tile", type: "button",
      title: "Växla kronologisk ordning",
      onclick: () => {
        state.timeOrder = state.timeOrder === "desc" ? "asc" : "desc";
        state.schemaOlderRevealCount = 0; state.schemaNewerRevealCount = 0; saveUi(); render();
      },
    }, state.timeOrder === "desc" ? "Nyast först" : "Äldst först") : null,
  ].filter(Boolean) : [];

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
      const names = catEntries.filter(([id]) => state.cats.has(id)).map(([, name]) => shortCat(name));
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
    // En ensam kandidat filtrerar inte bort något — den väljaren göms. Men
    // finns det ett lagval kvar måste väljaren fram ändå, annars sitter
    // urkryssningen inlåst (se teamPickerCandidates ovan).
    const visa = candidates.length > 1 || state.teams.size > 0;
    teamSlot.replaceChildren(...(visa ? [buildTeamPicker(candidates, onTeamOrDayChange)] : []));
  };

  // Låskontrollen (knapp när upplåst, klickbar sammanfattnings-chip när
  // låst) byggs här men lever i lockSlot bredvid "Filter och sortering"
  // (se ovan) i stället för i filterraden — där gjorde den sig konstigt
  // placerad mitt i eller sist i en lång kedja av chips, och försvann
  // dessutom ur sikte så fort man fällde ihop panelen.
  const refreshLockSlot = () => {
    // Ingen låsknapp i mobilens ark — den skulle inte göra något (se
    // isFilterLocked) och bara ta plats i en rubrikrad där utrymmet är
    // dyrast.
    if (sheetMode() ||
        (days.length <= 1 && catEntries.length <= 1 && !archiveYears.length)) {
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
  const isFiltersExpanded = document.body.classList.contains("filters-expanded");
  const expandFilterTile = h("button", {
    class: "filter-more-tile filter-expand-tile", type: "button",
    ...(sheetMode() ? {} : { hidden: "" }),
    title: isFiltersExpanded ? "Visa färre filter" : "Visa fler val",
    onclick: () => toggleFiltersExpanded(!isFiltersExpanded),
  }, isFiltersExpanded ? "Färre" : "Fler val");

  if (days.length > 1 || catEntries.length > 1) {
    const row = h("div", { class: "row filter-primary-row" }, scopeSeg);
    if (!isLocked) {
      // Element.append() (till skillnad från h()) stringifierar null/
      // undefined till en bokstavlig "null"-textnod i stället för att
      // hoppa över dem — filtrera bort inaktuella delar (ingen arkiverad
      // historik/en enda dag/en enda klass) innan de skickas in.
      const urval = [
        archiveYears.length ? buildYearPicker(archiveYears, cup().edition) : null,
        days.length > 1 ? buildDayPicker(days, onTeamOrDayChange) : null,
        catEntries.length > 1 ? buildCatPicker(catEntries, onCatChange) : null,
      ].filter((el) => el != null);
      refreshTeamRow();
      // De fyra urvalsväljarna (år/dagar/klasser/lag) i en egen grupp.
      // Som grå chips i en lång rad läste de som inaktiva knappar snarare
      // än som menyval — på mobil blir gruppen i stället fullbreddsrader
      // med etikett och värde (se .filter-group i style.css), där det är
      // uppenbart att raden går att trycka på. CSS-only-omslag: samma
      // element, samma lyssnare, bara en behållare runt.
      // Rensa allt: visas bara när det FINNS något att rensa, annars vore
      // den en död knapp i en remsa där varje bricka kostar bredd. Rensar
      // exakt det siffran på filterknappen räknar (se activeFilterCount) —
      // annars kan man trycka rensa och ändå ha en siffra kvar.
      // Byggs ALLTID och göms med hidden i stället för att utelämnas: ett
      // filterval ritar bara om innehållet, inte verktygsraden, så en
      // villkorligt skapad bricka hade inte dykt upp förrän nästa fulla
      // omritning. refreshFilterChrome växlar hidden i stället.
      const rensaTile = h("button", {
        class: "filter-more-tile filter-clear-tile", type: "button", "data-icon": "✕",
        ...(activeFilterCount() ? {} : { hidden: "" }),
        title: "Rensa all filtrering",
        onclick: clearViewFilters,
      }, "Rensa");
      row.append(h("div", { class: "filter-group" },
        buildFilterCupTile(), buildFilterScopeTile(), ...urval, teamSlot,
        ...mobileViewTiles, rensaTile, expandFilterTile));
    } else row.append(h("div", { class: "filter-group" }, buildFilterCupTile(), expandFilterTile));
    row.append(h("span", { class: "row-sep" }), statusSeg);
    body.append(row);
  } else {
    if (!isLocked) refreshTeamRow();
    body.append(h("div", { class: "row filter-primary-row" }, scopeSeg,
      h("div", { class: "filter-group" },
        buildFilterCupTile(),
        buildFilterScopeTile(),
        (!isLocked && archiveYears.length) ? buildYearPicker(archiveYears, cup().edition) : null,
        isLocked ? null : teamSlot,
        ...mobileViewTiles,
        expandFilterTile),
      h("span", { class: "row-sep" }), statusSeg));
  }

  const viewFilterRow = buildViewFilterRow();
  if (viewFilterRow) body.append(viewFilterRow);

  // Sök · plan · sortering · export
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
      refreshFilterChrome(); // fritextsök räknas in i filtersiffran
      renderContent();
    },
  });
  const toolsRow = h("div", { class: "row tools-row" },
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
       ["resultat", "Sortera: resultat"], ["mal", "Sortera: " + scoreUnit()]]
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
        state.schemaOlderRevealCount = 0; // ny riktning: börja om med "visa fler"
        state.schemaNewerRevealCount = 0;
        // render() (inte renderContent()) — knappens egen etikett/state
        // ligger i verktygsraden, som bara render() bygger om.
        saveUi(); render();
      },
    }, state.timeOrder === "desc" ? "↓ Nyast överst" : "↑ Äldst överst") : null,
    state.view !== "stats" ? buildExportPicker() : null);
  body.append(toolsRow);
  if (desktopToolbar) {
    // Export finns redan i sidhuvudet. Flytta resterande verktyg till
    // huvudraden så sök, plan och sortering delar rad med övriga filter.
    toolsRow.querySelector(".export-dd")?.remove();
    const primaryRow = body.querySelector(".filter-primary-row");
    if (primaryRow) {
      const toolChildren = [...toolsRow.children];
      if (toolChildren.length) primaryRow.append(
        h("span", { class: "row-sep desktop-tools-sep", "aria-hidden": "true" }),
        ...toolChildren);
      toolsRow.remove();
    }
  }
  flattenMobileFilterBar(bar);
  restoreFilterStripScroll();
}

export {
  PICKER_LAZY_THRESHOLD,
  PICKER_LAZY_DEBOUNCE_MS,
  PICKER_LAZY_MAX_RESULTS,
  buildPicker,
  buildTeamPicker,
  buildDayPicker,
  buildCatPicker,
  buildYearPicker,
  expandCohortSelection,
  buildFilterCupTile,
  buildFilterScopeTile,
  buildDisabledFilterTile,
  buildFilterChoiceTile,
  renderToolbar,
};
