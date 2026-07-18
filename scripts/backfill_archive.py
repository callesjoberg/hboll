#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Engångs-/manuellt verktyg: hämtar en cups TIDIGARE upplaga (annat
tournamentId än det som står i cups.json just nu) direkt till
data/archive/<cupId>-<edition>.json, utan att röra dagens snapshot.

Cup Manager behåller gamla upplagor på egna tournamentId:n, nåbara via
år-prefixade URL:er på cupens egen sajt, t.ex.
    https://<host>/2025,sv/result/map   → "tournamentId: NNNN" i källkoden
(samma metod som appens "Lägg till cup"-dialog ber användaren använda för
årets upplaga). Slå upp ID:t så, och kör sedan:

    python3 scripts/backfill_archive.py --id ahus --name "Åhus Beach" \\
        --host ahusbeachhandboll.cupmanager.net --tid 58239366 --edition 2025

Använder samma hämtnings-/normaliseringslogik som fetch_cupmanager.py."""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_cupmanager import fetch_store, normalize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--id", required=True, help="cup-id, t.ex. ahus")
    p.add_argument("--name", required=True, help="visningsnamn, t.ex. 'Åhus Beach'")
    p.add_argument("--host", required=True, help="t.ex. ahusbeachhandboll.cupmanager.net")
    p.add_argument("--tid", required=True, type=int, help="tournamentId för den gamla upplagan")
    p.add_argument("--edition", required=True, help="år, t.ex. 2025")
    args = p.parse_args()

    t0 = time.time()
    store = fetch_store(args.host, args.tid)
    matches = normalize(store)
    if not matches:
        print(f"{args.id} {args.edition}: 0 matcher hittade — fel tournamentId?")
        return 1
    print(f"{args.id} {args.edition}: {len(matches)} matcher på {time.time()-t0:.0f}s")

    archive_dir = ROOT / "data" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    dest = archive_dir / f"{args.id}-{args.edition}.json"
    dest.write_text(json.dumps({
        "cupId": args.id, "cupName": args.name, "edition": args.edition,
        "ts": int(time.time() * 1000), "matches": matches,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"skrev {dest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
