/* club-match.js — lagnamn mot klubbkatalogen, tre nivåer. */

import { COUNTRY_CENTROIDS, COUNTRY_NAME_WORDS } from "./countries.js";
import { isPlaceholderTeam } from "./placeholder.js";

// Klubbnamnsmatchning: ett lagnamn ("Karlskrona Handboll", "LUGI HF 1",
// "Alingsås HK Röd") jämförs mot klubbkatalogen i tre steg med FALLANDE
// säkerhet — exakt namn, sedan ett ordnings-/klubbtypsbevarande prefix
// (skiftläges-/genitiv-okänsligt), och bara som sista utväg en
// stopordsrensad "kärna" (klubbtypsord som HK/IF/Handbollsklubb
// bortstrukna, ordning ignorerad). De två sista fångar tillsammans tre
// återkommande missmatchningar som en ren startsWith-prefixjämförelse
// missar: skiftläge (ProCup skriver ofta VERSALER), genitiv-s ("Kungälv"
// vs "Kungälvs"), och omvänd ordning på klubbtyp/ortnamn ("HF Karlskrona"
// vs "Karlskrona Handboll").
const CLUB_STOPWORD_PREFIXES = [
  "handbollsförening", "handbollsforening", "handbollsklubb", "handboll",
  "fotbollsförening", "fotbollsforening", "fotbollsklubb", "fotboll",
  "idrottsförening", "idrottsforening", "idrottsklubb", "idrottsallians", "idrott",
  "bollklubb", "förening", "forening", "klubb", "allmänna", "allmanna",
];
const CLUB_STOPWORD_EXACT = new Set([
  "ik", "hk", "if", "ff", "bk", "gf", "sk", "hf", "fk", "gif", "aif", "bif", "kif", "fbk", "tk",
]);

export function isClubStopword(word) {
  return CLUB_STOPWORD_EXACT.has(word) || CLUB_STOPWORD_PREFIXES.some((p) => word.startsWith(p));
}

// Bara ord längre än 3 tecken — annars riskerar korta äkta förkortningar
// (som redan hunnit filtreras bort som stoppord ändå) att stympas i onödan.
export function stripGenitive(word) {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function coreClubTokens(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/)
    .filter(Boolean).filter((w) => !isClubStopword(w)).map(stripGenitive);
}

export function clubSignature(tokens) {
  return tokens.slice().sort().join("|");
}

// En katalog kan ha FLERA namn som normaliserar till samma kärna (t.ex.
// "HF Karlskrona" och "Handbollsföreningen Karlskrona") — antingen för
// att det bara är stavningsvarianter av SAMMA klubb, eller (farligare)
// för att det råkar vara TVÅ olika klubbar med samma ortnamn men olika
// sport/sektion (t.ex. "Vallentuna HK" och "Vallentuna Fotboll" — båda
// tappar sin sportbeteckning som stoppord och blir "vallentuna"). Kan
// inte skiljas åt på namnet ensamt efter normaliseringen — så gissa
// bara om alla kandidater faktiskt pekar på (nästan) samma koordinat,
// annars är det för osäkert och vi hoppar hellre över klubben helt.
export function pickUnambiguousClub(candidates, directory) {
  if (candidates.length === 1) return candidates[0];
  const coordKey = (n) => Math.round(directory[n].lat * 500) + "," + Math.round(directory[n].lng * 500);
  return new Set(candidates.map(coordKey)).size === 1 ? candidates[0] : null;
}

// Bevarar ORDNING och klubbtypsord (till skillnad från coreClubTokens,
// som medvetet slår ihop t.ex. "Kungälvs HK" och "Kungälvs FF" till
// samma "kungälv"-kärna) — bara skiftläge/skiljetecken/genitiv-s
// normaliserat bort, per ord. Används för en rak prefixjämförelse
// (matchClubName tier 2) som INTE kan förväxla två olika sporters
// klubbar i samma ort, till skillnad från den stopordsrensade
// kärnmatchningen (tier 3, se där).
export function normalizeForPrefix(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .split(/\s+/).filter(Boolean).map(stripGenitive).join(" ");
}

// Cachar indexet per katalog-objekt (WeakMap — directory är samma
// objekt-referens genom hela sessionen, se HB.api.fetchClubDirectory) så
// det bara byggs en gång i stället för vid varje anrop.
const clubDirIndexCache = new WeakMap();
export function clubDirIndex(directory) {
  if (clubDirIndexCache.has(directory)) return clubDirIndexCache.get(directory);
  const byExact = new Map();     // gemener+trim -> exakt katalognamn
  const byPrefix = [];           // [normaliseratNamn, katalognamn], längst-först
  const bySignature = new Map(); // stopordsrensad kärn-signatur -> [katalognamn, ...]
  for (const dirName of Object.keys(directory)) {
    byExact.set(dirName.toLowerCase().trim(), dirName);
    byPrefix.push([normalizeForPrefix(dirName), dirName]);
    const sig = clubSignature(coreClubTokens(dirName));
    if (!sig) continue;
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(dirName);
  }
  byPrefix.sort((a, b) => b[0].length - a[0].length); // längsta (mest specifika) prefixet vinner
  const index = { byExact, byPrefix, bySignature };
  clubDirIndexCache.set(directory, index);
  return index;
}

// Bara DESSA sista-token-mönster stryks vid ett omatchat helnamn — rena
// siffror, en enstaka bokstav (t.ex. "A"-laget) eller ett vanligt
// lagfärgsord. En OBEGRÄNSAD strypning av "vad som helst sist i namnet"
// gav falska träffar som "IF Malmö Redhawks" → "HK Malmö".
const CLUB_COLOR_WORDS = new Set([
  "röd", "blå", "gul", "vit", "svart", "grön", "orange", "lila", "rosa", "silver", "guld", "grå",
]);
export function isStrippableSuffixToken(word) {
  return /^\d+$/.test(word) || word.length === 1 || CLUB_COLOR_WORDS.has(word);
}

// Tre nivåer, i FALLANDE säkerhetsordning — varje nivå försöks bara om
// den föregående inte gav träff:
//
// 1. Exakt (skiftläges-okänsligt) — "Kungälvs HK" mot katalogens egna
//    "Kungälvs HK".
// 2. Ordnings- OCH klubbtypsbevarande prefix ("Kungälvs HK Röd" mot
//    "Kungälvs HK", "LUGI HF 1" mot "Lugi HF") — skiftläge/genitiv-s
//    normaliserat, men INTE klubbtypsordet (HK/FF/...) bortstruket,
//    så den kan aldrig förväxla "Kungälvs HK" med "Kungälvs FF".
// 3. Stopordsrensad kärn-signatur — sista utväg, för ordnings-omkastade
//    namn som "IK Sävehof" mot "Sävehof" eller "HF Karlskrona" mot
//    "Karlskrona Handboll". Riskerar att slå ihop olika sporters klubbar
//    i samma ort — därför sist, och bara om resultatet är entydigt.
// Memoiserad per katalog (WeakMap) — matchClubName är en REN funktion av
// (name, directory), men anropas upp till 3 gånger för SAMMA lagnamn per
// omritning.
const matchClubNameCache = new WeakMap(); // directory -> Map(name -> resultat)
export function matchClubName(name, directory) {
  let cache = matchClubNameCache.get(directory);
  if (!cache) { cache = new Map(); matchClubNameCache.set(directory, cache); }
  if (cache.has(name)) return cache.get(name);
  const result = matchClubNameUncached(name, directory);
  cache.set(name, result);
  return result;
}

export function matchClubNameUncached(name, directory) {
  const index = clubDirIndex(directory);
  const exact = index.byExact.get(name.toLowerCase().trim());
  if (exact) return exact;
  const normalized = normalizeForPrefix(name);
  const prefixHit = index.byPrefix.find(([normDir]) => normDir && normalized.startsWith(normDir));
  if (prefixHit) return prefixHit[1];
  let tokens = coreClubTokens(name);
  // Tier 3 nekas för ett namn som ORDAGRANT bara är ett landsnamn (t.ex.
  // "Croatia" i en landslagsklass) — annars kolliderar det lätt med en
  // RIKTIG klubb vars namn råkar sluta på ett stoppord ("Croatia BK").
  if (COUNTRY_NAME_WORDS.has(name.toLowerCase().trim())) return null;
  while (tokens.length) {
    const candidates = index.bySignature.get(clubSignature(tokens));
    if (candidates) {
      const picked = pickUnambiguousClub(candidates, directory);
      if (picked) return picked;
    }
    if (!isStrippableSuffixToken(tokens[tokens.length - 1])) break;
    tokens = tokens.slice(0, -1);
  }
  return null;
}

export function clubGeoFromMatches(matches, directory) {
  const geo = {};
  const seenTeamNames = new Set();
  for (const m of matches) {
    for (const side of [m.home, m.away]) {
      if (!side.name || isPlaceholderTeam(side) || seenTeamNames.has(side.name)) continue;
      seenTeamNames.add(side.name);
      const club = matchClubName(side.name, directory);
      if (club) geo[club] = directory[club];
    }
  }
  return geo;
}

export function allClubNamesFromMatches(matches, directory) {
  const names = new Set();
  for (const m of matches) {
    for (const side of [m.home, m.away]) {
      if (isPlaceholderTeam(side)) continue;
      const name = (directory && matchClubName(side.name, directory)) || side.club || side.name;
      if (name) names.add(name);
    }
  }
  return names;
}

export function clubCountryFromMatches(matches, directory) {
  const byClub = new Map();
  for (const m of matches) {
    for (const side of [m.home, m.away]) {
      if (isPlaceholderTeam(side)) continue;
      const name = (directory && matchClubName(side.name, directory)) || side.club || side.name;
      if (!name || byClub.has(name) || !side.country || !COUNTRY_CENTROIDS[side.country]) continue;
      byClub.set(name, side.country);
    }
  }
  return byClub;
}

export function teamsAndClassesFromMatches(matches) {
  const teamIds = new Set();
  const classes = new Set();
  for (const m of matches) {
    if (m.home && m.home.id != null && !isPlaceholderTeam(m.home)) teamIds.add(m.home.id);
    if (m.away && m.away.id != null && !isPlaceholderTeam(m.away)) teamIds.add(m.away.id);
    if (m.catName) classes.add(m.catName);
  }
  return { teamCount: teamIds.size, classes };
}
