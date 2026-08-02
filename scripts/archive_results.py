#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bevarar en kopia av varje cups senaste data per år, så resultat går att
jämföra mellan upplagor i appen även efter att cups.json:s tournamentId
bytts ut till nästa säsong.

Körs EFTER fetch_cupmanager.py/fetch_procup.py i workflowet (läser deras
redan hämtade data/snapshot-<id>.json respektive dataUrl-filer — skrapar
inget själv). data/archive/<cupId>-<edition>.json skrivs om varje körning
så länge cupen är aktuell (samma "edition" i cups.json); filen fryser
automatiskt den dagen cups.json pekas om till nästa års edition/
tournamentId, så gamla år bevaras för alltid utan extra kod.

data/archive/index.json listar vilka cupId+edition som finns arkiverade,
så frontend (js/api.js: fetchArchiveIndex/fetchArchiveEdition) slipper
gissa filnamn."""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"

# --- mästare/vinnare (data/champions.json, se js/app.js renderVinnareView) ---
# En "mästare" = vinnaren av matchen med roundName "Final" i A-slutspelet
# (divName "A-Slutspel", eller tomt för cuper som inte delar upp slutspelet i
# A/B/C). Silver = finalens förlorare, brons = bronsmatchens vinnare om sådan
# spelats, annars de två semifinalförlorarna (delad brons). Klubb härleds ur
# lagnamnet genom att skala bort lagsuffix (nummer, färg, division) så att
# "Alingsås HK 1/2/Vit" alla räknas till samma klubb i troféskåp/topplista.

_COLOR_WORDS = {
    "vit", "vita", "blå", "blaa", "gul", "gula", "röd", "roed", "rod", "svart",
    "grön", "groen", "gron", "orange", "lila", "rosa", "silver", "guld", "grå",
    "graa", "gra", "beige", "turkos", "cerise", "marin", "vinröd", "bordeaux",
}
_STRIP_SUFFIX_WORDS = _COLOR_WORDS | {"lag", "team", "h", "f", "d", "hk", "if"} - {"hk", "if"}


def normalize_club(raw):
    """Skala bort lagsuffix från slutet av ett lagnamn → klubbnamn.
    Ren funktion; medvetet enkel (matchar inte klubbkatalogen exakt, men
    slår ihop 1/2/Vit/Röd-varianter konsekvent, vilket är det som räknas
    för troféskåp och topplista)."""
    if not raw:
        return ""
    toks = raw.split()
    while len(toks) > 1:
        t = toks[-1].lower().strip(".")
        if (t in _STRIP_SUFFIX_WORDS
                or re.fullmatch(r"\d+", t)          # lagnummer: "1", "2"
                or re.fullmatch(r"[a-d]", t)        # A/B/C/D-lag
                or re.fullmatch(r"[dhf]\d+", t)     # D1, H65, F11
                or re.fullmatch(r"d\d", t)):        # D1, D2
            toks = toks[:-1]
            continue
        break
    return " ".join(toks).strip() or raw.strip()


_BRONZE_ROUNDS = {"3-4", "bronsmatch", "bronze", "3:e pris",
                  "match om 3:e pris", "match om 3:e plats", "match om brons"}


def a_final_rank(div_name):
    """Hur "A-slutspel" en slutspelsdivision är, oavsett hur cupen råkar
    stava den. Cuperna använder vitt skilda etiketter för samma sak:
    "A-Slutspel", "Slutspel A", "A Slutspel", "SlutspelA", "Playoff A",
    "A-Play-off", eller ett enda "Slutspel" (utan A/B/C-uppdelning).
      2 = uttryckligt A-slutspel  · 1 = enda/namnlöst slutspel  · 0 = ej A
    (B-/C-slutspel och rena gruppmatcher → 0, dvs ingen mästartitel)."""
    s = (div_name or "").lower()
    if not s:
        return 1  # tom division + roundName "Final" → enda finalen, räknas
    compact = re.sub(r"[^a-zåäö0-9]", "", s)
    if "slutspel" not in compact and "playoff" not in compact:
        return 0  # "Grupp 1" e.d. — en final där är inte ett mästerskap
    rest = compact.replace("slutspel", "").replace("playoff", "")
    rest = re.sub(r"[0-9]", "", rest)  # "slutspel5-8" → "" (platsspel, men syns bara med roundName Final i undantagsfall)
    if rest == "a":
        return 2
    if rest == "":
        return 1
    return 0  # b/c/d/e/f …


def _win_lose(m):
    w = (m.get("res") or {}).get("winner")
    if w == "home":
        return m.get("home") or {}, m.get("away") or {}
    if w == "away":
        return m.get("away") or {}, m.get("home") or {}
    return None, None


def _side(team):
    name = (team or {}).get("name")
    club = (team or {}).get("club") or name
    return name, normalize_club(club or "")


def extract_champions(matches, cup_id, cup_name, edition):
    """→ [{cup,cupName,ed,cat, g,gc, s,sc, b,bc}, ...] för en cup-upplaga."""
    from collections import defaultdict
    by_cat = defaultdict(lambda: {"final": None, "final_rank": 0, "semis": [], "bronze": None})
    for m in matches:
        rn = (m.get("roundName") or "").strip()
        if not rn:
            continue
        rank = a_final_rank(m.get("divName"))
        if rank == 0:                          # B-/C-slutspel eller gruppspel
            continue
        cat = m.get("catName") or ""
        g = by_cat[cat]
        if rn == "Final":
            # Har en klass både ett namnlöst "Slutspel" och ett uttryckligt
            # "Slutspel A" — behåll det uttryckliga A (högre rank).
            if rank > g["final_rank"]:
                g["final"] = m
                g["final_rank"] = rank
        elif rn == "Semifinal":
            g["semis"].append(m)
        elif rn.lower() in _BRONZE_ROUNDS:
            g["bronze"] = m
    rows = []
    for cat, g in by_cat.items():
        fm = g["final"]
        if not fm:
            continue
        win, lose = _win_lose(fm)
        if not win:
            continue  # final utan avgjord vinnare (t.ex. inställd) → ingen mästare
        g_name, g_club = _side(win)
        s_name, s_club = _side(lose) if lose else (None, None)
        # brons
        b_teams = []
        if g["bronze"]:
            bw, _ = _win_lose(g["bronze"])
            if bw:
                b_teams = [bw]
        else:
            for sm in g["semis"]:
                _, sl = _win_lose(sm)
                if sl:
                    b_teams.append(sl)
        b_sides = [_side(t) for t in b_teams[:2]]
        rows.append({
            "cup": cup_id, "cupName": cup_name, "ed": edition, "cat": cat,
            "g": g_name, "gc": g_club, "s": s_name, "sc": s_club,
            "b": [n for n, _ in b_sides], "bc": [c for _, c in b_sides],
        })
    return rows


def source_path(cup):
    if cup.get("dataUrl"):
        return ROOT / cup["dataUrl"]
    return ROOT / "data" / f"snapshot-{cup['id']}.json"


def write_if_changed(path, data):
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if all(old.get(k) == data.get(k) for k in
                   ("matches", "tables", "playoffs", "rosters")):
                return False
        except Exception:
            pass
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return True


def build_index():
    """Läser alla arkivfiler på disk (inte bara de som just skrevs) så att
    år som inte längre är "aktuella" i cups.json fortsätter listas.
    Bygger samtidigt mästarlistan (champions) ur samma inläsning."""
    by_cup = {}
    champions = []
    for f in sorted(ARCHIVE_DIR.glob("*.json")):
        if f.name in ("index.json", "champions.json"):
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        cid, edition = d.get("cupId"), d.get("edition")
        if not cid or not edition:
            continue
        matches = d.get("matches") or []
        champions.extend(extract_champions(
            matches, cid, d.get("cupName") or cid, edition))
        finished = sum(1 for m in matches if (m.get("res") or {}).get("fin"))
        teams = set()
        classes = set()
        days = set()
        clubs = set()
        countries = set()
        for m in matches:
            home, away = m.get("home") or {}, m.get("away") or {}
            if home.get("id") is not None:
                teams.add(home["id"])
            if away.get("id") is not None:
                teams.add(away["id"])
            classes.add(m.get("catId") if m.get("catId") is not None else m.get("catName"))
            start = m.get("start")
            if start:
                # "start" är svensk väggtid kodad som UTC-epoch-ms (se
                # js/api.js normalize()) — enkel heltalsdivision ger alltså
                # redan rätt svenskt kalenderdatum utan tidszonhantering.
                days.add(start // 86400000)
            # club: rena klubbnamnet (se normalize() i fetch_cupmanager.py/
            # fetch_gothia.py) — saknas i äldre arkivfiler skrapade innan
            # fältet fanns, då blir "clubs" bara 0 för den upplagan (se
            # trendClassOptions-liknande fallback i js/app.js).
            if home.get("club"):
                clubs.add(home["club"])
            if away.get("club"):
                clubs.add(away["club"])
            # country: turneringssystemets landskod för laget. Äldre
            # arkivfiler saknar fältet helt; None i indexet skiljer då
            # "uppgift saknas" från en faktisk räknad nolla.
            if home.get("country"):
                countries.add(home["country"])
            if away.get("country"):
                countries.add(away["country"])
        # Första/sista speldatum (svensk kalender, se dagberäkningen ovan) —
        # driver Kalender-fliken (Gantt över cupernas speldagar, se
        # renderKalenderView i js/app.js).
        first = last = None
        if days:
            first = datetime.fromtimestamp(min(days) * 86400, tz=timezone.utc).strftime("%Y-%m-%d")
            last = datetime.fromtimestamp(max(days) * 86400, tz=timezone.utc).strftime("%Y-%m-%d")
        by_cup.setdefault(cid, {"cupName": d.get("cupName") or cid, "editions": []})
        by_cup[cid]["cupName"] = d.get("cupName") or by_cup[cid]["cupName"]
        by_cup[cid]["editions"].append({
            "edition": edition,
            "file": f"data/archive/{f.name}",
            "matches": len(matches),
            "finished": finished,
            "teams": len(teams),
            "classes": len(classes),
            "days": len(days),
            "first": first,
            "last": last,
            "clubs": len(clubs),
            "countries": len(countries) if countries else None,
            "ts": d.get("ts"),
        })
    for cid in by_cup:
        by_cup[cid]["editions"].sort(key=lambda e: e["edition"])
    champions.sort(key=lambda r: (r["ed"], r["cup"], r["cat"]), reverse=True)
    return by_cup, champions


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(
        encoding="utf-8"))["cups"]
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    for cup in cups:
        edition = cup.get("edition")
        if not edition:
            continue
        src = source_path(cup)
        if not src.exists():
            continue
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"{cup['id']}: kunde inte läsa {src.name} ({e})")
            continue
        matches = data.get("matches") or []
        if not matches:
            continue  # inget att arkivera än (t.ex. cup vars schema inte publicerats)
        out = {
            "cupId": cup["id"], "cupName": cup["name"], "edition": edition,
            "ts": data.get("ts"), "matches": matches,
        }
        # Valfria fält som bara vissa skrapor bygger (tables: alla dataUrl-
        # cuper, playoffs/rosters: bara Gothia hittills) — kopieras rakt av
        # om de finns, i stället för att hårdkodas ett i taget och tyst
        # tappas bort när en ny läggs till (hände playoffs/rosters innan
        # den här kommentaren skrevs).
        for key in ("tables", "playoffs", "rosters"):
            if key in data:
                out[key] = data[key]
        dest = ARCHIVE_DIR / f"{cup['id']}-{edition}.json"
        changed = write_if_changed(dest, out)
        print(f"{cup['id']} {edition}: {len(matches)} matcher"
              f"{' (uppdaterad)' if changed else ' (oförändrad)'}")

    index, champions = build_index()
    index_path = ARCHIVE_DIR / "index.json"
    old_index = None
    if index_path.exists():
        try:
            old_index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if old_index != index:
        index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
        print(f"index.json uppdaterad ({len(index)} cuper arkiverade)")
    else:
        print("index.json: oförändrad")

    # Mästarlistan (Vinnare-fliken) — liten, egen fil i data/ (inte archive/,
    # så den inte råkar tolkas som en upplagefil av build_index/fetchArchive).
    champions_out = {"generated": datetime.now(timezone.utc).isoformat(), "rows": champions}
    champions_path = ROOT / "data" / "champions.json"
    old_champs = None
    if champions_path.exists():
        try:
            old_champs = json.loads(champions_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    # jämför bara raderna (inte tidsstämpeln) så filen inte skrivs om i onödan
    if not old_champs or old_champs.get("rows") != champions:
        champions_path.write_text(json.dumps(champions_out, ensure_ascii=False), encoding="utf-8")
        print(f"champions.json uppdaterad ({len(champions)} mästare)")
    else:
        print("champions.json: oförändrad")


if __name__ == "__main__":
    sys.exit(main())
