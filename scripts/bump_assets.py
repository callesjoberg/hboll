#!/usr/bin/env python3
"""Sätt en gemensam versionsnyckel på allt appskal som webbläsaren cachar.

Bakgrund: GitHub Pages skickar `cache-control: max-age=600` på statiska
filer. `?v=`-nyckeln på style.css och app.js ger nya URL:er vid varje
driftsättning, men ES-modulernas *statiska importer* (`./ui/nav.js`) får
ingen nyckel — de träffar HTTP-cachen och kan bli upp till tio minuter
gamla. Resultatet är en blandning av ny och gammal kod tills cachen går
ut, och det är därför man måste ladda om hårt efter en driftsättning.

Utan byggsteg finns bara ett sätt att ge importerna nya URL:er: en
importmap i index.html som pekar varje modul-URL till samma URL med
`?v=`. Webbläsaren slår upp varje importspecificerare i kartan *efter*
att den lösts till en URL, så kartan slår igenom i hela importträdet —
även för moduler som importerar varandra.

Skriptet skriver:
  * index.html — `?v=` på css, klassiska skript och app.js, plus den
    genererade importmap-blocken mellan markörerna
  * sw.js      — CACHE_NAME, så skalcachen töms i samma veva
  * js/config.js — HB.CUPS, reservlistan som används när data/cups.json
    inte går att läsa. Den underhölls för hand och hade drivit iväg till
    8 cuper medan den skarpa listan hade 34: en läsare som råkade ut för
    ett trasigt cups.json fick se en app där 26 cuper såg utraderade ut.
    Genereras nu ur cups.json vid varje bump.
  * js/config.js — HB.VERSION, numret som står i Inställningar. Sattes
    förr för hand och glömdes: det stod kvar på 2026-08-21b medan
    tillgångarna var på 20260906w, alltså två veckor fel för den som
    läste av det för att rapportera ett fel.

Kör utan argument (`python3 scripts/bump_assets.py`) för nästa nyckel
efter dagens datum, eller ange en egen: `... bump_assets.py 20260905c`.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
INDEX = ROT / "index.html"
SW = ROT / "sw.js"
CONFIG = ROT / "js" / "config.js"
CUPS = ROT / "data" / "cups.json"
JS = ROT / "js"

# admin.js hör till admin.html och laddas inte av appen.
UNDANTAG = {"js/admin.js"}

MARK_START = "  <!-- importmap: genererad av scripts/bump_assets.py — redigera inte för hand -->"
MARK_SLUT = "  <!-- /importmap -->"


def är_modul(fil: Path) -> bool:
    text = fil.read_text(encoding="utf-8")
    return re.search(r"^\s*(import|export)\b", text, re.M) is not None


def js_filer() -> tuple[list[str], list[str]]:
    """Returnerar (moduler, klassiska) som repo-relativa sökvägar."""
    moduler, klassiska = [], []
    for fil in sorted(JS.rglob("*.js")):
        rel = fil.relative_to(ROT).as_posix()
        if rel in UNDANTAG:
            continue
        (moduler if är_modul(fil) else klassiska).append(rel)
    return moduler, klassiska


def nuvarande_nyckel(html: str) -> str | None:
    m = re.search(r'href="css/style\.css\?v=([^"]+)"', html)
    return m.group(1) if m else None


def nästa_nyckel(html: str) -> str:
    """Dagens datum plus a, b, c … z, aa, ab … — som kolumnerna i ett kalkylblad.

    Den gamla varianten la bara på ett "a" när den kom förbi z, så en dag
    med många driftsättningar gav 20260906zaaa. Nyckeln syns numera som
    versionsnumret i Inställningar (HB.VERSION), och då ska den gå att
    läsa upp i telefon utan att låta trasig.
    """
    idag = date.today().strftime("%Y%m%d")
    nu = nuvarande_nyckel(html) or ""
    if not (nu.startswith(idag) and len(nu) > len(idag)):
        return idag + "a"
    svans = nu[len(idag):]
    if not svans.isalpha() or not svans.islower():
        return idag + "a"
    # bas-26 med a=0, fast utan nolla: samma räkning som kalkylbladskolumner
    tal = 0
    for c in svans:
        tal = tal * 26 + (ord(c) - ord("a") + 1)
    tal += 1
    ut = ""
    while tal:
        tal, rest = divmod(tal - 1, 26)
        ut = chr(ord("a") + rest) + ut
    return idag + ut


def importmap(moduler: list[str], nyckel: str) -> str:
    poster = {f"./{m}": f"./{m}?v={nyckel}" for m in moduler}
    kropp = json.dumps({"imports": poster}, ensure_ascii=False, indent=2)
    kropp = "\n".join("  " + rad for rad in kropp.splitlines())
    return f'{MARK_START}\n  <script type="importmap">\n{kropp}\n  </script>\n{MARK_SLUT}'


def skriv_index(nyckel: str, moduler: list[str], klassiska: list[str]) -> None:
    html = INDEX.read_text(encoding="utf-8")

    html = re.sub(
        r'(href="css/style\.css)(\?v=[^"]*)?(")',
        lambda m: f"{m.group(1)}?v={nyckel}{m.group(3)}",
        html,
    )
    for rel in klassiska + moduler:
        html = re.sub(
            r'(src="' + re.escape(rel) + r')(\?v=[^"]*)?(")',
            lambda m: f"{m.group(1)}?v={nyckel}{m.group(3)}",
            html,
        )

    block = importmap(moduler, nyckel)
    if MARK_START in html:
        html = re.sub(
            re.escape(MARK_START) + r".*?" + re.escape(MARK_SLUT),
            lambda _: block,
            html,
            flags=re.S,
        )
    else:
        # Importmappen måste ligga före det första modul-skriptet.
        ankare = '  <script type="module" src="js/app.js'
        i = html.index(ankare)
        html = html[:i] + block + "\n" + html[i:]

    INDEX.write_text(html, encoding="utf-8")


def skriv_sw(nyckel: str, alla: list[str]) -> None:
    js = SW.read_text(encoding="utf-8")
    js = re.sub(
        r'const CACHE_NAME = "[^"]*";',
        f'const CACHE_NAME = "hboll-shell-{nyckel}";',
        js,
    )
    SW.write_text(js, encoding="utf-8")

    saknas = [f for f in alla if f'"./{f}"' not in js]
    if saknas:
        print("Varning: saknas i sw.js SHELL_FILES: " + ", ".join(saknas))


def cuplista() -> str | None:
    """HB.CUPS-blocket, genererat ur data/cups.json."""
    if not CUPS.exists():
        return None
    cups = json.loads(CUPS.read_text(encoding="utf-8")).get("cups")
    if not isinstance(cups, list) or not cups:
        return None
    rader = ",\n".join("  " + json.dumps(c, ensure_ascii=False, sort_keys=True)
                       for c in cups)
    return ("// GENERERAD ur data/cups.json av scripts/bump_assets.py — redigera\n"
            "// inte för hand. Används bara som reserv när cups.json inte går att\n"
            "// läsa; den skarpa listan hämtas alltid därifrån (se loadCup i app.js).\n"
            f"HB.CUPS = [\n{rader},\n];")


def skriv_config(nyckel: str) -> None:
    js = CONFIG.read_text(encoding="utf-8")
    ny = re.sub(r'HB\.VERSION = "[^"]*";', f'HB.VERSION = "{nyckel}";', js)
    if ny == js:
        print("Varning: HB.VERSION hittades inte i js/config.js")

    block = cuplista()
    if block:
        # Ersätt allt från kommentaren/HB.CUPS fram till och med arrayens
        # avslutande "];" — regexen är avsiktligt snål med punkter så den
        # inte kan äta upp resten av filen om blocket saknas.
        ersatt, antal = re.subn(
            r"(?:^// GENERERAD ur data/cups\.json[^\n]*\n(?:^//[^\n]*\n)*)?"
            r"^HB\.CUPS = \[.*?^\];",
            block.replace("\\", "\\\\"), ny, count=1, flags=re.S | re.M)
        if antal:
            ny = ersatt
        else:
            print("Varning: HB.CUPS-blocket hittades inte i js/config.js")

    CONFIG.write_text(ny, encoding="utf-8")


def main() -> int:
    html = INDEX.read_text(encoding="utf-8")
    nyckel = sys.argv[1] if len(sys.argv) > 1 else nästa_nyckel(html)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", nyckel):
        print("Ogiltig versionsnyckel: " + nyckel)
        return 1

    moduler, klassiska = js_filer()
    skriv_index(nyckel, moduler, klassiska)
    skriv_sw(nyckel, moduler + klassiska)
    skriv_config(nyckel)
    print(f"Versionsnyckel {nyckel} · {len(moduler)} moduler, {len(klassiska)} klassiska skript")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
