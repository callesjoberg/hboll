/* match-length.js — härled cupens matchlängd ur schemat.

   Cup Manager publicerar bara matchernas STARTTID, aldrig hur långa de
   är. Men schemat självt bär informationen: en cup lägger sina matcher
   i fasta rutor på varje plan, så avståndet mellan två starter på samma
   plan ÄR rutans längd — speltid plus halvlek och planbyte. Det är
   precis det mått appen behöver (kalenderexport, NU-linjen och
   pausmarkeringen handlar alla om rutan, inte om ren speltid).

   Metod: gruppera på arena + dag, ta de UNIKA starttiderna (parallella
   planer i samma hall startar samtidigt och ska räknas en gång), mät
   avstånden mellan varandra följande starter, avrunda till närmaste
   femtal och ta det vanligaste värdet. Vanligast, inte median: cuper
   med två olika rutlängder (grupp- respektive slutspelsdagar) ger annars
   ett mellanting som inte stämmer för någon av dem. */

const MIN_GAP_MIN = 10;   // kortare än så är parallella planer, inte en ruta
const MAX_GAP_MIN = 120;  // längre än så är en lucka i schemat
const MIN_SAMPLES = 12;   // för få mätpunkter säger inget om cupen
const MIN_SHARE = 0.25;   // vinnaren måste vara ett mönster, inte ett hopkok

export function guessMatchMinutes(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;

  const perArenaDay = new Map();
  for (const m of matches) {
    const start = m && m.start;
    if (!start) continue;
    const key = (m.arena || "?") + "|" + Math.floor(start / 86400000);
    let set = perArenaDay.get(key);
    if (!set) perArenaDay.set(key, (set = new Set()));
    set.add(start);
  }

  const counts = new Map();
  let total = 0;
  for (const set of perArenaDay.values()) {
    const starts = [...set].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      const gap = (starts[i] - starts[i - 1]) / 60000;
      if (gap < MIN_GAP_MIN || gap > MAX_GAP_MIN) continue;
      const rounded = Math.round(gap / 5) * 5;
      counts.set(rounded, (counts.get(rounded) || 0) + 1);
      total++;
    }
  }
  if (total < MIN_SAMPLES) return null;

  let bäst = 0;
  let bästAntal = 0;
  for (const [minuter, antal] of counts) {
    if (antal > bästAntal) { bäst = minuter; bästAntal = antal; }
  }
  return bästAntal / total >= MIN_SHARE ? bäst : null;
}
