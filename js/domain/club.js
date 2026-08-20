/* club.js — klubbmönster, favoritlag, färgord och slugifiering. */

import { cohortKey } from "./category.js";

export const TEAM_COLOR_WORDS = {
  bla: "#1f5fbf", vit: "#c9c2b4", svart: "#23303a", orange: "#e8730c",
  gul: "#f2bd0c", rod: "#d22f27", gron: "#2f9e44", rosa: "#e864a4",
  lila: "#8b5cf6", brun: "#6b4423", silver: "#9aa5b1", turkos: "#0e9aa7",
};

export function slugifySv(s) {
  return (s || "").toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Filnamnssäker version av ett lag-id — måste vara EXAKT samma algoritm
// som slugify_team_id() i scripts/_ics.py, annars pekar länken fel.
export function slugifyTeamId(teamId) {
  let s = String(teamId)
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");
  s = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return s || "lag";
}

export function clubPatternFromName(raw) {
  const escaped = (raw || "").trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[åäÅÄ]/g, "[åäa]")
    .replace(/[öÖ]/g, "[öo]")
    .replace(/\s+/g, "\\s*");
  return escaped ? new RegExp("^" + escaped, "i") : /^$/;
}

export function isClubName(name, pattern) {
  return pattern ? pattern.test(name || "") : false;
}

export function detectTeamColor(name) {
  for (const t of slugifySv(name).split("-")) {
    if (TEAM_COLOR_WORDS[t]) return TEAM_COLOR_WORDS[t];
  }
  return null;
}

export function favoriteTeamKey(name, cohort) {
  return slugifySv(name) + "|" + (cohort || "");
}

export function favoriteTeamIndex(name, cohort, favoriteTeams) {
  const key = favoriteTeamKey(name, cohort);
  return (favoriteTeams || []).findIndex((f) => favoriteTeamKey(f.name, f.cohort) === key);
}

// Har favoriten en årskull måste den stämma EXAKT — även mot en klass som
// inte går att tolka. Annars läcker stjärnan: väljer man "Alingsås HK 1
// (Flickor 2010)" och klassen "Herrjunior (födda 07-09)" saknar entydigt
// födelseår, så skulle en tillåtande jämförelse stjärnmärka herrjunior-
// laget också. Favoriter UTAN årskull matchar på enbart namnet.
export function isFavoriteTeam(name, catName, favoriteTeams) {
  if (!name || !favoriteTeams || !favoriteTeams.length) return false;
  const slug = slugifySv(name);
  const ck = cohortKey(catName);
  return favoriteTeams.some((f) =>
    slugifySv(f.name) === slug && (!f.cohort || f.cohort === ck));
}
