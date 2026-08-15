#!/usr/bin/env node

// Hämtar aktiva svenska handbollsklubbars egna, publikt uppladdade märken
// från Svenska Handbollförbundets Profixio-register. Resultatet sparas
// lokalt så den publika appen aldrig behöver kontakta Profixio/Cloudinary.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "club-logos");
const MANIFEST_PATH = path.join(ROOT, "data", "club-logos.json");
const DISTRICTS = [802, 803, 804, 805, 806]; // Öst, Väst, Syd, Norr, Mitt
const DISTRICT_URL = (id) => `https://www.profixio.com/app/lx/SHF/district/${id}?t=clubs`;
const CLOUDINARY_BASE =
  "https://res.cloudinary.com/profixio/image/upload/c_pad,f_png,h_192,q_auto,w_192/v1/logos/gklubb/";

function slug(value) {
  return String(value || "").toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clubCore(value) {
  const noise = new Set([
    "hk", "hf", "hbk", "hb", "handboll", "handball", "handbollsklubb",
    "handbollsklubben", "handbollsforening", "handbollforening", "forening",
    "foreningen",
  ]);
  return slug(value).split("-").filter((part) => part && !noise.has(part)).join("-");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function clubsFromHtml(html, district) {
  const clubs = [];
  for (const match of html.matchAll(/<tr[^>]+wire:key="club-(\d+)"[\s\S]*?<\/tr>/g)) {
    const id = match[1];
    const row = match[0];
    const anchor = row.match(new RegExp(
      `href="https://www\\.profixio\\.com/app/lx/clubs/${id}"[\\s\\S]*?>([\\s\\S]*?)<\\/a>`));
    if (!anchor) continue;
    const name = decodeHtml(anchor[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    const image = row.match(/logos\/gklubb\/([^'"?\s<]+)/);
    if (!name) continue;
    clubs.push({ id, name, district, imageKey: image ? image[1] : null });
  }
  return clubs;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function knownClubNames() {
  const names = new Set();
  for (const file of ["data/club-directory.json", "data/club-directory-extra.json"]) {
    try {
      const data = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
      Object.keys(data || {}).forEach((name) => names.add(name));
    } catch { /* katalogen är ett komplement, inte ett krav */ }
  }
  const dataDir = path.join(ROOT, "data");
  const { readdir } = await import("node:fs/promises");
  for (const file of await readdir(dataDir)) {
    if (!/^snapshot-.*\.json$/.test(file) || file === "snapshot-index.json") continue;
    try {
      const data = JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
      for (const match of data.matches || []) {
        for (const team of [match.home, match.away]) {
          if (team && team.club) names.add(team.club);
        }
      }
    } catch { /* en trasig/halvskriven snapshot ska inte stoppa biblioteket */ }
  }
  return names;
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

await mkdir(OUT_DIR, { recursive: true });

const pages = await Promise.all(DISTRICTS.map(async (district) => ({
  district,
  html: await fetchText(DISTRICT_URL(district)),
})));
const bySlug = new Map();
for (const { district, html } of pages) {
  for (const club of clubsFromHtml(html, district)) {
    const key = slug(club.name);
    const old = bySlug.get(key);
    if (!old || (!old.imageKey && club.imageKey)) bySlug.set(key, club);
  }
}

const official = [...bySlug.values()].filter((club) => club.imageKey);
let downloaded = 0;
let failed = 0;
await mapLimit(official, 12, async (club) => {
  const file = `${slug(club.name)}.png`;
  const sourceImage = CLOUDINARY_BASE + club.imageKey;
  try {
    const response = await fetch(sourceImage, { headers: { accept: "image/png" } });
    if (!response.ok) throw new Error(String(response.status));
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length < 100) throw new Error("för liten bild");
    await writeFile(path.join(OUT_DIR, file), body);
    club.file = `assets/club-logos/${file}`;
    club.sourceImage = sourceImage;
    downloaded++;
  } catch (error) {
    club.error = String(error && error.message || error);
    failed++;
  }
});

const logos = {};
for (const club of official.filter((entry) => entry.file)) {
  logos[slug(club.name)] = {
    name: club.name,
    file: club.file,
    source: `https://www.profixio.com/app/lx/clubs/${club.id}`,
    sourceImage: club.sourceImage,
    profixioId: Number(club.id),
    district: club.district,
  };
}

// Behåll den handgjorda högupplösta AHK-vektorn som appen redan använder.
logos[slug("Alingsås HK")] = {
  ...(logos[slug("Alingsås HK")] || {}),
  name: "Alingsås HK",
  file: "assets/ahk-logo.svg",
};

// Lägg till exakta namnvarianter ur cupdatan när de normaliseras till ett
// redan känt officiellt namn. Mer aggressiv fuzzy-matchning är avsiktligt
// förbjuden: fel klubbmärke är sämre än initialbadgen.
const knownNames = await knownClubNames();
const coreIndex = new Map();
for (const club of official.filter((entry) => entry.file)) {
  const core = clubCore(club.name);
  if (!core) continue;
  const list = coreIndex.get(core) || [];
  list.push(club);
  coreIndex.set(core, list);
}
for (const name of knownNames) {
  const key = slug(name);
  if (logos[key]) continue;
  const core = clubCore(name);
  let candidates = coreIndex.get(core) || [];
  // En enda bokstavs böjning är vanlig i cupdata: "Anderstorp SK" mot
  // förbundets "Anderstorps SK". Tillåt bara en unik närträff och bara för
  // en någorlunda lång kärna; korta namn som AIK/GUIF gissas aldrig.
  if (!candidates.length && core.length >= 6) {
    candidates = [...coreIndex.entries()]
      .filter(([candidate]) => editDistance(core, candidate) === 1)
      .flatMap(([, clubs]) => clubs);
  }
  if (candidates.length === 1) {
    logos[key] = { ...logos[slug(candidates[0].name)], alias: name };
  }
}

const missingRegistryLogos = [...bySlug.values()]
  .filter((club) => !club.imageKey)
  .map((club) => ({ name: club.name, profixioId: Number(club.id), district: club.district }))
  .sort((a, b) => a.name.localeCompare(b.name, "sv"));
const unmatchedKnownClubs = [...knownNames]
  .filter((name) => !logos[slug(name)])
  .sort((a, b) => a.localeCompare(b, "sv"));

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: "Svenska Handbollförbundets publika Profixio-register",
  districts: DISTRICTS,
  registeredClubs: bySlug.size,
  downloaded,
  failed,
  missingRegistryLogos,
  unmatchedKnownClubs,
  logos: Object.fromEntries(Object.entries(logos).sort(([a], [b]) => a.localeCompare(b, "sv"))),
};
await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

console.log(JSON.stringify({ registered: bySlug.size, downloaded, failed, manifest: MANIFEST_PATH }, null, 2));
