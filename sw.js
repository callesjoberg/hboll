/* sw.js — minimal service worker, bara för att uppfylla PWA-installations-
   kraven och ge offline-tillgång till app-skalet (HTML/CSS/JS/ikoner).

   Nätverk-först, inte cache-först: sidan uppdateras ofta, och en
   cache-först-strategi skulle kunna visa en gammal version även efter
   en hård omladdning. Cachen används bara som fallback när nätet
   är nere. Cup Manager-, Open-Meteo- och data/*.json-anrop rörs aldrig
   här — appen har redan sin egen, mer träffsäkra cachningslogik för den
   datan (se js/api.js). */

// Sätts av scripts/bump_assets.py till samma versionsnyckel som
// index.html använder. activate-handlern nedan raderar alla cacher med
// ett ANNAT namn, så ett nytt namn är det enda som garanterat tömmer en
// gammal, envis skalcache (nätverk-först räcker inte om ett enskilt
// anrop råkar falla tillbaka).
const CACHE_NAME = "hboll-shell-20260905n";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./hjalp.html",
  "./css/style.css",
  "./js/config.js",
  "./js/api.js",
  "./js/ics.js",
  "./js/export.js",
  "./js/weather.js",
  "./js/qr.js",
  "./js/welcome.js",
  "./js/app.js",
  "./js/time.js",
  "./js/dom.js",
  "./js/filters.js",
  "./js/url-state.js",
  "./js/domain/category.js",
  "./js/domain/club.js",
  "./js/domain/club-badge.js",
  "./js/domain/club-match.js",
  "./js/domain/match.js",
  "./js/domain/match-length.js",
  "./js/domain/live-gap.js",
  "./js/domain/tables.js",
  "./js/domain/cup.js",
  "./js/domain/placeholder.js",
  "./js/domain/countries.js",
  "./js/domain/calendar.js",
  "./js/domain/refresh.js",
  "./js/domain/archive.js",
  "./js/domain/playoff.js",
  "./js/ui/chrome.js",
  "./js/ui/controls.js",
  "./js/ui/sheets.js",
  "./js/ui/nav.js",
  "./js/ui/toolbar.js",
  "./js/ui/share.js",
  "./js/ui/match-ui.js",
  "./js/ui/reveal.js",
  "./js/ui/schema.js",
  "./js/ui/playoffs.js",
  "./js/ui/palette.js",
  "./js/ui/maplibre.js",
  "./js/ui/map.js",
  "./js/ui/stats.js",
  "./manifest.json",
  "./assets/ahk-logo.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(SHELL_FILES))
      .catch(() => {}) // en enskild 404 ska inte stoppa installationen
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.includes("/data/")) return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      // ignoreSearch: moduler hämtas med ?v=<nyckel> via importmappen i
      // index.html, medan SHELL_FILES ovan cachas utan nyckel.
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
