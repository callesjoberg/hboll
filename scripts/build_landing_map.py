#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/landing-map.json: en lätt katalog över geografiska punkter
per cup, bara till för den animerade kart-bakgrunden på välkomstskärmen
för nya besökare (js/welcome.js) — INTE samma sak som Kartan-fliken i
själva appen, som slår upp riktiga adresser dynamiskt.

ALLA cuper i data/cups.json ska finnas med, och alla ska visa LAG-punkter
(en per lag, så mängden faktiskt syns) — inte bara de med klubbadresser.
Fallande kvalitetsordning per cup:

  1. data/snapshot-<id>.json — klassiska Cup Manager-cuper har redan riktiga
     klubbadresser (clubs:{namn:{lat,lng,...}}, se fetch_cupmanager.py).
  2. Annars: ett lag per unikt lag-id i den SENASTE upplaga som faktiskt
     hunnit spelas (finished>0 i data/archive/index.json — en cup vars
     nästa upplaga lagts upp men inte startat än faller tillbaka till
     föregående år i stället för att visa outredda slutspelsplatshållare
     som "lag", se PLACEHOLDER_NAME). Ett lag med känd landskod (t ex
     Partille Cups "Poland", "Lithuania" — samma COUNTRY_CENTROIDS-tabell
     som Kartan-fliken i js/app.js redan använder) slumpas ut något kring
     landets centroid; ett lag helt utan adress eller land (rena svenska
     ProCup-cuper som saknar geokodning) slumpas i stället ut något kring
     cupens EGEN värdort. Deterministiskt seedad på lag-id, så samma lag
     alltid hamnar på samma plats mellan körningar (annars skulle
     skriptet "ändra" filen varje CI-körning i onödan). Det här är bara
     en dekorativ bakgrundsanimation — riktiga adresser används redan i
     den faktiska Kartan-fliken.

Körs sist i workflowet (ren stdlib, inget nätverksanrop, läser bara redan
skrapad data) — bygger om automatiskt när en cup får nya/fler klubbar/lag."""

import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_POINTS = 5  # under detta räknas källan som "för gles" — nästa nivå provas i stället
MAX_POINTS = 320  # var och en ritas med en egen glow varje bildruta — ett tak håller
                   # animationen mjuk även för proppfulla cuper (Partille, Lundaspelen).
                   # Det RIKTIGA antalet lag sparas separat (count) för visning.

# Grader lat/lng. Höll först ±1.6/±2.6, vilket spred markörer ända ut i
# öppet hav för mindre/smalare länder — tajtades ner, men det (kombinerat
# med hur hårt kameran zoomade in på små kluster, se MAX_ZOOM_ABOVE_BASE
# i js/welcome.js) fick i stället alla prickar att flyta ihop till en
# enda solid klump. Den riktiga fixen var kamerans zoomtak (mindre
# inzoomning ger klustret mer "luft" oavsett radie) — jittret ligger nu
# på en måttlig mellannivå. Cirkelformad (inte fyrkantig) spridning så
# ingen punkt hamnar i ett hörn längre bort än scale.
COUNTRY_JITTER = (0.8, 1.2)  # grader lat/lng — sprider isär lag från samma land
# HOST_JITTER vidgad rejält (var 0.3/0.45) — en cups lag kommer i
# verkligheten sällan bara från själva värdorten utan en hel region runt
# den; en för tajt spridning såg ut som "71 lag mitt i Katrineholm",
# orimligt för en ungdomscup som drar deltagare regionalt.
HOST_JITTER = (0.9, 1.3)     # grader lat/lng — regional spridning kring cupens värdort
INTERNATIONAL_THRESHOLD = 5  # minst så här många OLIKA utländska länder innan landsspridning
                              # (COUNTRY_JITTER) används i stället för värdorts-jitter — se
                              # points_from_teams

# Cup Manager/ProCup fyller i platshållarnamn för slutspelsplatser som
# ännu inte avgjorts — "Vinn. 06091905" (vinnare av match X), "3:an i
# Grupp B" osv. Det är inga riktiga lag och ska aldrig räknas eller
# plottas som ett.
PLACEHOLDER_NAME = re.compile(
    r"^(vinn\.?|vinnare|\d+\s*:?an\s+i\s+grupp|winner|tbd|bye|förlorare|loser)\b", re.I)


def cap_points(points):
    if len(points) <= MAX_POINTS:
        return points
    stride = len(points) / MAX_POINTS
    return [points[int(i * stride)] for i in range(MAX_POINTS)]


def seeded_jitter(seed, lat_scale, lng_scale):
    # Deterministisk pseudo-slump ur en hash av seed (INTE Pythons random —
    # dess hash()/random-frön varierar mellan körningar, vilket skulle göra
    # filen till en meningslös diff varje CI-körning även utan datauppdatering).
    # Radien dras med sqrt() för jämn yttäckning i en cirkel (inte en
    # fyrkant) — ingen punkt hamnar då i ett hörn längre bort än scale.
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()
    r = math.sqrt(int(h[:8], 16) / 0xFFFFFFFF)
    theta = (int(h[8:16], 16) / 0xFFFFFFFF) * 2 * math.pi
    return math.cos(theta) * r * lat_scale, math.sin(theta) * r * lng_scale


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


def points_from_snapshot(cup_id):
    f = ROOT / "data" / f"snapshot-{cup_id}.json"
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None
    clubs = data.get("clubs") or {}
    points = [
        [round(v["lat"], 3), round(v["lng"], 3)]
        for v in clubs.values()
        if v.get("lat") and v.get("lng")
    ]
    return points if len(points) >= MIN_POINTS else None


def latest_archive_file(cup_id, archive_index):
    # Föredrar den SENASTE upplagan som faktiskt hunnit spelas (finished>0)
    # framför bara den senaste som EXISTERAR — annars visar animationen en
    # cup vars 2026 inte ens startat än bara ännu-inte-avgjorda
    # slutspelsplatshållare ("Vinn. XXXXX") som "lag", se PLACEHOLDER_NAME.
    # Om ingen upplaga alls hunnit spelas (helt ny cup) används ändå bästa
    # tillgängliga fil — bättre än inget alls.
    entry = archive_index.get(cup_id) or {}
    editions = sorted(entry.get("editions", []), key=lambda e: e.get("edition", ""))
    for e in reversed(editions):
        if e.get("finished", 0) > 0:
            f = ROOT / e["file"]
            if f.exists():
                return f
    candidates = sorted((ROOT / "data" / "archive").glob(f"{cup_id}-*.json"))
    return candidates[-1] if candidates else None


def cup_countries(cup_id, archive_index, centroids):
    # Distinkta landskoder (SE inräknat den här gången — till skillnad
    # från points_from_teams handlar det här bara om att RÄKNA länder,
    # inte om var på kartan ett enskilt lag hamnar) över ALLA spelade
    # upplagor, inte bara den senaste — ett stabilare, mer representativt
    # tal än om det bara byggde på ett enda års laguppsättning.
    # `code in centroids` filtrerar bort skräpvärden källdatan ibland har
    # ("--", "XX", gemena språkkoder som "en") — samma giltighetskoll som
    # redan avgör om en kod duger till landsjitter i points_from_teams.
    entry = archive_index.get(cup_id) or {}
    codes = set()
    for e in entry.get("editions", []):
        if e.get("finished", 0) <= 0:
            continue
        f = ROOT / e["file"]
        if not f.exists():
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for m in data.get("matches", []):
            for side in ("home", "away"):
                code = (m.get(side) or {}).get("country")
                if code and code in centroids:
                    codes.add(code)
    return codes


def points_from_teams(cup_id, host_lat, host_lon, centroids, archive_index):
    f = latest_archive_file(cup_id, archive_index)
    if not f:
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None
    teams = {}  # lag-id -> landskod (eller None), ett lag räknas bara en gång
    for m in data.get("matches", []):
        for side in ("home", "away"):
            info = m.get(side) or {}
            name = (info.get("name") or "").strip()
            if not name or PLACEHOLDER_NAME.match(name):
                continue
            tid = info.get("id") or name
            if tid not in teams:
                teams[tid] = info.get("country")
    if len(teams) < MIN_POINTS:
        return None

    # Hur många OLIKA länder (utöver Sverige) finns representerade? En
    # cup med bara ett fåtal (t ex Hellton Cup: bara Norge, några enstaka
    # gränsnära lag) är rimligen en regional/gränscup — då ser det bättre
    # (och mer realistiskt) ut att lägga de lagen nära cupens EGEN värdort
    # i stället för utspridda över HELA grannlandet, vilket annars gav en
    # udda, glesa "två öar"-vy (en tät klunga vid värdorten + en gles
    # klunga utspridd över halva Norge). Först vid genuint många länder
    # (Partille Cup: ~35) läses en spridning över respektive land som ett
    # äkta, avsiktligt "internationellt"-intryck i stället för brus.
    foreign_countries = {c for c in teams.values() if c and c != "SE" and c in centroids}
    use_country_spread = len(foreign_countries) >= INTERNATIONAL_THRESHOLD

    points = []
    for tid, code in teams.items():
        # code == "SE" utesluts alltid ur landsjittret: Cup Manager
        # (till skillnad från ProCup) taggar även svenska hemmalag med
        # country="SE", och Sveriges egen centroid ligger uppe kring
        # Sundsvall/Örnsköldsvik — långt norr om t ex Göteborg.
        if use_country_spread and code and code != "SE" and code in centroids:
            base_lat, base_lng = centroids[code]
            lat_scale, lng_scale = COUNTRY_JITTER
        else:
            base_lat, base_lng = host_lat, host_lon
            lat_scale, lng_scale = HOST_JITTER
        dlat, dlng = seeded_jitter(f"{cup_id}:{tid}", lat_scale, lng_scale)
        points.append([round(base_lat + dlat, 3), round(base_lng + dlng, 3)])
    return points


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    centroids = load_country_centroids()
    archive_index_path = ROOT / "data" / "archive" / "index.json"
    archive_index = json.loads(archive_index_path.read_text(encoding="utf-8")) if archive_index_path.exists() else {}

    out = {}
    all_countries = set()
    for c in cups:
        cup_id = c["id"]
        points = points_from_snapshot(cup_id)
        source = "snapshot"
        if points is None:
            points = points_from_teams(cup_id, c["lat"], c["lon"], centroids, archive_index)
            source = "lag"
        if points is None:
            points = [[c["lat"], c["lon"]]]
            source = "värdort"
        codes = cup_countries(cup_id, archive_index, centroids)
        all_countries |= codes
        out[cup_id] = {
            "name": c["name"], "count": len(points), "countries": len(codes),
            "points": cap_points(points), "_src": source,
        }

    out_path = ROOT / "data" / "landing-map.json"
    # _src är bara till för utskriften nedan — sparas inte i den faktiska filen.
    # _meta är INTE en cup — js/welcome.js hoppar uttryckligen över nycklar
    # som börjar med "_" när den bygger listan över cuper att rulla igenom.
    slim = {k: {"name": v["name"], "count": v["count"], "countries": v["countries"], "points": v["points"]}
            for k, v in out.items()}
    slim["_meta"] = {"totalCountries": len(all_countries)}
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old == slim:
        print(f"landing-map.json: oförändrad ({len(slim)} cuper)")
        return
    out_path.write_text(
        json.dumps(slim, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    total_points = sum(len(v["points"]) for k, v in slim.items() if k != "_meta")
    by_source = {}
    for v in out.values():
        by_source[v["_src"]] = by_source.get(v["_src"], 0) + 1
    print(f"skrev landing-map.json: {len(out)} cuper, {total_points} punkter "
          f"({', '.join(f'{k}: {n}' for k, n in by_source.items())})")


if __name__ == "__main__":
    main()
