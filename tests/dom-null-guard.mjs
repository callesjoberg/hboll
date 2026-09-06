/* dom-null-guard.mjs — fångar en fälla som bitit tre gånger.

   h() i js/dom.js filtrerar bort null bland sina barn, så mönstret
   `villkor ? h(...) : null` är helt rätt DÄR. Men append(), prepend()
   och replaceChildren() är webbläsarens egna metoder och filtrerar
   ingenting — de gör om ett null till en textnod med innehållet "null",
   som sedan står och lyser mitt i sidan.

   Upptäckt 2026-09-06: skyttelistans täckningsrad slutade på "null" i
   varje cup utom när en match pågick, troféskåpet likaså när ingen delad
   tredjeplats fanns, och matchlistans dialog när "Visa alla" inte
   behövdes. Samma stavfel tre gånger på tre ställen — därför en spärr i
   stället för tre rättningar.

   Skriv `...(villkor ? [nod] : [])` i stället. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DOM_METODER = /\.(replaceChildren|append|prepend)\(/g;

function jsFiler(dir) {
  const ut = [];
  for (const namn of readdirSync(dir)) {
    const p = join(dir, namn);
    if (statSync(p).isDirectory()) ut.push(...jsFiler(p));
    else if (namn.endsWith(".js")) ut.push(p);
  }
  return ut;
}

// Delar en argumentlista på kommatecken som ligger på yttersta nivån:
// null:et inuti ett h(...) är oskyldigt, det är bara de egna argumenten
// som når DOM:en direkt.
function toppArgument(arg) {
  const ut = [];
  let djup = 0, cur = "";
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      cur += c;
      for (i++; i < arg.length && arg[i] !== q; i++) {
        if (arg[i] === "\\") { cur += arg[i]; i++; }
        cur += arg[i];
      }
      cur += arg[i] ?? "";
      continue;
    }
    if ("([{".includes(c)) djup++;
    else if (")]}".includes(c)) djup--;
    if (c === "," && djup === 0) { ut.push(cur); cur = ""; } else cur += c;
  }
  ut.push(cur);
  return ut.map((a) => a.trim());
}

function argumentlista(kod, från) {
  let djup = 1, i = från;
  while (i < kod.length && djup) {
    if (kod[i] === "(") djup++;
    else if (kod[i] === ")") djup--;
    i++;
  }
  return kod.slice(från, i - 1);
}

const fynd = [];
for (const fil of jsFiler("js")) {
  const kod = readFileSync(fil, "utf8");
  for (const m of kod.matchAll(DOM_METODER)) {
    const arg = argumentlista(kod, m.index + m[0].length);
    for (const a of toppArgument(arg)) {
      if (a === "null" || /:\s*null$/.test(a)) {
        const rad = kod.slice(0, m.index).split("\n").length;
        fynd.push(`${fil}:${rad} — ${m[1]}() får ett null som barn`);
      }
    }
  }
}

if (fynd.length) {
  console.error("dom-null-guard: null skickat direkt till DOM-metod " +
    "(blir texten \"null\" i sidan). Skriv ...(villkor ? [nod] : []) i stället.\n");
  for (const f of fynd) console.error("  " + f);
  process.exit(1);
}
console.log(`dom-null-guard: OK (${jsFiler("js").length} filer)`);
