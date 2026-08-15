#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backfillar alla historiska upplagor för Gothia Result Web-cuper.

Till skillnad från den löpande skrapningen hämtas bara match-, klubb- och
landsfält som arkivet använder. Spelartrupper och officiella tabeller skulle
annars göra många års historik onödigt tung utan att tillföra något i
historikvyerna.
"""

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_gothia import CUP_QUERY, DIV_TYPE, flat_match, gql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

CUPS = {
    "gothiacup": {"cupId": 661795, "name": "Gothia Cup"},
    "gothiainnebandy": {"cupId": 503243, "name": "Gothia Innebandy Cup"},
}

ARCHIVE_CATEGORY_QUERY = """
query($cup: Int, $tournament: String, $cat: Int) {
  category(cupId: $cup, tournamentId: $tournament, categoryId: $cat) {
    id
    name
    teams { id nameClubName nation { code } }
    divisions {
      id
      name
      type
      matches {
        id divisionId divisionName roundName roundRank rankInRound matchNr
        homeTeamId awayTeamId homeTeamName awayTeamName locationName
        isWalkover homeScore awayScore zonedStartTime isLive isFinished
      }
    }
  }
}
"""


def scrape_edition(cup_id, edition):
    tasks = []
    for tournament in edition.get("tournaments") or []:
        tournament_id = tournament["id"]
        for cat in tournament.get("categories") or []:
            tasks.append((tournament_id, cat))

    def fetch_category(task):
        tournament_id, cat = task
        data = gql(ARCHIVE_CATEGORY_QUERY, {
            "cup": cup_id, "tournament": str(tournament_id), "cat": cat["id"],
        })
        category = data.get("category") or {}
        club_by_team = {}
        nation_by_team = {}
        for team in category.get("teams") or []:
            if team.get("nameClubName"):
                club_by_team[team["id"]] = team["nameClubName"]
            if (team.get("nation") or {}).get("code"):
                nation_by_team[team["id"]] = team["nation"]["code"]
        category_matches = []
        for division in category.get("divisions") or []:
            div_type = DIV_TYPE.get(division.get("type"), "Conference")
            for match in division.get("matches") or []:
                category_matches.append(flat_match(
                    match, category.get("id") or cat["id"],
                    category.get("name") or cat.get("name") or "",
                    div_type, club_by_team, nation_by_team))
        return category_matches

    matches = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        for category_matches in executor.map(fetch_category, tasks):
            matches.extend(category_matches)
    matches.sort(key=lambda match: (match.get("start") or 0, match.get("arena") or ""))
    return matches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default=None,
                        help="kommaseparerade cup-id:n (gothiacup,gothiainnebandy)")
    args = parser.parse_args()
    selected = set(args.only.split(",")) if args.only else set(CUPS)
    archive_dir = ROOT / "data" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    for cup_key, cfg in CUPS.items():
        if cup_key not in selected:
            continue
        cup_data = gql(CUP_QUERY, {"cup": cfg["cupId"]})["cups"]
        editions = [edition for edition in (cup_data.get("editions") or [])
                    if re.fullmatch(r"\d{4}", str(edition.get("name") or ""))]
        print(f"{cup_key}: upplagor hittade: {[edition['name'] for edition in editions]}", flush=True)
        for edition in sorted(editions, key=lambda item: item["name"]):
            year = edition["name"]
            destination = archive_dir / f"{cup_key}-{year}.json"
            if destination.exists():
                continue
            started = time.time()
            try:
                matches = scrape_edition(cfg["cupId"], edition)
            except Exception as error:
                print(f"  {cup_key} {year}: HOPPAR ÖVER ({error})", flush=True)
                continue
            destination.write_text(json.dumps({
                "cupId": cup_key,
                "cupName": cfg["name"],
                "edition": year,
                "ts": int(time.time() * 1000),
                "matches": matches,
            }, ensure_ascii=False), encoding="utf-8")
            print(f"  skrev {destination.name} ({len(matches)} matcher, {time.time()-started:.0f}s)",
                  flush=True)


if __name__ == "__main__":
    sys.exit(main())
