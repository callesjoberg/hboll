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

Saknas starttider helt (cupen har inte publicerat sitt schema än — ofta
är lottningen ute långt före tiderna, så matcherna finns men med start=0)
går det inte att bedöma något fönster ur datan. Då används FÖRRA årets
datum ur arkivindexet som uppskattning, samma heuristik som Kalender-
fliken redan ritar sina preliminära staplar med (se renderKalenderView i
js/app.js). Uppskattningen får BARA skjuta upp skrapning av en cup som
ligger tryggt långt fram — så fort det uppskattade fönstret är inom
räckhåll (eller om ingen uppskattning går att göra) skrapas det varje
körning igen. En cup som flyttat sig sedan förra året kan alltså aldrig
tystas ner av en gissning som visar sig fel.
"""

import datetime
import json
import pathlib
import time

ACTIVE_WINDOW_BEFORE_HOURS = 72  # täta kontroller redan såhär nära starten
ACTIVE_WINDOW_AFTER_HOURS = 24   # ...och såhär länge efter sista matchen
CHECKPOINTS_HOURS = (72, 240)    # ~3 / ~10 dygn efter sista matchen — sena rättelser
WINDOW_HOURS = 3                 # tolerans runt varje kontrollpunkt
SPARSE_HOURS = 6                 # "vila"-kadens för cuper långt fram i tiden

_ARCHIVE_INDEX = pathlib.Path(__file__).resolve().parent.parent / "data" / "archive" / "index.json"
_index_cache = None  # laddas en gång per körning (samma index för alla cuper)


def _match_window(data):
    """(första matchens starttid, sista matchens starttid) i ms epoch, ur
    en redan hämtad datafils matcher — eller (None, None) om ingen data
    finns än (okänt schema, kan inte bedöma ett fönster)."""
    matches = (data or {}).get("matches") or []
    starts = [m.get("start") for m in matches if m.get("start")]
    if not starts:
        return None, None
    return min(starts), max(starts)


def _archive_index():
    global _index_cache
    if _index_cache is None:
        try:
            _index_cache = json.loads(_ARCHIVE_INDEX.read_text(encoding="utf-8"))
        except Exception:
            _index_cache = {}
    return _index_cache


def _estimated_first_ms(cup_id):
    """Uppskattad starttid (ms epoch) för en cup som ännu inte publicerat
    några tider — förra kända upplagans startdatum flyttat till i år.
    None om cupen saknar arkiverad historik med datum."""
    if not cup_id:
        return None
    editions = (_archive_index().get(cup_id) or {}).get("editions") or []
    dated = [e for e in editions if e.get("first")]
    if not dated:
        return None
    try:
        prev = max(dated, key=lambda e: e["first"])["first"]  # "ÅÅÅÅ-MM-DD"
        month, day = int(prev[5:7]), int(prev[8:10])
        today = datetime.date.today()
        est = datetime.date(today.year, month, day)
        # Cuper runt årsskiftet (Lundaspelen spelas 26–30 dec): har årets
        # datum redan passerat med god marginal är det nästa års upplaga
        # som är på väg, inte en cup som just varit.
        if (today - est).days > 180:
            est = datetime.date(today.year + 1, month, day)
    except (ValueError, IndexError, KeyError):
        return None
    return time.mktime(est.timetuple()) * 1000


def should_refresh(existing_data, cup_id=None):
    first_ms, last_ms = _match_window(existing_data)
    if first_ms is None:
        # Inga starttider än. Ligger cupen enligt förra årets datum tryggt
        # långt fram räcker den glesa kadensen — annars skrapas den varje
        # körning, så ett publicerat schema fångas upp direkt.
        est_first_ms = _estimated_first_ms(cup_id)
        if est_first_ms is None:
            return True  # ingen aning om när cupen spelas — försök alltid
        hours_until_est = (est_first_ms - time.time() * 1000) / 3600000
        if hours_until_est <= ACTIVE_WINDOW_BEFORE_HOURS:
            return True
        return int(time.time() // 3600) % SPARSE_HOURS == 0

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
