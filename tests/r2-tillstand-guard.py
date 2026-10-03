#!/usr/bin/env python3
"""Varje cup måste gå att återställa ur R2 vid jobbstart.

Bakgrund: data/ slutar committas till git, så CI startar utan förra
varvets filer. publish_r2.py --hamta-tillstand hämtar dem ur hinken i
stället. Missar den EN cup blir följden inte ett fel utan tystnad:

  * utan förra snapshoten är rimlighetsspärren avstängd (_sanity.py:25
    returnerar True när `old` saknas), så tom eller nedbantad källdata
    skrivs rakt igenom,
  * archive_results.py bygger index.json och champions.json ur allt som
    ligger på disk — saknas en upplaga krymper registren, och
    publish_r2.py laddar sedan upp de krympta versionerna över de hela.

R2 har ingen versionshistorik, så det går inte att rulla tillbaka.
Därför vaktas täckningen här i stället för att upptäckas i efterhand.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROT / "scripts"))

import publish_r2  # noqa: E402

fel: list[str] = []


def kräv(villkor: bool, text: str) -> None:
    if not villkor:
        fel.append(text)


cuper = json.loads((ROT / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
hämtas = publish_r2.tillståndsfiler()

# 1. Täckningen: varje cup har antingen en snapshot som mönstret fångar
#    eller en dataUrl som listan innehåller.
for cup in cuper:
    cid = cup["id"]
    snapshot = f"data/snapshot-{cid}.json"
    via_mönster = bool(publish_r2.TILLSTAND.match(snapshot))
    via_lista = cup.get("dataUrl") in hämtas
    kräv(via_mönster or via_lista,
         f"{cid}: varken {snapshot} eller dataUrl={cup.get('dataUrl')!r} hämtas ur R2")

# 2. Skyttefilerna byggs inkrementellt och måste också med.
kräv(bool(publish_r2.TILLSTAND.match("data/scorers-ahus.json")),
     "skyttestatistiken fångas inte av TILLSTAND")

# 3. Det som ska STANNA i git får inte hämtas — annars skrivs en kopia som
#    är nyare i git över av hinken, tyst, vid varje jobbstart.
for kvar in ["data/cups.json",
             "data/rosters-partille-2014.json",
             "data/archive/partille-2014.json",
             "data/club-directory-extra.json"]:
    kräv(not publish_r2.TILLSTAND.match(kvar) and kvar not in hämtas,
         f"{kvar} ligger i git men skulle hämtas ur R2 och skrivas över")

# 4. Allt som hämtas ligger under data/ — en nyckel utanför skulle skriva
#    var som helst i utcheckningen.
for nyckel in hämtas:
    kräv(nyckel.startswith("data/") and ".." not in nyckel,
         f"{nyckel}: hämtmålet pekar utanför data/")

if fel:
    print("r2-tillstand-guard: FEL")
    for f in fel:
        print("  -", f)
    sys.exit(1)

print(f"r2-tillstand-guard: OK ({len(cuper)} cuper, {len(hämtas)} dataUrl-filer)")
