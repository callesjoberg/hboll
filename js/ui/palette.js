/* palette.js — delade färger för jämförelsevyer. */

// Delad palett för "flera saker jämförs samtidigt"-vyer (Trend-
// jämförelsegrafen, Kartans flercupsläge) — rena hex-värden, INTE CSS-
// variabler: MapLibre-markörernas SVG-fill löser inte pålitligt var() i
// alla webbläsare (till skillnad från inline-SVG:ns stroke, se
// buildTrendCompareSvg, där CSS-variabler fungerar fint). MAP_SHARED_COLOR
// (samma blå som Kartans tidigare enda markörfärg) är reserverad för
// "klubben spelar i FLERA av de valda cuperna" — får INTE återanvändas i
// MAP_CUP_COLORS, annars går det inte att skilja "unik för cup #1" från
// "delad" när cup #1 råkar få den färgen.
export const MAP_SHARED_COLOR = "#1f5fbf";
export const MAP_CUP_COLORS = ["#e0a72a", "#c8660a", "#2f9e44", "#8854d0", "#d22f27", "#12a89d", "#c2528f"];
export const MULTI_COLOR_PALETTE = [MAP_SHARED_COLOR, ...MAP_CUP_COLORS];
