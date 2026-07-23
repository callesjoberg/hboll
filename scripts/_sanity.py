#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad rimlighetsspärr för GitHub Actions-skrapskripten
(fetch_procup.py/fetch_gothia.py/fetch_cupmanager.py) — vägrar skriva över
en fil med något som ser ut som ett källfel eller en attack snarare än en
äkta uppdatering, t.ex. om källan plötsligt börjar servera en tom/kraftigt
nedbantad lista, eller om en stor andel redan avgjorda matcher med
riktiga resultat plötsligt visar 0-0.

Ingen skyddar mot subtila/små manipulationer (en enstaka felskriven
siffra går rakt igenom) — bara de grova, uppenbara fallen. Git-historiken
är det egentliga skyddsnätet mot allt annat (se README/kommentarer i
scripts/_freshness.py): en avvisad fil här betyder bara "vänta och
försök igen nästa körning", inte "problemet är löst"."""

MIN_MATCHES_FOR_CHECK = 5     # för få matcher för att kunna säga något vettigt
MAX_DROP_FRACTION = 0.5       # matchantalet får rasa högst 50 % mellan körningar
MAX_ZEROED_FRACTION = 0.3     # högst 30 % av tidigare redovisade resultat får bli 0-0


def check_plausible(old, new):
    """→ (ok: bool, reason: str|None). old/new är hela filens dict
    ({"matches": [...], ...}); old kan vara None (första hämtningen,
    inget att jämföra med — alltid OK då)."""
    if not old or not old.get("matches"):
        return True, None

    old_matches = old["matches"]
    new_matches = new.get("matches") or []
    old_count, new_count = len(old_matches), len(new_matches)

    if old_count >= MIN_MATCHES_FOR_CHECK and new_count < old_count * (1 - MAX_DROP_FRACTION):
        return False, f"matchantalet rasade från {old_count} till {new_count}"

    old_by_id = {m["id"]: m for m in old_matches if m.get("id") is not None}
    scored_before = 0
    zeroed_now = 0
    for m in new_matches:
        old_m = old_by_id.get(m.get("id"))
        if not old_m:
            continue
        old_res, new_res = (old_m.get("res") or {}), (m.get("res") or {})
        had_real_score = old_res.get("fin") and (old_res.get("hg") or old_res.get("ag"))
        if not had_real_score:
            continue
        scored_before += 1
        if new_res.get("fin") and not new_res.get("hg") and not new_res.get("ag"):
            zeroed_now += 1

    if scored_before >= MIN_MATCHES_FOR_CHECK and zeroed_now / scored_before > MAX_ZEROED_FRACTION:
        return False, (f"{zeroed_now} av {scored_before} tidigare redovisade resultat "
                        f"visar nu 0-0")

    return True, None
