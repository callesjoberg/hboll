#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fyller på data/archive/ bakåt i tiden för ALLA Cup Manager-cuper i
data/cups.json (inte ProCup/dataUrl-cuper, de hanteras separat).

Upptäckte att en cups egen "editions"-lista (Cup({id})$editions, nåbar
via Tournament({id})... samma results_api som fetch_cupmanager.py)
innehåller VARJE tidigare upplaga med sitt eget tournamentId — helt
automatiskt, utan att manuellt behöva leta upp gamla tournamentId:n i
webbläsarens nätverksflik (det backfill_archive.py annars kräver).

Körs manuellt (engångs-/vid-behov, inte del av det schemalagda
GitHub Actions-jobbet — för tungt att köra om varje gång):
    python3 scripts/backfill_cupmanager_years.py [--years 2020-2026]"""

import argparse
import json
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_cupmanager import api_call, fetch_store, normalize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def editions_query(tid):
    return (f"Tournament({{id:{tid}}}){{cup:{{editions:[{{name:{{}},"
            "tournaments:[{name:{},id:{}}]}]}}}}")


def discover_editions(host, tid):
    """→ {year_str: tournamentId} för alla upplagor cupen haft."""
    resp = api_call(host, tid, editions_query(tid))
    store = {}
    for k, v in (resp.get("responses") or {}).items():
        # $editions/$tournaments är LIST-entiteter (t.ex. [{href:"Edition(...)"}])
        # — måste också sparas i store, annars kan de inte slås upp via get()
        # nedan (bara dict-entiteter sparades tidigare, vilket gjorde att
        # varje editions-lista såg tom ut).
        if isinstance(v, dict) and "entity" in v and isinstance(v["entity"], (dict, list)):
            store[k] = v["entity"]

    def get(ref):
        if isinstance(ref, dict):
            return store.get(ref.get("href"))
        return None

    out = {}
    for e in store.values():
        if not isinstance(e, dict) or e.get("__typename") != "Edition":
            continue  # hoppa över list-entiteterna ($editions/$tournaments själva)
        year = e.get("name")
        tours = get(e.get("tournaments")) or []
        for tref in tours:
            t = get(tref)
            if isinstance(t, dict) and t.get("id"):
                out[str(year)] = t["id"]
                break  # en cup kan i teorin ha flera tournaments/edition — första räcker
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--years", default="2020-2026",
                    help="intervall att fylla på, t.ex. 2020-2026 (förval)")
    p.add_argument("--only", default=None,
                    help="komma-separerad lista cup-id:n att köra (förval: alla Cup Manager-cuper)")
    args = p.parse_args()

    lo, hi = (int(x) for x in args.years.split("-"))
    wanted_years = {str(y) for y in range(lo, hi + 1)}
    only = set(args.only.split(",")) if args.only else None

    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    archive_dir = ROOT / "data" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    for cup in cups:
        if not cup.get("tournamentId") or cup.get("dataUrl"):
            continue  # ProCup/Gothia — inte den här skriptets jobb
        if only and cup["id"] not in only:
            continue

        try:
            editions = discover_editions(cup["host"], cup["tournamentId"])
        except Exception as e:
            print(f"{cup['id']}: kunde inte hämta editions-listan ({e})")
            continue
        print(f"{cup['id']}: upplagor hittade: {sorted(editions.keys())}")

        for year, tid in sorted(editions.items()):
            if year not in wanted_years:
                continue
            dest = archive_dir / f"{cup['id']}-{year}.json"
            if dest.exists():
                continue  # redan arkiverad — rör inte (dagens/redan körda år hanteras av archive_results.py)
            t0 = time.time()
            try:
                store = fetch_store(cup["host"], tid)
            except Exception as e:
                print(f"  {cup['id']} {year} (tid {tid}): HOPPAR ÖVER ({e})")
                continue
            matches = normalize(store)
            if not matches:
                print(f"  {cup['id']} {year}: 0 matcher — hoppar (inget publicerat den upplagan)")
                continue
            dest.write_text(json.dumps({
                "cupId": cup["id"], "cupName": cup["name"], "edition": year,
                "ts": int(time.time() * 1000), "matches": matches,
            }, ensure_ascii=False), encoding="utf-8")
            print(f"  skrev {dest.name} ({len(matches)} matcher, {time.time()-t0:.0f}s)")


if __name__ == "__main__":
    sys.exit(main())
