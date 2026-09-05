#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger målskyttestatistik per cup ur Cup Managers matchfeed.

Feeden (Match({id}){feed:{events:[...]}}) har ett event per mål med löpande
ställning, sida och — när sekretariatet registrerat det — målskyttens namn
och nummer. Ungefär tre fjärdedelar av målen har en skytt.

Skriver data/scorers-<cup>.json med en aggregerad rad per spelare och lag.
Aggregat, inte rådata: Göteborg Cups ~11 000 mål blir 150 kB som lista över
spelare, mot flera megabyte som enskilda målhändelser. Klienten kan ändå
gruppera på klass och lag, eftersom lag-id:t finns i snapshotten.

Inkrementellt: varje körning hämtar bara feeds för matcher som blivit
FÄRDIGA sedan sist (fältet "done"). Under en cup betyder det en handfull
per varv. Den som redan räknats räknas aldrig om — en efterhandsrättad
match uppdateras alltså inte, vilket är priset för att slippa hämta hela
cupen var femte minut.

Körs av GitHub Actions efter fetch_cupmanager.py. Ren stdlib."""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_cupmanager import api_call  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONC = 4
# Tak per cup och körning. Första gången en stor cup byggs upp (Åhus har
# 6382 matcher) ska den inte hålla CI-loopens femminuterstakt gisslan —
# den betar av sig själv över några varv i stället.
MAX_PER_RUN = 400
# Total tidsbudget per körning, över ALLA cuper. CI-loopen håller fem
# minuters takt under matchtid, och en förstagångsuppbyggnad av trettio
# cuper får inte äta upp den. Det som inte hinns med tas nästa varv.
BUDGET_S = 60

FEED_TYPES = ["MatchGoal", "MatchStart", "MatchStop"]
FEED_FRAGMENT = "{" + ",".join(f"... on {t}:{{}}" for t in FEED_TYPES) + "}"


def match_goals(host, tid, match_id):
    """[(side, spelarnamn|None, nummer|None)] för en match."""
    q = f"Match({{id:{match_id}}}){{feed:{{events:[{FEED_FRAGMENT}]}}}}"
    doc = api_call(host, tid, q)
    ut = []
    for v in (doc.get("responses") or {}).values():
        e = (v or {}).get("entity") or {}
        if e.get("__typename") != "MatchGoal":
            continue
        nr = e.get("playerNr")
        ut.append((e.get("side"), e.get("playerName") or None,
                   nr if isinstance(nr, int) else None))
    return ut


def load_existing(path):
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"done": [], "players": [], "goals": {"total": 0, "named": 0}}
    doc.setdefault("done", [])
    doc.setdefault("players", [])
    doc.setdefault("goals", {"total": 0, "named": 0})
    return doc


def build(cup, only_new=True):
    cup_id = cup["id"]
    snap = ROOT / "data" / f"snapshot-{cup_id}.json"
    if not snap.exists():
        return None
    try:
        matches = json.loads(snap.read_text(encoding="utf-8")).get("matches") or []
    except (OSError, ValueError):
        return None

    path = ROOT / "data" / f"scorers-{cup_id}.json"
    doc = load_existing(path) if only_new else {
        "done": [], "players": [], "goals": {"total": 0, "named": 0}}
    klara = set(doc["done"])
    # (lag-id, namn) -> rad. Nummer kan byta mellan matcher; senaste vinner.
    index = {(p["t"], p["n"]): p for p in doc["players"]}

    att_hamta = [m for m in matches
                 if (m.get("res") or {}).get("fin") and m.get("id") not in klara]
    if not att_hamta:
        return None
    kapat = len(att_hamta) > MAX_PER_RUN
    att_hamta = att_hamta[:MAX_PER_RUN]

    def hamta(m):
        try:
            return m, match_goals(cup["host"], cup["tournamentId"], m["id"])
        except Exception:
            return m, None

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        resultat = list(ex.map(hamta, att_hamta))

    nya = 0
    for m, goals in resultat:
        if goals is None:
            continue  # nätfel — försök igen nästa körning, markera inte klar
        klara.add(m["id"])
        nya += 1
        sett_i_matchen = set()
        for side, namn, nr in goals:
            doc["goals"]["total"] += 1
            if not namn:
                continue
            doc["goals"]["named"] += 1
            lag = m.get("away") if side == "away" else m.get("home")
            lag_id = (lag or {}).get("id")
            if lag_id is None:
                continue
            nyckel = (lag_id, namn)
            rad = index.get(nyckel)
            if rad is None:
                rad = {"t": lag_id, "n": namn, "nr": nr, "g": 0, "m": 0}
                index[nyckel] = rad
            if nr is not None:
                rad["nr"] = nr
            rad["g"] += 1
            if nyckel not in sett_i_matchen:
                sett_i_matchen.add(nyckel)
                rad["m"] += 1

    doc["cup"] = cup_id
    doc["ts"] = int(time.time() * 1000)
    doc["done"] = sorted(klara)
    doc["players"] = sorted(index.values(), key=lambda p: (-p["g"], p["n"]))
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    kvar = " (fler kvar till nästa körning)" if kapat else ""
    return (f"{path.name}: +{nya} matcher, {len(doc['players'])} spelare, "
            f"{doc['goals']['named']}/{doc['goals']['total']} mål med skytt{kvar}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--only", default=None, help="komma-separerad lista cup-id:n")
    p.add_argument("--rebuild", action="store_true",
                   help="räkna om från noll i stället för att bygga vidare")
    p.add_argument("--budget", type=float, default=BUDGET_S,
                   help="total tidsbudget i sekunder över alla cuper")
    args = p.parse_args()
    t0 = time.monotonic()
    only = set(args.only.split(",")) if args.only else None

    cups = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    for cup in cups:
        if not cup.get("tournamentId") or not cup.get("host"):
            continue  # ProCup/Gothia har ingen feed
        if only and cup["id"] not in only:
            continue
        if time.monotonic() - t0 > args.budget:
            print(f"tidsbudget ({args.budget}s) slut — resten tas nästa körning")
            break
        try:
            rad = build(cup, only_new=not args.rebuild)
        except Exception as e:
            print(f"{cup['id']}: fel — {e}")
            continue
        if rad:
            print(rad)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
