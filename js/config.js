/* config.js — klubb + reservlista med cuper.
   Den skarpa cuplistan bor i data/cups.json och redigeras enklast via
   admin.html (kräver GitHub-token). Listan här används bara som reserv om
   cups.json inte går att läsa. Turnerings-ID hittas i källkoden på cupens
   resultatsida på cupmanager.net ("tournamentId: NNNN"). */

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
    lat: 55.9167, lon: 14.2833,
  },
  {
    id: "potatis",
    name: "Potatiscupen",
    place: "Alingsås",
    edition: "2026",
    host: "potatiscupen.cupmanager.net",
    tournamentId: 67026461,
    beach: false,
    lat: 57.9303, lon: 12.5334,
  },
  {
    id: "hallby",
    name: "Hallbybollen",
    place: "Jönköping",
    edition: "2026",
    host: "hallbybollen.cupmanager.net",
    tournamentId: 63611315,
    beach: false,
    lat: 57.7815, lon: 14.1562,
  },
  {
    id: "bua",
    name: "Bua Beach",
    place: "Bua/Varberg",
    edition: "2026",
    host: "hkvarbergbeachhandboll.cupmanager.net",
    tournamentId: 69938110,
    beach: true,
    lat: 57.2378, lon: 12.1219,
  },
  {
    id: "bohus",
    name: "Bohus Cup",
    place: "Kungälv",
    edition: "2026",
    host: "bohuscup.cupmanager.net",
    tournamentId: 69150040,
    beach: false,
    lat: 57.8710, lon: 11.9805,
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
    lat: 59.0646, lon: 15.1099,
  },
  {
    // "Gothia Result Web"-plattformen (delas med Gothia Cup), inte Cup
    // Manager trots domänen — datan förhämtas av scripts/fetch_gothia.py.
    // hasPlayoffs: true eftersom den skrapan (till skillnad från ProCup)
    // bygger en riktig slutspelsstruktur.
    id: "partille",
    name: "Partille Cup",
    place: "Partille",
    edition: "2026",
    host: "results.partillecup.com",
    dataUrl: "data/partille-2026.json",
    hasPlayoffs: true,
    beach: false,
    lat: 57.7395, lon: 12.1064,
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
