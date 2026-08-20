/* placeholder.js — platshållarnamn i ospelade slutspelsträd. */

// "Vinn.", "Förl. 1/4 Final - 2", "1:an i Grupp A", "10:e bästa 3:an",
// "Plats 5 i 6". Samma mönster i scripts/archive_results.py
// (is_placeholder_team) — håll dem i synk.
export const PLACEHOLDER_TEAM_RE =
  /^(?:vinn\.|förl\.|\d+:an i |\d+:e bästa |plats \d+ i \d+$)/i;

export const PLACEHOLDER_WINNER_OF = /^vinn/i;
export const PLACEHOLDER_NTH_BEST_OF_RANK =
  /^(\d+)\s*:\s*\w+\s+b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
export const PLACEHOLDER_BEST_OF_RANK = /^b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
export const PLACEHOLDER_RANK_IN_GROUP =
  /^(\d+)\s*:\s*\w+\s+i\s+grupp\s+([a-zåäö0-9]+)$/i;

export function isPlaceholderTeam(side) {
  const name = ((side && side.name) || "").trim();
  return !name || PLACEHOLDER_TEAM_RE.test(name);
}
