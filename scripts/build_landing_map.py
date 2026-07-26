#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/landing-map.json: en lätt (några tiotals KB) katalog över
geografiska punkter per cup, bara till för den animerade kart-bakgrunden på
välkomstskärmen för nya besökare (js/welcome.js) — INTE samma sak som
Kartan-fliken i själva appen, som slår upp riktiga adresser dynamiskt.

ALLA cuper i data/cups.json ska finnas med (inte bara de med klubbadresser)
— varje cup får punkter från den bästa källa som faktiskt finns, i fallande
kvalitetsordning:

  1. data/snapshot-<id>.json — klassiska Cup Manager-cuper har redan riktiga
     klubbadresser (clubs:{namn:{lat,lng,...}}, se fetch_cupmanager.py).
  2. Landslag/länder i redan arkiverad matchdata (t ex Partille Cup, vars
     lag ofta HETER sitt land — "Poland", "Lithuania" — snarare än en
     svensk klubb) — varje unikt lag med en känd landskod (COUNTRY_CENTROIDS,
     samma tabell som Kartan-fliken i js/app.js redan använder för
     utländska lag) blir en egen punkt vid landets centroid.
  3. Annars: cupens EGEN värdort (cups.json:s lat/lon) som en enda punkt —
     bättre att visa cupen med en punkt än att hoppa över den helt.

Körs sist i workflowet (ren stdlib, inget nätverksanrop, läser bara redan
skrapad data) — bygger om automatiskt när en cup får nya/fler klubbar."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_POINTS = 5  # under detta räknas källan som "för gles" — nästa nivå provas i stället
MAX_POINTS = 320  # var och en ritas med en egen glow varje bildruta — ett tak håller
                   # animationen mjuk även för proppfulla cuper (Partille, Lundaspelen)


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


def points_from_countries(cup_id, centroids):
    f = latest_archive_file(cup_id)
    if not f:
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None
    teams = {}  # lag-id -> landskod, ett lag räknas bara en gång oavsett antal matcher
    for m in data.get("matches", []):
        for side in ("home", "away"):
            info = m.get(side) or {}
            code = info.get("country")
            tid = info.get("id")
            if code and tid is not None and code in centroids:
                teams[tid] = code
    if not teams:
        return None
    points = [[centroids[code][0], centroids[code][1]] for code in teams.values()]
    return points if len(points) >= MIN_POINTS else None


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    centroids = load_country_centroids()

    out = {}
    for c in cups:
        cup_id = c["id"]
        points = points_from_snapshot(cup_id)
        source = "snapshot"
        if points is None:
            points = points_from_countries(cup_id, centroids)
            source = "länder"
        if points is None:
            points = [[c["lat"], c["lon"]]]
            source = "värdort"
        out[cup_id] = {"name": c["name"], "points": cap_points(points), "_src": source}

    out_path = ROOT / "data" / "landing-map.json"
    # _src är bara till för utskriften nedan — sparas inte i den faktiska filen
    slim = {k: {"name": v["name"], "points": v["points"]} for k, v in out.items()}
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
