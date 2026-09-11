/* module-link.mjs — laddar varje ES-modul på riktigt.

   node --check läser syntax, inte betydelse. Den säger OK om en modul
   exporterar ett namn som inte finns, importerar något som inte
   exporteras, eller pekar på en fil som inte existerar — allt sådant
   upptäcks först när webbläsaren länkar modulgrafen, alltså när sidan
   laddas. Då är hela appen vit.

   Upptäckt 2026-09-11: en borttagen funktion låg kvar i toolbar.js
   exportlista. node --check sa OK, testerna sa OK, och sidan dog med
   "Export 'buildFilterCupTile' is not defined in module".

   js/app.js kan inte importeras här — den rör window redan vid
   inläsning. Den (och allt annat som inte går att köra i Node) får i
   stället en statisk kontroll av exportlistan, vilket är precis det fel
   som faktiskt inträffade. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function jsFiler(dir) {
  const ut = [];
  for (const namn of readdirSync(dir)) {
    const p = join(dir, namn);
    if (statSync(p).isDirectory()) ut.push(...jsFiler(p));
    else if (namn.endsWith(".js")) ut.push(p);
  }
  return ut;
}

const ÄR_MODUL = /^\s*(import|export)\s/m;
const moduler = jsFiler("js").filter((f) => ÄR_MODUL.test(readFileSync(f, "utf8")));

/* Statisk kontroll: varje namn i en "export { … }"-lista måste finnas
   någon annanstans i filen. Ett kvarglömt namn förekommer BARA i listan,
   vilket gör regeln både enkel och praktiskt taget falsklarmsfri. */
function föräldralösaExporter(fil) {
  const kod = readFileSync(fil, "utf8");
  const ut = [];
  for (const block of kod.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    const utanBlocket = kod.slice(0, block.index) +
      kod.slice(block.index + block[0].length);
    for (const del of block[1].split(",")) {
      // "a as b" exporterar b men deklarerar a — det är a som ska finnas.
      const namn = del.trim().split(/\s+as\s+/)[0].trim();
      if (!namn || namn === "default") continue;
      const ordgräns = new RegExp("(^|[^\\w$])" + namn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^\\w$]|$)");
      if (!ordgräns.test(utanBlocket)) ut.push(`${fil} :: exporterar ${namn}, som inte finns i filen`);
    }
  }
  return ut;
}

const fynd = [];
let laddade = 0, statiska = 0;

for (const fil of moduler) {
  fynd.push(...föräldralösaExporter(fil));
  try {
    await import(resolve(fil));
    laddade++;
  } catch (e) {
    // ReferenceError på window/document = modulen hör till webbläsaren och
    // kan inte köras här. Allt ANNAT är ett riktigt länkfel.
    if (e instanceof ReferenceError && /window|document|navigator|location/.test(e.message)) {
      statiska++;
    } else {
      fynd.push(`${fil} :: ${e.message.split("\n")[0].slice(0, 120)}`);
    }
  }
}

if (fynd.length) {
  console.error("module-link: modulgrafen går inte att länka.\n");
  for (const f of fynd) console.error("  " + f);
  process.exit(1);
}
console.log(`module-link: OK (${laddade} moduler laddade, ${statiska} kontrollerade statiskt)`);
