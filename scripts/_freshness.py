#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad "sluta skrapa avslutade cuper i onödan"-logik för GitHub Actions-
skrapskripten (fetch_procup.py/fetch_gothia.py/fetch_cupmanager.py) — samma
"avslutad cup ändras aldrig"-princip som refreshTtl() i js/app.js styr
webbläsarens live-cache med, fast här bestämmer den om det överhuvudtaget
är värt att göra nätverksanropen mot källsajten var 6:e timme för alltid.

En helt avslutad cup uppdateras normalt aldrig igen (organisatören rättar
sällan resultat i efterhand) — men "sällan" är inte "aldrig", så i stället
för att sluta helt direkt glesas kontrollerna ut i några få uppföljnings-
fönster (timmar efter SISTA matchens starttid) innan skrapningen tystnar
för gott:
  < 24h:  skrapa alltid (cupen pågår fortfarande/är nyss avslutad)
  ~3 dygn: en sista kontroll, fångar upp sena resultaträttningar
  ~10 dygn: ytterligare en, sen är det tyst
Fönstren har en toleransmarginal (± halva cron-intervallet, 6h/2=3h) så att
ett schemalagt var-6:e-timme-jobb garanterat träffar varje kontrollpunkt
exakt en gång, oavsett var i cykeln cupen råkade sluta."""

import time

CHECKPOINTS_HOURS = (10, 72, 240)  # ~10h, 3 dygn, 10 dygn efter sista matchen
WINDOW_HOURS = 3                   # halva cron-intervallet (var 6:e timme)
ALWAYS_WITHIN_HOURS = 24           # pågående/framtida/nyss avslutad — skrapa alltid


def _last_match_ms(data):
    """Senaste matchens starttid (ms epoch) ur en redan hämtad datafil,
    eller None om filen saknas/är tom (→ okänt, skrapa för säkerhets skull)."""
    matches = (data or {}).get("matches") or []
    if not matches:
        return None
    return max(m.get("start") or 0 for m in matches) or None


def should_refresh(existing_data):
    """True om det är värt att skrapa om: ingen tidigare data alls, cupen
    pågår/är framtida (senaste matchen inte hänt än), nyss avslutad
    (< 24h), eller råkar landa i ett av uppföljningsfönstren därefter."""
    last_ms = _last_match_ms(existing_data)
    if last_ms is None:
        return True
    hours_since = (time.time() * 1000 - last_ms) / 3600000
    if hours_since < ALWAYS_WITHIN_HOURS:
        return True
    return any(abs(hours_since - cp) <= WINDOW_HOURS for cp in CHECKPOINTS_HOURS)
