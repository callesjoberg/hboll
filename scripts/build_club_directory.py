#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Slår ihop klubbadresser (stad/koordinater/land) från ALLA klassiska
Cup Manager-cupers snapshot-filer (data/snapshot-<id>.json, se
clubs_from_store() i fetch_cupmanager.py) till en enda katalog,
data/club-directory.json.

Varken ProCup eller Gothia Result Web (Partille m.fl.) exponerar
klubbadresser alls i sina egna API:er/scraping — men samma klubbar
spelar ofta ÄVEN i klassiska Cup Manager-cuper. Karta-fliken i js/app.js
(clubGeoFromMatches/matchClubName) slår upp sådana cupers lagnamn mot
katalogen här via tokenbaserad fuzzy-matchning för att gissa en adress
ändå.

Körs sist i GitHub Actions-workflowet, efter fetch_cupmanager.py — ren
stdlib, inget nätverksanrop, bara läser redan skrapad data."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# Rensar bort skiljetecken/mellanslagsskillnader ("HK Silwing Troja" vs
# "HK Silwing - Troja" ska ge samma nyckel) — MEDVETET inget mer aggressivt
# än så (ingen borttagning av klubbtypsord som HK/IF, ingen genitiv-s-
# normalisering, se js/app.js:s coreClubTokens/matchClubName för den
# betydligt djärvare fuzzy-matchningen mot LAGnamn). Två olika RIKTIGA
# klubbar råkar annars lätt dela samma ortnamn efter en sådan hårdare
# normalisering (t.ex. en handbolls- och en fotbollsklubb i samma stad) —
# att då slå ihop dem här skulle permanent FÖRLORA den ena adressen. Bara
# rena stavnings-/skiljeteckensvarianter av exakt samma namn är säkra att
# slå ihop i själva katalogen.
def punctuation_key(name):
    return re.sub(r"\W+", " ", name.lower(), flags=re.UNICODE).strip()


def main():
    directory = {}
    seen_punct_keys = {}
    merged_count = 0
    for f in sorted((ROOT / "data").glob("snapshot-*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for name, info in (data.get("clubs") or {}).items():
            # Första träffen vinner — samma klubbnamn (eller samma namn
            # modulo skiljetecken, se punctuation_key) bör ha samma adress
            # oavsett vilken cup som råkade skrapas/läsas först.
            if name in directory:
                continue
            key = punctuation_key(name)
            if key in seen_punct_keys:
                merged_count += 1
                continue
            seen_punct_keys[key] = name
            directory[name] = info

    out_path = ROOT / "data" / "club-directory.json"
    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    merged_note = f" ({merged_count} skiljetecken-dubbletter slogs ihop)" if merged_count else ""
    if old == directory:
        print(f"club-directory.json: oförändrad ({len(directory)} klubbar){merged_note}")
        return
    out_path.write_text(json.dumps(directory, ensure_ascii=False), encoding="utf-8")
    print(f"skrev club-directory.json: {len(directory)} klubbar{merged_note}")


if __name__ == "__main__":
    main()
