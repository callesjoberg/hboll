/* club-badge.js — fallbackmärke när ett klubbmärke saknas. */

import { detectTeamColor } from "./club.js";

// Samma deterministiska fallbackpalett oavsett dator/webbläsare — ett
// klubbnamn ger alltid samma färg (om det inte redan har ett färgord,
// t.ex. "Lödde HK Blå", då vinner det ordet precis som lagfärgprickarna).
export const CLUB_BADGE_PALETTE = [
  "#1f5fbf", "#d22f27", "#2f9e44", "#e8730c", "#8b5cf6", "#0e9aa7", "#c9384f", "#5b6b7a",
];

export function clubBadgeColor(name) {
  const detected = detectTeamColor(name);
  if (detected) return detected;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CLUB_BADGE_PALETTE[Math.abs(hash) % CLUB_BADGE_PALETTE.length];
}

// "Alingsås HK" → "AHK", "IFK Kristianstad" → "IK", "Lugi HF" → "LHF" —
// sista ordet är ofta en versal klubbförkortning (HK/IF/IK/HF/BK …); då
// blir initialerna första bokstaven + hela den förkortningen, annars
// första bokstaven i varje ord.
export function clubInitials(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  const last = words[words.length - 1];
  if (/^[A-ZÅÄÖ]{2,3}$/.test(last)) return (words[0][0] + last).toUpperCase().slice(0, 4);
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 3);
}

export function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

// Ren inline-SVG (ingen extern bild att hämta/spara) — en färgad cirkel
// med klubbens initialer, samma idé som avatar-bokstäver i t.ex. Gmail.
export function clubBadgeDataUri(name) {
  const initials = clubInitials(name);
  const color = clubBadgeColor(name);
  const fontSize = initials.length >= 4 ? 13 : 15;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<circle cx="20" cy="20" r="20" fill="' + color + '"/>' +
    '<text x="20" y="21" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="Barlow Condensed, Arial, sans-serif" font-weight="700" ' +
    'font-size="' + fontSize + '" fill="#fff">' + escapeXml(initials) + '</text></svg>';
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
