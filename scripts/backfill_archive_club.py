#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fyller i home/away.club (rena klubbnamnet) i äldre arkivfiler som
skrapades innan fältet fanns — samma slags efterhandsfyllning som
backfill_archive_country_cupmanager.py gör för .country, och bygger på
exakt samma observation: ett lags NameClub går att slå upp via VILKEN
SOM HELST giltig tournamentId på samma host, så varje upplagas egna
historiska tournamentId behövs inte.

Varför det behövs: fältet tillkom i skraporna 2026-07-24 (se normalize()
i fetch_cupmanager.py). År arkiverade dessförinnan saknar det helt,
vilket ger clubs = 0 i data/archive/index.json — och en nolla läses som
"cupen hade inga klubbar" i stället för "uppgift saknas" (Trend gömmer
därför hela kolumnen, se renderTrendChartBlock i js/app.js).

Varför inte härleda ur lagnamnet i stället: normalize_club() i
archive_results.py träffar bara 95 % mot äkta data, och felen är
systematiska på klubbar vars namn SLUTAR i en siffra — "H 71" blir "H",
"VSH 2002" blir "VSH". Det skulle skapa klubbar som inte finns, i data
som driver både klubbräkning och kartan. Riktiga uppslag alltså.

Gäller bara Cup Manager-cuper. ProCup/Gothia-cuperna (cups.json:s
dataUrl) har ingen sådan här API-väg; deras äldre år får leva utan
fältet tills skrapan hämtar om dem.

Körs manuellt, inte i det schemalagda workflowet (samma resonemang som
country-backfillen — det är tusentals anrop mot arrangörens server):
    python3 scripts/backfill_archive_club.py --only goteborgcup
    python3 scripts/backfill_archive_club.py --all
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
CONC = 6  # som country-backfillen: DSL:t saknar batchning, men var snäll mot värden

sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive_results import is_placeholder_team  # noqa: E402  (delad definition)


def api_call(host, tid, query, retries=3):
    url = (f"https://{host}/rest/results_api/call?call="
           f"{urllib.parse.quote(query)}&lang=sv&tournamentId={tid}")
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               "user-agent": "hboll-bot/1.0"})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(0.5 + i)
    raise last


def fetch_club(host, tid, team_id):
    q = f"Team({{id:{team_id}}}){{club:{{name:{{}}}}}}"
    try:
        data = api_call(host, tid, q)
    except Exception:
        return team_id, None
    for v in (data.get("responses") or {}).values():
        e = v.get("entity") or {}
        if e.get("__typename") == "NameClub":
            return team_id, e.get("name")
    return team_id, None


def fetch_clubs(host, tid, team_ids, progress=None):
    result = {}
    done = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for team_id, name in ex.map(lambda t: fetch_club(host, tid, t), team_ids):
            done += 1
            if name:
                result[team_id] = name
            if progress and done % 250 == 0:
                progress(done, len(team_ids), len(result))
    return result


def missing_team_ids(path):
    """Lag-id som saknar club — utom slutspelsplatshållare ("Vinn.", "1:an i
    Grupp A"), som varken har eller kan få en klubb. De är många i ett
    ospelat slutspelsträd (Åhus 2015: 742 av 742 saknade club) och varje
    uppslag hade bara gett None efter en full nätrunda."""
    d = json.loads(path.read_text(encoding="utf-8"))
    ids = set()
    for m in d.get("matches") or []:
        for side in ("home", "away"):
            s = m.get(side) or {}
            if (s.get("id") is not None and not (s.get("club") or "").strip()
                    and not is_placeholder_team(s)):
                ids.add(s["id"])
    return d, ids


def patch_file(path, d, clubs):
    patched = 0
    for m in d.get("matches") or []:
        for side in ("home", "away"):
            s = m.get(side) or {}
            name = clubs.get(s.get("id"))
            if name and not (s.get("club") or "").strip():
                s["club"] = name
                patched += 1
    if patched:
        path.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return patched


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--only", help="kommaseparerade cup-id ur cups.json, t.ex. goteborgcup,orebro")
    g.add_argument("--all", action="store_true", help="alla Cup Manager-cuper som saknar club")
    args = p.parse_args()

    cups = {c["id"]: c for c in
            json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]}
    wanted = set(args.only.split(",")) if args.only else set(cups)

    for cup_id in sorted(wanted):
        cup = cups.get(cup_id)
        if not cup:
            print(f"{cup_id}: finns inte i cups.json — hoppar", file=sys.stderr)
            continue
        if cup.get("dataUrl") or not cup.get("host"):
            if args.only:
                print(f"{cup_id}: ProCup/Gothia — ingen API-väg för klubbnamn, hoppar")
            continue
        host, tid = cup["host"], cup["tournamentId"]

        files = sorted(ARCHIVE_DIR.glob(f"{cup_id}-*.json"))
        # Ett lag-id är unikt per upplaga, men samla över alla årsfiler ändå:
        # ett enda uppslag räcker då även om samma id mot förmodan återkommer.
        per_file, all_ids = [], set()
        for f in files:
            d, ids = missing_team_ids(f)
            if ids:
                per_file.append((f, d, ids))
                all_ids |= ids
        if not all_ids:
            continue

        print(f"{cup_id}: {len(all_ids)} lag att slå upp i {len(per_file)} årsfiler …", flush=True)
        clubs = fetch_clubs(host, tid, sorted(all_ids), progress=lambda d_, t, ok: print(
            f"  {cup_id}: {d_}/{t} klara, {ok} med klubbnamn", flush=True))
        total = 0
        for f, d, _ in per_file:
            n = patch_file(f, d, clubs)
            total += n
            print(f"  {f.name}: {n} lagsidor fyllda", flush=True)
        print(f"{cup_id}: klart — {len(clubs)}/{len(all_ids)} lag lösta, "
              f"{total} lagsidor uppdaterade", flush=True)

    print("Kör scripts/archive_results.py (eller bara build_index) för att "
          "räkna om data/archive/index.json.")


if __name__ == "__main__":
    main()
