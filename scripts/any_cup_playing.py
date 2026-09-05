#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Spelas det matcher just nu i NÅGON av cuperna? Avslutar med 0 (ja)
eller 1 (nej), så scripts/ci_update_loop.sh kan använda det som villkor.

Läser de redan hämtade datafilerna i data/ — inga nätverksanrop."""

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _freshness import playing_now  # noqa: E402

ROT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    spelar = []
    for sökväg in sorted(glob.glob(os.path.join(ROT, "data", "*.json"))):
        try:
            with open(sökväg, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or not data.get("matches"):
            continue
        if playing_now(data):
            spelar.append(os.path.basename(sökväg))
    if spelar:
        print("Matchtid i: " + ", ".join(spelar))
        return 0
    print("Ingen cup spelar just nu.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
