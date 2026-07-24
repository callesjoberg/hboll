#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Snapshottar Cup Manager-cuperna i data/cups.json till statiska JSON-filer
(data/snapshot-<id>.json) i exakt samma matchformat som js/api.js producerar.

Syfte: förstabesök på sajten laddar direkt från snapshotten i stället för att
vänta på API:t; webbläsaren live-uppdaterar sedan bara pågående cuper.
Körs av GitHub Actions tillsammans med ProCup-skrapan. Ren stdlib."""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _freshness import should_refresh  # noqa: E402
from _sanity import check_plausible  # noqa: E402

PAGE = 1000
MAX_PAGES = 40
CONC = 4

ROOT = Path(__file__).resolve().parent.parent


def api_call(host, tid, query):
    url = (f"https://{host}/rest/results_api/call?call="
           f"{urllib.parse.quote(query)}&lang=sv&tournamentId={tid}")
    req = urllib.request.Request(url, headers={
        "accept": "application/json", "user-agent": "hboll-bot/1.0"})
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(1 + 2 * i)
    raise last


def match_query(tid, limit, offset):
    # round/roundRank/nextMatchWinner/nextMatchLoser krävs för att kunna
    # rita slutspelsträd (samma fält som playoffQuery i js/api.js) — hämtas
    # nu för ALLA matcher (inte bara slutspel) så en enda MatchWindow-fråga
    # räcker; grupp-matcher får bara tomma/irrelevanta värden för dem.
    #
    # club:{address:...} ger klubbens registrerade postadress (stad+
    # koordinater+land) — helt gratis att hänga med här eftersom store:n
    # redan deduplicerar per NameClub-entitet oavsett hur många lag/matcher
    # som refererar samma klubb (se clubs_from_store). Används av
    # Karta-fliken i js/app.js.
    team_fields = "{club:{address:{address:{city:{},lat:{},lng:{},nation:{name:{},code:{}}}}}}"
    return (f"MatchWindow({{limit:{limit},offset:{offset},tournamentId:{tid}}})"
            "{matches:[{... on Match:{start:{},arena:{},round:{},roundRank:{},"
            "nextMatchWinner:{},nextMatchLoser:{},"
            f"away:{{team:{team_fields}}},division:{{category:{{}},name:{{}}}},"
            f"home:{{team:{team_fields}}},result:{{}}}}}}]}}")


def ref_id(node):
    if isinstance(node, dict):
        # \w*[Ii]d: fångar även t.ex. "categoryId:" — Category-referenser
        # saknar ett rent "id"-fält, så den strikta varianten gav alltid
        # None för dem. Första träffen är entitetens primära id.
        m = re.search(r"\w*[Ii]d:(\d+)", node.get("href", ""))
        if m:
            return int(m.group(1))
    return None


def name_of(entity):
    n = entity.get("name") if isinstance(entity, dict) else None
    if isinstance(n, dict):
        return n.get("sv") or n.get("en") or next(iter(n.values()), "")
    return n or ""


def fetch_store(host, tid):
    store = {}
    offset = 0
    for _wave in range(0, MAX_PAGES, CONC):
        offsets = [offset + i * PAGE for i in range(CONC)]
        with ThreadPoolExecutor(max_workers=CONC) as ex:
            results = list(ex.map(
                lambda o: api_call(host, tid, match_query(tid, PAGE, o)),
                offsets))
        short = False
        for resp in results:
            n = 0
            for k, v in (resp.get("responses") or {}).items():
                if isinstance(v, dict) and isinstance(v.get("entity"), dict):
                    store[k] = v["entity"]
                    if v["entity"].get("__typename") == "Match":
                        n += 1
            if n < PAGE:
                short = True
        if short:
            break
        offset += CONC * PAGE
    return store


def norm_result(res):
    """Samma fält som normalizeResult i js/api.js."""
    if not isinstance(res, dict) or res.get("__typename") != "MatchResult":
        return None
    return {
        "fin": bool(res.get("finished")),
        "live": bool(res.get("live")),
        "hg": res.get("homeGoals") or 0,
        "ag": res.get("awayGoals") or 0,
        "hsw": res.get("homeSetsWon") or 0,
        "asw": res.get("awaySetsWon") or 0,
        "winByPeriods": bool(res.get("winByPeriods")),
        "per": [{"h": p.get("homeGoals"), "a": p.get("awayGoals")}
                for p in (res.get("periodScores") or [])],
        "wo": bool(res.get("walkover")),
        "winner": res.get("winner") or None,
        "hidden": bool(res.get("hideGoalResults")),
    }


def normalize(store):
    def get(ref):
        if isinstance(ref, dict):
            return store.get(ref.get("href"), {}) or {}
        return {}

    matches = []
    for e in store.values():
        if e.get("__typename") != "Match":
            continue
        home, away = get(e.get("home")), get(e.get("away"))
        arena, division = get(e.get("arena")), get(e.get("division"))
        category, rnd = get(division.get("category")), get(e.get("round"))
        rr = get(e.get("roundRank"))
        next_w, next_l = get(e.get("nextMatchWinner")), get(e.get("nextMatchLoser"))
        matches.append({
            "id": e.get("id"),
            "start": e.get("start") or 0,
            "arena": arena.get("completeName") or arena.get("fieldName") or "",
            "divId": division.get("id") or ref_id(e.get("division")),
            "divName": name_of(division),
            # "Conference" (gruppspel) eller "Playoff" (slutspel) — roundRank
            # kan vara 0 för BÅDA (grupp-rundor saknar bara namn), så det
            # här fältet är det enda tillförlitliga sättet att skilja ett
            # riktigt slutspelsträd från vanliga gruppmatcher.
            "divType": division.get("__typename") or "",
            "catId": ref_id(division.get("category")),
            "catName": name_of(category),
            "roundName": name_of(rnd),
            # Samma fältnamn/betydelse som normPlayoffMatch() i js/api.js,
            # så arkiverade matcher går att mata rakt in i samma
            # trädritningskod (bracketBlock/groupPlayoffRounds) som
            # live-slutspelet använder.
            "roundRank": rnd.get("rank") if rnd.get("rank") is not None else 99,
            "matchRank": rr.get("rank") or 0,
            "nextWinnerId": ref_id(next_w.get("match")),
            "nextLoserId": ref_id(next_l.get("match")),
            "matchNr": e.get("matchNr") or None,
            # club: rena klubbnamnet (NameClub.name, samma entitet som
            # clubs_from_store redan går via för adressen) UTAN lagsuffix,
            # till skillnad från "name" (fullt lagnamn, t.ex. "Alingsås HK
            # Blå"). Kräver ingen extra fråga — home/away:s team:{club:{...}}
            # är redan hämtat för adressen, bara ett extra steg i store:n.
            "home": {"id": home.get("id") or ref_id(home.get("team")),
                     "name": name_of(home),
                     "club": get(get(home.get("team")).get("club")).get("name")},
            "away": {"id": away.get("id") or ref_id(away.get("team")),
                     "name": name_of(away),
                     "club": get(get(away.get("team")).get("club")).get("name")},
            "res": norm_result(get(e.get("result"))),
        })
    matches.sort(key=lambda m: (m["start"], m["arena"]))
    return matches


def clubs_from_store(store):
    """{klubbnamn: {city, lat, lng, country}} — bara klubbar med en ifylld
    adress (saknas för enstaka lag som registrerats utan klubbadress). Två
    hopp: NameClub.address är en referens till en NameClub$NameClubAddress-
    wrapper vars EGET address-fält pekar på den riktiga Address-entiteten
    (samma indirektion oavsett sport/cup, verifierad mot både handbolls-
    och fotbollscuper på Cup Manager). country: landskoden (t.ex. "SE"),
    stabil oavsett språk till skillnad från nationens översatta namn."""
    def get(ref):
        if isinstance(ref, dict):
            return store.get(ref.get("href"), {}) or {}
        return {}

    clubs = {}
    for e in store.values():
        if e.get("__typename") != "NameClub":
            continue
        name = e.get("name")
        if not name:
            continue
        addr = get(get(e.get("address")).get("address"))
        if addr.get("lat") is None or addr.get("lng") is None:
            continue
        nation = get(addr.get("nation"))
        clubs[name] = {"city": addr.get("city") or "",
                        "lat": addr["lat"], "lng": addr["lng"],
                        "country": nation.get("code") or ""}
    return clubs


def sport_query(tid):
    return f"Tournament({{id:{tid}}}){{subcup:{{sport:{{name:{{}}}}}}}}"


# Cup Manager taggar varje turnering med en riktig Sport-entitet (nåbar via
# dess SubCup) — "Handboll", "Beachhandboll", "Fotboll (7)" osv, upptäckt
# genom att prova fältnamn mot API:t tills ett gav napp (se
# Tournament({id})$subcup$sport). Grupperas hit till breda kategorier
# (handboll/fotboll/...) som js/app.js:s sportväljare i Inställningar
# separerar cuper efter — beachhandboll räknas som handboll HÄR (cup.beach
# täcker den distinktionen separat, se data/cups.json), bara riktigt andra
# sporter (fotboll m.fl.) ska särskiljas i sportväljaren.
def normalize_sport(raw):
    if not raw:
        return None
    low = raw.lower()
    if "handboll" in low:
        return "handboll"
    if "fotboll" in low:
        return "fotboll"
    if "volleyboll" in low or "volleyball" in low:
        return "volleyboll"
    if "innebandy" in low:
        return "innebandy"
    if "basket" in low:
        return "basket"
    return low.strip()  # okänd sport — behåll normaliserat originalnamn i stället för att gissa fel


def tournament_sport(host, tid):
    resp = api_call(host, tid, sport_query(tid))
    for v in (resp.get("responses") or {}).values():
        ent = v.get("entity") if isinstance(v, dict) else None
        if isinstance(ent, dict) and ent.get("__typename") == "Sport":
            return normalize_sport(ent.get("name"))
    return None


def write_if_changed(path, data, old=None):
    if old is None and path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            old = None
    # "clubs" tillkom 2026-07-24 — old.get("clubs") is None fångar ÄLDRE
    # snapshottar som redan har identiska matcher (och annars aldrig skulle
    # skrivas om) så de får sin klubbdata efterhand utan att man manuellt
    # måste radera filerna.
    if old and old.get("matches") == data["matches"] and old.get("clubs") is not None:
        print(f"{path.name}: oförändrad — skriver inte om")
        return
    ok, reason = check_plausible(old, data)
    if not ok:
        print(f"{path.name}: VÄGRAR skriva — data ser orimlig ut ({reason}). "
              f"Behåller senaste kända goda version.")
        return
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"skrev {path.name} ({len(data['matches'])} matcher)")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true",
                    help="ignorera should_refresh (_freshness.py) och hämta om ALLA cuper, "
                         "även sen länge avslutade — för engångsbackfyllning när ett nytt "
                         "fält lagts till i normalize()/clubs_from_store() som gamla, "
                         "annars aldrig-omskrapade snapshottar saknar")
    p.add_argument("--only", default=None,
                    help="komma-separerad lista cup-id:n (förval: alla Cup Manager-cuper)")
    args = p.parse_args()
    only = set(args.only.split(",")) if args.only else None

    cups_path = ROOT / "data" / "cups.json"
    cups_doc = json.loads(cups_path.read_text(encoding="utf-8"))
    cups = cups_doc["cups"]
    cups_changed = False
    for cup in cups:
        if not cup.get("tournamentId"):
            continue  # ProCup-cuper hanteras av fetch_procup.py
        if only and cup["id"] not in only:
            continue
        # Sport-taggen är i praktiken evig för en given cup (byts aldrig
        # mellan upplagor) — läser bara av den när den SAKNAS (ny cup via
        # admin.html) eller vid --force, i stället för att slösa ett extra
        # API-anrop i onödan på varje schemalagd körning.
        if args.force or not cup.get("sport"):
            try:
                sport = tournament_sport(cup["host"], cup["tournamentId"])
            except Exception as e:
                sport = None
                print(f"{cup['id']}: kunde inte läsa av sport ({e})")
            if sport and sport != cup.get("sport"):
                old_sport = cup.get("sport")
                cup["sport"] = sport
                cups_changed = True
                print(f"{cup['id']}: sport → {sport}" +
                      (f" (var {old_sport!r})" if old_sport else ""))
        snapshot_path = ROOT / "data" / f"snapshot-{cup['id']}.json"
        old = None
        if snapshot_path.exists():
            try:
                old = json.loads(snapshot_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        if not args.force and not should_refresh(old):
            print(f"{cup['id']}: avslutad sen länge — hoppar över skrapningen (se _freshness.py)")
            continue
        t0 = time.time()
        try:
            store = fetch_store(cup["host"], cup["tournamentId"])
        except Exception as e:
            print(f"{cup['id']}: HOPPAR ÖVER ({e})")
            continue
        matches = normalize(store)
        clubs = clubs_from_store(store)
        print(f"{cup['id']}: {len(matches)} matcher, {len(clubs)} klubbar med adress "
              f"på {time.time()-t0:.0f}s")
        write_if_changed(snapshot_path,
                          {"ts": int(time.time() * 1000), "matches": matches, "clubs": clubs},
                          old=old)

    if cups_changed:
        cups_path.write_text(json.dumps(cups_doc, ensure_ascii=False, indent=2) + "\n",
                              encoding="utf-8")
        print("data/cups.json uppdaterad med avlästa sporter")


if __name__ == "__main__":
    sys.exit(main())
