#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Samma sak som backfill_archive_country.py, men för KLASSISKA Cup
Manager-cuper i stället för Gothia — se den filens docstring för
bakgrunden (varför gamla arkiverade år saknar home/away.country helt).

Cup Managers DSL saknar Gothias GraphQL-aliasing (verifierat: skickar
man två Team({id})-frågor i SAMMA anrop besvaras bara den första, den
andra faller bort tyst) — en fråga per lag krävs alltså, körs parallellt
(CONC) i stället för batchat. Ett lags NameClub.nation går att slå upp
via VILKEN SOM HELST giltig tournamentId på samma host, inte bara den
upplaga laget faktiskt spelade i (verifierat mot både gamla Bohus- och
Hellton-lag via cups.json:s NUVARANDE tournamentId) — kräver alltså
INTE varje upplagas egen historiska tournamentId (som skulle vara
mycket krångligare att ta reda på för Cup Manager, till skillnad från
Gothias enkla CUP_QUERY).

Körs manuellt (inte del av det schemalagda workflowet, se samma
resonemang i backfill_archive_country.py):
    python3 scripts/backfill_archive_country_cupmanager.py --only hellton,skadevi
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"
CONC = 6  # parallella anrop — DSL:t saknar batchning, så det här är enda sättet att inte ta evigheter


def api_call(host, tid, query, retries=3):
    url = (f"https://{host}/rest/results_api/call?call="
           f"{urllib.parse.quote(query)}&lang=sv&tournamentId={tid}")
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "hboll-bot/1.0"})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(0.5 + i)
    raise last


def fetch_nation(host, tid, team_id):
    q = f"Team({{id:{team_id}}}){{club:{{nation:{{code:{{}}}}}}}}"
    try:
        data = api_call(host, tid, q)
    except Exception:
        return team_id, None
    for v in (data.get("responses") or {}).values():
        e = v.get("entity") or {}
        if e.get("__typename") == "Nation":
            return team_id, e.get("code")
    return team_id, None


def fetch_nations(host, tid, team_ids):
    result = {}
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for team_id, code in ex.map(lambda t: fetch_nation(host, tid, t), team_ids):
            if code:
                result[team_id] = code
    return result


def backfill_file(path, host, tid):
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
    nations = fetch_nations(host, tid, missing_ids)
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
    p.add_argument("--only", required=True, help="kommaseparerad lista cup-id (från cups.json), t.ex. hellton,skadevi")
    args = p.parse_args()
    only = set(args.only.split(","))

    cups_by_id = {c["id"]: c for c in
                  json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]}

    for cup_id in only:
        cup = cups_by_id.get(cup_id)
        if not cup or cup.get("dataUrl"):
            print(f"{cup_id}: hittades inte, eller inte en klassisk Cup Manager-cup — hoppar")
            continue
        files = sorted(ARCHIVE_DIR.glob(f"{cup_id}-*.json"))
        if not files:
            print(f"{cup_id}: inga arkivfiler hittades")
            continue
        total_patched = 0
        for path in files:
            n = backfill_file(path, cup["host"], cup["tournamentId"])
            total_patched += n
            print(f"  {path.name}: {n} matchsidor fick ett land")
        print(f"{cup_id}: totalt {total_patched} matchsidor uppdaterade")


if __name__ == "__main__":
    main()
