#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad .ics-byggare för dataUrl-cuper (ProCup/Gothia) — samma
kalenderformat som js/ics.js ger vid en manuell export, men skriven som
STATISKA filer under data/ics/<cupid>/<teamId>.ics av skrapskripten, så de
får en stabil URL en kalenderapp kan prenumerera på (auto-uppdateras i takt
med att skrapan kör om — Cup Manager-cuper har redan en riktig live-tjänst
för det här inbyggd, se GetTeamCalendarService i teamStatBlock i app.js,
den här filen behövs bara för cuper utan en sådan)."""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Stockholm")

# Samma klubbmönster som HB.CLUB.pattern i js/config.js — bygger bara
# kalendrar för klubbens egna lag (annars skulle t.ex. Partilles ~1400 lag
# ge lika många småfiler i repot).
CLUB_PATTERN = re.compile(r"^alings[åa]s\s*hk", re.I)


def _wall_stamp(ms):
    # m.start är en äkta UTC-epok (samma konvention överallt i hboll) —
    # måste omvandlas till svensk lokaltid innan den skrivs ut, annars blir
    # DTSTART fel med 1-2 timmar trots TZID=Europe/Stockholm-taggen.
    return datetime.fromtimestamp(ms / 1000, tz=TZ).strftime("%Y%m%dT%H%M%S")


def slugify_team_id(team_id):
    """Filnamnssäker version av ett lag-id — de flesta cuper har rena
    numeriska id:n (funkar redan direkt), men ProCup-cuper använder
    lagnamnet SOM id (t.ex. "Alingsås HK:Blå") vilket innehåller tecken
    (kolon, å/ä/ö) som är opraktiska i filnamn/URL:er."""
    s = str(team_id)
    s = s.replace("å", "a").replace("ä", "a").replace("ö", "o")
    s = s.replace("Å", "A").replace("Ä", "A").replace("Ö", "O")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "lag"


def _esc(s):
    return (str(s or "")
            .replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\n", "\\n"))


def build_team_ics(cup_name, cup_place, host_or_id, matches, team_id, minutes=30):
    """matches: den vanliga normaliserade listan ({id,start,arena,home,away,
    catName,divName,res}), redan filtrerad till EN lags matcher."""
    dur_ms = minutes * 60000
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//hboll//cupschema//SV",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:" + _esc(cup_name),
    ]
    for m in sorted(matches, key=lambda m: m["start"]):
        klass = m.get("catName") or ""
        grp = (" " + m["divName"]) if m.get("divName") else ""
        lines += [
            "BEGIN:VEVENT",
            f"UID:match-{m['id']}@{host_or_id}.hboll",
            "DTSTART;TZID=Europe/Stockholm:" + _wall_stamp(m["start"]),
            "DTEND;TZID=Europe/Stockholm:" + _wall_stamp(m["start"] + dur_ms),
            "SUMMARY:" + _esc(f"{m['home']['name']} – {m['away']['name']} ({klass}{grp})"),
            "LOCATION:" + _esc((m["arena"] + ", " if m.get("arena") else "") + cup_place),
            "DESCRIPTION:" + _esc(f"{cup_name} · {klass}" + (f" · {m['divName']}" if m.get("divName") else "")),
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def club_teams(matches):
    """Klubbens egna lag-id:n + namn ({teamId: name}) ur en matchlista."""
    teams = {}
    for m in matches:
        for side in ("home", "away"):
            t = m.get(side) or {}
            if t.get("id") is not None and t.get("name") and CLUB_PATTERN.match(t["name"]):
                teams[t["id"]] = t["name"]
    return teams


def write_team_ics_files(out_dir, cup_id, cup_name, cup_place, matches):
    """Skriver en .ics per klubblag till out_dir/<cupId>/<teamId>.ics.
    Returnerar antal skrivna filer (för loggning)."""
    teams = club_teams(matches)
    if not teams:
        return 0
    cup_dir = out_dir / cup_id
    cup_dir.mkdir(parents=True, exist_ok=True)
    for team_id, _name in teams.items():
        team_matches = [m for m in matches
                         if (m["home"].get("id") == team_id or m["away"].get("id") == team_id)]
        ics = build_team_ics(cup_name, cup_place, cup_id, team_matches, team_id)
        (cup_dir / f"{slugify_team_id(team_id)}.ics").write_text(ics, encoding="utf-8")
    return len(teams)
