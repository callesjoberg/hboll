/* config.js — cuper och klubb. Lägg till en cup: hitta turnerings-ID genom att
   öppna cupens resultatsida på cupmanager.net och läsa "tournamentId: NNNN"
   i sidans källkod (eller använd "+ Lägg till cup" i sidfoten). */

window.HB = window.HB || {};

HB.CLUB = {
  name: "Alingsås HK",
  // Lagnamn i Cup Manager börjar med klubbnamnet ("Alingsås HK Blå" osv.)
  pattern: /^alings[åa]s\s*hk/i,
  logo: "assets/ahk-logo.svg",
};

HB.CUPS = [
  {
    id: "ahus",
    name: "Åhus Beach",
    place: "Åhus",
    edition: "2026",
    host: "ahusbeachhandboll.cupmanager.net",
    tournamentId: 70944382,
    beach: true,
  },
  {
    id: "potatis",
    name: "Potatiscupen",
    place: "Alingsås",
    edition: "2026",
    host: "potatiscupen.cupmanager.net",
    tournamentId: 67026461,
    beach: false,
  },
  {
    id: "hallby",
    name: "Hallbybollen",
    place: "Jönköping",
    edition: "2026",
    host: "hallbybollen.cupmanager.net",
    tournamentId: 63611315,
    beach: false,
  },
  {
    id: "bua",
    name: "Bua Beach",
    place: "Bua/Varberg",
    edition: "2026",
    host: "hkvarbergbeachhandboll.cupmanager.net",
    tournamentId: 69938110,
    beach: true,
  },
  {
    id: "bohus",
    name: "Bohus Cup",
    place: "Kungälv",
    edition: "2026",
    host: "bohuscup.cupmanager.net",
    tournamentId: 69150040,
    beach: false,
  },
  {
    // Kör ProCup (utan CORS/JSON-API): datan förhämtas av
    // scripts/fetch_procup.py via GitHub Actions till data/-katalogen.
    id: "jarnvagen",
    name: "Järnvägen Cup",
    place: "Hallsberg",
    edition: "2026",
    host: "procup.se",
    dataUrl: "data/jarnvagen-2026.json",
    beach: false,
  },
];

// Egna cuper som användaren lagt till via UI:t (sparas i localStorage).
HB.customCups = function () {
  try { return JSON.parse(localStorage.getItem("hb:customCups") || "[]"); }
  catch { return []; }
};

HB.allCups = function () {
  return HB.CUPS.concat(HB.customCups());
};
