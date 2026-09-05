/* stats.js — Stats-vyer och deras URL-sessionstillstånd. */

import { h, $ } from "../dom.js";
import { attachAutocomplete, chip, withClearButton } from "./controls.js";
import { buildPicker } from "./toolbar.js";
import { matchCard, openPlayerSheet, openMatchSheet } from "./match-ui.js";
import { bracketBlock, drawBracketConnectors } from "./playoffs.js";
import { countryDisplayName, renderMapView } from "./map.js";
import { MULTI_COLOR_PALETTE } from "./palette.js";
import { syncBottomStack } from "./sheets.js";
import {
  catSortKey, cohortKey, cohortLabel,
} from "../domain/category.js";
import { clubOutcomeLetter, scoreText } from "../domain/match.js";
import { isPlaceholderTeam } from "../domain/placeholder.js";
import { matchesBooleanQuery } from "../filters.js";
import {
  fmtDay, fmtDayLong, hasScheduledStart, matchTimeLabel,
} from "../time.js";
import {
  historicalPlayoffDivisions, summarizeArchiveMatches, archiveStats,
  sortArchiveRows, groupArchiveByDay, archiveClassOptions,
  historicalGroupTables as historicalGroupTablesFor,
} from "../domain/archive.js";
import { defaultSubViewSnap } from "../url-state.js";

let HB, state, cup, saveUi, saveSettings, render, renderContent;
let renderFavoriteTeamList, ensureYearMatches, switchCup, syncUrl, isClubName;
let favoriteTeamIndex, scoreUnit, SPORT_LABELS;

export function initStats(deps) {
  ({
    HB, state, cup, saveUi, saveSettings, render, renderContent,
    renderFavoriteTeamList, ensureYearMatches, switchCup, syncUrl, isClubName,
    favoriteTeamIndex, scoreUnit, SPORT_LABELS,
  } = deps);
}

// --- historik: jämför resultat mellan cupens år -------------------------

const ARCHIVE_SORTS = [
  ["tid_desc", "Sortera: nyast"], ["tid_asc", "Sortera: äldst"],
  ["resultat", "Sortera: resultat"], ["motstandare", "Sortera: motståndare"],
  ["klass", "Sortera: klass"],
];

// Liten stjärnknapp vid ett lagnamn i historikens rader. Arkiverade
// matcher har ingen livetabell att slå upp, så lagrutan (teamStatBlock)
// går inte att öppna här — men man ska ändå kunna stjärnmärka ett lag man
// hittar bland tidigare års resultat, utan att gå omvägen via
// Inställningar. Årskullen tas ur matchens klass precis som överallt
// annars, så rätt lag träffas.
function archiveFavStar(name, catName) {
  const clean = (name || "").trim();
  if (!clean || isPlaceholderTeam({ name: clean })) return null;
  const cohort = cohortKey(catName);
  const btn = h("button", { class: "arch-fav", type: "button" });
  const sync = () => {
    const on = favoriteTeamIndex(clean, cohort) >= 0;
    btn.classList.toggle("on", on);
    btn.textContent = on ? "⭐" : "☆";
    btn.title = (on ? "Ta bort " : "Lägg till ") + clean +
      (cohort ? " (" + cohortLabel(catName) + ")" : "") +
      (on ? " ur dina favoritlag" : " bland dina favoritlag");
    btn.setAttribute("aria-pressed", String(on));
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = favoriteTeamIndex(clean, cohort);
    if (i >= 0) state.favoriteTeams.splice(i, 1);
    else state.favoriteTeams.push({ name: clean, cohort });
    saveSettings();
    renderFavoriteTeamList();
    sync();
  });
  sync();
  return btn;
}

function archiveMatchRow(m) {
  const sc = scoreText(m.res);
  return h("div", { class: "arch-row" },
    h("span", { class: "arch-date" },
      matchTimeLabel(m, fmtDay)),
    h("span", { class: "arch-teams" },
      h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name),
      archiveFavStar(m.home.name, m.catName),
      " – ",
      h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name),
      archiveFavStar(m.away.name, m.catName)),
    m.outcome ? h("span",
      { class: "outcome-badge outcome-" + m.outcome.toLowerCase() }, m.outcome) : null,
    h("span", { class: "arch-score" }, sc || "–"),
    m.catName ? h("span", { class: "arch-cat" }, HB.shortCat(m.catName)) : null);
}

function historicalGroupTables(matches, catName) {
  return historicalGroupTablesFor(matches, catName, (cup() && cup().sport) || "handboll");
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
      h("h2", { class: "day-h" }, hasScheduledStart(g.items[0])
        ? fmtDayLong.format(new Date(g.items[0].start)) : "Tid ej satt"),
      h("div", { class: "arena-quick-list" }, g.items.map(archiveMatchRow)),
    ]));
  }
  const classSel = h("select", { class: "select", "aria-label": "Klass" },
    h("option", { value: "" }, "Alla klasser"),
    classes.map((c) => h("option",
      { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
  classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
  const search = h("input", { type: "text", placeholder: "Sök lag …", value: hs.teamQuery });
  search.addEventListener("input", () => { hs.teamQuery = search.value; refresh(); syncBrowseUrl(); });
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
  classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
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
  classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
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
  arenaSel.addEventListener("change", () => { hs.arena = arenaSel.value; refresh(); syncBrowseUrl(); });
  root.replaceChildren(h("div", { class: "history-controls" }, arenaSel), list);
  refresh();
}

const HISTORY_TABS = [
  ["schema", "Schema", renderHistorySchemaTab],
  ["tabeller", "Tabeller", renderHistoryTablesTab],
  ["slutspel", "Slutspel", renderHistoryPlayoffsTab],
  ["bana", "Bana", renderHistoryArenaTab],
];

// --- Trend-fliken: formkurva över cupens år -------------------------------
// Bygger helt på nyckeltal som redan finns i data/archive/index.json
// (matches/teams/classes/days/clubs per edition, se build_index() i
// scripts/archive_results.py) — ingen ytterligare nätverksfråga behövs
// utöver den fetchArchiveIndex() som init() redan gjort vid appstart.
// Antal SPELARE går inte att visa: ingen källa (Cup Manager/ProCup) ger
// spelardata alls, förutom Partilles trupplistor (se rosterFor) som
// ändå bara täcker en enda cup — inte en meningsfull trendlinje.
//
// clubs (distinkta KLUBBAR, till skillnad från "teams" som räknar varje
// åldersklass-lag för sig) bygger på ett rent klubbnamnsfält
// (home/away.club) som tillkom senare — arkivfiler skrapade innan dess
// saknar det och ger då 0, inte ett fel.
const TREND_METRICS = [
  ["matches", "Matcher", "var(--blue)"],
  ["teams", "Lag i matcher", "var(--yellow)"],
  ["clubs", "Klubbar", "var(--orange)"],
  ["classes", "Klasser", "var(--won)"],
  ["days", "Speldagar", "var(--purple)"],
];

// På en preliminär upplaga är indexets `matches` alla matchobjekt,
// inklusive sådana som ännu saknar speltid. I jämförelser är det antalet
// faktiskt tidsatta matcher som motsvarar arrangörens publicerade schema.
function archiveEditionMetric(e, key) {
  if (key === "matches" && e.preliminary && Number.isFinite(e.timed)) return e.timed;
  return e[key] || 0;
}

function archiveEditionMatchLabel(e) {
  if (e.preliminary && (e.untimed || 0) > 0) {
    return (e.timed || 0) + " tidsatta · " + e.untimed + " utan tid";
  }
  return (e.matches || 0) + " matcher";
}

// Kompakt lista av cupens faktiska speldagar. Sammanhängande dagar blir
// ett intervall, separata helger behålls som separata grupper:
// [4,5,6,11,12,13 september] → "4–6 och 11–13 sep".
function archiveEditionDateLabel(e) {
  const dates = (e.dates && e.dates.length ? e.dates : [e.first, e.last])
    .filter(Boolean).slice().sort();
  if (!dates.length) return "–";
  const unique = [...new Set(dates)];
  const groups = [];
  for (const iso of unique) {
    const day = Date.parse(iso + "T00:00:00Z") / 86400000;
    const prev = groups[groups.length - 1];
    if (prev && day === prev.lastDay + 1) {
      prev.last = iso; prev.lastDay = day;
    } else groups.push({ first: iso, last: iso, lastDay: day });
  }
  const months = ["jan", "feb", "mar", "apr", "maj", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec"];
  const part = (g, omitMonth) => {
    const a = new Date(g.first + "T00:00:00Z");
    const b = new Date(g.last + "T00:00:00Z");
    const am = months[a.getUTCMonth()], bm = months[b.getUTCMonth()];
    if (g.first === g.last) return a.getUTCDate() + (omitMonth ? "" : " " + am);
    if (am === bm) return a.getUTCDate() + "–" + b.getUTCDate() + (omitMonth ? "" : " " + bm);
    return a.getUTCDate() + " " + am + "–" + b.getUTCDate() + " " + bm;
  };
  const sameMonth = groups.every((g) => g.first.slice(0, 7) === groups[0].first.slice(0, 7) &&
    g.last.slice(0, 7) === groups[0].first.slice(0, 7));
  return groups.map((g, i) => part(g, sameMonth && i < groups.length - 1)).join(" och ");
}


// Flera cupers första arkiverade år (2020/2021) var kraftigt coronaneddragna
// (t.ex. Åhus Beach 2020: 107 matcher mot 4600+ varje år sedan) — indexerar
// man rakt av mot ÅR ETT blir den upplagan en missvisande 100%-baslinje som
// trycker ihop alla andra linjer nära botten. Väljer i stället första året
// som når minst 40 % av cupens STÖRSTA matchantal som ankare; onormalt små
// tidiga år visas fortfarande som punkter på kurvan, men styr inte skalan.
//
// overrideYear: användarens egna val (state.trendBaselineYear, se
// renderTrendView) vinner alltid över auto-heuristiken ovan när det
// matchar ett av de faktiskt visade åren.
function trendBaselineIndex(editions, overrideYear) {
  if (overrideYear) {
    const i = editions.findIndex((e) => e.edition === overrideYear);
    if (i !== -1) return i;
  }
  const maxMatches = Math.max(...editions.map((e) => e.matches || 0));
  const threshold = maxMatches * 0.4;
  const i = editions.findIndex((e) => (e.matches || 0) >= threshold);
  return i === -1 ? 0 : i;
}

// Linjediagram, allt normerat till % av baslinjeåret (100 %) — så matcher
// (tusental) och speldagar (ental) kan visas i samma diagram och svara
// direkt på "växer eller minskar cupen".
function buildTrendSvg(editions, baseIdx, metrics) {
  const w = 640, h = 260, padL = 26, padR = 26, padT = 16, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const n = editions.length;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const series = metrics.map(([key, label, color]) => {
    const base = editions[baseIdx][key] || 0;
    const raw = editions.map((e) => archiveEditionMetric(e, key));
    const values = raw.map((v) => (base > 0 ? (v / base) * 100 : (v > 0 ? 100 : 0)));
    return { key, label, color, values, raw };
  });
  const allVals = series.flatMap((s) => s.values);
  const maxV = Math.max(100, ...allVals) * 1.1;
  const y = (v) => padT + innerH - (v / (maxV || 1)) * innerH;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "trend-svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const baseline = document.createElementNS(NS, "line");
  baseline.setAttribute("x1", String(padL)); baseline.setAttribute("x2", String(w - padR));
  baseline.setAttribute("y1", String(y(100))); baseline.setAttribute("y2", String(y(100)));
  baseline.setAttribute("class", "trend-baseline");
  svg.appendChild(baseline);

  editions.forEach((e, i) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x(i))); t.setAttribute("y", String(h - 6));
    t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "trend-axis-label");
    t.textContent = e.edition;
    svg.appendChild(t);
  });

  for (const s of series) {
    const poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("points", s.values.map((v, i) => x(i) + "," + y(v)).join(" "));
    poly.setAttribute("class", "trend-line");
    poly.setAttribute("style", "stroke:" + s.color);
    svg.appendChild(poly);
    s.values.forEach((v, i) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(x(i))); c.setAttribute("cy", String(y(v))); c.setAttribute("r", "3.5");
      c.setAttribute("class", "trend-dot");
      c.setAttribute("style", "fill:" + s.color);
      const title = document.createElementNS(NS, "title");
      title.textContent = s.label + " " + editions[i].edition + ": " + s.raw[i] +
        " (" + Math.round(v) + " % av " + editions[baseIdx].edition + ")";
      c.appendChild(title);
      svg.appendChild(c);
    });
  }
  return svg;
}

// Klassnamn att erbjuda i Trend-filtrets klassväljare — ur INNEVARANDE
// (live) upplagas matcher, redan laddade utan extra kostnad. Äldre år kan
// ha haft klasser som bytt namn eller lagts ner sedan dess, men det är en
// rimlig avvägning: att i stället bygga listan ur ALLA arkiverade år
// skulle kräva att hämta hela deras matchlistor (flera MB per år för en
// stor cup) bara för att fylla en dropdown, se renderTrendView nedan.
function trendClassOptions() {
  const set = new Set();
  for (const m of state.matches) if (m.catName) set.add(m.catName);
  return [...set].sort((a, b) => catSortKey(a) - catSortKey(b));
}

// Ritar själva SVG:n + legend + fotnot för en färdig lista {edition,
// matches,teams,classes,days}-objekt — delad av både snabbvägen (direkt
// ur index.json:s aggregat) och det filtrerade läget (omräknat från fulla
// matchlistor) i renderTrendView, eftersom formen är identisk i båda fallen.
function renderTrendChartBlock(root, editions, overrideYear) {
  // "Klubbar" kräver att ALLA visade SPELADE år (matches > 0 — en
  // inställd upplaga har äkta noll oavsett skrapstatus, se
  // backfill_cupmanager_years.py) faktiskt skrapats med det rena
  // klubbnamnsfältet (home/away.club, tillkom 2026-07-24) — annars skulle
  // äldre, ännu inte omskrapade år visa en missvisande rak nedgång till 0
  // i stället för "okänt". Göms helt tills historiken hunnit skrapas om
  // (sker automatiskt i bakgrunden, se archive_results.py/build_index()).
  const metrics = TREND_METRICS.filter(([key]) =>
    key !== "clubs" || editions.every((e) => e.matches === 0 || (e[key] || 0) > 0));
  const baseIdx = trendBaselineIndex(editions, overrideYear);
  const baseEd = editions[baseIdx];
  const lastEd = editions[editions.length - 1];
  const sourceSystems = [...new Set(editions.map((e) => e.sourceSystem).filter(Boolean))];
  const legend = h("div", { class: "trend-legend" },
    metrics.map(([key, label, color]) => {
      const base = archiveEditionMetric(baseEd, key);
      const last = archiveEditionMetric(lastEd, key);
      const pct = base > 0 ? Math.round(((last - base) / base) * 100) : null;
      return h("div", { class: "trend-legend-item" },
        h("span", { class: "trend-swatch", style: "background:" + color }),
        h("span", null, label + ": " + base + " → " + last),
        pct == null || lastEd === baseEd ? null : h("span",
          { class: "trend-delta" + (pct > 0 ? " up" : pct < 0 ? " down" : "") },
          (pct > 0 ? "+" : "") + pct + " %"));
    }));
  // Skriv bara ut corona-motiveringen när baslinjen faktiskt kommer från
  // auto-heuristiken — säger man "hoppas över ... troligen corona" om år
  // användaren själv aktivt valt bort (genom att peka på ett SENARE år)
  // blir det bara missvisande.
  const isManualBaseline = overrideYear && baseEd.edition === overrideYear;
  const skippedOutlier = baseIdx > 0
    ? isManualBaseline
      ? " (valt manuellt)"
      : " (" + editions.slice(0, baseIdx).map((e) => e.edition).join(", ") +
        " hoppas över som baslinje — ovanligt liten upplaga, troligen corona-neddragen)"
    : "";
  root.append(
    h("div", { class: "trend-chart-box" }, buildTrendSvg(editions, baseIdx, metrics)),
    legend,
    h("p", { class: "muted trend-note" },
      "Allt normerat mot " + baseEd.edition + " (= 100 %)" + skippedOutlier +
      ". Antal spelare visas inte — ingen av källorna (Cup Manager/ProCup) ger " +
      "spelardata, förutom Partilles trupplistor." +
      // Ospelade år ser ut som ett ras i grafen (halvpublicerat schema,
      // se preliminary i archive_results.py) — säg det rakt ut i stället
      // för att låta kurvan tala.
      (editions.some((e) => e.preliminary)
        ? " * " + editions.filter((e) => e.preliminary).map((e) => e.edition).join(", ") +
          " är inte spelad än: schemat fylls på löpande, så talen är preliminära " +
          "och ligger lågt jämfört med färdigspelade år."
        : "") +
      (sourceSystems.length
        ? " Historiken är sammanfogad över turneringssystem; källan för migrerade " +
          "upplagor visas i tabellen."
        : "")),
    // Rådata i tabellform under diagrammet — SAMMA editions-lista (alla
    // arkiverade år, oavsett vilket som råkar vara normeringens
    // baslinje) så man kan slå upp exakta tal utan att behöva hovra
    // pluppar i grafen.
    trendTable(editions, metrics));
}

// Återanvänder .table-box/.standings (samma stil som grupptabellerna i
// Tabeller-vyn) i stället för att bygga en egen tabellstil från grunden.
// Generisk sorterbar rådatatabell — klickbara kolumnrubriker (samma
// mönster/CSS som bracketTableBlock's headerCell, se .bracket-th-sort).
// sortState ({key, dir}, dir är 1/-1) ägs och hålls vid liv av
// ANROPAREN (modulnivå-variabler, se trendTableSort m.fl. nedan) så att
// vald sortering överlever omritningar. columns: [{key, label, align,
// get(row)->sträng|tal, defaultDir, render}]. get(row) avgör ALLTID
// sorteringen; render(row) (valfri) avgör vad cellen faktiskt VISAR —
// en DOM-nod/array av noder+text i stället för get(row) tvingat genom
// String(), se Klubb/Lags "År"-kolumn (renderYearsWithGaps) för ett
// exempel som färgmarkerar enskilda år inom en och samma cell.
// rowTitle(row) är valfri — sätts som
// native tooltip på hela raden (t.ex. en fullständig klasslista).
// onRowClick(row) är valfri — gör raderna klickbara (pekare-cursor,
// hover, tangentbordsnavigerbara) för nedborrning till mer detaljerad
// vy. expandedRow(row) kan dessutom lägga en detaljrad direkt efter sin
// huvudrad; null betyder att raden är stängd.
function sortableTable(columns, rows, sortState, rowTitle, onRowClick, expandedRow) {
  const sorted = rows.slice().sort((a, b) => {
    const col = columns.find((c) => c.key === sortState.key) || columns[0];
    const av = col.get(a), bv = col.get(b);
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv : String(av).localeCompare(String(bv), "sv", { numeric: true });
    return sortState.dir * cmp;
  });
  const headerCell = (col) => {
    const active = sortState.key === col.key;
    return h("th", {
      class: (col.align === "l" ? "l " : "") + "bracket-th-sort" + (active ? " on" : ""),
      role: "button", tabindex: "0",
      onclick: () => {
        if (active) sortState.dir *= -1;
        else { sortState.key = col.key; sortState.dir = col.defaultDir || -1; }
        renderContent();
      },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } },
    }, col.label, active ? h("span", { class: "sort-arrow" }, sortState.dir > 0 ? " ▲" : " ▼") : null);
  };
  const bodyRow = (row) => h("tr", {
    ...(rowTitle ? { title: rowTitle(row) } : {}),
    ...(onRowClick ? {
      class: "sortable-row-clickable", role: "button", tabindex: "0",
      onclick: () => onRowClick(row),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } },
    } : {}),
  }, columns.map((col, i) => h(i === 0 ? "th" : "td",
    { class: col.align === "l" ? "l" : "", ...(i === 0 ? { scope: "row" } : {}) },
    col.render ? col.render(row) : String(col.get(row)))));
  const bodyRows = sorted.flatMap((row) => {
    const main = bodyRow(row);
    const detail = expandedRow && expandedRow(row);
    return detail ? [main, h("tr", { class: "sortable-expanded-row" },
      h("td", { colspan: String(columns.length) }, detail))] : [main];
  });
  return h("div", { class: "table-box" },
    h("table", { class: "standings" },
      h("thead", null, h("tr", null, columns.map(headerCell))),
      h("tbody", null, bodyRows)));
}

// Sorteringsval per tabell — modulnivå (inte state, sparas ej) så de
// överlever renderContent() men nollställs vid en full sidladdning,
// precis som bracketSort.
let trendTableSort = { key: "edition", dir: -1 };
let trendCompareTableSort = { key: "edition", dir: -1 };
let clubTableSort = { key: "cupName", dir: 1 };
let clubClassTableSort = { key: "matches", dir: -1 };

const PRELIM_TITLE = "Preliminärt: upplagan är inte spelad än och schemat " +
  "kan vara ofullständigt — talen går inte att jämföra rakt av med " +
  "färdigspelade år.";

function trendEditionLabel(e) {
  if (e.status === "cancelled") {
    return [e.edition, h("span", {
      class: "trend-prelim",
      title: e.note || "Upplagan ställdes in.",
    }, " · inställd")];
  }
  return e.preliminary
    ? [e.edition, h("span", { class: "trend-prelim", title: PRELIM_TITLE }, " *")]
    : e.edition;
}

function trendTable(editions, metrics) {
  const showSource = editions.some((e) => e.sourceSystem);
  const columns = [
    {
      key: "edition", label: "År", align: "l", defaultDir: -1,
      get: (e) => e.edition,
      // Ospelade upplagor (se preliminary i archive_results.py) får en
      // markör — deras tal är en ögonblicksbild av ett halvpublicerat
      // schema och sjunker inte, de har bara inte fyllts på än.
      render: trendEditionLabel,
    },
    ...(showSource ? [{
      key: "sourceSystem", label: "Källa", align: "l", defaultDir: 1,
      get: (e) => e.sourceSystem || "current",
      render: (e) => e.sourceSystem === "procup" ? "ProCup" : "Nuvarande system",
    }] : []),
    ...metrics.map(([key, label]) => ({
      key, label, defaultDir: -1,
      get: (e) => archiveEditionMetric(e, key),
      ...(key === "matches" ? { render: (e) => archiveEditionMatchLabel(e) } : {}),
    })),
  ];
  return sortableTable(columns, editions, trendTableSort);
}

// Cup-över-cuper-lägena (jämförelsegrafen nedan OCH Klubb/Lag-fliken,
// se renderClubView) behöver arkiverade år för ANDRA cuper än den
// aktiva — bygger listan över VILKA cuper (av arkivindexets fulla lista)
// som faktiskt har någon arkiverad historik alls, oavsett om de stödjer
// formkurvans egna >=2-årskrav (ett enda deltagar-år är fortfarande
// relevant information).
//
// sportFilter (valfri): begränsar till en sport (t.ex. "handboll" eller
// "fotboll", se cup.sport i data/cups.json). Trend-jämförelsegrafen
// använder detta (blandar man in fotbollscupers matcher/lag-antal i en
// handbollsjämförelse blir talen meningslösa) — Klubb/Lag gör INTE det,
// en klubb kan i teorin ha sektioner i flera sporter och hela poängen
// där är att hitta ALLA cuper den förekommer i.
function trendCupOptions(sportFilter) {
  const idx = state.archiveIndex || {};
  return HB.allCups()
    .filter((c) => (idx[c.id] && idx[c.id].editions || []).some((e) => e.matches > 0))
    .filter((c) => !sportFilter || (c.sport || "handboll") === sportFilter)
    .map((c) => c.id);
}

// Egen toppnivåflik (bredvid Schema/Tabeller/Slutspel/Bana) för INNEVARANDE
// cup — flyttad hit från en Historik-modalflik 2026-07-24, då den kändes
// avskild från resten av appen (särskilt efter att fritt årsval byggdes in
// direkt i huvudvyn, se state.years/ensureYearMatches). state.archiveIndex
// laddas en gång vid appstart (se init()).
//
// Cupväljare tillagd senare samma dag: EN vald cup (förval, matchar
// state.cupId) ger formkurvan som vanligt (nu för VALFRI cup, inte bara
// den aktiva — byt cup i pickern utan att röra huvudappens headerval).
// FLERA valda cuper ger i stället en jämförelsegraf, alla ovanpå varandra
// (renderTrendCompare) — den tidigare fritextsökningen på lag/klubb
// (som krävdes för att visa NÅGOT alls med fler än en cup vald) togs
// bort 2026-07-24: en lista över EN klubbs historik hör hemma i sin
// egen Klubb/Lag-flik (renderClubView, söker dessutom över ALLA cuper,
// inte bara de som råkar vara valda här).
//
// Klass-/lagfilter: index.json:s aggregat räcker för OFILTRERAD
// formkurva (snabbt, redan laddat), men ett filter kräver de FULLA
// matchlistorna per arkiverat år — hämtas lat, bara när det faktiskt
// behövs, via ensureYearMatches (kan bli flera MB för en stor cup, se
// trendClassOptions). Klassfiltret gäller bara enskild-cup-läget — ett
// klassnamn plockat ur INNEVARANDE cups live-matcher (trendClassOptions)
// vore ett obegripligt filter att applicera på andra cupers helt egna
// klassnamnsscheman i jämförelseläget.
function renderTrendView(root) {
  // Bara cuper av SAMMA sport som innevarande cup — att jämföra t.ex.
  // matchantal mellan en handbolls- och en fotbollscup i samma graf är
  // meningslöst. Byt aktiv cup (Inställningar) för att jämföra fotbolls-
  // cuper med varandra i stället. state.exploreCupIds delas med Karta
  // (se dess kommentar) — cupurvalet hänger alltså med om man växlar
  // mellan de två flikarna.
  const cupOptions = trendCupOptions(cup().sport || "handboll");
  if (!cupOptions.length) {
    root.append(h("div", { class: "banner" },
      "Ingen cup har tillräckligt med arkiverad historik för en formkurva."));
    return;
  }
  // Städa bort ev. kvarvarande urval från en ANNAN sport (t.ex. om man
  // valde flera fotbollscuper och sedan bytte aktiv cup till en
  // handbollscup i Inställningar) — annars skulle den fortfarande
  // blandas in i jämförelsen trots att den inte ens syns i väljaren längre.
  for (const id of [...state.exploreCupIds]) if (!cupOptions.includes(id)) state.exploreCupIds.delete(id);
  if (!state.exploreCupIds.size) state.exploreCupIds.add(state.cupId);

  const cupPicker = buildPicker({
    items: cupOptions.map((id) => {
      const c = HB.allCups().find((x) => x.id === id);
      const name = (c && c.name) || id;
      return { id, label: name, sortKey: 0, sortName: name };
    }),
    selected: state.exploreCupIds,
    emptyLabel: "Välj cup(er)",
    countLabel: (n) => n + " cuper",
    searchPlaceholder: "Sök cup …",
    sortToggle: false, // cuper har inget "klass"-begrepp — bara namnsortering
    soloClickable: true, // klick på cupnamnet väljer bara den cupen
    onChange: () => renderContent(),
  });

  const selectedCupIds = [...state.exploreCupIds];
  const showClassPicker = selectedCupIds.length === 1;
  const classOptions = showClassPicker ? trendClassOptions() : [];
  const classPicker = classOptions.length ? buildPicker({
    items: classOptions.map((name) => ({
      id: name, label: name, sortKey: catSortKey(name), sortName: name,
    })),
    selected: state.trendCats,
    emptyLabel: "Alla klasser",
    countLabel: (n) => "Klasser (" + n + ")",
    searchPlaceholder: "Sök klass …",
    genderQuickSelect: true,
    onChange: () => renderContent(),
  }) : null;

  root.append(h("div", { class: "history-controls" }, cupPicker, classPicker));

  const chartHost = h("div", { class: "trend-chart-host" });
  root.append(chartHost);

  if (!selectedCupIds.length) {
    chartHost.append(h("p", { class: "muted" }, "Välj minst en cup ovan."));
    return;
  }

  // Flera cuper valda: jämförelsegraf, alla ovanpå varandra (normerade
  // mot varsitt eget baslinjeår) — se renderTrendCompare.
  if (selectedCupIds.length > 1) {
    renderTrendCompare(chartHost, selectedCupIds);
    return;
  }

  // En cup vald: formkurva, samma som tidigare men för VALFRI vald cup.
  // Editions med 0 matcher (t.ex. en inställd corona-upplaga, se
  // backfill_cupmanager_years.py) TAS MED här, till skillnad från
  // tidigare — mer informativt att visa dem som en riktig nollpunkt i
  // grafen än att tyst hoppa över dem. "Minst två år"-spärren nedan
  // räknar ändå bara RIKTIGA (spelade) år, annars skulle en cup med ett
  // enda spelat år plus flera inställda felaktigt räknas som redo.
  const trendCupId = selectedCupIds[0];
  const idx = state.archiveIndex || {};
  const entry = idx[trendCupId];
  const editionsMeta = ((entry && entry.editions) || [])
    .slice().sort((a, b) => a.edition.localeCompare(b.edition));
  const trendCupName = (HB.allCups().find((c) => c.id === trendCupId) || {}).name || trendCupId;
  const realYears = editionsMeta.filter((e) => e.matches > 0).length;
  if (realYears < 2) {
    chartHost.append(h("p", { class: "muted" },
      trendCupName + " har bara " + realYears +
      " spelat arkiverat år — behöver minst två för att visa en formkurva."));
    return;
  }

  // Manuellt baslinjeår — vinner över auto-heuristiken i
  // trendBaselineIndex när det matchar ett av de faktiskt spelade åren.
  // Byggs av RIKTIGA år bara (en inställd 0-upplaga vore ett meningslöst
  // 100 %-ankare). Om det sparade valet inte längre finns bland årets
  // alternativ (t.ex. efter cupbyte) faller väljaren tillbaka till Auto
  // utan att krascha — trendBaselineIndex gör samma sak.
  const baselineOptions = editionsMeta.filter((e) => e.matches > 0);
  const baselineValue = baselineOptions.some((e) => e.edition === state.trendBaselineYear)
    ? state.trendBaselineYear : "";
  const baselineSelect = h("select", { class: "select", "aria-label": "Baslinjeår" },
    h("option", { value: "" }, "Baslinje: auto"),
    baselineOptions.map((e) => h("option",
      { value: e.edition, ...(e.edition === baselineValue ? { selected: "" } : {}) },
      "Baslinje: " + e.edition)));
  baselineSelect.value = baselineValue;
  baselineSelect.addEventListener("change", () => {
    state.trendBaselineYear = baselineSelect.value || null;
    renderContent();
  });
  chartHost.append(h("div", { class: "row trend-baseline-row" }, baselineSelect));

  if (!state.trendCats.size) {
    renderTrendChartBlock(chartHost, editionsMeta, baselineValue);
    return;
  }

  for (const em of editionsMeta) ensureYearMatches(em.edition, trendCupId);
  const loaded = editionsMeta.map((em) =>
    ({ meta: em, ym: state.yearMatches[trendCupId + ":" + em.edition] }));
  if (loaded.some(({ ym }) => !ym || ym.status === "loading")) {
    chartHost.append(h("p", { class: "muted" }, "Hämtar arkiverade år för filtrering …"));
    return;
  }
  const computed = loaded.map(({ meta, ym }) => {
    const matches = ((ym && ym.matches) || []).filter((m) => state.trendCats.has(m.catName));
    const teams = new Set(), classes = new Set(), days = new Set(), clubs = new Set();
    for (const m of matches) {
      if (m.home.id != null) teams.add(m.home.id);
      if (m.away.id != null) teams.add(m.away.id);
      if (m.home.club) clubs.add(m.home.club);
      if (m.away.club) clubs.add(m.away.club);
      if (m.catName) classes.add(m.catName);
      if (hasScheduledStart(m)) days.add(Math.floor(m.start / 86400000));
    }
    return {
      edition: meta.edition, matches: matches.length, teams: teams.size,
      clubs: clubs.size, classes: classes.size, days: days.size,
    };
  });
  if (computed.every((e) => e.matches === 0)) {
    chartHost.append(h("p", { class: "muted" }, "Inga arkiverade matcher matchar klassfiltret."));
    return;
  }
  renderTrendChartBlock(chartHost, computed, baselineValue);
}

// Jämförelsegraf: flera cuper "ovanpå varandra" i samma diagram, EN
// metric i taget (annars metric×cup-kombinationer snabbt oläsligt — upp
// till 5 mått × flera cuper). Varje cups linje normeras mot sitt EGET
// baslinjeår (samma 40%-heuristik som enskild-cup-läget, se
// trendBaselineIndex) — jämför alltså relativ UTVECKLING, inte absolut
// storlek, så en liten och en stor cup går att jämföra rakt av.
function renderTrendCompare(root, cupIds) {
  const idx = state.archiveIndex || {};
  const cupsData = cupIds.map((id, i) => {
    const entry = idx[id];
    const editions = ((entry && entry.editions) || [])
      .slice().sort((a, b) => a.edition.localeCompare(b.edition));
    const name = (HB.allCups().find((c) => c.id === id) || {}).name || id;
    return { cupId: id, cupName: name, editions, color: MULTI_COLOR_PALETTE[i % MULTI_COLOR_PALETTE.length] };
  }).filter((c) => c.editions.some((e) => e.matches > 0));
  if (!cupsData.length) {
    root.append(h("p", { class: "muted" },
      "Ingen av de valda cuperna har arkiverad historik med spelade matcher."));
    return;
  }

  const metricSelect = h("select", { class: "select", "aria-label": "Mått" },
    TREND_METRICS.map(([key, label]) => h("option",
      { value: key, ...(key === state.trendCompareMetric ? { selected: "" } : {}) }, label)));
  metricSelect.value = state.trendCompareMetric;
  metricSelect.addEventListener("change", () => {
    state.trendCompareMetric = metricSelect.value;
    renderContent();
  });
  root.append(h("div", { class: "row trend-baseline-row" }, metricSelect));

  const metricKey = state.trendCompareMetric;
  const metricLabel = (TREND_METRICS.find(([k]) => k === metricKey) || [, metricKey])[1];
  root.append(h("div", { class: "trend-chart-box" }, buildTrendCompareSvg(cupsData, metricKey)));

  const legend = h("div", { class: "trend-legend" }, cupsData.map((c) => {
    const played = c.editions.filter((e) => e.matches > 0);
    const baseIdx = trendBaselineIndex(played);
    const baseEd = played[baseIdx];
    const lastEd = played[played.length - 1];
    const base = baseEd[metricKey] || 0;
    const last = lastEd[metricKey] || 0;
    const pct = base > 0 ? Math.round(((last - base) / base) * 100) : null;
    return h("div", { class: "trend-legend-item" },
      h("span", { class: "trend-swatch", style: "background:" + c.color }),
      h("span", null, c.cupName + ": " + base + " (" + baseEd.edition + ") → " +
        last + " (" + lastEd.edition + ")"),
      pct == null || lastEd === baseEd ? null : h("span",
        { class: "trend-delta" + (pct > 0 ? " up" : pct < 0 ? " down" : "") },
        (pct > 0 ? "+" : "") + pct + " %"));
  }));
  root.append(legend,
    h("p", { class: "muted trend-note" },
      "Varje cup normerad mot sitt eget baslinjeår (= 100 %) — jämför relativ " +
      "utveckling, inte absolut storlek."),
    trendCompareTable(cupsData, metricKey, metricLabel));
}

function buildTrendCompareSvg(cupsData, metricKey) {
  const w = 640, h2 = 260, padL = 26, padR = 26, padT = 16, padB = 26;
  const innerW = w - padL - padR, innerH = h2 - padT - padB;
  const years = [...new Set(cupsData.flatMap((c) => c.editions.map((e) => e.edition)))].sort();
  const n = years.length;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yearIndex = new Map(years.map((y, i) => [y, i]));

  const series = cupsData.map((c) => {
    const baseIdx = trendBaselineIndex(c.editions);
    const base = c.editions[baseIdx][metricKey] || 0;
    const points = c.editions
      .map((e) => ({
        i: yearIndex.get(e.edition), edition: e.edition, raw: e[metricKey] || 0,
        v: base > 0 ? ((e[metricKey] || 0) / base) * 100 : ((e[metricKey] || 0) > 0 ? 100 : 0),
      }))
      .sort((a, b) => a.i - b.i);
    return { cupName: c.cupName, color: c.color, points, baseEdition: c.editions[baseIdx].edition };
  });
  const allVals = series.flatMap((s) => s.points.map((p) => p.v));
  const maxV = Math.max(100, ...allVals) * 1.1;
  const y = (v) => padT + innerH - (v / (maxV || 1)) * innerH;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "trend-svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + h2);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const baseline = document.createElementNS(NS, "line");
  baseline.setAttribute("x1", String(padL)); baseline.setAttribute("x2", String(w - padR));
  baseline.setAttribute("y1", String(y(100))); baseline.setAttribute("y2", String(y(100)));
  baseline.setAttribute("class", "trend-baseline");
  svg.appendChild(baseline);

  years.forEach((yr, i) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x(i))); t.setAttribute("y", String(h2 - 6));
    t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "trend-axis-label");
    t.textContent = yr;
    svg.appendChild(t);
  });

  for (const s of series) {
    // Bryter linjen i separata segment vid luckor (år cupen HELT saknar
    // arkiverad data, till skillnad från en äkta inställd nollpunkt som
    // fortfarande är en punkt på linjen) i stället för att dra en
    // missvisande rak linje över dem.
    let seg = [];
    const flushSeg = () => {
      if (seg.length > 1) {
        const poly = document.createElementNS(NS, "polyline");
        poly.setAttribute("points", seg.map((p) => x(p.i) + "," + y(p.v)).join(" "));
        poly.setAttribute("class", "trend-line");
        poly.setAttribute("style", "stroke:" + s.color);
        svg.appendChild(poly);
      }
      seg = [];
    };
    let prevI = null;
    for (const p of s.points) {
      if (prevI != null && p.i !== prevI + 1) flushSeg();
      seg.push(p);
      prevI = p.i;
    }
    flushSeg();
    for (const p of s.points) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(x(p.i))); c.setAttribute("cy", String(y(p.v))); c.setAttribute("r", "3.5");
      c.setAttribute("class", "trend-dot");
      c.setAttribute("style", "fill:" + s.color);
      const title = document.createElementNS(NS, "title");
      title.textContent = s.cupName + " " + p.edition + ": " + p.raw +
        " (" + Math.round(p.v) + " % av " + s.baseEdition + ")";
      c.appendChild(title);
      svg.appendChild(c);
    }
  }
  return svg;
}

function trendCompareTable(cupsData, metricKey, metricLabel) {
  const rows = cupsData.flatMap((c) => c.editions.map((e) =>
    ({ cupName: c.cupName, edition: e.edition, value: e[metricKey] || 0 })));
  const columns = [
    { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
    { key: "edition", label: "År", align: "l", defaultDir: -1, get: (r) => r.edition },
    { key: "value", label: metricLabel, defaultDir: -1, get: (r) => r.value },
  ];
  return sortableTable(columns, rows, trendCompareTableSort);
}

// Klubb/Lag-fliken: en cups arkiverade upplagor, filtrerat mot ett
// ev. valt årsfilter (state.clubYears, tomt = alla år) — delad av alla
// tre nivåerna nedan så ett årsval även styr VILKA år som hämtas
// (ensureYearMatches), inte bara vad som till slut visas.
function clubEditionsFor(cupId, selectedYears = state.clubYears) {
  const idx = state.archiveIndex || {};
  const editionsMeta = ((idx[cupId] && idx[cupId].editions) || []).filter((e) => e.matches > 0);
  return selectedYears.size ? editionsMeta.filter((e) => selectedYears.has(e.edition)) : editionsMeta;
}

// Klubb/Lag-flikens "År"-kolumn: fyller ut med de år CUPEN har arkiverad
// historik men klubben INTE deltog (dämpad/röd text) bredvid åren den
// faktiskt var med (vanlig text) — svarar direkt på "var vi med varje
// gång, eller missade vi något?" utan att behöva räkna själv eller borra
// ner i varje cup. Jämförs mot clubEditionsFor(cupId) — SAMMA årsmängd
// som redan styr vad som räknas in i raden ovanför (respekterar alltså
// ett ev. aktivt årsfilter, i stället för att dränka ett medvetet
// avgränsat urval i rött för alla bortvalda år).
function renderYearsWithGaps(cupId, participatedYears) {
  const participated = new Set(participatedYears);
  const allYears = clubEditionsFor(cupId).map((e) => e.edition).sort();
  const ranges = [];
  for (const year of allYears) {
    const gap = !participated.has(year);
    const prev = ranges[ranges.length - 1];
    const consecutive = prev && /^\d{4}$/.test(prev.end) && /^\d{4}$/.test(year) &&
      +year === +prev.end + 1;
    if (prev && prev.gap === gap && consecutive) prev.end = year;
    else ranges.push({ start: year, end: year, gap });
  }
  return h("span", {
    class: "club-year-ranges",
    title: allYears.map((y) => y + (participated.has(y) ? " deltagande" : " saknas")).join(" · "),
  }, ranges.flatMap((range, i) => [
    i ? ", " : null,
    h("span", range.gap ? { class: "club-year-gap" } : null,
      range.start === range.end ? range.start : range.start + "–" + range.end),
  ]));
}

const clubMetricNumber = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 });

function clubMetricSummary(values) {
  if (!values.length) return { mean: 0, median: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, median };
}

function renderClubMetric(total, yearStats, key) {
  // yearStats är redan avgränsat av årsväljaren via clubEditionsFor().
  // Med bara ett deltagandeår blir snitt och median identiska med totalen
  // och tillför ingen information, så visa dem först vid minst två år.
  if (yearStats.length < 2) {
    return h("span", { class: "club-metric-cell" }, h("strong", null, String(total)));
  }
  const summary = clubMetricSummary(yearStats.map((year) => year[key]));
  return h("span", { class: "club-metric-cell" },
    h("strong", null, String(total)),
    h("small", null, "Snitt " + clubMetricNumber.format(summary.mean) +
      " · median " + clubMetricNumber.format(summary.median)));
}

// Riktig förloppsindikator för en pågående computeClubRows()-hämtning —
// en obestämd "Hämtar …" kändes som att sidan hängt sig på en sökning
// som (första gången, innan IndexedDB-cachen i fetchArchiveEdition hunnit
// fyllas på) kan behöva dra ner tiotals MB över nätet. Räknas om vid
// varje omritning (loadedCount/totalCount kommer från computeClubRows,
// som anropas på nytt varje gång) — fylls på i takt med att fler
// cup-år-filer svarar, ingen egen timer/polling behövs.
function archiveProgressBlock(loaded, total) {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  return h("div", { class: "archive-progress" },
    h("p", { class: "muted" }, "Hämtar arkiverade år … (" + loaded + " av " + total + ")"),
    h("div", { class: "archive-progress-bar" },
      h("div", { class: "archive-progress-fill", style: "width:" + pct + "%" })));
}

// Klubb/Lag-fliken: alla år som finns att välja mellan i årsfiltret —
// unionen över samtliga cuper med arkiverad historik (trendCupOptions),
// inte bara de som råkar matcha den aktuella sökningen, så filtret inte
// hoppar runt när man byter sökterm.
function clubYearOptions() {
  const idx = state.archiveIndex || {};
  const years = new Set();
  for (const cupId of trendCupOptions()) {
    for (const e of (idx[cupId] && idx[cupId].editions) || []) {
      if (e.matches > 0) years.add(e.edition);
    }
  }
  return [...years].sort().reverse();
}

// Lat, EN gång: se state.teamIndex-kommentaren. Modulnivå-flagga (inte
// state.teamIndex självt, som medvetet ska stanna på null tills datan
// faktiskt finns) förhindrar att computeClubRows startar om hämtningen
// vid varje omritning innan löftet hunnit lösa sig.
let teamIndexRequested = false;
export function ensureTeamIndex() {
  if (teamIndexRequested) return;
  teamIndexRequested = true;
  HB.api.fetchTeamIndex().then((idx) => {
    state.teamIndex = idx || {};
    renderContent();
  });
}

// Avgör om en cup-upplaga ens KAN innehålla söktermen, enligt det redan
// laddade lagnamnsindexet — false = vet SÄKERT att den inte gör det (kan
// hoppas över helt, ingen nätverksfråga för den stora matchfilen). true
// betyder antingen att ett namn faktiskt matchar (måste hämtas för att
// räkna exakt) ELLER att upplagan saknas i indexet (t.ex. nyare än
// senaste indexbygget, se scripts/build_team_index.py) — då antas den
// kunna matcha, hellre missa optimeringen än missa en riktig träff.
function editionMightMatch(cupId, edition, teamQuery) {
  const names = state.teamIndex[cupId] && state.teamIndex[cupId][edition];
  if (!names) return true;
  return names.some((n) => matchesBooleanQuery(n.toLowerCase(), teamQuery));
}

const CLUB_ARCHIVE_CONCURRENCY = 4;
const clubEditionStatsCache = new Map();

function clubEditionStats(cupId, edition, matches, teamQuery) {
  const normalizedQuery = teamQuery.trim().toLowerCase();
  const key = cupId + "|" + edition + "|" + normalizedQuery;
  if (clubEditionStatsCache.has(key)) return clubEditionStatsCache.get(key);
  const teamIds = new Set();
  const classes = new Set();
  const names = new Set();
  let matchCount = 0;
  for (const m of matches) {
    const homeIsUs = matchesBooleanQuery(m.home.name.toLowerCase(), normalizedQuery);
    const awayIsUs = matchesBooleanQuery(m.away.name.toLowerCase(), normalizedQuery);
    if (!homeIsUs && !awayIsUs) continue;
    matchCount++;
    if (homeIsUs && m.home.id != null) { teamIds.add(m.home.id); names.add(m.home.name); }
    if (awayIsUs && m.away.id != null) { teamIds.add(m.away.id); names.add(m.away.name); }
    if (m.catName) classes.add(m.catName);
  }
  const result = { teams: teamIds.size, matches: matchCount,
    classes: [...classes], names: [...names] };
  clubEditionStatsCache.set(key, result);
  // Ett långt användningspass med många fritextfrågor ska inte kunna
  // växa cachen utan gräns. Äldsta beräkningen är billig att göra om.
  if (clubEditionStatsCache.size > 500) {
    clubEditionStatsCache.delete(clubEditionStatsCache.keys().next().value);
  }
  return result;
}

// Klubb/Lag-fliken: aggregerar EN sökterms (klubb-/lagnamn) historik över
// ALLA cuper med arkiverad data (till skillnad från Trend-jämförelsen
// ovan, som bara omfattar de cuper man själv valt). Kräver FULLA
// matchlistor per arkiverat år och cup (samma ensureYearMatches som
// formkurvan) — men bara för de upplagor som lagnamnsindexet (se ovan)
// inte redan kan avskriva helt. Man är sällan intresserad av mer än en
// handfull klubbar åt gången (en själv, ett par att jämföra med) — det
// finns ingen anledning att hämta ALLA ~190 arkiverade upplagor av ALLA
// cuper bara för att räkna ut EN sökning.
function computeClubRows(cupIds, teamQuery, selectedYears = state.clubYears) {
  ensureTeamIndex();
  // loadedCount/totalCount: hur många av de berörda cup-år-filerna som
  // redan svarat (klart ELLER fel, bara inte "loading") — låter
  // renderClubView visa en riktig förloppsindikator ("X av Y hämtade")
  // i stället för en obestämd "Hämtar …"-text. Väntar medvetet in HELA
  // lagnamnsindexet (state.teamIndex) innan en enda stor matchfil ens
  // beställs — annars hinner flera beställas i onödan under den korta
  // stund (litet, snabbt anrop) indexet fortfarande laddar, vilket i
  // praktiken skulle omintetgöra en stor del av optimeringen.
  if (!state.teamIndex) {
    let totalCount = 0;
    for (const cupId of cupIds) totalCount += clubEditionsFor(cupId, selectedYears).length;
    return { pending: true, rows: [], loadedCount: 0, totalCount };
  }
  let pending = false;
  let loadedCount = 0, totalCount = 0;
  const loadingNow = Object.values(state.yearMatches)
    .filter((entry) => entry && entry.status === "loading").length;
  let availableLoadSlots = Math.max(0, CLUB_ARCHIVE_CONCURRENCY - loadingNow);
  const rows = [];
  for (const cupId of cupIds) {
    const editionsMeta = clubEditionsFor(cupId, selectedYears);
    const years = [];
    const yearStats = [];
    let totalTeams = 0, totalMatches = 0;
    const classes = new Set();
    // Rå lagnamn (inte bara antal) som faktiskt matchade söktermen — låter
    // Klubbjämförelsens radexpansion (se clubCompareDetailBlock) visa EXAKT
    // vilka stavningsvarianter som räknats in, t.ex. "Önnereds HK" och
    // "Önnered HK" (utan s) från olika cuper — ett sätt att själv avgöra om
    // två liknande sökningar/namn råkar vara samma klubb i praktiken.
    const names = new Set();
    for (const em of editionsMeta) {
      totalCount++;
      if (!editionMightMatch(cupId, em.edition, teamQuery)) {
        loadedCount++; // känt resultat direkt av indexet — inget att vänta på
        continue;
      }
      const yearKey = cupId + ":" + em.edition;
      let ym = state.yearMatches[yearKey];
      if (!ym && availableLoadSlots > 0) {
        ensureYearMatches(em.edition, cupId);
        availableLoadSlots--;
        ym = state.yearMatches[yearKey];
      }
      if (!ym || ym.status === "loading") { pending = true; continue; }
      loadedCount++;
      if (ym.status !== "done") continue;
      const editionStats = clubEditionStats(cupId, em.edition, ym.matches, teamQuery);
      for (const className of editionStats.classes) classes.add(className);
      for (const name of editionStats.names) names.add(name);
      if (editionStats.teams) {
        years.push(em.edition);
        yearStats.push({ edition: em.edition, teams: editionStats.teams,
          matches: editionStats.matches, classes: editionStats.classes.length });
        totalTeams += editionStats.teams;
        totalMatches += editionStats.matches;
      }
    }
    if (years.length) {
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      rows.push({
        cupId, cupName: (cupObj && cupObj.name) || cupId, years: years.sort(),
        totalTeams, totalMatches, totalClasses: classes.size,
        yearStats: yearStats.sort((a, b) => a.edition.localeCompare(b.edition)),
        classes, names,
      });
    }
  }
  return { pending, rows, loadedCount, totalCount };
}

// Klubb/Lag-fliken, nedborrningsnivå 1 (en vald cup): samma matcher som
// computeClubRows redan laddat via ensureYearMatches, men brutna ner per
// KLASS i stället för aggregerade till en enda rad. "edition|id" som
// nyckel i lag-mängderna (inte bara id) — Cup Manager delar ut nya
// lag-id:n varje upplaga (se allActiveMatches-kommentaren), så samma
// rådata-id kan i teorin återanvändas mellan år utan att vara samma lag.
function computeClubCupDetail(cupId, teamQuery) {
  const editionsMeta = clubEditionsFor(cupId);
  const byClass = new Map(); // klassnamn -> {teams:Set, matches:antal}
  const allTeams = new Set();
  const days = new Set();
  let totalMatches = 0;
  for (const em of editionsMeta) {
    const ym = state.yearMatches[cupId + ":" + em.edition];
    if (!ym || ym.status !== "done") continue;
    for (const m of ym.matches) {
      const homeIsUs = matchesBooleanQuery(m.home.name.toLowerCase(), teamQuery);
      const awayIsUs = matchesBooleanQuery(m.away.name.toLowerCase(), teamQuery);
      if (!homeIsUs && !awayIsUs) continue;
      totalMatches++;
      if (hasScheduledStart(m)) days.add(Math.floor(m.start / 86400000));
      const cls = m.catName || "(okänd klass)";
      if (!byClass.has(cls)) byClass.set(cls, { teams: new Set(), matches: 0 });
      const entry = byClass.get(cls);
      entry.matches++;
      if (homeIsUs && m.home.id != null) { entry.teams.add(em.edition + "|" + m.home.id); allTeams.add(em.edition + "|" + m.home.id); }
      if (awayIsUs && m.away.id != null) { entry.teams.add(em.edition + "|" + m.away.id); allTeams.add(em.edition + "|" + m.away.id); }
    }
  }
  const classes = [...byClass.entries()].map(([className, e]) =>
    ({ className, teamCount: e.teams.size, matchCount: e.matches }));
  return { classes, totalTeams: allTeams.size, totalMatches, totalDays: days.size };
}

// Klubb/Lag-fliken, nedborrningsnivå 2 (en vald cup + klass): grupperar
// matcherna per LAG (edition+id, se kommentaren ovan) i stället för per
// klass — varje grupp blir en rubrik + matchkort i renderClubClassDetail.
// Ett lag som spelat BÅDE hemma och borta mot varandra "internt" (sällsynt,
// t.ex. en klubbs egna lag möts) hamnar korrekt i BÅDA gruppernas listor.
function computeClubClassGroups(cupId, className, teamQuery) {
  const editionsMeta = clubEditionsFor(cupId);
  const groups = new Map(); // "edition|id" -> {teamId, teamName, edition, matches:[]}
  for (const em of editionsMeta) {
    const ym = state.yearMatches[cupId + ":" + em.edition];
    if (!ym || ym.status !== "done") continue;
    for (const m of ym.matches) {
      if ((m.catName || "(okänd klass)") !== className) continue;
      for (const side of [m.home, m.away]) {
        if (side.id == null || !matchesBooleanQuery(side.name.toLowerCase(), teamQuery)) continue;
        const key = em.edition + "|" + side.id;
        if (!groups.has(key)) {
          groups.set(key, { teamId: side.id, teamName: side.name, edition: em.edition, matches: [] });
        }
        groups.get(key).matches.push(m);
      }
    }
  }
  return [...groups.values()].sort((a, b) =>
    b.edition.localeCompare(a.edition) || b.matches.length - a.matches.length);
}

let clubQuerySeeded = false;

// Egen toppnivåflik: "en klubbs/ett lags historik över alla cuper" —
// svarar direkt på "vilka cuper har t.ex. Alingsås HK deltagit i, med
// hur många lag, i vilka klasser?". Söker alltid över SAMTLIGA cuper med
// arkiverad historik (trendCupOptions), till skillnad från Trend-
// jämförelsen som är avgränsad till valda cuper — en klubbfråga är till
// sin natur global, inte cup-för-cup.
function renderClubView(root) {
  // Förifyller sökrutan med den egna klubben EN gång (första besöket) —
  // därefter rör vi den inte, annars skulle en tömd sökruta (t.ex. via
  // krysset) omedelbart återfyllas nästa omritning.
  if (!clubQuerySeeded) { clubQuerySeeded = true; state.clubQuery = state.favoriteClub || ""; }

  const input = h("input", {
    class: "search", type: "text", placeholder: "Lag/klubb, t.ex. Alingsås HK",
    title: "Stöder & (och) och / eller , (eller), t.ex. Alingsås&Blå",
  });
  input.value = state.clubQuery;
  // En ny sökning gör en pågående nedborrning (vald cup/klass, se
  // state-kommentaren) obegriplig — en klass som fanns för förra
  // sökningen betyder inget för den nya. Nollställ båda.
  const applyQuery = () => {
    state.clubQuery = input.value;
    state.clubDrillCup = null; state.clubDrillClass = null;
    renderContent();
  };
  input.addEventListener("change", applyQuery);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyQuery(); }
  });
  // Autocomplete (samma klubbkatalog/minLen som Klubbjämförelse, se
  // ensureCompareCandidates) — fritextsökningen stödjer visserligen boolesk
  // syntax (& och /) och funkar utan, men utan förslag var det lätt att
  // skriva ett namn som inte matchar NÅGOT (fel stavning, saknat mellanslag)
  // och bara få en tom träfflista utan att förstå varför.
  ensureCompareCandidates();
  const clubOptions = h("div", { class: "autocomplete-list" });
  clubOptions.hidden = true;
  attachAutocomplete(input, clubOptions, () => compareCandidates || [], (name) => {
    state.clubQuery = name; state.clubDrillCup = null; state.clubDrillClass = null;
    renderContent();
  }, 2);

  // Årsfilter (state.clubYears, tomt = alla år) — påverkar inte sökningen
  // i sig, men en nedborrning gjord för ETT årsurval kan bli obegriplig
  // (t.ex. en klass utan träffar) med ett annat, så nollställ den precis
  // som vid en ny sökterm.
  const yearOptions = clubYearOptions();
  const yearPicker = yearOptions.length > 1 ? buildPicker({
    items: yearOptions.map((y) => ({ id: y, label: y, sortKey: 0, sortName: y })),
    selected: state.clubYears,
    emptyLabel: "Alla år",
    countLabel: (n) => (n === 1 ? "1 år" : n + " år"),
    searchPlaceholder: "Sök år …",
    sortToggle: false,
    soloClickable: true,
    onChange: () => { state.clubDrillCup = null; state.clubDrillClass = null; renderContent(); },
  }) : null;

  root.append(h("div", { class: "history-controls" },
    h("div", { class: "autocomplete-wrap trend-team-search" },
      withClearButton(input, () => {
        state.clubQuery = ""; state.clubDrillCup = null; state.clubDrillClass = null;
        renderContent();
      }),
      clubOptions),
    yearPicker));

  const resultHost = h("div", { class: "trend-chart-host" });
  root.append(resultHost);

  const query = state.clubQuery.trim();
  if (!query) {
    resultHost.append(h("p", { class: "muted" },
      "Skriv ett lag-/klubbnamn ovan för att se dess historik över alla cuper."));
    return;
  }

  if (state.clubDrillCup && state.clubDrillClass) {
    renderClubClassDetail(resultHost, state.clubDrillCup, state.clubDrillClass, query);
    return;
  }
  if (state.clubDrillCup) {
    renderClubCupDetail(resultHost, state.clubDrillCup, query);
    return;
  }

  const cupIds = trendCupOptions();
  const { pending, rows, loadedCount, totalCount } = computeClubRows(cupIds, query);
  if (pending) {
    resultHost.append(archiveProgressBlock(loadedCount, totalCount));
  }
  if (!rows.length) {
    // Under pågående hämtning betyder en tom lista bara "inga träffar
    // ännu". Slutligt tomresultat visas först när alla relevanta år är
    // kontrollerade, annars blinkar ett felaktigt nollresultat förbi.
    if (pending) return;
    resultHost.append(h("p", { class: "muted" },
      'Inga arkiverade matcher matchar "' + query + '" i någon cup.'));
    return;
  }

  const totalCups = rows.length;
  const totalTeams = rows.reduce((s, r) => s + r.totalTeams, 0);
  const totalMatches = rows.reduce((s, r) => s + r.totalMatches, 0);
  const allClasses = new Set(rows.flatMap((r) => [...r.classes]));
  const allYears = rows.flatMap((r) => r.years).sort();
  resultHost.append(h("p", { class: "muted" },
    (pending ? "Hittills: " : "") +
    totalCups + " cup" + (totalCups === 1 ? "" : "er") + " · " + totalTeams + " lag totalt · " +
    totalMatches + " matcher · " + allClasses.size + " klasser · " +
    allYears[0] + "–" + allYears[allYears.length - 1]));
  if (!pending) {
    resultHost.append(h("div", { class: "row" },
      h("label", { class: "inline-toggle" },
        h("input", {
          type: "checkbox", ...(state.clubShowGaps ? { checked: "" } : {}),
          onchange: (e) => { state.clubShowGaps = e.target.checked; renderContent(); },
        }),
        " Markera missade år")));
  }

  const columns = [
    { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
    { key: "years", label: "År", align: "l", defaultDir: -1,
      get: (r) => r.years[r.years.length - 1] || "",
      render: (r) => state.clubShowGaps && !pending
        ? renderYearsWithGaps(r.cupId, r.years) : r.years.join(", ") },
    { key: "teams", label: "Lag totalt", defaultDir: -1, get: (r) => r.totalTeams,
      render: (r) => renderClubMetric(r.totalTeams, r.yearStats, "teams") },
    { key: "matches", label: "Matcher totalt", defaultDir: -1, get: (r) => r.totalMatches,
      render: (r) => renderClubMetric(r.totalMatches, r.yearStats, "matches") },
    { key: "classes", label: "Klasser totalt", defaultDir: -1, get: (r) => r.totalClasses,
      render: (r) => renderClubMetric(r.totalClasses, r.yearStats, "classes") },
  ];
  // Klickbar rad (se sortableTable) — går ner en nivå till cupens egna
  // klasser (renderClubCupDetail) i stället för att bara visa aggregatet.
  resultHost.append(sortableTable(columns, rows, clubTableSort,
    (r) => [...r.classes].sort((a, b) => catSortKey(a) - catSortKey(b)).join(", "),
    (r) => { state.clubDrillCup = r.cupId; renderContent(); }));
}

// Klubb/Lag, nedborrningsnivå 1: en vald cups klasser för sökningen —
// klickar man en klass går man vidare till renderClubClassDetail.
function renderClubCupDetail(root, cupId, query) {
  const cupObj = HB.allCups().find((c) => c.id === cupId);
  const cupName = (cupObj && cupObj.name) || cupId;
  root.append(h("div", { class: "row" },
    h("button", {
      class: "chip back-chip", type: "button",
      onclick: () => { state.clubDrillCup = null; renderContent(); },
    }, "← Tillbaka till alla cuper")));

  // Samma lagnamnsindex-genväg som computeClubRows — bara de upplagor som
  // faktiskt kan innehålla söktermen behöver hämtas här heller (indexet
  // är i praktiken redan laddat vid det här laget, eftersom man alltid
  // kommer hit via en sökning i toppnivåtabellen — men den saknade
  // guarden om det inte skulle vara fallet).
  const editionsMeta = clubEditionsFor(cupId);
  const relevantEditions = state.teamIndex
    ? editionsMeta.filter((em) => editionMightMatch(cupId, em.edition, query))
    : editionsMeta;
  for (const em of relevantEditions) ensureYearMatches(em.edition, cupId);
  const loadedCount = relevantEditions.filter((em) => {
    const ym = state.yearMatches[cupId + ":" + em.edition];
    return ym && ym.status !== "loading";
  }).length;
  const pending = loadedCount < relevantEditions.length;
  root.append(h("h2", { class: "day-h" }, cupName));
  if (pending) {
    root.append(archiveProgressBlock(loadedCount, relevantEditions.length));
  }

  const detail = computeClubCupDetail(cupId, query);
  if (!detail.classes.length) {
    if (pending) return;
    root.append(h("p", { class: "muted" },
      'Inga matcher matchar "' + query + '" i ' + cupName + '.'));
    return;
  }
  root.append(h("p", { class: "muted" },
    (pending ? "Hittills: " : "") + detail.totalTeams + " lag · " + detail.totalMatches + " matcher · " +
    detail.totalDays + " speldagar · " + detail.classes.length + " klasser"));

  const columns = [
    { key: "className", label: "Klass", align: "l", defaultDir: 1, get: (r) => r.className },
    { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.teamCount },
    { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.matchCount },
  ];
  root.append(sortableTable(columns, detail.classes, clubClassTableSort, null,
    (r) => { state.clubDrillClass = r.className; renderContent(); }));
}

// Klubb/Lag, nedborrningsnivå 2: en vald cup+klass — de faktiska lagen
// (ett per upplaga, se computeClubClassGroups) med sina riktiga matcher,
// återanvänder matchCard rakt av (samma kort som Schema-vyn). Tabell-
// placering/tidigare möten i matchdialogen (öppnas via matchCard) kan
// sakna data för matcher från ANDRA cuper än den just nu aktiva —
// de hämtas via cup()/state.cupId, inte cupId här — men det är en
// känd, ofarlig begränsning (samma sak gäller redan idag för arkiverade
// år i den vanliga Schema-vyn): dialogen visar bara "ingen tabell
// tillgänglig" i stället för fel data.
function renderClubClassDetail(root, cupId, className, query) {
  const cupObj = HB.allCups().find((c) => c.id === cupId);
  const cupName = (cupObj && cupObj.name) || cupId;
  root.append(h("div", { class: "row" },
    h("button", {
      class: "chip back-chip", type: "button",
      onclick: () => { state.clubDrillClass = null; renderContent(); },
    }, "← Tillbaka till " + cupName)));
  root.append(h("h2", { class: "day-h" }, cupName + " · " + className));

  // Samma lata hämtning + förloppsindikator som nivån ovanför (renderClub-
  // CupDetail). Behövs eftersom man kan landa RAKT här via en djuplänk
  // (?clubCup=…&clubClass=…) utan att ha passerat nivå 0/1, som annars
  // hunnit fylla state.yearMatches — computeClubClassGroups hoppar tyst
  // över upplagor som inte är hämtade och hade gett "Inga matcher hittades".
  const editionsMeta = clubEditionsFor(cupId);
  const relevantEditions = state.teamIndex
    ? editionsMeta.filter((em) => editionMightMatch(cupId, em.edition, query))
    : editionsMeta;
  for (const em of relevantEditions) ensureYearMatches(em.edition, cupId);
  const loadedCount = relevantEditions.filter((em) => {
    const ym = state.yearMatches[cupId + ":" + em.edition];
    return ym && ym.status !== "loading";
  }).length;
  const pending = loadedCount < relevantEditions.length;
  if (pending) {
    root.append(archiveProgressBlock(loadedCount, relevantEditions.length));
  }

  const groups = computeClubClassGroups(cupId, className, query);
  if (!groups.length) {
    if (pending) return;
    root.append(h("p", { class: "muted" }, "Inga matcher hittades."));
    return;
  }
  for (const g of groups) {
    let w = 0, d = 0, l = 0;
    for (const m of g.matches) {
      const o = clubOutcomeLetter(m, g.teamId);
      if (o === "V") w++; else if (o === "O") d++; else if (o === "F") l++;
    }
    root.append(h("h3", { class: "day-h" }, g.teamName + " (" + g.edition + ")"));
    root.append(h("p", { class: "muted" },
      g.matches.length + " matcher · " + w + " V, " + d + " O, " + l + " F"));
    root.append(h("div", { class: "slot-matches" },
      g.matches.slice().sort((a, b) => b.start - a.start).map((m) => matchCard(m))));
  }
}

// Klubbjämförelse-fliken (under Stats): samma computeClubRows som Klubb/
// Lag använder (en söktermsrad -> aggregat per cup), men i stället för
// att borra ner i EN klubb visas flera klubbars/lags aggregat sida vid
// sida i en tabell. Klubbar läggs till en i taget via en sökruta med
// autocomplete (attachAutocomplete, minLen 2) — man skriver 2-3 bokstäver,
// klickar rätt klubb i förslagslistan (eller trycker Enter för ett namn
// som inte finns i förslagen), den hamnar som en chip i state.compareNames,
// och sökrutan töms/får fokus igen så man kan söka nästa direkt. Max 8 —
// fler skulle bara bli en orimligt bred/tung tabell (varje tillägg kräver
// ensureYearMatches över alla cuper).
let clubCompareTableSort = { key: "name", dir: 1 };
const CLUB_COMPARE_MAX = 8;

// Förslagskällan är klubbkatalogen (data/club-directory.json) — samma
// katalog Karta använder för att gissa ProCup/Gothia-adresser — eftersom
// den redan är ett städat register över klubbnamn (utan lagsuffix som
// "Blå"/"Vit") tvärs över alla klassiska Cup Manager-cuper, och redan
// cachas av HB.api.fetchClubDirectory(). Ett namn som inte finns med där
// (t.ex. en klubb som bara spelat i Partille/ProCup) går ändå att lägga
// till manuellt via Enter — katalogen är bara ett hjälpmedel, inget krav.
let compareCandidates = null;
function ensureCompareCandidates() {
  if (compareCandidates) return;
  compareCandidates = [];
  // INGEN renderContent() här när katalogen blir klar — attachAutocomplete
  // läser getCandidates() på nytt vid varje tangenttryckning (ren closure,
  // ingen snapshot), så nästa input-event ser automatiskt de färska
  // kandidaterna. En omritning här skulle i stället kunna riva upp och
  // ersätta sökrutan MITT I att någon skriver (katalogen hinner ofta bli
  // klar under de första tangenttryckningarna), vilket tömmer det man just
  // skrivit — värre än att förslagslistan helt enkelt är tom en bråkdel
  // av en sekund vid allra första besöket.
  HB.api.fetchClubDirectory().then((dir) => {
    compareCandidates = Object.keys(dir || {}).sort((a, b) => a.localeCompare(b, "sv"));
  });
}

function renderClubCompareView(root) {
  ensureCompareCandidates();
  const atMax = state.compareNames.length >= CLUB_COMPARE_MAX;
  const input = h("input", {
    class: "search compare-search", type: "text",
    placeholder: atMax ? "Max " + CLUB_COMPARE_MAX + " nådd" : "Sök klubb/lag …",
    disabled: atMax ? "" : null,
  });
  const options = h("div", { class: "autocomplete-list" });
  options.hidden = true;
  const addName = (raw) => {
    const name = raw.trim();
    if (!name || state.compareNames.length >= CLUB_COMPARE_MAX) return;
    if (!state.compareNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      state.compareNames = [...state.compareNames, name];
    }
    renderContent();
    // Fokus tillbaka i sökrutan (den byggs om av renderContent() ovan) så
    // man kan söka nästa klubb/lag direkt utan att klicka i fältet igen.
    requestAnimationFrame(() => { const el = $(".compare-search"); if (el) el.focus(); });
  };
  attachAutocomplete(input, options, () => compareCandidates || [], addName, 2);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addName(input.value); }
  });
  const yearOptions = clubYearOptions();
  const yearPicker = yearOptions.length > 1 ? buildPicker({
    items: yearOptions.map((year) => ({ id: year, label: year, sortKey: 0, sortName: year })),
    selected: state.compareYears,
    emptyLabel: "Alla år",
    countLabel: (count) => count === 1 ? "1 år" : count + " år",
    searchPlaceholder: "Sök år …",
    sortToggle: false,
    soloClickable: true,
    onChange: () => { state.compareExpanded = new Set(); renderContent(); },
  }) : null;
  root.append(h("div", { class: "history-controls" },
    h("div", { class: "autocomplete-wrap compare-search-wrap" }, input, options),
    yearPicker));

  if (state.compareNames.length) {
    root.append(h("div", { class: "compare-chip-row" },
      state.compareNames.map((name) => h("span", { class: "compare-chip" },
        name,
        h("button", {
          class: "compare-chip-x", type: "button", "aria-label": "Ta bort " + name,
          onclick: () => {
            state.compareNames = state.compareNames.filter((n) => n !== name);
            renderContent();
          },
        }, "×")))));
  }

  const resultHost = h("div", { class: "trend-chart-host" });
  root.append(resultHost);
  if (!state.compareNames.length) {
    resultHost.append(h("p", { class: "muted" },
      "Sök och lägg till minst en klubb/lag ovan för att jämföra deras historik över alla cuper."));
    return;
  }

  const cupIds = trendCupOptions();
  let pending = false;
  let loadedCount = 0, totalCount = 0;
  const rows = state.compareNames.map((name) => {
    const res = computeClubRows(cupIds, name, state.compareYears);
    if (res.pending) pending = true;
    loadedCount += res.loadedCount; totalCount += res.totalCount;
    const years = res.rows.flatMap((r) => r.years).sort();
    return {
      name,
      cups: res.rows.length,
      teams: res.rows.reduce((s, r) => s + r.totalTeams, 0),
      matches: res.rows.reduce((s, r) => s + r.totalMatches, 0),
      classes: new Set(res.rows.flatMap((r) => [...r.classes])).size,
      latestYear: years[years.length - 1] || "",
      yearsSpan: years.length ? (years[0] === years[years.length - 1]
        ? years[0] : years[0] + "–" + years[years.length - 1]) : "–",
      detailRows: res.rows,
    };
  });
  if (pending) {
    resultHost.append(archiveProgressBlock(loadedCount, totalCount));
    return;
  }

  // Namnkolumnen får en ▾/▸-pil (i stället för en egen kolumn) som enda
  // visuella ledtråd om att raden går att fälla ut — sortableTable saknar
  // en egen per-rad-styling-krok, se dess kommentar.
  const columns = [
    { key: "name", label: "Klubb/lag", align: "l", defaultDir: 1,
      get: (r) => r.name,
      render: (r) => (state.compareExpanded.has(r.name) ? "▾ " : "▸ ") + r.name },
    { key: "cups", label: "Cuper", defaultDir: -1, get: (r) => r.cups },
    { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.teams },
    { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.matches },
    { key: "classes", label: "Klasser", defaultDir: -1, get: (r) => r.classes },
    { key: "yearsSpan", label: "År", align: "l", defaultDir: -1,
      get: (r) => r.latestYear, render: (r) => r.yearsSpan },
  ];
  resultHost.append(sortableTable(columns, rows, clubCompareTableSort, null, (r) => {
    if (state.compareExpanded.has(r.name)) state.compareExpanded.delete(r.name);
    else state.compareExpanded.add(r.name);
    renderContent();
  }));

  for (const row of rows) {
    if (state.compareExpanded.has(row.name)) resultHost.append(clubCompareDetailBlock(row));
  }
}

// Klubbjämförelsens radexpansion (klicka en rad, se onRowClick ovan) —
// en cup-för-cup-nedbrytning av VILKA klasser och, viktigast, VILKA rå
// lagnamn som faktiskt matchade söktermen. Tänkt som en snabb egenkontroll
// när man undrar om två snarlika sökningar (t.ex. en stavning med/utan
// "s") råkar råka in på samma klubb i praktiken eller inte.
function clubCompareDetailBlock(row) {
  return h("div", { class: "table-box compare-detail" },
    h("h3", { class: "compare-detail-name" }, row.name),
    row.detailRows.map((r) => h("div", { class: "compare-detail-cup" },
      h("div", { class: "compare-detail-cup-head" },
        h("strong", null, r.cupName), h("span", { class: "muted" }, r.years.join(", "))),
      h("p", { class: "muted" },
        "Klasser: " + [...r.classes].sort((a, b) => catSortKey(a) - catSortKey(b))
          .map((c) => HB.shortCat(c)).join(", ")),
      h("p", { class: "muted" }, "Lagnamn: " + [...r.names].sort((a, b) => a.localeCompare(b, "sv")).join(", ")))));
}

// Cuper-fliken (under Stats): en översiktsrad per cup, byggd helt ur
// state.archiveIndex (redan hämtat via fetchArchiveIndex() i init(),
// se dess kommentar) — INGEN ensureYearMatches krävs, index.json:s
// per-upplaga-nyckeltal (matches/teams/classes/clubs/countries/days) räcker. Klick
// på en rad borrar ner i den cupens egna år-för-år-historik.
let cupsOverviewSort = { key: "cupName", dir: 1 };
let cupsOverviewDetailSort = { key: "edition", dir: -1 };
const cupsOverviewExpandedYears = new Set();
const cupsOverviewEditionDetailCache = new Map();

function cupEditionDetailSummary(matches) {
  const classes = new Map(), clubs = new Map(), countries = new Map();
  const add = (map, key, team, matchId, club) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { teams: new Set(), matches: new Set(), clubs: new Set() });
    const entry = map.get(key);
    if (team && team.id != null) entry.teams.add(team.id);
    if (matchId != null) entry.matches.add(matchId);
    if (club) entry.clubs.add(club);
  };
  for (const m of matches || []) {
    const realSides = [m.home, m.away].filter((side) => side && !isPlaceholderTeam(side));
    for (const side of realSides) {
      add(classes, m.catName || "Okänd klass", side, m.id, side.club);
      add(clubs, side.club || side.name, side, m.id, side.club || side.name);
      add(countries, side.country || "", side, m.id, side.club || side.name);
    }
  }
  const rows = (map, labelFn = (x) => x) => [...map.entries()].map(([name, v]) => ({
    name: labelFn(name), teams: v.teams.size, matches: v.matches.size, clubs: v.clubs.size,
  })).sort((a, b) => a.name.localeCompare(b.name, "sv", { numeric: true }));
  return { classes: rows(classes), clubs: rows(clubs),
    countries: rows(countries, countryDisplayName) };
}

function loadCupEditionDetail(cupId, edition) {
  const key = cupId + "|" + edition;
  const cached = cupsOverviewEditionDetailCache.get(key);
  if (cached) return;
  cupsOverviewEditionDetailCache.set(key, { status: "loading" });
  HB.api.fetchArchiveEdition(cupId, edition).then((data) => {
    if (!data) throw new Error("Ingen arkivdata");
    cupsOverviewEditionDetailCache.set(key, {
      status: "done", summary: cupEditionDetailSummary(data.matches || []),
    });
    if (state.statsCupDrill === cupId && cupsOverviewExpandedYears.has(key)) renderContent();
  }).catch(() => {
    cupsOverviewEditionDetailCache.set(key, { status: "error" });
    if (state.statsCupDrill === cupId && cupsOverviewExpandedYears.has(key)) renderContent();
  });
}

function cupEditionExpandedBlock(cupId, edition) {
  const key = cupId + "|" + edition;
  if (!cupsOverviewExpandedYears.has(key)) return null;
  const cached = cupsOverviewEditionDetailCache.get(key);
  if (!cached || cached.status === "loading") {
    return h("div", { class: "cup-edition-expanded muted" }, "Hämtar klasser, länder och klubbar …");
  }
  if (cached.status === "error") {
    return h("div", { class: "cup-edition-expanded muted" }, "Kunde inte hämta årsinformationen.");
  }
  const s = cached.summary;
  const list = (rows, kind) => h("ul", { class: "cup-edition-detail-list " + kind },
    rows.map((r) => h("li", null,
      h("strong", null, r.name),
      h("span", { class: "muted" }, kind === "countries"
        ? r.teams + " lag · " + r.clubs + " klubbar"
        : kind === "classes"
          ? r.teams + " lag · " + r.matches + " matcher"
          : r.teams + " lag"))));
  const groups = [
    { label: "Klasser", rows: s.classes, kind: "classes" },
    { label: "Länder", rows: s.countries, kind: "countries" },
    { label: "Klubbar", rows: s.clubs, kind: "clubs" },
  ];
  let activeKind = "classes";
  const visibleByKind = { classes: 10, countries: 10, clubs: 10 };
  const tabs = h("nav", { class: "cup-edition-detail-tabs", role: "tablist",
    "aria-label": "Detaljer för " + edition });
  const body = h("div", { class: "cup-edition-detail-body" });
  const paint = () => {
    const active = groups.find((g) => g.kind === activeKind);
    tabs.replaceChildren(...groups.map((g) => h("button", {
      class: "cup-edition-detail-tab" + (g.kind === activeKind ? " on" : ""),
      type: "button", role: "tab", "aria-selected": String(g.kind === activeKind),
      onclick: () => { activeKind = g.kind; paint(); },
    }, g.label, h("small", null, String(g.rows.length)))));
    const rows = active.rows;
    const kind = active.kind;
    const visible = Math.min(visibleByKind[kind], rows.length);
    if (!rows.length) {
      body.replaceChildren(h("p", { class: "muted" },
        "Uppgift saknas för den här upplagan."));
      return;
    }
    const shown = rows.slice(0, visible);
    const remaining = rows.length - visible;
    const more = remaining > 0 ? h("button", {
      class: "cup-edition-show-more", type: "button",
      onclick: (event) => {
        event.stopPropagation();
        visibleByKind[kind] = Math.min(rows.length, visible + 10);
        paint();
      },
    }, "Visa " + Math.min(10, remaining) + " till") : null;
    body.replaceChildren(list(shown, kind), ...(more ? [more] : []));
  };
  paint();
  return h("div", { class: "cup-edition-expanded" }, tabs, body);
}

function statsCupOverviewRows() {
  const idx = state.archiveIndex || {};
  return trendCupOptions().map((cupId) => {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const editions = ((idx[cupId] && idx[cupId].editions) || [])
      .filter((e) => e.matches > 0).slice().sort((a, b) => b.edition.localeCompare(a.edition));
    const latest = editions[0];
    return {
      cupId, cupName: (cupObj && cupObj.name) || (idx[cupId] && idx[cupId].cupName) || cupId,
      sport: (cupObj && cupObj.sport) || "handboll",
      years: editions.length, latestEdition: latest.edition,
      latestTeams: latest.teams || 0,
      latestMatches: archiveEditionMetric(latest, "matches"),
      latestMatchLabel: archiveEditionMatchLabel(latest),
      latestPreliminary: !!latest.preliminary,
      latestDate: latest.first || "",
      latestDateLabel: archiveEditionDateLabel(latest),
      latestClasses: latest.classes || 0, latestClubs: latest.clubs || 0,
      latestCountries: latest.countries == null ? null : latest.countries,
      editions,
    };
  });
}

function renderCupsOverviewView(root) {
  if (state.statsCupDrill) { renderCupsOverviewDetail(root, state.statsCupDrill); return; }
  const rows = statsCupOverviewRows();
  if (!rows.length) {
    root.append(h("p", { class: "muted" }, "Ingen cup har ännu någon arkiverad historik."));
    return;
  }
  root.append(h("p", { class: "muted" },
    rows.length + " cuper · senaste upplagans nyckeltal — klicka en rad för år-för-år."));
  const columns = [
    { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
    { key: "sport", label: "Sport", align: "l", defaultDir: 1, get: (r) => SPORT_LABELS[r.sport] || r.sport },
    { key: "years", label: "År", defaultDir: -1, get: (r) => r.years },
    { key: "latestEdition", label: "Senaste", align: "l", defaultDir: -1, get: (r) => r.latestEdition },
    { key: "latestDate", label: "Datum", align: "l", defaultDir: -1,
      get: (r) => r.latestDate, render: (r) => r.latestDateLabel },
    { key: "latestTeams", label: "Lag i matcher", defaultDir: -1, get: (r) => r.latestTeams },
    { key: "latestMatches", label: "Matcher", defaultDir: -1,
      get: (r) => r.latestMatches,
      render: (r) => r.latestPreliminary ? r.latestMatchLabel : String(r.latestMatches) },
    { key: "latestClasses", label: "Klasser", defaultDir: -1, get: (r) => r.latestClasses },
    { key: "latestClubs", label: "Klubbar", defaultDir: -1, get: (r) => r.latestClubs },
    { key: "latestCountries", label: "Länder", defaultDir: -1,
      get: (r) => r.latestCountries == null ? -1 : r.latestCountries,
      render: (r) => r.latestCountries == null ? "–" : String(r.latestCountries) },
  ];
  root.append(sortableTable(columns, rows, cupsOverviewSort, null,
    (r) => { state.statsCupDrill = r.cupId; renderContent(); }));
}

function renderCupsOverviewDetail(root, cupId) {
  const cupObj = HB.allCups().find((c) => c.id === cupId);
  const idx = state.archiveIndex || {};
  const cupName = (cupObj && cupObj.name) || (idx[cupId] && idx[cupId].cupName) || cupId;
  root.append(h("div", { class: "row" },
    h("button", {
      class: "chip back-chip", type: "button",
      onclick: () => { state.statsCupDrill = null; renderContent(); },
    }, "← Tillbaka till alla cuper")));
  root.append(h("h2", { class: "day-h" }, cupName));
  root.append(h("p", { class: "muted" },
    "Klicka på ett år för att visa upplagans klasser, länder och klubbar."));
  const editions = ((idx[cupId] && idx[cupId].editions) || []).filter((e) => e.matches > 0);
  if (!editions.length) {
    root.append(h("p", { class: "muted" }, "Ingen arkiverad historik hittades."));
    return;
  }
  const columns = [
    { key: "edition", label: "År", align: "l", defaultDir: -1, get: (r) => r.edition,
      render: (r) => (cupsOverviewExpandedYears.has(cupId + "|" + r.edition) ? "▾ " : "▸ ") + r.edition },
    { key: "date", label: "Datum", align: "l", defaultDir: -1,
      get: (r) => r.first || "", render: (r) => archiveEditionDateLabel(r) },
    { key: "teams", label: "Lag i matcher", defaultDir: -1, get: (r) => r.teams || 0 },
    { key: "matches", label: "Matcher", defaultDir: -1,
      get: (r) => archiveEditionMetric(r, "matches"),
      render: (r) => archiveEditionMatchLabel(r) },
    { key: "classes", label: "Klasser", defaultDir: -1, get: (r) => r.classes || 0 },
    // clubs = 0 betyder "uppgift saknas", inte "noll klubbar": det rena
    // klubbnamnsfältet tillkom i skraporna 2026-07-24, och år som
    // arkiverades dessförinnan (och ännu inte backfillats) har det inte
    // alls. Visa "–" som Länder redan gör — en nolla läses som att cupen
    // saknade klubbar, vilket den förstås inte gjorde. Trend-fliken gömmer
    // hela kolumnen i samma läge (se renderTrendChartBlock).
    { key: "clubs", label: "Klubbar", defaultDir: -1,
      get: (r) => r.clubs || -1,
      render: (r) => r.clubs ? String(r.clubs) : "–" },
    { key: "countries", label: "Länder", defaultDir: -1,
      get: (r) => r.countries == null ? -1 : r.countries,
      render: (r) => r.countries == null ? "–" : String(r.countries) },
    { key: "days", label: "Speldagar", defaultDir: -1, get: (r) => r.days || 0 },
  ];
  root.append(sortableTable(columns, editions, cupsOverviewDetailSort, null, (r) => {
    const key = cupId + "|" + r.edition;
    if (cupsOverviewExpandedYears.has(key)) cupsOverviewExpandedYears.delete(key);
    else {
      cupsOverviewExpandedYears.add(key);
      loadCupEditionDetail(cupId, r.edition);
    }
    renderContent();
  }, (r) => cupEditionExpandedBlock(cupId, r.edition)));
}

// Stats: samlar Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper under EN
// toppnivåflik (index.html #viewTabs, state.view === "stats") i stället
// för fem separata — alla fem svarar på samma sorts "tvärs över cuper/år"-
// frågor, bara med olika linser, så en gemensam underflikrad (samma
// [key,label,renderFn]-mönster som HISTORY_TABS ovan, se renderBrowseMode)
// håller ihop dem utan att trycka undan Schema/Tabeller/Slutspel/Bana ur
// huvudnavigeringen.
// --- Vinnare (Stats-underflik): troféskåp, årets mästare, vinnartoppen ----
// Läser data/champions.json (byggd av scripts/archive_results.py) — en rad
// per A-slutspelsfinal över alla arkiverade cup-upplagor. Lägena/valen hålls
// på modulnivå (som historyMode) så de överlever växling till en annan
// Stats-underflik och tillbaka, men nollställs vid full sidladdning.
let vinnareMode = "trofe";     // trofe | ar | topp
let championsData = null;      // rows[] eller null tills laddat
let championsLoading = false;
let vinnareQuery = null;       // sökterm (troféskåp); null = default favoritklubb
let vinnareMedals = { guld: true, silver: false, brons: false }; // vilka medaljer troféskåpet visar
let vinnareCup = null;         // vald cup (årets mästare)
let vinnareYear = null;        // valt år (årets mästare)
let vinnareToppCup = "";       // cupfilter (vinnartoppen); "" = alla cuper
let vinnareToppMedals = { guld: true, silver: false, brons: false }; // medaljer som räknas i topplistan

// Tillhör lagnamnet/klubben favoritklubben? gc/sc/bc är redan normaliserade
// klubbnamn (se normalize_club i archive_results.py); favoritklubben jämförs
// både exakt och som lagnamnsprefix ("Alingsås HK" ⊂ "Alingsås HK Vit").
function vinnareIsFav(clubCode, teamName) {
  const fav = (state.favoriteClub || "").trim().toLowerCase();
  if (!fav) return false;
  return (clubCode || "").toLowerCase() === fav ||
    (teamName || "").toLowerCase().startsWith(fav);
}

function renderVinnareView(root) {
  if (championsData === null) {
    root.append(h("p", { class: "muted" }, "Hämtar mästare …"));
    if (!championsLoading) {
      championsLoading = true;
      HB.api.fetchChampions()
        .then((d) => { championsData = (d && d.rows) || []; renderContent(); })
        .catch(() => { championsData = []; renderContent(); });
    }
    return;
  }
  const rows = championsData;
  if (!rows.length) {
    root.append(h("p", { class: "muted" },
      "Inga mästare arkiverade än — fylls på automatiskt allteftersom slutspel avgörs."));
    return;
  }
  root.append(h("div", { class: "row" },
    h("div", { class: "seg", role: "group", "aria-label": "Vinnarläge" },
      chip("Troféskåp", vinnareMode === "trofe", () => { vinnareMode = "trofe"; renderContent(); }),
      chip("Årets mästare", vinnareMode === "ar", () => { vinnareMode = "ar"; renderContent(); }),
      chip("Vinnartoppen", vinnareMode === "topp", () => { vinnareMode = "topp"; renderContent(); }))));
  const body = h("div", { class: "vinnare-body" });
  root.append(body);
  if (vinnareMode === "trofe") renderTrofeskap(body, rows);
  else if (vinnareMode === "ar") renderAretsMastare(body, rows);
  else renderVinnartoppen(body, rows);
}

function renderTrofeskap(root, rows) {
  const clubs = [...new Set(rows.map((r) => r.gc).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "sv"));
  if (vinnareQuery === null) vinnareQuery = state.favoriteClub || (clubs[0] || "");
  const listId = "vinnare-club-list";
  const dl = h("datalist", { id: listId }, clubs.map((c) => h("option", { value: c })));
  const input = h("input", {
    type: "text", class: "vinnare-club-input", list: listId, autocomplete: "off",
    placeholder: "Sök klubb, t.ex. Lugi …", value: vinnareQuery, "aria-label": "Klubb",
  });
  const apply = () => { if (input.value !== vinnareQuery) { vinnareQuery = input.value; renderContent(); } };
  input.addEventListener("change", apply);
  root.append(h("div", { class: "row vinnare-controls" },
    h("span", { class: "muted" }, "Klubb:"),
    h("div", { class: "autocomplete-wrap" }, input, dl)));

  // Fri delsträngssökning som tar med ALLA namnvarianter — "lugi" matchar
  // Lugi HF, Lugi HF 2, Lugi … (både klubbnyckeln gc och det råa lagnamnet g).
  const q = (vinnareQuery || "").trim().toLowerCase();
  const matchC = (club, name) => !!q && (((club || "").toLowerCase().includes(q)) || ((name || "").toLowerCase().includes(q)));
  // Klubbens medaljer: guld = vann finalen, silver = förlorade finalen,
  // brons = förlorade semifinalen (eller vann bronsmatchen). Se champions.json.
  const golds = q ? rows.filter((r) => matchC(r.gc, r.g)).map((r) => ({ r, medal: "guld", team: r.g, club: r.gc })) : [];
  const silvers = q ? rows.filter((r) => matchC(r.sc, r.s)).map((r) => ({ r, medal: "silver", team: r.s, club: r.sc })) : [];
  const bronzes = [];
  if (q) rows.forEach((r) => (r.bc || []).forEach((bc, i) => {
    const nm = (r.b || [])[i];
    if (matchC(bc, nm)) bronzes.push({ r, medal: "brons", team: nm, club: bc });
  }));
  const total = golds.length + silvers.length + bronzes.length;

  // Toggla vilka medaljer som visas (guld på från start = klassiskt troféskåp).
  if (q) {
    root.append(h("div", { class: "row vinnare-controls" },
      h("div", { class: "seg", role: "group", "aria-label": "Medaljer" },
        chip("🥇 Guld (" + golds.length + ")", vinnareMedals.guld, () => { vinnareMedals.guld = !vinnareMedals.guld; renderContent(); }),
        chip("🥈 Silver (" + silvers.length + ")", vinnareMedals.silver, () => { vinnareMedals.silver = !vinnareMedals.silver; renderContent(); }),
        chip("🥉 Brons (" + bronzes.length + ")", vinnareMedals.brons, () => { vinnareMedals.brons = !vinnareMedals.brons; renderContent(); }))));
  }

  const shown = [].concat(
    vinnareMedals.guld ? golds : [], vinnareMedals.silver ? silvers : [], vinnareMedals.brons ? bronzes : [])
    .sort((a, b) => b.r.ed.localeCompare(a.r.ed) || a.r.cupName.localeCompare(b.r.cupName, "sv"));
  const distinct = [...new Set([...golds, ...silvers, ...bronzes].map((x) => x.club).filter(Boolean))];
  const active = ["guld", "silver", "brons"].filter((t) => vinnareMedals[t]);
  const numLabel = active.length === 1
    ? (active[0] === "guld" ? (shown.length === 1 ? "titel" : "titlar") : active[0])
    : "medaljer";
  const heading = !q ? "Troféskåp"
    : distinct.length === 1 ? distinct[0] + "s troféskåp"
    : "Medaljer för “" + vinnareQuery.trim() + "”";
  const lead = !q ? "Skriv en klubb ovan för att se dess medaljer."
    : !total ? "Inga medaljer som matchar “" + vinnareQuery.trim() + "”."
    : "🥇 " + golds.length + "   🥈 " + silvers.length + "   🥉 " + bronzes.length +
      (distinct.length > 1 ? " · " + distinct.length + " lagnamn" : "") + " · klicka ett kort för slutspelsträdet.";
  root.append(h("div", { class: "trophy-hero" },
    h("div", { class: "trophy-num" },
      h("div", { class: "trophy-big" }, String(shown.length)),
      h("div", { class: "trophy-lbl" }, numLabel)),
    h("div", { class: "trophy-lead" },
      h("h3", null, heading),
      h("p", { class: "muted" }, lead))));
  if (!q) return;
  if (!shown.length) { root.append(h("p", { class: "muted" }, total ? "Välj minst en medaljtyp ovan." : "")); return; }
  const medalEmoji = { guld: "🥇", silver: "🥈", brons: "🥉" };
  root.append(h("div", { class: "tro-grid" },
    shown.map((x) => h("div", {
      class: "tro tro-click tro-" + x.medal, role: "button", tabindex: "0",
      title: "Öppna slutspelsträdet — " + x.r.cat + " (" + x.r.cupName + " " + x.r.ed + ")",
      onclick: () => gotoBrowseSlutspel(x.r.cup, x.r.ed, x.r.cat),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gotoBrowseSlutspel(x.r.cup, x.r.ed, x.r.cat); } },
    },
      h("span", { class: "tro-medal" }, medalEmoji[x.medal]),
      h("div", { class: "tro-yr" }, x.r.ed),
      h("div", { class: "tro-cup" }, x.r.cupName),
      h("div", { class: "tro-cls" }, x.r.cat),
      h("div", { class: "tro-team" }, x.team),
      h("span", { class: "tro-go" }, "Visa slutspel →")))));
}

function renderAretsMastare(root, rows) {
  const cups = [...new Map(rows.map((r) => [r.cup, r.cupName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "sv"));
  if (vinnareCup === null || !cups.some((c) => c[0] === vinnareCup)) {
    vinnareCup = cups.some((c) => c[0] === state.cupId) ? state.cupId : (cups[0] && cups[0][0]);
  }
  const years = [...new Set(rows.filter((r) => r.cup === vinnareCup).map((r) => r.ed))]
    .sort((a, b) => b.localeCompare(a));
  if (vinnareYear === null || !years.includes(vinnareYear)) vinnareYear = years[0];
  const cupSel = h("select", { class: "select", "aria-label": "Cup" },
    cups.map(([id, name]) => h("option", { value: id, ...(id === vinnareCup ? { selected: "" } : {}) }, name)));
  cupSel.addEventListener("change", () => { vinnareCup = cupSel.value; vinnareYear = null; renderContent(); });
  const yearSel = h("select", { class: "select", "aria-label": "År" },
    years.map((y) => h("option", { value: y, ...(y === vinnareYear ? { selected: "" } : {}) }, y)));
  yearSel.addEventListener("change", () => { vinnareYear = yearSel.value; renderContent(); });
  root.append(h("div", { class: "row vinnare-controls" }, cupSel, yearSel));

  const champs = rows.filter((r) => r.cup === vinnareCup && r.ed === vinnareYear)
    .sort((a, b) => a.cat.localeCompare(b.cat, "sv"));
  if (!champs.length) {
    root.append(h("p", { class: "muted" }, "Inga avgjorda A-slutspel för den upplagan."));
    return;
  }
  const rankRow = (medal, team, club) => team ? h("div", { class: "rank" },
    h("span", { class: "medal-badge" }, medal),
    h("span", { class: "rank-team" + (vinnareIsFav(club, team) ? " us" : "") }, team)) : null;
  const hasSharedBronze = champs.some((c) => (c.b || []).length > 1);
  root.append(h("div", { class: "champ-grid" },
    champs.map((c) => {
      const brons = c.b || [];
      const sharedBronze = brons.length > 1;
      const bronsFav = (c.bc || []).some((bc) => vinnareIsFav(bc, ""));
      return h("div", { class: "champ" },
        h("div", { class: "champ-cls" }, c.cat),
        rankRow("🥇", c.g, c.gc),
        rankRow("🥈", c.s, c.sc),
        brons.length ? h("div", { class: "rank" },
          h("span", { class: "medal-badge", title: sharedBronze
            ? "Delad tredjeplats – ingen bronsmatch spelades" : "Brons" },
            "🥉" + (sharedBronze ? "*" : "")),
          h("span", { class: "rank-team" + (bronsFav ? " us" : "") }, brons.join(" · "))) : null);
    })),
    hasSharedBronze ? h("p", { class: "muted shared-bronze-note" },
      "* Delad tredjeplats – ingen bronsmatch spelades; båda semifinalförlorarna visas.") : null);
}

function renderVinnartoppen(root, rows) {
  const cups = [...new Map(rows.map((r) => [r.cup, r.cupName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "sv"));
  // Ett cupfilter som inte finns i listan (t.ex. ett ?vtcup= för en cup
  // utan arkiverade A-finaler) hade annars gett en tom topplista medan
  // väljaren påstod "Alla cuper" — samma giltighetskoll som renderArets-
  // Mastare gör för sitt cupval.
  if (vinnareToppCup && !cups.some((c) => c[0] === vinnareToppCup)) vinnareToppCup = "";
  const cupSel = h("select", { class: "select", "aria-label": "Cup" },
    h("option", { value: "", ...(vinnareToppCup === "" ? { selected: "" } : {}) }, "Alla cuper"),
    cups.map(([id, name]) => h("option", { value: id, ...(id === vinnareToppCup ? { selected: "" } : {}) }, name)));
  cupSel.addEventListener("change", () => { vinnareToppCup = cupSel.value; renderContent(); });
  root.append(h("div", { class: "row vinnare-controls" }, h("span", { class: "muted" }, "Cup:"), cupSel));

  // Samma medaljval som troféskåpet — ranka på guld, silver, brons eller totalt.
  root.append(h("div", { class: "row vinnare-controls" },
    h("div", { class: "seg", role: "group", "aria-label": "Medaljer" },
      chip("🥇 Guld", vinnareToppMedals.guld, () => { vinnareToppMedals.guld = !vinnareToppMedals.guld; renderContent(); }),
      chip("🥈 Silver", vinnareToppMedals.silver, () => { vinnareToppMedals.silver = !vinnareToppMedals.silver; renderContent(); }),
      chip("🥉 Brons", vinnareToppMedals.brons, () => { vinnareToppMedals.brons = !vinnareToppMedals.brons; renderContent(); }))));
  const active = ["guld", "silver", "brons"].filter((t) => vinnareToppMedals[t]);
  const cntLabel = active.length === 1 ? " " + active[0] : " medaljer";

  const scope = vinnareToppCup ? rows.filter((r) => r.cup === vinnareToppCup) : rows;
  const count = new Map();
  const add = (club) => { if (club) count.set(club, (count.get(club) || 0) + 1); };
  scope.forEach((r) => {
    if (vinnareToppMedals.guld) add(r.gc);
    if (vinnareToppMedals.silver) add(r.sc);
    if (vinnareToppMedals.brons) (r.bc || []).forEach(add);
  });
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sv"));
  if (!ranked.length) {
    root.append(h("p", { class: "muted" }, active.length ? "Inga mästare för den cupen ännu." : "Välj minst en medaljtyp ovan."));
    return;
  }
  // Tät rangordning (samma antal medaljer delar placering).
  let rank = 0, prev = null;
  const withRank = ranked.map(([club, n], i) => {
    if (n !== prev) { rank = i + 1; prev = n; }
    return { club, n, rank };
  });
  const fav = (state.favoriteClub || "").trim().toLowerCase();
  const board = h("div", { class: "board" });
  withRank.slice(0, 25).forEach((e) => {
    board.append(h("div", { class: "brow" + (e.rank <= 3 ? " top3" : "") + (e.club.toLowerCase() === fav ? " us" : "") },
      h("span", { class: "brow-pos" }, String(e.rank)),
      h("span", { class: "brow-club" }, e.club, e.rank === 1 ? " 🏆" : ""),
      h("span", { class: "brow-cnt" }, String(e.n), h("small", null, cntLabel))));
  });
  root.append(board);
  // Ligger favoritklubben utanför topp 25 — visa dess placering separat sist.
  const favRow = fav && withRank.find((e) => e.club.toLowerCase() === fav);
  if (favRow && favRow.rank > 25) {
    board.append(h("div", { class: "brow us brow-sep" },
      h("span", { class: "brow-pos" }, String(favRow.rank)),
      h("span", { class: "brow-club" }, favRow.club),
      h("span", { class: "brow-cnt" }, String(favRow.n), h("small", null, cntLabel))));
  }
}

// --- Kalender (Stats-underflik): Gantt över cupernas speldagar -----------
// Bygger på first/last-datumen i data/archive/index.json (se build_index i
// scripts/archive_results.py). En rad per cup-upplaga, staplad på en
// årsaxel (jan–dec) så man ser hela säsongen på en gång.
let kalenderYear = null;

// Öppnar en cup+upplaga från Kalender-fliken: live-upplagan i den vanliga
// vyn, äldre upplagor i historik-bläddraren (schema).
function gotoCupEdition(cupId, edition) {
  const live = (HB.allCups() || []).find((c) => c.id === cupId);
  if (live && String(live.edition) === String(edition)) {
    if (cupId !== state.cupId) switchCup(cupId);
    state.view = "schema"; saveUi(); render();
  } else {
    browseTarget = { cupId, edition, view: "schema", catFilter: "" };
    vinnareReturn = false; historyMode = "browse";
    state.statsView = "historik"; state.view = "stats"; saveUi(); renderContent();
  }
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function renderKalenderView(root) {
  const idx = state.archiveIndex;
  if (!idx) { root.append(h("p", { class: "muted" }, "Hämtar arkivindex …")); return; }
  const items = [];
  for (const cid in idx) {
    for (const e of (idx[cid].editions || [])) {
      if (e.first && e.last) {
        items.push({ cup: cid, cupName: idx[cid].cupName, ed: e.edition,
          first: e.first, last: e.last, matches: e.matches, days: e.days });
      }
    }
  }
  if (!items.length) { root.append(h("p", { class: "muted" }, "Ingen speldata med datum att visa än.")); return; }
  const years = [...new Set(items.map((i) => i.first.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const curY = String(new Date().getFullYear());
  if (kalenderYear === null || !years.includes(kalenderYear)) kalenderYear = years.includes(curY) ? curY : years[0];
  const yearSel = h("select", { class: "select", "aria-label": "Säsong" },
    years.map((y) => h("option", { value: y, ...(y === kalenderYear ? { selected: "" } : {}) }, y)));
  yearSel.addEventListener("change", () => { kalenderYear = yearSel.value; renderContent(); });
  root.append(h("div", { class: "row vinnare-controls" }, h("span", { class: "muted" }, "Säsong:"), yearSel));

  const Y = +kalenderYear;
  const yearDays = ((Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0) ? 366 : 365;
  const doy = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(Y, 0, 1)) / 86400000;
  const clampStart = (iso) => (+iso.slice(0, 4) < Y ? 0 : doy(iso));
  const clampEnd = (iso) => (+iso.slice(0, 4) > Y ? yearDays - 1 : doy(iso));
  const byCup = {};
  for (const i of items) (byCup[i.cup] = byCup[i.cup] || []).push(i);
  const realShown = items.filter((i) => i.first.slice(0, 4) === kalenderYear || i.last.slice(0, 4) === kalenderYear);
  const realCupIds = new Set(realShown.map((i) => i.cup));
  // Preliminär förhandsvisning: för den NYASTE säsongen, visa cuper som ännu
  // inte fått årets datum satt med FÖRRA årets datum (tydligt märkta) så man
  // ändå får en känsla för ungefär när de brukar spelas.
  const previews = [];
  if (kalenderYear === years[0]) {
    for (const cid in byCup) {
      if (realCupIds.has(cid)) continue;
      const past = byCup[cid].filter((e) => +e.first.slice(0, 4) < Y)
        .sort((a, b) => b.first.localeCompare(a.first))[0];
      if (!past) continue;
      previews.push({
        cup: cid, cupName: past.cupName, ed: past.ed,
        first: kalenderYear + past.first.slice(4), last: kalenderYear + past.last.slice(4),
        matches: past.matches, days: past.days, preview: true, srcYear: past.first.slice(0, 4),
      });
    }
  }
  const shown = [...realShown, ...previews]
    .sort((a, b) => a.first.localeCompare(b.first) || a.cupName.localeCompare(b.cupName, "sv"));
  if (!shown.length) { root.append(h("p", { class: "muted" }, "Inga cuper med speldagar det här året.")); return; }

  const months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const monthStart = []; { let acc = 0; for (let mo = 0; mo < 12; mo++) { monthStart.push(acc); acc += new Date(Y, mo + 1, 0).getDate(); } }
  const pct = (d) => (d / yearDays) * 100;
  const gridlines = () => months.map((_, mo) => h("span", { class: "gantt-line", style: "left:" + pct(monthStart[mo]) + "%" }));
  const todayEl = () => {
    if (kalenderYear !== curY) return null;
    const t = doy(new Date().toISOString().slice(0, 10));
    return (t < 0 || t > yearDays) ? null : h("span", { class: "gantt-today", style: "left:" + pct(t) + "%" });
  };
  const fmtRange = (i) => {
    const day = (iso) => +iso.slice(8, 10);
    const mon = (iso) => months[+iso.slice(5, 7) - 1];
    if (i.first === i.last) return day(i.first) + " " + mon(i.first);
    if (i.first.slice(5, 7) === i.last.slice(5, 7)) return day(i.first) + "–" + day(i.last) + " " + mon(i.last);
    return day(i.first) + " " + mon(i.first) + " – " + day(i.last) + " " + mon(i.last);
  };

  const header = h("div", { class: "gantt-row gantt-headrow" },
    h("span", { class: "gantt-label" }, ""),
    h("div", { class: "gantt-track" }, months.map((mn, mo) => h("span", { class: "gantt-month", style: "left:" + pct(monthStart[mo]) + "%" }, mn))));
  const rows = shown.map((i) => {
    const s = Math.max(0, clampStart(i.first)), e = Math.min(yearDays - 1, clampEnd(i.last));
    const label = (i.preview ? "≈ " : "") + fmtRange(i);
    const tip = i.preview
      ? i.cupName + " — preliminärt: förra årets datum (" + i.srcYear + "). " + kalenderYear + " ännu inte spikat. Klicka för att se " + i.srcYear + " års schema."
      : i.cupName + " " + i.ed + " · " + i.first + " – " + i.last + " · " + i.days + " speldagar · " + i.matches + " matcher";
    const bar = h("div", {
      class: "gantt-bar" + (i.preview ? " gantt-preview" : ""),
      style: "left:" + pct(s) + "%;width:" + Math.max(pct(e - s + 1), 1.2) + "%", title: tip,
    }, h("span", { class: "gantt-bar-txt" }, label));
    return h("div", {
      class: "gantt-row gantt-row-click" + (i.preview ? " gantt-row-prev" : ""), role: "button", tabindex: "0",
      "aria-label": i.cupName + (i.preview ? " (preliminärt datum)" : " " + i.ed) + ", " + fmtRange(i),
      onclick: () => gotoCupEdition(i.cup, i.ed),
      onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); gotoCupEdition(i.cup, i.ed); } },
    },
      h("span", { class: "gantt-label", title: i.cupName }, i.cupName),
      h("div", { class: "gantt-track" }, gridlines(), todayEl(), bar));
  });
  root.append(h("div", {
    class: "gantt", role: "region", tabindex: "0",
    "aria-label": "Cupkalender " + kalenderYear + ", skrollbar i sidled och höjdled",
  }, header, ...rows));
  const hint = previews.length
    ? "Klicka en cup för att öppna dess schema. Röd linje = idag. Streckade staplar (≈) är förra årets datum — årets är ännu inte spikat."
    : "Klicka en cup för att öppna dess schema. Röd linje = idag.";
  root.append(h("p", { class: "muted gantt-hint" }, hint));
}

// --- skyttar ------------------------------------------------------------
// Tvålagersmodell, samma som resultaten: CI bygger databasen över spelade
// matcher (scripts/fetch_scorers.py), och enheten fyller på med mål ur
// pågående matchers feed. Den som står vid planen ser alltså sitt lags
// skytt räknas upp direkt, utan att CI hunnit köra.

const SKYTT_STEG = 40;
let skyttVisade = SKYTT_STEG;
let skyttSok = "";
let skyttKlass = "";     // "" = alla klasser
let skyttLive = null;    // matchId -> [{lagId, namn, nr}] ur pågående matcher

// Lag-id -> {namn, klass, klassId} ur den öppna cupens matcher. Skyttefilen
// lagrar bara lag-id för att hålla sig liten.
function lagIndex() {
  const idx = new Map();
  for (const m of state.matches) {
    for (const sida of ["home", "away"]) {
      const lag = m[sida];
      if (lag && lag.id != null && !idx.has(lag.id)) {
        idx.set(lag.id, { namn: lag.name, klass: m.catName, klassId: m.catId });
      }
    }
  }
  return idx;
}

// Slår ihop CI-databasen med målen från pågående matcher. Live-målen
// räknas separat så raden kan visa att den tickar just nu.
function skyttRader(doc, idx) {
  const rader = new Map();
  for (const p of (doc && doc.players) || []) {
    const lag = idx.get(p.t);
    rader.set(p.t + "|" + p.n, {
      lagId: p.t, namn: p.n, nr: p.nr, mål: p.g, matcher: p.m, live: 0,
      lagnamn: (lag && lag.namn) || "—", klass: (lag && lag.klass) || "",
    });
  }
  for (const mål of Object.values(skyttLive || {})) {
    for (const g of mål) {
      const nyckel = g.lagId + "|" + g.namn;
      let rad = rader.get(nyckel);
      if (!rad) {
        const lag = idx.get(g.lagId);
        rad = { lagId: g.lagId, namn: g.namn, nr: g.nr, mål: 0, matcher: 0, live: 0,
          lagnamn: (lag && lag.namn) || "—", klass: (lag && lag.klass) || "" };
        rader.set(nyckel, rad);
      }
      rad.mål++;
      rad.live++;
      if (g.nr != null) rad.nr = g.nr;
    }
  }
  return [...rader.values()].sort((a, b) => b.mål - a.mål ||
    a.namn.localeCompare(b.namn, "sv"));
}

// Hämtar feeden för de matcher som pågår just nu och plockar ut målen.
// Ett anrop per pågående match, en gång per öppning av vyn.
function laddaLiveSkyttar(rita) {
  if (skyttLive) return;
  skyttLive = {};
  const pågår = state.matches.filter((m) => m.res && m.res.live && !m.res.fin &&
    m.start && Date.now() >= m.start);
  if (!pågår.length) return;
  Promise.all(pågår.map((m) => HB.api.fetchMatchFeed(cup(), m.id)
    .then((feed) => {
      const mål = ((feed && feed.events) || [])
        .filter((e) => e.typ === "mal" && e.player)
        .map((e) => ({
          lagId: (e.side === "away" ? m.away : m.home).id,
          namn: e.player, nr: e.nr,
        }));
      if (mål.length) skyttLive[m.id] = mål;
    })
    .catch(() => {}))).then(rita);
}

function renderScorersView(root) {
  // Sökrutan byggs EN gång och rörs aldrig av omritningen. Byggs den om
  // vid varje tangenttryck tappar den fokus och markörläge mitt i ordet
  // — samma fälla som redan bitit i den här kodbasen.
  const sok = h("input", {
    class: "input", type: "search", value: skyttSok,
    placeholder: "Sök spelare eller lag", "aria-label": "Sök spelare eller lag",
  });
  const klassrad = h("div", {
    class: "skytt-klasser", role: "group", "aria-label": "Klass",
  });
  const lista = h("div", { class: "skytt-lista-box" });
  const topp = h("p", { class: "muted skytt-topp" });
  const box = h("div", { class: "skytt-box" },
    topp, h("div", { class: "skytt-verktyg" }, sok), klassrad, lista);
  lista.append(h("p", { class: "muted" }, "Hämtar målskyttar …"));
  root.append(box);

  HB.api.fetchScorers(cup()).then((doc) => {
    const idx = lagIndex();
    const rita = () => {
      if (!lista.isConnected) return;
      skyttInnehall(doc, idx, rita, { topp, klassrad, lista });
    };
    rita();
    sok.addEventListener("input", () => {
      skyttSok = sok.value;
      skyttVisade = SKYTT_STEG;
      rita();
    });
    laddaLiveSkyttar(rita);
  });
}

function skyttInnehall(doc, idx, rita, el) {
  if (!doc || !(doc.players || []).length) {
    el.topp.textContent = "";
    el.klassrad.replaceChildren();
    el.lista.replaceChildren(h("p", { class: "muted" },
      "Ingen målskyttestatistik för den här cupen än. Den byggs upp efter " +
      "hand som matcher spelas färdigt."));
    return;
  }
  const alla = skyttRader(doc, idx);
  const klasser = [...new Set(alla.map((r) => r.klass).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "sv"));
  const fråga = skyttSok.trim().toLowerCase();
  const träffar = alla.filter((r) =>
    (!skyttKlass || r.klass === skyttKlass) &&
    (!fråga || r.namn.toLowerCase().includes(fråga) ||
      r.lagnamn.toLowerCase().includes(fråga)));

  el.topp.textContent = doc.goals
    ? doc.goals.named + " av " + doc.goals.total + " mål i cupen har " +
      "registrerad målskytt. Resten syns inte här."
    : "";

  el.klassrad.replaceChildren(
    ...[["", "Alla klasser"], ...klasser.map((k) => [k, k])].map(([v, etikett]) =>
      h("button", {
        class: "chip small" + (skyttKlass === v ? " on" : ""), type: "button",
        onclick: () => { skyttKlass = v; skyttVisade = SKYTT_STEG; rita(); },
      }, etikett)));

  const visade = träffar.slice(0, skyttVisade);
  const noder = visade.map((r, i) => h("div", {
    class: "skytt-rad" + (isClubName(r.lagnamn) ? " ours" : ""),
  },
  h("span", { class: "skytt-plats" }, String(i + 1)),
  h("span", { class: "skytt-mal" + (r.live ? " live" : "") }, String(r.mål)),
  h("span", {
    class: "skytt-namn spelar-lank", role: "button", tabindex: "0",
    title: "Visa " + r.namn + "s mål i cupen",
    onclick: () => openPlayerSheet(r.namn, r.lagId),
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); openPlayerSheet(r.namn, r.lagId);
      }
    },
  },
  r.nr != null ? h("span", { class: "feed-nr" }, String(r.nr)) : null,
  r.namn,
  h("span", { class: "skytt-lag" }, r.lagnamn + (r.klass ? " · " + r.klass : ""))),
  h("span", { class: "skytt-matcher" }, r.matcher ? r.matcher + " m" : "")));

  if (!träffar.length) noder.push(h("p", { class: "muted" }, "Ingen träff."));
  if (träffar.length > visade.length) {
    noder.push(h("button", {
      class: "btn small", type: "button",
      onclick: () => { skyttVisade += SKYTT_STEG; rita(); },
    }, "Visa fler (" + (träffar.length - visade.length) + " kvar)"));
  }
  el.lista.replaceChildren(...noder, ...disciplinLista(doc));
}

// Matcherna med flest utvisningar i cupen. Ritas bara när cupen faktiskt
// registrerar dem: Örebrocupen gör det (33 av 272 matcher), Göteborg Cup
// och Hällby inte alls, och då säger en tom lista bara emot sig själv.
const DISC_TOPP = 10;

function disciplinLista(doc) {
  const rader = (doc && doc.discipline) || [];
  const fält = (doc && doc.disciplineFields) || [];
  const iAntal = fält.indexOf("penaltiesCount");
  const iMin = fält.indexOf("penaltiesMinutes");
  if (!rader.length || iAntal < 0) return [];
  const namn = new Map();
  for (const m of state.matches) namn.set(m.id, m);
  const topp = rader
    .map((d) => ({ d, antal: (d.h[iAntal] || 0) + (d.a[iAntal] || 0), m: namn.get(d.m) }))
    .filter((r) => r.antal && r.m)
    .sort((a, b) => b.antal - a.antal)
    .slice(0, DISC_TOPP);
  if (!topp.length) return [];
  return [
    h("h3", { class: "skytt-rubrik" }, "Flest utvisningar"),
    h("p", { class: "muted skytt-topp" },
      rader.length + " av cupens matcher har registrerade utvisningar eller kort."),
    h("div", { class: "skytt-lista-box" }, topp.map((r, i) => h("div", {
      class: "skytt-rad" + (isClubName(r.m.home.name) || isClubName(r.m.away.name) ? " ours" : ""),
      role: "button", tabindex: "0",
      title: "Öppna matchen",
      onclick: () => openMatchSheet(r.m, "feed"),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchSheet(r.m, "feed"); }
      },
    },
    h("span", { class: "skytt-plats" }, String(i + 1)),
    h("span", { class: "skytt-mal" }, String(r.antal)),
    h("span", { class: "skytt-namn" },
      r.m.home.name + " – " + r.m.away.name,
      h("span", { class: "skytt-lag" },
        [HB.shortCat(r.m.catName), r.m.divName].filter(Boolean).join(" · "))),
    h("span", { class: "skytt-matcher" },
      iMin >= 0 ? ((r.d.h[iMin] || 0) + (r.d.a[iMin] || 0)) + " min" : "")))),
  ];
}

const STATS_TABS = [
  ["trend", "Trend", renderTrendView],
  ["vinnare", "Vinnare", renderVinnareView],
  ["kalender", "Kalender", renderKalenderView],
  ["karta", "Karta", renderMapView],
  ["klubb", "Klubb/lag", renderClubView],
  ["klubbjamforelse", "Klubbjämförelse", renderClubCompareView],
  ["cuper", "Cuper", renderCupsOverviewView],
  ["historik", "Historik", renderHistoryView],
  ["skyttar", "Skyttar", renderScorersView],
];

export function renderStatsView(root) {
  // state.statsSupport/statsKnown sätts av renderTabs() (körs alltid innan
  // renderContent() i render(), se dess kommentar) — men kan saknas om
  // renderContent() undantagsvis anropas direkt utan en föregående
  // renderTabs() (några asynkrona callbacks gör det, se t.ex.
  // ensureCupClubGeo/fetchArchiveIndex). Anta då att allt är stött hellre
  // än att gömma hela vyn i onödan.
  const support = state.statsSupport ||
    { trend: true, karta: true, vinnare: true, kalender: true, klubb: true, klubbjamforelse: true, cuper: true, historik: true };
  const visibleTabs = STATS_TABS.filter(([key]) => support[key]);
  // Den valda underfliken kan ha blivit ogiltig sen sist (t.ex. Karta
  // förlorade sitt stöd) — falla då tillbaka på den första som fortfarande
  // finns kvar, i stället för att rendera en tom/dold flik. Görs BARA när
  // vi vet säkert (state.statsKnown): Kartans klubbdata (litet, cup-
  // specifikt anrop) hinner ofta svara FÖRE det stora gemensamma
  // arkivindexet, så en mellanliggande omritning kan annars se ut som att
  // bara Karta är stödd än så länge — utan spärren skulle det permanent
  // knuffa bort en direktlänkad/sparad Trend-/Klubb-flik till Karta.
  if (state.statsKnown && !visibleTabs.some(([v]) => v === state.statsView)) {
    state.statsView = (visibleTabs[0] || STATS_TABS[0])[0];
  }
  // Visa alltid den just nu valda underfliken i listan, även om den ännu
  // inte hunnit bekräftas stödd (se ovan) — annars skulle den kunna blinka
  // bort ur fliklistan under en enda mellanliggande omritning.
  const shownKeys = new Set([...visibleTabs.map(([v]) => v), state.statsView]);
  const shownTabs = STATS_TABS.filter(([key]) => shownKeys.has(key));
  const tabBar = h("nav", { class: "history-tabs", role: "tablist", "aria-label": "Stats" },
    shownTabs.map(([v, label]) => h("button", {
      class: "tab" + (state.statsView === v ? " on" : ""), role: "tab", type: "button",
      onclick: () => { state.statsView = v; saveUi(); renderContent(); },
    }, label)));
  const content = h("div", { class: "history-viewer-body" });
  root.append(tabBar, content);
  const tabFn = (STATS_TABS.find(([v]) => v === state.statsView) || STATS_TABS[0])[2];
  tabFn(content);
  // Underflikraden är fast placerad på mobil (se style.css) — mät om
  // stapeln så innehållets bottenmarginal räknar med den.
  requestAnimationFrame(syncBottomStack);
}

function renderBrowseMode(root, idx, cupIds) {
  // hs = lokal, isolerad "state" för EN vald cup+edition — motsvarar
  // huvudappens state.matches/state.view men rör aldrig den riktiga
  // state, så bläddring i historik kan inte läcka in i eller störa
  // den vanliga live-cupen.
  //
  // Återanvänds från browseOpen när en upplaga redan är öppnad: render-
  // Content() kan köras när som helst (bakgrundsuppdatering var tredje
  // minut, arkivindexet som anländer, en URL-synk) och byggde tidigare
  // alltid ett tomt hs — vilket slängde tillbaka en pågående bläddring
  // till cup/år-väljaren mitt i. browseOpen sätts av renderViewer och
  // nollas av renderPicker, se deras kommentarer.
  const hs = (browseOpen && browseOpen.matches) ? browseOpen : {
    cupId: cupIds.includes(state.cupId) ? state.cupId : cupIds[0],
    edition: null, cupName: "", matches: [],
    view: "schema", catFilter: "", teamQuery: state.favoriteClub || "", arena: "",
  };

  function renderPicker() {
    const editions = idx[hs.cupId].editions.slice().sort((a, b) => b.edition.localeCompare(a.edition));
    const cupSel = h("select", { class: "select", "aria-label": "Välj cup" },
      cupIds.map((id) => h("option", { value: id, ...(id === hs.cupId ? { selected: "" } : {}) }, idx[id].cupName)));
    const edSel = h("select", { class: "select", "aria-label": "Välj år" },
      editions.map((e) => h("option", { value: e.edition },
        e.edition + " (" + archiveEditionMatchLabel(e) +
        // Ospelad upplaga: matchantalet växer fortfarande allteftersom
        // arrangören publicerar klasserna (se preliminary i
        // scripts/archive_results.py).
        (e.preliminary ? ", preliminärt" : "") + ")")));
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
        syncUrl();
      },
    }, "Bläddra i " + idx[hs.cupId].cupName + " " + edSel.value);
    // Ingen upplaga öppen (eller på väg att öppnas) längre — släpp URL:ens
    // b*-parametrar.
    browseOpen = null; browseTarget = null;
    syncUrl();
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
    // syncSubViewUrl läser hs live via browseOpen — sätts här (och nollas i
    // renderPicker) så URL:en alltid speglar den upplaga som faktiskt visas.
    browseOpen = hs;
    const tabBar = h("nav", { class: "history-tabs", role: "tablist", "aria-label": "Historikvy" },
      HISTORY_TABS.map(([v, label]) => h("button", {
        class: "tab" + (hs.view === v ? " on" : ""), role: "tab", type: "button",
        onclick: () => { hs.view = v; renderViewer(); syncUrl(); },
      }, label)));
    const content = h("div", { class: "history-viewer-body" });
    root.replaceChildren(
      h("div", { class: "history-viewer-head" },
        // Kom vi hit via ett klick i Vinnare-fliken (troféskåpet) — visa en
        // väg tillbaka dit, inte bara "byt cup/år" inom historiken.
        vinnareReturn ? h("button", {
          class: "chip", type: "button",
          onclick: () => {
            vinnareReturn = false; browseTarget = null;
            state.view = "stats"; state.statsView = "vinnare"; vinnareMode = "trofe";
            saveUi(); renderContent();
          },
        }, "← Tillbaka till troféskåpet") : null,
        h("button", { class: "chip", type: "button", onclick: () => { vinnareReturn = false; renderPicker(); } }, "← Byt cup/år"),
        h("span", { class: "cat" }, hs.cupName + " " + hs.edition),
        h("span", { class: "muted" }, hs.matches.length + " matcher")),
      tabBar, content);
    const tabFn = (HISTORY_TABS.find(([v]) => v === hs.view) || HISTORY_TABS[0])[2];
    tabFn(content, hs);
  }

  // Direktlänkning hit från t.ex. Vinnare-fliken (se gotoBrowseSlutspel):
  // ladda en bestämd cup+upplaga direkt i viewern i stället för väljaren.
  async function openTarget(t) {
    if (!idx[t.cupId] || !(idx[t.cupId].editions || []).some((e) => e.edition === t.edition)) {
      renderPicker(); // nollar browseTarget/browseOpen
      return;
    }
    hs.cupId = t.cupId; hs.edition = t.edition; hs.cupName = idx[t.cupId].cupName;
    hs.view = t.view || "slutspel"; hs.catFilter = t.catFilter || "";
    hs.arena = t.arena || ""; if (t.teamQuery != null) hs.teamQuery = t.teamQuery;
    root.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
    const data = await HB.api.fetchArchiveEdition(t.cupId, t.edition);
    hs.matches = (data && data.matches) || [];
    // Först NU är beställningen utförd. Att nolla den före await:en hade
    // gjort att en omritning under hämtningen (den är långsam första
    // gången) inte hittade något att öppna och föll tillbaka på väljaren —
    // fetchArchiveEdition cachar, så en omkörning är billig.
    if (browseTarget === t) browseTarget = null;
    renderViewer();
    syncUrl();
  }

  // En beställd upplaga (djuplänk eller klick i troféskåpet) väger tyngst,
  // därefter ett redan öppnat läge, annars cup/år-väljaren.
  if (browseTarget) {
    // Sätt browseOpen redan NU (inte först i renderViewer efter openTargets
    // await) så URL:en behåller sina b*-parametrar under hämtningen.
    browseOpen = { ...browseTarget };
    openTarget(browseTarget);
  } else if (browseOpen && browseOpen.matches) {
    renderViewer();
  } else {
    renderPicker();
  }
}

// Öppnar Historik-bläddraren direkt på en viss cup+upplaga+klass i slutspels-
// vyn — används av Vinnare-fliken (klick på ett troféskåpskort). browseTarget
// konsumeras av renderBrowseMode vid nästa render (nollställs där).
let browseTarget = null;
// Bläddrarens lokala hs-objekt medan en upplaga är öppnad (null = cup/år-
// väljaren visas). syncSubViewUrl läser cupId/edition/view/catFilter/arena/
// teamQuery direkt ur det — hs muteras ju av väljarna inuti bläddrarens
// egna flikar, som bara anropar sin lokala refresh() och aldrig render().
let browseOpen = null;
const syncBrowseUrl = () => { if (browseOpen) syncUrl(); };
let vinnareReturn = false;   // kom vi till historik-bläddraren via Vinnare?
function gotoBrowseSlutspel(cupId, edition, catName) {
  browseTarget = { cupId, edition, view: "slutspel", catFilter: catName || "" };
  vinnareReturn = true;
  historyMode = "browse";
  state.statsView = "historik";
  state.view = "stats";
  saveUi();
  renderContent();
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// Historik (under Stats): "Jämför lag" (renderCompareMode) och "Bläddra i
// ett år" (renderBrowseMode) var tidigare en fristående knapp+modal
// (#historyBtn/openHistoryDialog) — flyttad hit 2026-07-26 som en sjätte
// Stats-underflik, samma sorts "tvärs över cuper/år"-funktion som resten
// av Stats i stället för en egen dialog vid sidan om. historyMode hålls
// på modulnivå (INTE i state) så det överlever att man växlar till en
// annan Stats-underflik och tillbaka, men nollställs vid en full
// sidladdning — matchar hur läget redan fungerade som dialog (alltid
// samma startläge, "Jämför lag", varje gång man öppnade den).
let historyMode = "compare";

function renderHistoryView(root) {
  const idx = state.archiveIndex;
  if (!idx) { root.append(h("p", { class: "muted" }, "Hämtar arkivindex …")); return; }
  const cupIds = Object.keys(idx).filter((id) => (idx[id].editions || []).length)
    .sort((a, b) => idx[a].cupName.localeCompare(idx[b].cupName, "sv"));
  if (!cupIds.length) {
    root.append(h("p", { class: "muted" },
      "Ingen historik arkiverad än — byggs upp automatiskt allteftersom cuperna spelas."));
    return;
  }
  root.append(h("div", { class: "row" },
    h("div", { class: "seg", role: "group", "aria-label": "Historikläge" },
      chip("Jämför lag", historyMode === "compare", () => { historyMode = "compare"; renderContent(); }),
      chip("Bläddra i ett år", historyMode === "browse", () => { historyMode = "browse"; renderContent(); }))));
  const body = h("div", null);
  root.append(body);
  if (historyMode === "compare") renderCompareMode(body, idx, cupIds);
  else renderBrowseMode(body, idx, cupIds);
}

function renderCompareMode(root, idx, cupIds) {
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
      const selectedCup = HB.allCups().find((c) => c.id === selCup);
      const children = [
        h("summary", null,
          h("span", { class: "history-year-label" }, s.edition),
          h("span", { class: "history-year-stats" },
            s.played + " sp · " + s.won + "V " + s.tied + "O " + s.lost +
            "F · " + scoreUnit(selectedCup && selectedCup.sport) + " " + s.gf + "–" + s.ga)),
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

export function getStatsTabs() {
  return STATS_TABS;
}

export function getStatsUrlFields() {
  return {
    kalenderYear,
    vinnareMode, vinnareQuery, vinnareMedals, vinnareCup, vinnareYear,
    vinnareToppCup, vinnareToppMedals,
    historyMode,
    browse: browseOpen || browseTarget,
  };
}

export function applyStatsUrlFields(patch) {
  if ("clubQuery" in patch) clubQuerySeeded = true;
  if (patch.kalenderYear) kalenderYear = patch.kalenderYear;
  if (patch.vinnareMode) vinnareMode = patch.vinnareMode;
  if ("vinnareQuery" in patch) vinnareQuery = patch.vinnareQuery;
  if (patch.vinnareMedals) vinnareMedals = patch.vinnareMedals;
  if (patch.vinnareCup) vinnareCup = patch.vinnareCup;
  if (patch.vinnareYear) vinnareYear = patch.vinnareYear;
  if ("vinnareToppCup" in patch) vinnareToppCup = patch.vinnareToppCup;
  if (patch.vinnareToppMedals) vinnareToppMedals = patch.vinnareToppMedals;
  if (patch.historyMode) historyMode = patch.historyMode;
  if (patch.browse) {
    browseTarget = patch.browse;
    historyMode = "browse";
  }
}

export function resetStatsUrlFields(defaults = defaultSubViewSnap()) {
  kalenderYear = defaults.kalenderYear;
  vinnareMode = defaults.vinnareMode;
  vinnareQuery = defaults.vinnareQuery;
  vinnareMedals = defaults.vinnareMedals;
  vinnareCup = defaults.vinnareCup;
  vinnareYear = defaults.vinnareYear;
  vinnareToppCup = defaults.vinnareToppCup;
  vinnareToppMedals = defaults.vinnareToppMedals;
  historyMode = defaults.historyMode;
  clubQuerySeeded = false;
  browseTarget = null;
  browseOpen = null;
}
