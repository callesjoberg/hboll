#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad "hur ofta är det värt att skrapa den här cupen just nu"-logik för
GitHub Actions-skrapskripten (fetch_procup.py/fetch_gothia.py/
fetch_cupmanager.py) — samma "avslutad cup ändras aldrig"-princip som
refreshTtl() i js/app.js styr webbläsarens live-cache med, men här
bestämmer den om det är värt att göra nätverksanropen mot källsajten
överhuvudtaget den här körningen.

Workflow-jobbet kör nu var 20:e minut (i stället för var 6:e timme) för
att ge nästintill-live uppdateringar UNDER en cups egna speldagar — utan
att det kostar något extra att kolla en cup som ligger långt bort i tiden:
den här funktionen håller själv den effektiva kadensen nere för allt som
INTE är inom eller nära cupens eget kända matchfönster (första→sista
matchens starttid, ur redan hämtad data):

  > 72h kvar till första matchen:  glest, ~var 6:e timme (samma kadens
                                    som innan denna omgång)
  ≤ 72h kvar → cupen pågår → till
  24h efter sista matchen:         varje körning (var 20:e minut)
  däremellan:                      tre glesa uppföljningskontroller
                                    (~3 dygn, ~10 dygn efter sista matchen)
                                    för sena resultaträttningar
  längre än så:                    tyst för gott
"""

import time

ACTIVE_WINDOW_BEFORE_HOURS = 72  # täta kontroller redan såhär nära starten
ACTIVE_WINDOW_AFTER_HOURS = 24   # ...och såhär länge efter sista matchen
CHECKPOINTS_HOURS = (72, 240)    # ~3 / ~10 dygn efter sista matchen — sena rättelser
WINDOW_HOURS = 3                 # tolerans runt varje kontrollpunkt
SPARSE_HOURS = 6                 # "vila"-kadens för cuper långt fram i tiden


def _match_window(data):
    """(första matchens starttid, sista matchens starttid) i ms epoch, ur
    en redan hämtad datafils matcher — eller (None, None) om ingen data
    finns än (okänt schema, kan inte bedöma ett fönster)."""
    matches = (data or {}).get("matches") or []
    starts = [m.get("start") for m in matches if m.get("start")]
    if not starts:
        return None, None
    return min(starts), max(starts)


def should_refresh(existing_data):
    first_ms, last_ms = _match_window(existing_data)
    if first_ms is None:
        return True  # ingen data alls än — försök alltid

    now_ms = time.time() * 1000

    if now_ms < first_ms:
        hours_until_first = (first_ms - now_ms) / 3600000
        if hours_until_first <= ACTIVE_WINDOW_BEFORE_HOURS:
            return True  # börjar snart — kolla varje körning
        # långt fram i tiden — glesa kontroller (motsvarar gamla var-6:e-
        # timme-kadensen) trots att workflowet nu kör var 20:e minut.
        return int(time.time() // 3600) % SPARSE_HOURS == 0

    if now_ms <= last_ms:
        return True  # mitt i cupens speldagar — kolla varje körning

    hours_since_last = (now_ms - last_ms) / 3600000
    if hours_since_last <= ACTIVE_WINDOW_AFTER_HOURS:
        return True  # nyss avslutad
    return any(abs(hours_since_last - cp) <= WINDOW_HOURS for cp in CHECKPOINTS_HOURS)
