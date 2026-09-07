/* config.js — klubb + reservlista med cuper.
   Den skarpa cuplistan bor i data/cups.json och redigeras enklast via
   admin.html (kräver GitHub-token). Listan här används bara som reserv om
   cups.json inte går att läsa. Turnerings-ID hittas i källkoden på cupens
   resultatsida på cupmanager.net ("tournamentId: NNNN"). */

window.HB = window.HB || {};

// Var datan bor. Tom sträng = samma ursprung som sajten, precis som förut.
// Sätts till t.ex. "https://data.cupschema.se" när snapshots och arkiv
// flyttat till objektlagring — då slutar en datauppdatering vara en
// ombyggnad av hela sajten, vilket är det som spränger byggkvoten under
// matchtid (12 push/tim mot GitHub Pages tak på 10).
//
// ALLA datahämtningar i klienten går genom HB.dataUrl(). Lägger man till en
// ny, använd den — annars pekar just den filen fel den dag basen ändras.
// Service workern rör inget av det här: den hoppar över både cross-origin
// och allt med /data/ i sökvägen (se sw.js).
HB.DATA_BASE = "https://data.cupschema.se";

HB.dataUrl = function (path) {
  if (!HB.DATA_BASE || !path) return path;
  // Redan absolut? Lämna orörd. Två skäl: snapshot-index.json bär sina egna
  // url-fält och en cup kan ha en dataUrl som pekar utanför oss, och då ska
  // basen inte klistras på. Gör också funktionen idempotent, så att ett
  // anrop på en redan omskriven sökväg är ofarligt.
  if (/^(https?:)?\/\//i.test(path)) return path;
  return HB.DATA_BASE.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
};

// Synligt versionsmärke (Inställningar, längst ned) och HB.VERSION i
// konsolen. Finns för att kunna svara på "kör du senaste versionen?" —
// en cachad service worker kan annars servera gammal kod hur länge som
// helst utan att vare sig användaren eller utvecklaren märker det.
// SÄTTS AV scripts/bump_assets.py, samma nyckel som ?v= och CACHE_NAME.
// Redigera inte för hand: den stod länge kvar på ett datum två veckor
// bakåt just för att den var det enda stället som krävde ett eget
// handgrepp.
HB.VERSION = "20260907af";

HB.CLUB = {
  name: "Alingsås HK",
  // Lagnamn i Cup Manager börjar med klubbnamnet ("Alingsås HK Blå" osv.)
  pattern: /^alings[åa]s\s*hk/i,
  logo: "assets/ahk-logo.svg",
};

// GENERERAD ur data/cups.json av scripts/bump_assets.py — redigera
// inte för hand. Används bara som reserv när cups.json inte går att
// läsa; den skarpa listan hämtas alltid därifrån (se loadCup i app.js).
HB.CUPS = [
  {"beach": true, "edition": "2026", "host": "ahusbeachhandboll.cupmanager.net", "id": "ahus", "lat": 55.9167, "lon": 14.2833, "name": "Åhus Beach", "place": "Åhus", "sport": "handboll", "tournamentId": 70944382},
  {"beach": false, "edition": "2026", "host": "potatiscupen.cupmanager.net", "id": "potatis", "lat": 57.9303, "lon": 12.5334, "name": "Potatiscupen", "place": "Alingsås", "sport": "handboll", "tournamentId": 67026461},
  {"beach": false, "edition": "2026", "host": "hallbybollen.cupmanager.net", "id": "hallby", "lat": 57.7815, "lon": 14.1562, "name": "Hallbybollen", "place": "Jönköping", "sport": "handboll", "tournamentId": 63611315},
  {"beach": true, "edition": "2026", "host": "hkvarbergbeachhandboll.cupmanager.net", "id": "bua", "lat": 57.2378, "lon": 12.1219, "name": "Bua Beach", "place": "Bua/Varberg", "sport": "handboll", "tournamentId": 69938110},
  {"beach": false, "edition": "2026", "host": "bohuscup.cupmanager.net", "id": "bohus", "lat": 57.871, "lon": 11.9805, "name": "Bohus Cup", "place": "Kungälv", "sport": "handboll", "tournamentId": 69150040},
  {"beach": false, "dataUrl": "data/jarnvagen-2026.json", "edition": "2026", "host": "procup.se", "id": "jarnvagen", "lat": 59.0646, "lon": 15.1099, "name": "Järnvägen Cup", "place": "Hallsberg", "sport": "handboll"},
  {"beach": false, "calendarHost": "results.cupmanager.net", "dataUrl": "data/partille-2026.json", "edition": "2026", "hasPlayoffs": true, "hasRosters": true, "host": "results.partillecup.com", "id": "partille", "lat": 57.7395, "lon": 12.1064, "name": "Partille Cup", "place": "Partille", "sport": "handboll"},
  {"beach": false, "edition": "2026", "host": "skadevihandboll.cupmanager.net", "id": "skadevi", "lat": 58.391, "lon": 13.8454, "name": "Skadevi Handbollscup", "place": "Skövde", "sport": "handboll", "tournamentId": 73513085},
  {"beach": false, "edition": "2026", "host": "helltoncup.cupmanager.net", "id": "hellton", "lat": 59.3793, "lon": 13.5036, "name": "Hellton Cup", "place": "Karlstad", "sport": "handboll", "tournamentId": 75678071},
  {"beach": false, "edition": "2026", "host": "lundaspelen.cupmanager.net", "id": "lundaspelen", "lat": 55.7047, "lon": 13.191, "name": "Lundaspelen", "place": "Lund", "sport": "handboll", "tournamentId": 76285495},
  {"beach": false, "edition": "2026", "host": "nordencup.cupmanager.net", "id": "norden", "lat": 57.7089, "lon": 11.9746, "name": "Norden Cup", "place": "Göteborg", "sport": "handboll", "tournamentId": 76037575},
  {"beach": false, "edition": "2026", "host": "ekencup.cupmanager.net", "id": "eken", "lat": 59.2738, "lon": 18.087, "name": "Eken Cup", "place": "Stockholm", "sport": "handboll", "tournamentId": 69947527},
  {"beach": false, "edition": "2026", "host": "orebrohandboll.cupmanager.net", "id": "orebro", "lat": 59.2741, "lon": 15.2066, "name": "Örebrocupen Handboll", "place": "Örebro", "sport": "handboll", "tournamentId": 72655435},
  {"beach": false, "edition": "2026", "host": "goteborgcup.cupmanager.net", "id": "goteborgcup", "lat": 57.7089, "lon": 11.9746, "name": "Göteborg Cup Handboll", "place": "Göteborg", "sport": "handboll", "tournamentId": 72459189},
  {"beach": false, "edition": "2026", "host": "irstablixten.cupmanager.net", "id": "irstablixten", "lat": 59.6295, "lon": 16.6015, "name": "IrstaBlixten", "place": "Västerås", "sport": "handboll", "tournamentId": 65542011},
  {"beach": false, "edition": "2026", "host": "junicupen.cupmanager.net", "id": "junicupen", "lat": 58.3498, "lon": 11.9422, "name": "Junicupen", "place": "Uddevalla", "sport": "handboll", "tournamentId": 69888831},
  {"beach": false, "edition": "2026", "host": "gifsundsvallcup.cupmanager.net", "id": "sundsvall", "lat": 62.3908, "lon": 17.3069, "name": "GIF Sundsvall Cup", "place": "Sundsvall", "sport": "fotboll", "tournamentId": 61576575},
  {"beach": false, "edition": "2026", "host": "tyresocup.cupmanager.net", "id": "tyreso", "lat": 59.2489, "lon": 18.2266, "name": "Tyresö Cup", "place": "Tyresö", "sport": "handboll", "tournamentId": 65920031},
  {"beach": false, "edition": "2026", "host": "skurucupen.cupmanager.net", "id": "skuru", "lat": 59.3103, "lon": 18.1638, "name": "Skurucupen", "place": "Nacka", "sport": "handboll", "tournamentId": 72717882},
  {"beach": false, "dataUrl": "data/vikingaspelen-2026.json", "edition": "2026", "host": "procup.se", "id": "vikingaspelen", "lat": 55.7967, "lon": 13.1024, "name": "Vikingaspelen", "place": "Löddeköpinge", "sport": "handboll"},
  {"beach": false, "dataUrl": "data/katrineholm-2026.json", "edition": "2026", "host": "procup.se", "id": "katrineholm", "lat": 58.9948, "lon": 16.211, "name": "Katrineholm Handboll Cup", "place": "Katrineholm", "sport": "handboll"},
  {"beach": false, "dataUrl": "data/aranas-2025.json", "edition": "2025", "host": "procup.se", "id": "aranas", "lat": 57.4878, "lon": 12.0765, "name": "Aranäs Open", "place": "Kungsbacka", "sport": "handboll"},
  {"beach": true, "edition": "2026", "host": "goteborgbeachfestival.cupmanager.net", "id": "goteborgbeach", "lat": 57.7646, "lon": 11.8006, "name": "Göteborg Beachfestival", "place": "Björlanda, Göteborg", "sport": "handboll", "tournamentId": 73897776},
  {"beach": false, "edition": "2026", "host": "goteborgcupfotboll.cupmanager.net", "id": "goteborgfotboll", "lat": 57.7089, "lon": 11.9746, "name": "Göteborg Cup Fotboll", "place": "Göteborg", "sport": "fotboll", "tournamentId": 69886549},
  {"beach": false, "calendarHost": "results.cupmanager.net", "dataUrl": "data/gothiacup-2026.json", "edition": "2026", "hasPlayoffs": true, "hasRosters": true, "host": "results.gothiacup.se", "id": "gothiacup", "lat": 57.7089, "lon": 11.9746, "name": "Gothia Cup", "place": "Göteborg", "sport": "fotboll"},
  {"beach": false, "edition": "2026", "host": "pitea.cupmanager.net", "id": "piteasummergames", "lat": 65.3172, "lon": 21.4793, "name": "Piteå Summer Games", "place": "Piteå", "sport": "fotboll", "tournamentId": 70489076},
  {"beach": false, "edition": "2026", "host": "umeafotbollsfestival.com", "id": "umeafotbollsfestival", "lat": 63.8258, "lon": 20.263, "name": "Umeå Fotbollsfestival", "place": "Umeå", "sport": "fotboll", "tournamentId": 70942665},
  {"beach": false, "edition": "2026", "host": "selectcup.cupmanager.net", "id": "selectcup", "lat": 59.2741, "lon": 15.2066, "name": "Select Cup", "place": "Örebro", "sport": "fotboll", "tournamentId": 73344284},
  {"beach": false, "edition": "2026", "host": "storvretacupen.cupmanager.net", "id": "storvretacupen", "indoor": true, "lat": 59.8586, "lon": 17.6389, "name": "Storvretacupen", "place": "Uppsala", "sport": "innebandy", "tournamentId": 75761740},
  {"beach": false, "calendarHost": "results.cupmanager.net", "dataUrl": "data/gothiainnebandy-2026.json", "edition": "2026", "hasPlayoffs": true, "hasRosters": true, "host": "results.gothiainnebandycup.se", "id": "gothiainnebandy", "indoor": true, "lat": 57.7089, "lon": 11.9746, "name": "Gothia Innebandy Cup", "place": "Göteborg", "sport": "innebandy"},
  {"beach": false, "edition": "2026", "host": "linkopingfloorballgames.cupmanager.net", "id": "linkopingfloorball", "indoor": true, "lat": 58.4108, "lon": 15.6214, "name": "Linköping Floorball Games", "place": "Linköping", "sport": "innebandy", "tournamentId": 67335407},
  {"beach": false, "edition": "2026", "host": "basketballfestival.se", "id": "goteborgbasket", "indoor": true, "lat": 57.7089, "lon": 11.9746, "name": "Göteborg Basketball Festival", "place": "Göteborg", "sport": "basket", "tournamentId": 67783971},
  {"beach": false, "edition": "2026", "host": "basketshopopen.cupmanager.net", "id": "basketshopopen", "indoor": true, "lat": 59.3607, "lon": 17.9715, "name": "Basketshop Open", "place": "Solna/Sundbyberg", "sport": "basket", "tournamentId": 69886261},
  {"beach": false, "edition": "2026", "host": "kungsbackabasketcup.cupmanager.net", "id": "kungsbackabasket", "indoor": true, "lat": 57.4878, "lon": 12.0765, "name": "Kungsbacka Basketcup", "place": "Kungsbacka", "sport": "basket", "tournamentId": 72460633},
];

HB.allCups = function () {
  // Alla publika cuper måste ha en centralt byggd snapshot. Den tidigare
  // lokala "lägg till cup"-vägen gjorde varje besökares webbläsare till en
  // egen API-klient och är därför avsiktligt borttagen.
  return HB.CUPS;
};
