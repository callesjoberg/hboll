#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delad .ics-byggare för ProCup-cuper — samma kalenderformat som
js/ics.js ger vid en manuell export, men skriven som STATISKA filer under
data/ics/<cupid>/<teamId>.ics av skrapskripten, så de får en stabil URL
en kalenderapp kan prenumerera på (auto-uppdateras i takt med att skrapan
kör om).

Cup Manager-cuper (inkl. Partille) har redan en riktig live-tjänst
(GetTeamCalendarService) och rörs inte här. ProCup.se saknar
kalenderexport helt, därför behövs de här filerna — för ALLA lag, inte
bara en klubb: appen delas av vilken klubb som helst."""

import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Stockholm")

# Klubbfilter (Alingsås HK / HB.CLUB.pattern) togs bort. Appen delas av
# alla klubbar nu, så en Sävehof-förälder i Järnvägen Cup ska också få en
# prenumerationsfil. Partille-argumentet (att ~1400 lag skulle ge lika
# många småfiler i repot) gäller inte längre — Partille hämtar kalendern
# från Cup Manager sedan den fick calendarHost, och de här filerna byggs
# bara för ProCup-cuper (~325 lag, hanterbart).


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


def write_if_changed(path, text):
    """Skriv text till path bara om innehållet faktiskt skiljer sig.
    Samma idé som write_if_changed i archive_results.py — CI committar
    på git diff, så en omskrivning av identiskt innehåll skulle bli en
    tom-men-ändrad fil varje 20:e minut. Ingen DTSTAMP i .ics just
    därför: en tidsstämpel per körning skulle göra allt 'ändrat'."""
    # Bytejämförelse: Path.read_text() översätter CRLF → LF och skulle
    # annars se varje .ics som ändrad (filerna skrivs med \r\n per RFC 5545).
    data = text.encode("utf-8")
    if path.exists():
        try:
            if path.read_bytes() == data:
                return False
        except Exception:
            pass
    path.write_bytes(data)
    return True


def teams_with_kickoff(matches):
    """Lag-id:n + namn ({teamId: name}) för lag som har minst en match
    med speltid. Lag utan tider ger en tom kalender och hoppas över."""
    teams = {}
    for m in matches:
        if not m.get("start"):
            continue
        for side in ("home", "away"):
            t = m.get(side) or {}
            if t.get("id") is not None and t.get("name"):
                teams[t["id"]] = t["name"]
    return teams


def write_team_ics_files(out_dir, cup_id, cup_name, cup_place, matches):
    """Skriver en .ics per lag (med minst en tidsatt match) till
    out_dir/<cupId>/<teamId>.ics. Skriver bara om innehållet ändrats
    och tar bort .ics i cupens katalog som inte hör hit den här
    körningen (ny upplaga får annars gamla lagfiler kvar för alltid).
    Returnerar antal filer som finns kvar efteråt."""
    teams = teams_with_kickoff(matches)
    # ProCup använder lagnamnet som id, med inkonsekvent kolon/versaler
    # ("Backa HK:Röd" vs "Backa HK Röd"). De slår till samma filnamn —
    # slå ihop matcherna så kalendern inte saknar halva schemat.
    ids_by_slug = {}
    for team_id in teams:
        ids_by_slug.setdefault(slugify_team_id(team_id), []).append(team_id)

    cup_dir = out_dir / cup_id
    wanted = {}
    written = 0
    if ids_by_slug:
        cup_dir.mkdir(parents=True, exist_ok=True)
        for slug, ids in ids_by_slug.items():
            idset = set(ids)
            team_matches = [
                m for m in matches
                if m.get("start") and (
                    (m.get("home") or {}).get("id") in idset
                    or (m.get("away") or {}).get("id") in idset)
            ]
            fname = f"{slug}.ics"
            ics = build_team_ics(cup_name, cup_place, cup_id, team_matches, ids[0])
            path = cup_dir / fname
            wanted[fname] = path
            if write_if_changed(path, ics):
                written += 1

    removed = 0
    if cup_dir.is_dir():
        for existing in cup_dir.glob("*.ics"):
            if existing.name not in wanted:
                existing.unlink()
                removed += 1

    n_files = len(wanted)
    total_bytes = sum(p.stat().st_size for p in wanted.values()) if wanted else 0
    print(f"ics {cup_id}: {n_files} filer, {total_bytes} byte "
          f"({written} skrivna, {removed} borttagna)")
    return n_files


def main():
    """Bygger om .ics från redan hämtade ProCup-JSON-filer (ingen nätverk)."""
    root = Path(__file__).resolve().parent.parent
    cups = json.loads((root / "data" / "cups.json").read_text(encoding="utf-8"))["cups"]
    out_dir = root / "data" / "ics"
    total_files = 0
    total_bytes = 0
    for cup in cups:
        if cup.get("host") != "procup.se" or not cup.get("dataUrl"):
            continue
        path = root / cup["dataUrl"]
        if not path.exists():
            print(f"{cup['id']}: saknar {path.name} — hoppar över")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        n = write_team_ics_files(
            out_dir, cup["id"], cup.get("name", cup["id"]),
            cup.get("place", ""), data.get("matches") or [])
        cup_dir = out_dir / cup["id"]
        if n and cup_dir.is_dir():
            total_bytes += sum(p.stat().st_size for p in cup_dir.glob("*.ics"))
        total_files += n
    print(f"ics totalt: {total_files} filer, {total_bytes} byte")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
