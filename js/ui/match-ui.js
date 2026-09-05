/* match-ui.js — hero, matchkort och matchdialoger. */

import { h, $ } from "../dom.js";
import { isLive, scoreText, periodScores } from "../domain/match.js";
import {
  hasScheduledStart, matchTimeLabel, fmtDay, fmtDayLong, fmtClock,
} from "../time.js";
import { cohortKey, cohortLabel, shortCat } from "../domain/category.js";

let state, cup, render, renderContent, saveSettings, markClubChosen;
let renderFavoriteTeamList, isClubName, isClubMatch, isFavoriteTeam;
let favoriteTeamIndex, teamColor, cardTintColor, calendarWebcalUrl, rosterFor;
let computeGroupTableRows, gotoTeamMatches, filterByArena;
let playoffPlacementForTeam, svOrdinal, playoffGroupReference, ensureGroupTables, scoped;
let allActiveMatches, outcomeLetter, slugifySv;

export function initMatchUi(deps) {
  ({
    state, cup, render, renderContent, saveSettings, markClubChosen,
    renderFavoriteTeamList, isClubName, isClubMatch, isFavoriteTeam,
    favoriteTeamIndex, teamColor, cardTintColor, calendarWebcalUrl, rosterFor,
    computeGroupTableRows, gotoTeamMatches, filterByArena,
    playoffPlacementForTeam, svOrdinal, playoffGroupReference, ensureGroupTables, scoped,
    allActiveMatches, outcomeLetter, slugifySv,
  } = deps);
}

const HERO_MAX = 5;
let heroIndex = 0;
let heroAutoTimer = null;
const HERO_AUTO_MS = 6000;
let heroDir = 1;
let heroLastAnimatedIdx = null;
let dialogTableCache = {};

export function resetMatchUi() {
  heroIndex = 0;
  heroDir = 1;
  heroLastAnimatedIdx = null;
  dialogTableCache = {};
  clearInterval(heroAutoTimer);
  heroAutoTimer = null;
}

export function matchUiSnapshot() {
  return {
    heroIndex,
    heroDir,
    heroLastAnimatedIdx,
    dialogTables: Object.keys(dialogTableCache).length,
    heroTimer: heroAutoTimer,
  };
}

export function nextClubMatches() {
  const now = Date.now();
  const hasFav = state.favoriteTeams.length > 0;
  const pool = state.matches.filter((m) => {
    if (hasFav) {
      if (!isFavoriteTeam(m.home.name, m.catName) &&
          !isFavoriteTeam(m.away.name, m.catName)) return false;
    } else if (!isClubMatch(m)) return false;
    if (state.teams.size && !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
    if (state.cats.size && !state.cats.has(m.catId)) return false;
    return !(m.res && m.res.fin) && hasScheduledStart(m) && m.start >= now - 30 * 60000;
  });
  return pool.sort((a, b) => a.start - b.start ||
    (a.arena || "").localeCompare(b.arena || "", "sv", { numeric: true })).slice(0, HERO_MAX);
}

export function countdownText(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return "nu";
  const min = Math.round(diff / 60000);
  if (min < 60) return "om " + min + " min";
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return "om " + hrs + " h " + (min % 60) + " min";
  return "om " + Math.floor(hrs / 24) + " d";
}

export function tickHeroCountdown() {
  const el = $(".hero-count");
  const matches = nextClubMatches();
  const m = matches[heroIndex] || matches[0];
  if (el && m) el.textContent = countdownText(m.start);
}

export function renderHero(main) {
  clearInterval(heroAutoTimer);
  if (!state.showUpcomingCarousel) return;
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
  const heroEl = h("details", {
    class: "hero" + (carousel ? " hero-carousel" : ""), id: "hero",
    ...(state.heroMinimized ? {} : { open: "" }),
  },
    h("button", {
      class: "hero-close", type: "button", "aria-label": "Dölj kommande matcher",
      onclick: (event) => {
        event.preventDefault(); event.stopPropagation();
        state.showUpcomingCarousel = false;
        saveSettings(); renderContent();
      },
    }, "×"),
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
      class: "hero-card" + (isNewCard ? (heroDir < 0 ? " hero-card-prev" : " hero-card-next") : ""),
    },
      h("div", { class: "hero-teams" },
        h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name,
          isFavoriteTeam(m.home.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null),
        h("span", { class: "vs" }, live && scoreText(m.res) ? scoreText(m.res) : "mot"),
        h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name,
          isFavoriteTeam(m.away.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null)),
      h("div", { class: "hero-info" },
        matchTimeLabel(m, fmtDayLong), h("span", { class: "dot" }, "·"), m.arena || "plan ej satt",
        h("span", { class: "dot" }, "·"), shortCat(m.catName) + (m.divName ? " " + m.divName : ""),
        (() => {
          const w = hasScheduledStart(m) ? HB.weather.at(HB.weather.cached(cup()), m.start) : null;
          return w ? [h("span", { class: "dot" }, "·"), w.icon + " " + w.temp + "°"] : null;
        })())),
    carousel ? h("div", { class: "hero-dots" }, matches.map((_, i) => h("button", {
      class: "hero-dot" + (i === heroIndex ? " on" : ""), type: "button",
      "aria-label": "Match " + (i + 1) + " av " + matches.length, onclick: () => goTo(i),
    }))) : null);
  heroEl.addEventListener("toggle", () => { state.heroMinimized = !heroEl.open; });
  main.append(heroEl);
  if (!carousel) return;

  const startHeroAuto = () => {
    clearInterval(heroAutoTimer);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    heroAutoTimer = setInterval(() => {
      if (state.view !== "schema") { clearInterval(heroAutoTimer); return; }
      if (document.visibilityState === "visible") step(1);
    }, HERO_AUTO_MS);
  };
  startHeroAuto();
  heroEl.addEventListener("mouseenter", () => clearInterval(heroAutoTimer));
  heroEl.addEventListener("mouseleave", startHeroAuto);
  heroEl.addEventListener("focusin", () => clearInterval(heroAutoTimer));
  heroEl.addEventListener("focusout", (e) => {
    if (!heroEl.contains(e.relatedTarget)) startHeroAuto();
  });
  let touchX = null, touchY = null;
  heroEl.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  heroEl.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
}

function teamMatchCounts(teamId) {
  let played = 0, upcoming = 0;
  for (const m of state.matches) {
    if (m.home.id !== teamId && m.away.id !== teamId) continue;
    if (m.res && m.res.fin) played++; else upcoming++;
  }
  return { total: played + upcoming, played, upcoming };
}

function findTableRow(rows, team) {
  return rows.find((r) => r.teamId === team.id) || rows.find((r) => r.name === team.name);
}

export function closeMatchDialog() {
  const dlg = $(".match-dialog");
  if (dlg) dlg.close();
}

// Modalt i BÅDA lägena. På mobil öppnades dialogen tidigare icke-modalt, för
// att den fasta bottenmenyn skulle synas ovanför den. Sedan menyn flyttade
// till toppen betyder samma sak att menyn lägger sig mitt i dialogen — och
// topplagret som showModal ger löser dessutom scroll bakom, fokusfälla och
// Escape utan en rad egen kod.
function showMatchDialog(dlg) {
  dlg.showModal();
}

function rosterBlock(team, edition) {
  if (!cup().hasRosters) return null;
  const players = rosterFor(team, edition);
  if (!players.length) return null;
  const sorted = [...players].sort((a, b) =>
    (a.shirtNr == null ? 999 : a.shirtNr) - (b.shirtNr == null ? 999 : b.shirtNr));
  return h("div", { class: "team-roster" }, h("h4", null, "Trupp"),
    h("ul", { class: "team-roster-list" }, sorted.map((p) => h("li", null,
      h("span", { class: "roster-nr" }, p.shirtNr != null ? String(p.shirtNr) : "–"),
      h("span", { class: "roster-name" }, p.name),
      p.position ? h("span", { class: "roster-pos" }, p.position) : null,
      p.goals ? h("span", { class: "roster-goals" }, p.goals + " mål") : null))));
}

function favoriteTeamToggle(team, catName) {
  const name = (team.name || "").trim();
  if (!name) return null;
  const cohort = cohortKey(catName);
  const btn = h("button", { class: "btn small", type: "button" });
  const label = name + (cohort ? " (" + cohortLabel(catName) + ")" : "");
  const sync = () => {
    const on = favoriteTeamIndex(name, cohort) >= 0;
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★ Favoritlag" : "☆ Gör till favoritlag";
    btn.title = on ? "Ta bort " + label + " ur dina favoritlag"
      : "Lägg till " + label + " bland dina favoritlag — det får en ⭐ i schemat";
  };
  btn.addEventListener("click", () => {
    const i = favoriteTeamIndex(name, cohort);
    if (i >= 0) state.favoriteTeams.splice(i, 1);
    else state.favoriteTeams.push({ name, cohort });
    if (i < 0 && team.club && team.club.trim()) {
      state.favoriteClub = team.club.trim(); markClubChosen();
    }
    saveSettings(); renderFavoriteTeamList();
    const clubField = $("#favoriteClubInput");
    if (clubField) clubField.value = state.favoriteClub;
    sync(); render();
  });
  sync();
  return btn;
}

function teamStatBlock(m, team, side) {
  const counts = teamMatchCounts(team.id);
  const statLine = h("p", { class: "muted team-stat-line" }, "Hämtar tabellplacering …");
  const placement = playoffPlacementForTeam(m, team);
  const playoffLine = placement ? h("p", { class: "team-playoff-placement" },
    (placement.shared ? "Delad " : "") + svOrdinal(placement.place) + " plats av " + placement.total +
    " lag i " + placement.divName + (placement.place === 1 ? " · Guld" :
      placement.place === 2 ? " · Silver" : placement.place === 3 ? " · Brons" : "") + ".") : null;
  const calUrl = calendarWebcalUrl(team);
  const box = h("div", { class: "team-stat-block" },
    h("h3", { class: isClubName(team.name) ? "us" : "" }, team.name), playoffLine, statLine,
    h("p", { class: "muted" }, counts.total + " matcher totalt · " + counts.played +
      " spelade · " + counts.upcoming + " kommande"),
    h("div", { class: "team-stat-actions" },
      h("button", { class: "btn small", type: "button", disabled: counts.upcoming === 0 ? "" : null,
        onclick: () => gotoTeamMatches(team, "upcoming") }, "Kommande matcher"),
      h("button", { class: "btn small", type: "button", disabled: counts.played === 0 ? "" : null,
        onclick: () => gotoTeamMatches(team, "played") }, "Spelade matcher"),
      calUrl ? h("a", { class: "btn small", href: calUrl, rel: "noopener",
        title: "Öppnar din kalenderapp och prenumererar på lagets matcher — nya/ändrade tider uppdateras sen automatiskt (funkar bäst på mobil)." },
      "📅 Prenumerera") : null, favoriteTeamToggle(team, m.catName)), rosterBlock(team, m.edition));
  if (!m.divId) { statLine.textContent = "Ingen tabell tillgänglig för den här klassen."; return box; }
  ensureDialogTable(m.divId).then((rows) => {
    if (!rows.length) { statLine.textContent = "Ingen tabell tillgänglig för den här gruppen."; return; }
    const idx = rows.findIndex((r) => r === findTableRow(rows, team));
    if (idx < 0) { statLine.textContent = "Laget hittades inte i gruppens tabell."; return; }
    const r = rows[idx];
    statLine.textContent = "#" + (idx + 1) + " i " + m.divName + " · " + r.played + " S, " +
      r.won + "V–" + r.tied + "O–" + r.lost + "F · " + r.gf + "–" + r.ga + " · " + r.points + " p";
  });
  return box;
}

function ensureDialogTable(divId) {
  if (!dialogTableCache[divId]) {
    const official = HB.api.snapshotTable(cup(), divId);
    dialogTableCache[divId] = Promise.resolve(official.length ? official :
      computeGroupTableRows(state.matches.filter((m) => m.divId === divId)));
  }
  return dialogTableCache[divId];
}

function previousMeetingsBlock(m) {
  const a = m.home && m.home.id, b = m.away && m.away.id;
  const meetings = (a == null || b == null) ? [] : state.matches.filter((pm) => {
    if (pm.id === m.id || !pm.res || !pm.res.fin) return false;
    const ph = pm.home && pm.home.id, pa = pm.away && pm.away.id;
    return (ph === a && pa === b) || (ph === b && pa === a);
  }).sort((x, y) => y.start - x.start);
  if (!meetings.length) return null;
  return h("div", { class: "prev-meetings" }, h("h4", null, "Tidigare möten"),
    h("ul", { class: "prev-meetings-list" }, meetings.map((pm) => h("li", null,
      matchTimeLabel(pm, fmtDay) + ": " + pm.home.name + " " + (scoreText(pm.res) || "–") + " " + pm.away.name))));
}

// ETT ark för en match, med flikar. Tidigare fanns tre olika dialoger med
// tre olika utseenden: matchen (full rubrik), laget (ingen rubrik alls, bara
// ett statistikblock) och planen (egen rubrik plus en filterknapp). De nås
// från samma matchkort och handlar om samma match, men såg ut att komma från
// tre olika appar — och man kunde inte gå mellan dem utan att backa ut först.
//
// Nu: samma rubrik i alla lägen, så man alltid vet vilken match man är inne
// i, och flikar för hemmalag, bortalag och plan. Ingången avgör bara vilken
// flik som är förvald.
function matchSheetHeader(m) {
  const sc = scoreText(m.res);
  const sida = (team, motpart) => h("div", {
    class: "match-sheet-team" +
      (isClubName(team.name) ? " us" : "") +
      (m.res && m.res.fin && m.res.winner &&
        ((m.res.winner === "home") === (team === m.home)) ? " won" : ""),
  }, h("span", { class: "match-sheet-team-name" }, team.name));
  return h("div", { class: "match-sheet-head" },
    h("p", { class: "match-sheet-eyebrow" },
      [shortCat(m.catName), m.divName, m.roundName].filter(Boolean).join(" · ")),
    h("div", { class: "match-sheet-score-row" },
      h("div", { class: "match-sheet-teams" }, sida(m.home), sida(m.away)),
      sc ? h("div", { class: "match-sheet-score" }, sc) : null),
    periodRad(m.res),
    h("p", { class: "match-sheet-when" },
      [hasScheduledStart(m) ? matchTimeLabel(m, fmtDayLong) : "Tid ej satt",
        m.arena].filter(Boolean).join(" · ")));
}

// Två perioder är en handbollsmatch — då är första perioden helt enkelt
// halvtidsställningen, och det är så man pratar om den. Fler perioder är
// basket eller beachhandboll; där säger uppdelningen mer än en etikett.
function periodRad(res) {
  const perioder = periodScores(res);
  if (!perioder.length) return null;
  const delar = perioder.map((p) => p.h + "–" + p.a);
  return h("p", { class: "match-sheet-periods" },
    perioder.length === 2
      ? "Halvtid " + delar[0]
      : "Perioder " + delar.join(" · "));
}

function arenaTabBody(m, stäng) {
  const arena = m.arena;
  const matcher = state.matches
    .filter((x) => x.arena === arena)
    .sort((a, b) => a.start - b.start);
  return h("div", { class: "match-sheet-body" },
    h("p", { class: "muted" }, matcher.length + " matcher på " + arena),
    h("button", {
      class: "btn small", type: "button",
      onclick: () => { stäng(); filterByArena(arena); },
    }, "Filtrera schemat till " + arena),
    h("div", { class: "arena-quick-list" }, matcher.map(matchCard)));
}

export function openMatchSheet(m, förvaldFlik) {
  const flikar = [
    { key: "home", label: m.home.name, body: () => teamStatBlock(m, m.home, "home") },
    { key: "away", label: m.away.name, body: () => teamStatBlock(m, m.away, "away") },
  ];
  if (m.arena) {
    flikar.push({ key: "arena", label: m.arena, body: () => arenaTabBody(m, () => dlg.close()) });
  }
  // Är ett av lagen din klubb är det nästan alltid det du är ute efter.
  const klubbFlik = isClubName(m.home.name) ? "home"
    : isClubName(m.away.name) ? "away" : null;
  let aktiv = flikar.some((f) => f.key === förvaldFlik)
    ? förvaldFlik : (klubbFlik || "home");

  const kropp = h("div", { class: "match-sheet-tabbody" });
  const tabbrad = h("div", {
    class: "match-sheet-tabs", role: "tablist",
    "aria-label": "Lag och plan för matchen",
  });
  const rita = () => {
    tabbrad.replaceChildren(...flikar.map((f) => h("button", {
      class: "match-sheet-tab" + (f.key === aktiv ? " on" : ""),
      type: "button", role: "tab", "aria-selected": String(f.key === aktiv),
      title: f.label,
      onclick: () => { aktiv = f.key; rita(); },
    }, f.label)));
    const vald = flikar.find((f) => f.key === aktiv) || flikar[0];
    kropp.replaceChildren(vald.body());
  };

  const dlg = h("dialog", { class: "match-dialog match-sheet" },
    h("div", { class: "match-sheet-bar" },
      h("button", {
        class: "match-sheet-back", type: "button",
        onclick: () => dlg.close(),
      }, "Tillbaka"),
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×")),
    matchSheetHeader(m),
    playoffSourceGroupsBlock(m), previousMeetingsBlock(m),
    tabbrad, kropp);
  rita();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); showMatchDialog(dlg);
  return dlg;
}

// Ingångarna från matchkorten pekar alla på samma ark — bara förvald flik
// skiljer dem åt.
export function openTeamQuickView(m, team) {
  openMatchSheet(m, m.away && team && m.away.id === team.id ? "away" : "home");
}

export function openArenaQuickView(m, arena) {
  // Bakåtkompatibelt: äldre anrop skickade bara arenanamnet. Då finns ingen
  // match att sätta rubrik på, så vi plockar den första på planen.
  if (typeof m === "string") {
    const namn = m;
    const första = state.matches.find((x) => x.arena === namn);
    if (!första) return;
    openMatchSheet(första, "arena");
    return;
  }
  openMatchSheet(m, "arena");
  void arena;
}

export function openMatchLogDialog() {
  const matches = scoped().slice().sort((a, b) => b.start - a.start);
  const dataTs = HB.api.localDataTs[state.cupId];
  const fetchedLabel = dataTs ? "Data hämtad " + new Intl.DateTimeFormat("sv-SE", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(dataTs)) : "Uppdaterad " + fmtDayLong.format(new Date(state.loadedAt)) +
    " " + fmtClock.format(new Date(state.loadedAt));
  const dlg = h("dialog", { class: "match-dialog history-dialog" });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  const openMatch = (m) => { dlg.close(); openMatchDialog(m); };
  const makeRow = (m) => h("tr", {
    class: "sortable-row-clickable", role: "button", tabindex: "0", onclick: () => openMatch(m),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatch(m); } },
  }, h("th", { class: "l", scope: "row" }, matchTimeLabel(m, fmtDay)),
  h("td", { class: "l" }, shortCat(m.catName)), h("td", { class: "l" }, m.home.name),
  h("td", { class: "l" }, m.away.name), h("td", null, scoreText(m.res) || "–"));
  const BATCH = 50;
  let shown = 0;
  const tbody = h("tbody", null);
  const moreWrap = h("div", { class: "match-log-more" });
  function addRows(count) {
    const to = Math.min(shown + count, matches.length);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < to; i++) frag.append(makeRow(matches[i]));
    tbody.append(frag); shown = to; renderMore();
  }
  function renderMore() {
    moreWrap.replaceChildren();
    const remaining = matches.length - shown;
    if (remaining <= 0) {
      if (matches.length > BATCH) moreWrap.append(h("span", { class: "muted" }, "Visar alla " + matches.length + "."));
      return;
    }
    moreWrap.append(h("span", { class: "muted" }, "Visar " + shown + " av " + matches.length + " · "),
      h("button", { class: "btn small", type: "button", onclick: () => addRows(BATCH) },
        "Visa fler (" + remaining + " kvar)"),
      remaining > BATCH ? h("button", { class: "btn small", type: "button",
        onclick: () => addRows(matches.length) }, "Visa alla") : null);
  }
  dlg.append(
    h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng", onclick: () => dlg.close() }, "×"),
    h("div", { class: "match-dialog-head" }, h("span", { class: "cat" }, "Matcher i vyn"),
      h("span", null, cup().name), h("span", { class: "muted" }, fetchedLabel + " · " + matches.length + " matcher")),
    h("p", { class: "muted match-log-note" },
      "Det här är matcherna som räknas in i antalet högst upp — din nuvarande vy (" +
      (state.scope === "club" ? state.favoriteClub : "hela cupen") +
      "), inte en logg över ändringar. Tidsstämpeln är när schemat senast hämtades från arrangören; för en avslutad cup ändras inget efteråt."),
    matches.length ? h("div", { class: "table-box match-log-table" }, h("table", { class: "standings" },
      h("thead", null, h("tr", null, h("th", { class: "l" }, "Tid"), h("th", { class: "l" }, "Klass"),
        h("th", { class: "l" }, "Hemma"), h("th", { class: "l" }, "Borta"), h("th", null, "Resultat"))), tbody))
      : h("p", { class: "muted" }, "Inga matcher hämtade ännu."), moreWrap);
  if (matches.length) addRows(BATCH);
  showMatchDialog(dlg);
}

function playoffSourceGroupsBlock(match) {
  const byToken = new Map();
  for (const side of [match.home, match.away]) {
    const ref = playoffGroupReference(side && side.name);
    if (!ref) continue;
    if (!byToken.has(ref.token)) byToken.set(ref.token, { ...ref, ranks: new Set() });
    byToken.get(ref.token).ranks.add(ref.rank);
  }
  if (!byToken.size) return null;
  const host = h("section", { class: "playoff-source-groups" }, h("h3", null, "Aktuella grupper"),
    h("p", { class: "muted" }, "Hämtar grupptabeller …"));
  (async () => {
    try {
      const edition = match.edition || null;
      const groupMatches = allActiveMatches().filter((m) => m.catId === match.catId &&
        (m.edition || null) === edition && m.divId != null && m.divType !== "Playoff");
      const divisions = new Map();
      for (const m of groupMatches) if (!divisions.has(m.divId)) divisions.set(m.divId,
        { id: m.divId, name: m.divName || "Grupp" });
      const tokenOf = (name) => {
        const found = /grupp\s+([a-zåäö0-9]+)/i.exec(name || "");
        return found ? slugifySv(found[1]) : "";
      };
      const cards = [];
      for (const ref of byToken.values()) {
        const div = [...divisions.values()].find((candidate) => tokenOf(candidate.name) === ref.token);
        if (!div) continue;
        const rows = edition ? computeGroupTableRows(groupMatches.filter((m) => m.divId === div.id))
          : await ensureDialogTable(div.id);
        if (!rows.length) continue;
        const ranks = [...ref.ranks].sort((a, b) => a - b);
        cards.push(h("div", { class: "playoff-source-table table-box" },
          h("h4", null, div.name || ref.label,
            h("span", { class: "muted" }, " · plats " + ranks.join(", ") + " går till matchen")),
          h("table", { class: "standings" }, h("thead", null, h("tr", null,
            h("th", null, "#"), h("th", { class: "l" }, "Lag"), h("th", null, "S"),
            h("th", null, "+/−"), h("th", null, "P"))),
          h("tbody", null, rows.map((row, index) => h("tr", {
            class: (ranks.includes(index + 1) ? "playoff-source-rank " : "") + (isClubName(row.name) ? "us" : ""),
          }, h("td", null, String(index + 1)), h("td", { class: "l" }, row.name),
          h("td", null, String(row.played)), h("td", null, (row.gf - row.ga > 0 ? "+" : "") + (row.gf - row.ga)),
          h("td", { class: "pts" }, String(row.points))))))));
      }
      if (!host.isConnected) return;
      if (cards.length) host.replaceChildren(h("h3", null, "Aktuella grupper"), ...cards);
      else host.replaceChildren(h("h3", null, "Aktuella grupper"),
        h("p", { class: "muted" }, "Grupptabellerna är inte tillgängliga ännu."));
    } catch {
      if (host.isConnected) host.replaceChildren(h("h3", null, "Aktuella grupper"),
        h("p", { class: "muted" }, "Kunde inte hämta grupptabellerna."));
    }
  })();
  return host;
}

export function openMatchDialog(m) {
  openMatchSheet(m);
}

export function matchCard(m) {
  const sc = scoreText(m.res);
  const live = isLive(m);
  const weather = !cup().indoor && hasScheduledStart(m) && (!m.res || !m.res.fin)
    ? HB.weather.at(HB.weather.cached(cup()), m.start) : null;
  const teamEl = (side) => {
    const color = teamColor(side.name);
    return h("div", {
      class: "team" + (isClubName(side.name) ? " us" : "") +
        (m.res && m.res.fin && m.res.winner && ((m.res.winner === "home") === (side === m.home)) ? " won" : ""),
      ...(side.id ? { role: "button", tabindex: "0",
        onclick: (e) => { e.stopPropagation(); openTeamQuickView(m, side); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); e.stopPropagation(); openTeamQuickView(m, side);
        } } } : {}),
    }, color ? h("span", { class: "team-color-dot", style: "background:" + color }) : null,
    side.name || "–", isFavoriteTeam(side.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null);
  };
  const tint = cardTintColor(m);
  return h("article", {
    class: "match" + (isClubMatch(m) ? " ours" : "") + (tint ? " tinted" : ""),
    style: tint ? "--card-tint:" + tint : null, role: "button", tabindex: "0",
    "aria-label": "Visa lagstatistik för " + m.home.name + " mot " + m.away.name,
    onclick: () => openMatchDialog(m),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchDialog(m); } },
  },
    h("div", { class: "match-head" }, h("span", { class: "cat" }, shortCat(m.catName)),
      (m.edition || (state.years.size ? cup().edition : null))
        ? h("span", { class: "match-year-badge" }, m.edition || cup().edition) : null,
      m.divName ? h("span", { class: "div" }, m.divName) : null,
      m.roundName && m.roundName !== m.divName ? h("span", { class: "div" }, m.roundName) : null,
      outcomeLetter(m) ? h("span", { class: "outcome-badge outcome-" + outcomeLetter(m).toLowerCase() }, outcomeLetter(m)) : null,
      h("span", { class: "match-head-right" },
        m.arena ? h("span", { class: "arena arena-link", role: "button", tabindex: "0",
          title: "Visa alla matcher på " + m.arena,
          onclick: (e) => { e.stopPropagation(); openArenaQuickView(m, m.arena); },
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); e.stopPropagation(); openArenaQuickView(m, m.arena);
          } },
        }, m.arena) : h("span", { class: "arena" }, m.arena)),
      weather ? h("span", { class: "weather", title: weather.temp + "°C" },
        weather.icon, weather.temp + "°") : null),
    h("div", { class: "match-body" }, h("div", { class: "teams" }, teamEl(m.home), teamEl(m.away)),
      h("div", { class: "score" + (live ? " live" : "") + (sc === "spelad" ? " played" : "") +
        (!sc && !live ? " pending" : "") },
      live ? h("span", { class: "live-tag" }, h("span", { class: "live-dot" }), "LIVE") : null,
      sc || (live ? "" : "–"))));
}
