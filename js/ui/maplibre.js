/* maplibre.js — gemensam, lat MapLibre-laddning. */

const MAPLIBRE_VERSION = "4.7.1";
let mapLibreLoadPromise = null;

export function ensureMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibreLoadPromise) return mapLibreLoadPromise;
  mapLibreLoadPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.css";
    document.head.append(css);
    const script = document.createElement("script");
    // crossOrigin: unpkg skickar Access-Control-Allow-Origin: *, och utan
    // attributet döljer webbläsaren ALLA fel från skriptet bakom det
    // intetsägande "Script error." — utan fil, rad eller stack. Med det
    // satt går ett MapLibre-fel att felsöka i stället för att bara gissa.
    script.crossOrigin = "anonymous";
    script.src = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.js";
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => reject(new Error("kunde inte nås (kontrollera nätet)"));
    document.head.append(script);
  });
  return mapLibreLoadPromise;
}
