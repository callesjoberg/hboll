/* sw.js — minimal service worker, bara för att uppfylla PWA-installations-
   kraven och ge offline-tillgång till app-skalet (HTML/CSS/JS/ikoner).

   Nätverk-först, inte cache-först: sidan uppdateras ofta, och en
   cache-först-strategi skulle kunna visa en gammal version även efter
   en hård omladdning. Cachen används bara som fallback när nätet
   är nere. Cup Manager-, Open-Meteo- och data/*.json-anrop rörs aldrig
   här — appen har redan sin egen, mer träffsäkra cachningslogik för den
   datan (se js/api.js). */

const CACHE_NAME = "hboll-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/api.js",
  "./js/ics.js",
  "./js/export.js",
  "./js/weather.js",
  "./js/app.js",
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
      .catch(() => caches.match(e.request))
  );
});
