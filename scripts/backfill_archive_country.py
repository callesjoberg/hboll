#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fyller i home/away.country på REDAN arkiverade matcher (data/archive/
<cupId>-<edition>.json) som skrapades INNAN country-fältet infördes i
fetch_cupmanager.py/fetch_gothia.py/js/api.js — annars saknar Kartans
"Visa landshistorik" (och den vanliga landsnivån) helt landsdata för
gamla år, även om innevarande upplaga har det.

Körs manuellt (inte del av det schemalagda workflowet — det skulle bara
skrapa om INNEVARANDE upplaga igen, aldrig gamla arkiverade år):
    python3 scripts/backfill_archive_country.py [--only cupId,cupId2]

Just nu bara Gothia-cuper (Partille m.fl., se TOURNAMENTS i
fetch_gothia.py) — de har ETT enda ställe att fråga (Gothias
tournamentapp_graphql, riktig GraphQL med aliasing, se batch() nedan) och
kräver INGEN klubbadress alls för att slå upp ett lags land direkt via
Team.nation. Klassiska Cup Manager-cuper skulle kräva en fråga PER lag
(DSL:t stödjer inte flera Team({id})-frågor i samma anrop, se kommentaren
i fetch_cupmanager.py) — mycket långsammare för tiotusentals historiska
lag, sparas till en separat körning om/när det behövs.
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_gothia import GRAPHQL_URL, TOURNAMENTS, CUP_QUERY  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"
BATCH = 40  # lagom stora GraphQL-frågor — testat, funkar fint, inga tidsgränser


def gql(query, variables=None, retries=4):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
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


def tournament_ids_by_edition(gothia_cup_id):
    """{"2019": tournamentId, ...} — en cups samtliga upplagors tournamentId,
    en fråga räcker (samma CUP_QUERY som scrape() i fetch_gothia.py)."""
    data = gql(CUP_QUERY, {"cup": gothia_cup_id})
    out = {}
    for e in data["cups"]["editions"]:
        tours = e.get("tournaments") or []
        if tours:
            out[e["name"]] = tours[0]["id"]
    return out


def fetch_nations(gothia_cup_id, tournament_id, team_ids):
    """{teamId: countryCode} — GraphQL-aliasing batchar BATCH lag per
    HTTP-anrop i stället för ett anrop per lag (skulle annars bli
    tiotusentals separata anrop för en cup med lång historik)."""
    result = {}
    ids = list(team_ids)
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        fields = "\n".join(
            f'  t{j}: team(cupId: {gothia_cup_id}, tournamentId: "{tournament_id}", teamId: {tid}) '
            f'{{ id nation {{ code }} }}'
            for j, tid in enumerate(chunk))
        query = "{\n" + fields + "\n}"
        try:
            data = gql(query)
        except Exception as e:
            print(f"    batch misslyckades ({len(chunk)} lag): {e}")
            continue
        for j, tid in enumerate(chunk):
            entity = data.get(f"t{j}")
            code = (entity or {}).get("nation", {}).get("code") if entity else None
            if code:
                result[tid] = code
    return result


def backfill_file(path, tournament_id, gothia_cup_id):
    d = json.loads(path.read_text(encoding="utf-8"))
    matches = d.get("matches") or []
    missing_ids = set()
    for m in matches:
        for side in ("home", "away"):
            s = m.get(side) or {}
            if s.get("id") is not None and not s.get("country"):
                missing_ids.add(s["id"])
    if not missing_ids:
        return 0
    nations = fetch_nations(gothia_cup_id, tournament_id, missing_ids)
    if not nations:
        return 0
    patched = 0
    for m in matches:
        for side in ("home", "away"):
            s = m.get(side) or {}
            code = nations.get(s.get("id"))
            if code and not s.get("country"):
                s["country"] = code
                patched += 1
    if patched:
        path.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return patched


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", default=None, help="kommaseparerad lista cup-id (från cups.json), t.ex. partille")
    args = p.parse_args()
    only = set(args.only.split(",")) if args.only else None

    for gothia_cup_id, _edition_name, _fname, cup_key in TOURNAMENTS:
        if only and cup_key not in only:
            continue
        files = sorted(ARCHIVE_DIR.glob(f"{cup_key}-*.json"))
        if not files:
            print(f"{cup_key}: inga arkivfiler hittades")
            continue
        print(f"{cup_key}: slår upp upplagornas tournamentId …")
        tids = tournament_ids_by_edition(gothia_cup_id)
        total_patched = 0
        for path in files:
            edition = path.stem.split("-", 1)[1]  # "partille-2019.json" -> "2019"
            tid = tids.get(edition)
            if not tid:
                print(f"  {path.name}: ingen tournamentId hittad för {edition} — hoppar")
                continue
            n = backfill_file(path, tid, gothia_cup_id)
            total_patched += n
            print(f"  {path.name}: {n} matchsidor fick ett land")
        print(f"{cup_key}: totalt {total_patched} matchsidor uppdaterade")


if __name__ == "__main__":
    main()
