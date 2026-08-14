#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad "hur ofta är det värt att skrapa den här cupen just nu"-logik för
GitHub Actions-skrapskripten (fetch_procup.py/fetch_gothia.py/
fetch_cupmanager.py) — samma "avslutad cup ändras aldrig"-princip som
refreshTtl() i js/app.js styr webbläsarens live-cache med, men här
bestämmer den om det är värt att göra nätverksanropen mot källsajten
överhuvudtaget den här körningen.

Workflow-jobbet kör var 20:e minut för
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
går det inte att bedöma något fönster ur datan. Då gäller i tur och ordning:

  förra årets datum finns i
  arkivindexet:                    behandla det som cupens fönster (samma
                                    heuristik som Kalender-flikens
                                    preliminära staplar, se
                                    renderKalenderView i js/app.js)
  ingen historik heller, men datan
  ändrades senaste 48h:            varje körning — något är på väg
                                    (lottningen läggs ut, lag registreras)
  ingen historik, inget har hänt:  en gång om dygnet

Uppskattningen får BARA skjuta upp skrapning av en cup som ligger tryggt
långt fram — så fort det uppskattade fönstret är inom räckhåll skrapas den
varje körning igen. En cup som flyttat sig sedan förra året kan alltså
aldrig tystas ner av en gissning som visar sig fel. Och en helt okänd cup
kan inte fastna i dygnskadensen: nästa gång datan rör sig trappas den upp
av sig själv.

Alla glesa kadenser är timupplösta, se _slot().
"""

import datetime
import json
import pathlib
import time
import zlib

ACTIVE_WINDOW_BEFORE_HOURS = 72  # täta kontroller redan såhär nära starten
ACTIVE_WINDOW_AFTER_HOURS = 24   # ...och såhär länge efter sista matchen
CHECKPOINTS_HOURS = (72, 240)    # ~3 / ~10 dygn efter sista matchen — sena rättelser
WINDOW_HOURS = 3                 # tolerans runt varje kontrollpunkt
SPARSE_HOURS = 6                 # "vila"-kadens för cuper långt fram i tiden
DORMANT_HOURS = 24               # ...och för en cup vi inte vet NÅGOT om (se should_refresh)
STIRRING_HOURS = 48              # men ändrades datan såhär nyligen: följ den tätt igen

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


def _slot(period_hours, cup_id):
    """Sann under EN timme av varje period_hours — den glesa kadensen.

    Timupplöst med flit: workflowet kör var 20:e minut, så en träff blir tre
    körningar i rad. Det är avsiktlig redundans — schemalagda Actions-jobb
    kan försenas flera minuter under last, och en finkornigare slot skulle
    kunna missas helt. Hellre tre anrop än noll.

    Vilken timme som träffas varierar per cup (crc32 på id:t) så att alla
    vilande cuper inte råkar vakna i samma körning."""
    offset = (zlib.crc32(cup_id.encode("utf-8")) % period_hours) if cup_id else 0
    return int(time.time() // 3600) % period_hours == offset


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
        if est_first_ms is not None:
            hours_until_est = (est_first_ms - time.time() * 1000) / 3600000
            if hours_until_est <= ACTIVE_WINDOW_BEFORE_HOURS:
                return True
            return _slot(SPARSE_HOURS, cup_id)
        # Varken schema eller arkiverad historik att gissa ur — vi vet
        # ingenting om när cupen spelas. Datans egen "senast ändrad"-stämpel
        # är då enda signalen: ts skrivs bara om när innehållet FAKTISKT
        # ändrats (se write_if_changed i skraporna), så en färsk stämpel
        # betyder att något håller på att hända — lottningen läggs ut, lag
        # registreras — och då är det värt att följa tätt. Har inget rört
        # sig på länge räcker en kontroll om dygnet: den fångar upp starten
        # på nästa förändring, som i sin tur trappar upp kadensen igen.
        ts = (existing_data or {}).get("ts")
        if not ts:
            return True  # aldrig hämtad — försök alltid
        if (time.time() * 1000 - ts) / 3600000 <= STIRRING_HOURS:
            return True
        return _slot(DORMANT_HOURS, cup_id)

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
