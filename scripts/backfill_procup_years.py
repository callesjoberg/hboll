#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Engångsverktyg: fyller på data/archive/ bakåt i tiden för ProCup-cuper,
givet manuellt uppslagna ev-id:n per år (ProCup saknar en editions-lista
att fråga automatiskt, till skillnad från Cup Manager — se
backfill_cupmanager_years.py). Kontrollerar att en majoritet av matcherna
faktiskt landar inom det påstådda året innan filen skrivs, eftersom ProCup
kan återanvända/omdirigera gamla ev-id:n till helt andra års matcher (hände
för Aranäs Open — se cupmanager-kommentaren i fetch_procup.py)."""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_procup import scrape  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"

# (ev-id, cup-id, år, visningsnamn) — år/ev hittade via web-sök
# (site:procup.se "<cup> <år>" ev), verifierade mot faktiska matchdatum.
JOBS = [
    (31119, "jarnvagen", "2018", "Järnvägen Cup"),
    (32192, "jarnvagen", "2019", "Järnvägen Cup"),
    (33251, "jarnvagen", "2020", "Järnvägen Cup"),
    (34346, "jarnvagen", "2021", "Järnvägen Cup"),
    (34959, "jarnvagen", "2022", "Järnvägen Cup"),
    (35877, "jarnvagen", "2023", "Järnvägen Cup"),
    (37035, "jarnvagen", "2024", "Järnvägen Cup"),
    (38213, "jarnvagen", "2025", "Järnvägen Cup"),
    (31550, "vikingaspelen", "2018", "Vikingaspelen"),
    (32655, "vikingaspelen", "2019", "Vikingaspelen"),
    (33681, "vikingaspelen", "2020", "Vikingaspelen"),
    (34475, "vikingaspelen", "2021", "Vikingaspelen"),
    (35189, "vikingaspelen", "2022", "Vikingaspelen"),
    (36176, "vikingaspelen", "2023", "Vikingaspelen"),
    (37193, "vikingaspelen", "2024", "Vikingaspelen"),
    (38339, "vikingaspelen", "2025", "Vikingaspelen"),
    (30227, "katrineholm", "2017", "Katrineholm Handboll Cup"),
    (30779, "katrineholm", "2018", "Katrineholm Handboll Cup"),
    (31915, "katrineholm", "2019", "Katrineholm Handboll Cup"),
    (33214, "katrineholm", "2020", "Katrineholm Handboll Cup"),
    (34297, "katrineholm", "2021", "Katrineholm Handboll Cup"),
    (34680, "katrineholm", "2022", "Katrineholm Handboll Cup"),
    (35733, "katrineholm", "2023", "Katrineholm Handboll Cup"),
    (36879, "katrineholm", "2024", "Katrineholm Handboll Cup"),
    (38025, "katrineholm", "2025", "Katrineholm Handboll Cup"),
    (30150, "aranas", "2017", "Aranäs Open"),
    (31043, "aranas", "2018", "Aranäs Open"),
    (32073, "aranas", "2019", "Aranäs Open"),
    (33141, "aranas", "2020", "Aranäs Open"),
    (34220, "aranas", "2021", "Aranäs Open"),
    (34698, "aranas", "2022", "Aranäs Open"),
    (35988, "aranas", "2023", "Aranäs Open"),
    (37039, "aranas", "2024", "Aranäs Open"),
]


def majority_year(matches):
    years = [datetime.fromtimestamp(m["start"] / 1000, tz=timezone.utc).year for m in matches]
    return max(set(years), key=years.count) if years else None


def main():
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    current_edition = {c["id"]: c.get("edition") for c in cups}
    for ev, cup_id, year, name in JOBS:
        dest = ARCHIVE_DIR / f"{cup_id}-{year}.json"
        if dest.exists():
            continue
        t0 = time.time()
        try:
            data = scrape(ev)
        except Exception as e:
            print(f"{cup_id} {year} (ev {ev}): FEL {e}")
            continue
        matches = data["matches"]
        if not matches:
            if year == current_edition.get(cup_id):
                # Innevarande, aktivt spårade upplaga — "inget publicerat
                # än" betyder bara "kolla igen senare", inte en bekräftad
                # inställd upplaga (se samma resonemang/bugg-fix i
                # backfill_cupmanager_years.py).
                print(f"{cup_id} {year} (ev {ev}): 0 matcher men är innevarande upplaga — hoppar över")
                continue
            # Skriv ändå: till skillnad från Cup Manager (där Cup$editions
            # AUKTORITATIVT bekräftar att upplagan existerat) är ev-id:t här
            # bara manuellt uppslaget via webbsök — men det är konsekvent med
            # grannårens id-mönster (ungefär +1000 per år) och 2020/2021 var
            # känt inställda pga corona över hela Sverige, så en äkta
            # nollpunkt i Trend är rimligare än att gissa fel ID.
            out = {"cupId": cup_id, "cupName": name, "edition": year,
                   "ts": data["ts"], "matches": [], "tables": {}}
            dest.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
            print(f"{cup_id} {year} (ev {ev}): 0 matcher — skrev ändå (troligen inställd)")
            continue
        my = majority_year(matches)
        if str(my) != year:
            print(f"{cup_id} {year} (ev {ev}): AVVISAD — matcherna är faktiskt "
                  f"från {my}, inte {year} (samma ProCup-omdirigeringsfälla "
                  f"som Aranäs 2026 hade)")
            continue
        out = {
            "cupId": cup_id, "cupName": name, "edition": year,
            "ts": data["ts"], "matches": matches, "tables": data["tables"],
        }
        dest.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(f"skrev {dest.name} ({len(matches)} matcher, {time.time()-t0:.0f}s)")


if __name__ == "__main__":
    sys.exit(main())
