/* reveal.js — delade hjälpare för att visa fler spelade matcher. */

import { h, $ } from "../dom.js";
import { hasScheduledStart } from "../time.js";

let setAutoScrolled = () => {};
let isSchemaView = () => false;

export function initReveal(deps) {
  setAutoScrolled = deps.setAutoScrolled || setAutoScrolled;
  isSchemaView = deps.isSchemaView || isSchemaView;
}

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
export function preserveScrollOnExpand(rerenderFn) {
  setAutoScrolled(true); // hindra renderTimeline() från att scrolla dit SJÄLV också
  rerenderFn();
  if (isSchemaView()) {
    const nl = $("#nowline");
    if (nl) { nl.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

// Visar alltid de N SENAST SPELADE matcherna plus alla ännu ospelade.
// Ett fast timfönster vore opålitligt: matchlängden varierar
// för mycket mellan cuper (korta beachmatcher kontra långa 11-manna-
// matcher) för att t.ex. "senaste 2 tim" ska ge samma antal synliga
// matcher överallt. Visar i stället alltid de N SENAST SPELADE matcherna
// (oavsett hur länge sedan de spelades) plus alla ännu ospelade — man
// ser matchflödet (senaste resultatet + vad som är på gång) lika bra på
// en kort som en lång cup. N styrs av inställningen state.recentMatchCount.
// Ett fönster runt NU: de N senast spelade plus de M nästa kommande.
// Live-matcher och otidsatta (kollapsad panel) räknas inte mot taken —
// de är få, eller redan gömda bakom <details>, och ska inte trängas ut
// av en Åhus-dag med 600 tidsatta kommande.
//
// olderExtra/newerExtra: extra matcher öppnade via "visa fler" (Infinity =
// hela sidan). Bana/slutspel anropar med upcomingCount: Infinity så att
// deras "visa äldre" inte börjar gömma kommande.
export function splitScheduleWindow(list, {
  recentCount = 0, olderExtra = 0, upcomingCount = Infinity, newerExtra = 0,
} = {}) {
  const finished = [];
  const live = [];
  const untimed = [];
  const upcoming = [];
  for (const m of list) {
    if (m.res && m.res.fin) finished.push(m);
    else if (m.res && m.res.live) live.push(m);
    else if (!hasScheduledStart(m)) untimed.push(m);
    else upcoming.push(m);
  }
  finished.sort((a, b) => a.start - b.start);
  upcoming.sort((a, b) => a.start - b.start);
  const keepPast = olderExtra === Infinity ? finished.length : recentCount + olderExtra;
  const past = finished.slice(Math.max(0, finished.length - keepPast));
  const keepFuture = newerExtra === Infinity ? upcoming.length
    : (upcomingCount === Infinity ? upcoming.length : upcomingCount + newerExtra);
  const future = upcoming.slice(0, Math.min(upcoming.length, keepFuture));
  const visible = [...past, ...live, ...untimed, ...future]
    .sort((a, b) => (a.start || 0) - (b.start || 0));
  return {
    visible,
    hiddenPast: finished.length - past.length,
    hiddenFuture: upcoming.length - future.length,
  };
}

export function splitRecentPlayedByCount(list, recentCount, revealExtra) {
  const { visible, hiddenPast } = splitScheduleWindow(list, {
    recentCount, olderExtra: revealExtra, upcomingCount: Infinity,
  });
  return { visible, hiddenCount: hiddenPast };
}

export function showAllPlayedButtonCount(hiddenCount, recentCount, onClick) {
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
function loadMoreMatchButtons(hiddenCount, batchSize, arrow, noun, onLoadMore, onLoadAll) {
  if (!hiddenCount) return null;
  const moreBtn = h("button", {
    class: "btn small show-all-played", type: "button",
    onclick: () => preserveScrollOnExpand(onLoadMore),
  }, arrow + " Visa " + Math.min(batchSize, hiddenCount) + " " + noun + " (" +
    hiddenCount + " till)");
  const allBtn = hiddenCount > batchSize ? h("button", {
    class: "btn small show-all-played", type: "button",
    onclick: () => preserveScrollOnExpand(onLoadAll),
  }, "Visa alla (" + hiddenCount + ")") : null;
  return h("div", { class: "load-more-row" }, moreBtn, allBtn);
}

export function loadMorePlayedButtons(hiddenCount, batchSize, arrow, onLoadMore, onLoadAll) {
  return loadMoreMatchButtons(hiddenCount, batchSize, arrow, "tidigare matcher",
    onLoadMore, onLoadAll);
}

export function loadMoreUpcomingButtons(hiddenCount, batchSize, arrow, onLoadMore, onLoadAll) {
  return loadMoreMatchButtons(hiddenCount, batchSize, arrow, "kommande matcher",
    onLoadMore, onLoadAll);
}

// Två helt olika användningslägen för schemat:
//
//   PÅGÅENDE CUP — man står i hallen och vill veta hur det nyss gick. Då
//   räcker de par senast spelade (state.recentMatchCount); att scrolla
//   förbi femtio avklarade matcher för att hitta den kommande är rent
//   motstånd.
//
//   I EFTERHAND — man går igenom en avslutad cup för att se hur det gick,
//   vilka man mötte, hur det slutade. Då är de spelade matcherna hela
//   poängen, och att klicka fram fyra åt gången är tröttsamt.
//
// Gränsen dras vid en vecka sedan sista matchen. Kortare än så kan cupen
// fortfarande pågå (eller nyss ha avslutats, då man ännu kollar resultat
// löpande); längre än så är man där för historiken.
export const SCHEMA_RETRO_DAYS = 7;
export const SCHEMA_RETRO_BATCH = 20;
// Kommande matcher i schemat: ett fast fönster, inte hela Åhus-dagen
// (600+ kort). Samma storlek som retro-batchen — 10–20 är överskådligt
// i en lista, och "visa fler" tar nästa lika stora kliv.
export const SCHEMA_UPCOMING_BATCH = 20;

export function isRetrospective(list) {
  let senaste = 0;
  for (const m of list) if (m.start > senaste) senaste = m.start;
  if (!senaste) return false;
  return Date.now() - senaste > SCHEMA_RETRO_DAYS * 86400000;
}
