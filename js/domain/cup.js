/* cup.js — vilken cup ett förstabesök ska landa på. */

export const DEFAULT_CUP_GRACE_MS = 24 * 3600 * 1000;
export const DEFAULT_CUP_UPCOMING_MS = 14 * 24 * 3600 * 1000;

// Startcup för ett förstabesök: hellre "det som händer nu" än första
// raden i data/cups.json. windows är data/cup-windows.json.
//
//   1. cup som pågår           — första matchen har startat och sista
//                                spelades för mindre än ett dygn sedan
//   2. annars den tidsmässigt närmaste av senast spelade cup och en cup
//      som börjar inom två veckor
//   3. finns ingen historisk cup alls: närmast kommande även längre bort
//
// Uppskattade fönster ("est") väljs aldrig: en gissad upplaga utan
// publicerat schema ger en tom app.
export function pickDefaultCup(cups, windows, now = Date.now()) {
  if (!windows || typeof windows !== "object") return null;
  let ongoing = null, upcoming = null, past = null;
  for (const c of cups || []) {
    const w = windows[c.id];
    if (!w || !w.first) continue;
    if (w.est) continue;
    const last = w.last || w.first;
    if (w.first <= now && now <= last + DEFAULT_CUP_GRACE_MS) {
      if (!ongoing || w.first > ongoing.first) ongoing = { id: c.id, first: w.first };
    } else if (w.first > now) {
      if (!upcoming || w.first < upcoming.first) {
        upcoming = { id: c.id, first: w.first, distance: w.first - now };
      }
    } else if (!past || last > past.last) {
      past = { id: c.id, last, distance: now - last };
    }
  }
  if (ongoing) return ongoing.id;
  const nearUpcoming = upcoming && upcoming.distance <= DEFAULT_CUP_UPCOMING_MS
    ? upcoming : null;
  if (nearUpcoming && (!past || nearUpcoming.distance < past.distance)) {
    return nearUpcoming.id;
  }
  return (past || upcoming || {}).id || null;
}
