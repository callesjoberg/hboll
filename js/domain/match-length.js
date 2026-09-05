/* match-length.js — hur lång är en match i den här cupen?

   Cup Manager HAR svaret: Match.end är matchens faktiska sluttid, alltså
   ren speltid inklusive halvlek (Göteborg Cup 30 min = 2×15, Åhus beach
   10, Hällby 25, basket 45). Fältet fanns i API:t hela tiden men
   frågades aldrig efter — appen gissade i stället rutans längd ur
   avståndet mellan starttider, vilket ger 40 minuter i Göteborg Cup
   eftersom avtackning och uppställning inför nästa match ligger emellan.

   Så: räkna på riktiga speltider när de finns. Gissningen ur schemat
   finns kvar som reserv för cuper vars data saknar end — arkiverade
   upplagor hämtade innan fältet började sparas, och ProCup/Gothia som
   har helt egna skrapor.

   Båda vägarna tar det VANLIGASTE värdet, inte medianen: en cup har ofta
   två speltider (yngre 2×15, äldre 2×20 — Göteborg Cup har 1057 matcher
   på 30 minuter och 131 på 40), och medianen ger då ett mellanting som
   inte stämmer för någon av dem. */

const MIN_GAP_MIN = 10;   // kortare än så är parallella planer, inte en ruta
const MAX_GAP_MIN = 120;  // längre än så är en lucka i schemat
const MIN_SAMPLES = 12;   // för få mätpunkter säger inget om cupen
const MIN_SHARE = 0.25;   // vinnaren måste vara ett mönster, inte ett hopkok

// Returnerar {minuter, källa} där källa är "speltid" (cupens eget mått
// ur Match.end) eller "ruta" (gissad ur avståndet mellan avsparkar).
// Anroparen behöver skillnaden: det ena är ett faktum, det andra en
// uppskattning, och inställningarna ska inte påstå att de är samma sak.
export function guessMatchMinutes(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const riktig = realMatchMinutes(matches);
  if (riktig) return { minuter: riktig, källa: "speltid" };
  const ruta = slotMatchMinutes(matches);
  return ruta ? { minuter: ruta, källa: "ruta" } : null;
}

// Riktiga speltider ur Match.end. Ingen avrundning behövs — det här är
// inte en gissning utan cupens eget mått.
function realMatchMinutes(matches) {
  const counts = new Map();
  let total = 0;
  for (const m of matches) {
    if (!m || !m.start || !m.end || m.end <= m.start) continue;
    const minuter = Math.round((m.end - m.start) / 60000);
    if (minuter < MIN_GAP_MIN || minuter > MAX_GAP_MIN) continue;
    counts.set(minuter, (counts.get(minuter) || 0) + 1);
    total++;
  }
  return total >= MIN_SAMPLES ? vanligast(counts, total) : null;
}

function vanligast(counts, total) {
  let bäst = 0;
  let bästAntal = 0;
  for (const [minuter, antal] of counts) {
    if (antal > bästAntal) { bäst = minuter; bästAntal = antal; }
  }
  return bästAntal / total >= MIN_SHARE ? bäst : null;
}

function slotMatchMinutes(matches) {
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
  return total >= MIN_SAMPLES ? vanligast(counts, total) : null;
}
