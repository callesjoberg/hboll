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
  Bohus Cup och Järnvägen Cup — och fler kan läggas till på en minut. Cupväljaren
  bor i Inställningar; headern visar bara en kompakt "aktuell cup"-knapp.
- **Nästa match-kortet** blir en karusell (upp till 5 kommande klubbmatcher)
  när det finns fler än en — bläddra med pilar, prickar, svep på mobil, eller
  låt den auto-rotera var 6:e sekund. Animerade kortbyten, nedräkning, plan,
  klass och väder.
- **Tidslinje** med NU-linje som visar var i dagen man är, auto-scroll dit
  (bara en gång per sidladdning — stör inte karusell-bläddring efteråt).
- **Filter/sortering** i en expanderbar meny som går att minimera. Filter:
  dag (flerval), klass och eget lag (sök-/sorterbara dropdowns), plan (även
  klickbar direkt på ett matchkort), fritextsök med autocomplete, matchstatus
  (alla/kommande/spelade).
- **Sortering**: tid, klass, plan, resultat (vunnet/oavgjort/förlorat) eller mål.
- **V/O/F-märke** på klubbens matchkort för snabb överblick i listan.
- **Väderikon** (☀️/☁️/🌧️ m.fl.) på kommande matcher, via Open-Meteo.
- **Tabeller** per grupp med klubbens lag markerade — klicka ett lagnamn
  för att se laget schema (spelade och kommande matcher).
- **Slutspelsträd** (A-/B-/C-Slutspel) med omgångar och koppling till nästa
  match, för cuper som kör Cup Manager. En inställning kan **simulera
  ospelade slutspelsplatser** baserat på nuvarande tabellplacering (tydligt
  markerat som prognos, aldrig blandat med riktiga resultat).
- **Klicka på ett matchkort** för lagstatistik (tabellplacering, antal
  spelade/kommande matcher, tidigare möten) och snabblänkar till en
  filtrerad schemavy för respektive lag — eller klicka direkt på ett lagnamn
  för samma lättviktiga lagvy utan att öppna hela matchdialogen. En tydlig
  "← Tillbaka till din vy"-knapp återställer alltid grundfiltret efteråt.
- **Export** av det filtrerade/sorterade urvalet som Kalender (.ics),
  Kalkylark (.xlsx) eller CSV.
- **Delbara länkar**: adressfältet speglar alltid aktuellt filter och
  sortering — kopiera länken och mottagaren får exakt samma vy.
- **Live-uppdatering** av pågående cuper, utan att i onödan hämta om
  avslutade eller ännu inte startade cuper (se nedan) — Uppdatera-knappen
  visar tydligt när en hämtning pågår (kan ta 20–30 s för en stor cup).
- **Installningar**: valfri favoritklubb och favoritlag (⭐ på matchkort,
  med autocomplete från cupens egna lagnamn — samma klubb heter ofta olika
  saker i olika cuper), ljust/mörkt/auto-tema, färgkodning av lag som heter
  t.ex. Blå/Vit/Röd/Gul (liten prick, eller hela matchkortet i klubbens egen
  färg), egna manuella lagfärger per lagnamn, matchlängd (styr både
  kalenderexport och pausmarkering), valfri pausmarkering (mat/vätska) i
  tidslinjen, avancerad radbaserad tabell som alternativ till trädvyn för
  slutspel, samt slutspelsprognos (se ovan).
- **Installationsbar (PWA)**: kan läggas till på hemskärmen, fungerar med
  offline-cache av appskalet.
- **Matchdialog i helskärm** på mobil, med lagstatistik och tidigare möten.
- Klubb- eller helcupsläge, mobilanpassad, scrolla-till-toppen-knapp.

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
- Matchtider levereras som **genuin UTC-epoch** — sidan formaterar dem med
  `timeZone: "Europe/Stockholm"` och exporterar .ics med samma TZID.
- Varje anrop cache-bustas med en `&_`-parameter: cupmanagers proxycache
  saknar `Vary: Origin` och skulle annars ge fel CORS-huvud på cacheträffar.
- Standardklubb sätts i `js/config.js` (`HB.CLUB`), men kan bytas av
  besökaren själv i Inställningar → Favoritklubb utan kodändring.
- Slutspelsprognosen löser platshållarlag ("N:an i Grupp M", "Bästa N:an")
  mot gruppens tabell, och kopplar ihop omgångar via matchernas egna
  `nextWinnerId` — siffran i en platshållare som "Vinn. 18072137" är INTE
  samma id-rymd som `Match.id` och kan inte slås upp direkt.
