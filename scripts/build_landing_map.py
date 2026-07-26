#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/landing-map.json: en lätt (några tiotals KB) katalog över
klubbkoordinater per cup, bara till för den animerade kart-bakgrunden på
välkomstskärmen för nya besökare (js/welcome.js) — INTE samma sak som
Kartan-fliken i själva appen, som slår upp riktiga adresser dynamiskt.

Läser data/snapshot-<id>.json (redan hämtat av fetch_cupmanager.py, som
redan bygger clubs:{namn:{lat,lng,...}} för klassiska Cup Manager-cuper
med riktiga adresser — se dess normalize()). ProCup/Gothia-cuper (utan
egen adressdata, se club-directory.json-korsreferensen i js/app.js)
hoppas medvetet över här — bakgrundsanimationen behöver inte alla cuper,
bara en bred, snabb, redan tillgänglig uppsättning.

Körs sist i workflowet (ren stdlib, inget nätverksanrop, läser bara redan
skrapad data) — bygger om automatiskt när en cup får nya/fler klubbar."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    names = {c["id"]: c["name"] for c in cups}

    out = {}
    for f in sorted((ROOT / "data").glob("snapshot-*.json")):
        cup_id = f.stem.replace("snapshot-", "")
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        clubs = data.get("clubs") or {}
        points = [
            [round(v["lat"], 3), round(v["lng"], 3)]
            for v in clubs.values()
            if v.get("lat") and v.get("lng")
        ]
        if len(points) < 5:
            continue
        out[cup_id] = {"name": names.get(cup_id, cup_id), "points": points}

    out_path = ROOT / "data" / "landing-map.json"
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old == out:
        print(f"landing-map.json: oförändrad ({len(out)} cuper)")
        return
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    total_points = sum(len(v["points"]) for v in out.values())
    print(f"skrev landing-map.json: {len(out)} cuper, {total_points} klubbpunkter")


if __name__ == "__main__":
    main()
