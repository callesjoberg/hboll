/* live-gap.js — vilka matcher ligger den gemensamma snapshotten efter på?

   Snapshotten i data/ byggs av CI och kan vara några minuter gammal.
   Under matchtid räcker inte det: ett resultat som skrivits in i Cup
   Manager ska synas nu, inte vid nästa CI-varv. Den här modulen pekar ut
   exakt vilka matcher det är värt att fråga källan om direkt — inte hela
   cupen, bara de som kan ha ändrats sedan snapshotten byggdes.

   Urvalet är avsiktligt snålt: en match som startat men saknar
   slutresultat. Det täcker både den som PÅGÅR (ställningen tickar) och
   den som nyss spelats klart utan att hinna med i snapshotten. Matcher
   som redan är avgjorda frågar vi aldrig om igen — de ändras i praktiken
   bara vid efterhandsrättningar, och dem fångar den vanliga
   TTL-kontrollen. */

const MAX_EFTERSLÄPNING_MIN = 12 * 60; // sluta jaga en match som aldrig fick resultat
export const MAX_LIVE_MATCHER = 40;    // tak per omgång — ett anrop per match

// `matches` ska vara det användaren faktiskt tittar på — det egna
// filtret eller klubbens matcher, inte hela cupen. Med ett anrop per
// match är skillnaden stor: Alingsås matcher i Göteborg Cup ger två
// kandidater mitt i en speldag, hela cupen ger hundratals.
export function liveGapMatches(matches, spec = {}) {
  const now = spec.now || Date.now();
  const limit = spec.limit || MAX_LIVE_MATCHER;

  const träffar = [];
  for (const m of matches || []) {
    if (!m || !m.start || (m.res && m.res.fin)) continue;
    const minuterSedanStart = (now - m.start) / 60000;
    if (minuterSedanStart < 0 || minuterSedanStart > MAX_EFTERSLÄPNING_MIN) continue;
    träffar.push(m);
  }
  // Senast startade först: en match som pågår är mer angelägen än en som
  // väntar på ett efterrapporterat resultat. Styr vilka som ryms i taket.
  träffar.sort((a, b) => b.start - a.start);
  return träffar.slice(0, limit);
}

// Skiljer sig från match.js scoreText: här jämförs två versioner av samma
// match för att avgöra om liveifyllnaden gav något NYTT. Bara resultatet
// kan ha ändrats — lag, tid och plan kommer från samma snapshot.
export function resultChanged(a, b) {
  const ra = (a && a.res) || {};
  const rb = (b && b.res) || {};
  return ra.hg !== rb.hg || ra.ag !== rb.ag || ra.fin !== rb.fin ||
    ra.hsw !== rb.hsw || ra.asw !== rb.asw || ra.wo !== rb.wo ||
    ((ra.per || []).length !== (rb.per || []).length) ||
    (ra.per || []).some((p, i) => {
      const q = (rb.per || [])[i] || {};
      return p.h !== q.h || p.a !== q.a;
    });
}
