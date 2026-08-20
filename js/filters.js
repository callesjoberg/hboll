/* filters.js — en filterregel för schema/tabeller/slutspel/hero. */

import { dayKey } from "./time.js";

export function matchesBooleanQuery(haystack, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const orGroups = q.split(/[/,]/).map((g) => g.trim()).filter(Boolean);
  if (!orGroups.length) return true;
  return orGroups.some((group) =>
    group.split("&").map((t) => t.trim()).filter(Boolean).every((t) => haystack.includes(t)));
}

export function matchSearchHaystack(m) {
  return (m.home.name + " " + m.away.name + " " + m.arena + " " +
    m.catName + " " + m.divName + " " + m.roundName).toLowerCase();
}

export function matchesSearchQuery(m, query) {
  if (!(query || "").trim()) return true;
  return matchesBooleanQuery(matchSearchHaystack(m), query);
}

export function hasFilterSelection({ cats, teams, arena, q } = {}) {
  return (cats && cats.size > 0) || (teams && teams.size > 0) ||
    !!arena || !!(q && String(q).trim());
}

export function hasLockableSelection({ days, cats, teams, years, includeCurrentYear } = {}) {
  return (days && days.size > 0) || (cats && cats.size > 0) || (teams && teams.size > 0) ||
    (years && years.size > 0) || includeCurrentYear === false;
}

export function isFilterLocked({ sheetMode = false, filterLocked = false, lockable = false } = {}) {
  return !sheetMode && !!filterLocked && !!lockable;
}

// Gemensam predikat för schema/bana (och samma regel för tabeller när de
// filtrerar på dagar/klasser/lag). dayKeyFn är injicerad så tester kan
// styra kalenderdagen utan att gå via Intl.
export function matchPassesFilters(m, spec = {}) {
  const days = spec.days;
  const cats = spec.cats;
  const teams = spec.teams;
  const arena = spec.arena || "";
  const matchFilter = spec.matchFilter || "all";
  const q = spec.q || "";
  const keyOf = spec.dayKeyFn || dayKey;
  if (days && days.size && !days.has(keyOf(m.start))) return false;
  if (cats && cats.size && !cats.has(m.catId)) return false;
  if (teams && teams.size &&
      !teams.has(m.home.id) && !teams.has(m.away.id)) return false;
  if (arena && m.arena !== arena) return false;
  if (matchFilter === "upcoming" && m.res && m.res.fin) return false;
  if (matchFilter === "played" && !(m.res && m.res.fin)) return false;
  if (!matchesSearchQuery(m, q)) return false;
  return true;
}
