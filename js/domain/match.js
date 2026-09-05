/* match.js — live, resultattext, V/O/F och målsumma. */

import { hasScheduledStart } from "../time.js";

export function isLive(m, now = Date.now()) {
  // Yngre klasser rapporterar inga resultat: deras matcher blir stående
  // "live" med nollor. Räkna bara pågående, ej färdiga, nutida matcher.
  return !!(hasScheduledStart(m) && m.res && m.res.live && !m.res.fin &&
    Math.abs(m.start - now) < 6 * 3600000);
}

export function scoreText(res) {
  if (!res || (!res.fin && !res.live)) return null;
  if (res.wo) return "WO";
  if (res.hidden) return res.fin ? "spelad" : null;
  if (res.hg || res.ag) return res.hg + "–" + res.ag;
  if (res.hsw || res.asw) return res.hsw + "–" + res.asw;
  const per = (res.per || []).filter((p) => p.h || p.a);
  if (per.length) return per.map((p) => p.h + "–" + p.a).join(", ");
  return res.fin ? "spelad" : null;
}

// Period-för-period ur Cup Managers periodScores. Fältet betyder olika
// saker i olika cuper: oftast är enda "perioden" bara en kopia av
// slutresultatet, listan padas gärna med tomma 0–0 på slutet, och i
// cuper som avgörs på perioder (beachhandboll, basket) står hela
// resultatet HÄR medan homeGoals/awayGoals är noll.
//
// Därför: klipp bort tomma perioder på slutet och lita bara på listan när
// den har minst två perioder kvar. En ensam period säger inget utöver
// slutresultatet, och en avslutande 0–0 går inte att skilja från en
// period som aldrig rapporterats — bättre att utelämna den än att påstå
// att andra halvlek slutade mållös.
export function periodScores(res) {
  const per = (res && res.per) || [];
  let slut = per.length;
  while (slut > 0 && !per[slut - 1].h && !per[slut - 1].a) slut--;
  const delar = per.slice(0, slut);
  return delar.length >= 2 ? delar : [];
}

export function clubOutcomeLetter(m, teamId) {
  if (!(m.res && m.res.fin) || m.res.wo) return null;
  if (!m.res.winner) return "O";
  return (m.res.winner === "home") === (m.home.id === teamId) ? "V" : "F";
}

export function totalGoals(m) {
  if (!(m.res && m.res.fin) || m.res.wo) return -1;
  return (m.res.hg || 0) + (m.res.ag || 0);
}

// Vilket lag som är "vårt" perspektiv: ett valt lag-id, annars klubben,
// annars hemmalaget. isClubName är injicerad så anroparen äger mönstret.
export function referenceSide(m, spec = {}) {
  const selectedTeamId = spec.selectedTeamId;
  const isClub = spec.isClubName;
  if (selectedTeamId != null) {
    if (m.home.id === selectedTeamId) return "home";
    if (m.away.id === selectedTeamId) return "away";
  }
  if (isClub && isClub(m.home.name)) return "home";
  if (isClub && isClub(m.away.name)) return "away";
  return "home";
}

export function hasReference(m, spec = {}) {
  const selectedTeamId = spec.selectedTeamId;
  const isClub = spec.isClubName;
  if (selectedTeamId != null) {
    return m.home.id === selectedTeamId || m.away.id === selectedTeamId;
  }
  return !!(isClub && (isClub(m.home.name) || isClub(m.away.name)));
}

export function outcomeLetter(m, spec = {}) {
  if (!hasReference(m, spec) || !(m.res && m.res.fin) || m.res.wo) return null;
  if (!m.res.winner) return "O";
  return m.res.winner === referenceSide(m, spec) ? "V" : "F";
}

export function outcomeRank(m, spec = {}) {
  if (!(m.res && m.res.fin)) return 3;
  const o = outcomeLetter(m, spec);
  return o === "V" ? 0 : o === "O" ? 1 : o === "F" ? 2 : 3;
}
