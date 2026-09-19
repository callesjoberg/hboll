/* Publik konfiguration för serverfunktionerna. Inget här är hemligt:
   publishable key ligger även i klienten (js/config.js) och ska göra det. */

// Sätts när Clerk-appen är skapad. Tom = inloggning avstängd, och då
// svarar den skyddade vägen 503 i stället för att släppa igenom något.
export const CLERK_PUBLISHABLE_KEY = "";

// Sidor som får be om skyddad data. Förhandsversioner på pages.dev
// ingår, så en gren kan provas skarpt innan den når cupschema.se.
export function tillåtetUrsprung(ursprung) {
  return ursprung === "https://cupschema.se" ||
    ursprung === "https://www.cupschema.se" ||
    /^https:\/\/([a-z0-9-]+\.)?cupschema\.pages\.dev$/.test(ursprung) ||
    ursprung === "http://localhost:8127";
}

/* Vilken nivå varje skyddad fil kräver. Det här är raden som ändras när
   betalningen kommer: scorers går då från "inloggad" till "full". */
export function kravFör(fil) {
  if (/^scorers-[a-z0-9]+\.json$/.test(fil)) return "inloggad";
  return null; // okänd fil: finns inte
}
