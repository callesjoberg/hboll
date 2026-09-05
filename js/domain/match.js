/* match.js — live, resultattext, V/O/F och målsumma. */

import { hasScheduledStart } from "../time.js";

// Cup Managers live-flagga är inte att lita på. Yngre klasser rapporterar
// aldrig något slutresultat, så deras matcher blir stående "live" med
// nollor — flaggan sätts vid avspark och släcks först när någon skriver
// in resultatet, vilket ibland aldrig sker. Klockan får därför avgöra.
//
// m.end är matchens faktiska sluttid ur Cup Manager (ren speltid). Saknas
// den — arkiverade upplagor, ProCup/Gothia — används fallbackMinuter, som
// anroparen sätter till cupens härledda matchlängd.
const LIVE_MARGINAL_MS = 15 * 60000; // förlängning och sen inrapportering

// Matchens VERKLIGA fönster. m.started är avkasttiden ur Cup Managers
// liveStart och finns bara när sekretariatet startat klockan på en annan
// minut än schemat sa — matcher tidigareläggs och drar över, en
// 09:00-match i Göteborg Cup kastade av 08:20. Speltiden (m.end - m.start)
// är däremot densamma oavsett när det faktiskt drog igång, så den
// förskjuts med startens avvikelse i stället för att räknas om.
export function matchStart(m) {
  return (m && (m.started || m.start)) || 0;
}

export function matchEnd(m, fallbackMinuter = 60) {
  const start = matchStart(m);
  if (!start) return 0;
  const speltid = m.end && m.start && m.end > m.start
    ? m.end - m.start
    : fallbackMinuter * 60000;
  return start + speltid;
}

// Hur långt från schemat matchen faktiskt kastade av, i ms. 0 när vi inte
// vet (fältet lagras bara när det skiljer minst en minut).
export function kickoffDrift(m) {
  return m && m.started && m.start ? m.started - m.start : 0;
}

export function isLive(m, now = Date.now(), fallbackMinuter = 60) {
  if (!hasScheduledStart(m) || !m.res || !m.res.live || m.res.fin) return false;
  if (now < matchStart(m)) return false; // kan inte pågå före avspark
  return now < matchEnd(m, fallbackMinuter) + LIVE_MARGINAL_MS;
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
