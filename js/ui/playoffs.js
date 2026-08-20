/* playoffs.js — tabell- och slutspelsvyer. */

import { h, $$ } from "../dom.js";
import { catSortKey } from "../domain/category.js";
import { isPlaceholderTeam } from "../domain/placeholder.js";
import { groupPlayoffDivisionsById } from "../domain/archive.js";
import {
  isGroupComplete, groupProgress, groupPlayoffRounds, playoffWinnerSide,
  playoffPlacementRows, playoffGroupReference, playoffTeamKey,
  buildPlayoffProjection as buildPlayoffProjectionFor,
  possibleGroupCandidates as possibleGroupCandidatesFor,
} from "../domain/playoff.js";
import { renderSelectionBar } from "./schema.js";
import {
  splitRecentPlayedByCount, showAllPlayedButtonCount,
} from "./reveal.js";

let state, cup, saveUi, saveSettings, render, renderContent;
let scoped, filtered, hasFilterSelection, matchesSearchQuery, matchesViewFilter;
let isClubName, isClubMatch, isFavoriteTeam, computeGroupTableRows;
let allActiveMatches, chip, openMatchDialog, openTeamQuickView;
let matchTimeLabel, scoreText, isLive, hasScheduledStart, sheetMode;
let slugifySv, cohortKey, shortCat, gotoTeamMatches;

export function initPlayoffs(deps) {
  ({
    state, cup, saveUi, saveSettings, render, renderContent,
    scoped, filtered, hasFilterSelection, matchesSearchQuery, matchesViewFilter,
    isClubName, isClubMatch, isFavoriteTeam, computeGroupTableRows,
    allActiveMatches, chip, openMatchDialog, openTeamQuickView,
    matchTimeLabel, scoreText, isLive, hasScheduledStart, sheetMode,
    slugifySv, cohortKey, shortCat, gotoTeamMatches,
  } = deps);
}

const playoffCandidateTimers = new Set();

export function clearPlayoffCandidateTimers() {
  for (const timer of playoffCandidateTimers) clearInterval(timer);
  playoffCandidateTimers.clear();
}

function showMatchDialog(dlg) {
  if (sheetMode()) dlg.show();
  else dlg.showModal();
}

// --- render: tabeller -------------------------------------------------------

export function divisionsToShow() {
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

const expandedTableClassStats = new Set();

function ensureTable(divId, edition) {
  if (state.tables[divId]) return;
  const official = !edition ? HB.api.snapshotTable(cup(), divId) : [];
  if (official.length) {
    state.tables[divId] = { status: "done", rows: official };
    return;
  }
  // Snapshotten innehåller alla matcher, så tabellen kan byggas lokalt
  // utan ett separat API-anrop per användare och grupp.
  const divMatches = allActiveMatches().filter((m) =>
    m.divId === divId && (m.edition || null) === (edition || null));
  state.tables[divId] = { status: "done", rows: computeGroupTableRows(divMatches) };
}

function tableClassStats(catId, edition) {
  const matches = allActiveMatches().filter((m) =>
    m.catId === catId && (m.edition || null) === (edition || null));
  const teams = new Set();
  const groupDivs = new Set();
  let playoffs = 0, played = 0, untimed = 0;
  for (const m of matches) {
    for (const side of [m.home, m.away]) {
      if (!side || isPlaceholderTeam(side)) continue;
      teams.add(side.id != null ? "id:" + side.id : "name:" + slugifySv(side.name));
    }
    if (m.divType === "Playoff") playoffs++;
    else if (m.divId != null) groupDivs.add(m.divId);
    if (m.res && m.res.fin) played++;
    if (!hasScheduledStart(m)) untimed++;
  }
  return {
    teams: teams.size, tables: groupDivs.size, matches: matches.length,
    groupMatches: matches.length - playoffs, playoffs, played,
    remaining: matches.length - played, untimed,
  };
}

function tableClassStatsBlock(catId, catName, edition) {
  const key = catId + "|" + (edition || "current");
  const s = tableClassStats(catId, edition);
  const details = h("details", {
    class: "table-class-stats",
    ...(expandedTableClassStats.has(key) ? { open: "" } : {}),
  },
  h("summary", null, "Läs mer"),
  h("div", { class: "table-class-stats-body" },
    h("strong", null,
      "Totalt " + s.teams + " lag i " + s.tables +
      (s.tables === 1 ? " tabell" : " tabeller") + " och " + s.matches + " matcher."),
    h("span", null,
      s.groupMatches + " gruppspelsmatcher · " + s.playoffs + " slutspelsmatcher"),
    h("span", null,
      s.played + " spelade · " + s.remaining + " återstår" +
      (s.untimed ? " · " + s.untimed + " utan satt tid" : ""))));
  details.addEventListener("toggle", () => {
    if (details.open) expandedTableClassStats.add(key);
    else expandedTableClassStats.delete(key);
  });
  const cohort = cohortKey(catName);
  return h("div", { class: "table-class-heading" },
    h("h2", { class: "day-h" }, catName,
      cohort ? h("span", { class: "table-class-cohort" }, cohort) : null),
    details);
}

let lastTableGroupSetSignature = null;

export function renderTables(main) {
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

  main.append(h("div", { class: "playoff-display-options table-display-options" },
    h("label", { class: "playoff-display-toggle" },
      h("input", {
        type: "checkbox", ...(state.showPossibleGroupWinners ? { checked: "" } : {}),
        onchange: (event) => {
          state.showPossibleGroupWinners = event.target.checked;
          saveSettings(); renderContent();
        },
      }),
      h("span", null, "Möjlig vinnare"))));

  // Om flera grupper valts (ex. F2010 + F2013) grupperas de först och visas
  // som en horisontell sticky-rad med val för aktiv tabellsektion.
  const tableGroups = [];
  const byGroup = new Map();
  for (const d of divs) {
    // Gruppnyckeln är unik per klass och upplaga: samma namn utan år i
    // filtret får fortfarande sin egen flik om år skiljer sig.
    const groupKey = d.catId + "|" + (d.edition || "");
    if (!byGroup.has(groupKey)) {
      const fullHeading = d.catName +
        (state.years.size ? " · " + (d.edition || cup().edition) : "");
      const heading = cohortKey(d.catName) || shortCat(d.catName) || d.catName;
      const g = { key: groupKey, heading, fullHeading,
        catId: d.catId, edition: d.edition, divs: [] };
      byGroup.set(groupKey, g);
      tableGroups.push(g);
    }
    byGroup.get(groupKey).divs.push(d);
  }

  // Ett valt tredjeradsläge hör till exakt det klass-/lagurval som rådde
  // när det valdes. Om gruppmängden ändras ska den nya vyn börja på Alla;
  // annars kan ett gammalt F2010-val få elva tabeller att se ut som två.
  const groupSetSignature = tableGroups.map((g) => g.key).sort().join("~");
  if (lastTableGroupSetSignature != null &&
      lastTableGroupSetSignature !== groupSetSignature) {
    state.tableGroupKey = "all";
  }
  lastTableGroupSetSignature = groupSetSignature;

  const activeGroupKey = state.tableGroupKey === "all" ||
    tableGroups.some((g) => g.key === state.tableGroupKey)
    ? state.tableGroupKey : "all";
  state.tableGroupKey = activeGroupKey;

  const tabGroups = tableGroups.length > 1
    ? [{ key: "all", heading: "Alla" }, ...tableGroups] : [];
  const tableTabButtons = () => tabGroups.map((g) => h("button", {
      class: "table-group-tab" + (g.key === activeGroupKey ? " on" : ""),
      type: "button", role: "tab", "aria-selected": String(g.key === activeGroupKey),
      title: g.key === "all" ? "Visa alla valda tabeller" : g.fullHeading,
      "aria-label": g.key === "all" ? "Visa alla valda tabeller" : g.fullHeading,
      onclick: () => {
        state.tableGroupKey = g.key;
        saveUi();
        renderContent();
      },
    }, g.heading));
  if (tableGroups.length > 1) renderSelectionBar(tableTabButtons(), "tabeller");

  const visibleGroups = activeGroupKey === "all"
    ? tableGroups : tableGroups.filter((group) => group.key === activeGroupKey);
  for (const group of visibleGroups) {
    main.append(tableClassStatsBlock(group.catId, group.fullHeading, group.edition));
    const groupEl = h("div", { class: "table-group" });
    main.append(groupEl);

    for (const d of group.divs) {
      ensureTable(d.id, d.edition);
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
        const winnerCandidates = state.showPossibleGroupWinners
          ? possibleGroupCandidates(t.rows, 1) : [];
        const candidateKeys = new Set(winnerCandidates.map((row) =>
          row.teamId != null ? "id:" + row.teamId : "name:" + slugifySv(row.name)));
        const unfinishedCandidates = !isGroupComplete(t.rows) && winnerCandidates.length > 1;
        if (unfinishedCandidates) {
          box.append(h("p", { class: "muted group-candidate-summary" },
            winnerCandidates.length + " möjliga gruppvinnare · " +
            Math.round(groupProgress(t.rows) * 100) + "% av gruppspelet spelat"));
        }
        const rankedRows = t.rows.map((r, rank) => ({ r, rank: rank + 1 }));
        const sortDir = state.tableSortOrder === "asc" ? 1 : -1;
        rankedRows.sort((a, b) => {
          let cmp;
          if (state.tableSortKey === "rank") cmp = a.rank - b.rank;
          else if (state.tableSortKey === "name") {
            cmp = a.r.name.localeCompare(b.r.name, "sv", { numeric: true });
          } else cmp = a.r.points - b.r.points;
          return sortDir * cmp || a.rank - b.rank;
        });
        box.append(h("table", { class: "standings" },
          h("thead", null, h("tr", null,
            ["#", "Lag", "S", "V", "O", "F", "+/-", "P"].map((c, i) =>
              h("th", { class: i < 2 ? "l" : "" }, c)))),
          h("tbody", null, rankedRows.map(({ r, rank }) => {
            const rowKey = r.teamId != null ? "id:" + r.teamId : "name:" + slugifySv(r.name);
            const possibleWinner = unfinishedCandidates && candidateKeys.has(rowKey);
            return h("tr", { class: (isClubName(r.name) ? "us" : "") +
                (possibleWinner ? " possible-group-winner" : "") },
              h("td", null, String(rank)),
              h("td", { class: "l" },
                r.teamId != null
                  ? h("button", {
                      class: "team-link", type: "button",
                      title: "Visa " + r.name + "s matcher",
                      onclick: () => gotoTeamMatches({ id: r.teamId }, "all"),
                    }, r.name)
                  : r.name,
                possibleWinner ? h("span", {
                  class: "group-candidate-mark", title: "Kan fortfarande vinna gruppen",
                }, "möjlig 1:a") : null),
              h("td", null, String(r.played)),
              h("td", null, String(r.won)),
              h("td", null, String(r.tied)),
              h("td", null, String(r.lost)),
              h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
              h("td", { class: "pts" }, String(r.points)));
          }))));
      }
      groupEl.append(box);
    }
  }
}

// --- render: slutspel --------------------------------------------------------

export function categoriesToShow() {
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

export function ensurePlayoffs(catId, edition) {
  if (state.playoffs[catId]) return;
  const official = !edition ? HB.api.snapshotPlayoffs(cup(), catId) : [];
  if (official.length) {
    state.playoffs[catId] = { status: "done", divisions: official };
    return;
  }
  const catMatches = allActiveMatches().filter((m) =>
    m.catId === catId && m.divType === "Playoff" &&
    (m.edition || null) === (edition || null));
  state.playoffs[catId] = {
    status: "done", divisions: groupPlayoffDivisionsById(catMatches),
  };
}

// --- upplösta slutspelsnamn: fyller i platshållarplatser ("N:an i Grupp
// M", "Bästa N:an", "Vinn. X") med nuvarande tabellplacering eller en
// verklig vinnare från en färdigspelad matarmatch. Rör aldrig original-
// datan i state.playoffs; bygger en separat visningskarta som
// bracketMatchBox/bracketTableBlock läser om inställningen är på.
//
// OBS: siffran i "Vinn. 18072137" är INTE samma id-rymd som Match.id —
// det är en Cup Manager-intern etikett vi inte kan slå upp direkt
// (verifierat: en semifinals "Vinn. 18072137" refererar till en
// kvartsfinal vars riktiga id är 82143330). Vi använder i stället
// matchens EGNA nextWinnerId-fält (redan i datan) för att koppla ihop
// matcher framåt i trädet, positionerat via matchRank när en match har
// två olösta sidor (t.ex. finalen).
export function ensureGroupTables(catId) {
  if (state.groupTables[catId]) return;
  const byDivision = new Map();
  for (const m of state.matches) {
    if (m.catId !== catId || m.divType === "Playoff" || m.divId == null) continue;
    if (!byDivision.has(m.divId)) {
      byDivision.set(m.divId, { id: m.divId, name: m.divName || "", matches: [] });
    }
    byDivision.get(m.divId).matches.push(m);
  }
  const byGroupNum = {};
  const teamStrength = {};
  for (const group of byDivision.values()) {
    const gm = /grupp\s*([a-zåäö0-9]+)/i.exec(group.name);
    if (!gm) continue;
    const rows = computeGroupTableRows(group.matches);
    byGroupNum[slugifySv(gm[1])] = rows;
    for (const r of rows) {
      if (r.teamId == null) continue;
      teamStrength[r.teamId] = {
        points: r.points, gf: r.gf, ga: r.ga, played: r.played,
        won: r.won, tied: r.tied, lost: r.lost,
        name: r.name, group: group.name,
      };
    }
  }
  state.groupTables[catId] = { status: "done", byGroupNum, teamStrength };
}

function currentSport() {
  return (cup() && cup().sport) || "handboll";
}
function possibleGroupCandidates(rows, rank) {
  return possibleGroupCandidatesFor(rows, rank, currentSport());
}
function buildPlayoffProjection(div, gd) {
  return buildPlayoffProjectionFor(div, gd, currentSport());
}

// projMap: matchId -> {home, away, winnerSide} från buildPlayoffProjection()
// — ospelade matcher som kunnat lösas upp visar ett prognosticerat lagnamn
// (tydligt markerat, class "predicted") i stället för det råa
// platshållarnamnet ("N:an i Grupp M" osv).
// onClick: valfri override — historikens brackettrad matar in matcher
// som inte finns i state.matches (fel år), så gotoMatch(m) skulle inte
// hitta något att hoppa till där.
function openPlayoffCandidatesDialog(rawCandidates) {
  const byKey = new Map();
  for (const candidate of rawCandidates || []) {
    const key = candidate.teamId != null
      ? "id:" + candidate.teamId : "name:" + slugifySv(candidate.name);
    const old = byKey.get(key);
    // Kandidaten kan ha passerat flera matarmatcher. Behåll varianten som
    // faktiskt bär grupptabellens siffror framför den rena namnvarianten.
    if (!old || (old.points == null && candidate.points != null)) byKey.set(key, candidate);
  }
  const candidates = [...byKey.values()];
  const dlg = h("dialog", { class: "match-dialog history-dialog playoff-candidates-dialog" });
  dlg.addEventListener("click", (event) => { if (event.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  const tableHost = h("div", { class: "table-box playoff-candidates-table" });
  const sort = { key: "points", dir: -1 };
  const value = (candidate, key) => {
    if (key === "name") return candidate.name || "";
    if (key === "group") return candidate.group || "";
    if (key === "diff") return candidate.gf == null || candidate.ga == null
      ? Number.NEGATIVE_INFINITY : candidate.gf - candidate.ga;
    const v = candidate[key];
    return v == null ? Number.NEGATIVE_INFINITY : v;
  };
  const columns = [
    ["name", "Lag", true, 1], ["group", "Grupp", true, 1],
    ["played", "S", false, -1], ["points", "P", false, -1],
    ["diff", "+/−", false, -1], ["gf", "Mål", false, -1],
  ];
  const renderTable = () => {
    const rows = candidates.slice().sort((a, b) => {
      const av = value(a, sort.key), bv = value(b, sort.key);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv : String(av).localeCompare(String(bv), "sv", { numeric: true });
      return sort.dir * cmp || (b.points || 0) - (a.points || 0) ||
        ((b.gf || 0) - (b.ga || 0)) - ((a.gf || 0) - (a.ga || 0)) ||
        (a.name || "").localeCompare(b.name || "", "sv", { numeric: true });
    });
    const heading = ([key, label, left, defaultDir]) => h("th", {
      class: (left ? "l " : "") + "bracket-th-sort" + (sort.key === key ? " on" : ""),
      role: "button", tabindex: "0",
      onclick: () => {
        if (sort.key === key) sort.dir *= -1;
        else { sort.key = key; sort.dir = defaultDir; }
        renderTable();
      },
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.currentTarget.click();
        }
      },
    }, label, sort.key === key
      ? h("span", { class: "sort-arrow" }, sort.dir > 0 ? " ▲" : " ▼") : null);
    const shown = (candidate, key) => {
      const v = value(candidate, key);
      if (typeof v === "number" && !Number.isFinite(v)) return "–";
      if (key === "diff") return v > 0 ? "+" + v : String(v);
      return v === "" ? "–" : String(v);
    };
    tableHost.replaceChildren(h("table", { class: "standings" },
      h("thead", null, h("tr", null, columns.map(heading))),
      h("tbody", null, rows.map((candidate) => h("tr", {
        class: isClubName(candidate.name) ? "us" : "",
      }, columns.map(([key, , left], index) => h(index === 0 ? "th" : "td", {
        class: left ? "l" : "", ...(index === 0 ? { scope: "row" } : {}),
      }, shown(candidate, key))))))));
  };
  renderTable();
  dlg.append(
    h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng", onclick: () => dlg.close() }, "×"),
    h("div", { class: "match-dialog-head" },
      h("span", { class: "cat" }, candidates.length + " möjliga lag"),
      h("span", null, "Kandidater till slutspelsplatsen")),
    h("p", { class: "muted" },
      "Poäng och " + (cup().sport === "basket" ? "poängskillnad" : "målskillnad") +
      " kommer från lagens respektive grupper. Klicka på en rubrik för att sortera."),
    tableHost);
  document.body.append(dlg);
  showMatchDialog(dlg);
}

function playoffTeamNameNode(side) {
  const candidates = (side && side.candidates) || [];
  if (candidates.length < 2) return (side && side.name) || "TBD";
  const clickable = {
    role: "button", tabindex: "0", "aria-label": "Visa alla möjliga lag",
    onclick: (event) => {
      event.preventDefault(); event.stopPropagation();
      openPlayoffCandidatesDialog(candidates);
    },
    onkeydown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); event.stopPropagation();
        openPlayoffCandidatesDialog(candidates);
      }
    },
  };
  if (candidates.length > 5) return h("span", {
    class: "playoff-candidate-rotation playoff-candidate-many",
    title: "Möjliga lag: " + candidates.map((candidate) => candidate.name).join(", "),
    ...clickable,
  }, h("span", { class: "playoff-candidate-count" }, candidates.length + " möjliga lag ▾"));
  const name = h("span", { class: "playoff-rotating-name" }, candidates[0].name);
  const progress = Number.isFinite(side.progress)
    ? " · " + Math.round(side.progress * 100) + "% spelat" : "";
  const status = h("span", { class: "playoff-candidate-count" },
    "1/" + candidates.length + " möjliga" + progress + " ▾");
  const host = h("span", {
    class: "playoff-candidate-rotation",
    title: "Möjliga lag: " + candidates.map((candidate) => candidate.name).join(", "),
    ...clickable,
  }, name, status);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let index = 0;
    const timer = setInterval(() => {
      if (!host.isConnected) {
        clearInterval(timer);
        playoffCandidateTimers.delete(timer);
        return;
      }
      if (document.hidden) return;
      index = (index + 1) % candidates.length;
      name.textContent = candidates[index].name;
      status.textContent = (index + 1) + "/" + candidates.length + " möjliga" + progress + " ▾";
    }, 5000);
    playoffCandidateTimers.add(timer);
  }
  return host;
}

function bracketMatchBox(m, projMap, onClick, relevantIds) {
  const sc = scoreText(m.res);
  const handleClick = onClick || (() => openMatchDialog(m));
  const proj = projMap ? projMap.get(m.id) : null;
  const teamRow = (side, isHome) => {
    const projSide = proj ? (isHome ? proj.home : proj.away) : null;
    const name = projSide ? projSide.name : (side.name || "TBD");
    const actualWinner = playoffWinnerSide(m);
    const won = actualWinner && ((actualWinner === "home") === isHome);
    // Kursiv "predicted"-stil bara om LAGET SJÄLVT är en gissning (t.ex.
    // en grupp som fortfarande spelas) — inte bara för att MATCHEN de ska
    // mötas i är ospelad. Ett redan säkert lag (grupp klar, eller vann en
    // riktigt spelad tidigare omgång) visas normalt även i en prognosmatch.
    const uncertain = projSide && projSide.certain === false;
    return h("div", {
      class: "bracket-team" + (isClubName(name) ? " us" : "") +
        (won ? " won" : "") + (uncertain ? " predicted" : ""),
    }, playoffTeamNameNode(projSide || { name }));
  };
  return h("div", {
    class: "bracket-match" + (isClubMatch(m) ? " ours" : "") +
      (proj && proj.predicted ? " predicted-match" : "") +
      (relevantIds && relevantIds.has(m.id) ? " relevant-path" : ""),
    "data-match-id": String(m.id),
    role: "button", tabindex: "0",
    title: onClick ? undefined : "Visa match och aktuella grupper",
    "aria-label": "Visa " + (m.home.name || "TBD") + " mot " + (m.away.name || "TBD") +
      (onClick ? "" : " och aktuella grupper"),
    onclick: handleClick,
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); }
    },
  },
    h("div", { class: "bracket-teams" }, teamRow(m.home, true), teamRow(m.away, false)),
    h("div", { class: "bracket-score" }, proj && proj.predicted ? "Prognos" : (sc || "–")),
    h("div", { class: "bracket-meta" },
      relevantIds && relevantIds.has(m.id)
        ? h("span", { class: "bracket-relevance-tag" }, "★ Möjlig väg") : null,
      (m.matchNr ? "Match " + m.matchNr + " · " : "") +
      matchTimeLabel(m) + (m.arena ? " · " + m.arena : "")));
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
export function drawBracketConnectors(boxEl, div, zoomOverride) {
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

export function bracketBlock(div, projMap, matchOnClick, relevantIds) {
  return h("section", { class: "bracket-box" },
    h("h3", null, div.name),
    h("div", { class: "bracket" },
      groupPlayoffRounds(div).map(([, ms]) =>
        h("div", { class: "bracket-round" },
          h("div", { class: "bracket-round-label" }, ms[0].roundName || ""),
          [...ms].sort((a, b) => state.playoffTimeOrder === "asc"
            ? a.start - b.start : b.start - a.start)
            .map((m) => bracketMatchBox(m, projMap, matchOnClick, relevantIds))))));
}

function relevantPlayoffMatchIds(div, catId, edition) {
  const groupTokens = new Set();
  const sameEdition = (m) => (m.edition || null) === (edition || null);
  const followed = (side, catName) => side && (
    (side.id != null && state.teams.has(side.id)) ||
    isClubName(side.name || "") || isFavoriteTeam(side.name || "", catName));
  for (const m of allActiveMatches()) {
    if (m.catId !== catId || !sameEdition(m) || m.divType === "Playoff") continue;
    if (!followed(m.home, m.catName) && !followed(m.away, m.catName)) continue;
    const found = /grupp\s+([a-zåäö0-9]+)/i.exec(m.divName || "");
    if (found) groupTokens.add(slugifySv(found[1]));
  }

  const matchesById = new Map(div.matches.map((m) => [m.id, m]));
  const relevant = new Set();
  const queue = [];
  for (const m of div.matches) {
    const directTeam = followed(m.home, m.catName) || followed(m.away, m.catName);
    const directGroup = [m.home, m.away].some((side) => {
      const ref = playoffGroupReference(side && side.name);
      return ref && groupTokens.has(ref.token);
    });
    if (directTeam || directGroup) queue.push(m.id);
  }
  // Följ båda möjliga fortsättningarna. Innan matchen är spelad kan den
  // valda klubben hamna på vinnar- eller förlorarvägen; båda är relevanta.
  while (queue.length) {
    const id = queue.shift();
    if (relevant.has(id)) continue;
    relevant.add(id);
    const m = matchesById.get(id);
    if (!m) continue;
    for (const nextId of [m.nextWinnerId, m.nextLoserId]) {
      if (nextId != null && matchesById.has(nextId) && !relevant.has(nextId)) queue.push(nextId);
    }
  }
  // Stjärnan betyder "möjlig väg" och hör därför bara hemma på matcher
  // vars utgång ännu inte är känd. De spelade matcherna måste fortfarande
  // följas ovan för att hitta nästa nod, men markeras inte själva. Det gör
  // också att avslutade/historiska slutspel blir helt fria från prognos-
  // markeringar utan någon särskild årsregel.
  return new Set([...relevant].filter((id) => {
    const match = matchesById.get(id);
    return match && !(match.res && match.res.fin);
  }));
}

export function svOrdinal(place) {
  return place + (place === 1 ? ":a" : place === 2 ? ":a" : ":e");
}

function playoffPlacementBlock(div, cat) {
  const ranking = playoffPlacementRows(div);
  return h("section", { class: "table-box playoff-placement-box" },
    h("h3", null, div.name),
    h("p", { class: "muted" }, ranking.total + " lag i slutspelet. " +
      "Lag utan placeringsmatch delar placering med övriga lag som slogs ut i samma omgång."),
    h("table", { class: "standings playoff-placement-table" },
      h("thead", null, h("tr", null,
        h("th", null, "Placering"), h("th", { class: "l" }, "Lag"),
        h("th", { class: "l" }, "Resultat"))),
      h("tbody", null, ranking.rows.map((row) => h("tr", {
        class: isClubName(row.team.name) ? "us" : "",
      },
        h("td", { class: "pts" }, row.place == null ? "–" :
          (row.shared ? "Delad " : "") + svOrdinal(row.place)),
        h("td", { class: "l" }, row.lastMatch && row.team.id != null
          ? h("button", {
              class: "team-link", type: "button",
              title: "Visa " + row.team.name + "s lagkort",
              onclick: () => openTeamQuickView({
                ...row.lastMatch,
                catId: row.lastMatch.catId || cat.catId,
                catName: row.lastMatch.catName || cat.catName,
                divId: row.lastMatch.divId || div.id,
                divName: row.lastMatch.divName || div.name,
                divType: "Playoff",
                edition: row.lastMatch.edition || cat.edition || null,
              }, row.team),
            }, row.team.name)
          : row.team.name),
        h("td", { class: "l muted" }, row.reason))))));
}

export function playoffPlacementForTeam(match, team) {
  const targetKey = playoffTeamKey(team);
  if (!targetKey) return null;
  const edition = match.edition || null;
  let divisions = [];
  const loaded = state.playoffs[match.catId];
  if (loaded && loaded.status === "done") divisions = loaded.divisions || [];
  if (!divisions.length) {
    divisions = groupPlayoffDivisionsById(allActiveMatches().filter((candidate) =>
      candidate.catId === match.catId && candidate.divType === "Playoff" &&
      (candidate.edition || null) === edition));
  }
  // Kom lagkortet från en slutspelsmatch vet vi exakt vilket träd som
  // avses. Från en gruppmatch hittar vi det träd laget senare hamnade i.
  const candidates = match.divType === "Playoff"
    ? divisions.filter((div) => String(div.id) === String(match.divId)) : divisions;
  for (const div of candidates) {
    const ranking = playoffPlacementRows(div);
    const row = ranking.rows.find((entry) => entry.key === targetKey);
    if (row && row.place != null) return { ...row, total: ranking.total, divName: div.name };
  }
  return null;
}

// Sortering av den avancerade slutspelstabellen — delad mellan alla
// synliga A-/B-/C-tabeller (session, sparas ej). null = trädets naturliga
// omgångsordning (tidigast→final); annars {col, dir}.
let bracketSort = null;

export function getBracketSort() {
  return bracketSort;
}

export function setBracketSort(value) {
  bracketSort = value;
}

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
function bracketTableBlock(div, projMap, relevantIds) {
  const allRows = groupPlayoffRounds(div).flatMap(([, ms]) => ms);
  const { visible: splitRows, hiddenCount } = splitRecentPlayedByCount(
    allRows, state.recentMatchCount, state.showAllPlayedBracket ? Infinity : 0);
  // splitRecentPlayedByCount sorterar alltid kronologiskt stigande internt
  // (för att avgöra äldst/nyast) — den egentliga sorteringen (bracketSort,
  // eller naturlig omgångsordning) måste därför läggas på EFTER, annars
  // skrivs den över och kolumnklick/riktningsbyten ser ut att inte ha
  // någon effekt.
  const rows = bracketSort ? sortBracketRows(splitRows) : [...splitRows].sort((a, b) =>
    state.playoffTimeOrder === "asc" ? a.start - b.start : b.start - a.start);
  const headerCell = (label, col, wide) => {
    const active = bracketSort ? bracketSort.col === col : col === "tid";
    return h("th", {
      class: (wide ? "l " : "") + "bracket-th-sort" + (active ? " on" : ""),
      role: "button", tabindex: "0",
      onclick: () => {
        if (bracketSort && bracketSort.col === col) { bracketSort.dir *= -1; }
        else { bracketSort = { col, dir: 1 }; }
        if (col === "tid") {
          state.playoffTimeOrder = bracketSort.dir > 0 ? "asc" : "desc";
          saveUi();
        }
        renderContent();
      },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); }
      },
    }, label, active ? h("span", { class: "sort-arrow" },
      bracketSort ? (bracketSort.dir > 0 ? " ▲" : " ▼")
        : (state.playoffTimeOrder === "asc" ? " ▲" : " ▼")) : null);
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
        const homeSide = proj ? proj.home : { name: m.home.name || "TBD", certain: true };
        const awaySide = proj ? proj.away : { name: m.away.name || "TBD", certain: true };
        const homeName = homeSide.name, awayName = awaySide.name;
        return h("tr", {
          class: "bracket-table-row" + (isClubMatch(m) ? " us" : "") +
            (proj && proj.predicted ? " predicted-match" : "") +
            (relevantIds && relevantIds.has(m.id) ? " relevant-path" : ""),
          role: "button", tabindex: "0",
          onclick: () => openMatchDialog(m),
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchDialog(m); }
          },
        },
          h("td", { class: "l" },
            relevantIds && relevantIds.has(m.id)
              ? h("span", { class: "bracket-relevance-inline", title: "Möjlig väg för vald klubb eller favoritlag" }, "★ ")
              : null,
            m.roundName || ""),
          h("td", null, m.matchNr || "–"),
          h("td", { class: "l" },
            h("span", {
              class: (isClubName(homeName) ? "us " : "") +
                (homeSide.certain === false ? "predicted" : ""),
            }, playoffTeamNameNode(homeSide)),
            " – ",
            h("span", {
              class: (isClubName(awayName) ? "us " : "") +
                (awaySide.certain === false ? "predicted" : ""),
            }, playoffTeamNameNode(awaySide))),
          h("td", { class: "pts" }, proj && proj.predicted ? "Prognos" : (sc || "–")),
          h("td", null, matchTimeLabel(m)),
          h("td", null, m.arena || ""));
      }))),
    showAllPlayedButtonCount(hiddenCount, state.recentMatchCount, () => {
      state.showAllPlayedBracket = true; renderContent();
    }));
}

export function renderPlayoffs(main) {
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
  const catLabel = (c) => c.catName +
    (state.years.size ? " · " + (c.edition || cup().edition) : "");
  const catTabLabel = (c) => cohortKey(c.catName) || shortCat(c.catName) || c.catName;
  const playoffCatButtons = () => cats.length > 1 ? cats.map((c) => h("button", {
    class: "table-group-tab" + (c.catId === selCat.catId ? " on" : ""),
    type: "button", role: "tab", "aria-selected": String(c.catId === selCat.catId),
    title: catLabel(c), "aria-label": catLabel(c),
    onclick: () => { state.playoffCatTab = c.catId; renderContent(); },
  }, catTabLabel(c))) : [];
  if (cats.length > 1) renderSelectionBar(playoffCatButtons(), "slutspel");
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

    // Träd/Tabell/Placering-växlaren och zoomen (tabelläget hålls även i
    // synk med inställningens äldre kryssruta) delar rad
    // med A-/B-/C-Slutspel-flikarna i stället för att ligga på en egen
    // rad ovanför — en tunn vertikal avdelare (.row-sep, bara när det
    // faktiskt finns flikar att skilja från) visar att de hör till en
    // annan kategori, utan att pressas hela vägen till högerkanten.
    main.append(h("div", { class: "row playoff-tabs-row" }, divTabs, divTabs ? h("span", { class: "row-sep" }) : null,
      h("div", { class: "seg-group" },
        h("div", { class: "seg", role: "group", "aria-label": "Slutspelsvy" },
          chip("Träd", state.playoffView === "tree", () => {
            state.playoffView = "tree"; state.advancedPlayoffTable = false;
            saveSettings(); renderContent();
          }),
          chip("Tabell", state.playoffView === "table", () => {
            state.playoffView = "table"; state.advancedPlayoffTable = true;
            saveSettings(); renderContent();
          }),
          chip("Placering", state.playoffView === "placement", () => {
            state.playoffView = "placement"; state.advancedPlayoffTable = false;
            saveSettings(); renderContent();
          })),
        // Zoom är bara meningsfull i trädvyn — tabellen radbryter/scrollar
        // redan naturligt och behöver ingen skalning.
        state.playoffView === "tree" ? h("div", { class: "seg bracket-zoom", role: "group", "aria-label": "Zoom" },
          h("button", {
            class: "chip", type: "button", "aria-label": "Zooma ut",
            disabled: state.bracketZoom <= 0.2 ? "" : null,
            onclick: () => { state.bracketZoom = Math.max(0.2, +(state.bracketZoom - 0.2).toFixed(2)); renderContent(); },
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

    if (state.playoffView !== "placement") main.append(h("div", {
      class: "playoff-display-options", role: "group", "aria-label": "Visning i slutspel",
    },
      h("label", { class: "playoff-display-toggle" },
        h("input", {
          type: "checkbox", ...(state.showPlayoffPath ? { checked: "" } : {}),
          onchange: (e) => {
            state.showPlayoffPath = e.target.checked; saveSettings(); renderContent();
          },
        }),
        h("span", null, "Möjlig väg")),
      h("label", { class: "playoff-display-toggle" },
        h("input", {
          type: "checkbox", ...(state.showPlayoffProjection ? { checked: "" } : {}),
          onchange: (e) => {
            state.showPlayoffProjection = e.target.checked; saveSettings(); renderContent();
          },
        }),
        h("span", null, "Visa lagnamn"))));

    // Prognosen bygger på ÄNNU OSPELADE mötens sannolika utgång och är
    // bara meningsfull för innevarande upplaga.
    let gd = null;
    if (state.showPlayoffProjection && !c.edition) {
      ensureGroupTables(c.catId);
      const gt = state.groupTables[c.catId];
      if (gt && gt.status === "done") gd = gt;
    }
    // Även medan grupptabellerna laddas (eller för historiska år) kan
    // redan färdigspelade matarmatcher ersätta "Vinnare match" med det
    // verkliga laget, därför byggs kartan även när gd ännu är null.
    const projMap = state.showPlayoffProjection
      ? buildPlayoffProjection(selDiv, gd) : null;
    const relevantIds = state.showPlayoffPath
      ? relevantPlayoffMatchIds(selDiv, c.catId, c.edition) : new Set();
    if (state.showPlayoffProjection && !c.edition && state.groupTables[c.catId] &&
        state.groupTables[c.catId].status === "loading") {
      main.append(h("p", { class: "muted" }, "Hämtar grupptabeller för lagnamnen …"));
    }
    if (relevantIds.size) main.append(h("p", { class: "muted playoff-relevance-note" },
      "★ Markerat visar en möjlig slutspelsväg för vald klubb eller dina favoritlag."));
    if (state.playoffView === "placement") {
      main.append(playoffPlacementBlock(selDiv, c));
    } else if (state.playoffView === "table") {
      main.append(bracketTableBlock(selDiv, projMap, relevantIds));
    } else {
      const box = bracketBlock(selDiv, projMap, null, relevantIds);
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

// Greppa-och-dra-panorering och pinch-zoom i slutspelsträdet:
// .bracket-box scrollar redan
// vågrätt (overflow-x:auto) och sidan lodrätt som vanligt, men bara via
// scrollbar/hjul/touch. De delegerade lyssnarna sätts upp en gång, inte per
// rendering. Musen får "greppa kartan" och två fingrar zoomar bara trädet
// (inte hela webbsidan) kring punkten mitt emellan fingrarna.
export function setupBracketPan() {
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
    // Självläkande: släpper man musknappen UTANFÖR webbläsarfönstret
    // (t.ex. drar uppåt förbi fliksraden, eller alt-tabbar mitt i draget)
    // når varken pointerup eller pointercancel någonsin document — dragging
    // skulle annars fastna på true för gott, och VARJE senare musrörelse
    // (på VILKEN flik som helst, detta är en global lyssnare) skulle då
    // fortsätta tvinga scrollpositionen tillbaka till startScrollY-dy och
    // e.preventDefault() — upplevs som att sidan "låst sig" och inte går
    // att scrolla, även långt efter man lämnat slutspelsträdet. e.buttons
    // === 0 (ingen knapp nertryckt) är den tillförlitliga signalen om att
    // en pointerup missades, se window "blur" nedan för ett andra skydd.
    if (e.buttons === 0) { endDrag(); return; }
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
    // b: lokal kopia — box nollställs längre ner INNAN setTimeout-callbacken
    // hinner köra, annars kraschar den (box.removeEventListener på null).
    const b = box;
    if (b) {
      b.classList.remove("panning");
      if (moved) {
        // Sväljer klicket efter en drag så matchkortet under muspekaren
        // inte öppnas som om man klickat det.
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        b.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => b.removeEventListener("click", swallow, { capture: true }), 0);
      }
    }
    box = null;
  }
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  // Andra skyddsnätet: tappar webbläsarfönstret fokus mitt i ett drag
  // (alt-tab, klick i ett annat program) utan att musen rört sig igen
  // efteråt hinner e.buttons-kollen ovan aldrig triggas — blur täcker det.
  window.addEventListener("blur", endDrag);

  let pinch = null;
  const touchPair = (touches) => {
    if (touches.length < 2) return null;
    const a = touches[0], b = touches[1];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    };
  };
  const syncBracketZoomControls = () => {
    const controls = $$(".bracket-zoom .chip");
    if (controls.length < 3) return;
    controls[0].disabled = state.bracketZoom <= 0.2;
    controls[1].textContent = Math.round(state.bracketZoom * 100) + "%";
    controls[2].disabled = state.bracketZoom >= 3;
  };
  const endPinch = () => {
    if (!pinch) return;
    state.bracketZoom = +state.bracketZoom.toFixed(2);
    if (pinch.row.isConnected) pinch.row.style.zoom = state.bracketZoom;
    pinch.box.classList.remove("pinching");
    document.documentElement.classList.remove("bracket-pinching");
    syncBracketZoomControls();
    pinch = null;
  };
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2 || pinch) return;
    const target = e.target instanceof Element ? e.target : null;
    const pinchBox = target && target.closest(".bracket-box");
    const row = pinchBox && pinchBox.closest(".bracket-row");
    const pair = touchPair(e.touches);
    if (!pinchBox || !row || !pair || pair.distance < 1) return;
    const zoom = state.bracketZoom;
    const boxRect = pinchBox.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    pinch = {
      box: pinchBox,
      row,
      startZoom: zoom,
      startDistance: pair.distance,
      // ScrollLeft uttrycks i trädets oskalade CSS-pixlar. Dessa ankare gör
      // att samma punkt i trädet ligger kvar mellan fingrarna även när de
      // samtidigt flyttas i sid- eller höjdled under nypgesten.
      anchorX: pinchBox.scrollLeft + (pair.x - boxRect.left) / zoom,
      anchorY: (pair.y - rowRect.top) / zoom,
    };
    pinchBox.classList.add("pinching");
    document.documentElement.classList.add("bracket-pinching");
    // Stoppa Safaris/Chromes sidzoom först när två fingrar faktiskt ligger
    // på trädet; vanlig enfingersscroll lämnas helt orörd.
    e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("touchmove", (e) => {
    if (!pinch) return;
    const pair = touchPair(e.touches);
    if (!pair) { endPinch(); return; }
    e.preventDefault();
    const zoom = Math.max(0.2, Math.min(3,
      pinch.startZoom * pair.distance / pinch.startDistance));
    state.bracketZoom = zoom;
    pinch.row.style.zoom = zoom;

    const boxRect = pinch.box.getBoundingClientRect();
    pinch.box.scrollLeft = pinch.anchorX - (pair.x - boxRect.left) / zoom;
    const rowRect = pinch.row.getBoundingClientRect();
    const anchorViewportY = rowRect.top + pinch.anchorY * zoom;
    window.scrollBy(0, anchorViewportY - pair.y);
    syncBracketZoomControls();
  }, { passive: false, capture: true });
  document.addEventListener("touchend", (e) => {
    if (pinch && e.touches.length < 2) endPinch();
  }, { capture: true });
  document.addEventListener("touchcancel", endPinch, { capture: true });

  // iOS Safari har ett äldre, separat gesture*-flöde för sidans nypzoom.
  // touch-action + preventDefault på touchmove räcker i Chromium, men
  // Safari kan annars hinna skala den visuella viewporten parallellt med
  // trädet. Blockera bara gesture-flödet som startade inne i trädet så
  // användaren fortfarande kan nypzooma resten av appen vid behov.
  let browserGestureOnBracket = false;
  document.addEventListener("gesturestart", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    browserGestureOnBracket = !!pinch || !!(target && target.closest(".bracket-box"));
    if (browserGestureOnBracket) e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("gesturechange", (e) => {
    if (browserGestureOnBracket) e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("gestureend", (e) => {
    if (browserGestureOnBracket) e.preventDefault();
    browserGestureOnBracket = false;
  }, { passive: false, capture: true });
}


