# Cupschema — Alingsås HK

Spelschema, resultat och tabeller för Alingsås HK:s cuper, samlade på ett ställe.
Inspirerad av [ahk-beach](https://martinwelen.github.io/ahk-beach/) men byggd för
**flera cuper**, med smidigare kalender, filtrering och sortering.

Data hämtas live i webbläsaren från respektive cups öppna API på
**cupmanager.net** — ingen server, inget byggsteg. Matcher sparas i
`localStorage` och som CI-byggda snapshots i repot, så sidan slipper hämta om
allt vid varje besök (se [Cachning](#cachning-och-uppdateringsfrekvens)).

## Funktioner

- **Flera cuper**: Åhus Beach, Potatiscupen, Hallbybollen, Bua Beach (HK Varberg),
  Bohus Cup och Järnvägen Cup — och fler kan läggas till på en minut.
- **Nästa match-tavla** med nedräkning, plan och klass.
- **Tidslinje** med NU-linje som visar var i dagen man är, auto-scroll dit.
- **Filter**: dag, klass, eget lag, plan, fritextsök, dölj spelade matcher.
- **Sortering**: tid, klass eller plan.
- **Tabeller** per grupp med klubbens lag markerade.
- **Klicka på ett matchkort** för lagstatistik (tabellplacering, antal
  spelade/kommande matcher) och snabblänkar till en filtrerad schemavy för
  respektive lag.
- **Kalenderexport** (.ics) av det filtrerade urvalet — funkar i iPhone/Android/Outlook.
- **Live-uppdatering** av pågående cuper, utan att i onödan hämta om
  avslutade eller ännu inte startade cuper (se nedan).
- Klubb- eller helcupsläge, mörkt läge, mobilanpassad.

## Kör lokalt

```bash
cd hboll
python3 -m http.server 8437
# öppna http://localhost:8437
```

(Sidan är statisk — vilken webbserver som helst funkar.)

## Lägg till en cup

Enklast via **admin-sidan** (`admin.html`, länkad i sidfoten): lås upp med ditt
lösenord, redigera cuplistan och tryck Publicera — ändringen committas till
`data/cups.json` via GitHubs API och syns på sajten inom någon minut.

Första gången behöver du en fine-grained GitHub-token (Settings → Developer
settings → Fine-grained tokens; endast repot `hboll`; behörigheter *Contents:
Read and write* och *Actions: Read and write*). Tokenen krypteras med ditt
lösenord och sparas bara i webbläsaren. Notera: admin-sidan är publik — det
som skyddar mot skrivningar är GitHub-tokenen, inte lösenordet.

De flesta svenska handbollscuper kör Cup Manager. Så hittar du uppgifterna:

1. Gå till cupens sida, t.ex. `https://potatiscupen.cupmanager.net/`, och klicka
   dig till **resultat/spelschema**.
2. Visa sidans källkod och sök på `tournamentId` — ett 8-siffrigt tal.
3. Lägg in värd + ID i admin-sidan (för alla besökare), redigera
   `data/cups.json` för hand, eller använd **"+ Lägg till cup"** i sidfoten
   (sparas bara i din webbläsare).

**ProCup-cuper** (t.ex. Järnvägen Cup) saknar öppet API och CORS. De förhämtas
i stället av `scripts/fetch_procup.py` till `data/`-katalogen — GitHub Actions
(`.github/workflows/procup.yml`) kör skrapan var 6:e timme och committar när
datan ändrats. Lägg till fler ProCup-turneringar i `TOURNAMENTS`-listan i
skriptet (ev-numret syns i turneringens procup.se-URL) plus en post med
`dataUrl` i `js/config.js`.

Nytt år = nytt `tournamentId`. Uppdatera talet i `js/config.js` när cupen
publicerar nästa års schema.

## Publicera på GitHub Pages

```bash
git init && git add -A && git commit -m "Cupschema"
gh repo create hboll --public --source=. --push
gh api repos/{owner}/hboll/pages -X POST -f build_type=workflow \
  || true  # eller: Settings → Pages → Deploy from branch → main /(root)
```

Sedan finns sidan på `https://<ditt-konto>.github.io/hboll/`.
Inget mer behövs — datan hämtas från cupmanager.net direkt i besökarens
webbläsare.

## Cachning och uppdateringsfrekvens

Tre lager, i den ordning sidan letar:

1. **`localStorage`** i besökarens webbläsare — finns matcher där sedan
   tidigare och är de färska nog (se nedan), används de direkt utan nätverk.
2. **CI-byggda snapshots** i repot (`data/snapshot-<cupId>.json` för
   Cup Manager-cuper, `data/<cupId>.json` för ProCup-cuper). Genereras av
   `scripts/fetch_cupmanager.py` respektive `scripts/fetch_procup.py`, som
   GitHub Actions kör var 6:e timme (`.github/workflows/procup.yml`, kan
   även startas manuellt från admin-sidan). Gör att *förstabesöket* laddar
   direkt i stället för att vänta på Cup Manager-API:t (~15 s för Åhus
   6 000+ matcher).
3. **Live-API:t** hos cupen, som sista utväg eller vid explicit uppdatering.

Hur ofta en cup hämtas om avgörs av matchernas tidsspann, inte ett fast
intervall:

| Cupens läge | Ny hämtning |
|---|---|
| Avslutad (senaste matchen > 24 h bakåt) | Aldrig automatiskt |
| Framtida (första matchen > 24 h fram) | Var 6:e timme |
| Pågår | Var 3:e minut medan fliken är öppen |

Tryck **↻ Uppdatera** för att alltid tvinga fram en färsk hämtning.

## Tekniska noter

- API:t är GraphQL-likt: `https://<cup>.cupmanager.net/rest/results_api/call`
  med en `MatchWindow`-query; svaret är en platt entitets-store.
- Matchtider levereras som **svensk väggtid kodad som UTC-epoch** — sidan
  formaterar dem i UTC och exporterar .ics med `TZID=Europe/Stockholm`.
- Varje anrop cache-bustas med en `&_`-parameter: cupmanagers proxycache
  saknar `Vary: Origin` och skulle annars ge fel CORS-huvud på cacheträffar.
- Byt klubb i `js/config.js` (`HB.CLUB`) — allt annat följer med.
