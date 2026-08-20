/* playoff.js — platshållare, prognos och slutplacering ur trädet. */

import { slugifySv } from "./club.js";
import { winPointsForSport } from "./tables.js";
import {
  isPlaceholderTeam, PLACEHOLDER_WINNER_OF, PLACEHOLDER_NTH_BEST_OF_RANK,
  PLACEHOLDER_BEST_OF_RANK, PLACEHOLDER_RANK_IN_GROUP,
} from "./placeholder.js";

export function playoffGroupReference(sideName) {
  const match = /(\d+)\s*:\s*[^\s]+\s+i\s+grupp\s+([a-zåäö0-9]+)/i
    .exec((sideName || "").trim());
  return match ? { rank: +match[1], token: slugifySv(match[2]),
    label: "Grupp " + match[2].toUpperCase() } : null;
}

export function playoffTeamKey(side) {
  return side && !isPlaceholderTeam(side)
    ? (side.id != null ? "id:" + side.id : "name:" + slugifySv(side.name)) : null;
}

export function groupPlayoffRounds(div) {
  const byRound = new Map();
  for (const m of div.matches) {
    if (!byRound.has(m.roundRank)) byRound.set(m.roundRank, []);
    byRound.get(m.roundRank).push(m);
  }
  // Högre rank = tidigare omgång; sorterat så finalen (rank 0) hamnar sist/till höger.
  const rounds = [...byRound.entries()].sort((a, b) => b[0] - a[0]);
  for (const [, ms] of rounds) ms.sort((a, b) => a.matchRank - b.matchRank);
  return rounds;
}

export function playoffRoundDepth(match) {
  if (Number.isFinite(match.roundRank)) return match.roundRank;
  const name = (match.roundName || "").trim().toLowerCase();
  if (/^(?:grand\s+)?final(?:e)?$/.test(name)) return 0;
  if (/semi|1\s*\/\s*2/.test(name)) return 1;
  if (/quarter|kvarts|1\s*\/\s*4/.test(name)) return 2;
  const fraction = /1\s*\/\s*(\d+)/.exec(name);
  if (fraction) return Math.max(0, Math.round(Math.log2(+fraction[1])));
  return null;
}

export function playoffWinnerSide(match) {
  if (!match.res || !match.res.fin) return null;
  if (match.res.winner === "home" || match.res.winner === "away") return match.res.winner;
  if (match.res.hg > match.res.ag) return "home";
  if (match.res.ag > match.res.hg) return "away";
  return null;
}

export function playoffExplicitPlaces(match) {
  const name = (match.roundName || "").trim().toLowerCase();
  if (/brons|bronze|third\s+place|3rd\s+place/.test(name)) return [3, 4];
  if (/^(?:grand\s+)?final(?:e)?$/.test(name)) return [1, 2];
  // Cup Manager använder flera varianter för placeringsmatcher, t.ex.
  // "Placering 5-6" och "Placement match 7–8".
  if (/plac|place/.test(name)) {
    const range = /(\d+)\s*[-–]\s*(\d+)/.exec(name);
    if (range) return [+range[1], +range[2]];
  }
  return null;
}

// En grupp räknas som klar (dess tabellplats INTE längre kan ändras) när
// alla lag spelat lika många matcher som en fulltalig serie kräver
// (grupp­storlek − 1, dvs alla mot alla en gång).
export function isGroupComplete(rows) {
  return rows.length > 0 && rows.every((r) => r.played === rows.length - 1);
}

// Konservativ möjlighet att nå en viss tabellplats. Varje återstående
// match kan ge högst två eller tre poäng beroende på sport. En kandidat
// tas bara bort när dess maximala poäng inte längre räcker förbi de lag
// som garanterat ligger före, eller när för många lag garanterat hamnar
// bakom för att den ska kunna landa just på den efterfrågade platsen.
export function possibleGroupCandidates(rows, rank, sport = "handboll") {
  if (!rows.length || rank < 1 || rank > rows.length) return [];
  if (isGroupComplete(rows)) return rows[rank - 1] ? [rows[rank - 1]] : [];
  const gamesPerTeam = rows.length - 1;
  const maxPointsPerGame = winPointsForSport(sport);
  const ranges = rows.map((row) => ({
    row,
    min: row.points,
    max: row.points + Math.max(0, gamesPerTeam - row.played) * maxPointsPerGame,
  }));
  return ranges.filter((candidate) => {
    const others = ranges.filter((entry) => entry !== candidate);
    const guaranteedAhead = others.filter((entry) => entry.min > candidate.max).length;
    const guaranteedBehind = others.filter((entry) => entry.max < candidate.min).length;
    return guaranteedAhead <= rank - 1 && guaranteedBehind <= rows.length - rank;
  }).map((entry) => entry.row);
}

export function projectedGroupSide(candidates, fallback, certain, group) {
  const list = candidates.length ? candidates : (fallback ? [fallback] : []);
  if (!list.length) return null;
  const first = list[0];
  return {
    teamId: first.teamId, name: first.name, points: first.points,
    gf: first.gf, ga: first.ga,
    certain: !!certain && list.length === 1,
    candidates: list.map((row) => ({
      teamId: row.teamId, name: row.name, group: row.group || group,
      played: row.played, won: row.won, tied: row.tied, lost: row.lost,
      points: row.points, gf: row.gf, ga: row.ga,
    })),
    progress: null,
  };
}

export function groupProgress(rows) {
  const totalMatches = rows.length * (rows.length - 1) / 2;
  const playedMatches = rows.reduce((sum, row) => sum + (row.played || 0), 0) / 2;
  return totalMatches ? Math.max(0, Math.min(1, playedMatches / totalMatches)) : 0;
}

export function wildcardPool(byGroupNum, rank, wcCache, sport = "handboll") {
  if (wcCache.has(rank)) return wcCache.get(rank);
  const pool = Object.entries(byGroupNum)
    .flatMap(([groupToken, rows]) => {
      const complete = isGroupComplete(rows);
      const possible = complete
        ? (rows[rank - 1] ? [rows[rank - 1]] : [])
        : possibleGroupCandidates(rows, rank, sport);
      return possible.map((row) => ({
        row, groupComplete: complete,
        group: "Grupp " + String(groupToken).toUpperCase(),
      }));
    })
    .sort((a, b) => b.row.points - a.row.points ||
      (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga) || b.row.gf - a.row.gf);
  wcCache.set(rank, pool);
  return pool;
}

export function resolvePlaceholderTeam(name, gd, wcCache, sport = "handboll") {
  const s = (name || "").trim();
  let m;
  if ((m = PLACEHOLDER_NTH_BEST_OF_RANK.exec(s))) {
    const pool = wildcardPool(gd.byGroupNum, +m[2], wcCache, sport);
    const e = pool[+m[1] - 1];
    if (!e) return null;
    const complete = pool.every((x) => x.groupComplete);
    return complete
      ? projectedGroupSide([e.row], e.row, true, e.group)
      : projectedGroupSide(pool.map((entry) => ({
          ...entry.row, group: entry.group,
        })), e.row, false, "Wildcard");
  }
  if ((m = PLACEHOLDER_BEST_OF_RANK.exec(s))) {
    const pool = wildcardPool(gd.byGroupNum, +m[1], wcCache, sport);
    const e = pool[0];
    if (!e) return null;
    const complete = pool.every((x) => x.groupComplete);
    return complete
      ? projectedGroupSide([e.row], e.row, true, e.group)
      : projectedGroupSide(pool.map((entry) => ({
          ...entry.row, group: entry.group,
        })), e.row, false, "Wildcard");
  }
  if ((m = PLACEHOLDER_RANK_IN_GROUP.exec(s))) {
    const rows = gd.byGroupNum[slugifySv(m[2])] || [];
    const row = rows[+m[1] - 1];
    const candidates = possibleGroupCandidates(rows, +m[1], sport);
    const side = projectedGroupSide(candidates, row,
      isGroupComplete(rows) || candidates.length === 1,
      "Grupp " + String(m[2]).toUpperCase());
    if (side) side.progress = groupProgress(rows);
    return side;
  }
  return null;
}

export function buildPlayoffProjection(div, gd, sport = "handboll") {
  const wcCache = new Map();
  const feederQueue = new Map();
  const proj = new Map();
  const sideCandidates = (side) => {
    if (!side) return [];
    if (Array.isArray(side.candidates) && side.candidates.length) return side.candidates;
    if (!side.name || isPlaceholderTeam({ name: side.name })) return [];
    return [{ teamId: side.teamId, name: side.name }];
  };
  const possibleWinner = (home, away) => {
    const homeCandidates = sideCandidates(home), awayCandidates = sideCandidates(away);
    if (!homeCandidates.length || !awayCandidates.length) return null;
    const unique = new Map();
    [...homeCandidates, ...awayCandidates].forEach((candidate) => {
      const key = candidate.teamId != null
        ? "id:" + candidate.teamId : "name:" + slugifySv(candidate.name);
      if (!unique.has(key)) unique.set(key, candidate);
    });
    const candidates = [...unique.values()];
    const progressValues = [home.progress, away.progress].filter(Number.isFinite);
    return {
      teamId: candidates[0].teamId, name: candidates[0].name,
      points: -1, gf: 0, ga: 0, certain: false, candidates,
      progress: progressValues.length ? Math.min(...progressValues) : null,
    };
  };
  for (const [, ms] of groupPlayoffRounds(div)) {
    for (const m of ms) {
      const feeders = (feederQueue.get(m.id) || []).sort((a, b) => a.matchRank - b.matchRank);
      let feederIdx = 0;
      const resolveSide = (side) => {
        const r = gd ? resolvePlaceholderTeam(side.name, gd, wcCache, sport) : null;
        if (r) return r;
        if (PLACEHOLDER_WINNER_OF.test((side.name || "").trim())) {
          const f = feeders[feederIdx++];
          return f ? { ...f.winner, certain: f.certain } : null;
        }
        if (side.id == null || !side.name) return null;
        const strength = gd && gd.teamStrength ? gd.teamStrength[side.id] : null;
        return {
          teamId: side.id, name: side.name,
          points: strength ? strength.points : -1,
          gf: strength ? strength.gf : 0, ga: strength ? strength.ga : 0,
          certain: true,
          candidates: strength ? [{ teamId: side.id, name: side.name, ...strength }] : undefined,
        };
      };
      const home = resolveSide(m.home);
      const away = resolveSide(m.away);
      let winner = null;
      const realResult = !!(m.res && m.res.fin);
      const winnerSide = realResult ? playoffWinnerSide(m) : null;
      if (winnerSide) {
        winner = winnerSide === "home"
          ? (home || { teamId: m.home.id, name: m.home.name, points: -1, gf: 0, ga: 0, certain: true })
          : (away || { teamId: m.away.id, name: m.away.name, points: -1, gf: 0, ga: 0, certain: true });
      } else {
        winner = possibleWinner(home, away);
      }
      const homeChanged = home && home.name && home.name !== m.home.name;
      const awayChanged = away && away.name && away.name !== m.away.name;
      if (homeChanged || awayChanged) proj.set(m.id, {
        home: home || { teamId: m.home.id, name: m.home.name, certain: true },
        away: away || { teamId: m.away.id, name: m.away.name, certain: true },
        predicted: !!((homeChanged && home.certain === false) ||
          (awayChanged && away.certain === false)),
      });
      if (winner && m.nextWinnerId != null) {
        if (!feederQueue.has(m.nextWinnerId)) feederQueue.set(m.nextWinnerId, []);
        feederQueue.get(m.nextWinnerId).push({
          matchRank: m.matchRank, winner,
          certain: !!winnerSide && winner.certain !== false,
        });
      }
    }
  }
  return proj;
}

export function playoffPlacementRows(div) {
  const teams = new Map();
  const ensureTeam = (side) => {
    const key = playoffTeamKey(side);
    if (!key) return null;
    if (!teams.has(key)) teams.set(key, {
      key, team: side, place: null, exact: false, reason: "Ej avgjord",
      lastMatch: null, played: 0,
    });
    return teams.get(key);
  };
  const setPlace = (entry, place, exact, reason, match) => {
    if (!entry || !place) return;
    if (entry.place == null || (exact && !entry.exact) ||
        (exact === entry.exact && place < entry.place)) {
      entry.place = place;
      entry.exact = exact;
      entry.reason = reason;
      entry.lastMatch = match;
    }
  };

  for (const match of div.matches || []) {
    const home = ensureTeam(match.home), away = ensureTeam(match.away);
    const winnerSide = playoffWinnerSide(match);
    if (!winnerSide) continue;
    if (home) { home.played++; home.lastMatch = match; }
    if (away) { away.played++; away.lastMatch = match; }
    const winner = winnerSide === "home" ? home : away;
    const loser = winnerSide === "home" ? away : home;
    const explicit = playoffExplicitPlaces(match);
    if (explicit) {
      setPlace(winner, explicit[0], true,
        explicit[0] === 1 ? "Guld" : explicit[0] === 3 ? "Brons" : match.roundName, match);
      setPlace(loser, explicit[1], true,
        explicit[1] === 2 ? "Silver" : match.roundName, match);
      continue;
    }
    if (match.nextLoserId != null) continue;
    const depth = playoffRoundDepth(match);
    if (depth != null) {
      const place = Math.pow(2, depth) + 1;
      setPlace(loser, place, false,
        place === 3 ? "Brons" : "Utslagen i " + (match.roundName || "slutspelet"), match);
    }
  }

  const rows = [...teams.values()];
  const placeCounts = new Map();
  rows.forEach((row) => {
    if (row.place != null) placeCounts.set(row.place, (placeCounts.get(row.place) || 0) + 1);
  });
  rows.forEach((row) => { row.shared = row.place != null && placeCounts.get(row.place) > 1; });
  rows.sort((a, b) =>
    (a.place == null ? Number.MAX_SAFE_INTEGER : a.place) -
      (b.place == null ? Number.MAX_SAFE_INTEGER : b.place) ||
    (a.team.name || "").localeCompare(b.team.name || "", "sv", { numeric: true }));
  return { rows, total: rows.length };
}
