#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Skrapar en ProCup-turnering (procup.se) till samma matchformat som
Cup Manager-cuperna i sajten. Ren stdlib — inga beroenden.

Körs av GitHub Actions på schema (och manuellt):
    python3 scripts/fetch_procup.py

ProCup saknar både JSON-API och CORS, därför förhämtas datan hit.
Struktur: klasslista → per klass: gruppsidor (tabell + matcher) och
slutspelssidor (matcher)."""

import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://procup.se/cup/"

# Turneringar att hämta: (ev-id, utfil, cup-id i js/config.js)
TOURNAMENTS = [
    (39543, "jarnvagen-2026.json", "jarnvagen"),
]


def get(url, retries=3):
    req = urllib.request.Request(url, headers={"user-agent": "hboll-bot/1.0"})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            last = e
            time.sleep(1 + 2 * i)
    raise last


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def cells_of(row):
    return [c for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]


def tables_of(page):
    return re.findall(r"<table.*?</table>", page, flags=re.S)


def rows_of(table):
    return re.findall(r"<tr.*?</tr>", table, flags=re.S)


def wall_ms(date_iso, hhmm):
    """'2026-05-30' + '07:30' → svensk väggtid kodad som UTC-epoch-ms
    (samma kodning som Cup Manager använder)."""
    t = time.strptime(date_iso + " " + hhmm, "%Y-%m-%d %H:%M")
    import calendar
    return calendar.timegm(t) * 1000


def split_teams(teams_c):
    # Hemma/borta ligger i varsin div runt ett "-"-spann.
    sides = [strip_tags(d) for d in
             re.findall(r'<div style="text-align[^"]*"[^>]*>(.*?)</div>',
                        teams_c, flags=re.S)]
    if len(sides) >= 2:
        return sides[0], sides[1]
    parts = strip_tags(teams_c).split(" - ")
    if len(parts) == 2:
        return parts[0], parts[1]
    return None


def parse_day_row(row, day, seen_ids):
    """Rad på dagsidan: Mnr|Klass|Grupp|Datum|Tid|Lag|Bana|Resultat."""
    cells = cells_of(row)
    if len(cells) < 8:
        return None
    mnr_c, cat_c, grp_c, _date_c, time_c, teams_c, arena_c, res_c = cells[:8]
    mnr = strip_tags(mnr_c)
    if not re.match(r"^\d+$", mnr):
        return None
    hhmm = strip_tags(time_c)
    if not re.match(r"^\d{1,2}:\d{2}$", hhmm):
        return None
    sides = split_teams(teams_c)
    if not sides:
        return None
    home, away = sides
    cat = strip_tags(cat_c)
    div_name = strip_tags(grp_c)
    res_text = strip_tags(res_c)
    rm = re.match(r"^(\d+)\s*-\s*(\d+)", res_text)
    res = None
    if rm:
        hg, ag = int(rm.group(1)), int(rm.group(2))
        res = {"fin": True, "live": False, "hg": hg, "ag": ag,
               "hsw": 0, "asw": 0, "winByPeriods": False, "per": [],
               "wo": False,
               "winner": "home" if hg > ag else ("away" if ag > hg else None),
               "hidden": False}
    mid = int(mnr)
    if mid in seen_ids:
        return None
    seen_ids.add(mid)
    return {
        "id": mid,
        "start": wall_ms(day, hhmm),
        "arena": strip_tags(arena_c),
        "divId": f"{cat}|{div_name}",
        "divName": div_name,
        "catId": cat,
        "catName": cat,
        "roundName": "",
        "home": {"id": home, "name": home.replace(":", " ")},
        "away": {"id": away, "name": away.replace(":", " ")},
        "res": res,
    }


def parse_standings(table):
    out = []
    for row in rows_of(table):
        cells = [strip_tags(c) for c in cells_of(row)]
        # Lag | Ant sp | V | O | F | Mål | Diff | Bollar | Poäng
        if len(cells) < 9 or not re.match(r"^\d+$", cells[1] or "x"):
            continue
        gm = re.match(r"^(\d+)\s*-\s*(\d+)$", cells[5] or "")
        out.append({
            "name": cells[0].replace(":", " "),
            "teamId": cells[0],
            "played": int(cells[1]), "won": int(cells[2]),
            "tied": int(cells[3]), "lost": int(cells[4]),
            "gf": int(gm.group(1)) if gm else 0,
            "ga": int(gm.group(2)) if gm else 0,
            "points": int(cells[8]) if re.match(r"^\d+$", cells[8]) else 0,
        })
    return out


def scrape(ev):
    q = f"ev={ev}&lang=SVE"
    classes_page = get(f"{BASE}cupclass_info_skin04.php?{q}")
    classes = sorted(set(
        urllib.parse.unquote(c) for c in
        re.findall(r"cupresclassgroup_skin04\.php\?[^\"]*Klass=([^\"&]+)",
                   classes_page)))
    print(f"ev {ev}: {len(classes)} klasser: {classes}")

    # Matcher: dagsidorna listar hela cupens matcher, även klasser utan
    # resultat/tabeller. Speldagarna hittas via DAG=-länkar; följ nya datum
    # tills inga fler dyker upp.
    matches, seen = [], set()
    # Startdatum finns på resultatsidan utan DAG-parameter (dagväljaren).
    day_index = get(f"{BASE}cupresgeneric_skin04.php?{q}")
    days_todo = set(re.findall(r"DAG=(\d{4}-\d{2}-\d{2})", day_index) +
                    re.findall(r"DAG=(\d{4}-\d{2}-\d{2})", classes_page))
    days_done = set()
    while days_todo:
        day = sorted(days_todo)[0]
        days_todo.discard(day)
        days_done.add(day)
        page = get(f"{BASE}cupresgeneric_skin04.php?{q}&DAG={day}")
        days_todo |= set(re.findall(r"DAG=(\d{4}-\d{2}-\d{2})", page)) - days_done
        n0 = len(matches)
        for t in tables_of(page):
            for row in rows_of(t):
                mm = parse_day_row(row, day, seen)
                if mm:
                    matches.append(mm)
        print(f"  {day}: +{len(matches) - n0} matcher")

    # Tabeller: en gruppsida per grupp (klasser utan resultat saknar tabeller).
    tables = {}
    for cat in classes:
        cq = f"{q}&Klass={urllib.parse.quote(cat)}"
        group_page = get(f"{BASE}cupresclassgroup_skin04.php?{cq}")
        grps = sorted(set(re.findall(r"cupresclass_skin04\.php\?[^\"]*Grp=(\d+)",
                                     group_page)), key=int)
        for g in grps:
            page = get(f"{BASE}cupresclass_skin04.php?{cq}&Grp={g}")
            tbls = tables_of(page)
            if tbls:
                rows = parse_standings(tbls[0])
                if rows:
                    tables[f"{cat}|Grupp {g}"] = rows

    matches.sort(key=lambda m: (m["start"], m["arena"]))
    return {"ts": int(time.time() * 1000), "matches": matches, "tables": tables}


def main():
    out_dir = Path(__file__).resolve().parent.parent / "data"
    out_dir.mkdir(exist_ok=True)
    for ev, fname, _cup_id in TOURNAMENTS:
        data = scrape(ev)
        path = out_dir / fname
        # Skriv bara om innehållet (utom tidsstämpeln) ändrats, så att
        # CI-jobbet kan committa på "git diff" rakt av.
        if path.exists():
            try:
                old = json.loads(path.read_text(encoding="utf-8"))
                if (old.get("matches") == data["matches"] and
                        old.get("tables") == data["tables"]):
                    print(f"{path}: oförändrad — skriver inte om")
                    continue
            except Exception:
                pass
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"skrev {path} ({len(data['matches'])} matcher, "
              f"{len(data['tables'])} tabeller)")


if __name__ == "__main__":
    sys.exit(main())
