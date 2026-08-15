#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/landing-map.json: en lätt katalog över geografiska punkter
per cup, bara till för den animerade kart-bakgrunden på välkomstskärmen
för nya besökare (js/welcome.js) — INTE samma sak som Kartan-fliken i
själva appen, som slår upp riktiga adresser dynamiskt.

ALLA cuper i data/cups.json ska finnas med, och alla ska visa så många
LAG-punkter som möjligt (så cupens storlek syns). Varje lag plottas på
den mest exakta nivå datan tillåter — samma tre-nivåtänk som Kartan-
fliken, plus en visuell färgkodning så man ser hur säker placeringen är:

  tier 0  KÄND ADRESS   — lagnamnet matchar en klubb i data/club-directory.json
                          (via ClubIndex, en portering av matchClubName i
                          js/app.js). Plottas på klubbens riktiga koordinat.
  tier 1  BARA LAND      — ingen adress, men en landskod finns (t ex de flesta
                          utländska Partille-lagen). Plottas slumpmässigt inom
                          landets gränser (COUNTRY_BBOX, annars centroid+jitter).
  tier 2  INGEN GEODATA  — varken adress eller land. Plottas nära tyngdpunkten
                          av cupens övriga punkter, så cupens storlek ändå syns.

Punkterna sparas som [lat, lng, tier] så js/welcome.js kan färga dem olika.

Lagen läses ur den SENASTE spelade arkivupplagan (finished>0 i
data/archive/index.json — en cup vars nästa upplaga lagts upp men inte
spelats faller tillbaka till föregående år, och rena slutspelsplatshållare
som "Vinn. 06091905" filtreras bort, se PLACEHOLDER_NAME).

En cup som helt saknar lag i databasen (t ex en ny cup vars enda upplaga
ännu inte spelats/fått anmälningar, som Skurucupen och Norden Cup) tas
HELT bort ur filen — den ska varken rulla i loopen eller gå att välja i
cup-väljaren förrän den har riktig data.

Körs sist i workflowet (ren stdlib, inget nätverksanrop, läser bara redan
skrapad data) — bygger om automatiskt när en cup får nya/fler lag."""

import hashlib
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from find_unknown_clubs import ClubIndex  # noqa: E402  (portering av matchClubName)

ROOT = Path(__file__).resolve().parent.parent
MAX_POINTS = 320  # var och en ritas med en egen glow varje bildruta — ett tak håller
                   # animationen mjuk även för proppfulla cuper (Partille, Lundaspelen).
                   # Det RIKTIGA antalet lag sparas separat (count) för visning.

# Grova landbounding-boxar (lat_min, lat_max, lng_min, lng_max) för tier 1
# ("bara land känt") — ett lag utan adress men med landskod slumpas inom
# denna ruta i stället för att klumpas på landets centroid. Täcker de
# länder som faktiskt förekommer som tier 1 (Norden + Tyskland dominerar);
# övriga faller tillbaka på COUNTRY_CENTROIDS + jitter (se point_for_country),
# fullt tillräckligt eftersom de ändå bara ses vid kontinent-/världszoom.
COUNTRY_BBOX = {
    "SE": (55.3, 69.0, 11.1, 24.2), "NO": (58.0, 71.0, 4.5, 31.0),
    "DK": (54.6, 57.8, 8.1, 15.2), "FI": (59.8, 70.0, 20.6, 31.5),
    "IS": (63.3, 66.5, -24.5, -13.5), "FO": (61.4, 62.4, -7.7, -6.3),
    "DE": (47.3, 55.0, 5.9, 15.0), "NL": (50.8, 53.5, 3.4, 7.2),
    "BE": (49.5, 51.5, 2.5, 6.4), "FR": (42.5, 51.0, -4.7, 8.2),
    "CH": (45.8, 47.8, 6.0, 10.5), "AT": (46.4, 49.0, 9.5, 17.1),
    "PL": (49.0, 54.8, 14.1, 24.1), "CZ": (48.6, 51.0, 12.1, 18.9),
    "SK": (47.7, 49.6, 16.8, 22.6), "HU": (45.7, 48.6, 16.1, 22.9),
    "SI": (45.4, 46.9, 13.4, 16.6), "HR": (42.4, 46.5, 13.5, 19.4),
    "RS": (42.2, 46.2, 18.8, 23.0), "RO": (43.6, 48.3, 20.3, 29.7),
    "GR": (35.0, 41.7, 19.4, 28.2), "TR": (36.0, 42.0, 26.0, 44.8),
    "ES": (36.0, 43.7, -9.3, 3.3), "PT": (37.0, 42.1, -9.5, -6.2),
    "EE": (57.5, 59.7, 21.8, 28.2), "LT": (53.9, 56.4, 21.0, 26.8),
    "LV": (55.7, 58.1, 21.0, 28.2), "GE": (41.0, 43.6, 40.0, 46.7),
    "US": (25.0, 49.0, -124.7, -66.9), "BR": (-33.7, 5.2, -74.0, -34.8),
    "JP": (31.0, 45.5, 129.5, 145.8), "IN": (8.1, 35.5, 68.1, 97.4),
}


# Cup Manager/ProCup fyller i platshållarnamn för slutspelsplatser som
# ännu inte avgjorts — "Vinn. 06091905" (vinnare av match X), "3:an i
# Grupp B" osv. Det är inga riktiga lag och ska aldrig räknas eller plottas.
PLACEHOLDER_NAME = re.compile(
    r"^(vinn\.?|vinnare|förl\.?|förlorare|\d+\s*:?an\s+i\s+grupp|winner|tbd|bye|loser)\b", re.I)


def hash01(seed, part):
    # Deterministisk pseudo-slump i [0,1) ur en hash av seed (INTE Pythons
    # random — dess frön varierar mellan körningar, vilket skulle göra filen
    # till en meningslös diff varje CI-körning även utan datauppdatering).
    h = hashlib.md5(f"{seed}:{part}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) / 0x100000000


def point_in_bbox(seed, bbox):
    latmin, latmax, lngmin, lngmax = bbox
    # Medelvärde av två dragningar = triangulär fördelning som toppar i
    # mitten — färre punkter hamnar ute i hörnen (hav/grannland) för
    # oregelbundna länder, men spridningen täcker ändå hela rutan.
    flat = (hash01(seed, "a") + hash01(seed, "b")) / 2
    flng = (hash01(seed, "c") + hash01(seed, "d")) / 2
    return [round(latmin + flat * (latmax - latmin), 3),
            round(lngmin + flng * (lngmax - lngmin), 3)]


def point_for_country(seed, code, centroids):
    if code in COUNTRY_BBOX:
        return point_in_bbox(seed, COUNTRY_BBOX[code])
    if code in centroids:
        clat, clng = centroids[code]
        r = math.sqrt(hash01(seed, "r"))
        theta = hash01(seed, "t") * 2 * math.pi
        return [round(clat + math.cos(theta) * r * 1.1, 3),
                round(clng + math.sin(theta) * r * 1.6, 3)]
    return None


def cap_points(points):
    if len(points) <= MAX_POINTS:
        return points
    stride = len(points) / MAX_POINTS
    return [points[int(i * stride)] for i in range(MAX_POINTS)]


def load_country_centroids():
    # Samma tabell som COUNTRY_CENTROIDS i js/app.js (Kartan-fliken) —
    # parsas ur källan i stället för att dubbelhållas, så de två aldrig
    # kan glida isär.
    src = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    m = re.search(r"COUNTRY_CENTROIDS\s*=\s*\{(.*?)\};", src, re.S)
    body = m.group(1)
    out = {}
    for code, lng, lat in re.findall(r"([A-Z]{2}):\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]", body):
        out[code] = (float(lat), float(lng))
    return out


def latest_played_file(cup_id, archive_index):
    # Senaste upplaga som faktiskt hunnit spelas (finished>0), annars bästa
    # tillgängliga fil.
    entry = archive_index.get(cup_id) or {}
    editions = sorted(entry.get("editions", []), key=lambda e: e.get("edition", ""))
    for e in reversed(editions):
        if e.get("finished", 0) > 0:
            f = ROOT / e["file"]
            if f.exists():
                return f
    candidates = sorted((ROOT / "data" / "archive").glob(f"{cup_id}-*.json"))
    return candidates[-1] if candidates else None


def teams_of(cup_id, archive_index):
    # {lagnamn: landskod|None} för den senaste spelade upplagan, utan
    # slutspelsplatshållare. Ett lag räknas bara en gång.
    f = latest_played_file(cup_id, archive_index)
    if not f:
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return {}
    teams = {}
    for m in data.get("matches", []):
        for side in ("home", "away"):
            info = m.get(side) or {}
            name = (info.get("name") or "").strip()
            if not name or PLACEHOLDER_NAME.match(name):
                continue
            if name not in teams:
                teams[name] = info.get("country")
    return teams


def build_cup_points(cup_id, teams, idx, centroids):
    """Returnerar (points, countries) där points = [[lat,lng,tier],...].
    tier 0=känd adress, 1=bara land, 2=ingen geodata."""
    tier0, tier1, deferred = [], [], []  # deferred = tier 2, placeras sist
    countries = set()
    for name, code in teams.items():
        seed = f"{cup_id}:{name}"
        club = idx.match(name)
        if club:
            info = idx.directory[club]
            tier0.append([round(info["lat"], 3), round(info["lng"], 3), 0])
            if info.get("country"):
                countries.add(info["country"])
        elif code and (code in COUNTRY_BBOX or code in centroids):
            countries.add(code)
            p = point_for_country(seed, code, centroids)
            if p:
                tier1.append([p[0], p[1], 1])
            else:
                deferred.append(name)
        else:
            deferred.append(name)

    placed = tier0 + tier1
    # tier 2: nära där DE FLESTA andra prickarna redan är, så lag utan
    # geodata inte hamnar långt bort. MEDIANEN (inte medelvärdet) används:
    # för en internationell cup (Partille — svensk tyngd men lag från hela
    # världen) hamnar medelvärdet ute i havet mellan kontinenterna, medan
    # medianen landar mitt i den täta svenska klungan där ögat ändå är.
    if placed:
        lats = sorted(p[0] for p in placed)
        lngs = sorted(p[1] for p in placed)
        mid = len(placed) // 2
        clat, clng = lats[mid], lngs[mid]
    else:
        clat = clng = None
    tier2 = []
    for name in deferred:
        if clat is None:
            continue  # inget att gruppera kring — hoppa (cupen får värdortsfallback)
        seed = f"{cup_id}:{name}"
        r = math.sqrt(hash01(seed, "r"))
        theta = hash01(seed, "t") * 2 * math.pi
        tier2.append([round(clat + math.cos(theta) * r * 0.6, 3),
                      round(clng + math.sin(theta) * r * 0.9, 3), 2])
    return tier0 + tier1 + tier2, countries


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    centroids = load_country_centroids()
    directory = json.loads((ROOT / "data" / "club-directory.json").read_text(encoding="utf-8"))
    idx = ClubIndex(directory)
    ai_path = ROOT / "data" / "archive" / "index.json"
    archive_index = json.loads(ai_path.read_text(encoding="utf-8")) if ai_path.exists() else {}

    out = {}
    all_countries = set()
    countries_by_sport = {}
    skipped = []
    for c in cups:
        cup_id = c["id"]
        teams = teams_of(cup_id, archive_index)
        points, countries = build_cup_points(cup_id, teams, idx, centroids)
        if not points:
            # Cupen har inga lag i databasen än (t ex Skurucupen/Norden Cup:
            # bara en framtida, ännu ospelad upplaga utan anmälda lag) — tas
            # helt bort ur välkomstloopen och cup-väljaren i stället för att
            # visas som en ensam, meningslös värdortsprick. Dyker upp av sig
            # själv så fort riktiga lag/matcher finns.
            skipped.append(cup_id)
            continue
        all_countries |= countries
        sport = c.get("sport") or "handboll"
        countries_by_sport.setdefault(sport, set()).update(countries)
        out[cup_id] = {
            "name": c["name"], "sport": sport,
            "count": len(teams), "countries": len(countries),
            "points": cap_points(points), "_src": "lag",
        }

    out_path = ROOT / "data" / "landing-map.json"
    slim = {k: {"name": v["name"], "sport": v["sport"], "count": v["count"],
                "countries": v["countries"], "points": v["points"]}
            for k, v in out.items()}
    slim["_meta"] = {
        "totalCountries": len(all_countries),
        "countriesBySport": {sport: len(countries) for sport, countries in countries_by_sport.items()},
    }
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old == slim:
        print(f"landing-map.json: oförändrad ({len(out)} cuper)")
        return
    out_path.write_text(
        json.dumps(slim, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    total_points = sum(len(v["points"]) for k, v in slim.items() if k != "_meta")
    # Tier-fördelning för en snabb överblick i loggen
    tiers = [0, 0, 0]
    for k, v in slim.items():
        if k == "_meta":
            continue
        for p in v["points"]:
            tiers[p[2]] += 1
    msg = (f"skrev landing-map.json: {len(out)} cuper, {total_points} punkter "
           f"(adress: {tiers[0]}, land: {tiers[1]}, okänd: {tiers[2]})")
    if skipped:
        msg += f" | hoppade över utan lag: {', '.join(skipped)}"
    print(msg)


if __name__ == "__main__":
    main()
