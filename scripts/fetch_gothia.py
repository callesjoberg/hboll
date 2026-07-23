#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Skrapar en cup på "Gothia Result Web"-plattformen (samma bakom både
Gothia Cup och Partille Cup) via dess GraphQL-API på
results.cupmanager.net, till samma matchformat som Cup Manager-cuperna i
sajten — plus en playoffs-struktur (roundRank/matchRank) som
HB.api.fetchPlayoffs() kan läsa direkt för dataUrl-cuper, se js/api.js.
Ren stdlib — inga beroenden.

Trots domänen (cupmanager.net) är det INTE samma API som resten av sajtens
Cup Manager-cuper (js/api.js): det är ett vanligt GraphQL-schema (med
introspection påslagen) på en gemensam multi-tenant-endpoint, inte den
per-cup-subdomän/DSL-frågespråk (results_api/call) hboll annars använder.
Ingen CORS öppnad för webbläsaren härifrån heller (testat) — datan
förhämtas hit precis som ProCup, se fetch_procup.py.

Körs av GitHub Actions på schema (och manuellt):
    python3 scripts/fetch_gothia.py
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _freshness import should_refresh  # noqa: E402
from _sanity import check_plausible  # noqa: E402
from _ics import write_team_ics_files  # noqa: E402

GRAPHQL_URL = "https://results.cupmanager.net/rest/tournamentapp_graphql"

# Cuper att hämta: (gothiaCupId, edition-namn ELLER None=senaste, utfil,
# cup-id i data/cups.json). gothiaCupId hittas i nätverksfliken på cupens
# resultatsida (results.<cup>.com) — GraphQL-anropets "cup"-variabel.
TOURNAMENTS = [
    (1078445, "2026", "partille-2026.json", "partille"),
]

CUP_QUERY = """
query($cup: Int) {
  cups(id: $cup) {
    cupId
    editions {
      id
      name
      tournaments {
        id
        categories { id name }
      }
    }
  }
}
"""

CATEGORY_QUERY = """
query($cup: Int, $tournament: String, $cat: Int) {
  category(cupId: $cup, tournamentId: $tournament, categoryId: $cat) {
    id
    name
    teams {
      id
      publicPlayers {
        name
        shirtNr
        position
        goalCount
      }
    }
    divisions {
      id
      name
      type
      matches {
        id
        divisionId
        divisionName
        roundName
        roundRank
        rankInRound
        matchNr
        homeTeamId
        awayTeamId
        homeTeamName
        awayTeamName
        locationName
        isWalkover
        homeScore
        awayScore
        zonedStartTime
        isLive
        isFinished
      }
      teamtable {
        rank
        teamId
        teamName
        played
        won
        tied
        lost
        points
        goalsWon
        goalsLost
      }
    }
  }
}
"""

# "conference"/"league" är gruppspel (Tabeller-vyn), "playoff" är slutspel
# (Slutspel-vyn) — samma __typename-strängar som Cup Manager-cupernas API
# ger (division.__typename i js/api.js normalize()), se divisionsToShow()/
# categoriesToShow() i js/app.js som filtrerar på exakt dessa.
DIV_TYPE = {"conference": "Conference", "league": "Conference", "playoff": "Playoff"}


def gql(query, variables, retries=4):
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL, data=body,
        headers={"content-type": "application/json", "user-agent": "hboll-bot/1.0"})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                resp = json.loads(r.read().decode("utf-8"))
            if resp.get("errors"):
                raise RuntimeError(str(resp["errors"]))
            return resp["data"]
        except Exception as e:
            last = e
            time.sleep(1 + 2 * i)
    raise last


def result_of(m):
    # Samma normaliserade form som HB.api normalize()/normalizeResult()
    # producerar för Cup Manager-cuperna, så app.js kan hantera bägge
    # datakällorna identiskt (scoreText(), outcomeRank() m.fl. i js/app.js).
    hg, ag = m.get("homeScore"), m.get("awayScore")
    fin = bool(m.get("isFinished"))
    winner = None
    if fin and hg is not None and ag is not None:
        if hg > ag:
            winner = "home"
        elif ag > hg:
            winner = "away"
    return {
        "fin": fin,
        "live": bool(m.get("isLive")) and not fin,
        "hg": hg or 0, "ag": ag or 0,
        "hsw": 0, "asw": 0, "winByPeriods": False, "per": [],
        "wo": bool(m.get("isWalkover")),
        "winner": winner,
        "hidden": False,
    }


def flat_match(m, cat_id, cat_name, div_type):
    # zonedStartTime (INTE startTime) är den äkta UTC-epoken vars
    # Europe/Stockholm-formatering ger korrekt svensk lokaltid — verifierat
    # mot en känd matchtid (12:00) på results.partillecup.com: startTime
    # gav fel klockslag vid samma ombildning, zonedStartTime rätt.
    return {
        "id": m["id"],
        "start": m["zonedStartTime"],
        "arena": m.get("locationName") or "",
        "divId": m["divisionId"],
        "divName": m["divisionName"],
        "divType": div_type,
        "catId": cat_id,
        "catName": cat_name,
        "roundName": m.get("roundName") or "",
        "home": {"id": m["homeTeamId"], "name": m["homeTeamName"]},
        "away": {"id": m["awayTeamId"], "name": m["awayTeamName"]},
        "res": result_of(m),
    }


def playoff_match(m, cat_id, div_id, div_name):
    # Samma fält som normPlayoffMatch() i js/api.js ger för Cup Manager-
    # cuper. Gothia saknar en motsvarighet till nextMatchWinner/-Loser
    # (inga kopplingslinjer att räkna fram) — nextWinnerId/nextLoserId får
    # vara null, vilket drawBracketConnectors() i js/app.js redan hoppar
    # tyst över (`if (m.nextWinnerId == null) continue;`), så trädet
    # renderas ändå fint, bara utan de sammanbindande linjerna.
    return {
        "id": m["id"],
        "start": m["zonedStartTime"],
        "arena": m.get("locationName") or "",
        "home": {"id": m["homeTeamId"], "name": m["homeTeamName"]},
        "away": {"id": m["awayTeamId"], "name": m["awayTeamName"]},
        "res": result_of(m),
        # roundRank: 0 = final, högre = tidigare omgång — samma
        # konvention som Cup Manager (verifierat: Gothias roundRank=0 gav
        # roundName "Final", roundRank=5 gav "1/32 Final").
        "roundRank": m.get("roundRank") if m.get("roundRank") is not None else 99,
        "roundName": m.get("roundName") or "",
        "matchRank": m.get("rankInRound") or 0,
        "nextWinnerId": None,
        "nextLoserId": None,
        "matchNr": m.get("matchNr"),
        "divId": div_id,
        "divName": div_name,
        "catId": cat_id,
    }


def scrape_category(cup_id, tournament_id, cat):
    data = gql(CATEGORY_QUERY, {"cup": cup_id, "tournament": str(tournament_id), "cat": cat["id"]})
    category = data["category"]
    cat_name = category["name"]
    matches = []
    tables = {}
    playoff_divisions = []
    rosters = {}
    for t in category.get("teams") or []:
        players = t.get("publicPlayers") or []
        if not players:
            continue  # de flesta yngre/mindre lag har ingen trupp inlagd
        rosters[str(t["id"])] = [{
            "name": p["name"].strip(), "shirtNr": p.get("shirtNr"),
            "position": p.get("position") or "", "goals": p.get("goalCount") or 0,
        } for p in players]
    for div in category["divisions"]:
        div_type = DIV_TYPE.get(div["type"], "Conference")
        for m in div["matches"]:
            matches.append(flat_match(m, cat["id"], cat_name, div_type))
        if div["type"] == "playoff":
            pmatches = [playoff_match(m, cat["id"], div["id"], div["name"]) for m in div["matches"]]
            if pmatches:
                playoff_divisions.append({"id": div["id"], "name": div["name"], "matches": pmatches})
        else:
            rows = sorted((div.get("teamtable") or []), key=lambda r: r.get("rank") or 0)
            if rows:
                tables[str(div["id"])] = [{
                    "name": r["teamName"], "teamId": r["teamId"],
                    "played": r.get("played") or 0, "won": r.get("won") or 0,
                    "tied": r.get("tied") or 0, "lost": r.get("lost") or 0,
                    "gf": r.get("goalsWon") or 0, "ga": r.get("goalsLost") or 0,
                    "points": r.get("points") or 0,
                } for r in rows]
    return matches, tables, playoff_divisions, rosters


def scrape(cup_id, edition_name):
    cup_data = gql(CUP_QUERY, {"cup": cup_id})["cups"]
    editions = cup_data["editions"]
    edition = (next((e for e in editions if e["name"] == edition_name), None)
               if edition_name else None) or editions[-1]
    print(f"cup {cup_id}: upplaga {edition['name']} (id {edition['id']})")

    all_matches, all_tables, all_playoffs, all_rosters = [], {}, {}, {}
    for tournament in edition["tournaments"]:
        cats = tournament["categories"]
        print(f"  tournament {tournament['id']}: {len(cats)} klasser")
        for cat in cats:
            matches, tables, pdivs, rosters = scrape_category(cup_id, tournament["id"], cat)
            all_matches.extend(matches)
            all_tables.update(tables)
            all_rosters.update(rosters)
            if pdivs:
                all_playoffs[str(cat["id"])] = pdivs
            print(f"    {cat['name']}: {len(matches)} matcher, {len(tables)} tabeller, "
                  f"{len(pdivs)} slutspelsträd, {len(rosters)} lag med trupp")

    all_matches.sort(key=lambda m: (m["start"], m["arena"]))
    return {"ts": int(time.time() * 1000), "matches": all_matches,
            "tables": all_tables, "playoffs": all_playoffs, "rosters": all_rosters}


def main():
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "data"
    out_dir.mkdir(exist_ok=True)
    cups_by_id = {c["id"]: c for c in
                  json.loads((root / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]}
    for gothia_cup_id, edition_name, fname, cup_key in TOURNAMENTS:
        path = out_dir / fname
        old = None
        if path.exists():
            try:
                old = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                pass
        if not should_refresh(old):
            print(f"{fname}: avslutad sen länge — hoppar över skrapningen (se _freshness.py)")
            continue
        try:
            data = scrape(gothia_cup_id, edition_name)
        except Exception as e:
            print(f"{cup_key} ({fname}): HOPPAR ÖVER ({e})")
            continue
        # Skriv bara om innehållet (utom tidsstämpeln) ändrats, så att
        # CI-jobbet kan committa på "git diff" rakt av.
        if (old and old.get("matches") == data["matches"] and old.get("tables") == data["tables"] and
                old.get("playoffs") == data["playoffs"] and old.get("rosters") == data["rosters"]):
            print(f"{path}: oförändrad — skriver inte om")
            continue
        ok, reason = check_plausible(old, data)
        if not ok:
            print(f"{path.name}: VÄGRAR skriva — data ser orimlig ut ({reason}). "
                  f"Behåller senaste kända goda version.")
            continue
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"skrev {path} ({len(data['matches'])} matcher, {len(data['tables'])} tabeller, "
              f"{len(data['playoffs'])} klasser med slutspel)")
        cup_meta = cups_by_id.get(cup_key, {})
        n = write_team_ics_files(
            out_dir / "ics", cup_key, cup_meta.get("name", cup_key), cup_meta.get("place", ""),
            data["matches"])
        if n:
            print(f"  + {n} klubblags .ics-filer i data/ics/{cup_key}/")


if __name__ == "__main__":
    sys.exit(main())
