/* picker-selection-guard.mjs — buildPicker()s urval är Set-LIKNANDE.

   js/ui/toolbar.js:buildYearPicker skickar in yearSelectionProxy, som
   låtsas vara ett Set men i själva verket dirigerar innevarande upplagas
   id till en boolean (state.includeCurrentYear) och resten till ett Set
   (state.years). Den lovar bara fem medlemmar: size, has, add, delete,
   clear.

   Upptäckt 2026-09-07 i produktion: snabbvalsraden ("Senaste: 1 2 3 5")
   gjorde `[...opts.selected]` för att räkna hur många år som var valda.
   Proxyn saknade Symbol.iterator, och eftersom renderToolbar bygger
   årsväljaren vid VARJE render slog TypeError:et ut Schema, Tabeller och
   Slutspel på en gång — bara Statistik, som hoppar över verktygsraden,
   överlevde.

   Proxyn har nu en iterator, men spärren står kvar: nästa Set-idiom
   (Array.from, .forEach, .values()) hade fallit på samma sätt, och det
   här är kod som körs på varje render och därför inte får gissa. */

import { readFileSync } from "node:fs";

const FIL = "js/ui/toolbar.js";
const kod = readFileSync(FIL, "utf8");

// Allt utanför de fem lovade medlemmarna är ett antagande om ett äkta Set.
const TILLÅTET = /^(size|has|add|delete|clear)\b/;
const fynd = [];

for (const m of kod.matchAll(/(\.\.\.\s*)?opts\.selected\s*(\.\s*\w+|\[)?/g)) {
  const rad = kod.slice(0, m.index).split("\n").length;
  if (m[1]) {
    fynd.push(`${FIL}:${rad} — opts.selected sprids (…) fast den bara är Set-liknande`);
    continue;
  }
  const medlem = (m[2] || "").replace(/^\.\s*/, "");
  if (medlem === "[") {
    fynd.push(`${FIL}:${rad} — opts.selected indexeras`);
  } else if (medlem && !TILLÅTET.test(medlem)) {
    fynd.push(`${FIL}:${rad} — opts.selected.${medlem} finns inte på yearSelectionProxy`);
  }
}

for (const m of kod.matchAll(/\bof\s+opts\.selected\b/g)) {
  const rad = kod.slice(0, m.index).split("\n").length;
  fynd.push(`${FIL}:${rad} — for…of över opts.selected`);
}

if (fynd.length) {
  console.error("picker-selection-guard: buildPicker rör urvalet som ett äkta Set.\n" +
    "Håll dig till size/has/add/delete/clear — se yearSelectionProxy.\n");
  for (const f of fynd) console.error("  " + f);
  process.exit(1);
}
console.log("picker-selection-guard: OK");
