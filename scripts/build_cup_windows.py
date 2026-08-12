#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bygger data/cup-windows.json: varje cups matchfönster (första→sista
matchens starttid) i ms epoch, så att appen kan välja en VETTIG startcup
för en besökare som aldrig varit inne förr.

Utan den här filen faller js/app.js tillbaka på första cupen i
data/cups.json — en godtycklig ordning som inte har med kalendern att
göra. Med den väljs i stället den cup som pågår just nu, annars den som
startar närmast i tiden (se pickDefaultCup i js/app.js).

Fönstret är samma sak som scripts/_freshness.py räknar ut för att avgöra
hur ofta en cup är värd att skrapa — därför återanvänds funktionerna
därifrån rakt av, så att skrapkadens och startcupval aldrig kan börja
tolka kalendern olika.

Cuper som ännu inte publicerat några tider får en UPPSKATTAD start ur
förra upplagans datum (markeras "est": 1). Den duger till att sortera in
cupen på rätt plats i kalendern, men den räknas aldrig som pågående —
en gissning ska inte kunna kapa startvyn från en cup med riktig data.

Ren stdlib, inga nätverksanrop: läser bara redan skrapad data. Körs sist
i workflowet, efter skraporna."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _freshness import _estimated_first_ms, _match_window  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def _data_file(cup):
    """Cupens datafil: ProCup/Gothia-cuperna pekar ut sin egen via dataUrl,
    Cup Manager-cuperna ligger i snapshot-<id>.json."""
    rel = cup.get("dataUrl") or ("data/snapshot-" + cup["id"] + ".json")
    return ROOT / rel


def main():
    cups = json.loads((ROOT / "data" / "cups.json").read_text(
        encoding="utf-8")).get("cups") or []

    out = {}
    real = est = 0
    for cup in cups:
        cup_id = cup.get("id")
        if not cup_id:
            continue
        try:
            data = json.loads(_data_file(cup).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = None

        first, last = _match_window(data)
        if first is not None:
            out[cup_id] = {"first": first, "last": last}
            real += 1
            continue

        # Inget schema publicerat än — gissa ur förra upplagans datum.
        guess = _estimated_first_ms(cup_id)
        if guess is not None:
            out[cup_id] = {"first": int(guess), "est": 1}
            est += 1

    (ROOT / "data" / "cup-windows.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    missing = [c.get("id") for c in cups if c.get("id") and c["id"] not in out]
    msg = f"skrev cup-windows.json: {real} med schema, {est} uppskattade"
    if missing:
        msg += f" | utan datum: {', '.join(missing)}"
    print(msg)


if __name__ == "__main__":
    main()
