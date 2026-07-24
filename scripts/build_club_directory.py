#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Slår ihop klubbadresser (stad/koordinater/land) från ALLA klassiska
Cup Manager-cupers snapshot-filer (data/snapshot-<id>.json, se
clubs_from_store() i fetch_cupmanager.py) till en enda katalog,
data/club-directory.json.

Varken ProCup eller Gothia Result Web (Partille m.fl.) exponerar
klubbadresser alls i sina egna API:er/scraping — men samma klubbar
spelar ofta ÄVEN i klassiska Cup Manager-cuper. Karta-fliken i js/app.js
(clubGeoFromMatches) slår upp sådana cupers lagnamn mot katalogen här
via prefixmatchning (samma teknik som clubTeamCounts) för att gissa en
adress ändå.

Körs sist i GitHub Actions-workflowet, efter fetch_cupmanager.py — ren
stdlib, inget nätverksanrop, bara läser redan skrapad data."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    directory = {}
    for f in sorted((ROOT / "data").glob("snapshot-*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for name, info in (data.get("clubs") or {}).items():
            # Första träffen vinner — samma klubbnamn bör ha samma adress
            # oavsett vilken cup som råkade skrapas/läsas först.
            directory.setdefault(name, info)

    out_path = ROOT / "data" / "club-directory.json"
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old == directory:
        print(f"club-directory.json: oförändrad ({len(directory)} klubbar)")
        return
    out_path.write_text(json.dumps(directory, ensure_ascii=False), encoding="utf-8")
    print(f"skrev club-directory.json: {len(directory)} klubbar")


if __name__ == "__main__":
    main()
