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

sys.path.insert(0, str(Path(__file__).resolve().parent))
# SAMMA normalisering som champions.json byggs med. Det är inte en detalj:
# topplistans täljare (medaljer) kommer därifrån och nämnaren (anmälda lag)
# härifrån, så minsta skillnad i hur "Alingsås HK 2" blir "Alingsås HK"
# skulle ge en kvot som tyst räknar fel.
from archive_results import _side, is_placeholder_team  # noqa: E402


def build_team_index():
    """Returnerar (lagkatalog, klubbanmälningar).

    Den andra är nämnaren till topplistans "per lag"-läge: hur många lag
    varje klubb faktiskt haft med i varje upplaga. Utan den jämför
    topplistan en klubb som anmäler fyrtio lag med en som anmäler fyra,
    och den stora vinner alltid på volym.

    Räknar LAG, inte matcher eller spelare. Varje anmält lag är ett
    tillfälle att ta en medalj, vilket är precis vad kvoten ska spegla.
    Spelarantal vore ärligare än så, men det finns inte i datan för mer än
    tre av 34 cuper.

    Platshållare ("3:an i Grupp B", "Vinn. 18072146") räknas bort — de är
    slutspelsrutor, inte anmälda lag.
    """
    by_cup = {}
    anmalda = {}
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
        lag = {}                      # lag-id -> lagnamn
        for m in d.get("matches") or []:
            for sida in (m.get("home") or {}, m.get("away") or {}):
                namn = sida.get("name")
                if not namn:
                    continue
                names.add(namn)
                if sida.get("id") is not None:
                    lag[sida["id"]] = sida
        by_cup.setdefault(cid, {})[edition] = sorted(names)

        # Räknas per LAG-ID, inte per lagnamn. Ett namn kan bäras av flera
        # lag i olika klasser — Göteborg Cup 2026 har 328 unika lagnamn men
        # 572 lag-id. Räknat på namn blev nämnaren 43 % för liten, och en
        # klubb som döper alla sina lag lika fick kvoten 2,08 medaljer per
        # lag: omöjligt, eftersom ett lag kan vinna högst en medalj.
        klubbar = {}
        for sida in lag.values():
            if is_placeholder_team(sida):
                continue
            # _side() är EXAKT samma härledning som champions.json:s gc/sc/bc:
            # den utgår från lagets club-fält och faller bara tillbaka på
            # namnet. Att i stället normalisera namnet direkt gav en annan
            # nyckel för lag med klassuffix — "Staffanstorps HK
            # Beachhandboll P15 (f 2010)" blev en egen klubb i nämnaren men
            # räknades till moderklubben i täljaren, och kvoten blev 3,00
            # medaljer per lag.
            _, k = _side(sida)
            if k:
                klubbar[k] = klubbar.get(k, 0) + 1
        for k, antal in klubbar.items():
            anmalda.setdefault(k, {}).setdefault(cid, {})[edition] = antal
    return by_cup, anmalda


def skriv_om_ändrad(path, data, etikett):
    """Skriver bara när innehållet skiljer sig — annars får varje CI-varv
    en commit på en fil som inte ändrats."""
    if path.exists():
        try:
            if json.loads(path.read_text(encoding="utf-8")) == data:
                print(f"{path.name}: oförändrad")
                return False
        except Exception:
            pass
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"skrev {path.name}: {etikett}")
    return True


def medaljklubbar():
    """Klubbar som har minst en medalj i champions.json.

    Nämnaren behövs bara för dem: topplistan rankar medaljer, så en klubb
    utan medalj kan aldrig hamna där oavsett hur många lag den anmält. Att
    ta med alla 19 124 klubbar hade gjort filen 1,2 MB i stället för 319 kB,
    och 900 kB som ingen läser är 900 kB som varje besökare betalar för.
    """
    f = ROOT / "data" / "champions.json"
    if not f.exists():
        return None
    try:
        rader = (json.loads(f.read_text(encoding="utf-8")) or {}).get("rows") or []
    except Exception:
        return None
    ut = set()
    for r in rader:
        for nyckel in ("gc", "sc"):
            if r.get(nyckel):
                ut.add(r[nyckel])
        for b in r.get("bc") or []:
            ut.add(b)
    return ut


def main():
    index, anmalda = build_team_index()

    # Saknas champions.json (t.ex. första körningen) behålls allt hellre än
    # att en tom filtrering råkar tömma filen.
    med = medaljklubbar()
    if med:
        anmalda = {k: v for k, v in anmalda.items() if k in med}

    total_names = sum(len(v) for eds in index.values() for v in eds.values())
    skriv_om_ändrad(ARCHIVE_DIR / "team-index.json", index,
                    f"{len(index)} cuper, {total_names} lagnamn")

    total_lag = sum(n for cuper in anmalda.values()
                    for eds in cuper.values() for n in eds.values())
    skriv_om_ändrad(ARCHIVE_DIR / "club-entries.json", anmalda,
                    f"{len(anmalda)} klubbar, {total_lag} anmälda lag")


if __name__ == "__main__":
    sys.exit(main())
