/* archive.js — historikens rader, statistik och gruppering. */

import { dayKey } from "../time.js";
import { catSortKey } from "./category.js";
import { computeGroupTableRows } from "./tables.js";

export function summarizeArchiveMatches(matches, query) {
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

export function archiveStats(rows) {
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

export function sortArchiveRows(rows, sortKey) {
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
    arr.sort((a, b) => b.start - a.start);
  }
  return arr;
}

export function groupPlayoffDivisionsById(matches) {
  const byDiv = new Map();
  for (const m of matches) {
    if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
    byDiv.get(m.divId).matches.push(m);
  }
  return [...byDiv.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
}

export function historicalPlayoffDivisions(matches, catName) {
  return groupPlayoffDivisionsById(
    matches.filter((m) => m.divType === "Playoff" && m.catName === catName));
}

export function historicalGroupTables(matches, catName, sport = "handboll") {
  const byDiv = new Map();
  for (const m of matches) {
    if (m.divType !== "Conference" || m.catName !== catName) continue;
    if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
    byDiv.get(m.divId).matches.push(m);
  }
  const tables = [];
  for (const d of byDiv.values()) {
    const rows = computeGroupTableRows(d.matches, sport);
    if (rows.length) tables.push({ id: d.id, name: d.name, rows });
  }
  tables.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
  return tables;
}

export function groupArchiveByDay(matches) {
  const groups = [];
  for (const m of matches.slice().sort((a, b) => a.start - b.start)) {
    const key = dayKey(m.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, items: [m] });
  }
  return groups;
}

export function archiveClassOptions(matches, divType) {
  const set = new Set();
  for (const m of matches) {
    if (divType && m.divType !== divType) continue;
    if (m.catName) set.add(m.catName);
  }
  return [...set].sort((a, b) => catSortKey(a) - catSortKey(b));
}
