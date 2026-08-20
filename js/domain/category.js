/* category.js — klassnamn, årskull och sortering. */

export function parseCat(catName) {
  // "F12", "P 12", "F-14 (f 2012) Lätt" (fotbollscupers bindestreck-
  // mönster), "Flickor 12 år Classic (födda 2014)", "U12" → {g, age}
  const s = catName || "";
  let m = /\b([PFU])[\s-]?(\d{1,2})\b/.exec(s);
  if (m) return { g: m[1].toUpperCase(), age: +m[2] };
  m = /(Flickor|Pojkar|Damer|Herrar|Girls|Boys)\s*(\d{1,2})?/i.exec(s);
  if (m) {
    const g = {
      flickor: "F", pojkar: "P", damer: "D", herrar: "H", girls: "F", boys: "P",
    }[m[1].toLowerCase()];
    return { g, age: m[2] ? +m[2] : 0 };
  }
  return null;
}

// Årskullen ur ett klassnamn: "Flickor 13 (födda 2012) 24-26 april" ->
// {g:"F", born:2012}. Åldersetiketten förskjuts mellan år (födda 2012 är
// F13 år 2026 men F14 år 2025) medan årskullen är densamma — den är alltså
// den stabila identiteten när flera upplagor blandas i samma vy.
// null när födelseåret inte går att läsa ut (alla cuper skriver det inte).
// Fyra skrivsätt förekommer i skarp data, uppmätt över samtliga cuper:
//   "Flickor 13 (födda 2012)"      svensk standard
//   "Boys 11 (boys born 2014)"     engelska (Eken Cup)
//   "Flickor 10 år (f 2015)"       förkortat (IrstaBlixten)
//   "F10(2014)"                    bara år i parentes (Katrineholm)
export function parseCohort(catName) {
  const born = /(?:f[öo]dd[a]?|born|\bf)\.?\s*(\d{4})|\((\d{4})\)/i.exec(catName || "");
  if (!born) return null;
  const g = (parseCat(catName) || {}).g;
  if (!g) return null;
  return { g, born: +(born[1] || born[2]) };
}

export const COHORT_LABELS = { F: "Flickor", P: "Pojkar", U: "Ungdom", D: "Damer", H: "Herrar" };

export function cohortKey(catName) {
  const c = parseCohort(catName);
  return c ? c.g + c.born : null;
}

export function cohortLabel(catName) {
  const c = parseCohort(catName);
  return c ? (COHORT_LABELS[c.g] || c.g) + " " + c.born : catName;
}

export function shortCat(catName) {
  const p = parseCat(catName);
  if (!p) return (catName || "").slice(0, 8);
  return p.g + (p.age || "");
}

export function catSortKey(catName) {
  const p = parseCat(catName);
  if (!p) return 9999;
  const gOrder = { F: 0, P: 1, U: 2, D: 3, H: 4 };
  return p.age * 10 + (gOrder[p.g] ?? 5);
}
