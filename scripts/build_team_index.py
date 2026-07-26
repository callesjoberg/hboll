#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/archive/team-index.json: {cupId: {edition: [lagnamn, ...]}} —
en LÄTT (under 1 MB) katalog över VILKA rå lagnamn som förekommer i varje
arkiverad upplaga, utan matchdata.

Klubb/Lag-fliken (js/app.js, se computeClubRows) sökte tidigare över ALLA
arkiverade upplagor av ALLA cuper vid varje sökning — filtreringen skedde
EFTER att alla data/archive/<cupId>-<edition>.json-filerna (tillsammans
över 150 MB) redan hämtats, oavsett hur smal sökningen råkade vara. Med
den här katalogen kan klienten i stället slå upp VILKA upplagor som ens
KAN innehålla söktermen (samma booleska matchning, matchesBooleanQuery,
mot namnen här som senare mot de riktiga matcherna) och bara hämta DE
fulla matchfilerna — resten hoppas över helt.

Körs EFTER archive_results.py i workflowet (läser redan arkiverade filer
på disk, precis som archive_results.py:s egen build_index() — skrapar
inget själv, bygger bara om från det som redan finns)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"


def build_team_index():
    by_cup = {}
    for f in sorted(ARCHIVE_DIR.glob("*.json")):
        if f.name in ("index.json", "team-index.json"):
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        cid, edition = d.get("cupId"), d.get("edition")
        if not cid or not edition:
            continue
        names = set()
        for m in d.get("matches") or []:
            home, away = m.get("home") or {}, m.get("away") or {}
            if home.get("name"):
                names.add(home["name"])
            if away.get("name"):
                names.add(away["name"])
        by_cup.setdefault(cid, {})[edition] = sorted(names)
    return by_cup


def main():
    index = build_team_index()
    out_path = ARCHIVE_DIR / "team-index.json"
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old == index:
        print(f"team-index.json: oförändrad ({len(index)} cuper)")
        return
    out_path.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    total_names = sum(len(v) for eds in index.values() for v in eds.values())
    print(f"skrev team-index.json: {len(index)} cuper, {total_names} lagnamn")


if __name__ == "__main__":
    sys.exit(main())
