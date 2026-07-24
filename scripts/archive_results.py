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
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = ROOT / "data" / "archive"


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
    år som inte längre är "aktuella" i cups.json fortsätter listas."""
    by_cup = {}
    for f in sorted(ARCHIVE_DIR.glob("*.json")):
        if f.name == "index.json":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        cid, edition = d.get("cupId"), d.get("edition")
        if not cid or not edition:
            continue
        matches = d.get("matches") or []
        finished = sum(1 for m in matches if (m.get("res") or {}).get("fin"))
        teams = set()
        classes = set()
        days = set()
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
            "ts": d.get("ts"),
        })
    for cid in by_cup:
        by_cup[cid]["editions"].sort(key=lambda e: e["edition"])
    return by_cup


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

    index = build_index()
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


if __name__ == "__main__":
    sys.exit(main())
