#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Snapshottar Cup Manager-cuperna i data/cups.json till statiska JSON-filer
(data/snapshot-<id>.json) i exakt samma matchformat som js/api.js producerar.

Syfte: förstabesök på sajten laddar direkt från snapshotten i stället för att
vänta på API:t; webbläsaren live-uppdaterar sedan bara pågående cuper.
Körs av GitHub Actions tillsammans med ProCup-skrapan. Ren stdlib."""

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
    return (f"MatchWindow({{limit:{limit},offset:{offset},tournamentId:{tid}}})"
            "{matches:[{... on Match:{start:{},arena:{},round:{},roundRank:{},"
            "nextMatchWinner:{},nextMatchLoser:{},"
            "away:{team:{}},division:{category:{},name:{}},"
            "home:{team:{}},result:{}}}]}")


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
            "home": {"id": home.get("id") or ref_id(home.get("team")),
                     "name": name_of(home)},
            "away": {"id": away.get("id") or ref_id(away.get("team")),
                     "name": name_of(away)},
            "res": norm_result(get(e.get("result"))),
        })
    matches.sort(key=lambda m: (m["start"], m["arena"]))
    return matches


def write_if_changed(path, data):
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if old.get("matches") == data["matches"]:
                print(f"{path.name}: oförändrad — skriver inte om")
                return
        except Exception:
            pass
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"skrev {path.name} ({len(data['matches'])} matcher)")


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(
        encoding="utf-8"))["cups"]
    for cup in cups:
        if not cup.get("tournamentId"):
            continue  # ProCup-cuper hanteras av fetch_procup.py
        snapshot_path = ROOT / "data" / f"snapshot-{cup['id']}.json"
        old = None
        if snapshot_path.exists():
            try:
                old = json.loads(snapshot_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        if not should_refresh(old):
            print(f"{cup['id']}: avslutad sen länge — hoppar över skrapningen (se _freshness.py)")
            continue
        t0 = time.time()
        try:
            store = fetch_store(cup["host"], cup["tournamentId"])
        except Exception as e:
            print(f"{cup['id']}: HOPPAR ÖVER ({e})")
            continue
        matches = normalize(store)
        print(f"{cup['id']}: {len(matches)} matcher på {time.time()-t0:.0f}s")
        write_if_changed(snapshot_path, {"ts": int(time.time() * 1000), "matches": matches})


if __name__ == "__main__":
    sys.exit(main())
