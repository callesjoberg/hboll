#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Engångs-/vid-behovsverktyg: listar alla lagnamn (över SAMTLIGA cuper,
både innevarande snapshot och alla arkiverade år) som klubbnamnsmatchningen
i js/app.js (matchClubName) INTE lyckas para ihop med en känd adress i
data/club-directory.json.

Portering av EXAKT samma tre-nivålogik som matchClubName i js/app.js —
håll de två i synk om du ändrar den ena (se kommentarerna där för
resonemanget bakom varje nivå).

Skriver data/unknown-clubs.json: [{name, count, cups: [...]}], sorterad
fallande på count (hur många matcher namnet förekommer i — en grov
"hur vanligt/viktigt att lösa upp" — signal).

Körs manuellt, inte del av det schemalagda workflowet:
    python3 scripts/find_unknown_clubs.py"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CLUB_STOPWORD_PREFIXES = [
    "handbollsförening", "handbollsforening", "handbollsklubb", "handboll",
    "fotbollsförening", "fotbollsforening", "fotbollsklubb", "fotboll",
    "idrottsförening", "idrottsforening", "idrottsklubb", "idrottsallians", "idrott",
    "bollklubb", "förening", "forening", "klubb", "allmänna", "allmanna",
]
CLUB_STOPWORD_EXACT = {"ik", "hk", "if", "ff", "bk", "gf", "sk", "hf", "fk",
                        "gif", "aif", "bif", "kif", "fbk", "tk"}
CLUB_COLOR_WORDS = {"röd", "blå", "gul", "vit", "svart", "grön", "orange",
                     "lila", "rosa", "silver", "guld", "grå"}


def is_club_stopword(w):
    return w in CLUB_STOPWORD_EXACT or any(w.startswith(p) for p in CLUB_STOPWORD_PREFIXES)


def strip_genitive(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def core_tokens(name):
    words = re.sub(r"[^\w]+", " ", name.lower(), flags=re.UNICODE).split()
    return [strip_genitive(w) for w in words if not is_club_stopword(w)]


def signature(tokens):
    return "|".join(sorted(tokens))


def normalize_for_prefix(name):
    words = re.sub(r"[^\w]+", " ", name.lower(), flags=re.UNICODE).split()
    return " ".join(strip_genitive(w) for w in words)


def is_strippable_suffix_token(w):
    return w.isdigit() or len(w) == 1 or w in CLUB_COLOR_WORDS


class ClubIndex:
    def __init__(self, directory):
        self.directory = directory
        self.by_exact = {}
        self.by_prefix = []
        self.by_signature = {}
        for dir_name in directory:
            self.by_exact[dir_name.lower().strip()] = dir_name
            self.by_prefix.append((normalize_for_prefix(dir_name), dir_name))
            sig = signature(core_tokens(dir_name))
            if sig:
                self.by_signature.setdefault(sig, []).append(dir_name)
        self.by_prefix.sort(key=lambda t: -len(t[0]))

    def pick_unambiguous(self, candidates):
        if len(candidates) == 1:
            return candidates[0]
        coords = {(round(self.directory[n]["lat"] * 500), round(self.directory[n]["lng"] * 500))
                  for n in candidates}
        return candidates[0] if len(coords) == 1 else None

    def match(self, name):
        exact = self.by_exact.get(name.lower().strip())
        if exact:
            return exact
        normalized = normalize_for_prefix(name)
        for norm_dir, orig in self.by_prefix:
            if norm_dir and normalized.startswith(norm_dir):
                return orig
        tokens = core_tokens(name)
        while tokens:
            cands = self.by_signature.get(signature(tokens))
            if cands:
                picked = self.pick_unambiguous(cands)
                if picked:
                    return picked
            if not is_strippable_suffix_token(tokens[-1]):
                break
            tokens = tokens[:-1]
        return None


def main():
    directory = json.loads((ROOT / "data" / "club-directory.json").read_text(encoding="utf-8"))
    index = ClubIndex(directory)

    unknown = {}  # name -> {"count": n, "cups": set()}
    files = sorted((ROOT / "data" / "archive").glob("*.json")) + \
        sorted((ROOT / "data").glob("snapshot-*.json"))
    for f in files:
        if f.name == "index.json":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        cup_id = d.get("cupId") or f.name.replace("snapshot-", "").replace(".json", "")
        for m in d.get("matches") or []:
            for side_key in ("home", "away"):
                side = m.get(side_key) or {}
                name = side.get("club") or side.get("name")
                if not name or index.match(name):
                    continue
                e = unknown.setdefault(name, {"count": 0, "cups": set()})
                e["count"] += 1
                e["cups"].add(cup_id)

    out = sorted(
        [{"name": name, "count": e["count"], "cups": sorted(e["cups"])}
         for name, e in unknown.items()],
        key=lambda r: -r["count"],
    )
    out_path = ROOT / "data" / "unknown-clubs.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"skrev {out_path.relative_to(ROOT)}: {len(out)} klubbnamn utan känd adress")


if __name__ == "__main__":
    main()
