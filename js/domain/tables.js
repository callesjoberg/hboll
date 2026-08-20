/* tables.js — grupptabell ur en lista matcher. */

export function winPointsForSport(sport) {
  return (sport === "fotboll" || sport === "innebandy") ? 3 : 2;
}

export function lossPointsForSport(sport) {
  return sport === "basket" ? 1 : 0;
}

export function computeGroupTableRows(divMatches, sport = "handboll") {
  const teams = new Map();
  const ensure = (id, name) => {
    if (!teams.has(id)) {
      teams.set(id, { teamId: id, name, played: 0, won: 0, tied: 0, lost: 0, gf: 0, ga: 0 });
    }
    return teams.get(id);
  };
  for (const m of divMatches) {
    if (m.home.id != null) ensure(m.home.id, m.home.name);
    if (m.away.id != null) ensure(m.away.id, m.away.name);
    if (!m.res || !m.res.fin) continue;
    if (m.home.id == null || m.away.id == null) continue;
    const home = ensure(m.home.id, m.home.name), away = ensure(m.away.id, m.away.name);
    home.played++; away.played++;
    home.gf += m.res.hg || 0; home.ga += m.res.ag || 0;
    away.gf += m.res.ag || 0; away.ga += m.res.hg || 0;
    if (m.res.winner === "home") { home.won++; away.lost++; }
    else if (m.res.winner === "away") { away.won++; home.lost++; }
    else { home.tied++; away.tied++; }
  }
  const winPoints = winPointsForSport(sport);
  const lossPoints = lossPointsForSport(sport);
  const rows = [...teams.values()].map((t) => ({
    ...t, points: t.won * winPoints + t.tied + t.lost * lossPoints,
  }));
  rows.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf ||
    a.name.localeCompare(b.name, "sv"));
  return rows;
}
