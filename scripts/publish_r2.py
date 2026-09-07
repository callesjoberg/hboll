#!/usr/bin/env python3
"""Publicera data/ till R2 — bara det som faktiskt ändrats.

Bakgrunden: loopen pushar var femte minut under matchtid och GitHub Pages
bygger om hela sajten vid varje push. Det är över deras mjuka gräns på 10
byggen/timme, och Cloudflare Pages hårda gräns på 500/månad skulle spränga.
Ungefär åtta av 1294 filer ändras per varv. Ligger datan i R2 i stället är
en uppdatering en objektskrivning: inget bygge, ingen deploy, och takten
kan gå tätare än fem minuter.

Urvalet görs på INNEHÅLL, inte tidsstämpel. En CI-körning checkar ut repot
på nytt varje gång, så alla filer ser nyskrivna ut för ett mtime-baserat
verktyg (aws s3 sync) — det hade laddat upp 300 MB vid varje jobbstart.
Här jämförs i stället filens MD5 mot objektets ETag i R2, vilket ger exakt
de filer som skiljer sig.

Cache-Control sätts per objekt, för Cloudflare cachar inte JSON som
standard på en custom domain. Frysta arkivupplagor får ett dygn; allt
annat en minut, så liveresultat hinner ut.

Miljö:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   (obligatoriska)
  R2_BUCKET                                (default cupschema-data)

  python3 scripts/publish_r2.py --dry-run          visa vad som skulle ske
  python3 scripts/publish_r2.py --only data/cups.json   bara en fil
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import time
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
DATA = ROT / "data"
CUPS = DATA / "cups.json"

KORT_CACHE = "public, max-age=60"
LANG_CACHE = "public, max-age=86400, immutable"

TYPER = {".json": "application/json", ".ics": "text/calendar; charset=utf-8"}


def frysta_arkivfiler() -> set[str]:
    """Arkivupplagor som INTE är den aktuella för sin cup.

    archive_results.py skriver om den aktuella upplagans fil vid varje
    körning och fryser den först den dag cups.json pekas om till nästa år.
    Bara de frysta får lång cache — den aktuella måste kunna ändras.
    """
    if not CUPS.exists():
        return set()
    try:
        cups = json.loads(CUPS.read_text(encoding="utf-8")).get("cups") or []
    except (json.JSONDecodeError, OSError):
        return set()
    aktuella = {f"{c.get('id')}-{c.get('edition')}.json" for c in cups}
    frysta = set()
    for f in (DATA / "archive").glob("*.json"):
        if f.name in ("index.json", "team-index.json"):
            continue          # byggs om varje varv
        if f.name not in aktuella:
            frysta.add(f.name)
    return frysta


def cache_for(rel: str, frysta: set[str]) -> str:
    if rel.startswith("data/archive/") and Path(rel).name in frysta:
        return LANG_CACHE
    return KORT_CACHE


def md5(fil: Path) -> str:
    h = hashlib.md5()
    with fil.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def lokala_filer(bara: list[str]) -> list[Path]:
    if bara:
        return [ROT / b for b in bara if (ROT / b).is_file()]
    return sorted(p for p in DATA.rglob("*") if p.is_file())


def fjärr_etags(s3, bucket: str) -> dict[str, str]:
    """key -> etag utan citattecken. En LIST per 1000 objekt (Class A)."""
    ut: dict[str, str] = {}
    token = None
    while True:
        kw = {"Bucket": bucket, "Prefix": "data/"}
        if token:
            kw["ContinuationToken"] = token
        svar = s3.list_objects_v2(**kw)
        for o in svar.get("Contents", []):
            ut[o["Key"]] = o["ETag"].strip('"')
        if not svar.get("IsTruncated"):
            return ut
        token = svar.get("NextContinuationToken")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="räkna ut vad som skulle laddas upp, rör inte R2")
    ap.add_argument("--only", action="append", default=[],
                    help="begränsa till angivna filer (repo-relativa)")
    ap.add_argument("--stamp", action="store_true",
                    help="skriv data/r2-stamp.json med tidpunkt och körning")
    args = ap.parse_args()

    frysta = frysta_arkivfiler()
    filer = lokala_filer(args.only)
    if not filer:
        print("Inga filer att publicera.")
        return 0

    lokalt = {}
    for f in filer:
        rel = f.relative_to(ROT).as_posix()
        lokalt[rel] = (f, md5(f), cache_for(rel, frysta))

    if args.dry_run:
        kort = [v for v in lokalt.values() if v[2] == KORT_CACHE]
        lang = [v for v in lokalt.values() if v[2] != KORT_CACHE]
        mb = lambda vs: sum(v[0].stat().st_size for v in vs) / 1048576
        print(f"{len(lokalt)} filer, {mb(lokalt.values()):.1f} MB")
        print(f"  kort cache (60 s):    {len(kort):4} filer  {mb(kort):7.1f} MB")
        print(f"  lång cache (frysta):  {len(lang):4} filer  {mb(lang):7.1f} MB")
        for rel, (f, summa, cc) in list(sorted(lokalt.items()))[:5]:
            print(f"  {rel}  md5={summa[:8]}…  {cc}")
        print("  … (dry-run: ingen kontakt med R2)")
        return 0

    konto = os.environ.get("R2_ACCOUNT_ID")
    nyckel = os.environ.get("R2_ACCESS_KEY_ID")
    hemlis = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket = os.environ.get("R2_BUCKET", "cupschema-data")
    if not (konto and nyckel and hemlis):
        print("Saknar R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.")
        return 1

    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        print("boto3 saknas — kör: pip install boto3")
        return 1

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{konto}.r2.cloudflarestorage.com",
        aws_access_key_id=nyckel,
        aws_secret_access_key=hemlis,
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )

    def stämpla(uppladdade: int) -> None:
        """Färskhetsmärke som BARA finns i R2, aldrig på disk eller i git.

        Två syften. Det bevisar att skrivvägen fungerar vid varje varv —
        cupdata ändras inte mellan speldagar, så annars vore uppladdningen
        oprövad i dagar. Och det gör bucketens ålder mätbar utifrån:
        curl https://data.cupschema.se/data/r2-stamp.json
        """
        if not args.stamp:
            return
        märke = json.dumps({
            "ts": int(time.time() * 1000),
            "run": os.environ.get("GITHUB_RUN_ID") or "lokal",
            "sha": (os.environ.get("GITHUB_SHA") or "")[:7],
            "uppladdade": uppladdade,
        }, ensure_ascii=False).encode()
        s3.put_object(Bucket=bucket, Key="data/r2-stamp.json", Body=märke,
                      ContentType="application/json",
                      CacheControl="public, max-age=30")

    fjärr = fjärr_etags(s3, bucket)
    att_göra = [(rel, *v) for rel, v in sorted(lokalt.items())
                if fjärr.get(rel) != v[1]]

    if not att_göra:
        stämpla(0)
        print(f"R2: allt är redan i fas ({len(lokalt)} filer kontrollerade).")
        return 0

    byte = 0
    for rel, f, summa, cc in att_göra:
        typ = TYPER.get(f.suffix) or mimetypes.guess_type(rel)[0] \
            or "application/octet-stream"
        with f.open("rb") as fp:
            s3.put_object(Bucket=bucket, Key=rel, Body=fp,
                          ContentType=typ, CacheControl=cc)
        byte += f.stat().st_size

    stämpla(len(att_göra))
    print(f"R2: {len(att_göra)} av {len(lokalt)} filer uppladdade "
          f"({byte / 1048576:.1f} MB).")
    for rel, _f, _s, cc in att_göra[:10]:
        print(f"  {rel}  [{cc}]")
    if len(att_göra) > 10:
        print(f"  … och {len(att_göra) - 10} till")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
