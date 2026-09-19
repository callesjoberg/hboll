/* build_age_offsets.mjs — varje cups förskjutning mellan klassnummer och
   födelseår, lärd ur HELA arkivet.

   Varför här och inte i webbläsaren: Klasser-fliken lärde sig först
   förskjutningen ur de upplagor som råkade vara hämtade. Med förvalet ett
   år per cup blev det en enda upplaga — och en enda upplaga ser nästan
   alltid konsekvent ut. Bua är 72 % konsekvent över hela arkivet och ska
   därför lämnas olöst, men klarade 95 %-kravet på ett enskilt år och
   räknades om fel. Underlaget måste vara cupens hela historik, och den
   finns bara samlad här.

   Node och inte Python av ett enda skäl: tolkningen av klassnamn
   (parseCat, parseCohort, learnAgeOffset) ska vara EXAKT densamma som
   appens. Här importeras appens egen modul, så två implementationer kan
   aldrig glida isär.

   Utdata: data/archive/age-offsets.json — {cupId: förskjutning}. Cuper
   utan entydigt underlag utelämnas; frånvaro betyder "vet inte". */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { learnAgeOffset } from "../js/domain/category.js";

const ROT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARKIV = join(ROT, "data", "archive");
const UT = join(ARKIV, "age-offsets.json");
const HÄRLEDDA = new Set(["index.json", "team-index.json", "club-entries.json", "age-offsets.json"]);

const provPerCup = new Map();
for (const namn of readdirSync(ARKIV).sort()) {
  if (!namn.endsWith(".json") || HÄRLEDDA.has(namn)) continue;
  const i = namn.lastIndexOf("-");
  const cup = namn.slice(0, i), edition = namn.slice(i + 1, -5);
  let d;
  try { d = JSON.parse(readFileSync(join(ARKIV, namn), "utf8")); } catch { continue; }
  const klasser = new Set((d.matches || []).map((m) => m.catName).filter(Boolean));
  if (!provPerCup.has(cup)) provPerCup.set(cup, []);
  for (const catName of klasser) provPerCup.get(cup).push({ catName, edition });
}

const ut = {};
for (const [cup, prov] of [...provPerCup].sort()) {
  const off = learnAgeOffset(prov);
  if (off != null) ut[cup] = off;
}

const text = JSON.stringify(ut);
const gammal = existsSync(UT) ? readFileSync(UT, "utf8") : null;
if (gammal === text) {
  console.log("age-offsets.json: oförändrad");
} else {
  writeFileSync(UT, text);
  console.log(`age-offsets.json: ${Object.keys(ut).length} av ${provPerCup.size} cuper kalibrerade`);
}
