#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backfillar Storvretacupens Profixio-upplagor före bytet till Cup Manager.

Profixios publika matchsida bäddar in hela upplagans match-, lag-, klass- och
plandata som JSON för den äldre resultatvyn. Det gör att vi kan bevara mer än
bara totalsiffror även när cupen har bytt tävlingssystem.
"""

import argparse
import json
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"

# Upplagan namnges efter startåret. Cup Manager-arkivet börjar med 2024/25,
# så detta ger en obruten och krockfri följd även för vintercupen.
EDITIONS = {
    "2017": "storvretacupen-2017-18",
    "2018": "storvretacupen-2018",
    "2019": "storvretacupen-2019",
    "2021": "storvretacupen-2-2021",
    "2022": "storvretacupen-2022_23",
    "2023": "storvretacupen-2023-2024",
}

JSON_VARS = ("jsonmatches", "jsonbaner", "jsonteams", "klasser", "puljer")


def download(slug):
    url = f"https://www.profixio.com/app/{slug}/matches"
    request = Request(url, headers={"User-Agent": "Cupschema archive backfill/1.0"})
    with urlopen(request, timeout=90) as response:
        return response.read().decode("utf-8")


def decode_js_json(html, name):
    match = re.search(rf"var\s+{name}\s*=\s*JSON\.parse\('(.*?)'\);", html, re.S)
    if not match:
        raise ValueError(f"saknar {name} i Profixio-sidan")
    # Första json.loads avkodar JavaScript-strängens \u0022 och \/ utan att
    # förstöra riktiga UTF-8-tecken. Den andra avkodar själva JSON-datan.
    encoded = match.group(1).replace('"', '\\"')
    return json.loads(json.loads(f'"{encoded}"'))


def playoff_name(pool, match_name):
    text = " ".join(str(value or "") for value in (pool, match_name)).strip()
    return bool(re.search(r"slutspel|final|semi|kvart|placering|play.?off", text, re.I))


def winner(match):
    value = str(match.get("kamp_vinner") or "").upper()
    if value == "H":
        return "home"
    if value == "B":
        return "away"
    return None


def build_matches(data):
    arenas = {row["kamp_baneid"]: (row.get("kamp_banenavn") or "").strip()
              for row in data["jsonbaner"]}
    categories = {row["klasse_id"]: row for row in data["klasser"]}
    pools = {row["pulje_id"]: row for row in data["puljer"]}
    teams = {row["kamp_lagid"]: row for row in data["jsonteams"]}

    result = []
    for raw in data["jsonmatches"]:
        category = categories.get(raw.get("kamp_klasseid"), {})
        pool = pools.get(raw.get("kamp_puljeid"), {})
        pool_name = (pool.get("pulje_displayname") or pool.get("pulje_navn") or "").strip()
        match_name = (raw.get("kamp_navn") or "").strip()
        is_playoff = playoff_name(pool_name, match_name)
        home_team = teams.get(raw.get("kamp_hlag"), {})
        away_team = teams.get(raw.get("kamp_blag"), {})
        home_name = raw.get("hometeamName") or home_team.get("kamp_lagnavn") or ""
        away_name = raw.get("awayteamName") or away_team.get("kamp_lagnavn") or ""
        start = int(float(raw.get("unixtime") or 0) * 1000) or None
        finished = bool(raw.get("resultatstatus"))
        try:
            home_goals = int(raw["kamp_hmaal"]) if raw.get("kamp_hmaal") not in (None, "") else None
            away_goals = int(raw["kamp_bmaal"]) if raw.get("kamp_bmaal") not in (None, "") else None
        except (TypeError, ValueError):
            home_goals = away_goals = None
        result.append({
            "id": raw.get("kamp_id"),
            "start": start,
            "arena": arenas.get(raw.get("kamp_bane"), ""),
            "divId": raw.get("kamp_puljeid"),
            "divName": pool_name,
            "divType": "Playoff" if is_playoff else "Conference",
            "catId": raw.get("kamp_klasseid"),
            "catName": category.get("klasse_navn") or category.get("klasse_kode") or "",
            "roundName": match_name,
            "roundRank": 0,
            "matchRank": 0,
            "nextWinnerId": None,
            "nextLoserId": None,
            "matchNr": str(raw.get("kamp_nr") or ""),
            "home": {"id": raw.get("kamp_hlag"), "name": home_name,
                     "club": home_name, "country": None},
            "away": {"id": raw.get("kamp_blag"), "name": away_name,
                     "club": away_name, "country": None},
            "res": {"fin": finished, "live": False, "hg": home_goals,
                    "ag": away_goals, "hsw": 0, "asw": 0,
                    "winByPeriods": False, "per": [], "wo": False,
                    "winner": winner(raw), "hidden": False},
        })
    return sorted(result, key=lambda item: (item.get("start") or 0, item.get("id") or 0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path,
                        help="läs/skriv hämtade HTML-sidor här")
    args = parser.parse_args()
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    if args.cache_dir:
        args.cache_dir.mkdir(parents=True, exist_ok=True)

    for edition, slug in EDITIONS.items():
        cache = args.cache_dir / f"{slug}.html" if args.cache_dir else None
        if cache and cache.exists():
            html = cache.read_text(encoding="utf-8")
        else:
            html = download(slug)
            if cache:
                cache.write_text(html, encoding="utf-8")
        data = {name: decode_js_json(html, name) for name in JSON_VARS}
        matches = build_matches(data)
        destination = ARCHIVE_DIR / f"storvretacupen-{edition}.json"
        destination.write_text(json.dumps({
            "cupId": "storvretacupen",
            "cupName": "Storvretacupen",
            "edition": edition,
            "sourceSystem": "Profixio",
            "sourceUrl": f"https://www.profixio.com/app/{slug}/matches",
            "ts": int(time.time() * 1000),
            "matches": matches,
        }, ensure_ascii=False), encoding="utf-8")
        print(f"skrev {destination.name} ({len(matches)} matcher)", flush=True)


if __name__ == "__main__":
    main()
