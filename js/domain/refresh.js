/* refresh.js — hur ofta snapshot-versionen ska kontrolleras. */

import { hasScheduledStart } from "../time.js";

export function refreshTtl(matches, now = Date.now()) {
  // Hur gammal data vi accepterar utan att kontrollera den lilla,
  // gemensamma snapshot-versionen: pågående cuper kontrolleras tätt,
  // var 30:e minut så nytillagda matcher upptäcks, och avslutade cuper
  // får lång men ÄNDLIG TTL eftersom efterhandsrättningar förekommer.
  if (!matches.length) return 0;
  const starts = matches.filter(hasScheduledStart).map((m) => m.start);
  // Ett publicerat schema utan tider ska kontrolleras ofta: start=0 är
  // "tid ej satt", inte 1970 och inte ett avslutat historiskt schema.
  if (!starts.length) return 60000;
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  if (now > last + 24 * 3600000) {
    return now - last <= 14 * 24 * 3600000
      ? 24 * 3600000     // nyligen avslutad: sena korrigeringar är vanliga
      : 7 * 24 * 3600000; // gammal historik: kontrollera fortfarande ibland
  }
  if (now < first - 24 * 3600000) return 30 * 60000; // framtida/publiceras
  return 10 * 60000;                                  // pågår
}

// Är ALLA matcher i listan klara (har ett slutgiltigt resultat)? Styr om
// gruppställningar/slutspelsträd får cachas längre per division/kategori
// i stället för att hämtas vid varje vybyte.
export function allMatchesFinished(list) {
  return list.length > 0 && list.every((m) => m.res && m.res.fin);
}
