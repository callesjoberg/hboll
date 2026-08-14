#!/usr/bin/env python3
"""Bygg ett litet versionsindex för cupdata.

Klienten läser denna fil för att avgöra om en stor snapshot faktiskt har
ändrats. Inga nätverksanrop görs här; filen byggs efter skraporna i CI.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    cups_doc = json.loads((ROOT / "data" / "cups.json").read_text(encoding="utf-8"))
    entries = {}
    for cup in cups_doc.get("cups") or []:
        cup_id = cup.get("id")
        if not cup_id:
            continue
        url = cup.get("dataUrl") or f"data/snapshot-{cup_id}.json"
        path = ROOT / url
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        entries[cup_id] = {"ts": int(payload.get("ts") or 0), "url": url}

    target = ROOT / "data" / "snapshot-index.json"
    target.write_text(
        json.dumps({"schema": 1, "cups": entries}, ensure_ascii=False,
                   separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"skrev snapshot-index.json: {len(entries)} cuper")


if __name__ == "__main__":
    main()
