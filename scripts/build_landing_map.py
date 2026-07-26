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
  2. Annars: ett lag per unikt lag-id i senast arkiverade upplagan. Ett lag
     med känd landskod (t ex Partille Cups "Poland", "Lithuania" — samma
     COUNTRY_CENTROIDS-tabell som Kartan-fliken i js/app.js redan använder)
     slumpas ut något kring landets centroid; ett lag helt utan adress
     eller land (rena svenska ProCup-cuper som saknar geokodning) slumpas
     i stället ut något kring cupens EGEN värdort. Deterministiskt seedad
     på lag-id, så samma lag alltid hamnar på samma plats mellan körningar
     (annars skulle skriptet "ändra" filen varje CI-körning i onödan).
     Det här är bara en dekorativ bakgrundsanimation — riktiga adresser
     används redan i den faktiska Kartan-fliken.

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

# Grader lat/lng — hölls först mycket större (±1.6/±2.6), men det spred ut
# markörer ända ut i öppet hav för mindre/smalare länder. Tajtare radie +
# en cirkelformad (inte fyrkantig) spridning håller klungan trovärdigt
# nära landets/ortens faktiska läge.
COUNTRY_JITTER = (0.55, 0.85)  # grader lat/lng — sprider isär lag från samma land
HOST_JITTER = (0.16, 0.24)     # grader lat/lng — stads-nära spridning kring cupens värdort


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


def latest_archive_file(cup_id):
    candidates = sorted((ROOT / "data" / "archive").glob(f"{cup_id}-*.json"))
    return candidates[-1] if candidates else None


def points_from_teams(cup_id, host_lat, host_lon, centroids):
    f = latest_archive_file(cup_id)
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
            tid = info.get("id") or info.get("name")
            if tid is not None and tid not in teams:
                teams[tid] = info.get("country")
    if len(teams) < MIN_POINTS:
        return None
    points = []
    for tid, code in teams.items():
        if code and code in centroids:
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

    out = {}
    for c in cups:
        cup_id = c["id"]
        points = points_from_snapshot(cup_id)
        source = "snapshot"
        if points is None:
            points = points_from_teams(cup_id, c["lat"], c["lon"], centroids)
            source = "lag"
        if points is None:
            points = [[c["lat"], c["lon"]]]
            source = "värdort"
        out[cup_id] = {"name": c["name"], "count": len(points), "points": cap_points(points), "_src": source}

    out_path = ROOT / "data" / "landing-map.json"
    # _src är bara till för utskriften nedan — sparas inte i den faktiska filen
    slim = {k: {"name": v["name"], "count": v["count"], "points": v["points"]} for k, v in out.items()}
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
    total_points = sum(len(v["points"]) for v in slim.values())
    by_source = {}
    for v in out.values():
        by_source[v["_src"]] = by_source.get(v["_src"], 0) + 1
    print(f"skrev landing-map.json: {len(slim)} cuper, {total_points} punkter "
          f"({', '.join(f'{k}: {n}' for k, n in by_source.items())})")


if __name__ == "__main__":
    main()
