/* app.js — vy, filter och rendering för cupschemat. */

window.HB = window.HB || {};

(function () {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // --- tid: matchstart är en äkta UTC-epok — visa i Europe/Stockholm -----

  const TZ = "Europe/Stockholm";

  const fmtTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
  const fmtDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short",
  });
  const fmtDayLong = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long",
  });
  const fmtClock = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });

  function dayKey(ms) {
    // Svensk kalenderdag (en-CA ger yyyy-mm-dd), inte UTC-datumet — en match
    // strax efter midnatt svensk tid kan annars hamna på fel dag.
    return dayKeyFmt.format(new Date(ms));
  }

  // --- kategori-hjälpare -------------------------------------------------

  function parseCat(catName) {
    // "F12", "P 12", "F-14 (f 2012) Lätt" (fotbollscupers bindestreck-
    // mönster), "Flickor 12 år Classic (födda 2014)", "U12" → {g, age}
    const s = catName || "";
    let m = /\b([PFU])[\s-]?(\d{1,2})\b/.exec(s);
    if (m) return { g: m[1].toUpperCase(), age: +m[2] };
    m = /(Flickor|Pojkar|Damer|Herrar)\s*(\d{1,2})?/i.exec(s);
    if (m) {
      const g = { f: "F", p: "P", d: "D", h: "H" }[m[1][0].toLowerCase()];
      return { g, age: m[2] ? +m[2] : 0 };
    }
    return null;
  }

  // Årskullen ur ett klassnamn: "Flickor 13 (födda 2012) 24-26 april" ->
  // {g:"F", born:2012}. Åldersetiketten förskjuts mellan år (födda 2012 är
  // F13 år 2026 men F14 år 2025) medan årskullen är densamma — den är alltså
  // den stabila identiteten när flera upplagor blandas i samma vy.
  // null när födelseåret inte går att läsa ut (alla cuper skriver det inte).
  // Fyra skrivsätt förekommer i skarp data, uppmätt över samtliga cuper:
  //   "Flickor 13 (födda 2012)"      svensk standard
  //   "Boys 11 (boys born 2014)"     engelska (Eken Cup)
  //   "Flickor 10 år (f 2015)"       förkortat (IrstaBlixten)
  //   "F10(2014)"                    bara år i parentes (Katrineholm)
  // Tillsammans täcker de 69 % av alla klassnamn. Resten ("F09", "F12/13",
  // "Para Gul") har inget entydigt födelseår att gruppera på och behåller
  // sitt fulla namn som egen rad — inget val försvinner.
  function parseCohort(catName) {
    const born = /(?:f[öo]dd[a]?|born|\bf)\.?\s*(\d{4})|\((\d{4})\)/i.exec(catName || "");
    if (!born) return null;
    const g = (parseCat(catName) || {}).g;
    if (!g) return null;
    return { g, born: +(born[1] || born[2]) };
  }

  const COHORT_LABELS = { F: "Flickor", P: "Pojkar", U: "Ungdom", D: "Damer", H: "Herrar" };

  function cohortKey(catName) {
    const c = parseCohort(catName);
    return c ? c.g + c.born : null;
  }

  function cohortLabel(catName) {
    const c = parseCohort(catName);
    return c ? (COHORT_LABELS[c.g] || c.g) + " " + c.born : catName;
  }

  HB.shortCat = function (catName) {
    const p = parseCat(catName);
    if (!p) return (catName || "").slice(0, 8);
    return p.g + (p.age || "");
  };

  function catSortKey(catName) {
    const p = parseCat(catName);
    if (!p) return 9999;
    const gOrder = { F: 0, P: 1, U: 2, D: 3, H: 4 };
    return p.age * 10 + (gOrder[p.g] ?? 5);
  }

  function teamSuffix(name) {
    const stripped = name.replace(HB.CLUB.pattern, "").trim();
    return stripped || name;
  }

  function isClubName(name) {
    return HB.CLUB.pattern.test(name || "");
  }

  // Filnamnssäker version av ett lag-id — måste vara EXAKT samma algoritm
  // som slugify_team_id() i scripts/_ics.py, annars pekar länken fel.
  function slugifyTeamId(teamId) {
    let s = String(teamId)
      .replace(/[åä]/g, "a").replace(/ö/g, "o")
      .replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");
    s = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return s || "lag";
  }

  // Prenumererbar kalender-URL för ETT lags matcher, eller null om ingen
  // finns för den här cupen/laget. Cup Manager har en egen inbyggd
  // livetjänst (regenereras vid varje hämtning, alltid färsk) som funkar
  // för ALLA lag; dataUrl-cuper (ProCup/Gothia) saknar en sådan tjänst, så
  // där finns bara statiska filer (byggda av scripts/_ics.py, uppdaterade
  // i samma takt som resten av cupens data) och bara för klubbens egna lag
  // (annars skulle t.ex. Partilles ~1400 lag ge lika många småfiler).
  function calendarSubscribeUrl(team) {
    const c = cup();
    if (!c.dataUrl) {
      return "https://" + c.host + "/service/GetTeamCalendarService?teamId=" + team.id;
    }
    if (isClubName(team.name)) {
      return "data/ics/" + c.id + "/" + slugifyTeamId(team.id) + ".ics";
    }
    return null;
  }

  // Färgord i lagnamnet (t.ex. "Alingsås HK Blå", "Lödde Vikings HK Svart/Röd")
  // → en representativ hex-färg, för en liten prick bredvid lagnamnet.
  const TEAM_COLOR_WORDS = {
    bla: "#1f5fbf", vit: "#c9c2b4", svart: "#23303a", orange: "#e8730c",
    gul: "#f2bd0c", rod: "#d22f27", gron: "#2f9e44", rosa: "#e864a4",
    lila: "#8b5cf6", brun: "#6b4423", silver: "#9aa5b1", turkos: "#0e9aa7",
  };

  function slugifySv(s) {
    return (s || "").toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // Ett specifikt eget lag (inte hela klubben) att hålla extra koll på —
  // markeras med en ⭐ på matchkort och i nästa match-kortet. Jämförs
  // slugifierat (som lagfärgsöverstyrningarna) så stavning/skiftläge inte
  // spelar roll.
  // catName är matchens klass och avgör vilken årskull laget spelar i.
  //
  // Har favoriten en årskull måste den stämma EXAKT — även mot en klass som
  // inte går att tolka. Annars läcker stjärnan: väljer man "Alingsås HK 1
  // (Flickor 2010)" och klassen "Herrjunior (födda 07-09)" saknar entydigt
  // födelseår, så skulle en tillåtande jämförelse stjärnmärka herrjunior-
  // laget också — vilket är precis den sammanblandning årskullen finns för
  // att lösa. Favoriter UTAN årskull (inskrivna som fritext, eller migrerade
  // från det gamla enskilda fältet) matchar som förr på enbart namnet.
  function isFavoriteTeam(name, catName) {
    if (!name || !state.favoriteTeams.length) return false;
    const slug = slugifySv(name);
    const ck = cohortKey(catName);
    return state.favoriteTeams.some((f) =>
      slugifySv(f.name) === slug && (!f.cohort || f.cohort === ck));
  }

  // Nyckel för att jämföra/avduplicera favoritposter (namn + årskull).
  function favoriteTeamKey(name, cohort) {
    return slugifySv(name) + "|" + (cohort || "");
  }

  function favoriteTeamIndex(name, cohort) {
    const key = favoriteTeamKey(name, cohort);
    return state.favoriteTeams.findIndex((f) => favoriteTeamKey(f.name, f.cohort) === key);
  }

  function detectTeamColor(name) {
    for (const t of slugifySv(name).split("-")) {
      if (TEAM_COLOR_WORDS[t]) return TEAM_COLOR_WORDS[t];
    }
    return null;
  }

  // Prick bredvid lagnamnet — styrs av inställningen "Färgkoda lag".
  function teamColor(name) {
    return state.teamColors ? detectTeamColor(name) : null;
  }

  // Manuellt tilldelad färg för ett specifikt lag (exakt namn, slugifierat
  // så stavning/skiftläge inte spelar roll), oavsett cup — sparas i
  // state.teamColorOverrides som {slugifieratNamn: hexfärg}.
  function manualTeamColor(name) {
    return state.teamColorOverrides[slugifySv(name)] || null;
  }

  // Färg för HELA matchkortet: manuell lagfärg vinner alltid; annars, om
  // inställningen är på, ett upptäckt färgord i favoritklubbens eget lag.
  function cardTintColor(m) {
    const manual = manualTeamColor(m.home.name) || manualTeamColor(m.away.name);
    if (manual) return manual;
    if (!state.fullCardColors) return null;
    if (isClubName(m.home.name)) {
      const c = detectTeamColor(m.home.name);
      if (c) return c;
    }
    if (isClubName(m.away.name)) {
      const c = detectTeamColor(m.away.name);
      if (c) return c;
    }
    return null;
  }

  function isClubMatch(m) {
    return isClubName(m.home.name) || isClubName(m.away.name);
  }

  // --- klubblogga: genererad badge när favoritklubben inte är Alingsås HK -

  // Samma deterministiska fallbackpalett oavsett dator/webbläsare — ett
  // klubbnamn ger alltid samma färg (om det inte redan har ett färgord,
  // t.ex. "Lödde HK Blå", då vinner det ordet precis som lagfärgprickarna).
  const CLUB_BADGE_PALETTE = [
    "#1f5fbf", "#d22f27", "#2f9e44", "#e8730c", "#8b5cf6", "#0e9aa7", "#c9384f", "#5b6b7a",
  ];

  function clubBadgeColor(name) {
    const detected = detectTeamColor(name);
    if (detected) return detected;
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return CLUB_BADGE_PALETTE[Math.abs(hash) % CLUB_BADGE_PALETTE.length];
  }

  // "Alingsås HK" → "AHK", "IFK Kristianstad" → "IK", "Lugi HF" → "LHF" —
  // sista ordet är ofta en versal klubbförkortning (HK/IF/IK/HF/BK …); då
  // blir initialerna första bokstaven + hela den förkortningen, annars
  // första bokstaven i varje ord.
  function clubInitials(name) {
    const words = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    const last = words[words.length - 1];
    if (/^[A-ZÅÄÖ]{2,3}$/.test(last)) return (words[0][0] + last).toUpperCase().slice(0, 4);
    return words.map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
  }

  // Ren inline-SVG (ingen extern bild att hämta/spara) — en färgad cirkel
  // med klubbens initialer, samma idé som avatar-bokstäver i t.ex. Gmail.
  function clubBadgeDataUri(name) {
    const initials = clubInitials(name);
    const color = clubBadgeColor(name);
    const fontSize = initials.length >= 4 ? 13 : 15;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="20" fill="' + color + '"/>' +
      '<text x="20" y="21" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="Barlow Condensed, Arial, sans-serif" font-weight="700" ' +
      'font-size="' + fontSize + '" fill="#fff">' + escapeXml(initials) + '</text></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  // Bytt ut mot en genererad badge så fort favoritklubben skiljer sig från
  // sajtens förvalda (Alingsås HK, med sin riktiga logga) — annars ingen
  // logga att visa för en godtycklig klubb. Uppdaterar både sidhuvudets
  // <img> och webbläsarflikens favicon.
  function updateClubLogo() {
    const name = (state.favoriteClub || HB.CLUB.name).trim();
    const isDefaultClub = name.toLowerCase() === HB.CLUB.name.toLowerCase();
    const src = isDefaultClub ? HB.CLUB.logo : clubBadgeDataUri(name);
    const img = $("#clubLogo");
    if (img) { img.src = src; img.alt = isDefaultClub ? "" : name; }
    const favicon = $("#faviconLink");
    if (favicon) favicon.href = src;
  }

  // --- resultatvisning ----------------------------------------------------

  function isLive(m) {
    // Yngre klasser rapporterar inga resultat: deras matcher blir stående
    // "live" med nollor. Räkna bara pågående, ej färdiga, nutida matcher.
    return !!(m.res && m.res.live && !m.res.fin &&
      Math.abs(m.start - Date.now()) < 6 * 3600000);
  }

  function scoreText(res) {
    if (!res || (!res.fin && !res.live)) return null;
    if (res.wo) return "WO";
    if (res.hidden) return res.fin ? "spelad" : null;
    if (res.hg || res.ag) return res.hg + "–" + res.ag;
    if (res.hsw || res.asw) return res.hsw + "–" + res.asw;
    const per = (res.per || []).filter((p) => p.h || p.a);
    if (per.length) return per.map((p) => p.h + "–" + p.a).join(", ");
    // Spelad utan rapporterat resultat (yngre klasser).
    return res.fin ? "spelad" : null;
  }

  // Vilket lag som är "vårt" perspektiv för resultatmärke/sortering: det
  // filtrerade laget om exakt ett är valt, annars klubben, annars hemmalaget.
  function referenceSide(m) {
    if (state.teams.size === 1) {
      const [id] = state.teams;
      if (m.home.id === id) return "home";
      if (m.away.id === id) return "away";
    }
    if (isClubName(m.home.name)) return "home";
    if (isClubName(m.away.name)) return "away";
    return "home";
  }

  function hasReference(m) {
    return state.teams.size === 1
      ? (m.home.id === [...state.teams][0] || m.away.id === [...state.teams][0])
      : isClubMatch(m);
  }

  // "V"/"O"/"F" (vunnet/oavgjort/förlorat) ur referenslagets perspektiv, eller
  // null om matchen inte är avgjord eller inte rör referenslaget.
  function outcomeLetter(m) {
    if (!hasReference(m) || !(m.res && m.res.fin) || m.res.wo) return null;
    if (!m.res.winner) return "O";
    return m.res.winner === referenceSide(m) ? "V" : "F";
  }

  // Samma "V"/"O"/"F"-logik som outcomeLetter, men för ETT SPECIFIKT lag-id
  // i stället för appens egen favoritklubb (referenceSide/isClubName) —
  // Klubb/Lag-flikens nedborrning (renderClubClassDetail) kan gälla VILKEN
  // klubb som helst, inte bara den man själv följer.
  function clubOutcomeLetter(m, teamId) {
    if (!(m.res && m.res.fin) || m.res.wo) return null;
    if (!m.res.winner) return "O";
    return (m.res.winner === "home") === (m.home.id === teamId) ? "V" : "F";
  }

  // 0=vunnet, 1=oavgjort, 2=förlorat, 3=ospelat/ej relevant — för "Sortera: resultat".
  function outcomeRank(m) {
    if (!(m.res && m.res.fin)) return 3;
    const o = outcomeLetter(m);
    return o === "V" ? 0 : o === "O" ? 1 : o === "F" ? 2 : 3;
  }

  function totalGoals(m) {
    if (!(m.res && m.res.fin) || m.res.wo) return -1; // ospelade/WO sist
    return (m.res.hg || 0) + (m.res.ag || 0);
  }

  // --- state ---------------------------------------------------------------

  // Förra besökets cupval. Bor i localStorage, som är knutet till origin —
  // en ny domän (eller en ny webbläsare) ger alltså tomt blad. Saknas det
  // väljer init() den cup som ligger närmast i tiden i stället, se
  // pickDefaultCup; raden nedan är bara ett värde att stå på tills dess.
  const savedCupId = (() => {
    try { return localStorage.getItem("hb:cup"); } catch { return null; }
  })();

  const state = {
    cupId: savedCupId || (HB.allCups()[0] || {}).id,
    view: "schema",          // schema | tabeller
    // Vilken underflik som visas under "Stats" (se STATS_TABS/renderStatsView)
    // — trend | karta | klubb | klubbjamforelse | cuper. Sparas som en del av
    // saveUi() precis som view, så en omladdning behåller vald underflik.
    statsView: "trend",
    scope: "club",           // club | all
    days: new Set(),         // tom = alla dagar
    cats: new Set(),
    teams: new Set(),
    // Ytterligare avsmalning OVANPÅ bas-filtret (cats/teams), bara för att
    // styra vad som VISAS i Schema/Tabeller/Slutspel — inte en del av
    // bas-urvalet. Tänkt för när bas-filtret är låst (se filterLocked
    // nedan): fyller det tomrum som annars uppstår när verktygsradens
    // egna klass-/lagväljare göms bort, så man kan bläddra inom sitt
    // låsta urval utan att låsa upp det. Session, sparas ej.
    viewCats: new Set(),
    viewTeams: new Set(),
    arena: "",
    viewArena: "",           // vald bana i Bana-fliken (separat från arena-filtret ovan)
    q: "",
    sort: "tid",             // tid | klass | plan
    timeOrder: "asc",        // asc (äldst→nyast) | desc (nyast/kommande överst)
    matchFilter: "all",      // all | upcoming | played
    toolbarOpen: true,       // filter-/sorteringsmenyn expanderad? (session, sparas ej)
    heroMinimized: false,    // nästa match-karusellen minimerad? (session, sparas ej)
    bracketZoom: 1,          // zoomnivå för slutspelsträdet (session, sparas ej)
    playoffDivTab: {},       // catId -> vald slutspelsdivision (A-/B-/C-Slutspel) när en klass har flera (session, sparas ej)
    playoffCatTab: null,     // vald klass i Slutspel-vyn när fler än en klass är filtrerad fram (session, sparas ej)
    // Fryser dagar/klasser/lag (fälls ihop till en chip bredvid "Filter och
    // sortering", se renderToolbar) så att morgonens inställning inte rubbas
    // av misstag när man går in och kollar saker under dagen — sparas
    // därför per cup precis som filtren själva, INTE bara för sessionen.
    filterLocked: false,
    // Extra upplagor (tidigare år) vars matcher blandas in i den vanliga
    // vyn OVANPÅ innevarande års live-data — tom = bara innevarande år,
    // precis som idag. Sparas per cup (som cats/teams) eftersom det är en
    // medveten "sök över flera år"-inställning man vill behålla, inte bara
    // för sessionen. De faktiska matcherna cachas INTE i localStorage (för
    // stora payloads) utan hämtas om vid varje sidladdning — statiska
    // arkivfiler är billiga att hämta om (webbläsarens HTTP-cache räcker).
    years: new Set(),
    // Innevarande upplaga är förvald men går att stänga av separat (egen
    // växel bredvid årsväljaren, inte en del av years-flervalet ovan) —
    // annars fanns inget sätt att titta på ENBART tidigare år i
    // huvudgränssnittet, bara via Historik-modalen.
    includeCurrentYear: true,
    yearMatches: {},         // "cupId:edition" -> {status, matches} (session, sparas ej)
    yearRosters: {},         // "cupId:edition" -> {teamId: [{name,shirtNr,position,goals}]} (session, sparas ej)
    archiveEditions: {},     // cupId -> {status, editions: [årtal, nyast först]} (session, sparas ej)
    // Hela data/archive/index.json (cupId -> {cupName, editions:[{edition,
    // matches,teams,classes,days,...}]}), laddas EN gång vid appstart (se
    // init()) — till skillnad från archiveEditions ovan (bara årtalslista,
    // per cup, exkl. innevarande år) behåller den här alla nyckeltal OCH
    // innevarande år, vilket Trend-fliken (renderTrendView) behöver.
    archiveIndex: null,
    // {cupId: {edition: [rå lagnamn, ...]}}, byggd av scripts/build_team_
    // index.py, laddas lat vid första Klubb/Lag-sökningen (se
    // ensureTeamIndex/computeClubRows) — under 1 MB, till skillnad från de
    // fulla arkivfilerna. Låter computeClubRows slå upp VILKA cup-år som
    // ens KAN innehålla en sökning innan den hämtar de tunga filerna, i
    // stället för att alltid hämta ALLA arkiverade upplagor av ALLA cuper.
    teamIndex: null,
    // Trend-fliken: eget filter, INTE state.cats/state.teams — de håller
    // id:n som bara gäller innevarande upplaga (se allActiveMatches-
    // kommentaren om att id:n aldrig är stabila mellan år), så Trend filtrerar
    // i stället på KLASSNAMN (stabilt mellan år). Session, sparas ej.
    trendCats: new Set(),
    // Trend-fliken (enskild cup): manuellt valt baslinjeår (100 %-ankaret
    // i formkurvan), null = auto (se trendBaselineIndex). Session, sparas ej.
    trendBaselineYear: null,
    // Trend-fliken (flera cuper): vilket mått jämförelsegrafen visar — en av
    // TREND_METRICS nycklarna. Session, sparas ej.
    trendCompareMetric: "matches",
    // Klubb/Lag-fliken: fritextsökning på lag-/klubbnamn, söker över ALLA
    // cuper med arkiverad historik (till skillnad från Trend, som är
    // avgränsad till valda cuper) — se renderClubView. Session, sparas ej.
    clubQuery: "",
    // Klubb/Lag-fliken: nedborrning i resultatlistan — null/null = visa
    // listan över cuper, clubDrillCup satt = visa klassnedbrytning för den
    // cupen, båda satta = visa lag/matcher för den klassen. Nollställs när
    // sökningen ändras (se renderClubView) — en ny sökterm gör den gamla
    // nedborrningen obegriplig. Session, sparas ej.
    clubDrillCup: null,
    clubDrillClass: null,
    // Klubb/Lag-fliken: valfritt årsfilter (tomma Set = alla år), gäller
    // över alla tre nivåerna (se clubEditionsFor). Rör INTE sökningen
    // (clubQuery) — behålls medvetet när man byter sökterm, till skillnad
    // från nedborrningen ovan. Session, sparas ej.
    clubYears: new Set(),
    // Klubb/Lag-fliken: fyll ut "År"-kolumnen med de år cupen arkiverat men
    // klubben INTE deltog i (röd text, se renderYearsWithGaps) — på som
    // förval, men valfritt: en cup med gles historik kan annars dränka
    // kolumnen i rött. Session, sparas ej.
    clubShowGaps: true,
    // Cuper-fliken (under Stats): vald cup att visa år-för-år-nedbrytning
    // för, null = visa översiktstabellen över alla cuper. Session, sparas ej.
    statsCupDrill: null,
    // Klubbjämförelse-fliken (under Stats): klubbar/lag tillagda via sökrutan
    // med autocomplete (se renderClubCompareView), jämförs sida vid sida
    // (computeClubRows). Ordning bevaras (senast tillagd sist). Session,
    // sparas ej.
    compareNames: [],
    // Klubbjämförelse-fliken: vilka rader (klubb-/lagnamn) som just nu är
    // expanderade och visar sin cup-för-cup-detalj (klasser + rå lagnamn,
    // se clubCompareDetailBlock) — en klubb/lag åt gången eller flera.
    // Session, sparas ej.
    compareExpanded: new Set(),
    // DELAD mellan Karta- och Trend-fliken (tom = bara innevarande, fylls i
    // vid första besöket i ENTINGEN renderMapView ELLER renderTrendView) —
    // samma cupurval hänger med när man växlar mellan de två flikarna i
    // stället för att varje flik glömmer det andra valde. EN vald cup ger
    // Trends formkurva som vanligt, FLERA ger en jämförelsegraf i stället
    // (se renderTrendCompare) — Karta bryr sig inte om antalet, bara VILKA.
    // Varje flik prunar ändå bort cuper som inte är giltiga för just den
    // (fel sport, eller för Trend: ingen arkiverad historik alls) innan den
    // egna vyn ritas, så ett urval som blandar t.ex. en historielös cup
    // stör bara Trend, inte Karta. mapCupStatus håller reda på lata
    // hämtningar av ANDRA cupers klubbdata (se ensureCupClubGeo) så samma
    // cup inte hämtas om flera gånger — bara Kartans eget, inte delat.
    exploreCupIds: new Set(),
    mapCupStatus: {},
    // cupId -> Set(klubbnamn), ALLA deltagande klubbar (kända+okända
    // adress) — skiljer sig från HB.api.clubGeo som bara har de vars
    // adress gick att slå upp. Fylls av ensureCupClubGeo. Session, sparas ej.
    mapCupAllClubs: {},
    // cupId -> antal lag (distinkta lag-id, se teamsAndClassesFromMatches)
    // respektive Set(klassnamn) — till Kartans sammanfattningsrad. Fylls
    // av ensureCupClubGeo (och loadCup(), se dess kommentar om samma race
    // som mapCupAllClubs hade). Session, sparas ej.
    mapCupTeamCount: {},
    mapCupClasses: {},
    // cupId -> Map(klubbnamn -> landskod), OBEROENDE av om klubben även har
    // en känd adress (avgörs vid slutlig sammanslagning i renderMapView, se
    // clubCountryFromMatches) — Kartans mellannivå mellan "känd adress" och
    // "helt okänd", landskoden är inbäddad direkt på varje match (home/away.
    // country, se js/api.js normalize()/scripts/fetch_*.py), kräver alltså
    // ingen namnmatchning mot klubbkatalogen. Fylls av ensureCupClubGeo (och
    // loadCup(), samma ställen som mapCupAllClubs). Session, sparas ej.
    mapCupCountryByClub: {},
    // Karta-fliken: valt år (ett av arkivets, null = "Nu"/live data) —
    // se renderMapView/mergedClubGeoForYear. Session, sparas ej.
    mapYear: null,
    // Karta-fliken: "Visa landshistorik"-kryssrutan (av som förval — kräver
    // att ALLA arkiverade år för de valda cuperna laddas, inte bara det
    // just synliga året, se countryYearSummary). Session, sparas ej.
    mapCountryHistory: false,
    showAllPlayedArena: false,   // Bana-vyn: visa alla spelade i stället för bara senaste timmarna
    // Bana-vyn: är kartan över banornas platser utfälld? Av som förval —
    // den drar in MapLibre från CDN (appens enda externa JS-beroende), och
    // adressraden ovanför räcker för de flesta besök. Session, sparas ej.
    arenaMapOpen: false,
    showAllPlayedBracket: false, // slutspelstabellen: samma, men för dess egna rader
    schemaOlderRevealCount: 0,   // schemat: hur många extra äldre matcher "visa fler tidigare" öppnat upp
    // Tillfälligt avsteg från Schemas automatiska favoriturval. Sparas inte:
    // användaren har inte ändrat sina filter eller favoriter, bara bett den
    // aktuella cupvyn att visa allt tills cupen laddas om/byts.
    schemaShowAllCup: false,
    matches: [],
    loadedAt: 0,
    loading: false,
    error: null,
    tables: {},              // divId -> {status, rows}
    playoffs: {},            // catId -> {status, divisions}
    groupTables: {},         // catId -> {status, byGroupNum, teamStrength} (för slutspelsprognos)
    // Globala inställningar (gäller alla cuper, sparas separat från
    // per-cup-filtren i saveUi()/loadUi()).
    theme: localStorage.getItem("hb:theme") || "auto",       // light | dark | auto
    teamColors: localStorage.getItem("hb:teamColors") !== "off",
    breakMinutes: +(localStorage.getItem("hb:breakMinutes") || 0), // 0 = av
    matchMinutes: +(localStorage.getItem("hb:matchMinutes") || 30), // schemarutans längd
    revealBatchSize: +(localStorage.getItem("hb:revealBatchSize") || 4), // "visa fler tidigare": antal per klick
    recentMatchCount: +(localStorage.getItem("hb:recentMatchCount") || 2), // Bana/slutspelstabell: visa senast spelade N st
    advancedPlayoffTable: localStorage.getItem("hb:advancedPlayoffTable") === "on",
    showPlayoffProjection: localStorage.getItem("hb:showPlayoffProjection") === "on",
    favoriteClub: localStorage.getItem("hb:favoriteClub") || HB.CLUB.name,
    // Stjärnmärkta lag: [{name, cohort}] där cohort är årskullsnyckeln ur
    // klassnamnet ("F2011", se cohortKey) eller null när klassen inte går
    // att tolka. Klubb+lagnamn ensamt räcker INTE som identitet: "Alingsås
    // HK 1" finns samtidigt i F16, P16 och Herrjunior i samma cup (104
    // lagnamn i Göteborg Cup 2026 är tvetydiga på det viset), så en ren
    // namnmatchning stjärnmärkte alla på en gång. Årskullen är däremot
    // stabil mellan både cuper och år — ett lag fött 2011 är F2011 oavsett
    // om klassen råkar heta "F13" eller "Flickor 13" det året.
    //
    // Lista, inte ett enda lag: man har ofta flera barn eller följer flera
    // årskullar. hb:favoriteTeam (en sträng) migreras in nedan och lämnas
    // kvar orörd, så en nedgradering inte tappar valet.
    favoriteTeams: (() => {
      try {
        const raw = JSON.parse(localStorage.getItem("hb:favoriteTeams") || "null");
        if (Array.isArray(raw)) {
          return raw.filter((t) => t && t.name)
            .map((t) => ({ name: String(t.name), cohort: t.cohort || null }));
        }
      } catch { /* trasigt värde: falla tillbaka på det gamla fältet */ }
      const legacy = (localStorage.getItem("hb:favoriteTeam") || "").trim();
      return legacy ? [{ name: legacy, cohort: null }] : [];
    })(),
    fullCardColors: localStorage.getItem("hb:fullCardColors") === "on",
    // Minuter före matchstart som .ics-exporten lägger in en påminnelse
    // (VALARM), 0 = ingen. Väljs i exportmenyn men sparas här, se
    // buildMatchExportPanel.
    icsAlarmMinutes: +(localStorage.getItem("hb:icsAlarmMinutes") || 0),
    teamColorOverrides: (() => {
      try { return JSON.parse(localStorage.getItem("hb:teamColorOverrides") || "{}"); }
      catch { return {}; }
    })(),
  };

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme === "auto" ? "" : state.theme;
  }

  // Bygger om HB.CLUB.pattern från den valfria favoritklubben i inställ-
  // ningarna (förvalt: samma klubb sajten är byggd för). Håller å/ä/ö
  // toleranta som den ursprungliga hårdkodade regexen gjorde.
  function rebuildClubPattern() {
    const raw = (state.favoriteClub || HB.CLUB.name).trim();
    const escaped = raw
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[åäÅÄ]/g, "[åäa]")
      .replace(/[öÖ]/g, "[öo]")
      .replace(/\s+/g, "\\s*");
    HB.CLUB.pattern = escaped ? new RegExp("^" + escaped, "i") : /^$/;
  }
  rebuildClubPattern();

  function saveSettings() {
    persist("hb:theme", state.theme);
    persist("hb:favoriteClub", state.favoriteClub);
    persist("hb:favoriteTeams", JSON.stringify(state.favoriteTeams));
    rebuildClubPattern();
    updateClubLogo();
    persist("hb:teamColors", state.teamColors ? "on" : "off");
    persist("hb:breakMinutes", String(state.breakMinutes));
    persist("hb:matchMinutes", String(state.matchMinutes));
    persist("hb:revealBatchSize", String(state.revealBatchSize));
    persist("hb:recentMatchCount", String(state.recentMatchCount));
    persist("hb:advancedPlayoffTable", state.advancedPlayoffTable ? "on" : "off");
    persist("hb:showPlayoffProjection", state.showPlayoffProjection ? "on" : "off");
    persist("hb:fullCardColors", state.fullCardColors ? "on" : "off");
    persist("hb:teamColorOverrides", JSON.stringify(state.teamColorOverrides));
    applyTheme();
  }

  // Sätts direkt vid skriptkörning (inte i async init()) så temat är rätt
  // redan vid första målningen — annars hinner sidan flimra i fel tema.
  applyTheme();

  function cup() {
    return HB.allCups().find((c) => c.id === state.cupId) || HB.allCups()[0];
  }

  function uiKey() { return "hb:ui:" + state.cupId; }

  // localStorage kan kasta: full kvot (Firefox ger 5 MB per origin mot
  // Chromes ~10 — se MAX_CACHE_BYTES i api.js), privat läge, eller
  // blockerad lagring i webbläsarens integritetsinställningar. Ett
  // misslyckat SPARANDE av en inställning får aldrig fälla hela sidan:
  // utan den här spärren blev det ett ofångat fel vid varje sidladdning
  // och varje cupbyte, vilket i sin tur triggade "något gick fel"-rutan
  // (se felfångaren överst i index.html). Vyn fungerar ändå — den tappar
  // bara minnet till nästa besök.
  function persist(key, value) {
    try { localStorage.setItem(key, value); } catch { /* utan lagring: kör vidare */ }
  }

  function saveUi() {
    persist("hb:cup", state.cupId);
    persist(uiKey(), JSON.stringify({
      view: state.view, statsView: state.statsView, scope: state.scope, days: [...state.days],
      cats: [...state.cats], teams: [...state.teams], years: [...state.years],
      includeCurrentYear: state.includeCurrentYear,
      arena: state.arena, viewArena: state.viewArena,
      sort: state.sort, timeOrder: state.timeOrder, matchFilter: state.matchFilter,
      filterLocked: state.filterLocked,
    }));
    syncUrl();
    refreshFilterChrome();
  }

  // Siffran på filterknappen och Rensa-brickans synlighet speglar aktuellt
  // filter. Ett filterval anropar bara renderContent(), inte render(), så
  // utan den här lätta uppdateringen låg både siffran och brickan kvar i
  // sitt gamla läge tills något annat råkade rita om verktygsraden.
  function refreshFilterChrome() {
    const n = activeFilterCount();
    for (const el of document.querySelectorAll(".filter-clear-tile")) el.hidden = !n;
    if (document.querySelector("#bottomBar")) renderBottomBar();
  }

  // Speglar aktuellt filter/sortering i adressfältet (utan att lägga till
  // historik-poster) så att en delad/bokmärkt länk återskapar exakt samma
  // vy. Bara icke-default värden tas med, för korta URL:er. q (fritextsök)
  // sparas INTE i localStorage (den är avsiktligt tillfällig mellan besök)
  // men tas med här eftersom en delad länk ska återge sökningen också.
  function syncUrl() {
    const p = new URLSearchParams();
    p.set("cup", state.cupId);
    if (state.view !== "schema") p.set("view", state.view);
    if (state.view === "stats" && state.statsView !== "trend") p.set("stats", state.statsView);
    if (state.scope !== "club") p.set("scope", state.scope);
    if (state.days.size) p.set("days", [...state.days].join(","));
    if (state.cats.size) p.set("cats", [...state.cats].join(","));
    if (state.teams.size) p.set("teams", [...state.teams].join(","));
    if (state.years.size) p.set("years", [...state.years].join(","));
    if (!state.includeCurrentYear) p.set("curYear", "0");
    if (state.arena) p.set("arena", state.arena);
    if (state.viewArena) p.set("viewArena", state.viewArena);
    if (state.sort !== "tid") p.set("sort", state.sort);
    if (state.timeOrder !== "asc") p.set("order", state.timeOrder);
    if (state.matchFilter !== "all") p.set("mf", state.matchFilter);
    if (state.q) p.set("q", state.q);
    syncSubViewUrl(p);
    const qs = p.toString();
    const url = location.pathname + (qs ? "?" + qs : "");
    // Bakåtknappen: lägg BARA en historik-post när den strukturella vyn
    // ändras (cup / flik / stats-underflik) — då kan webbläsarens bakåt-/
    // framåtknapp stega mellan de vyerna. Filter-, sök- och sorterings-
    // ändringar (samma cup+flik) ersätter i stället posten, så historiken
    // inte spammas med varje litet reglage. popstate nedan läser tillbaka.
    const sig = navSig();
    if (navInitialized && !applyingPopstate && sig !== lastNavSig) {
      history.pushState(null, "", url);
      lastNavSig = sig;
      return;
    }
    lastNavSig = sig;
    // syncUrl() körs numera efter VARJE renderContent() (se dess kommentar),
    // alltså även vid bakgrundsuppdateringar som inte ändrat något. Hoppa
    // över replaceState när URL:en redan är identisk — Safari stryper
    // history-anrop (~100 per 30 s) och skulle annars kunna börja kasta.
    if (url !== location.pathname + location.search) history.replaceState(null, "", url);
  }

  // Underflikarnas EGNA val — Vinnare-läge/klubb, Klubb/Lag-sökningen och
  // dess nedborrning, Kartans år, Trends klassurval osv. De bor utanför de
  // gemensamma filtren ovan (de flesta som modulnivå-variabler eller
  // "session, sparas ej"-fält i state), men måste ändå med i URL:en för att
  // en delad länk ska visa det man faktiskt tittar på. Bara parametrar som
  // hör till den JUST NU visade fliken tas med, så en Schema-länk slipper
  // släpa på ett halvdussin stats-parametrar den ändå inte läser.
  const MEDAL_KEYS = ["guld", "silver", "brons"];
  const medalsToStr = (m) => MEDAL_KEYS.filter((k) => m[k]).join(",");
  const strToMedals = (s) => {
    const on = new Set(String(s).split(",").filter(Boolean));
    return { guld: on.has("guld"), silver: on.has("silver"), brons: on.has("brons") };
  };
  // Klass- och klubbnamn kan innehålla komma ("P14, nivå 2") — namnlistor
  // separeras därför med ~ i stället för den vanliga kommaseparatorn.
  const NAME_SEP = "~";
  // Parametrar som INTE är ett vyval: cup hanteras separat, tune tillhör
  // välkomstöverlägget (js/welcome.js) och _v är cache-busten från
  // "Töm cache och ladda om" i Inställningar. Ingen av dem ska få en
  // länk att räknas som delad vy (se hasUrlFilters i init).
  const NON_VIEW_PARAMS = new Set(["cup", "tune", "_v"]);
  // Klass-/lag-/divisions-id är numeriska i API:t och jämförs strikt (===)
  // på flera håll — en URL-sträng måste därför tillbaka till number.
  const toId = (s) => (/^\d+$/.test(s) ? +s : s);

  function syncSubViewUrl(p) {
    if (state.view === "bana") {
      if (state.arenaMapOpen) p.set("amap", "1");
      return;
    }
    if (state.view === "slutspel") {
      if (state.playoffCatTab != null) p.set("pcat", String(state.playoffCatTab));
      const divs = Object.entries(state.playoffDivTab);
      if (divs.length) p.set("pdiv", divs.map(([c, d]) => c + ":" + d).join(","));
      return;
    }
    if (state.view !== "stats") return;
    const sv = state.statsView;
    // exploreCupIds delas av Trend och Karta (se dess state-kommentar).
    if ((sv === "trend" || sv === "karta") && state.exploreCupIds.size) {
      p.set("cups", [...state.exploreCupIds].join(","));
    }
    if (sv === "trend") {
      if (state.trendCats.size) p.set("tcats", [...state.trendCats].join(NAME_SEP));
      if (state.trendBaselineYear) p.set("tbase", state.trendBaselineYear);
      if (state.trendCompareMetric !== "matches") p.set("tmetric", state.trendCompareMetric);
    } else if (sv === "karta") {
      if (state.mapYear) p.set("mapYear", state.mapYear);
      if (state.mapCountryHistory) p.set("mapCh", "1");
    } else if (sv === "klubb") {
      // Alltid med (även tom) — sökrutan förifylls annars med favoritklubben
      // vid första ritningen (clubQuerySeeded), och då skulle en medvetet
      // tömd sökning inte överleva en delad länk eller bakåtknappen.
      p.set("club", state.clubQuery);
      if (state.clubDrillCup) p.set("clubCup", state.clubDrillCup);
      if (state.clubDrillClass) p.set("clubClass", state.clubDrillClass);
      if (state.clubYears.size) p.set("clubYears", [...state.clubYears].join(","));
      if (!state.clubShowGaps) p.set("clubGaps", "0");
    } else if (sv === "klubbjamforelse") {
      if (state.compareNames.length) p.set("cmp", state.compareNames.join(NAME_SEP));
      if (state.compareExpanded.size) p.set("cmpOpen", [...state.compareExpanded].join(NAME_SEP));
    } else if (sv === "cuper") {
      if (state.statsCupDrill) p.set("cupDrill", state.statsCupDrill);
    } else if (sv === "kalender") {
      if (kalenderYear) p.set("kyear", kalenderYear);
    } else if (sv === "vinnare") {
      if (vinnareMode !== "trofe") p.set("vm", vinnareMode);
      if (vinnareMode === "trofe") {
        if (vinnareQuery !== null) p.set("vq", vinnareQuery); // samma skäl som club ovan
        if (medalsToStr(vinnareMedals) !== "guld") p.set("vmed", medalsToStr(vinnareMedals));
      } else if (vinnareMode === "ar") {
        if (vinnareCup) p.set("vcup", vinnareCup);
        if (vinnareYear) p.set("vyear", vinnareYear);
      } else {
        if (vinnareToppCup) p.set("vtcup", vinnareToppCup);
        if (medalsToStr(vinnareToppMedals) !== "guld") p.set("vtmed", medalsToStr(vinnareToppMedals));
      }
    } else if (sv === "historik") {
      if (historyMode !== "compare") p.set("hmode", historyMode);
      // Bläddraren har en helt egen lokal state (hs i renderBrowseMode) —
      // browseOpen är dess spegling på modulnivå, satt när en upplaga
      // faktiskt är öppnad (null när cup/år-väljaren visas). browseTarget
      // som reserv: en upplaga som är BESTÄLLD men ännu inte öppnad (djup-
      // länk vid appstart, eller ett klick i troféskåpet) hinner annars få
      // sina b*-parametrar bortskrivna av synken i saveUi() innan
      // renderBrowseMode ens ritats en första gång.
      const b = browseOpen || browseTarget;
      if (historyMode === "browse" && b) {
        p.set("bcup", b.cupId);
        p.set("bed", b.edition);
        if (b.view && b.view !== "schema") p.set("bview", b.view);
        if (b.catFilter) p.set("bcat", b.catFilter);
        if (b.arena) p.set("bar", b.arena);
        if (b.teamQuery) p.set("bq", b.teamQuery);
      }
    }
  }

  // Strukturell "vy-signatur" — det som ska räknas som ett eget bakåtsteg.
  function navSig() {
    return state.cupId + "|" + state.view + "|" + (state.view === "stats" ? state.statsView : "");
  }
  let lastNavSig = null;
  let navInitialized = false;   // sätts sant när init är klar (så första synken ersätter, inte pushar)
  let applyingPopstate = false; // sant medan popstate återställer state (ingen ny push då)

  // Läser URL-parametrar → state (delad/bokmärkt länk och popstate delar
  // denna). Sätter bara det som faktiskt finns i URL:en; nollställning görs
  // separat (resetUrlState) före popstate-återställning.
  function applyUrlToState(params) {
    if (params.get("view")) state.view = params.get("view");
    if (params.get("stats")) state.statsView = params.get("stats");
    normalizeStatsView();
    if (params.get("scope")) state.scope = params.get("scope");
    if (params.get("days")) state.days = new Set(params.get("days").split(","));
    if (params.get("cats")) state.cats = new Set(params.get("cats").split(",").map(toId));
    if (params.get("teams")) state.teams = new Set(params.get("teams").split(",").map(toId));
    if (params.get("years")) state.years = new Set(params.get("years").split(","));
    if (params.get("curYear") === "0") state.includeCurrentYear = false;
    if (params.get("arena")) state.arena = params.get("arena");
    if (params.get("viewArena")) state.viewArena = params.get("viewArena");
    if (params.get("sort")) state.sort = params.get("sort");
    if (params.get("order") === "desc") state.timeOrder = "desc";
    if (["all", "upcoming", "played"].includes(params.get("mf"))) state.matchFilter = params.get("mf");
    if (params.get("q")) state.q = params.get("q");
    applySubViewUrl(params);
  }

  // Motsvarigheten till syncSubViewUrl — läser underflikarnas egna val ur
  // URL:en. Läser ALLA nycklar oavsett vilken flik som är vald (till skillnad
  // från skrivningen): en länk som råkar bära med sig extra parametrar ska
  // ändå landa rätt om man sen växlar till den fliken.
  function applySubViewUrl(params) {
    if (params.get("amap") === "1") state.arenaMapOpen = true;
    if (params.get("pcat")) state.playoffCatTab = +params.get("pcat");
    if (params.get("pdiv")) {
      const map = {};
      params.get("pdiv").split(",").forEach((pair) => {
        const i = pair.indexOf(":");
        if (i > 0) map[pair.slice(0, i)] = toId(pair.slice(i + 1)); // divisions-id jämförs strikt (===)
      });
      state.playoffDivTab = map;
    }
    if (params.get("cups")) state.exploreCupIds = new Set(params.get("cups").split(","));
    if (params.get("tcats")) state.trendCats = new Set(params.get("tcats").split(NAME_SEP));
    if (params.get("tbase")) state.trendBaselineYear = params.get("tbase");
    if (params.get("tmetric")) state.trendCompareMetric = params.get("tmetric");
    if (params.get("mapYear")) state.mapYear = params.get("mapYear");
    if (params.get("mapCh") === "1") state.mapCountryHistory = true;
    // has() (inte get()) — en tom club/vq betyder "medvetet tömd sökruta"
    // och ska hindra förifyllningen med favoritklubben, se syncSubViewUrl.
    if (params.has("club")) { state.clubQuery = params.get("club"); clubQuerySeeded = true; }
    if (params.get("clubCup")) state.clubDrillCup = params.get("clubCup");
    if (params.get("clubClass")) state.clubDrillClass = params.get("clubClass");
    if (params.get("clubYears")) state.clubYears = new Set(params.get("clubYears").split(","));
    if (params.get("clubGaps") === "0") state.clubShowGaps = false;
    if (params.get("cmp")) state.compareNames = params.get("cmp").split(NAME_SEP);
    if (params.get("cmpOpen")) state.compareExpanded = new Set(params.get("cmpOpen").split(NAME_SEP));
    if (params.get("cupDrill")) state.statsCupDrill = params.get("cupDrill");
    if (params.get("kyear")) kalenderYear = params.get("kyear");
    if (["trofe", "ar", "topp"].includes(params.get("vm"))) vinnareMode = params.get("vm");
    if (params.has("vq")) vinnareQuery = params.get("vq");
    if (params.has("vmed")) vinnareMedals = strToMedals(params.get("vmed"));
    if (params.get("vcup")) vinnareCup = params.get("vcup");
    if (params.get("vyear")) vinnareYear = params.get("vyear");
    if (params.has("vtcup")) vinnareToppCup = params.get("vtcup");
    if (params.has("vtmed")) vinnareToppMedals = strToMedals(params.get("vtmed"));
    if (["compare", "browse"].includes(params.get("hmode"))) historyMode = params.get("hmode");
    if (params.get("bcup") && params.get("bed")) {
      // Samma mekanism som Vinnare-flikens gotoBrowseSlutspel: browseTarget
      // konsumeras av renderBrowseMode nästa gång den ritas.
      browseTarget = {
        cupId: params.get("bcup"), edition: params.get("bed"),
        view: params.get("bview") || "schema", catFilter: params.get("bcat") || "",
        arena: params.get("bar") || "", teamQuery: params.get("bq"),
      };
      historyMode = "browse";
    }
  }

  // Återställer de URL-styrda fälten till default (allt som INTE finns med i
  // en bakåt-navigerad URL ska tömmas innan den läses in, annars hänger t.ex.
  // ett gammalt filter kvar). Rör inte fält utanför URL:en (filterLocked m.m.).
  function resetUrlState() {
    state.view = "schema"; state.statsView = "trend"; state.scope = "club";
    state.days = new Set(); state.cats = new Set(); state.teams = new Set(); state.years = new Set();
    state.includeCurrentYear = true; state.arena = ""; state.viewArena = "";
    state.sort = "tid"; state.timeOrder = "asc"; state.matchFilter = "all"; state.q = "";
    resetSubViewUrl();
  }

  // Samma sak för underflikarnas egna val (se syncSubViewUrl) — utan den
  // skulle t.ex. en nedborrning i Klubb/Lag eller Kartans valda år hänga
  // kvar när man backar till en URL som inte har dem.
  function resetSubViewUrl() {
    state.arenaMapOpen = false;
    state.playoffCatTab = null; state.playoffDivTab = {};
    state.exploreCupIds = new Set();
    state.trendCats = new Set(); state.trendBaselineYear = null; state.trendCompareMetric = "matches";
    state.mapYear = null; state.mapCountryHistory = false;
    // clubQuerySeeded tillbaka till false: en bakåtnavigering till en vy där
    // Klubb/Lag aldrig var öppnad ska förifylla favoritklubben igen precis
    // som ett färskt besök gör (en medvetet tömd sökruta bär i stället med
    // sig club= i URL:en, se syncSubViewUrl).
    state.clubQuery = ""; clubQuerySeeded = false;
    state.clubDrillCup = null; state.clubDrillClass = null;
    state.clubYears = new Set(); state.clubShowGaps = true;
    state.compareNames = []; state.compareExpanded = new Set();
    state.statsCupDrill = null;
    kalenderYear = null;
    vinnareMode = "trofe"; vinnareQuery = null;
    vinnareMedals = { guld: true, silver: false, brons: false };
    vinnareCup = null; vinnareYear = null; vinnareToppCup = "";
    vinnareToppMedals = { guld: true, silver: false, brons: false };
    historyMode = "compare"; browseTarget = null; browseOpen = null;
  }

  // Trend/Karta/Klubb-Lag var tidigare egna toppnivåflikar (state.view-
  // värden) innan de 2026-07-25 slogs ihop till underflikar under en enda
  // "Stats"-flik (se STATS_TABS/renderStatsView) — gamla sparade/delade
  // länkar (view=trend/karta/klubb) ska ändå landa rätt i stället för att
  // tyst falla tillbaka på Schema.
  function normalizeStatsView() {
    if (["trend", "karta", "klubb"].includes(state.view)) {
      state.statsView = state.view;
      state.view = "stats";
    }
  }

  function loadUi() {
    state.view = "schema"; state.statsView = "trend"; state.scope = "club"; state.days = new Set();
    state.cats = new Set(); state.teams = new Set(); state.years = new Set();
    state.includeCurrentYear = true;
    state.viewCats = new Set(); state.viewTeams = new Set();
    state.arena = ""; state.viewArena = ""; state.q = ""; state.sort = "tid"; state.matchFilter = "all";
    state.timeOrder = "asc"; state.schemaOlderRevealCount = 0; state.schemaShowAllCup = false;
    state.filterLocked = false;
    try {
      const s = JSON.parse(localStorage.getItem(uiKey()) || "{}");
      if (s.view) state.view = s.view;
      if (s.statsView) state.statsView = s.statsView;
      if (s.scope) state.scope = s.scope;
      if (Array.isArray(s.days)) state.days = new Set(s.days);
      else if (typeof s.day === "string" && s.day !== "all") state.days = new Set([s.day]); // migrera gammalt format
      if (Array.isArray(s.cats)) state.cats = new Set(s.cats);
      if (Array.isArray(s.teams)) state.teams = new Set(s.teams);
      if (Array.isArray(s.years)) state.years = new Set(s.years);
      if (s.includeCurrentYear === false) state.includeCurrentYear = false;
      if (s.arena) state.arena = s.arena;
      if (s.viewArena) state.viewArena = s.viewArena;
      if (s.sort) state.sort = s.sort;
      if (s.timeOrder === "desc") state.timeOrder = "desc";
      if (["all", "upcoming", "played"].includes(s.matchFilter)) state.matchFilter = s.matchFilter;
      else if (s.played === false) state.matchFilter = "upcoming"; // migrera gammal boolean
      if (s.filterLocked) state.filterLocked = true;
    } catch { /* trasig state: kör default */ }
    normalizeStatsView();
  }

  // --- datainläsning --------------------------------------------------------

  function refreshTtl(matches) {
    // Hur gammal data vi accepterar utan omhämtning:
    // avslutad cup ändras aldrig; framtida cuper justeras sällan;
    // pågående cuper live-uppdateras.
    if (!matches.length) return 0;
    const now = Date.now();
    const first = matches[0].start;
    const last = matches[matches.length - 1].start;
    if (now > last + 24 * 3600000) return Infinity;   // färdigspelad
    if (now < first - 24 * 3600000) return 6 * 3600000; // framtida
    return 60000;                                      // pågår
  }

  // Är ALLA matcher i listan klara (har ett slutgiltigt resultat)? Styr om
  // gruppställningar/slutspelsträd (ensureTable/ensurePlayoffs/
  // ensureGroupTables nedan) kan cachas i localStorage för evigt — samma
  // "avslutad = ändras aldrig"-tanke som refreshTtl() ovan, fast per
  // division/kategori i stället för för hela cupen (de hämtas ju var för
  // sig, inte i samma anrop som schemat).
  function allMatchesFinished(list) {
    return list.length > 0 && list.every((m) => m.res && m.res.fin);
  }

  function loadWeather() {
    const c = cup();
    HB.weather.fetchForecast(c).then(() => {
      if (state.cupId === c.id) renderContent();
    });
  }

  // Antal matcher hämtade hittills av den pågående fetchMatches()-anropet
  // — visas i verktygsradens metatext så en flerasekunders hämtning för en
  // stor cup känns aktiv i stället för att se ut som att sidan hängt sig.
  let loadProgress = 0;

  // Sidan visar alltid den sparade cachen direkt (kan vara flera timmar
  // gammal) och synkar sedan i bakgrunden — men NU-linjens auto-skroll
  // (autoScrolledToNow) får bara köra EN gång per sidladdning, annars
  // skulle en periodisk bakgrundssync rycka undan mattan för användaren
  // varje gång. Problemet: om den FÖRSTA synken (rätt efter cachen visats)
  // faktiskt ändrar layouten (nya matcher, ändrade tider) hamnar den redan
  // gjorda skrollningen fel utan att rättas till. Lösning: tillåt EN extra
  // auto-skroll specifikt efter den allra första lyckade bakgrundssynken —
  // därefter (periodiska uppdateringar, manuell "Uppdatera") rör vi inte
  // scrollpositionen igen.
  let hasSyncedFreshData = false;

  async function loadCup(force) {
    const c = cup();
    if (!c) return;
    loadWeather(); // oberoende av matchdata — hämtas parallellt
    // Förhämtade cuper (dataUrl) läses alltid färskt — filen ligger lokalt.
    const cached = c.dataUrl ? null : HB.api.readCache(c);
    if (cached && cached.matches) {
      state.matches = cached.matches;
      state.loadedAt = cached.ts;
      // Karta-vyns klubbadresser hänger med i samma cache-post (se
      // writeCache i api.js) — utan den här raden skulle kartan vara tom
      // tills nästa live-/inkrementella hämtning råkar skriva över den.
      // ÄLDRE cache-poster (skrivna innan clubs-fältet infördes) saknar
      // den helt — sätt då INTE clubGeo till {} (ensureCupClubGeo ser en
      // redan satt, om än tom, post som "redan känt" och hämtar aldrig om,
      // så Karta-fliken skulle permanent se ut att sakna data tills cachen
      // en dag naturligt förnyas). Lämna clubGeo osatt i stället, så
      // ensureCupClubGeo hämtar riktig geodata från snapshotten.
      //
      // mapCupAllClubs/mapCupStatus sätts HÄR också (inte bara i
      // ensureCupClubGeo:s done()) — annars vinner detta snabbare, direkta
      // cache-läsvägen alltid racet mot ensureCupClubGeo:s egen (senare
      // startade) hämtning, vars guard (if HB.api.clubGeo[cupId] ...)
      // redan ser clubGeo som satt och hoppar över hela sin done()-körning
      // — så mapCupAllClubs för INNEVARANDE cup skulle aldrig fyllas i,
      // vilket visar sig som "0 klubbar totalt" i Karta trots att adresser
      // faktiskt finns (entries/merged byggs direkt ur HB.api.clubGeo, som
      // ANDRA halvan av paret, och blir därför inte tomt).
      // Bana-vyns adressdata, samma resonemang som clubs ovan: äldre
      // cache-poster (skrivna innan arenas-fältet infördes) saknar den, och
      // ska då lämna arenaGeo osatt så snapshot-vägen nedan kan fylla den.
      if (cached.arenas) HB.api.arenaGeo[c.id] = cached.arenas;
      if (cached.clubs) {
        HB.api.clubGeo[c.id] = cached.clubs;
        state.mapCupAllClubs[c.id] = allClubNamesFromMatches(cached.matches);
        state.mapCupCountryByClub[c.id] = clubCountryFromMatches(cached.matches);
        const tc = teamsAndClassesFromMatches(cached.matches);
        state.mapCupTeamCount[c.id] = tc.teamCount;
        state.mapCupClasses[c.id] = tc.classes;
        state.mapCupStatus[c.id] = "done";
      }
    } else if (!c.dataUrl) {
      // Ingen lokal cache: starta från CI-byggd snapshot i repot,
      // så att förstabesöket slipper vänta på cupmanager-API:t.
      try {
        const r = await fetch("data/snapshot-" + c.id + ".json?_=" +
          Date.now().toString(36));
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.matches) && j.matches.length) {
            state.matches = j.matches;
            state.loadedAt = j.ts || 0;
            HB.api.clubGeo[c.id] = j.clubs || {};
            if (j.arenas) HB.api.arenaGeo[c.id] = j.arenas;
            state.mapCupAllClubs[c.id] = allClubNamesFromMatches(j.matches);
            state.mapCupCountryByClub[c.id] = clubCountryFromMatches(j.matches);
            const tc = teamsAndClassesFromMatches(j.matches);
            state.mapCupTeamCount[c.id] = tc.teamCount;
            state.mapCupClasses[c.id] = tc.classes;
            state.mapCupStatus[c.id] = "done";
            HB.api.writeCache(c, j.matches, j.ts);
          }
        }
      } catch { /* ingen snapshot — hämta från API:t nedan */ }
    }
    const fresh = state.matches.length &&
      Date.now() - state.loadedAt < refreshTtl(state.matches);
    if (fresh && !force) { render(); return; }

    state.loading = true;
    state.error = null;
    loadProgress = 0;
    render();
    try {
      // De flesta matcherna i en cup är redan avgjorda och kan aldrig
      // ändras — har vi redan en cache att bygga vidare på, försök bara
      // hämta om de OSPELADE matcherna (mycket snabbare) i stället för
      // att alltid slå om hela MatchWindow-fönstret. fetchIncremental()
      // ger null om det inte lönar sig (för många ospelade, eller ProCup
      // som saknar stöd) — då faller vi tillbaka på den fulla hämtningen.
      let matches = null;
      if (state.matches.length) {
        matches = await HB.api.fetchIncremental(c, state.matches, (done, total) => {
          loadProgress = done + "/" + total + " ospelade";
          renderMeta();
        });
      }
      if (!matches) {
        matches = await HB.api.fetchMatches(c, (n) => {
          loadProgress = n + "+";
          const el = $("#loadNote");
          if (el) el.textContent = "Hämtar schema … " + n + "+ matcher";
          // Live-uppdatera "hämtar nytt …"-texten även vid en
          // bakgrundsuppdatering (befintlig data ligger redan kvar på
          // skärmen, #loadNote finns då inte) — annars ser en flera
          // sekunder lång hämtning av en stor cup ut som att sidan hängt
          // sig i stället för att faktiskt jobba.
          renderMeta();
        });
      }
      state.matches = matches;
      state.loadedAt = Date.now();
      if (!c.dataUrl) HB.api.writeCache(c, matches);
      if (!hasSyncedFreshData) {
        hasSyncedFreshData = true;
        autoScrolledToNow = false; // en chans att rätta till en skroll som blev fel mot cachens gamla data
      }
    } catch (e) {
      state.error = "Kunde inte hämta schemat från " + c.host +
        ". Kontrollera nätet och försök igen.";
      console.error(e);
    }
    state.loading = false;
    render();
  }

  function switchCup(id) {
    if (id === state.cupId) return;
    state.cupId = id;
    state.tables = {};
    state.playoffs = {};
    state.groupTables = {};
    dialogTableCache = {};
    state.matches = [];
    state.loadedAt = 0;
    heroIndex = 0;
    stashedFilter = null;
    autoScrolledToNow = false;
    hasSyncedFreshData = false;
    loadUi();
    saveUi();
    loadCup();
    const dlg = $("#settingsDialog");
    if (dlg && dlg.open) dlg.close();
  }

  // --- härledningar ------------------------------------------------------

  // Tillgängliga tidigare upplagor (år) för INNEVARANDE cup, ur det
  // statiska arkivindexet (samma data/archive/index.json som Historik-
  // modalen använder) — populerar årsväljaren i verktygsraden. Innevarande
  // (live) upplaga filtreras bort här: den ingår redan alltid i
  // allActiveMatches() utan att behöva kryssas i.
  function ensureArchiveEditions() {
    const cupId = state.cupId;
    if (state.archiveEditions[cupId]) return;
    state.archiveEditions[cupId] = { status: "loading", editions: [] };
    HB.api.fetchArchiveIndex().then((idx) => {
      const entry = idx[cupId];
      const editions = ((entry && entry.editions) || [])
        .map((e) => e.edition)
        .filter((e) => e !== cup().edition)
        .sort((a, b) => b.localeCompare(a, "sv", { numeric: true }));
      state.archiveEditions[cupId] = { status: "done", editions };
      render();
    }).catch(() => {
      state.archiveEditions[cupId] = { status: "done", editions: [] };
      render();
    });
  }

  // Hämtar en hel arkiverad upplagas matcher (en gång, cachas i minnet för
  // sessionen) när den kryssas i årsväljaren. Nyckeln inkluderar cupId —
  // annars skulle t.ex. "2024" för två olika cuper krocka i samma cache.
  // Varje match stämplas med .edition så Schema/Tabeller/Slutspel kan
  // visa/gruppera per år och skilja arkiverade divisioner/kategorier
  // (som måste räknas fram lokalt, se ensureTable/ensurePlayoffs) från
  // innevarande års live-hämtade (odefinierad .edition = live).
  //
  // cupId (valfri, förval = innevarande cup): Klubb/Lag-flikens klubb-över-
  // cuper-lista (computeClubRows) och Trend-jämförelsegrafens klassfilter
  // behöver hämta arkiverade år för ANDRA cuper än den just nu aktiva —
  // samma cache (state.yearMatches) återanvänds rakt av eftersom nyckeln
  // redan är cupId-prefixad.
  function ensureYearMatches(edition, cupId) {
    cupId = cupId || state.cupId;
    const key = cupId + ":" + edition;
    if (state.yearMatches[key]) return;
    state.yearMatches[key] = { status: "loading", matches: [] };
    HB.api.fetchArchiveEdition(cupId, edition).then((data) => {
      const matches = ((data && data.matches) || []).map((m) => ({ ...m, edition }));
      state.yearMatches[key] = { status: "done", matches };
      state.yearRosters[key] = (data && data.rosters) || {};
      render();
    }).catch(() => {
      state.yearMatches[key] = { status: "error", matches: [] };
      render();
    });
  }

  // Truppdata för ETT lag — antingen innevarande år (via HB.api.fetchRoster,
  // ur den redan hämtade dataUrl-filen) eller ett arkiverat år (ur
  // state.yearRosters, se ensureYearMatches). `edition` kommer från
  // matchens .edition-fält (odefinierad = innevarande år, se allActiveMatches).
  function rosterFor(team, edition) {
    if (!cup().hasRosters) return [];
    if (!edition) return HB.api.fetchRoster(cup(), team.id);
    const yr = state.yearRosters[state.cupId + ":" + edition];
    return (yr && yr[team.id]) || [];
  }

  // Innevarande års live-matcher (state.matches) PLUS matcherna från varje
  // extra år som kryssats i årsväljaren (state.years) — den kombinerade
  // pool som scoped()/filtered()/divisionsToShow()/categoriesToShow() alla
  // arbetar vidare på. Match-/kategori-/lag-ID:n krockar aldrig mellan år
  // (verifierat mot faktisk arkivdata — Cup Manager delar ut nya ID:n varje
  // upplaga), så poolen kan bara slås ihop rakt av utan omskrivning.
  function allActiveMatches() {
    const base = state.includeCurrentYear ? state.matches : [];
    if (!state.years.size) return base;
    const extra = [];
    for (const edition of state.years) {
      const ym = state.yearMatches[state.cupId + ":" + edition];
      if (ym && ym.status === "done") extra.push(...ym.matches);
    }
    return extra.length ? base.concat(extra) : base;
  }

  function scoped() {
    const pool = allActiveMatches();
    return state.scope === "club" ? pool.filter(isClubMatch) : pool;
  }

  // Har användaren gjort ett AKTIVT val av klass(er), lag och/eller en
  // fritextsökning? Styr om Schema/Tabeller/Slutspel visar sitt fulla
  // innehåll — annars skulle appen by default rendera samtliga klasser/
  // lag/tabeller/slutspelsträd för hela klubben (eller hela cupen), vilket
  // är onödigt tungt och sällan det man faktiskt vill se. Bana-fliken har
  // redan sin egen motsvarande spärr (kräver en vald bana) och Hero-kortet
  // (nästa match) är en lättviktig teaser som ska synas oavsett — bara de
  // fulla listorna/tabellerna spärras. Fritextsökningen räknades tidigare
  // INTE som ett aktivt val här — man kunde skriva ett lagnamn i sökrutan
  // utan att kryssa någon klass/lag och bara få tomt/"välj klass"-meddelan-
  // det tillbaka, trots träffar.
  // Spärren finns för att Schema/Tabeller/Slutspel annars skulle rendera
  // HELA cupen som förval — tusentals matcher man sällan vill se på en gång.
  // Den ska alltså fånga "har användaren smalnat av tillräckligt", inte
  // "har användaren valt just en klass".
  //
  // En vald PLAN räknas därför också: en hall är i praktiken ett par dussin
  // matcher (Örebrocupens största har 37 av 416), alltså minst lika smalt
  // som en klass. Det är dessutom precis det urval en hallansvarig vill ha —
  // cup, dag och hall, utan att bry sig om vilka klasser som spelar där.
  //
  // Dagar räknas INTE på egen hand: en enskild dag kan vara hela cupen i en
  // helgcup, och Åhus har 600+ matcher per speldag. Dag SMALNAR AV ett
  // hallval, men duger inte som enda avgränsning.
  //
  // Tabeller och Slutspel delar spärren men har ingen planväljare, så för dem
  // är villkoret oförändrat i praktiken.
  function hasFilterSelection() {
    return state.cats.size > 0 || state.teams.size > 0 ||
      !!state.arena || !!state.q.trim();
  }

  // Boolesk fritextsökning, delad av alla sökrutor (huvudsökrutan och
  // klass/lag/år-väljarnas sökfält): "&" = OCH (alla termer i en grupp
  // måste matcha), "/" eller "," = ELLER (någon grupp räcker). Ex:
  // "2011&flickor/2013" matchar allt som innehåller ("2011" OCH "flickor")
  // ELLER "2013".
  function matchesBooleanQuery(haystack, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const orGroups = q.split(/[/,]/).map((g) => g.trim()).filter(Boolean);
    if (!orGroups.length) return true;
    return orGroups.some((group) =>
      group.split("&").map((t) => t.trim()).filter(Boolean).every((t) => haystack.includes(t)));
  }

  // Matchar en match mot fritextsökningen (lag, plan, klass, grupp, omgång)
  // — delad av filtered() (Schema/Bana) och Tabeller/Slutspels egna
  // urvalsfunktioner (divisionsToShow/categoriesToShow) så att sökrutan
  // beter sig likadant i alla flikar i stället för att bara fungera i
  // Schema, trots att den syns i verktygsraden överallt.
  function matchesSearchQuery(m) {
    if (!state.q.trim()) return true;
    const hay = (m.home.name + " " + m.away.name + " " + m.arena + " " +
      m.catName + " " + m.divName + " " + m.roundName).toLowerCase();
    return matchesBooleanQuery(hay, state.q);
  }

  // Ett gemensamt "vy-filter" (viewCats/viewTeams) — se state ovan.
  // isFilterLocked() delas mellan renderToolbar (som bygger låsknappen)
  // och Schema/Tabeller/Slutspel (som avgör om vy-filterraden ska visas).
  function hasLockableSelection() {
    return state.days.size > 0 || state.cats.size > 0 || state.teams.size > 0 ||
      state.years.size > 0 || !state.includeCurrentYear;
  }
  // Låset skyddar en ALLTID SYNLIG verktygsrad från feltryck under en cupdag.
  // I mobilens ark ligger filtren tre medvetna tryck bort (Filter -> väljare
  // -> kryssruta), så skyddet köper ingenting där — det gjorde bara att
  // klass-/lag-/årsväljarna försvann utan att det var uppenbart varför.
  // Gäller alltså bara över 700 px, där raden fortfarande står framme.
  //
  // state.filterLocked NOLLSTÄLLS inte: låser man på datorn och sedan öppnar
  // telefonen ska urvalet vara detsamma, bara redigerbart. Skyddet är det
  // enda som skiljer.
  function isFilterLocked() {
    return !sheetMode() && state.filterLocked && hasLockableSelection();
  }

  function matchesViewFilter(m) {
    if (state.viewCats.size && !state.viewCats.has(m.catId)) return false;
    if (state.viewTeams.size &&
        !state.viewTeams.has(m.home.id) && !state.viewTeams.has(m.away.id)) return false;
    return true;
  }

  // Kandidater för vy-filtrets klass-/lagväljare: allt inom bas-filtret
  // (scope+dagar+bas-klasser+bas-lag) — INTE fritextsök/plan/matchstatus,
  // de är Schema-specifika och ska inte påverka vad Tabeller/Slutspel
  // erbjuder att bläddra bland.
  function viewFilterCandidates() {
    const base = scoped().filter((m) => {
      if (state.days.size && !state.days.has(dayKey(m.start))) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      return true;
    });
    const catMap = new Map();
    const teamMap = new Map();
    for (const m of base) {
      if (m.catId) catMap.set(m.catId, m.catName);
      for (const side of [m.home, m.away]) {
        if (side.id && !teamMap.has(side.id)) {
          teamMap.set(side.id, {
            id: side.id, name: side.name, suffix: teamSuffix(side.name),
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    const catEntries = [...catMap.entries()].sort((a, b) =>
      catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));
    const teams = [...teamMap.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) || a.suffix.localeCompare(b.suffix, "sv"));
    return { catEntries, teams };
  }

  // Vy-filterraden: klass- och lagväljare (samma sök-/sorterbara
  // dropdown-komponent som verktygsradens, se buildPicker) som fyller det
  // tomrum som uppstår i Schema/Tabeller/Slutspel när bas-filtret är låst
  // och verktygsradens egna klass-/lagväljare därför göms bort — så man
  // kan bläddra inom sitt låsta urval utan att låsa upp det. Bara synlig
  // när bas-filtret faktiskt är låst OCH det finns mer än en klass/ett lag
  // att välja bland — annars gör verktygsradens egna, redan synliga
  // pickers exakt samma jobb, och en andra uppsättning skulle bara vara en
  // förvirrande dubblett. Lagkandidaterna smalnas av av vald(a) vy-klass(er)
  // (samma nivå1/nivå2-mönster som verktygsradens bas-pickers) — annars
  // skulle t.ex. en F12-klubb dyka upp i lagvalet trots att vyn redan
  // smalnats till F13, en garanterad återvändsgränd (noll träffar).
  //
  // Byggs och lever i renderToolbar (INTE i respektive vy) trots att den
  // logiskt hör till Schema/Tabeller/Slutspel — renderContent() (som
  // uppdaterar själva matchlistan/tabellerna/trädet när valet ändras)
  // bygger om HELA huvudinnehållet, vilket skulle stänga en öppen
  // dropdown om den låg där. I verktygsraden, som bara render() bygger
  // om, kan pickerns egen <details> hållas vid liv över ändringar precis
  // som bas-filtrets klass-/lagväljare gör.
  function buildViewFilterRow() {
    if (!isFilterLocked() || state.view === "bana") return null;
    const { catEntries, teams: allTeams } = viewFilterCandidates();
    if (catEntries.length <= 1 && allTeams.length <= 1) return null;

    const teamSlot = h("span", { style: "display:contents" });
    const refreshViewTeamSlot = () => {
      const teams = state.viewCats.size
        ? allTeams.filter((t) => state.viewCats.has(t.catId))
        : allTeams;
      teamSlot.replaceChildren(...(teams.length > 1 ? [buildPicker({
        items: teams.map((t) => ({
          id: t.id, label: HB.shortCat(t.catName) + " " + t.suffix,
          sortKey: catSortKey(t.catName), sortName: t.suffix,
        })),
        selected: state.viewTeams,
        emptyLabel: "Visa: alla lag",
        countLabel: (n) => "Visar " + n + " lag",
        searchPlaceholder: "Sök lag …",
        onChange: renderContent,
      })] : []));
    };

    const row = h("div", { class: "row" });
    if (catEntries.length > 1) {
      row.append(buildPicker({
        items: catEntries.map(([id, name]) => ({
          id, label: name, sortKey: catSortKey(name), sortName: name,
        })),
        selected: state.viewCats,
        emptyLabel: "Visa: alla klasser",
        countLabel: (n) => n === 1 ? "Visar 1 klass" : "Visar " + n + " klasser",
        searchPlaceholder: "Sök klass …",
        genderQuickSelect: true,
        onChange: () => { renderContent(); refreshViewTeamSlot(); },
      }));
    }
    refreshViewTeamSlot();
    row.append(teamSlot);
    return row;
  }

  function clubTeams() {
    const map = new Map();
    // allActiveMatches() (inte state.matches direkt) — annars skulle
    // klubbens lagväljare fortsätta visa INNEVARANDE års lag även när man
    // stängt av det (state.includeCurrentYear) och bara tittar på tidigare
    // år, vilket hade räknat upp lag som inte ens spelar i den valda vyn.
    for (const m of allActiveMatches()) {
      for (const side of [m.home, m.away]) {
        if (side.id && isClubName(side.name) && !map.has(side.id)) {
          map.set(side.id, {
            id: side.id, name: side.name, suffix: teamSuffix(side.name),
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) ||
      a.suffix.localeCompare(b.suffix, "sv"));
  }

  // Alla lag (oavsett klubb) inom nuvarande scope — clubTeams() räcker
  // inte i "Hela cupen"-läge, där lagväljarens nivå 2 (se renderToolbar)
  // ska kunna smalna av bland SAMTLIGA lag i cupen, inte bara egna klubbens.
  function allScopedTeams() {
    const map = new Map();
    for (const m of scoped()) {
      for (const side of [m.home, m.away]) {
        if (side.id && !map.has(side.id)) {
          map.set(side.id, {
            id: side.id, name: side.name,
            // HELA namnet, inte teamSuffix(): den strippar favoritklubbens
            // namn, vilket är rätt i klubbläget (där ALLA lag är dina, så
            // prefixet bara upprepas) men fel här. I "Hela cupen" stod
            // andra klubbars lag med fullt namn medan dina egna dök upp som
            // bara "F13 Blå" — omöjliga att hitta för den som letar efter
            // "Alingsås HK", och sorterade dessutom under B i stället för A.
            suffix: side.name,
            catName: m.catName, catId: m.catId,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      catSortKey(a.catName) - catSortKey(b.catName) ||
      a.suffix.localeCompare(b.suffix, "sv"));
  }

  // Kandidater för favoritklubb-autocomplete.
  //
  // Favoritklubben är en egenskap hos ANVÄNDAREN, inte hos den cup som
  // råkar vara vald — men listan byggdes förr enbart ur state.matches, den
  // öppna cupens matcher. Det gav två fel: en cup där ens klubb inte är
  // med i år (eller som ännu inte publicerat något, t.ex. Örebrocupen med
  // 0 matcher) erbjöd inte klubben alls, och ett ospelat slutspelsträd
  // fyllde listan med platshållare ("1:an i Grupp A", "Vinn.").
  //
  // Nu är klubbkatalogen (data/club-directory.json, alla klubbar från alla
  // cuper och år) grundkällan, med den öppna cupens egna namn ovanpå —
  // klubbar stavas olika i olika cuper ("AHK" vs "Alingsås HK") och en
  // alldeles ny klubb hinner inte in i katalogen förrän den byggts om.
  function clubNameCandidates() {
    const set = new Set(Object.keys(clubDirectoryCache || {}));
    for (const m of state.matches) {
      for (const side of [m.home, m.away]) {
        const name = (side.name || "").trim();
        if (!name || isPlaceholderTeam(side)) continue;
        if (side.club) set.add(side.club);
        set.add(name);
        const words = name.split(/\s+/);
        if (words.length > 1) set.add(words.slice(0, -1).join(" "));
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "sv"));
  }

  // Kandidater för favoritlag-autocomplete.
  //
  // Ett lagnamn ensamt duger inte som val: "Alingsås HK 1" finns samtidigt i
  // F16, P16 och Herrjunior. Varje förslag bär därför sin ÅRSKULL och visas
  // som "Alingsås HK 1 (Flickor 2011)", sökbart på både namnet och kullen
  // ("f2011"). Ordningen är medveten: lagen ur cupernas INNEVARANDE upplagor
  // först — det är dem man vill följa nu — och de äldre namnen ur arkivet
  // sist, som en möjlighet att stjärnmärka ett lag man mött förr.
  //
  // Klassen finns bara i matchdatan, inte i lagnamnsindexet, så de arkiverade
  // namnen saknar årskull (cohort null) och matchar då på namnet allena.
  function favoriteTeamCandidates() {
    const club = (state.favoriteClub || "").trim().toLowerCase();
    const seen = new Set();
    const out = [];
    const add = (name, catName) => {
      const n = (name || "").trim();
      if (!n || isPlaceholderTeam({ name: n })) return;
      if (club && !n.toLowerCase().startsWith(club)) return;
      const cohort = cohortKey(catName);
      const key = favoriteTeamKey(n, cohort);
      if (seen.has(key)) return;
      seen.add(key);
      const kull = cohort ? cohortLabel(catName) : (catName || "").trim();
      out.push({
        label: n + (kull ? " (" + kull + ")" : ""),
        // sök­texten rymmer både kortformen (F2011) och den skrivna
        // ("Flickor 2011"), så båda skrivsätten hittar laget
        search: [n, cohort, kull, HB.shortCat(catName || "")].filter(Boolean).join(" "),
        value: { name: n, cohort },
      });
    };
    // Innevarande upplaga: klubbens lag med sin klass
    for (const m of state.matches) {
      for (const side of [m.home, m.away]) add(side.name, m.catName);
    }
    // Alla andra cupers lagnamn ur arkivets index (ingen klass tillgänglig)
    for (const byEdition of Object.values(state.teamIndex || {})) {
      for (const names of Object.values(byEdition || {})) {
        for (const name of names || []) add(name, null);
      }
    }
    return out;
  }

  // Valda favoritlag som borttagbara chips under sökfältet. Ritas om av
  // både inställningsfältet och stjärnknappen i lagrutan, så de två vägarna
  // in alltid visar samma lista.
  function renderFavoriteTeamList() {
    const box = $("#favoriteTeamList");
    if (!box) return;
    if (!state.favoriteTeams.length) {
      box.replaceChildren(h("span", { class: "muted" }, "Inga favoritlag valda."));
      return;
    }
    box.replaceChildren(...state.favoriteTeams.map((f, i) =>
      h("span", { class: "fav-team-chip" },
        f.name,
        f.cohort ? h("span", { class: "fav-team-cohort" }, " " + f.cohort) : null,
        h("button", {
          class: "fav-team-remove", type: "button",
          "aria-label": "Ta bort " + f.name + " ur favoritlagen",
          title: "Ta bort",
          onclick: () => {
            state.favoriteTeams.splice(i, 1);
            saveSettings();
            renderFavoriteTeamList();
            render();
          },
        }, "×"))));
  }

  // arenaOverride: Bana-fliken har sin EGEN banväljare (state.viewArena,
  // medvetet frikopplad från verktygsradens "Alla planer"-filter, se
  // renderArenaView) men ska annars lyda under exakt samma filter som
  // schemat (klubb/hela cupen, dagar, klasser, egna lag, matchstatus,
  // fritextsök) — annars "renderar"/beter den fliken sig annorlunda än
  // resten av appen trots att verktygsraden ser likadan ut överallt.
  function filtered(arenaOverride) {
    const arena = arenaOverride !== undefined ? arenaOverride : state.arena;
    return scoped().filter((m) => {
      if (state.days.size && !state.days.has(dayKey(m.start))) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (arena && m.arena !== arena) return false;
      if (state.matchFilter === "upcoming" && m.res && m.res.fin) return false;
      if (state.matchFilter === "played" && !(m.res && m.res.fin)) return false;
      if (!matchesSearchQuery(m)) return false;
      return true;
    });
  }

  function sorted(list) {
    const bySort = {
      tid: (a, b) => a.start - b.start || a.arena.localeCompare(b.arena, "sv"),
      klass: (a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
        a.catName.localeCompare(b.catName, "sv") ||
        a.divName.localeCompare(b.divName, "sv") || a.start - b.start,
      plan: (a, b) => a.arena.localeCompare(b.arena, "sv", { numeric: true }) ||
        a.start - b.start,
      resultat: (a, b) => outcomeRank(a) - outcomeRank(b) || a.start - b.start,
      mal: (a, b) => totalGoals(b) - totalGoals(a) || a.start - b.start,
    };
    return [...list].sort(bySort[state.sort] || bySort.tid);
  }

  // --- DOM-byggare -----------------------------------------------------------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  function chip(label, active, onClick, cls) {
    return h("button", {
      class: "chip" + (active ? " on" : "") + (cls ? " " + cls : ""),
      type: "button", "aria-pressed": String(!!active), onclick: onClick,
    }, label);
  }

  // Slår in ett text-/sökfält i en wrapper med en ×-knapp som rensar det —
  // återanvänds för alla sök-/filterfält i appen i stället för att förlita
  // sig på webbläsarens inbyggda (bara Chrome/Safari, olika utseende,
  // saknas helt i Firefox) rensa-knapp för type="search". Knappen syns
  // bara när fältet faktiskt har ett värde (CSS :placeholder-shown, kräver
  // att inputen har en placeholder). Skickar ett riktigt "input"-event vid
  // rensning så befintliga lyssnare/filter reagerar som om användaren
  // själv raderat texten — onClear (valfritt) för extra städning
  // (t.ex. att stänga en öppen autocomplete-lista).
  function withClearButton(input, onClear) {
    return h("div", { class: "search-wrap" }, input,
      h("button", {
        class: "search-clear", type: "button", "aria-label": "Rensa",
        tabindex: "-1",
        onclick: () => {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
          if (onClear) onClear();
        },
      }, "×"));
  }

  // --- render: toppnivå ----------------------------------------------------

  function render() {
    renderCups();
    renderTabs();
    renderMeta();
    renderToolbar();
    renderContent();
  }

  // Ritar bara matchlistan/tabellerna. Används av allt som inte ska rubba
  // verktygsraden — fritextsökning och bakgrundsuppdateringar — så att
  // fokus i sökfältet (och en öppen lag-dropdown) inte går förlorat.
  //
  // Synkar också URL:en. Underflikarnas egna val (Vinnare-läge, Klubb/Lag-
  // sökningen, Kartans år …) ligger utanför saveUi():s per-cup-filter och
  // deras klickhanterare anropar bara renderContent() — utan den här
  // synken hamnade inget av det i adressfältet. Görs EFTER kroppen: flera
  // underflikar sätter sina defaults lat vid första ritningen (troféskåpets
  // klubb = favoritklubben, Kalenderns år = innevarande), och en synk före
  // hade missat dem. syncUrl() hoppar över identiska URL:er, så de många
  // "onödiga" anropen (bakgrundsuppdateringar) kostar ingenting.
  function renderContent() {
    renderContentBody();
    renderMobileContextBar();
    reconcilePickerChrome();
    syncUrl();
  }

  // Klassnamn ur ett kategori-id, för orienteringsraden nedan.
  function catNameById(id) {
    const m = allActiveMatches().find((x) => x.catId === id);
    return m ? HB.shortCat(m.catName) : null;
  }

  // Vad vyn är avsmalnad till, i ord. Sammanfattar samma sak som
  // activeFilterCount räknar, men läsbart — "Alingsås HK Blå · P13" i
  // stället för en siffra.
  function filterSummaryText() {
    const bits = [];
    if (state.teams.size) {
      const namn = [...state.teams].map(teamNameById).filter(Boolean);
      bits.push(namn.length && namn.length <= 2 ? namn.join(", ") : state.teams.size + " lag");
    }
    if (state.cats.size) {
      const namn = [...state.cats].map(catNameById).filter(Boolean);
      bits.push(namn.length && namn.length <= 2 ? namn.join(", ") : state.cats.size + " klasser");
    }
    if (state.arena) bits.push(state.arena);
    if (state.days.size) bits.push(state.days.size + (state.days.size === 1 ? " dag" : " dagar"));
    if (state.q) bits.push("\u201d" + state.q + "\u201d");
    if (state.matchFilter !== "all") {
      bits.push(state.matchFilter === "upcoming" ? "kommande" : "spelade");
    }
    return bits.join(" · ");
  }

  // Orienteringsrad överst i innehållet, BARA på mobil. Klick på hall, lag
  // eller grupp i ett matchkort byter tyst ut hela filtret (gotoTeamMatches
  // m.fl.) — på dator ser man det direkt i verktygsraden, som dessutom har
  // en "Tillbaka till din vy"-chip. På mobil ligger den raden gömd bakom
  // Filter-knappen, så man landade i en avsmalnad vy utan att se varför
  // eller hur man tog sig ur den.
  function renderMobileContextBar() {
    const main = $("#content");
    const gammal = main.querySelector(":scope > .mobile-context");
    if (gammal) gammal.remove();
    if (!sheetMode() || state.view === "stats") return;
    const text = filterSummaryText();
    if (!stashedFilter && !text) return;
    main.prepend(h("div", { class: "mobile-context" },
      stashedFilter ? h("button", {
        class: "mobile-context-back", type: "button",
        onclick: () => restoreStashedFilter(),
      }, "\u2190 Tillbaka") : null,
      h("span", { class: "mobile-context-text" }, text || "Filtrerad vy"),
      text ? h("button", {
        class: "mobile-context-clear", type: "button", "aria-label": "Rensa filtret",
        onclick: () => {
          state.days.clear(); state.cats.clear(); state.teams.clear(); state.years.clear();
          state.includeCurrentYear = true;
          state.viewCats = new Set(); state.viewTeams = new Set();
          state.arena = ""; state.q = ""; state.matchFilter = "all";
          state.schemaOlderRevealCount = 0;
          saveUi(); render();
        },
      }, "\u2715") : null));
  }

  function renderContentBody() {
    const main = $("#content");
    main.replaceChildren();
    // Städa en eventuell övergiven kartinstans så fort vi INTE ska rita
    // Karta just nu — se destroyMapIfLeavingKarta()s kommentar för varför
    // (misstänkt Chrome-specifik scrollåsning på HELT andra flikar).
    if (!(state.view === "stats" && state.statsView === "karta")) destroyMapIfLeavingKarta();
    // Samma sak för Bana-vyns egen kartinstans (se createArenaMap) — den
    // rivs så fort vi INTE ritar Bana, annars ligger en osynlig MapLibre-
    // instans kvar och äter minne/WebGL-kontext på alla andra flikar.
    if (state.view !== "bana") destroyArenaMap();
    // Stats (Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper) bygger uteslutande
    // på det arkiverade data/archive/index.json (plus klubbadresser för
    // Karta) — beror INTE på om innevarande upplaga hunnit publicera ett
    // schema än, så den måste renderas innan bannern nedan ("inget schema
    // publicerat") annars skulle blockera den i onödan.
    if (state.view === "stats") { renderStatsView(main); return; }
    if (state.error) {
      main.append(h("div", { class: "banner error" },
        h("p", null, state.error),
        h("button", { class: "btn", type: "button", onclick: () => loadCup(true) },
          "Försök igen")));
    }
    if (state.loading && !state.matches.length) {
      main.append(h("div", { class: "banner", id: "loadNote" }, "Hämtar schema …"));
      return;
    }
    // allActiveMatches() (inte bara state.matches) — en cup vars LIVE-
    // upplaga saknar publicerat schema kan ändå ha arkiverade tidigare år
    // ikryssade i årsväljaren (se renderToolbar); bannern ska bara visas
    // om det inte finns NÅGOT att visa alls, inte bara att just innevarande
    // upplaga råkar sakna schema än.
    if (!allActiveMatches().length && !state.loading && !state.error) {
      // Rutan sa tidigare bara att schemat saknas, och Schema-fliken lade
      // dessutom sin egen "välj klass, lag eller plan under Filter" ovanpå —
      // en instruktion som pekar på en TOM filterremsa när cupen inte har
      // några matcher. Man följde den, ingenting hände, och appen såg trasig
      // ut. Nu står i stället när datan senast hämtades (så man ser att appen
      // fungerar och letat) plus en väg vidare till en annan cup. Gäller
      // alla flikar, inte bara Schema.
      const hamtad = state.loadedAt
        ? "Senast hämtat " + fmtDayLong.format(new Date(state.loadedAt)) +
          " " + fmtClock.format(new Date(state.loadedAt))
        : null;
      main.append(h("div", { class: "banner" },
        h("p", null, cup().name + " har inte publicerat något spelschema ännu."),
        hamtad ? h("p", { class: "muted" }, hamtad) : null,
        h("button", {
          class: "btn", type: "button",
          onclick: () => { toggleFilterSheet(false); $("#currentCupBtn").click(); },
        }, "Byt cup")));
      return;
    }
    if (state.view === "schema") renderSchema(main);
    else if (state.view === "slutspel") renderPlayoffs(main);
    else if (state.view === "bana") renderArenaView(main);
    else renderTables(main);
  }

  const SPORT_LABELS = { handboll: "Handboll", fotboll: "Fotboll" };

  // Vilken sport cupväljaren i inställningar just nu VISAR — skilt från
  // innevarande cups egen sport (state.cupId/cup().sport), så man kan bläddra
  // bland t.ex. fotbollscuper utan att först behöva byta aktiv cup. null =
  // följ innevarande cups sport (förvalet, nollställs varje gång dialogen
  // öppnas, se openSettings). Modulnivå, inte state — rent UI-tillstånd för
  // själva dialogen, inget att spara mellan besök.
  let cupSwitcherSport = null;

  function renderCups() {
    const allCups = HB.allCups();
    // En sportväljare bara om det faktiskt FINNS mer än en sport bland
    // cuperna — annars bara ett meningslöst extra klick för alla som bara
    // någonsin kör handboll.
    const sports = [...new Set(allCups.map((c) => c.sport || "handboll"))];
    const activeSport = cupSwitcherSport || cup().sport || "handboll";
    const sportToggleEl = $("#sportToggle");
    if (sportToggleEl) {
      sportToggleEl.hidden = sports.length < 2;
      sportToggleEl.replaceChildren(
        ...sports.map((sp) => chip(SPORT_LABELS[sp] || sp, sp === activeSport, () => {
          cupSwitcherSport = sp;
          renderCups();
        })));
    }

    const row = $("#cupRow");
    row.replaceChildren(
      ...allCups.filter((c) => (c.sport || "handboll") === activeSport).map((c) =>
        h("button", {
          class: "cup" + (c.id === state.cupId ? " on" : ""),
          type: "button", onclick: () => switchCup(c.id),
        },
          h("span", { class: "cup-name" }, c.name),
          h("span", { class: "cup-place" }, c.place + " " + c.edition))
      ));
    // Cupväljaren själv bor i inställningarna (för att inte ta plats högst
    // upp på sidan) — den här knappen i headern visar bara vilken cup som
    // är vald just nu och öppnar samma dialog för att byta.
    const btn = $("#currentCupBtn");
    if (btn) btn.textContent = cup().name;
  }

  function renderTabs() {
    // Slutspelsdata finns för Cup Manager-cuper och de dataUrl-cuper vars
    // skrapa faktiskt bygger en playoffs-struktur (cup.hasPlayoffs, se
    // scripts/fetch_gothia.py) — INTE ProCup (fetch_procup.py stödjer det
    // inte än).
    const playoffsSupported = !cup().dataUrl || !!cup().hasPlayoffs;
    if (!playoffsSupported && state.view === "slutspel") state.view = "schema";
    // Trend kräver minst två arkiverade år för INNEVARANDE cup (samma
    // tröskel som formkurvans "kan inte visas"-meddelande) — arkivindexet
    // laddas asynkront (se init()) och kan alltså vara null första gången
    // renderTabs() körs.
    const archiveEntry = state.archiveIndex && state.archiveIndex[state.cupId];
    const trendSupported = ((archiveEntry && archiveEntry.editions) || [])
      .filter((e) => e.matches > 0).length >= 2;
    // Karta kräver klubbadresser: klassiska Cup Manager-cuper har egen
    // sådan direkt, ProCup/Gothia-cuper gissar sin via klubbkatalogen (se
    // clubGeoFromMatches/ensureCupClubGeo) — båda vägarna är asynkrona
    // (till skillnad från tidigare då bara cup().dataUrl avgjorde direkt).
    // En cup vars INNEVARANDE upplaga ännu inte publicerat något (t.ex.
    // Lundaspelen inför en ny säsong — se samma resonemang i renderToolbar/
    // renderContent) kan ändå ha gott om arkiverad historik att visa via
    // Kartans årsväljare — räcker därför att ANTINGEN live-data ELLER minst
    // ett spelat arkiverat år finns, annars göms fliken helt i onödan trots
    // att det finns massor att titta på.
    ensureCupClubGeo(state.cupId);
    const mapKnown = state.mapCupStatus[state.cupId] === "done";
    const mapHasArchive = ((archiveEntry && archiveEntry.editions) || []).some((e) => e.matches > 0);
    const mapSupported = Object.keys(HB.api.clubGeo[state.cupId] || {}).length > 0 || mapHasArchive;
    // Klubb/Lag, Klubbjämförelse och Cuper kräver alla bara "NÅGON cup
    // NÅGONSTANS har minst ett spelat arkiverat år" — samma villkor,
    // eftersom alla tre bygger direkt på state.archiveIndex.
    const clubSupported = !!state.archiveIndex && Object.values(state.archiveIndex)
      .some((c) => (c.editions || []).some((e) => e.matches > 0));
    // Stats samlar Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper som under-
    // flikar (se STATS_TABS/renderStatsView) — sparas här så renderStatsView
    // slipper räkna om samma (delvis asynkrona) stöd själv. Fliken syns så
    // fort NÅGON underflik har stöd; själva underflikväxlingen/nedgraderingen
    // (om just den valda underfliken blir ogiltig) sköts av renderStatsView.
    state.statsSupport = {
      trend: trendSupported, karta: mapSupported,
      vinnare: clubSupported, kalender: clubSupported,
      klubb: clubSupported, klubbjamforelse: clubSupported, cuper: clubSupported,
      historik: clubSupported,
    };
    const statsSupported = trendSupported || mapSupported || clubSupported;
    // Vänta tills BÅDA de asynkrona källorna (archiveIndex, mapCupStatus)
    // svarat innan ett direktlänkat view=stats/underflik nollställs — samma
    // "vänta tills vi vet säkert"-resonemang som Trend/Karta hade var för sig
    // innan de slogs ihop. Klubbadressen (mapCupStatus) hinner ofta bli klar
    // FÖRE arkivindexet (litet cup-specifikt snapshot-anrop vs det stora
    // gemensamma index.json) — utan denna "known"-spärr skulle renderStatsView
    // annars kunna hinna se "bara Karta stödd än så länge" under en enda
    // mellanliggande omritning och permanent byta bort en direktlänkad/sparad
    // underflik till Karta i onödan (se dess kommentar).
    state.statsKnown = !!state.archiveIndex && mapKnown;
    if (state.statsKnown && !statsSupported && state.view === "stats") {
      state.view = "schema";
    }
    $$("#viewTabs .tab").forEach((b) => {
      const isPlayoffTab = b.dataset.view === "slutspel";
      const isStatsTab = b.dataset.view === "stats";
      b.hidden = (isPlayoffTab && !playoffsSupported) || (isStatsTab && !statsSupported);
      b.classList.toggle("on", b.dataset.view === state.view);
      b.setAttribute("aria-selected", String(b.dataset.view === state.view));
    });
    renderBottomBar();
  }

  // --- mobilens bottenrad --------------------------------------------------
  // På telefon tog sidhuvud + vyflikar + verktygsrad 374 px av 844 — 44 % av
  // skärmen innan första matchen. Bottenraden flyttar ner vyvalet (närmare
  // tummen) och ersätter hela verktygsraden med EN filterknapp som fäller
  // upp den som ett ark. Toppen får därmed tillbaka ~300 px.
  //
  // Raden SPEGLAR #viewTabs i stället för att äga sin egen fliklista: all
  // logik för vilka flikar som är stödda (slutspel/stats) bor kvar i
  // renderTabs, och kan inte hamna ur synk.
  const FILTER_ICON = "☰";
  const VIEW_ICONS = {
    schema: "📅", tabeller: "▦", slutspel: "🏆", bana: "📍", stats: "📈",
  };

  // Hur många filter som faktiskt smalnar av vyn just nu — siffran på
  // filterknappen, så man ser att ett filter är aktivt utan att öppna arket.
  // Sortering räknas INTE: den ändrar ordning, inte urval.
  function activeFilterCount() {
    let n = 0;
    // scope (Alingsås HK / Hela cupen) räknas INTE: det är ett läge, inte en
    // avsmalning, och syns alltid som en egen växel. Att räkna avvikelse från
    // förvalet gjorde dessutom att "Hela cupen" — det MINST filtrerade läget
    // — bidrog till siffran, vilket var precis bakvänt.
    n += state.days.size + state.cats.size + state.teams.size + state.years.size;
    if (!state.includeCurrentYear) n++;
    if (state.arena) n++;
    if (state.q) n++;
    if (state.matchFilter !== "all") n++;
    return n;
  }

  function renderBottomBar() {
    const bar = $("#bottomBar");
    if (!bar) return;
    // Stats har ingen verktygsrad (se renderToolbar) — då ska filterknappen
    // inte heller finnas, annars öppnar den ett tomt ark.
    // Stats har en EXTRA fast rad (underflikarna, se style.css) — innehållet
    // måste lämna plats för båda, annars göms sista raden bakom dem.
    document.body.classList.toggle("stats-tabs-fixed", state.view === "stats");
    placeFooterLinks();
    const showFilter = state.view !== "stats";
    const tabs = $$("#viewTabs .tab").filter((b) => !b.hidden);
    // .filter(Boolean): replaceChildren är DOM:ets egen metod och gör om ett
    // null till TEXTEN "null" (till skillnad från h(), som hoppar över det)
    // — det syntes som ordet "null" i bottenraden på Stats-fliken, där
    // filterknappen medvetet utelämnas.
    bar.replaceChildren(...[
      ...tabs.map((src) => h("button", {
        class: "bottom-tab" + (src.dataset.view === state.view ? " on" : ""),
        type: "button", "aria-selected": String(src.dataset.view === state.view),
        onclick: () => {
          // toggleFilterSheet (inte bara klassen): den tar även bort
          // bakgrundstäcket, som annars blev kvar och blockerade all
          // klickning efter ett vybyte med arket öppet.
          toggleFilterSheet(false);
          state.view = src.dataset.view; saveUi(); render();
        },
      },
        h("span", { class: "bottom-tab-icon", "aria-hidden": "true" },
          VIEW_ICONS[src.dataset.view] || "•"),
        h("span", { class: "bottom-tab-label" }, src.textContent.trim()))),
      // Kugghjulet flyttas hit från sidhuvudet: på en telefon är överkanten
      // svårast att nå, och sidhuvudet blir samtidigt en rad renare. Öppnar
      // samma dialog som förut — knappen i headern finns kvar i DOM:et (bara
      // dold via CSS) så all befintlig logik pekar på samma element.
      h("button", {
        class: "bottom-tab bottom-settings", type: "button",
        onclick: () => { toggleFilterSheet(false); $("#settingsBtn").click(); },
      },
        h("span", { class: "bottom-tab-icon", "aria-hidden": "true" }, "⚙"),
        // "Inställningar" är 13 tecken och klipps mitt i ordet på en 56 px
        // flik. Förkortningen är standard i svenska mobilgränssnitt och
        // läses obehindrat bredvid kugghjulet.
        h("span", { class: "bottom-tab-label" }, "Inställn.")),
      showFilter ? h("button", {
        class: "bottom-tab bottom-filter" +
          (document.body.classList.contains("filters-open") ? " on" : ""),
        type: "button", "aria-label": "Filter och sortering",
        onclick: () => { toggleFilterSheet(); },
      },
        h("span", { class: "bottom-tab-icon", "aria-hidden": "true" }, FILTER_ICON),
        h("span", { class: "bottom-tab-label" }, "Filter"),
        activeFilterCount()
          ? h("span", { class: "bottom-filter-badge" }, String(activeFilterCount()))
          : null) : null,
    ].filter(Boolean));
    // Arkets underkant ska ligga dikt an mot raden. Höjden mäts i stället
    // för att hårdkodas — den varierar med teckenstorlek och safe-area, och
    // en gissad siffra gav ett synligt glapp mellan rad och ark.
    document.documentElement.style.setProperty(
      "--bottombar-h", Math.round(bar.getBoundingClientRect().height) + "px");
    syncBottomStack();
  }

  // Total höjd på ALLT som ligger fast i botten just nu: bottenraden plus
  // filterremsan när den är uppfälld. Väljarpanelerna utgår från den och
  // lägger sig OVANFÖR i stället för att täcka raderna man just navigerade
  // med. Mäts i stället för att räknas ut — remsans höjd beror på hur många
  // brickor som ryms och på safe-area.
  function syncBottomStack() {
    const bar = $("#bottomBar");
    let h = bar ? bar.getBoundingClientRect().height : 0;
    // Allt annat som ligger FAST i botten just nu: filterremsan när den är
    // uppfälld, och Stats-underflikarna på den fliken. Mäts i stället för
    // att räknas ut — höjderna beror på antal brickor, teckenstorlek och
    // safe-area, och en gissad siffra gömmer slutet på matchlistan.
    for (const sel of ["#toolbar", '#content .history-tabs[aria-label="Stats"]']) {
      const el = document.querySelector(sel);
      if (el && getComputedStyle(el).position === "fixed") {
        h += el.getBoundingClientRect().height;
      }
    }
    document.documentElement.style.setProperty("--bottomstack-h", Math.round(h) + "px");
  }

  // Sidfotens länkar (Om appen / Hjälp / Lägg till cup / Admin) hör hemma i
  // inställningarna på mobil — de är alla inställningsartade, och i sidfoten
  // tog de plats i en vy där varje pixel räknas. FLYTTAS, inte kopieras:
  // samma knappar med samma lyssnare, så inget behöver hållas i synk.
  //
  // Anropas från renderBottomBar (som körs vid varje renderTabs) i stället
  // för att bara haka på matchMedia("change") — den händelsen är svår att
  // testa och skulle vid ett missat fall lämna länkarna på fel ställe för
  // gott. Funktionen är idempotent: den flyttar bara det som står fel.
  function placeFooterLinks() {
    const footer = document.querySelector("body > footer");
    const linkSlot = $("#settingsLinks");
    if (!footer || !linkSlot) return;
    const host = window.matchMedia("(max-width: 700px)").matches ? linkSlot : footer;
    // Textraden om datakällan hör till sidfoten och följer inte med.
    for (const el of [...footer.children, ...linkSlot.children]) {
      if (el.tagName === "SPAN") continue;
      if (el.parentElement !== host) host.append(el);
    }
  }

  let filterBackdrop = null;

  // Cupknapp överst i filterarket. Cupen är det största urvalsvalet som
  // finns, men låg bakom kugghjulet medan allt annat urval bor i arket.
  // Knappen öppnar samma inställningsdialog som förut (där cuplistan med
  // sportväljare redan finns) — ingen andra, konkurrerande cuplista att
  // hålla i synk.
  function renderSheetCupButton() {
    const bar = $("#toolbar");
    if (!bar || state.view === "stats") return;
    // Knappen hör till mobilens filterark — all dess styling ligger i
    // @media (max-width: 700px). På dator ritades den ändå ut och syntes
    // som en ostylad grå bjälke med hopklistrad text under flikraden.
    if (!sheetMode()) return;
    const c = cup();
    bar.prepend(h("button", {
      class: "sheet-cup-btn", type: "button",
      onclick: () => {
        toggleFilterSheet(false);
        $("#currentCupBtn").click();
      },
    },
      h("span", { class: "sheet-cup-text" },
        h("span", { class: "sheet-cup-label" }, "Cup"),
        h("span", { class: "sheet-cup-name" }, c.name),
        h("span", { class: "sheet-cup-meta" }, [c.place, c.edition].filter(Boolean).join(" "))),
      h("span", { class: "sheet-cup-arrow", "aria-hidden": "true" }, "›")));
  }

  // Bakgrundstäcket hör till det STORA arket (filters-expanded), inte till
  // ikonremsan: remsan är en tunn rad ovanför bottenraden och ska inte
  // spärra resten av sidan — man ska kunna scrolla matchlistan med filtren
  // framme, precis som med Stats-underflikarna.
  function syncFilterBackdrop() {
    const behovs = document.body.classList.contains("filters-open") &&
      document.body.classList.contains("filters-expanded");
    if (behovs && !filterBackdrop) {
      filterBackdrop = h("div", {
        class: "filter-sheet-backdrop",
        onclick: () => {
          document.body.classList.remove("filters-expanded");
          syncFilterBackdrop();
        },
      });
      document.body.append(filterBackdrop);
    } else if (!behovs && filterBackdrop) {
      filterBackdrop.remove();
      filterBackdrop = null;
    }
  }

  function toggleFilterSheet(force) {
    const open = force === undefined
      ? !document.body.classList.contains("filters-open") : !!force;
    document.body.classList.toggle("filters-open", open);
    if (!open) document.body.classList.remove("filters-expanded");
    syncFilterBackdrop();
    // Efter en bildruta: remsan måste hinna få sin layout innan den mäts.
    requestAnimationFrame(syncBottomStack);
    // Verktygsradens egen ihopfällning är meningslös inne i arket — arket ÄR
    // den öppna/stängda växlingen. Tvinga upp den så man inte behöver två
    // klick för att komma åt filtren.
    if (open) {
      state.toolbarOpen = true;
      const dd = document.querySelector(".toolbar-collapse");
      if (dd) dd.open = true;
    }
    renderBottomBar();
  }



  function renderMeta() {
    // Uppdatera-knappen ger tydlig feedback direkt vid klick — annars
    // syns en pågående bakgrundsuppdatering (kan ta 20-30 s för en stor
    // cup) bara som en liten textändring längst upp, vilket lätt ser ut
    // som att sidan hängt sig i stället för att faktiskt jobba.
    const btn = $("#refreshBtn");
    if (btn) {
      btn.disabled = state.loading;
      btn.textContent = state.loading ? "↻ Uppdaterar …" : "↻ Uppdatera";
    }
    const el = $("#meta");
    el.replaceChildren();
    if (!state.loadedAt) return;
    const n = scoped().length;
    const dataTs = HB.api.localDataTs[state.cupId];
    const when = new Date(dataTs || state.loadedAt);
    // Visa datum om tidsstämpeln inte är idag — annars ser t.ex. en sedan
    // länge avslutad cups "12:10" ut som idag fastän datan hämtades för
    // flera dagar sen (det som förvirrade här).
    const sameDay = when.toDateString() === new Date().toDateString();
    const fmt = sameDay ? fmtClock : new Intl.DateTimeFormat("sv-SE",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const label = (dataTs ? "Data hämtad " : "Uppdaterad ") + fmt.format(when) + " · " + n + " matcher";
    // Klickbar — öppnar en logg över exakt VILKA matcher som räknas in i
    // antalet ovan (samma urval, scoped(), se openMatchLogDialog).
    el.append(h("button", {
      class: "meta-link", type: "button", title: "Visa vilka matcher som räknas i antalet (inte en ändringslogg)",
      onclick: openMatchLogDialog,
    }, label));
    if (state.loading) el.append(" · hämtar nytt … (" + (loadProgress || "0") + ")");
  }

  // --- generisk sök-, filter- och sorterbar flervalsdropdown ------------------

  // Listor större än så bygger INTE alla checkboxrader direkt (tusentals
  // DOM-noder för t.ex. lagväljaren i "Hela cupen"-läge på en stor cup —
  // hängde webbläsaren) — i stället tomt tills man skrivit något, med en
  // kort debounce så varje enskilt tangenttryck inte triggar en omritning.
  // Redan ikryssade rader visas alltid (annars "försvinner" ett val ur sikte
  // så fort sökrutan töms, trots att det fortfarande är valt).
  const PICKER_LAZY_THRESHOLD = 60;
  const PICKER_LAZY_DEBOUNCE_MS = 400;
  const PICKER_LAZY_MAX_RESULTS = 200; // tak även på TRÄFFARNA (bred sökning i en jättecup)

  // Egen, självstyrande komponent: sökning/sortering/bockning inuti den sköts
  // med direkt DOM-manipulation i stället för renderToolbar(), så att den kan
  // hållas öppen genom flera val utan att byggas om. items: [{id, label,
  // sortKey (numeriskt), sortName (för alfabetisk sortering)}].
  // --- mobil: filterpanelerna som bottenark --------------------------------
  // På smal skärm öppnas varje picker som ett ark underifrån i stället för
  // som en dropdown under sin knapp (se motsvarande @media i style.css).
  // Löser att en knapp långt till höger sköt ut panelen utanför skärmkanten,
  // och ger samtidigt hela bredden åt sök- och kryssrutor.
  //
  // Allt hängs på via delegering på document i stället för i buildPicker, så
  // det gäller ALLA pickers — även exportmenyn, som bygger sin panel själv.
  const SHEET_QUERY = "(max-width: 700px)";
  const SHEET_MIN_VH = 25;   // hur lågt arket får dras innan det är meningslöst
  const SHEET_MAX_VH = 92;   // ...och hur högt, med lite luft kvar upptill
  let sheetBackdrop = null;

  function sheetMode() {
    return window.matchMedia(SHEET_QUERY).matches;
  }

  function savedSheetHeight() {
    const v = +(localStorage.getItem("hb:sheetVh") || 0);
    return v >= SHEET_MIN_VH && v <= SHEET_MAX_VH ? v : 0;
  }

  // Rubrikrad med draghandtag, titel och stängkryss. Byggs en gång per
  // panel och återanvänds; titeln uppdateras vid varje öppning eftersom
  // knappens text ändras med urvalet ("Alla lag" -> "Lag (3)").
  function ensureSheetHead(dd) {
    const panel = dd.querySelector(".team-picker-panel");
    if (!panel) return null;
    const summary = dd.querySelector("summary");
    let head = panel.querySelector(".picker-sheet-head");
    if (!head) {
      const grip = h("span", { class: "picker-sheet-grip", "aria-hidden": "true" });
      const title = h("span", { class: "picker-sheet-title" });
      const close = h("button", {
        class: "picker-sheet-close", type: "button", "aria-label": "Stäng",
        onclick: () => { dd.open = false; },
      }, "×");
      head = h("div", { class: "picker-sheet-head" }, grip, title, close);
      panel.prepend(head);
      attachSheetDrag(grip, panel);
    }
    head.querySelector(".picker-sheet-title").textContent =
      (summary && summary.textContent.trim()) || "Filter";
    return head;
  }

  // Dra handtaget för att välja höjd. Uppåt = högre ark, så höjden räknas
  // från startpunkten MINUS aktuell y. Höjden sparas så nästa öppning
  // (och nästa besök) behåller den man valt.
  function attachSheetDrag(grip, panel) {
    let startY = 0, startH = 0, dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      if (!sheetMode()) return;
      dragging = true;
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const vh = window.innerHeight / 100;
      const raw = (startH + (startY - e.clientY)) / vh;
      const clamped = Math.min(SHEET_MAX_VH, Math.max(SHEET_MIN_VH, raw));
      panel.style.setProperty("--sheet-h", clamped.toFixed(1) + "vh");
      persist("hb:sheetVh", String(Math.round(clamped)));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { grip.releasePointerCapture(e.pointerId); } catch { /* redan släppt */ }
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  function syncSheetBackdrop(open) {
    if (open && !sheetBackdrop) {
      sheetBackdrop = h("div", { class: "picker-sheet-backdrop" });
      document.body.append(sheetBackdrop);
    } else if (!open && sheetBackdrop) {
      sheetBackdrop.remove();
      sheetBackdrop = null;
    }
  }

  // Bakgrundstäcket och picker-open sätts av toggle-lyssnaren i
  // setupPickerSheets — men <details> avfyrar INGET toggle-event när det
  // rivs ur DOM:et, och en väljares egen onChange ritar ofta om just den
  // del av sidan den själv sitter i (Stats-vyernas cup-, klass- och
  // lagväljare anropar renderContent()). Då blev täcket kvar som ett
  // osynligt lager över hela sidan: allt gick att se men inget att klicka
  // på, och bara en omladdning hjälpte (rapporterat på iOS Firefox).
  // Därför stäms båda av mot DOM:ets faktiska innehåll efter varje
  // omritning, i stället för att lita på att ett event hinner före.
  function reconcilePickerChrome() {
    const nagonOppen = !!document.querySelector(".team-picker-dd[open]");
    syncSheetBackdrop(nagonOppen && sheetMode());
    document.body.classList.toggle("picker-open", nagonOppen);
  }

  // position:fixed utgår från LAYOUT-viewporten. Mobilwebbläsare ändrar
  // däremot den VISUELLA viewporten när adressfältet krymper eller blir en
  // flytande "ö" (Firefox), och då glider de två isär: bottenraden hamnade
  // en bit ovanför skärmkanten med sidinnehåll synligt under, som en banner
  // mitt i sidan.
  //
  // Skillnaden mäts via Visual Viewport-API:t och skrivs till --vv-offset,
  // som alla bottenfästa element lägger till i sitt bottom-värde (se
  // style.css). Saknas API:t blir den 0 och allt beter sig som förut.
  function syncViewportOffset() {
    const vv = window.visualViewport;
    if (!vv) return;
    // Positivt: den synliga ytan slutar OVANFÖR layoutens botten, så
    // elementen måste lyftas. Negativt: tvärtom. Under 1 px är brus.
    const diff = window.innerHeight - (vv.offsetTop + vv.height);
    const px = Math.abs(diff) < 1 ? 0 : Math.round(diff);
    document.documentElement.style.setProperty("--vv-offset", px + "px");
  }

  function setupViewportOffset() {
    const vv = window.visualViewport;
    if (!vv) return;
    // scroll OCH resize: adressfältet ändrar höjd under scrollning, inte
    // bara vid ett omritningstillfälle.
    vv.addEventListener("resize", syncViewportOffset);
    vv.addEventListener("scroll", syncViewportOffset);
    window.addEventListener("orientationchange", () => setTimeout(syncViewportOffset, 250));
    syncViewportOffset();
  }

  function setupPickerSheets() {
    // toggle bubblar INTE, så lyssnaren måste ligga i fångstfasen för att
    // nå <details> var de än råkar sitta i trädet.
    document.addEventListener("toggle", (e) => {
      const dd = e.target;
      if (!(dd instanceof HTMLElement) || !dd.classList.contains("team-picker-dd")) return;
      if (dd.open) {
        // Bara EN picker åt gången — annars kan två ark hamna ovanpå
        // varandra, båda fixerade mot skärmens nederkant.
        for (const other of document.querySelectorAll(".team-picker-dd[open]")) {
          if (other !== dd) other.open = false;
        }
        if (!sheetMode()) return;
        const head = ensureSheetHead(dd);
        const saved = savedSheetHeight();
        if (head && saved) {
          dd.querySelector(".team-picker-panel").style.setProperty("--sheet-h", saved + "vh");
        }
      }
      const nagonOppen = !!document.querySelector(".team-picker-dd[open]");
      syncSheetBackdrop(nagonOppen && sheetMode());
      // #toolbar är position:fixed med z-index och skapar därmed en EGEN
      // staplingskontext: väljarpanelens z-index gäller bara inom den, så
      // bakgrundstäcket (barn till body) la sig ovanpå hela raden — panelen
      // såg utgråad ut och gick inte att klicka i. Lyft raden över täcket
      // medan en väljare är öppen. Att jämföra z-index-SIFFROR räcker inte
      // mellan olika staplingskontexter.
      document.body.classList.toggle("picker-open", nagonOppen);
    }, true);

    // Roterar man till liggande (eller öppnar på en bred skärm) ska ett
    // kvarglömt bakgrundstäcke inte ligga och blockera klick.
    window.matchMedia(SHEET_QUERY).addEventListener("change", () => {
      syncSheetBackdrop(!!document.querySelector(".team-picker-dd[open]") && sheetMode());
      // Låset gäller bara över brytpunkten (se isFilterLocked) — rita om
      // hela raden vid rotation, annars visas fel uppsättning väljare.
      render();
    });
  }

  function buildPicker(opts) {
    // opts.icon: enskild emoji som mobilens filterremsa visar ovanför
    // etiketten (se .filter-group i style.css). Sätts som data-attribut i
    // stället för att byggas som ett element, så desktopvyn — där remsan
    // inte finns — förblir helt oförändrad.
    const dd = h("details", { class: "team-picker-dd" });
    // data-icon sitter på SUMMARY, inte på <details>: attr() i CSS läser bara
    // attribut från pseudoelementets EGET element, och ::before hänger på
    // summary. På <details> hade content: attr(data-icon) gett tomt.
    const summary = h("summary", {
      class: "chip team-picker-summary",
      ...(opts.icon ? { "data-icon": opts.icon } : {}),
    });
    // Etiketten i ett eget element (inte som ren textnod): mobilens brickor
    // behöver kunna korta den med ellips, och text-overflow biter inte på en
    // anonym textnod inuti en flex-container.
    const label = h("span", { class: "picker-label" });
    const setSummary = () => {
      label.textContent = opts.selected.size
        ? opts.countLabel(opts.selected.size) : opts.emptyLabel;
      if (!label.parentNode) summary.append(label);
    };
    setSummary();

    const search = h("input", {
      class: "team-picker-search", type: "search", placeholder: opts.searchPlaceholder,
      title: "Stöder & (och) och / eller , (eller), t.ex. 2011&flickor/2013",
    });

    // sortToggle: false — listor utan ett naturligt "klass"-begrepp (t.ex.
    // cupväljarna på Karta/Trend) har bara namnsortering, ingen växlingsrad.
    // sortKey/catkey blir då aldrig meningsfullt ifyllt av anroparen, men
    // det spelar ingen roll eftersom "klass"-jämförelsen aldrig körs.
    let sortMode = opts.sortToggle === false ? "namn" : "klass";
    const sortBtns = {};
    // selectedFirst: lyfter ikryssade rader överst. Körs BARA när panelen
    // öppnas (se toggle-lyssnaren nedan), aldrig vid ett enskilt klick —
    // annars hoppar raden man just kryssade i väg under fingret och nästa
    // klick landar på fel rad.
    const applySort = (selectedFirst) => {
      const base = sortMode === "namn"
        ? (a, b) => a.dataset.name.localeCompare(b.dataset.name, "sv")
        : (a, b) => (+a.dataset.catkey - +b.dataset.catkey) ||
            a.dataset.name.localeCompare(b.dataset.name, "sv");
      const cmp = selectedFirst
        ? (a, b) => (opts.selected.has(b._id) ? 1 : 0) - (opts.selected.has(a._id) ? 1 : 0) || base(a, b)
        : base;
      [...list.children].sort(cmp).forEach((el) => list.append(el));
    };
    dd.addEventListener("toggle", () => { if (dd.open) applySort(true); });
    const sortRow = opts.sortToggle === false ? null : h("div", { class: "team-picker-sort-row" },
      ["klass", "namn"].map((key) => {
        const b = h("button", {
          class: "chip small" + (key === sortMode ? " on" : ""),
          type: "button",
          onclick: () => {
            sortMode = key;
            Object.entries(sortBtns).forEach(([k, el]) => el.classList.toggle("on", k === key));
            applySort();
          },
        }, "Sortera: " + (key === "namn" ? "namn" : "klass"));
        sortBtns[key] = b;
        return b;
      }));

    const list = h("div", { class: "team-picker-list" });
    const lazy = opts.items.length > PICKER_LAZY_THRESHOLD;
    const lazyHint = h("p", { class: "muted team-picker-hint" },
      "Skriv för att söka bland " + opts.items.length + " …");

    function buildRow(it) {
      const cb = h("input", {
        type: "checkbox", ...(opts.selected.has(it.id) ? { checked: "" } : {}),
        onchange: (e) => {
          e.target.checked ? opts.selected.add(it.id) : opts.selected.delete(it.id);
          saveUi(); setSummary(); opts.onChange();
          syncGenderBoxes();
          if (lazy && !e.target.checked) renderLazyList(search.value); // en avkryssad rad ska försvinna om den inte längre matchar sökningen
        },
      });
      // soloClickable (bara cupväljarna, se renderTrendView/renderMapView):
      // klick direkt på NAMNET väljer bara den raden (kryssar ur alla andra)
      // — snabbt sätt att hoppa till "bara den här cupen". Klick på själva
      // kryssrutan fortsätter fungera som vanligt av/på-flerval (bygger upp
      // en jämförelse). preventDefault() stoppar <label>s inbyggda
      // vidarebefordran av klicket till kryssrutan, annars skulle den även
      // togglas av vår egen hantering.
      const label = opts.soloClickable
        ? h("span", {
            class: "team-picker-item-text", title: "Klicka för att välja bara den här",
            onclick: (e) => {
              e.preventDefault();
              opts.selected.clear();
              opts.selected.add(it.id);
              saveUi(); setSummary(); opts.onChange();
              if (lazy) renderLazyList(search.value);
              else for (const r of list.children) r._checkbox.checked = opts.selected.has(r._id);
            },
          }, it.label)
        : it.label;
      const row = h("label", { class: "team-picker-item" }, cb, label);
      row.dataset.name = it.sortName;
      row.dataset.catkey = String(it.sortKey);
      row.dataset.search = it.label.toLowerCase();
      row._id = it.id; // rådata (kan vara nummer) — dataset tvingar sträng
      row._checkbox = cb;
      if (opts.genderQuickSelect) row.dataset.gender = (parseCat(it.label) || {}).g || "";
      return row;
    }

    // Bara i lat läge: redan valda (fästa överst) + sökträffar (kapade vid
    // PICKER_LAZY_MAX_RESULTS). Anropas vid varje (debouncad) sökning OCH
    // efter Rensa/avkryssning, så listan alltid speglar det faktiska urvalet.
    function renderLazyList(query) {
      const q = query.trim();
      const selectedItems = opts.items.filter((it) => opts.selected.has(it.id));
      const matched = q
        ? opts.items.filter((it) => !opts.selected.has(it.id) &&
            matchesBooleanQuery(it.label.toLowerCase(), q)).slice(0, PICKER_LAZY_MAX_RESULTS)
        : [];
      list.replaceChildren(...selectedItems.map(buildRow), ...matched.map(buildRow));
      lazyHint.hidden = !!(q || selectedItems.length);
      applySort();
      syncGenderBoxes();
    }

    const clearBtn = h("button", {
      class: "btn small", type: "button",
      onclick: () => {
        opts.selected.clear();
        saveUi(); setSummary(); opts.onChange();
        if (lazy) renderLazyList(search.value);
        else list.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
      },
    }, "Rensa");

    // Snabbval Flickor/Pojkar (bara klassväljaren, se buildCatPicker): kryssar
    // eller kryssar ur ALLA just nu SYNLIGA (sökfiltrerade) klasser av det
    // könet i ett klick — praktiskt när t.ex. en sökning på "2013" ger
    // träffar utspridda över flera år/åldrar och man bara vill ha
    // flickornas eller bara pojkarnas av dem. Reflekterar aktuellt urval
    // (ikryssad om ALLA synliga av könet redan är valda, streckad om BARA
    // några är det) i stället för att vara en engångsknapp utan status.
    let genderRow = null;
    const syncGenderBoxes = () => {
      if (!genderRow) return;
      for (const g of ["F", "P"]) {
        const box = genderRow.querySelector('input[data-gender-toggle="' + g + '"]');
        const visible = [...list.children].filter((row) => !row.hidden && row.dataset.gender === g);
        box.disabled = !visible.length;
        const allSelected = visible.length > 0 && visible.every((row) => opts.selected.has(row._id));
        box.checked = allSelected;
        box.indeterminate = !allSelected && visible.some((row) => opts.selected.has(row._id));
      }
    };
    if (opts.genderQuickSelect) {
      genderRow = h("div", { class: "team-picker-gender-row" },
        [["F", "Flickor"], ["P", "Pojkar"]].map(([g, label]) =>
          h("label", { class: "team-picker-gender-item" },
            h("input", {
              type: "checkbox", "data-gender-toggle": g,
              onchange: (e) => {
                const visible = [...list.children].filter((row) => !row.hidden && row.dataset.gender === g);
                for (const row of visible) {
                  row._checkbox.checked = e.target.checked;
                  e.target.checked ? opts.selected.add(row._id) : opts.selected.delete(row._id);
                }
                saveUi(); setSummary(); opts.onChange();
                if (lazy) renderLazyList(search.value); else syncGenderBoxes();
              },
            }),
            label)));
    }

    // Måste köras EFTER syncGenderBoxes/genderRow ovan — renderLazyList
    // anropar syncGenderBoxes(), och en const-funktion går inte att nå
    // innan sin egen deklaration (temporal dead zone).
    if (lazy) renderLazyList(""); else list.append(...opts.items.map(buildRow));

    let debounceTimer = null;
    search.addEventListener("input", () => {
      if (lazy) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => renderLazyList(search.value), PICKER_LAZY_DEBOUNCE_MS);
        return;
      }
      const q = search.value;
      for (const item of list.children) item.hidden = !matchesBooleanQuery(item.dataset.search, q);
      syncGenderBoxes();
    });
    syncGenderBoxes();

    dd.append(summary, h("div", { class: "team-picker-panel" },
      h("div", { class: "team-picker-search-row" }, withClearButton(search), clearBtn),
      genderRow, sortRow, lazy ? lazyHint : null, list));
    return dd;
  }

  function buildTeamPicker(teams, onChange) {
    return buildPicker({
      items: teams.map((t) => ({
        id: t.id, label: HB.shortCat(t.catName) + " " + t.suffix,
        sortKey: catSortKey(t.catName), sortName: t.suffix,
      })),
      icon: "👥",
      selected: state.teams,
      emptyLabel: "Lag",
      countLabel: (n) => "Lag (" + n + ")",
      searchPlaceholder: "Sök lag …",
      onChange: onChange || renderContent,
    });
  }

  function buildDayPicker(days, onChange) {
    return buildPicker({
      items: days.map((d) => ({
        id: d, label: fmtDay.format(new Date(d + "T00:00:00Z")),
        sortKey: Date.parse(d + "T00:00:00Z"), sortName: d, // dayKey (ÅÅÅÅ-MM-DD) sorterar redan kronologiskt
      })),
      icon: "📆",
      selected: state.days,
      emptyLabel: "Dagar",
      countLabel: (n) => "Dagar (" + n + ")",
      searchPlaceholder: "Sök dag …",
      onChange: onChange || renderContent,
    });
  }

  // Klassväljaren grupperar på ÅRSKULL när det går: "Flickor 2011" i stället
  // för "Flickor 13 (födda 2011) 25-27 april". Blandar man in tidigare år
  // finns annars samma lag under olika etiketter — F13 år 2024 är F14 år
  // 2025 — och varje upplaga får dessutom egna klass-id, så en klass vald i
  // ett år filtrerade bort både matcher OCH lag från de andra.
  //
  // Bara PRESENTATIONEN grupperas. state.cats innehåller fortfarande klass-
  // id, så filtrering, tabeller, slutspel, URL:er och sparad vy är helt
  // orörda — proxyn nedan översätter mellan årskull och id, precis som
  // yearSelectionProxy gör för årsväljaren.
  //
  // Klasser utan läsbart födelseår (alla cuper skriver det inte) blir kvar
  // som egna rader med sitt fulla namn — inget val försvinner.
  // Ett kullval fångar de klass-id som fanns NÄR man kryssade i det. Lägger
  // man till ett år efteråt hämtas det årets matcher in, men dess klass-id
  // står utanför urvalet — resultatet blev att man valde "Flickor 2011",
  // la till 2025, och ändå bara såg 2026 års matcher.
  //
  // Här utökas därför urvalet till att omfatta ALLA nu kända id för de
  // kullar som redan är valda. Körs vid varje uppbyggnad av verktygsraden,
  // alltså även när ett arkivår just laddat klart (ensureYearMatches
  // anropar render()). Säkert att köra om: kullproxyn kryssar ur hela
  // kullen på en gång, så ett delvis urval kan aldrig vara avsiktligt.
  function expandCohortSelection(catEntries) {
    if (!state.cats.size) return;
    const idsByKey = new Map();
    const valdaKullar = new Set();
    for (const [id, name] of catEntries) {
      const key = cohortKey(name);
      if (!key) continue;
      if (!idsByKey.has(key)) idsByKey.set(key, []);
      idsByKey.get(key).push(id);
      if (state.cats.has(id)) valdaKullar.add(key);
    }
    let andrat = false;
    for (const key of valdaKullar) {
      for (const id of idsByKey.get(key) || []) {
        if (!state.cats.has(id)) { state.cats.add(id); andrat = true; }
      }
    }
    if (andrat) saveUi();
  }

  function buildCatPicker(catEntries, onChange) {
    const idsByKey = new Map();   // årskullsnyckel (eller id) -> [catId]
    const labelByKey = new Map();
    const sortByKey = new Map();
    for (const [id, name] of catEntries) {
      const key = cohortKey(name) || ("id:" + id);
      if (!idsByKey.has(key)) {
        idsByKey.set(key, []);
        labelByKey.set(key, cohortKey(name) ? cohortLabel(name) : name);
        sortByKey.set(key, catSortKey(name));
      }
      idsByKey.get(key).push(id);
      // Sorteringen följer den YNGSTA åldersetiketten kullen har i vyn, så
      // listan står i samma ordning som när bara ett år är valt.
      sortByKey.set(key, Math.min(sortByKey.get(key), catSortKey(name)));
    }

    const idsFor = (key) => idsByKey.get(key) || [];
    const cohortSelection = {
      get size() {
        let n = 0;
        for (const ids of idsByKey.values()) if (ids.some((id) => state.cats.has(id))) n++;
        return n;
      },
      // "Vald" så snart NÅGOT av kullens id är valt — annars skulle en kull
      // vars ena år saknar matcher aldrig kunna se ikryssad ut.
      has: (key) => idsFor(key).some((id) => state.cats.has(id)),
      add: (key) => { for (const id of idsFor(key)) state.cats.add(id); },
      delete: (key) => { for (const id of idsFor(key)) state.cats.delete(id); },
      clear: () => state.cats.clear(),
    };

    return buildPicker({
      items: [...idsByKey.keys()].map((key) => ({
        id: key, label: labelByKey.get(key),
        sortKey: sortByKey.get(key), sortName: labelByKey.get(key),
      })),
      icon: "🏷️",
      selected: cohortSelection,
      emptyLabel: "Klasser",
      countLabel: (n) => "Klasser (" + n + ")",
      searchPlaceholder: "Sök klass …",
      genderQuickSelect: true,
      onChange: onChange || renderContent,
    });
  }

  // Årsväljaren — flerval där INNEVARANDE upplaga är en vanlig kryssruta
  // bland de arkiverade åren (inte en separat knapp bredvid) — kryssad som
  // förval. De facto två olika lagringsplatser (state.includeCurrentYear
  // för just den raden, state.years för resten) presenteras som EN
  // sömlös lista genom yearSelectionProxy nedan, som efterliknar ett
  // Set (size/has/add/delete/clear) men dirigerar innevarande upplagas
  // id till den booleanen i stället för till Set:et — buildPicker() bryr
  // sig aldrig om skillnaden. Kryssade år blandas in i hela appen (Schema/
  // Tabeller/Slutspel) OVANPÅ (eller i stället för, om innevarande år
  // kryssas ur) live-datan, se allActiveMatches().
  //
  // Till skillnad från dag-/klass-/lag-väljarna ovan (som håller sin egen
  // <details> vid liv över ändringar) anropar onChange en full render()
  // direkt — att ändra årsvalet kan ändra VILKA dagar/klasser/lag som ens
  // finns att välja bland, vilket ändå kräver att hela verktygsraden byggs
  // om. Känd konsekvens: dropdownen stängs efter varje enskilt årkryss
  // (måste öppnas igen för nästa val) — en medveten avvägning för v1.
  function buildYearPicker(editions, currentEdition) {
    const yearSelectionProxy = {
      get size() { return state.years.size + (state.includeCurrentYear ? 1 : 0); },
      has: (id) => id === currentEdition ? state.includeCurrentYear : state.years.has(id),
      add: (id) => { if (id === currentEdition) state.includeCurrentYear = true; else state.years.add(id); },
      delete: (id) => { if (id === currentEdition) state.includeCurrentYear = false; else state.years.delete(id); },
      clear: () => { state.years.clear(); state.includeCurrentYear = false; },
    };
    const items = [currentEdition, ...editions].map((y) => ({
      id: y, label: y, sortKey: -Number(y) || 0, sortName: y,
    }));
    return buildPicker({
      items,
      icon: "🗓️",
      selected: yearSelectionProxy,
      emptyLabel: "Inga år valda",
      // Standardläget (bara innevarande år) ska fortfarande läsas som
      // "Innevarande år", inte det generiska "1 år" — annars ser den
      // vanligaste inställningen ut som ett aktivt urval i onödan.
      // Visa ÅRTALET när exakt ett år är valt — "Innevarande år" sa varken
      // vilket år det var eller matchade de andra rader i listan, som alla
      // är årtal. Dessutom för långt för en bricka i mobilens filterremsa,
      // där det klipptes till "Innevarand…".
      countLabel: (n) => {
        if (n !== 1) return n + " år";
        if (state.includeCurrentYear) return String(currentEdition);
        return String([...state.years][0] || "1 år");
      },
      searchPlaceholder: "Sök år …",
      onChange: () => {
        for (const y of state.years) ensureYearMatches(y);
        render();
      },
    });
  }

  // --- render: verktygsrad ----------------------------------------------------

  function renderToolbar() {
    const bar = $("#toolbar");
    bar.replaceChildren();
    // Stats (Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper) bygger på HELA
    // arkivet/klubbregistret oavsett dag-/klass-/lagfilter (de filtrerar
    // inte state.matches alls) — verktygsraden vore bara missvisande brus där.
    if (state.view === "stats") return;
    ensureArchiveEditions();
    const archiveEntry = state.archiveEditions[state.cupId];
    const archiveYears = (archiveEntry && archiveEntry.editions) || [];
    // Live-upplagan kan sakna publicerat schema (ny säsong, inget släppt
    // än) men ändå ha arkiverade tidigare år att bläddra i — årsväljaren
    // måste gå att nå ändå, annars sitter man fast på "inget schema
    // publicerat"-bannern (se renderContent) utan något sätt att komma åt
    // t.ex. förra årets data. Bara om det INTE finns något alls — varken
    // live eller arkiverat — är verktygsraden meningslös att visa.
    if (!state.matches.length && !archiveYears.length) return;
    const clubTeamsList = clubTeams();
    // state.years (vilka extra år som ska blandas in) sparas i localStorage
    // och överlever en omladdning, men de FAKTISKA matcherna
    // (state.yearMatches) gör det medvetet inte (se state-kommentaren) —
    // så varje redan valt år måste hämtas om här. ensureYearMatches() är
    // billig att anropa upprepade gånger (no-op om redan hämtat/hämtas).
    for (const edition of state.years) ensureYearMatches(edition);

    // Hela verktygsraden går i en expanderbar meny — så att den kan
    // minimeras när man valt filter/sortering klart, i stället för att
    // permanent ta plats högst upp i schemat. state.toolbarOpen styr
    // öppet/stängt över omritningar (annars skulle varje filterbyte,
    // som anropar render(), öppna den igen).
    const dd = h("details", {
      class: "toolbar-collapse",
      ...(state.toolbarOpen ? { open: "" } : {}),
    });
    dd.addEventListener("toggle", () => { state.toolbarOpen = dd.open; });
    const bodyEl = h("div", { class: "toolbar-body" });
    // lockSlot sitter INUTI <summary>, bredvid etikett-pillen, och hålls
    // vid liv separat (se längre ner) — så att låsknappen/den låsta klass-
    // chippen förblir synlig och klickbar även när man fällt ihop hela
    // filterpanelen, i stället för att gömmas undan med resten av
    // filtren. display:contents på wrappern gör att den inte syns som en
    // egen tom pill innan den fyllts. Klick på dess innehåll stoppas från
    // att bubbla upp (stopPropagation) så det inte råkar trigga <summary>s
    // inbyggda öppna/stäng-toggle.
    const lockSlot = h("span", { style: "display:contents", onclick: (e) => e.stopPropagation() });
    dd.append(
      h("summary", { class: "toolbar-summary" },
        h("span", { class: "toolbar-summary-label" }, "Filter och sortering"),
        lockSlot),
      bodyEl);
    bar.append(dd);
    const body = bodyEl;

    // Tillbaka-knapp: syns så snart man hoppat till en tillfällig
    // filtrering — ett lags kommande/spelade matcher (matchdialogens
    // snabblänkar, ett klickbart lagnamn i tabellerna eller på ett
    // matchkort) eller en specifik plan — oavsett vad som utlöste hoppet.
    // Ett enda tydligt sätt att komma tillbaka till sin egen vy, i stället
    // för att behöva pilla ihop filtren för hand.
    if (stashedFilter) {
      body.append(h("div", { class: "row" },
        h("button", {
          class: "chip back-chip", type: "button",
          onclick: () => restoreStashedFilter(),
        }, "← Tillbaka till din vy")));
    }

    // Aktivt filter på ett motståndarlag (satt via matchdialogens
    // snabblänkar) — klubbens egna lag hanteras redan synligt av
    // lagväljaren nedan, så den här raden visar bara lag som INTE är våra.
    const clubTeamIds = new Set(clubTeamsList.map((t) => t.id));
    const foreignTeamIds = [...state.teams].filter((id) => !clubTeamIds.has(id));
    if (foreignTeamIds.length) {
      body.append(h("div", { class: "row" },
        foreignTeamIds.map((id) =>
          chip((teamNameById(id) || "Okänt lag") + "  ✕", true, () => {
            if (!restoreStashedFilter()) { state.teams.delete(id); saveUi(); render(); }
          }))));
    }

    // Dagar och klasser — dropdown-väljare (sök-, filter- och sorterbara)
    // i stället för en knapp per dag/klass, som blir orimligt rörigt när
    // en cup spänner över många dagar eller klasser.
    // Matcher utan satt tid (start = 0, vanligt innan arrangören spikat
    // spelordningen) hamnar på epoken och gav ett spöke i dagväljaren:
    // "tors 1 jan." bland cupens riktiga speldagar. De har ingen dag att
    // välja, så de hör inte hemma i listan — de syns fortfarande i schemat.
    const days = [...new Set(scoped().filter((m) => m.start).map((m) => dayKey(m.start)))].sort();
    const cats = new Map();
    for (const m of scoped()) if (m.catId) cats.set(m.catId, m.catName);
    const catEntries = [...cats.entries()].sort((a, b) =>
      catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));
    expandCohortSelection(catEntries);

    // Lagväljaren smalnas av om klasser redan valts, men visas alltid —
    // "Hela cupen"-lägets potentiellt tusentals lag hanteras av buildPicker
    // självt (lat sökning, se PICKER_LAZY_THRESHOLD) i stället för att gömma
    // hela väljaren tills en klass valts, som tidigare.
    function teamPickerCandidates() {
      const pool = state.scope === "club" ? clubTeamsList : allScopedTeams();
      if (!state.cats.size) return pool;
      const smalnad = pool.filter((t) => state.cats.has(t.catId));
      // Ett VALT lag som klassfiltret smalnat bort måste ändå ligga kvar i
      // listan. Annars går det inte att kryssa ur: väljer man F13 Blå och
      // sedan klassen F14 blir träffmängden tom, och sidan säger "prova att
      // rensa något filter" om ett filter man inte längre kan se.
      const kvar = new Set(smalnad.map((t) => t.id));
      const bortfiltrerade = pool.filter((t) => state.teams.has(t.id) && !kvar.has(t.id));
      return bortfiltrerade.length ? [...smalnad, ...bortfiltrerade] : smalnad;
    }

    // Klubb/hela cupen inleder raden. Matchstatus (alla/kommande/spelade)
    // följer i stället direkt efter filterkedjan, avskild med en tunn
    // vertikal linje (.row-sep) i stället för att pressas till högerkanten
    // — pressat till kanten såg konstigt/obalanserat ut på breda skärmar
    // (stort tomrum innan den), en avdelare räcker för att visa att den
    // hör till en annan kategori (läge, inte "vad ska visas").
    const scopeSeg = h("div", { class: "seg", role: "group", "aria-label": "Omfattning" },
      chip(state.favoriteClub, state.scope === "club", () => {
        state.scope = "club"; saveUi(); render();
      }),
      chip("Hela cupen", state.scope === "all", () => {
        state.scope = "all"; saveUi(); render();
      }));
    // Matchstatus: tre synliga val på dator (man ser alternativen direkt),
    // EN växlingsknapp på mobil där utrymmet är dyrast. Knappen visar alltid
    // aktuellt läge och stegar Alla -> Kommande -> Spelade -> Alla.
    const STATUS_STEG = [["all", "Alla matcher"], ["upcoming", "Kommande"], ["played", "Spelade"]];
    const statusSeg = sheetMode()
      ? (() => {
          const i = Math.max(0, STATUS_STEG.findIndex(([v]) => v === state.matchFilter));
          return chip(STATUS_STEG[i][1], state.matchFilter !== "all", () => {
            state.matchFilter = STATUS_STEG[(i + 1) % STATUS_STEG.length][0];
            saveUi(); render();
          }, "status-cycle");
        })()
      : h("div", { class: "seg", role: "group", "aria-label": "Matchstatus" },
          [["all", "Alla"], ["upcoming", "Kommande"], ["played", "Spelade"]].map(([v, l]) =>
            chip(l, state.matchFilter === v, () => {
              state.matchFilter = v; saveUi(); render();
            })));

    // Ett enda lås fryser år+dagar+klasser+lag TILLSAMMANS (till en chip
    // bredvid "Filter och sortering", se dd/lockSlot ovan) — tanken är att
    // man gör sin inställning en gång (t.ex. på morgonen) och sedan under
    // dagens återkommande snabbtitt inte råkar rubba den. Scope och
    // matchstatus räknas INTE in — de är ett visningsläge, inte en del av
    // grundinställningen som ska skyddas.
    function lockSummary() {
      const parts = [];
      if (!state.includeCurrentYear) {
        // Utan innevarande år (state.includeCurrentYear=false) blir "+"-
        // prefixet missvisande (inget att lägga OVANPÅ) — lista bara åren.
        const years = [...state.years].sort().reverse();
        parts.push(years.length ? years.join(", ") : "inget år valt");
      } else if (state.years.size) {
        const years = [...state.years].sort().reverse();
        parts.push("+" + (years.length <= 3 ? years.join(", ") : years.length + " extra år"));
      }
      if (state.days.size) {
        const names = days.filter((d) => state.days.has(d))
          .map((d) => fmtDay.format(new Date(d + "T00:00:00Z")));
        parts.push(names.length <= 2 ? names.join(", ") : names.length + " dagar");
      }
      if (state.cats.size) {
        const names = catEntries.filter(([id]) => state.cats.has(id)).map(([, name]) => HB.shortCat(name));
        parts.push(names.length <= 3 ? names.join(", ") : names.length + " klasser");
      }
      if (state.teams.size) {
        const names = [...state.teams].map((id) => teamNameById(id)).filter(Boolean);
        parts.push(names.length <= 2 ? names.join(", ") : names.length + " lag");
      }
      return parts.join(" · ");
    }
    const isLocked = isFilterLocked();

    // teamSlot hålls vid liv separat och bara ombyggd via replaceChildren()
    // (inte hela raden) så att ett enskilt klasskryss — som INTE bygger om
    // sin egen <details>-dropdown, se buildPicker ovan — ändå kan uppdatera
    // vilka lag som blir valbara utan att hela verktygsraden (och därmed
    // öppna dropdowns) byggs om.
    const teamSlot = h("span", { style: "display:contents" });
    const refreshTeamRow = () => {
      const candidates = teamPickerCandidates();
      // En ensam kandidat filtrerar inte bort något — den väljaren göms. Men
      // finns det ett lagval kvar måste väljaren fram ändå, annars sitter
      // urkryssningen inlåst (se teamPickerCandidates ovan).
      const visa = candidates.length > 1 || state.teams.size > 0;
      teamSlot.replaceChildren(...(visa ? [buildTeamPicker(candidates, onTeamOrDayChange)] : []));
    };

    // Låskontrollen (knapp när upplåst, klickbar sammanfattnings-chip när
    // låst) byggs här men lever i lockSlot bredvid "Filter och sortering"
    // (se ovan) i stället för i filterraden — där gjorde den sig konstigt
    // placerad mitt i eller sist i en lång kedja av chips, och försvann
    // dessutom ur sikte så fort man fällde ihop panelen.
    const refreshLockSlot = () => {
      // Ingen låsknapp i mobilens ark — den skulle inte göra något (se
      // isFilterLocked) och bara ta plats i en rubrikrad där utrymmet är
      // dyrast.
      if (sheetMode() ||
          (days.length <= 1 && catEntries.length <= 1 && !archiveYears.length)) {
        lockSlot.replaceChildren(); return;
      }
      if (isFilterLocked()) {
        lockSlot.replaceChildren(
          // Nollställ vy-filtret (viewCats/viewTeams) vid upplåsning — annars
          // fortsätter det osynligt att smalna av resultatet (ingen rad kvar
          // som visar/styr det, den försvinner ju med låset) trots att
          // bas-filtrets egna, nu synliga pickers ser ut att styra allt.
          chip("🔒 " + lockSummary(), true, () => {
            state.filterLocked = false;
            state.viewCats = new Set(); state.viewTeams = new Set();
            saveUi(); render();
          }));
      } else {
        lockSlot.replaceChildren(h("button", {
          class: "btn small", type: "button",
          ...(hasLockableSelection() ? {} : { disabled: "" }),
          title: "Lås dagar, klasser och lag så att inställningen inte ändras av misstag",
          onclick: () => {
            state.filterLocked = true;
            state.viewCats = new Set(); state.viewTeams = new Set();
            saveUi(); render();
          },
        }, "🔒 Lås"));
      }
    };
    // onCatChange bygger om lagväljarens kandidater (klassvalet styr vilka
    // lag som är valbara) — onTeamOrDayChange gör INTE det, för att undvika
    // att bygga om (och därmed stänga) lagväljarens egen öppna dropdown när
    // man kryssar i den.
    const onCatChange = () => { renderContent(); refreshLockSlot(); refreshTeamRow(); };
    const onTeamOrDayChange = () => { renderContent(); refreshLockSlot(); };
    refreshLockSlot();

    if (days.length > 1 || catEntries.length > 1) {
      const row = h("div", { class: "row" }, scopeSeg);
      if (!isLocked) {
        // Element.append() (till skillnad från h()) stringifierar null/
        // undefined till en bokstavlig "null"-textnod i stället för att
        // hoppa över dem — filtrera bort inaktuella delar (ingen arkiverad
        // historik/en enda dag/en enda klass) innan de skickas in.
        const urval = [
          archiveYears.length ? buildYearPicker(archiveYears, cup().edition) : null,
          days.length > 1 ? buildDayPicker(days, onTeamOrDayChange) : null,
          catEntries.length > 1 ? buildCatPicker(catEntries, onCatChange) : null,
        ].filter((el) => el != null);
        refreshTeamRow();
        // De fyra urvalsväljarna (år/dagar/klasser/lag) i en egen grupp.
        // Som grå chips i en lång rad läste de som inaktiva knappar snarare
        // än som menyval — på mobil blir gruppen i stället fullbreddsrader
        // med etikett och värde (se .filter-group i style.css), där det är
        // uppenbart att raden går att trycka på. CSS-only-omslag: samma
        // element, samma lyssnare, bara en behållare runt.
        // "Mer" sist i remsan: på mobil är remsan allt man ser när man
        // trycker Filter, så resten av verktygsraden (sök, status, plan,
        // sortering, export) måste ha en väg in. Brickan göms över 700 px,
        // där hela raden ändå står framme.
        // Rensa allt: visas bara när det FINNS något att rensa, annars vore
        // den en död knapp i en remsa där varje bricka kostar bredd. Rensar
        // exakt det siffran på filterknappen räknar (se activeFilterCount) —
        // annars kan man trycka rensa och ändå ha en siffra kvar.
        // Byggs ALLTID och göms med hidden i stället för att utelämnas: ett
        // filterval ritar bara om innehållet, inte verktygsraden, så en
        // villkorligt skapad bricka hade inte dykt upp förrän nästa fulla
        // omritning. refreshFilterChrome växlar hidden i stället.
        const rensaTile = h("button", {
          class: "filter-more-tile filter-clear-tile", type: "button", "data-icon": "✕",
          ...(activeFilterCount() ? {} : { hidden: "" }),
          title: "Rensa all filtrering",
          onclick: () => {
            state.days.clear(); state.cats.clear(); state.teams.clear(); state.years.clear();
            state.includeCurrentYear = true;
            state.viewCats = new Set(); state.viewTeams = new Set();
            state.arena = ""; state.q = ""; state.matchFilter = "all";
            state.schemaOlderRevealCount = 0;
            saveUi();
            render();
          },
        }, "Rensa");

        const merTile = h("button", {
          class: "filter-more-tile", type: "button", "data-icon": "⋯",
          onclick: () => {
            document.body.classList.toggle("filters-expanded");
            syncFilterBackdrop();
            requestAnimationFrame(syncBottomStack);
          },
        }, "Mer");
        row.append(h("div", { class: "filter-group" },
          ...urval, teamSlot, rensaTile, merTile));
      }
      row.append(h("span", { class: "row-sep" }), statusSeg);
      body.append(row);
    } else {
      if (!isLocked) refreshTeamRow();
      body.append(h("div", { class: "row" }, scopeSeg,
        (!isLocked && archiveYears.length) ? buildYearPicker(archiveYears, cup().edition) : null,
        isLocked ? null : teamSlot,
        h("span", { class: "row-sep" }), statusSeg));
    }

    const viewFilterRow = buildViewFilterRow();
    if (viewFilterRow) body.append(viewFilterRow);

    // Sök · plan · sortering · export
    const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
    // Autocomplete-förslag: lagnamn, planer och klasser ur den synliga listan.
    const suggestSet = new Set();
    for (const m of scoped()) {
      if (m.home.name) suggestSet.add(m.home.name);
      if (m.away.name) suggestSet.add(m.away.name);
      if (m.arena) suggestSet.add(m.arena);
      if (m.catName) suggestSet.add(m.catName);
    }
    const suggestions = [...suggestSet].sort((a, b) => a.localeCompare(b, "sv"));
    const searchInput = h("input", {
      class: "search", type: "search", placeholder: "Sök lag, plan, grupp …",
      title: "Stöder & (och) och / eller , (eller), t.ex. 2011&flickor/2013",
      value: state.q, list: "search-suggestions",
      // renderContent() (inte render()) — annars byggs sökfältet om vid
      // varje tangenttryckning och tappar fokus/mobiltangentbordet.
      oninput: (e) => {
        state.q = e.target.value;
        syncUrl(); // inte saveUi() — q ska inte fastna i localStorage mellan besök
        refreshFilterChrome(); // fritextsök räknas in i filtersiffran
        renderContent();
      },
    });
    body.append(h("div", { class: "row tools-row" },
      withClearButton(searchInput),
      h("datalist", { id: "search-suggestions" },
        suggestions.map((s) => h("option", { value: s }))),
      arenas.length > 1 ? h("select", {
        class: "select", "aria-label": "Plan",
        onchange: (e) => { state.arena = e.target.value; saveUi(); render(); },
      },
        h("option", { value: "" }, "Alla planer"),
        arenas.map((a) => h("option",
          { value: a, ...(state.arena === a ? { selected: "" } : {}) }, a))) : null,
      // Sorteringsvalet och Äldst/Nyast-knappen styr bara sorted()/state.sort,
      // som enbart renderSchema() läser — meningslösa (och missvisande, som
      // om de skulle kunna omordna slutspelstabellen/standings) på övriga
      // flikar, så de visas bara i Schema.
      state.view === "schema" ? h("select", {
        class: "select", "aria-label": "Sortering",
        onchange: (e) => { state.sort = e.target.value; saveUi(); render(); },
      },
        [["tid", "Sortera: tid"], ["klass", "Sortera: klass"], ["plan", "Sortera: plan"],
         ["resultat", "Sortera: resultat"], ["mal", "Sortera: mål"]]
          .map(([v, l]) => h("option",
            { value: v, ...(state.sort === v ? { selected: "" } : {}) }, l))) : null,
      // Bara meningsfull för tidssortering — klass/plan/resultat-grupperingen
      // har ingen enskild kronologisk riktning att vända på.
      state.view === "schema" && state.sort === "tid" ? h("button", {
        class: "chip", type: "button",
        title: state.timeOrder === "desc"
          ? "Nyast/kommande överst — klicka för äldst överst"
          : "Äldst överst — klicka för nyast/kommande överst",
        onclick: () => {
          state.timeOrder = state.timeOrder === "desc" ? "asc" : "desc";
          state.schemaOlderRevealCount = 0; // ny riktning: börja om med "visa fler tidigare"
          // render() (inte renderContent()) — knappens egen etikett/state
          // ligger i verktygsraden, som bara render() bygger om.
          saveUi(); render();
        },
      }, state.timeOrder === "desc" ? "↓ Nyast överst" : "↑ Äldst överst") : null,
      buildExportPicker(),
    ));
    renderSheetCupButton();
  }

  // Exporterar exakt den synliga, filtrerade (och för Schema: sorterade)
  // datan för den flik man står på — inga dolda undantag. Schema/Bana
  // exporterar matchlistan (samma urval i alla format); Tabeller exporterar
  // de tabeller som faktiskt visas; Slutspel exporterar den visade
  // slutspelstabellen eller — om man väljer det — samtliga.
  function exportBaseName() {
    return cup().id + "-" + (state.scope === "club" ? "ahk" : "alla");
  }

  function buildExportPicker() {
    const dd = h("details", { class: "team-picker-dd export-dd" });
    const summary = h("summary", { class: "chip team-picker-summary" }, "Exportera");
    const item = (label, onClick) => h("button", {
      class: "export-item", type: "button",
      onclick: () => { onClick(); dd.open = false; },
    }, label);
    const panel = state.view === "tabeller" ? buildTablesExportPanel(item)
      : state.view === "slutspel" ? buildPlayoffExportPanel(item)
      : buildMatchExportPanel(item);
    dd.append(summary, panel);
    return dd;
  }

  // Hallarnas adressdata för INNEVARANDE cup, i den form exporterna vill ha
  // ({bannamn: {venue, street, city, lat, lng}}). Tom för ProCup/Gothia —
  // exporterna hoppar då över adresskolumnerna helt, se matchFields i
  // export.js. Kickar igång den lata hämtningen om den inte redan gjorts,
  // så en export från Schema-fliken (där Bana-vyn kanske aldrig besökts)
  // ändå får med adresserna.
  function exportArenaGeo() {
    return HB.api.arenaGeo[state.cupId] || {};
  }

  const ICS_ALARM_CHOICES = [
    ["0", "Ingen påminnelse"], ["15", "15 min innan"], ["30", "30 min innan"],
    ["60", "1 timme innan"], ["120", "2 timmar innan"], ["1440", "1 dygn innan"],
  ];

  function buildMatchExportPanel(item) {
    // Starta adresshämtningen redan när verktygsraden byggs, inte först vid
    // klicket: nedladdningen är synkron, så en geodata som fortfarande är på
    // väg hade gett en export UTAN adresser utan att någon märkte det.
    // Guardad internt, så det här är en no-op efter första gången.
    ensureCupArenaGeo(state.cupId);
    // Påminnelsevalet sitter direkt i exportpanelen (inte i Inställningar)
    // eftersom det bara betyder något i just den här handlingen — men
    // sparas ändå, så den som alltid vill ha 1 timme slipper välja om varje
    // gång. Ett eget klick före nedladdningen; <select> stänger inte
    // <details>-menyn så .ics-knappen ligger kvar under.
    const alarmSel = h("select", {
      class: "select export-alarm", "aria-label": "Påminnelse i kalendern",
      onchange: (e) => {
        state.icsAlarmMinutes = +e.target.value || 0;
        persist("hb:icsAlarmMinutes", String(state.icsAlarmMinutes));
      },
    }, ICS_ALARM_CHOICES.map(([v, l]) => h("option",
      { value: v, ...(String(state.icsAlarmMinutes) === v ? { selected: "" } : {}) }, l)));

    return h("div", { class: "team-picker-panel export-panel" },
      item("📅 Kalender (.ics)", () => {
        const list = sorted(filtered());
        if (list.length) {
          HB.ics.download(cup(), list, exportBaseName() + ".ics", state.matchMinutes,
            exportArenaGeo(), state.icsAlarmMinutes);
        }
      }),
      h("div", { class: "export-alarm-row" },
        h("span", { class: "muted" }, "🔔"), alarmSel),
      // Ångrar man en import av femtio matcher till sin vanliga kalender
      // finns ingen "ångra" — de måste plockas bort en och en. Tipset står
      // här, i själva ögonblicket före nedladdningen, inte bara i manualen.
      h("p", { class: "export-note muted" },
        "Tips: skapa en egen kalender i telefonen för cupen och importera dit " +
        "— då kan du radera allt i ett svep efteråt. ",
        h("a", { href: "hjalp.html#export", target: "_blank", rel: "noopener" },
          "Så gör du")),
      item("📊 Kalkylark (.xlsx)", () => {
        const list = sorted(filtered());
        if (list.length) HB.xlsx.download(cup(), list, exportBaseName() + ".xlsx", exportArenaGeo());
      }),
      item("CSV (.csv)", () => {
        const list = sorted(filtered());
        if (list.length) HB.csv.download(cup(), list, exportBaseName() + ".csv", exportArenaGeo());
      }),
      // Kopierar i stället för att ladda ner — ProCue DJ importerar schemat
      // genom inklistring i sin Inspring-flik, så urklipp är hela vägen fram.
      // Exporterar samma filtrerade urval som allt annat här: filtrera på
      // klubb eller hall först, så slipper DJ:n fyrtio matcher hen inte spelar.
      //
      // Byggs för hand i stället för via item(): den stänger menyn direkt vid
      // klick, och då hade kvittensen aldrig synts. Samma text-i-knappen-
      // kvittens som "kopiera inställningar" i welcome.js.
      (() => {
        const label = "🎧 Till ProCue DJ (kopiera)";
        const btn = h("button", { class: "export-item", type: "button" }, label);
        btn.onclick = () => {
          const list = sorted(filtered());
          if (!list.length) return;
          HB.procue.copy(cup(), list, exportBaseName() + "-procue.json").then((copied) => {
            btn.textContent = copied
              ? list.length + " matcher kopierade! ✓"
              : "nedladdad i stället ✓";
            setTimeout(() => (btn.textContent = label), 2500);
          });
        };
        return btn;
      })(),
      item("JSON (.json)", () => {
        const list = sorted(filtered());
        if (list.length) {
          const geo = exportArenaGeo();
          HB.json.downloadTable(HB.matchFieldsFor(list, geo), HB.exportRows(list, geo),
            exportBaseName() + ".json");
        }
      }),
      item("XML (.xml)", () => {
        const list = sorted(filtered());
        if (list.length) {
          const geo = exportArenaGeo();
          HB.xmlExport.downloadTable(HB.matchFieldsFor(list, geo), HB.exportRows(list, geo),
            "matcher", "match", exportBaseName() + ".xml");
        }
      }),
      buildSendToPhoneBlock());
  }

  // "Öppna i telefonen": sitter man vid datorn och har filtrerat fram sina
  // lag är det själva URL:en man vill flytta över, inte filen — på telefonen
  // kan man sedan lägga matcherna i kalendern där de ska ligga (och där
  // prenumerationen fungerar). En QR-kod är den enda vägen som varken kräver
  // inloggning, e-post eller att båda enheterna är på samma nät; Bluetooth
  // går över huvud taget inte att nå från en webbsida.
  //
  // Bara på dator: står man redan i telefonen är QR-koden meningslös.
  function buildSendToPhoneBlock() {
    if (sheetMode() || !HB.qr) return null;
    const box = h("div", { class: "export-phone" });
    const toggle = h("button", { class: "export-item", type: "button" }, "📱 Öppna i telefonen");
    const panel = h("div", { class: "export-phone-panel", hidden: "" });
    let built = false;
    toggle.addEventListener("click", () => {
      const show = panel.hidden;
      panel.hidden = !show;
      if (!show || built) return;
      built = true;
      // Länken speglar exakt den vy man står i (syncUrl har redan skrivit
      // filter, sortering och vald flik till adressfältet).
      const url = location.href;
      const svg = HB.qr.svg(url, { label: "QR-kod till den här vyn" });
      panel.append(
        svg || h("p", { class: "muted" }, "Länken är för lång för en QR-kod — kopiera den i stället."),
        h("p", { class: "muted" },
          "Skanna med telefonens kamera så öppnas exakt den här vyn där — " +
          "med dina filter kvar. Lägg sedan matcherna i kalendern från telefonen."),
        h("div", { class: "export-phone-btns" },
          (() => {
            const copyBtn = h("button", { class: "btn small", type: "button" }, "Kopiera länk");
            copyBtn.addEventListener("click", () => {
              navigator.clipboard.writeText(url).then(() => {
                copyBtn.textContent = "Kopierad ✓";
                setTimeout(() => (copyBtn.textContent = "Kopiera länk"), 2000);
              }).catch(() => { copyBtn.textContent = "Kunde inte kopiera"; });
            });
            return copyBtn;
          })(),
          h("a", {
            class: "btn small",
            href: "mailto:?subject=" + encodeURIComponent(cup().name + " – mitt schema") +
              "&body=" + encodeURIComponent(
                "Här är matcherna jag filtrerat fram i cupschema:\n\n" + url + "\n"),
          }, "Skicka med e-post")));
    });
    box.append(toggle, panel);
    return box;
  }

  const TABLE_EXPORT_FIELDS = [
    { label: "Klass", key: "klass" }, { label: "Grupp", key: "grupp" },
    { label: "#", key: "plac" }, { label: "Lag", key: "lag" },
    { label: "S", key: "spelade" }, { label: "V", key: "vunna" },
    { label: "O", key: "oavgjorda" }, { label: "F", key: "forlorade" },
    { label: "+/-", key: "malskillnad" }, { label: "P", key: "poang" },
  ];

  // Samma divisioner som renderTables() faktiskt visar (divisionsToShow()),
  // med samma tabelldata (state.tables, redan hämtad av renderTables) —
  // ingen egen fetch, exporten är alltid i synk med det man ser på skärmen.
  function tablesExportData() {
    const rows = [];
    for (const d of divisionsToShow()) {
      const t = state.tables[d.id];
      if (!t || t.status !== "done" || !t.rows.length) continue;
      const klass = d.catName + (state.years.size ? " " + (d.edition || cup().edition) : "");
      t.rows.forEach((r, i) => {
        rows.push({
          klass, grupp: d.name || "Grupp", plac: i + 1, lag: r.name,
          spelade: r.played, vunna: r.won, oavgjorda: r.tied, forlorade: r.lost,
          malskillnad: r.gf - r.ga, poang: r.points,
        });
      });
    }
    return { fields: TABLE_EXPORT_FIELDS, rows };
  }

  function buildTablesExportPanel(item) {
    return h("div", { class: "team-picker-panel export-panel" },
      item("📊 Kalkylark (.xlsx)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.xlsx.downloadTable(fields, rows, exportBaseName() + "-tabeller.xlsx", "Tabeller");
      }),
      item("CSV (.csv)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.csv.downloadTable(fields, rows, exportBaseName() + "-tabeller.csv");
      }),
      item("JSON (.json)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.json.downloadTable(fields, rows, exportBaseName() + "-tabeller.json");
      }),
      item("XML (.xml)", () => {
        const { fields, rows } = tablesExportData();
        if (rows.length) HB.xmlExport.downloadTable(fields, rows, "tabeller", "rad", exportBaseName() + "-tabeller.xml");
      }));
  }

  const PLAYOFF_EXPORT_FIELDS = [
    { label: "Klass", key: "klass" }, { label: "Slutspel", key: "slutspel" },
    { label: "Omgång", key: "omgang" }, { label: "Nr", key: "nr" },
    { label: "Hemmalag", key: "hemmalag" }, { label: "Bortalag", key: "bortalag" },
    { label: "Resultat", key: "resultat" }, { label: "Tid", key: "tid" }, { label: "Bana", key: "bana" },
  ];

  // Vilken klass/division renderPlayoffs() just nu faktiskt visar — samma
  // urvalslogik som där (state.playoffCatTab/state.playoffDivTab), men
  // fristående av den fungerar oavsett om trädet eller tabellen är byggd.
  function currentPlayoffSelection() {
    const cats = categoriesToShow();
    if (!cats.length) return null;
    const selCat = cats.length > 1 ? (cats.find((c) => c.catId === state.playoffCatTab) || cats[0]) : cats[0];
    const p = state.playoffs[selCat.catId];
    if (!p || p.status !== "done" || !p.divisions.length) return { cat: selCat, div: null };
    const selDiv = p.divisions.length > 1
      ? (p.divisions.find((d) => d.id === state.playoffDivTab[selCat.catId]) || p.divisions[0])
      : p.divisions[0];
    return { cat: selCat, div: selDiv };
  }

  // Naturlig ordning (finalen överst) — samma princip som bracketTableBlock().
  function playoffDivExportRows(cat, div) {
    const klass = cat.catName + (state.years.size ? " " + (cat.edition || cup().edition) : "");
    return groupPlayoffRounds(div).flatMap(([, ms]) => ms).reverse().map((m) => ({
      klass, slutspel: div.name || "", omgang: m.roundName || "", nr: m.matchNr || "",
      hemmalag: m.home.name || "TBD", bortalag: m.away.name || "TBD",
      resultat: scoreText(m.res) || "",
      tid: dayKeyFmt.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)),
      bana: m.arena || "",
    }));
  }

  function playoffExportData(scopeAll) {
    let rows = [];
    if (scopeAll) {
      for (const cat of categoriesToShow()) {
        const p = state.playoffs[cat.catId];
        if (!p || p.status !== "done") continue;
        for (const div of p.divisions) rows = rows.concat(playoffDivExportRows(cat, div));
      }
    } else {
      const sel = currentPlayoffSelection();
      if (sel && sel.div) rows = playoffDivExportRows(sel.cat, sel.div);
    }
    return { fields: PLAYOFF_EXPORT_FIELDS, rows };
  }

  // "Samtliga tabeller" kan innebära klasser vars slutspel aldrig hämtats
  // (renderPlayoffs laddar bara den just visade klassen) — startar hämtning
  // för alla och väntar kort in dem innan export, i stället för att tyst
  // exportera ett ofullständigt urval.
  async function ensureAllPlayoffsLoaded(cats) {
    for (const cat of cats) ensurePlayoffs(cat.catId, cat.edition);
    for (let i = 0; i < 50; i++) {
      if (cats.every((cat) => state.playoffs[cat.catId] && state.playoffs[cat.catId].status !== "loading")) return;
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  let exportPlayoffScope = "current"; // session, sparas ej — samma princip som bracketSort

  function buildPlayoffExportPanel(item) {
    const scopeBtnCurrent = h("button", { class: "chip", type: "button" }, "Visad tabell");
    const scopeBtnAll = h("button", { class: "chip", type: "button" }, "Samtliga tabeller");
    const syncScope = () => {
      scopeBtnCurrent.classList.toggle("on", exportPlayoffScope === "current");
      scopeBtnAll.classList.toggle("on", exportPlayoffScope === "all");
    };
    scopeBtnCurrent.onclick = () => { exportPlayoffScope = "current"; syncScope(); };
    scopeBtnAll.onclick = () => { exportPlayoffScope = "all"; syncScope(); };
    syncScope();
    const run = async (fn) => {
      const all = exportPlayoffScope === "all";
      if (all) await ensureAllPlayoffsLoaded(categoriesToShow());
      const { fields, rows } = playoffExportData(all);
      if (rows.length) fn(fields, rows);
    };
    return h("div", { class: "team-picker-panel export-panel" },
      h("div", { class: "team-picker-sort-row" }, scopeBtnCurrent, scopeBtnAll),
      item("📊 Kalkylark (.xlsx)", () => run((fields, rows) =>
        HB.xlsx.downloadTable(fields, rows, exportBaseName() + "-slutspel.xlsx", "Slutspel"))),
      item("CSV (.csv)", () => run((fields, rows) =>
        HB.csv.downloadTable(fields, rows, exportBaseName() + "-slutspel.csv"))),
      item("JSON (.json)", () => run((fields, rows) =>
        HB.json.downloadTable(fields, rows, exportBaseName() + "-slutspel.json"))),
      item("XML (.xml)", () => run((fields, rows) =>
        HB.xmlExport.downloadTable(fields, rows, "slutspel", "match", exportBaseName() + "-slutspel.xml"))));
  }

  // --- render: hero (nästa match) ------------------------------------------

  const HERO_MAX = 5;

  // Klubbens närmast kommande matcher (upp till HERO_MAX stycken), tidigast
  // först — inte bara EN godtyckligt plockad match, så heron kan visa dem
  // som en karusell att bläddra igenom (t.ex. flera lag som spelar samma
  // dag, eller flera som råkar starta exakt samtidigt på olika planer).
  function nextClubMatches() {
    const now = Date.now();
    const pool = state.matches.filter(isClubMatch).filter((m) => {
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      return !(m.res && m.res.fin) && m.start >= now - 30 * 60000;
    });
    return pool
      .sort((a, b) => a.start - b.start ||
        (a.arena || "").localeCompare(b.arena || "", "sv", { numeric: true }))
      .slice(0, HERO_MAX);
  }

  function nextClubMatch() {
    return nextClubMatches()[0] || null;
  }

  function countdownText(ms) {
    const diff = ms - Date.now();
    if (diff <= 0) return "nu";
    const min = Math.round(diff / 60000);
    if (min < 60) return "om " + min + " min";
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return "om " + hrs + " h " + (min % 60) + " min";
    return "om " + Math.floor(hrs / 24) + " d";
  }

  // Vilket kort i karusellen som visas — modulvariabel (inte i state) så
  // den överlever renderContent()-omritningar men glöms bort vid cupbyte.
  let heroIndex = 0;

  // Auto-skrollet till NU-linjen ska bara ske en gång per sidladdning/
  // cupbyte — inte vid VARJE renderContent() (annars rycker sidan iväg
  // varje gång man t.ex. swipear i nästa match-karusellen, söker, eller
  // byter filter). Nollställs i switchCup().
  let autoScrolledToNow = false;

  // Auto-rotationens timer måste rensas vid VARJE renderHero()-anrop
  // (inte bara när karusellen försvinner) — annars pekar en gammal
  // timer-closure på en förlegad matches-array från en tidigare omritning.
  let heroAutoTimer = null;
  const HERO_AUTO_MS = 6000;

  // Riktningen på det senaste bytet (1 = framåt/nästa, -1 = bakåt/förra) —
  // styr vilket håll det nya kortet glider in ifrån. En fristående modul-
  // variabel (som heroIndex) eftersom den ska överleva renderContent().
  let heroDir = 1;

  // Vilket index som senast fick glid-in-animationen — så en omritning
  // som INTE beror på ett karusellbyte (t.ex. ett filterval någon
  // annanstans på sidan) inte råkar spela upp animationen i onödan.
  let heroLastAnimatedIdx = null;

  function renderHero(main) {
    clearInterval(heroAutoTimer);
    const matches = nextClubMatches();
    if (!matches.length) return;
    if (heroIndex >= matches.length) heroIndex = 0;
    const isNewCard = heroLastAnimatedIdx !== heroIndex;
    heroLastAnimatedIdx = heroIndex;
    const m = matches[heroIndex];
    const live = isLive(m);
    const carousel = matches.length > 1;
    const step = (dir) => {
      heroDir = dir;
      heroIndex = (heroIndex + dir + matches.length) % matches.length;
      renderContent();
    };
    const goTo = (i) => {
      heroDir = i > heroIndex ? 1 : -1;
      heroIndex = i;
      renderContent();
    };
    // <details> ger minimera/expandera gratis (samma mönster som
    // toolbar-collapse) — state.heroMinimized överlever omritningar så en
    // manuell minimering inte studsar tillbaka öppen vid nästa render().
    const heroEl = h("details", {
      class: "hero" + (carousel ? " hero-carousel" : ""), id: "hero",
      ...(state.heroMinimized ? {} : { open: "" }),
    },
      h("summary", { class: "hero-summary" },
        live ? h("span", { class: "live-dot" }) : null,
        live ? "Pågår nu" : (heroIndex === 0 ? "Nästa match" : "Kommande match"),
        h("span", { class: "hero-count" }, live ? "" : countdownText(m.start))),
      carousel ? h("button", {
        class: "hero-nav hero-prev", type: "button", "aria-label": "Föregående match",
        onclick: () => step(-1),
      }, "‹") : null,
      carousel ? h("button", {
        class: "hero-nav hero-next", type: "button", "aria-label": "Nästa match",
        onclick: () => step(1),
      }, "›") : null,
      h("div", {
        class: "hero-card" +
          (isNewCard ? (heroDir < 0 ? " hero-card-prev" : " hero-card-next") : ""),
      },
        h("div", { class: "hero-teams" },
          h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name,
            isFavoriteTeam(m.home.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null),
          h("span", { class: "vs" }, live && scoreText(m.res) ? scoreText(m.res) : "mot"),
          h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name,
            isFavoriteTeam(m.away.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null)),
        h("div", { class: "hero-info" },
          fmtDayLong.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)),
          h("span", { class: "dot" }, "·"), m.arena || "plan ej satt",
          h("span", { class: "dot" }, "·"),
          HB.shortCat(m.catName) + (m.divName ? " " + m.divName : ""),
          (() => {
            const w = HB.weather.at(HB.weather.cached(cup()), m.start);
            return w ? [h("span", { class: "dot" }, "·"), w.icon + " " + w.temp + "°"] : null;
          })())),
      carousel ? h("div", { class: "hero-dots" },
        matches.map((_, i) => h("button", {
          class: "hero-dot" + (i === heroIndex ? " on" : ""), type: "button",
          "aria-label": "Match " + (i + 1) + " av " + matches.length,
          onclick: () => goTo(i),
        }))) : null);
    heroEl.addEventListener("toggle", () => { state.heroMinimized = !heroEl.open; });
    main.append(heroEl);
    if (!carousel) return;

    // Auto-rotation — pausar när fliken inte är synlig (ingen anledning
    // att bläddra i bakgrunden) och nollställs vid varje omritning, så en
    // manuell swipe/klick/prick skjuter naturligt upp nästa auto-steg.
    // Självstädande: om man byter bort från schemavyn slutar heron
    // renderas (och renderHero() slutar därmed rensa timern), så den
    // kollar själv och stänger av sig i stället för att tugga i bakgrunden.
    heroAutoTimer = setInterval(() => {
      if (state.view !== "schema") { clearInterval(heroAutoTimer); return; }
      if (document.visibilityState === "visible") step(1);
    }, HERO_AUTO_MS);

    // Swipe (touch) — vänster/höger byter kort. Kräver en tydligt
    // horisontell rörelse (annars tolkas det som vanlig vertikal
    // sidskrollning, inte ett byte).
    let touchX = null, touchY = null;
    heroEl.addEventListener("touchstart", (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }, { passive: true });
    heroEl.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        step(dx < 0 ? 1 : -1);
      }
    });
  }

  // --- matchdialog: lagstatistik + snabblänkar --------------------------------

  function teamMatchCounts(teamId) {
    let played = 0, upcoming = 0;
    for (const m of state.matches) {
      if (m.home.id !== teamId && m.away.id !== teamId) continue;
      if (m.res && m.res.fin) played++; else upcoming++;
    }
    return { total: played + upcoming, played, upcoming };
  }

  function findTableRow(rows, team) {
    return rows.find((r) => r.teamId === team.id) ||
      rows.find((r) => r.name === team.name);
  }

  // Sparar det filter (scope, dagar, klasser, lag, plan, matchstatus,
  // sortering) som gällde INNAN man hoppade till en enskild matchs/lags
  // schema via gotoMatch()/gotoTeamMatches() — så grundinställningen kan
  // återställas efteråt i stället för att bara försvinna. Skrivs bara om
  // det inte redan finns ett sparat läge, så flera hopp i följd (t.ex.
  // klicka vidare från en matchdialog till en annan) alltid går tillbaka
  // till den UR­SPRUNGLIGA grundinställningen, inte den senaste mellanvyn.
  let stashedFilter = null;

  function stashFilterIfNeeded() {
    if (stashedFilter) return;
    stashedFilter = {
      scope: state.scope, days: new Set(state.days), cats: new Set(state.cats),
      teams: new Set(state.teams), arena: state.arena,
      matchFilter: state.matchFilter, sort: state.sort,
    };
  }

  function restoreStashedFilter() {
    if (!stashedFilter) return false;
    state.scope = stashedFilter.scope;
    state.days = new Set(stashedFilter.days);
    state.cats = new Set(stashedFilter.cats);
    state.teams = new Set(stashedFilter.teams);
    state.arena = stashedFilter.arena;
    state.matchFilter = stashedFilter.matchFilter;
    state.sort = stashedFilter.sort;
    stashedFilter = null;
    saveUi();
    render();
    return true;
  }

  // Navigerar till schemavyn med båda lagen i en specifik match filtrerade
  // fram (klubb- eller motståndarlag, oavsett) — så en slutspelsmatch går
  // att se i sitt naturliga sammanhang bland lagens övriga matcher, i
  // stället för bara i en isolerad dialogruta.
  function gotoMatch(m) {
    stashFilterIfNeeded();
    state.scope = "all";
    state.q = "";
    state.teams = new Set([m.home.id, m.away.id].filter((id) => id != null));
    state.cats = new Set();
    state.days = new Set();
    state.arena = "";
    state.matchFilter = "all";
    state.sort = "tid";
    state.view = "schema";
    saveUi();
    render();
  }

  function gotoTeamMatches(team, mode) {
    // Filtrera på exakt lag-id, inte namnsökning — flera lag delar ofta
    // prefix ("Alingsås HK" är ett substräng-delnamn av "Alingsås HK Blå"
    // m.fl.), så en textsökning skulle dra in alla syskonlagens matcher.
    stashFilterIfNeeded();
    state.scope = "all";
    state.q = "";
    state.teams = new Set([team.id]);
    state.cats = new Set();
    state.days = new Set();
    state.arena = "";
    state.matchFilter = mode;
    state.view = "schema";
    saveUi();
    closeMatchDialog();
    render();
  }

  function teamNameById(id) {
    const m = state.matches.find((mm) => mm.home.id === id || mm.away.id === id);
    if (!m) return null;
    return m.home.id === id ? m.home.name : m.away.name;
  }

  function closeMatchDialog() {
    const dlg = $(".match-dialog");
    if (dlg) dlg.close();
  }

  // Trupplista (om cupen har sådan data, se cup.hasRosters) — shirtnummer,
  // position, mål. Bara Partille/Gothia-cuper hittills, och bara för lag
  // som faktiskt matat in en trupp (de flesta yngre/mindre lag har ingen).
  function rosterBlock(team, edition) {
    if (!cup().hasRosters) return null;
    const players = rosterFor(team, edition);
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) =>
      (a.shirtNr == null ? 999 : a.shirtNr) - (b.shirtNr == null ? 999 : b.shirtNr));
    return h("div", { class: "team-roster" },
      h("h4", null, "Trupp"),
      h("ul", { class: "team-roster-list" },
        sorted.map((p) => h("li", null,
          h("span", { class: "roster-nr" }, p.shirtNr != null ? String(p.shirtNr) : "–"),
          h("span", { class: "roster-name" }, p.name),
          p.position ? h("span", { class: "roster-pos" }, p.position) : null,
          p.goals ? h("span", { class: "roster-goals" }, p.goals + " mål") : null))));
  }

  // Andra vägen in till favoritlagen: hittar man laget i schemat, en tabell
  // eller i historikbläddrarens gamla upplagor ska man kunna stjärnmärka det
  // på plats, i stället för att memorera namnet och skriva in det i
  // Inställningar. Lägger till i state.favoriteTeams — samma lista som
  // fältet där, så de två alltid speglar varandra.
  //
  // catName kommer från matchen laget klickades upp ur och ger årskullen
  // (F2011), så stjärnan sätts på RÄTT "Alingsås HK 1" av de tre som finns.
  function favoriteTeamToggle(team, catName) {
    const name = (team.name || "").trim();
    if (!name) return null;
    const cohort = cohortKey(catName);
    const btn = h("button", { class: "btn small", type: "button" });
    // Rutan är en fristående dialog som render() inte ritar om, så knappen
    // måste spegla sitt eget läge — annars såg den likadan ut efter klicket
    // och man kunde varken se att stjärnan satt eller ångra den på plats.
    const label = name + (cohort ? " (" + cohortLabel(catName) + ")" : "");
    const sync = () => {
      const on = favoriteTeamIndex(name, cohort) >= 0;
      btn.classList.toggle("on", on);
      btn.textContent = on ? "★ Favoritlag" : "☆ Gör till favoritlag";
      btn.title = on
        ? "Ta bort " + label + " ur dina favoritlag"
        : "Lägg till " + label + " bland dina favoritlag — det får en ⭐ i schemat";
    };
    btn.addEventListener("click", () => {
      const i = favoriteTeamIndex(name, cohort);
      if (i >= 0) state.favoriteTeams.splice(i, 1);
      else state.favoriteTeams.push({ name, cohort });
      // Favoritlagen hör ihop med en klubb: stjärnmärker man ett lag ur en
      // ANNAN klubb än den valda skulle klubbfiltret ("Alingsås HK"/"Hela
      // cupen") och lagets stjärna peka åt olika håll. Följ laget användaren
      // just pekade på — men bara när man LÄGGER TILL, annars skulle ett
      // borttag också flytta klubbvalet.
      if (i < 0 && team.club && team.club.trim()) state.favoriteClub = team.club.trim();
      saveSettings();
      renderFavoriteTeamList();
      const clubField = $("#favoriteClubInput");
      if (clubField) clubField.value = state.favoriteClub;
      sync();
      render();
    });
    sync();
    return btn;
  }

  function teamStatBlock(m, team, side) {
    const counts = teamMatchCounts(team.id);
    const statLine = h("p", { class: "muted team-stat-line" }, "Hämtar tabellplacering …");
    // webcal:// gör att kalenderappen PRENUMERERAR (auto-uppdaterar) i stället
    // för att bara ladda ner en engångsfil — det som knappen faktiskt lovar.
    const rawCalUrl = calendarSubscribeUrl(team);
    const calUrl = rawCalUrl
      ? new URL(rawCalUrl, location.href).href.replace(/^https?:/i, "webcal:")
      : null;
    const box = h("div", { class: "team-stat-block" },
      h("h3", { class: isClubName(team.name) ? "us" : "" }, team.name),
      statLine,
      h("p", { class: "muted" },
        counts.total + " matcher totalt · " + counts.played + " spelade · " +
        counts.upcoming + " kommande"),
      h("div", { class: "team-stat-actions" },
        h("button", {
          class: "btn small", type: "button",
          disabled: counts.upcoming === 0 ? "" : null,
          onclick: () => gotoTeamMatches(team, "upcoming"),
        }, "Kommande matcher"),
        h("button", {
          class: "btn small", type: "button",
          disabled: counts.played === 0 ? "" : null,
          onclick: () => gotoTeamMatches(team, "played"),
        }, "Spelade matcher"),
        calUrl ? h("a", {
          class: "btn small", href: calUrl, rel: "noopener",
          title: "Öppnar din kalenderapp och prenumererar på lagets matcher — nya/ändrade tider uppdateras sen automatiskt (funkar bäst på mobil).",
        }, "📅 Prenumerera") : null,
        favoriteTeamToggle(team, m.catName)),
      rosterBlock(team, m.edition));

    if (!m.divId) {
      statLine.textContent = "Ingen tabell tillgänglig för den här klassen.";
      return box;
    }
    ensureDialogTable(m.divId).then((rows) => {
      if (!rows.length) {
        statLine.textContent = "Ingen tabell tillgänglig för den här gruppen.";
        return;
      }
      const idx = rows.findIndex((r) => r === findTableRow(rows, team));
      if (idx < 0) {
        statLine.textContent = "Laget hittades inte i gruppens tabell.";
        return;
      }
      const r = rows[idx];
      statLine.textContent = "#" + (idx + 1) + " i " + m.divName + " · " +
        r.played + " S, " + r.won + "V–" + r.tied + "O–" + r.lost + "F · " +
        r.gf + "–" + r.ga + " · " + r.points + " p";
    });
    return box;
  }

  let dialogTableCache = {};

  function ensureDialogTable(divId) {
    if (!dialogTableCache[divId]) {
      dialogTableCache[divId] = HB.api.fetchTable(cup(), divId).catch(() => []);
    }
    return dialogTableCache[divId];
  }

  function previousMeetingsBlock(m) {
    const box = h("div", { class: "prev-meetings" });
    HB.api.fetchPreviousMeetings(cup(), m.id).then((meetings) => {
      if (!meetings.length) { box.remove(); return; }
      box.append(
        h("h4", null, "Tidigare möten"),
        h("ul", { class: "prev-meetings-list" },
          meetings.map((pm) => h("li", null,
            fmtDay.format(new Date(pm.start)) + ": " + pm.home.name + " " +
            (scoreText(pm.res) || "–") + " " + pm.away.name))));
    }).catch(() => box.remove());
    return box;
  }

  // Lättviktig snabbvy för ETT lag (tabellplacering + kommande/spelade),
  // öppnad genom att klicka direkt på ett lagnamn i ett matchkort — utan
  // att behöva öppna hela matchdialogen (som visar båda lagen).
  function openTeamQuickView(m, team) {
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      teamStatBlock(m, team));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // Filtrerar schemat till en specifik plan — återanvänder samma
  // state.arena som plan-dropdownen i verktygsraden, så "Alla planer"
  // där är den naturliga vägen tillbaka. Anropas numera bara explicit
  // (knappen i openArenaQuickView), inte direkt vid klick på en bana —
  // se den funktionen för varför.
  function filterByArena(arena) {
    stashFilterIfNeeded();
    state.arena = arena;
    saveUi();
    render();
  }

  // Snabbtitt på en specifik plan — UTAN att röra det aktuella filtret.
  // Tänkt för att stå vid en bana och snabbt se vad som spelas där, sedan
  // stänga och vara kvar exakt där man var — till skillnad från
  // filterByArena() (som byter hela schemavyn och kräver "Tillbaka" för
  // att ångra). Listar ALLA matcher på banan, oavsett aktuellt filter.
  function openArenaQuickView(arena) {
    const matches = state.matches
      .filter((m) => m.arena === arena)
      .sort((a, b) => a.start - b.start);
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      h("div", { class: "match-dialog-head" },
        h("span", { class: "cat" }, arena),
        h("span", null, matches.length + " matcher")),
      h("button", {
        class: "btn small", type: "button",
        onclick: () => { dlg.close(); filterByArena(arena); },
      }, "Filtrera schemat till " + arena),
      h("div", { class: "arena-quick-list" }, matches.map(matchCard)));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // --- historik: jämför resultat mellan cupens år -------------------------

  // Plockar ut matcher för lag vars namn innehåller `query` (case-
  // insensitive delsträng — så "Alingsås HK" fångar alla klubbens lag,
  // medan ett mer specifikt namn ger ett enskilt lag) och berikar varje
  // rad med `opponent`/`outcome`/`homeIsUs` för filtrering/sortering.
  // Ingen teamId att matcha mot: id:n är inte stabila mellan cupens år.
  function summarizeArchiveMatches(matches, query) {
    const q = query.trim().toLowerCase();
    const rows = [];
    if (!q) return rows;
    for (const m of matches) {
      const homeIsUs = m.home.name.toLowerCase().includes(q);
      const awayIsUs = m.away.name.toLowerCase().includes(q);
      if (!homeIsUs && !awayIsUs) continue;
      let outcome = null;
      if (m.res && m.res.fin) {
        outcome = !m.res.winner ? "O" : ((m.res.winner === "home") === homeIsUs ? "V" : "F");
      }
      rows.push({ ...m, homeIsUs, opponent: homeIsUs ? m.away.name : m.home.name, outcome });
    }
    return rows;
  }

  function archiveStats(rows) {
    let played = 0, won = 0, tied = 0, lost = 0, gf = 0, ga = 0;
    for (const r of rows) {
      if (!r.res || !r.res.fin) continue;
      played++;
      gf += (r.homeIsUs ? r.res.hg : r.res.ag) || 0;
      ga += (r.homeIsUs ? r.res.ag : r.res.hg) || 0;
      if (r.outcome === "V") won++;
      else if (r.outcome === "F") lost++;
      else if (r.outcome === "O") tied++;
    }
    return { played, won, tied, lost, gf, ga };
  }

  const ARCHIVE_SORTS = [
    ["tid_desc", "Sortera: nyast"], ["tid_asc", "Sortera: äldst"],
    ["resultat", "Sortera: resultat"], ["motstandare", "Sortera: motståndare"],
    ["klass", "Sortera: klass"],
  ];

  function sortArchiveRows(rows, sortKey) {
    const arr = rows.slice();
    const rank = { V: 0, O: 1, F: 2 };
    if (sortKey === "tid_asc") arr.sort((a, b) => a.start - b.start);
    else if (sortKey === "resultat") {
      arr.sort((a, b) => (rank[a.outcome] ?? 3) - (rank[b.outcome] ?? 3) || b.start - a.start);
    } else if (sortKey === "motstandare") {
      arr.sort((a, b) => a.opponent.localeCompare(b.opponent, "sv"));
    } else if (sortKey === "klass") {
      arr.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
        a.opponent.localeCompare(b.opponent, "sv"));
    } else {
      arr.sort((a, b) => b.start - a.start); // tid_desc (förval)
    }
    return arr;
  }

  // Liten stjärnknapp vid ett lagnamn i historikens rader. Arkiverade
  // matcher har ingen livetabell att slå upp, så lagrutan (teamStatBlock)
  // går inte att öppna här — men man ska ändå kunna stjärnmärka ett lag man
  // hittar bland tidigare års resultat, utan att gå omvägen via
  // Inställningar. Årskullen tas ur matchens klass precis som överallt
  // annars, så rätt lag träffas.
  function archiveFavStar(name, catName) {
    const clean = (name || "").trim();
    if (!clean || isPlaceholderTeam({ name: clean })) return null;
    const cohort = cohortKey(catName);
    const btn = h("button", { class: "arch-fav", type: "button" });
    const sync = () => {
      const on = favoriteTeamIndex(clean, cohort) >= 0;
      btn.classList.toggle("on", on);
      btn.textContent = on ? "⭐" : "☆";
      btn.title = (on ? "Ta bort " : "Lägg till ") + clean +
        (cohort ? " (" + cohortLabel(catName) + ")" : "") +
        (on ? " ur dina favoritlag" : " bland dina favoritlag");
      btn.setAttribute("aria-pressed", String(on));
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = favoriteTeamIndex(clean, cohort);
      if (i >= 0) state.favoriteTeams.splice(i, 1);
      else state.favoriteTeams.push({ name: clean, cohort });
      saveSettings();
      renderFavoriteTeamList();
      sync();
    });
    sync();
    return btn;
  }

  function archiveMatchRow(m) {
    const sc = scoreText(m.res);
    return h("div", { class: "arch-row" },
      h("span", { class: "arch-date" },
        fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))),
      h("span", { class: "arch-teams" },
        h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name),
        archiveFavStar(m.home.name, m.catName),
        " – ",
        h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name),
        archiveFavStar(m.away.name, m.catName)),
      m.outcome ? h("span",
        { class: "outcome-badge outcome-" + m.outcome.toLowerCase() }, m.outcome) : null,
      h("span", { class: "arch-score" }, sc || "–"),
      m.catName ? h("span", { class: "arch-cat" }, HB.shortCat(m.catName)) : null);
  }

  // Grupperar en lista matcher per divId — samma divisionsform
  // ({id,name,matches}) som HB.api.fetchPlayoffs() ger live, så
  // bracketBlock/groupPlayoffRounds/drawBracketConnectors kan återanvändas
  // rakt av oavsett källa (arkiverad edition via historicalPlayoffDivisions
  // nedan, ELLER ett extra år inblandat i huvudappen, se ensurePlayoffs()).
  function groupPlayoffDivisionsById(matches) {
    const byDiv = new Map();
    for (const m of matches) {
      if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
      byDiv.get(m.divId).matches.push(m);
    }
    return [...byDiv.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
  }

  // Grupperar en arkiverad edition ALLA matcher (inte bara den sökta
  // klubbens) för en given klass i slutspelsträd. divType (satt av
  // scripts/fetch_cupmanager.py sedan 2026-07) är det enda tillförlitliga
  // sättet att skilja slutspel från gruppspel — roundRank kan vara 0 för
  // båda.
  function historicalPlayoffDivisions(matches, catName) {
    return groupPlayoffDivisionsById(
      matches.filter((m) => m.divType === "Playoff" && m.catName === catName));
  }

  // Räknar fram gruppställning (S/V/O/F/mål/poäng) från matchresultat för
  // EN division — cupens egen slutgiltiga tabell arkiveras inte (bara
  // matcherna), så det här är en lokal, förenklad rekonstruktion (2 poäng
  // vinst/1 oavgjort, standard i svensk ungdomshandboll) — kan skilja sig
  // från originalets exakta regler vid t.ex. inbördes möte-särskiljning.
  // Delad av historicalGroupTables (Historik-modalen) och ensureTable()
  // (huvudappens Tabeller-flik, för divisioner som hör till ett extra
  // inblandat år i stället för innevarande live-upplaga).
  function computeGroupTableRows(divMatches) {
    const teams = new Map();
    const ensure = (id, name) => {
      if (!teams.has(id)) {
        teams.set(id, { teamId: id, name, played: 0, won: 0, tied: 0, lost: 0, gf: 0, ga: 0 });
      }
      return teams.get(id);
    };
    for (const m of divMatches) {
      if (!m.res || !m.res.fin || m.res.wo) continue;
      if (m.home.id == null || m.away.id == null) continue;
      const home = ensure(m.home.id, m.home.name), away = ensure(m.away.id, m.away.name);
      home.played++; away.played++;
      home.gf += m.res.hg || 0; home.ga += m.res.ag || 0;
      away.gf += m.res.ag || 0; away.ga += m.res.hg || 0;
      if (m.res.winner === "home") { home.won++; away.lost++; }
      else if (m.res.winner === "away") { away.won++; home.lost++; }
      else { home.tied++; away.tied++; }
    }
    const rows = [...teams.values()].map((t) => ({ ...t, points: t.won * 2 + t.tied }));
    rows.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf ||
      a.name.localeCompare(b.name, "sv"));
    return rows;
  }

  function historicalGroupTables(matches, catName) {
    const byDiv = new Map();
    for (const m of matches) {
      if (m.divType !== "Conference" || m.catName !== catName) continue;
      if (!byDiv.has(m.divId)) byDiv.set(m.divId, { id: m.divId, name: m.divName, matches: [] });
      byDiv.get(m.divId).matches.push(m);
    }
    const tables = [];
    for (const d of byDiv.values()) {
      const rows = computeGroupTableRows(d.matches);
      if (rows.length) tables.push({ id: d.id, name: d.name, rows });
    }
    tables.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
    return tables;
  }

  function historicalTableBlock(t) {
    return h("section", { class: "table-box" },
      h("h3", null, t.name || "Grupp"),
      h("table", { class: "standings" },
        h("thead", null, h("tr", null,
          ["#", "Lag", "S", "V", "O", "F", "+/-", "P"].map((c, i) =>
            h("th", { class: i < 2 ? "l" : "" }, c)))),
        h("tbody", null, t.rows.map((r, i) =>
          h("tr", { class: isClubName(r.name) ? "us" : "" },
            h("td", null, String(i + 1)),
            h("td", { class: "l" }, r.name),
            h("td", null, String(r.played)),
            h("td", null, String(r.won)),
            h("td", null, String(r.tied)),
            h("td", null, String(r.lost)),
            h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
            h("td", { class: "pts" }, String(r.points)))))));
  }

  // Bygger slutspelsträd + tabeller för EN klass i en arkiverad edition —
  // hela editionens matcher (inte bara den sökta klubbens), eftersom ett
  // träd/en tabell behöver alla lag för att bli meningsfull. Returnerar
  // {nodes, redraw}: nodes bifogas efter matchlistan i historik-dialogen
  // (tomt om klassen varken har slutspel eller grupptabeller arkiverade);
  // redraw (null om inget träd) MÅSTE anropas av den som lägger till
  // noderna, både efter att de sitter i det levande DOM-trädet OCH varje
  // gång de blir synliga igen — boxarna ligger inuti en <details> som är
  // stängd för alla år utom det första, och getBoundingClientRect() ger
  // meningslösa (0×0) mått på dolt innehåll.
  function historicalExtras(matches, catName) {
    const nodes = [];
    let redraw = null;
    const playoffDivs = historicalPlayoffDivisions(matches, catName);
    if (playoffDivs.length) {
      const boxes = playoffDivs.map((d) => bracketBlock(d, null, () => {}));
      nodes.push(h("h4", { class: "history-sub-h" }, "Slutspel"),
        h("div", { class: "bracket-row" }, boxes));
      redraw = () => playoffDivs.forEach((d, i) => drawBracketConnectors(boxes[i], d, 1));
    }
    const tables = historicalGroupTables(matches, catName);
    if (tables.length) {
      nodes.push(h("h4", { class: "history-sub-h" }, "Tabeller"), ...tables.map(historicalTableBlock));
    }
    return { nodes, redraw };
  }

  // Grupperar en lista arkiverade matcher per kalenderdag (dayKey) —
  // enklare variant av timeGroups(), utan NU-linje/auto-scroll som inte
  // är meningsfullt för redan avgjorda historiska matcher.
  function groupArchiveByDay(matches) {
    const groups = [];
    for (const m of matches.slice().sort((a, b) => a.start - b.start)) {
      const key = dayKey(m.start);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, items: [m] });
    }
    return groups;
  }

  function archiveClassOptions(matches, divType) {
    const set = new Set();
    for (const m of matches) {
      if (divType && m.divType !== divType) continue;
      if (m.catName) set.add(m.catName);
    }
    return [...set].sort((a, b) => catSortKey(a) - catSortKey(b));
  }

  // --- historik, läge "Bläddra i ett år": full mini-app (Schema/Tabeller/
  // Slutspel/Bana) för EN vald cup+edition, med egen lokal state (hs) helt
  // frikopplad från huvudappens `state` — kan alltså inte störa/krocka med
  // den vanliga live-vyn, samtidigt som den återanvänder samma byggstenar
  // (bracketBlock, historicalGroupTables, archiveMatchRow) som resten av
  // historiken och live-Slutspel.

  function renderHistorySchemaTab(root, hs) {
    const classes = archiveClassOptions(hs.matches);
    const list = h("div", { class: "history-schema-list" });
    function refresh() {
      let matches = hs.matches;
      if (hs.catFilter) matches = matches.filter((m) => m.catName === hs.catFilter);
      const q = hs.teamQuery.trim().toLowerCase();
      if (q) matches = matches.filter((m) =>
        m.home.name.toLowerCase().includes(q) || m.away.name.toLowerCase().includes(q));
      const groups = groupArchiveByDay(matches);
      if (!groups.length) {
        list.replaceChildren(h("p", { class: "muted" }, "Inga matcher matchar filtret."));
        return;
      }
      list.replaceChildren(...groups.flatMap((g) => [
        h("h2", { class: "day-h" }, fmtDayLong.format(new Date(g.items[0].start))),
        h("div", { class: "arena-quick-list" }, g.items.map(archiveMatchRow)),
      ]));
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
    const search = h("input", { type: "text", placeholder: "Sök lag …", value: hs.teamQuery });
    search.addEventListener("input", () => { hs.teamQuery = search.value; refresh(); syncBrowseUrl(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel, withClearButton(search)), list);
    refresh();
  }

  function renderHistoryTablesTab(root, hs) {
    const classes = archiveClassOptions(hs.matches, "Conference");
    if (!classes.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Inga grupptabeller arkiverade för den här editionen."));
      return;
    }
    if (!classes.includes(hs.catFilter)) hs.catFilter = "";
    const content = h("div", { class: "history-tables-content" });
    function refresh() {
      const cats = hs.catFilter ? [hs.catFilter] : classes;
      const nodes = [];
      for (const cat of cats) {
        const tables = historicalGroupTables(hs.matches, cat);
        if (!tables.length) continue;
        nodes.push(h("h2", { class: "day-h" }, cat), ...tables.map(historicalTableBlock));
      }
      content.replaceChildren(...(nodes.length ? nodes : [h("p", { class: "muted" }, "Inga tabeller för valet.")]));
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel), content);
    refresh();
  }

  function renderHistoryPlayoffsTab(root, hs) {
    const classes = archiveClassOptions(hs.matches, "Playoff");
    if (!classes.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Inget slutspel arkiverat för den här editionen."));
      return;
    }
    if (!classes.includes(hs.catFilter)) hs.catFilter = "";
    const content = h("div", { class: "history-tables-content" });
    function refresh() {
      const cats = hs.catFilter ? [hs.catFilter] : classes;
      const nodes = [];
      const pending = [];
      for (const cat of cats) {
        const divs = historicalPlayoffDivisions(hs.matches, cat);
        if (!divs.length) continue;
        const boxes = divs.map((d) => bracketBlock(d, null, () => {}));
        nodes.push(h("h2", { class: "day-h" }, cat), h("div", { class: "bracket-row" }, boxes));
        divs.forEach((d, i) => pending.push({ el: boxes[i], div: d }));
      }
      content.replaceChildren(...(nodes.length ? nodes : [h("p", { class: "muted" }, "Inget slutspel för valet.")]));
      if (pending.length) {
        requestAnimationFrame(() => pending.forEach(({ el, div }) => drawBracketConnectors(el, div, 1)));
      }
    }
    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"),
      classes.map((c) => h("option",
        { value: c, ...(c === hs.catFilter ? { selected: "" } : {}) }, HB.shortCat(c))));
    classSel.addEventListener("change", () => { hs.catFilter = classSel.value; refresh(); syncBrowseUrl(); });
    root.replaceChildren(h("div", { class: "history-controls" }, classSel), content);
    refresh();
  }

  function renderHistoryArenaTab(root, hs) {
    const arenas = [...new Set(hs.matches.map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv"));
    if (!arenas.length) {
      root.replaceChildren(h("p", { class: "muted" }, "Ingen banainformation arkiverad."));
      return;
    }
    if (!arenas.includes(hs.arena)) hs.arena = arenas[0];
    const list = h("div", { class: "arena-quick-list" });
    function refresh() {
      const matches = hs.matches.filter((m) => m.arena === hs.arena)
        .slice().sort((a, b) => a.start - b.start);
      list.replaceChildren(...matches.map(archiveMatchRow));
    }
    const arenaSel = h("select", { class: "select", "aria-label": "Välj bana" },
      arenas.map((a) => h("option", { value: a, ...(a === hs.arena ? { selected: "" } : {}) }, a)));
    arenaSel.addEventListener("change", () => { hs.arena = arenaSel.value; refresh(); syncBrowseUrl(); });
    root.replaceChildren(h("div", { class: "history-controls" }, arenaSel), list);
    refresh();
  }

  const HISTORY_TABS = [
    ["schema", "Schema", renderHistorySchemaTab],
    ["tabeller", "Tabeller", renderHistoryTablesTab],
    ["slutspel", "Slutspel", renderHistoryPlayoffsTab],
    ["bana", "Bana", renderHistoryArenaTab],
  ];

  // --- Trend-fliken: formkurva över cupens år -------------------------------
  // Bygger helt på nyckeltal som redan finns i data/archive/index.json
  // (matches/teams/classes/days/clubs per edition, se build_index() i
  // scripts/archive_results.py) — ingen ytterligare nätverksfråga behövs
  // utöver den fetchArchiveIndex() som init() redan gjort vid appstart.
  // Antal SPELARE går inte att visa: ingen källa (Cup Manager/ProCup) ger
  // spelardata alls, förutom Partilles trupplistor (se rosterFor) som
  // ändå bara täcker en enda cup — inte en meningsfull trendlinje.
  //
  // clubs (distinkta KLUBBAR, till skillnad från "teams" som räknar varje
  // åldersklass-lag för sig) bygger på ett rent klubbnamnsfält
  // (home/away.club) som tillkom senare — arkivfiler skrapade innan dess
  // saknar det och ger då 0, inte ett fel.
  const TREND_METRICS = [
    ["matches", "Matcher", "var(--blue)"],
    ["teams", "Lag", "var(--yellow)"],
    ["clubs", "Klubbar", "var(--orange)"],
    ["classes", "Klasser", "var(--won)"],
    ["days", "Speldagar", "var(--purple)"],
  ];

  // Delad palett för "flera saker jämförs samtidigt"-vyer (Trend-
  // jämförelsegrafen, Kartans flercupsläge) — rena hex-värden, INTE CSS-
  // variabler: MapLibre-markörernas SVG-fill löser inte pålitligt var() i
  // alla webbläsare (till skillnad från inline-SVG:ns stroke, se
  // buildTrendCompareSvg, där CSS-variabler fungerar fint). MAP_SHARED_COLOR
  // (samma blå som Kartans tidigare enda markörfärg) är reserverad för
  // "klubben spelar i FLERA av de valda cuperna" — får INTE återanvändas i
  // MAP_CUP_COLORS, annars går det inte att skilja "unik för cup #1" från
  // "delad" när cup #1 råkar få den färgen.
  const MAP_SHARED_COLOR = "#1f5fbf";
  const MAP_CUP_COLORS = ["#e0a72a", "#c8660a", "#2f9e44", "#8854d0", "#d22f27", "#12a89d", "#c2528f"];
  const MULTI_COLOR_PALETTE = [MAP_SHARED_COLOR, ...MAP_CUP_COLORS];

  // Flera cupers första arkiverade år (2020/2021) var kraftigt coronaneddragna
  // (t.ex. Åhus Beach 2020: 107 matcher mot 4600+ varje år sedan) — indexerar
  // man rakt av mot ÅR ETT blir den upplagan en missvisande 100%-baslinje som
  // trycker ihop alla andra linjer nära botten. Väljer i stället första året
  // som når minst 40 % av cupens STÖRSTA matchantal som ankare; onormalt små
  // tidiga år visas fortfarande som punkter på kurvan, men styr inte skalan.
  //
  // overrideYear: användarens egna val (state.trendBaselineYear, se
  // renderTrendView) vinner alltid över auto-heuristiken ovan när det
  // matchar ett av de faktiskt visade åren.
  function trendBaselineIndex(editions, overrideYear) {
    if (overrideYear) {
      const i = editions.findIndex((e) => e.edition === overrideYear);
      if (i !== -1) return i;
    }
    const maxMatches = Math.max(...editions.map((e) => e.matches || 0));
    const threshold = maxMatches * 0.4;
    const i = editions.findIndex((e) => (e.matches || 0) >= threshold);
    return i === -1 ? 0 : i;
  }

  // Linjediagram, allt normerat till % av baslinjeåret (100 %) — så matcher
  // (tusental) och speldagar (ental) kan visas i samma diagram och svara
  // direkt på "växer eller minskar cupen".
  function buildTrendSvg(editions, baseIdx, metrics) {
    const w = 640, h = 260, padL = 26, padR = 26, padT = 16, padB = 26;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const n = editions.length;
    const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const series = metrics.map(([key, label, color]) => {
      const base = editions[baseIdx][key] || 0;
      const raw = editions.map((e) => e[key] || 0);
      const values = raw.map((v) => (base > 0 ? (v / base) * 100 : (v > 0 ? 100 : 0)));
      return { key, label, color, values, raw };
    });
    const allVals = series.flatMap((s) => s.values);
    const maxV = Math.max(100, ...allVals) * 1.1;
    const y = (v) => padT + innerH - (v / (maxV || 1)) * innerH;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "trend-svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const baseline = document.createElementNS(NS, "line");
    baseline.setAttribute("x1", String(padL)); baseline.setAttribute("x2", String(w - padR));
    baseline.setAttribute("y1", String(y(100))); baseline.setAttribute("y2", String(y(100)));
    baseline.setAttribute("class", "trend-baseline");
    svg.appendChild(baseline);

    editions.forEach((e, i) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(x(i))); t.setAttribute("y", String(h - 6));
      t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "trend-axis-label");
      t.textContent = e.edition;
      svg.appendChild(t);
    });

    for (const s of series) {
      const poly = document.createElementNS(NS, "polyline");
      poly.setAttribute("points", s.values.map((v, i) => x(i) + "," + y(v)).join(" "));
      poly.setAttribute("class", "trend-line");
      poly.setAttribute("style", "stroke:" + s.color);
      svg.appendChild(poly);
      s.values.forEach((v, i) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", String(x(i))); c.setAttribute("cy", String(y(v))); c.setAttribute("r", "3.5");
        c.setAttribute("class", "trend-dot");
        c.setAttribute("style", "fill:" + s.color);
        const title = document.createElementNS(NS, "title");
        title.textContent = s.label + " " + editions[i].edition + ": " + s.raw[i] +
          " (" + Math.round(v) + " % av " + editions[baseIdx].edition + ")";
        c.appendChild(title);
        svg.appendChild(c);
      });
    }
    return svg;
  }

  // Klassnamn att erbjuda i Trend-filtrets klassväljare — ur INNEVARANDE
  // (live) upplagas matcher, redan laddade utan extra kostnad. Äldre år kan
  // ha haft klasser som bytt namn eller lagts ner sedan dess, men det är en
  // rimlig avvägning: att i stället bygga listan ur ALLA arkiverade år
  // skulle kräva att hämta hela deras matchlistor (flera MB per år för en
  // stor cup) bara för att fylla en dropdown, se renderTrendView nedan.
  function trendClassOptions() {
    const set = new Set();
    for (const m of state.matches) if (m.catName) set.add(m.catName);
    return [...set].sort((a, b) => catSortKey(a) - catSortKey(b));
  }

  // Ritar själva SVG:n + legend + fotnot för en färdig lista {edition,
  // matches,teams,classes,days}-objekt — delad av både snabbvägen (direkt
  // ur index.json:s aggregat) och det filtrerade läget (omräknat från fulla
  // matchlistor) i renderTrendView, eftersom formen är identisk i båda fallen.
  function renderTrendChartBlock(root, editions, overrideYear) {
    // "Klubbar" kräver att ALLA visade SPELADE år (matches > 0 — en
    // inställd upplaga har äkta noll oavsett skrapstatus, se
    // backfill_cupmanager_years.py) faktiskt skrapats med det rena
    // klubbnamnsfältet (home/away.club, tillkom 2026-07-24) — annars skulle
    // äldre, ännu inte omskrapade år visa en missvisande rak nedgång till 0
    // i stället för "okänt". Göms helt tills historiken hunnit skrapas om
    // (sker automatiskt i bakgrunden, se archive_results.py/build_index()).
    const metrics = TREND_METRICS.filter(([key]) =>
      key !== "clubs" || editions.every((e) => e.matches === 0 || (e[key] || 0) > 0));
    const baseIdx = trendBaselineIndex(editions, overrideYear);
    const baseEd = editions[baseIdx];
    const lastEd = editions[editions.length - 1];
    const legend = h("div", { class: "trend-legend" },
      metrics.map(([key, label, color]) => {
        const base = baseEd[key] || 0;
        const last = lastEd[key] || 0;
        const pct = base > 0 ? Math.round(((last - base) / base) * 100) : null;
        return h("div", { class: "trend-legend-item" },
          h("span", { class: "trend-swatch", style: "background:" + color }),
          h("span", null, label + ": " + base + " → " + last),
          pct == null || lastEd === baseEd ? null : h("span",
            { class: "trend-delta" + (pct > 0 ? " up" : pct < 0 ? " down" : "") },
            (pct > 0 ? "+" : "") + pct + " %"));
      }));
    // Skriv bara ut corona-motiveringen när baslinjen faktiskt kommer från
    // auto-heuristiken — säger man "hoppas över ... troligen corona" om år
    // användaren själv aktivt valt bort (genom att peka på ett SENARE år)
    // blir det bara missvisande.
    const isManualBaseline = overrideYear && baseEd.edition === overrideYear;
    const skippedOutlier = baseIdx > 0
      ? isManualBaseline
        ? " (valt manuellt)"
        : " (" + editions.slice(0, baseIdx).map((e) => e.edition).join(", ") +
          " hoppas över som baslinje — ovanligt liten upplaga, troligen corona-neddragen)"
      : "";
    root.append(
      h("div", { class: "trend-chart-box" }, buildTrendSvg(editions, baseIdx, metrics)),
      legend,
      h("p", { class: "muted trend-note" },
        "Allt normerat mot " + baseEd.edition + " (= 100 %)" + skippedOutlier +
        ". Antal spelare visas inte — ingen av källorna (Cup Manager/ProCup) ger " +
        "spelardata, förutom Partilles trupplistor." +
        // Ospelade år ser ut som ett ras i grafen (halvpublicerat schema,
        // se preliminary i archive_results.py) — säg det rakt ut i stället
        // för att låta kurvan tala.
        (editions.some((e) => e.preliminary)
          ? " * " + editions.filter((e) => e.preliminary).map((e) => e.edition).join(", ") +
            " är inte spelad än: schemat fylls på löpande, så talen är preliminära " +
            "och ligger lågt jämfört med färdigspelade år."
          : "")),
      // Rådata i tabellform under diagrammet — SAMMA editions-lista (alla
      // arkiverade år, oavsett vilket som råkar vara normeringens
      // baslinje) så man kan slå upp exakta tal utan att behöva hovra
      // pluppar i grafen.
      trendTable(editions, metrics));
  }

  // Återanvänder .table-box/.standings (samma stil som grupptabellerna i
  // Tabeller-vyn) i stället för att bygga en egen tabellstil från grunden.
  // Generisk sorterbar rådatatabell — klickbara kolumnrubriker (samma
  // mönster/CSS som bracketTableBlock's headerCell, se .bracket-th-sort).
  // sortState ({key, dir}, dir är 1/-1) ägs och hålls vid liv av
  // ANROPAREN (modulnivå-variabler, se trendTableSort m.fl. nedan) så att
  // vald sortering överlever omritningar. columns: [{key, label, align,
  // get(row)->sträng|tal, defaultDir, render}]. get(row) avgör ALLTID
  // sorteringen; render(row) (valfri) avgör vad cellen faktiskt VISAR —
  // en DOM-nod/array av noder+text i stället för get(row) tvingat genom
  // String(), se Klubb/Lags "År"-kolumn (renderYearsWithGaps) för ett
  // exempel som färgmarkerar enskilda år inom en och samma cell.
  // rowTitle(row) är valfri — sätts som
  // native tooltip på hela raden (t.ex. en fullständig klasslista).
  // onRowClick(row) är valfri — gör raderna klickbara (pekare-cursor,
  // hover, tangentbordsnavigerbara) för nedborrning till mer detaljerad
  // vy, se Klubb/Lag-flikens renderClubCupDetail/renderClubClassDetail.
  function sortableTable(columns, rows, sortState, rowTitle, onRowClick) {
    const sorted = rows.slice().sort((a, b) => {
      const col = columns.find((c) => c.key === sortState.key) || columns[0];
      const av = col.get(a), bv = col.get(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv : String(av).localeCompare(String(bv), "sv", { numeric: true });
      return sortState.dir * cmp;
    });
    const headerCell = (col) => {
      const active = sortState.key === col.key;
      return h("th", {
        class: (col.align === "l" ? "l " : "") + "bracket-th-sort" + (active ? " on" : ""),
        role: "button", tabindex: "0",
        onclick: () => {
          if (active) sortState.dir *= -1;
          else { sortState.key = col.key; sortState.dir = col.defaultDir || -1; }
          renderContent();
        },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } },
      }, col.label, active ? h("span", { class: "sort-arrow" }, sortState.dir > 0 ? " ▲" : " ▼") : null);
    };
    const bodyRow = (row) => h("tr", {
      ...(rowTitle ? { title: rowTitle(row) } : {}),
      ...(onRowClick ? {
        class: "sortable-row-clickable", role: "button", tabindex: "0",
        onclick: () => onRowClick(row),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } },
      } : {}),
    }, columns.map((col, i) => h(i === 0 ? "th" : "td",
      { class: col.align === "l" ? "l" : "", ...(i === 0 ? { scope: "row" } : {}) },
      col.render ? col.render(row) : String(col.get(row)))));
    return h("div", { class: "table-box" },
      h("table", { class: "standings" },
        h("thead", null, h("tr", null, columns.map(headerCell))),
        h("tbody", null, sorted.map(bodyRow))));
  }

  // Sorteringsval per tabell — modulnivå (inte state, sparas ej) så de
  // överlever renderContent() men nollställs vid en full sidladdning,
  // precis som bracketSort.
  let trendTableSort = { key: "edition", dir: 1 };
  let trendCompareTableSort = { key: "cupName", dir: 1 };
  let clubTableSort = { key: "cupName", dir: 1 };
  let clubClassTableSort = { key: "matches", dir: -1 };

  const PRELIM_TITLE = "Preliminärt: upplagan är inte spelad än och schemat " +
    "kan vara ofullständigt — talen går inte att jämföra rakt av med " +
    "färdigspelade år.";

  function trendTable(editions, metrics) {
    const columns = [
      {
        key: "edition", label: "År", align: "l", defaultDir: 1,
        get: (e) => e.edition,
        // Ospelade upplagor (se preliminary i archive_results.py) får en
        // markör — deras tal är en ögonblicksbild av ett halvpublicerat
        // schema och sjunker inte, de har bara inte fyllts på än.
        render: (e) => e.preliminary
          ? [e.edition, h("span", { class: "trend-prelim", title: PRELIM_TITLE }, " *")]
          : e.edition,
      },
      ...metrics.map(([key, label]) => ({ key, label, defaultDir: -1, get: (e) => e[key] || 0 })),
    ];
    return sortableTable(columns, editions, trendTableSort);
  }

  // Cup-över-cuper-lägena (jämförelsegrafen nedan OCH Klubb/Lag-fliken,
  // se renderClubView) behöver arkiverade år för ANDRA cuper än den
  // aktiva — bygger listan över VILKA cuper (av arkivindexets fulla lista)
  // som faktiskt har någon arkiverad historik alls, oavsett om de stödjer
  // formkurvans egna >=2-årskrav (ett enda deltagar-år är fortfarande
  // relevant information).
  //
  // sportFilter (valfri): begränsar till en sport (t.ex. "handboll" eller
  // "fotboll", se cup.sport i data/cups.json). Trend-jämförelsegrafen
  // använder detta (blandar man in fotbollscupers matcher/lag-antal i en
  // handbollsjämförelse blir talen meningslösa) — Klubb/Lag gör INTE det,
  // en klubb kan i teorin ha sektioner i flera sporter och hela poängen
  // där är att hitta ALLA cuper den förekommer i.
  function trendCupOptions(sportFilter) {
    const idx = state.archiveIndex || {};
    return HB.allCups()
      .filter((c) => (idx[c.id] && idx[c.id].editions || []).some((e) => e.matches > 0))
      .filter((c) => !sportFilter || (c.sport || "handboll") === sportFilter)
      .map((c) => c.id);
  }

  // Egen toppnivåflik (bredvid Schema/Tabeller/Slutspel/Bana) för INNEVARANDE
  // cup — flyttad hit från en Historik-modalflik 2026-07-24, då den kändes
  // avskild från resten av appen (särskilt efter att fritt årsval byggdes in
  // direkt i huvudvyn, se state.years/ensureYearMatches). state.archiveIndex
  // laddas en gång vid appstart (se init()).
  //
  // Cupväljare tillagd senare samma dag: EN vald cup (förval, matchar
  // state.cupId) ger formkurvan som vanligt (nu för VALFRI cup, inte bara
  // den aktiva — byt cup i pickern utan att röra huvudappens headerval).
  // FLERA valda cuper ger i stället en jämförelsegraf, alla ovanpå varandra
  // (renderTrendCompare) — den tidigare fritextsökningen på lag/klubb
  // (som krävdes för att visa NÅGOT alls med fler än en cup vald) togs
  // bort 2026-07-24: en lista över EN klubbs historik hör hemma i sin
  // egen Klubb/Lag-flik (renderClubView, söker dessutom över ALLA cuper,
  // inte bara de som råkar vara valda här).
  //
  // Klass-/lagfilter: index.json:s aggregat räcker för OFILTRERAD
  // formkurva (snabbt, redan laddat), men ett filter kräver de FULLA
  // matchlistorna per arkiverat år — hämtas lat, bara när det faktiskt
  // behövs, via ensureYearMatches (kan bli flera MB för en stor cup, se
  // trendClassOptions). Klassfiltret gäller bara enskild-cup-läget — ett
  // klassnamn plockat ur INNEVARANDE cups live-matcher (trendClassOptions)
  // vore ett obegripligt filter att applicera på andra cupers helt egna
  // klassnamnsscheman i jämförelseläget.
  function renderTrendView(root) {
    // Bara cuper av SAMMA sport som innevarande cup — att jämföra t.ex.
    // matchantal mellan en handbolls- och en fotbollscup i samma graf är
    // meningslöst. Byt aktiv cup (Inställningar) för att jämföra fotbolls-
    // cuper med varandra i stället. state.exploreCupIds delas med Karta
    // (se dess kommentar) — cupurvalet hänger alltså med om man växlar
    // mellan de två flikarna.
    const cupOptions = trendCupOptions(cup().sport || "handboll");
    if (!cupOptions.length) {
      root.append(h("div", { class: "banner" },
        "Ingen cup har tillräckligt med arkiverad historik för en formkurva."));
      return;
    }
    // Städa bort ev. kvarvarande urval från en ANNAN sport (t.ex. om man
    // valde flera fotbollscuper och sedan bytte aktiv cup till en
    // handbollscup i Inställningar) — annars skulle den fortfarande
    // blandas in i jämförelsen trots att den inte ens syns i väljaren längre.
    for (const id of [...state.exploreCupIds]) if (!cupOptions.includes(id)) state.exploreCupIds.delete(id);
    if (!state.exploreCupIds.size) state.exploreCupIds.add(state.cupId);

    const cupPicker = buildPicker({
      items: cupOptions.map((id) => {
        const c = HB.allCups().find((x) => x.id === id);
        const name = (c && c.name) || id;
        return { id, label: name, sortKey: 0, sortName: name };
      }),
      selected: state.exploreCupIds,
      emptyLabel: "Välj cup(er)",
      countLabel: (n) => n + " cuper",
      searchPlaceholder: "Sök cup …",
      sortToggle: false, // cuper har inget "klass"-begrepp — bara namnsortering
      soloClickable: true, // klick på cupnamnet väljer bara den cupen
      onChange: () => renderContent(),
    });

    const selectedCupIds = [...state.exploreCupIds];
    const showClassPicker = selectedCupIds.length === 1;
    const classOptions = showClassPicker ? trendClassOptions() : [];
    const classPicker = classOptions.length ? buildPicker({
      items: classOptions.map((name) => ({
        id: name, label: name, sortKey: catSortKey(name), sortName: name,
      })),
      selected: state.trendCats,
      emptyLabel: "Alla klasser",
      countLabel: (n) => "Klasser (" + n + ")",
      searchPlaceholder: "Sök klass …",
      genderQuickSelect: true,
      onChange: () => renderContent(),
    }) : null;

    root.append(h("div", { class: "history-controls" }, cupPicker, classPicker));

    const chartHost = h("div", { class: "trend-chart-host" });
    root.append(chartHost);

    if (!selectedCupIds.length) {
      chartHost.append(h("p", { class: "muted" }, "Välj minst en cup ovan."));
      return;
    }

    // Flera cuper valda: jämförelsegraf, alla ovanpå varandra (normerade
    // mot varsitt eget baslinjeår) — se renderTrendCompare.
    if (selectedCupIds.length > 1) {
      renderTrendCompare(chartHost, selectedCupIds);
      return;
    }

    // En cup vald: formkurva, samma som tidigare men för VALFRI vald cup.
    // Editions med 0 matcher (t.ex. en inställd corona-upplaga, se
    // backfill_cupmanager_years.py) TAS MED här, till skillnad från
    // tidigare — mer informativt att visa dem som en riktig nollpunkt i
    // grafen än att tyst hoppa över dem. "Minst två år"-spärren nedan
    // räknar ändå bara RIKTIGA (spelade) år, annars skulle en cup med ett
    // enda spelat år plus flera inställda felaktigt räknas som redo.
    const trendCupId = selectedCupIds[0];
    const idx = state.archiveIndex || {};
    const entry = idx[trendCupId];
    const editionsMeta = ((entry && entry.editions) || [])
      .slice().sort((a, b) => a.edition.localeCompare(b.edition));
    const trendCupName = (HB.allCups().find((c) => c.id === trendCupId) || {}).name || trendCupId;
    const realYears = editionsMeta.filter((e) => e.matches > 0).length;
    if (realYears < 2) {
      chartHost.append(h("p", { class: "muted" },
        trendCupName + " har bara " + realYears +
        " spelat arkiverat år — behöver minst två för att visa en formkurva."));
      return;
    }

    // Manuellt baslinjeår — vinner över auto-heuristiken i
    // trendBaselineIndex när det matchar ett av de faktiskt spelade åren.
    // Byggs av RIKTIGA år bara (en inställd 0-upplaga vore ett meningslöst
    // 100 %-ankare). Om det sparade valet inte längre finns bland årets
    // alternativ (t.ex. efter cupbyte) faller väljaren tillbaka till Auto
    // utan att krascha — trendBaselineIndex gör samma sak.
    const baselineOptions = editionsMeta.filter((e) => e.matches > 0);
    const baselineValue = baselineOptions.some((e) => e.edition === state.trendBaselineYear)
      ? state.trendBaselineYear : "";
    const baselineSelect = h("select", { class: "select", "aria-label": "Baslinjeår" },
      h("option", { value: "" }, "Baslinje: auto"),
      baselineOptions.map((e) => h("option",
        { value: e.edition, ...(e.edition === baselineValue ? { selected: "" } : {}) },
        "Baslinje: " + e.edition)));
    baselineSelect.value = baselineValue;
    baselineSelect.addEventListener("change", () => {
      state.trendBaselineYear = baselineSelect.value || null;
      renderContent();
    });
    chartHost.append(h("div", { class: "row trend-baseline-row" }, baselineSelect));

    if (!state.trendCats.size) {
      renderTrendChartBlock(chartHost, editionsMeta, baselineValue);
      return;
    }

    for (const em of editionsMeta) ensureYearMatches(em.edition, trendCupId);
    const loaded = editionsMeta.map((em) =>
      ({ meta: em, ym: state.yearMatches[trendCupId + ":" + em.edition] }));
    if (loaded.some(({ ym }) => !ym || ym.status === "loading")) {
      chartHost.append(h("p", { class: "muted" }, "Hämtar arkiverade år för filtrering …"));
      return;
    }
    const computed = loaded.map(({ meta, ym }) => {
      const matches = ((ym && ym.matches) || []).filter((m) => state.trendCats.has(m.catName));
      const teams = new Set(), classes = new Set(), days = new Set(), clubs = new Set();
      for (const m of matches) {
        if (m.home.id != null) teams.add(m.home.id);
        if (m.away.id != null) teams.add(m.away.id);
        if (m.home.club) clubs.add(m.home.club);
        if (m.away.club) clubs.add(m.away.club);
        if (m.catName) classes.add(m.catName);
        if (m.start) days.add(Math.floor(m.start / 86400000));
      }
      return {
        edition: meta.edition, matches: matches.length, teams: teams.size,
        clubs: clubs.size, classes: classes.size, days: days.size,
      };
    });
    if (computed.every((e) => e.matches === 0)) {
      chartHost.append(h("p", { class: "muted" }, "Inga arkiverade matcher matchar klassfiltret."));
      return;
    }
    renderTrendChartBlock(chartHost, computed, baselineValue);
  }

  // Jämförelsegraf: flera cuper "ovanpå varandra" i samma diagram, EN
  // metric i taget (annars metric×cup-kombinationer snabbt oläsligt — upp
  // till 5 mått × flera cuper). Varje cups linje normeras mot sitt EGET
  // baslinjeår (samma 40%-heuristik som enskild-cup-läget, se
  // trendBaselineIndex) — jämför alltså relativ UTVECKLING, inte absolut
  // storlek, så en liten och en stor cup går att jämföra rakt av.
  function renderTrendCompare(root, cupIds) {
    const idx = state.archiveIndex || {};
    const cupsData = cupIds.map((id, i) => {
      const entry = idx[id];
      const editions = ((entry && entry.editions) || [])
        .slice().sort((a, b) => a.edition.localeCompare(b.edition));
      const name = (HB.allCups().find((c) => c.id === id) || {}).name || id;
      return { cupId: id, cupName: name, editions, color: MULTI_COLOR_PALETTE[i % MULTI_COLOR_PALETTE.length] };
    }).filter((c) => c.editions.some((e) => e.matches > 0));
    if (!cupsData.length) {
      root.append(h("p", { class: "muted" },
        "Ingen av de valda cuperna har arkiverad historik med spelade matcher."));
      return;
    }

    const metricSelect = h("select", { class: "select", "aria-label": "Mått" },
      TREND_METRICS.map(([key, label]) => h("option",
        { value: key, ...(key === state.trendCompareMetric ? { selected: "" } : {}) }, label)));
    metricSelect.value = state.trendCompareMetric;
    metricSelect.addEventListener("change", () => {
      state.trendCompareMetric = metricSelect.value;
      renderContent();
    });
    root.append(h("div", { class: "row trend-baseline-row" }, metricSelect));

    const metricKey = state.trendCompareMetric;
    const metricLabel = (TREND_METRICS.find(([k]) => k === metricKey) || [, metricKey])[1];
    root.append(h("div", { class: "trend-chart-box" }, buildTrendCompareSvg(cupsData, metricKey)));

    const legend = h("div", { class: "trend-legend" }, cupsData.map((c) => {
      const played = c.editions.filter((e) => e.matches > 0);
      const baseIdx = trendBaselineIndex(played);
      const baseEd = played[baseIdx];
      const lastEd = played[played.length - 1];
      const base = baseEd[metricKey] || 0;
      const last = lastEd[metricKey] || 0;
      const pct = base > 0 ? Math.round(((last - base) / base) * 100) : null;
      return h("div", { class: "trend-legend-item" },
        h("span", { class: "trend-swatch", style: "background:" + c.color }),
        h("span", null, c.cupName + ": " + base + " (" + baseEd.edition + ") → " +
          last + " (" + lastEd.edition + ")"),
        pct == null || lastEd === baseEd ? null : h("span",
          { class: "trend-delta" + (pct > 0 ? " up" : pct < 0 ? " down" : "") },
          (pct > 0 ? "+" : "") + pct + " %"));
    }));
    root.append(legend,
      h("p", { class: "muted trend-note" },
        "Varje cup normerad mot sitt eget baslinjeår (= 100 %) — jämför relativ " +
        "utveckling, inte absolut storlek."),
      trendCompareTable(cupsData, metricKey, metricLabel));
  }

  function buildTrendCompareSvg(cupsData, metricKey) {
    const w = 640, h2 = 260, padL = 26, padR = 26, padT = 16, padB = 26;
    const innerW = w - padL - padR, innerH = h2 - padT - padB;
    const years = [...new Set(cupsData.flatMap((c) => c.editions.map((e) => e.edition)))].sort();
    const n = years.length;
    const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const yearIndex = new Map(years.map((y, i) => [y, i]));

    const series = cupsData.map((c) => {
      const baseIdx = trendBaselineIndex(c.editions);
      const base = c.editions[baseIdx][metricKey] || 0;
      const points = c.editions
        .map((e) => ({
          i: yearIndex.get(e.edition), edition: e.edition, raw: e[metricKey] || 0,
          v: base > 0 ? ((e[metricKey] || 0) / base) * 100 : ((e[metricKey] || 0) > 0 ? 100 : 0),
        }))
        .sort((a, b) => a.i - b.i);
      return { cupName: c.cupName, color: c.color, points, baseEdition: c.editions[baseIdx].edition };
    });
    const allVals = series.flatMap((s) => s.points.map((p) => p.v));
    const maxV = Math.max(100, ...allVals) * 1.1;
    const y = (v) => padT + innerH - (v / (maxV || 1)) * innerH;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "trend-svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h2);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const baseline = document.createElementNS(NS, "line");
    baseline.setAttribute("x1", String(padL)); baseline.setAttribute("x2", String(w - padR));
    baseline.setAttribute("y1", String(y(100))); baseline.setAttribute("y2", String(y(100)));
    baseline.setAttribute("class", "trend-baseline");
    svg.appendChild(baseline);

    years.forEach((yr, i) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(x(i))); t.setAttribute("y", String(h2 - 6));
      t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "trend-axis-label");
      t.textContent = yr;
      svg.appendChild(t);
    });

    for (const s of series) {
      // Bryter linjen i separata segment vid luckor (år cupen HELT saknar
      // arkiverad data, till skillnad från en äkta inställd nollpunkt som
      // fortfarande är en punkt på linjen) i stället för att dra en
      // missvisande rak linje över dem.
      let seg = [];
      const flushSeg = () => {
        if (seg.length > 1) {
          const poly = document.createElementNS(NS, "polyline");
          poly.setAttribute("points", seg.map((p) => x(p.i) + "," + y(p.v)).join(" "));
          poly.setAttribute("class", "trend-line");
          poly.setAttribute("style", "stroke:" + s.color);
          svg.appendChild(poly);
        }
        seg = [];
      };
      let prevI = null;
      for (const p of s.points) {
        if (prevI != null && p.i !== prevI + 1) flushSeg();
        seg.push(p);
        prevI = p.i;
      }
      flushSeg();
      for (const p of s.points) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", String(x(p.i))); c.setAttribute("cy", String(y(p.v))); c.setAttribute("r", "3.5");
        c.setAttribute("class", "trend-dot");
        c.setAttribute("style", "fill:" + s.color);
        const title = document.createElementNS(NS, "title");
        title.textContent = s.cupName + " " + p.edition + ": " + p.raw +
          " (" + Math.round(p.v) + " % av " + s.baseEdition + ")";
        c.appendChild(title);
        svg.appendChild(c);
      }
    }
    return svg;
  }

  function trendCompareTable(cupsData, metricKey, metricLabel) {
    const rows = cupsData.flatMap((c) => c.editions.map((e) =>
      ({ cupName: c.cupName, edition: e.edition, value: e[metricKey] || 0 })));
    const columns = [
      { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
      { key: "edition", label: "År", align: "l", defaultDir: 1, get: (r) => r.edition },
      { key: "value", label: metricLabel, defaultDir: -1, get: (r) => r.value },
    ];
    return sortableTable(columns, rows, trendCompareTableSort);
  }

  // Klubb/Lag-fliken: en cups arkiverade upplagor, filtrerat mot ett
  // ev. valt årsfilter (state.clubYears, tomt = alla år) — delad av alla
  // tre nivåerna nedan så ett årsval även styr VILKA år som hämtas
  // (ensureYearMatches), inte bara vad som till slut visas.
  function clubEditionsFor(cupId) {
    const idx = state.archiveIndex || {};
    const editionsMeta = ((idx[cupId] && idx[cupId].editions) || []).filter((e) => e.matches > 0);
    return state.clubYears.size ? editionsMeta.filter((e) => state.clubYears.has(e.edition)) : editionsMeta;
  }

  // Klubb/Lag-flikens "År"-kolumn: fyller ut med de år CUPEN har arkiverad
  // historik men klubben INTE deltog (dämpad/röd text) bredvid åren den
  // faktiskt var med (vanlig text) — svarar direkt på "var vi med varje
  // gång, eller missade vi något?" utan att behöva räkna själv eller borra
  // ner i varje cup. Jämförs mot clubEditionsFor(cupId) — SAMMA årsmängd
  // som redan styr vad som räknas in i raden ovanför (respekterar alltså
  // ett ev. aktivt årsfilter, i stället för att dränka ett medvetet
  // avgränsat urval i rött för alla bortvalda år).
  function renderYearsWithGaps(cupId, participatedYears) {
    const participated = new Set(participatedYears);
    const allYears = clubEditionsFor(cupId).map((e) => e.edition).sort();
    const nodes = [];
    allYears.forEach((y, i) => {
      nodes.push(h("span", participated.has(y) ? null : { class: "club-year-gap" }, y));
      if (i < allYears.length - 1) nodes.push(", ");
    });
    return nodes;
  }

  // Riktig förloppsindikator för en pågående computeClubRows()-hämtning —
  // en obestämd "Hämtar …" kändes som att sidan hängt sig på en sökning
  // som (första gången, innan IndexedDB-cachen i fetchArchiveEdition hunnit
  // fyllas på) kan behöva dra ner tiotals MB över nätet. Räknas om vid
  // varje omritning (loadedCount/totalCount kommer från computeClubRows,
  // som anropas på nytt varje gång) — fylls på i takt med att fler
  // cup-år-filer svarar, ingen egen timer/polling behövs.
  function archiveProgressBlock(loaded, total) {
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    return h("div", { class: "archive-progress" },
      h("p", { class: "muted" }, "Hämtar arkiverade år … (" + loaded + " av " + total + ")"),
      h("div", { class: "archive-progress-bar" },
        h("div", { class: "archive-progress-fill", style: "width:" + pct + "%" })));
  }

  // Klubb/Lag-fliken: alla år som finns att välja mellan i årsfiltret —
  // unionen över samtliga cuper med arkiverad historik (trendCupOptions),
  // inte bara de som råkar matcha den aktuella sökningen, så filtret inte
  // hoppar runt när man byter sökterm.
  function clubYearOptions() {
    const idx = state.archiveIndex || {};
    const years = new Set();
    for (const cupId of trendCupOptions()) {
      for (const e of (idx[cupId] && idx[cupId].editions) || []) {
        if (e.matches > 0) years.add(e.edition);
      }
    }
    return [...years].sort().reverse();
  }

  // Lat, EN gång: se state.teamIndex-kommentaren. Modulnivå-flagga (inte
  // state.teamIndex självt, som medvetet ska stanna på null tills datan
  // faktiskt finns) förhindrar att computeClubRows startar om hämtningen
  // vid varje omritning innan löftet hunnit lösa sig.
  let teamIndexRequested = false;
  function ensureTeamIndex() {
    if (teamIndexRequested) return;
    teamIndexRequested = true;
    HB.api.fetchTeamIndex().then((idx) => {
      state.teamIndex = idx || {};
      renderContent();
    });
  }

  // Avgör om en cup-upplaga ens KAN innehålla söktermen, enligt det redan
  // laddade lagnamnsindexet — false = vet SÄKERT att den inte gör det (kan
  // hoppas över helt, ingen nätverksfråga för den stora matchfilen). true
  // betyder antingen att ett namn faktiskt matchar (måste hämtas för att
  // räkna exakt) ELLER att upplagan saknas i indexet (t.ex. nyare än
  // senaste indexbygget, se scripts/build_team_index.py) — då antas den
  // kunna matcha, hellre missa optimeringen än missa en riktig träff.
  function editionMightMatch(cupId, edition, teamQuery) {
    const names = state.teamIndex[cupId] && state.teamIndex[cupId][edition];
    if (!names) return true;
    return names.some((n) => matchesBooleanQuery(n.toLowerCase(), teamQuery));
  }

  // Klubb/Lag-fliken: aggregerar EN sökterms (klubb-/lagnamn) historik över
  // ALLA cuper med arkiverad data (till skillnad från Trend-jämförelsen
  // ovan, som bara omfattar de cuper man själv valt). Kräver FULLA
  // matchlistor per arkiverat år och cup (samma ensureYearMatches som
  // formkurvan) — men bara för de upplagor som lagnamnsindexet (se ovan)
  // inte redan kan avskriva helt. Man är sällan intresserad av mer än en
  // handfull klubbar åt gången (en själv, ett par att jämföra med) — det
  // finns ingen anledning att hämta ALLA ~190 arkiverade upplagor av ALLA
  // cuper bara för att räkna ut EN sökning.
  function computeClubRows(cupIds, teamQuery) {
    ensureTeamIndex();
    // loadedCount/totalCount: hur många av de berörda cup-år-filerna som
    // redan svarat (klart ELLER fel, bara inte "loading") — låter
    // renderClubView visa en riktig förloppsindikator ("X av Y hämtade")
    // i stället för en obestämd "Hämtar …"-text. Väntar medvetet in HELA
    // lagnamnsindexet (state.teamIndex) innan en enda stor matchfil ens
    // beställs — annars hinner flera beställas i onödan under den korta
    // stund (litet, snabbt anrop) indexet fortfarande laddar, vilket i
    // praktiken skulle omintetgöra en stor del av optimeringen.
    if (!state.teamIndex) {
      let totalCount = 0;
      for (const cupId of cupIds) totalCount += clubEditionsFor(cupId).length;
      return { pending: true, rows: [], loadedCount: 0, totalCount };
    }
    let pending = false;
    let loadedCount = 0, totalCount = 0;
    const rows = [];
    for (const cupId of cupIds) {
      const editionsMeta = clubEditionsFor(cupId);
      const years = [];
      let totalTeams = 0, totalMatches = 0;
      const classes = new Set();
      // Rå lagnamn (inte bara antal) som faktiskt matchade söktermen — låter
      // Klubbjämförelsens radexpansion (se clubCompareDetailBlock) visa EXAKT
      // vilka stavningsvarianter som räknats in, t.ex. "Önnereds HK" och
      // "Önnered HK" (utan s) från olika cuper — ett sätt att själv avgöra om
      // två liknande sökningar/namn råkar vara samma klubb i praktiken.
      const names = new Set();
      for (const em of editionsMeta) {
        totalCount++;
        if (!editionMightMatch(cupId, em.edition, teamQuery)) {
          loadedCount++; // känt resultat direkt av indexet — inget att vänta på
          continue;
        }
        ensureYearMatches(em.edition, cupId);
        const ym = state.yearMatches[cupId + ":" + em.edition];
        if (!ym || ym.status === "loading") { pending = true; continue; }
        loadedCount++;
        if (ym.status !== "done") continue;
        const teamIds = new Set();
        let matchCount = 0;
        for (const m of ym.matches) {
          const homeIsUs = matchesBooleanQuery(m.home.name.toLowerCase(), teamQuery);
          const awayIsUs = matchesBooleanQuery(m.away.name.toLowerCase(), teamQuery);
          if (!homeIsUs && !awayIsUs) continue;
          matchCount++;
          if (homeIsUs && m.home.id != null) { teamIds.add(m.home.id); names.add(m.home.name); }
          if (awayIsUs && m.away.id != null) { teamIds.add(m.away.id); names.add(m.away.name); }
          if (m.catName) classes.add(m.catName);
        }
        if (teamIds.size) { years.push(em.edition); totalTeams += teamIds.size; totalMatches += matchCount; }
      }
      if (years.length) {
        const cupObj = HB.allCups().find((c) => c.id === cupId);
        rows.push({
          cupId, cupName: (cupObj && cupObj.name) || cupId, years: years.sort(),
          totalTeams, totalMatches, classes, names,
        });
      }
    }
    return { pending, rows, loadedCount, totalCount };
  }

  // Klubb/Lag-fliken, nedborrningsnivå 1 (en vald cup): samma matcher som
  // computeClubRows redan laddat via ensureYearMatches, men brutna ner per
  // KLASS i stället för aggregerade till en enda rad. "edition|id" som
  // nyckel i lag-mängderna (inte bara id) — Cup Manager delar ut nya
  // lag-id:n varje upplaga (se allActiveMatches-kommentaren), så samma
  // rådata-id kan i teorin återanvändas mellan år utan att vara samma lag.
  function computeClubCupDetail(cupId, teamQuery) {
    const editionsMeta = clubEditionsFor(cupId);
    const byClass = new Map(); // klassnamn -> {teams:Set, matches:antal}
    const allTeams = new Set();
    const days = new Set();
    let totalMatches = 0;
    for (const em of editionsMeta) {
      const ym = state.yearMatches[cupId + ":" + em.edition];
      if (!ym || ym.status !== "done") continue;
      for (const m of ym.matches) {
        const homeIsUs = matchesBooleanQuery(m.home.name.toLowerCase(), teamQuery);
        const awayIsUs = matchesBooleanQuery(m.away.name.toLowerCase(), teamQuery);
        if (!homeIsUs && !awayIsUs) continue;
        totalMatches++;
        if (m.start) days.add(Math.floor(m.start / 86400000));
        const cls = m.catName || "(okänd klass)";
        if (!byClass.has(cls)) byClass.set(cls, { teams: new Set(), matches: 0 });
        const entry = byClass.get(cls);
        entry.matches++;
        if (homeIsUs && m.home.id != null) { entry.teams.add(em.edition + "|" + m.home.id); allTeams.add(em.edition + "|" + m.home.id); }
        if (awayIsUs && m.away.id != null) { entry.teams.add(em.edition + "|" + m.away.id); allTeams.add(em.edition + "|" + m.away.id); }
      }
    }
    const classes = [...byClass.entries()].map(([className, e]) =>
      ({ className, teamCount: e.teams.size, matchCount: e.matches }));
    return { classes, totalTeams: allTeams.size, totalMatches, totalDays: days.size };
  }

  // Klubb/Lag-fliken, nedborrningsnivå 2 (en vald cup + klass): grupperar
  // matcherna per LAG (edition+id, se kommentaren ovan) i stället för per
  // klass — varje grupp blir en rubrik + matchkort i renderClubClassDetail.
  // Ett lag som spelat BÅDE hemma och borta mot varandra "internt" (sällsynt,
  // t.ex. en klubbs egna lag möts) hamnar korrekt i BÅDA gruppernas listor.
  function computeClubClassGroups(cupId, className, teamQuery) {
    const editionsMeta = clubEditionsFor(cupId);
    const groups = new Map(); // "edition|id" -> {teamId, teamName, edition, matches:[]}
    for (const em of editionsMeta) {
      const ym = state.yearMatches[cupId + ":" + em.edition];
      if (!ym || ym.status !== "done") continue;
      for (const m of ym.matches) {
        if ((m.catName || "(okänd klass)") !== className) continue;
        for (const side of [m.home, m.away]) {
          if (side.id == null || !matchesBooleanQuery(side.name.toLowerCase(), teamQuery)) continue;
          const key = em.edition + "|" + side.id;
          if (!groups.has(key)) {
            groups.set(key, { teamId: side.id, teamName: side.name, edition: em.edition, matches: [] });
          }
          groups.get(key).matches.push(m);
        }
      }
    }
    return [...groups.values()].sort((a, b) =>
      b.edition.localeCompare(a.edition) || b.matches.length - a.matches.length);
  }

  let clubQuerySeeded = false;

  // Egen toppnivåflik: "en klubbs/ett lags historik över alla cuper" —
  // svarar direkt på "vilka cuper har t.ex. Alingsås HK deltagit i, med
  // hur många lag, i vilka klasser?". Söker alltid över SAMTLIGA cuper med
  // arkiverad historik (trendCupOptions), till skillnad från Trend-
  // jämförelsen som är avgränsad till valda cuper — en klubbfråga är till
  // sin natur global, inte cup-för-cup.
  function renderClubView(root) {
    // Förifyller sökrutan med den egna klubben EN gång (första besöket) —
    // därefter rör vi den inte, annars skulle en tömd sökruta (t.ex. via
    // krysset) omedelbart återfyllas nästa omritning.
    if (!clubQuerySeeded) { clubQuerySeeded = true; state.clubQuery = state.favoriteClub || ""; }

    const input = h("input", {
      class: "search", type: "text", placeholder: "Lag/klubb, t.ex. Alingsås HK",
      title: "Stöder & (och) och / eller , (eller), t.ex. Alingsås&Blå",
    });
    input.value = state.clubQuery;
    // En ny sökning gör en pågående nedborrning (vald cup/klass, se
    // state-kommentaren) obegriplig — en klass som fanns för förra
    // sökningen betyder inget för den nya. Nollställ båda.
    const applyQuery = () => {
      state.clubQuery = input.value;
      state.clubDrillCup = null; state.clubDrillClass = null;
      renderContent();
    };
    input.addEventListener("change", applyQuery);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyQuery(); }
    });
    // Autocomplete (samma klubbkatalog/minLen som Klubbjämförelse, se
    // ensureCompareCandidates) — fritextsökningen stödjer visserligen boolesk
    // syntax (& och /) och funkar utan, men utan förslag var det lätt att
    // skriva ett namn som inte matchar NÅGOT (fel stavning, saknat mellanslag)
    // och bara få en tom träfflista utan att förstå varför.
    ensureCompareCandidates();
    const clubOptions = h("div", { class: "autocomplete-list" });
    clubOptions.hidden = true;
    attachAutocomplete(input, clubOptions, () => compareCandidates || [], (name) => {
      state.clubQuery = name; state.clubDrillCup = null; state.clubDrillClass = null;
      renderContent();
    }, 2);

    // Årsfilter (state.clubYears, tomt = alla år) — påverkar inte sökningen
    // i sig, men en nedborrning gjord för ETT årsurval kan bli obegriplig
    // (t.ex. en klass utan träffar) med ett annat, så nollställ den precis
    // som vid en ny sökterm.
    const yearOptions = clubYearOptions();
    const yearPicker = yearOptions.length > 1 ? buildPicker({
      items: yearOptions.map((y) => ({ id: y, label: y, sortKey: 0, sortName: y })),
      selected: state.clubYears,
      emptyLabel: "Alla år",
      countLabel: (n) => (n === 1 ? "1 år" : n + " år"),
      searchPlaceholder: "Sök år …",
      sortToggle: false,
      soloClickable: true,
      onChange: () => { state.clubDrillCup = null; state.clubDrillClass = null; renderContent(); },
    }) : null;

    root.append(h("div", { class: "history-controls" },
      h("div", { class: "autocomplete-wrap trend-team-search" },
        withClearButton(input, () => {
          state.clubQuery = ""; state.clubDrillCup = null; state.clubDrillClass = null;
          renderContent();
        }),
        clubOptions),
      yearPicker));

    const resultHost = h("div", { class: "trend-chart-host" });
    root.append(resultHost);

    const query = state.clubQuery.trim();
    if (!query) {
      resultHost.append(h("p", { class: "muted" },
        "Skriv ett lag-/klubbnamn ovan för att se dess historik över alla cuper."));
      return;
    }

    if (state.clubDrillCup && state.clubDrillClass) {
      renderClubClassDetail(resultHost, state.clubDrillCup, state.clubDrillClass, query);
      return;
    }
    if (state.clubDrillCup) {
      renderClubCupDetail(resultHost, state.clubDrillCup, query);
      return;
    }

    const cupIds = trendCupOptions();
    const { pending, rows, loadedCount, totalCount } = computeClubRows(cupIds, query);
    if (pending) {
      resultHost.append(archiveProgressBlock(loadedCount, totalCount));
      return;
    }
    if (!rows.length) {
      resultHost.append(h("p", { class: "muted" },
        'Inga arkiverade matcher matchar "' + query + '" i någon cup.'));
      return;
    }

    const totalCups = rows.length;
    const totalTeams = rows.reduce((s, r) => s + r.totalTeams, 0);
    const totalMatches = rows.reduce((s, r) => s + r.totalMatches, 0);
    const allClasses = new Set(rows.flatMap((r) => [...r.classes]));
    const allYears = rows.flatMap((r) => r.years).sort();
    resultHost.append(h("p", { class: "muted" },
      totalCups + " cup" + (totalCups === 1 ? "" : "er") + " · " + totalTeams + " lag totalt · " +
      totalMatches + " matcher · " + allClasses.size + " klasser · " +
      allYears[0] + "–" + allYears[allYears.length - 1]));
    resultHost.append(h("div", { class: "row" },
      h("label", { class: "inline-toggle" },
        h("input", {
          type: "checkbox", ...(state.clubShowGaps ? { checked: "" } : {}),
          onchange: (e) => { state.clubShowGaps = e.target.checked; renderContent(); },
        }),
        " Markera missade år")));

    const columns = [
      { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
      { key: "years", label: "År", align: "l", defaultDir: 1, get: (r) => r.years.join(", "),
        ...(state.clubShowGaps ? { render: (r) => renderYearsWithGaps(r.cupId, r.years) } : {}) },
      { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.totalTeams },
      { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.totalMatches },
      { key: "classes", label: "Klasser", defaultDir: -1, get: (r) => r.classes.size },
    ];
    // Klickbar rad (se sortableTable) — går ner en nivå till cupens egna
    // klasser (renderClubCupDetail) i stället för att bara visa aggregatet.
    resultHost.append(sortableTable(columns, rows, clubTableSort,
      (r) => [...r.classes].sort((a, b) => catSortKey(a) - catSortKey(b)).join(", "),
      (r) => { state.clubDrillCup = r.cupId; renderContent(); }));
  }

  // Klubb/Lag, nedborrningsnivå 1: en vald cups klasser för sökningen —
  // klickar man en klass går man vidare till renderClubClassDetail.
  function renderClubCupDetail(root, cupId, query) {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    root.append(h("div", { class: "row" },
      h("button", {
        class: "chip back-chip", type: "button",
        onclick: () => { state.clubDrillCup = null; renderContent(); },
      }, "← Tillbaka till alla cuper")));

    // Samma lagnamnsindex-genväg som computeClubRows — bara de upplagor som
    // faktiskt kan innehålla söktermen behöver hämtas här heller (indexet
    // är i praktiken redan laddat vid det här laget, eftersom man alltid
    // kommer hit via en sökning i toppnivåtabellen — men den saknade
    // guarden om det inte skulle vara fallet).
    const editionsMeta = clubEditionsFor(cupId);
    const relevantEditions = state.teamIndex
      ? editionsMeta.filter((em) => editionMightMatch(cupId, em.edition, query))
      : editionsMeta;
    for (const em of relevantEditions) ensureYearMatches(em.edition, cupId);
    const loadedCount = relevantEditions.filter((em) => {
      const ym = state.yearMatches[cupId + ":" + em.edition];
      return ym && ym.status !== "loading";
    }).length;
    if (loadedCount < relevantEditions.length) {
      root.append(archiveProgressBlock(loadedCount, relevantEditions.length));
      return;
    }

    const detail = computeClubCupDetail(cupId, query);
    root.append(h("h2", { class: "day-h" }, cupName));
    if (!detail.classes.length) {
      root.append(h("p", { class: "muted" },
        'Inga matcher matchar "' + query + '" i ' + cupName + '.'));
      return;
    }
    root.append(h("p", { class: "muted" },
      detail.totalTeams + " lag · " + detail.totalMatches + " matcher · " +
      detail.totalDays + " speldagar · " + detail.classes.length + " klasser"));

    const columns = [
      { key: "className", label: "Klass", align: "l", defaultDir: 1, get: (r) => r.className },
      { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.teamCount },
      { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.matchCount },
    ];
    root.append(sortableTable(columns, detail.classes, clubClassTableSort, null,
      (r) => { state.clubDrillClass = r.className; renderContent(); }));
  }

  // Klubb/Lag, nedborrningsnivå 2: en vald cup+klass — de faktiska lagen
  // (ett per upplaga, se computeClubClassGroups) med sina riktiga matcher,
  // återanvänder matchCard rakt av (samma kort som Schema-vyn). Tabell-
  // placering/tidigare möten i matchdialogen (öppnas via matchCard) kan
  // sakna data för matcher från ANDRA cuper än den just nu aktiva —
  // de hämtas via cup()/state.cupId, inte cupId här — men det är en
  // känd, ofarlig begränsning (samma sak gäller redan idag för arkiverade
  // år i den vanliga Schema-vyn): dialogen visar bara "ingen tabell
  // tillgänglig" i stället för fel data.
  function renderClubClassDetail(root, cupId, className, query) {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const cupName = (cupObj && cupObj.name) || cupId;
    root.append(h("div", { class: "row" },
      h("button", {
        class: "chip back-chip", type: "button",
        onclick: () => { state.clubDrillClass = null; renderContent(); },
      }, "← Tillbaka till " + cupName)));
    root.append(h("h2", { class: "day-h" }, cupName + " · " + className));

    // Samma lata hämtning + förloppsindikator som nivån ovanför (renderClub-
    // CupDetail). Behövs eftersom man kan landa RAKT här via en djuplänk
    // (?clubCup=…&clubClass=…) utan att ha passerat nivå 0/1, som annars
    // hunnit fylla state.yearMatches — computeClubClassGroups hoppar tyst
    // över upplagor som inte är hämtade och hade gett "Inga matcher hittades".
    const editionsMeta = clubEditionsFor(cupId);
    const relevantEditions = state.teamIndex
      ? editionsMeta.filter((em) => editionMightMatch(cupId, em.edition, query))
      : editionsMeta;
    for (const em of relevantEditions) ensureYearMatches(em.edition, cupId);
    const loadedCount = relevantEditions.filter((em) => {
      const ym = state.yearMatches[cupId + ":" + em.edition];
      return ym && ym.status !== "loading";
    }).length;
    if (loadedCount < relevantEditions.length) {
      root.append(archiveProgressBlock(loadedCount, relevantEditions.length));
      return;
    }

    const groups = computeClubClassGroups(cupId, className, query);
    if (!groups.length) {
      root.append(h("p", { class: "muted" }, "Inga matcher hittades."));
      return;
    }
    for (const g of groups) {
      let w = 0, d = 0, l = 0;
      for (const m of g.matches) {
        const o = clubOutcomeLetter(m, g.teamId);
        if (o === "V") w++; else if (o === "O") d++; else if (o === "F") l++;
      }
      root.append(h("h3", { class: "day-h" }, g.teamName + " (" + g.edition + ")"));
      root.append(h("p", { class: "muted" },
        g.matches.length + " matcher · " + w + " V, " + d + " O, " + l + " F"));
      root.append(h("div", { class: "slot-matches" },
        g.matches.slice().sort((a, b) => b.start - a.start).map((m) => matchCard(m))));
    }
  }

  // Klubbjämförelse-fliken (under Stats): samma computeClubRows som Klubb/
  // Lag använder (en söktermsrad -> aggregat per cup), men i stället för
  // att borra ner i EN klubb visas flera klubbars/lags aggregat sida vid
  // sida i en tabell. Klubbar läggs till en i taget via en sökruta med
  // autocomplete (attachAutocomplete, minLen 2) — man skriver 2-3 bokstäver,
  // klickar rätt klubb i förslagslistan (eller trycker Enter för ett namn
  // som inte finns i förslagen), den hamnar som en chip i state.compareNames,
  // och sökrutan töms/får fokus igen så man kan söka nästa direkt. Max 8 —
  // fler skulle bara bli en orimligt bred/tung tabell (varje tillägg kräver
  // ensureYearMatches över alla cuper).
  let clubCompareTableSort = { key: "name", dir: 1 };
  const CLUB_COMPARE_MAX = 8;

  // Förslagskällan är klubbkatalogen (data/club-directory.json) — samma
  // katalog Karta använder för att gissa ProCup/Gothia-adresser — eftersom
  // den redan är ett städat register över klubbnamn (utan lagsuffix som
  // "Blå"/"Vit") tvärs över alla klassiska Cup Manager-cuper, och redan
  // cachas av HB.api.fetchClubDirectory(). Ett namn som inte finns med där
  // (t.ex. en klubb som bara spelat i Partille/ProCup) går ändå att lägga
  // till manuellt via Enter — katalogen är bara ett hjälpmedel, inget krav.
  let compareCandidates = null;
  function ensureCompareCandidates() {
    if (compareCandidates) return;
    compareCandidates = [];
    // INGEN renderContent() här när katalogen blir klar — attachAutocomplete
    // läser getCandidates() på nytt vid varje tangenttryckning (ren closure,
    // ingen snapshot), så nästa input-event ser automatiskt de färska
    // kandidaterna. En omritning här skulle i stället kunna riva upp och
    // ersätta sökrutan MITT I att någon skriver (katalogen hinner ofta bli
    // klar under de första tangenttryckningarna), vilket tömmer det man just
    // skrivit — värre än att förslagslistan helt enkelt är tom en bråkdel
    // av en sekund vid allra första besöket.
    HB.api.fetchClubDirectory().then((dir) => {
      compareCandidates = Object.keys(dir || {}).sort((a, b) => a.localeCompare(b, "sv"));
    });
  }

  function renderClubCompareView(root) {
    ensureCompareCandidates();
    const atMax = state.compareNames.length >= CLUB_COMPARE_MAX;
    const input = h("input", {
      class: "search compare-search", type: "text",
      placeholder: atMax ? "Max " + CLUB_COMPARE_MAX + " nådd" : "Sök klubb/lag …",
      disabled: atMax ? "" : null,
    });
    const options = h("div", { class: "autocomplete-list" });
    options.hidden = true;
    const addName = (raw) => {
      const name = raw.trim();
      if (!name || state.compareNames.length >= CLUB_COMPARE_MAX) return;
      if (!state.compareNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
        state.compareNames = [...state.compareNames, name];
      }
      renderContent();
      // Fokus tillbaka i sökrutan (den byggs om av renderContent() ovan) så
      // man kan söka nästa klubb/lag direkt utan att klicka i fältet igen.
      requestAnimationFrame(() => { const el = $(".compare-search"); if (el) el.focus(); });
    };
    attachAutocomplete(input, options, () => compareCandidates || [], addName, 2);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addName(input.value); }
    });
    root.append(h("div", { class: "history-controls" },
      h("div", { class: "autocomplete-wrap compare-search-wrap" }, input, options)));

    if (state.compareNames.length) {
      root.append(h("div", { class: "compare-chip-row" },
        state.compareNames.map((name) => h("span", { class: "compare-chip" },
          name,
          h("button", {
            class: "compare-chip-x", type: "button", "aria-label": "Ta bort " + name,
            onclick: () => {
              state.compareNames = state.compareNames.filter((n) => n !== name);
              renderContent();
            },
          }, "×")))));
    }

    const resultHost = h("div", { class: "trend-chart-host" });
    root.append(resultHost);
    if (!state.compareNames.length) {
      resultHost.append(h("p", { class: "muted" },
        "Sök och lägg till minst en klubb/lag ovan för att jämföra deras historik över alla cuper."));
      return;
    }

    const cupIds = trendCupOptions();
    let pending = false;
    let loadedCount = 0, totalCount = 0;
    const rows = state.compareNames.map((name) => {
      const res = computeClubRows(cupIds, name);
      if (res.pending) pending = true;
      loadedCount += res.loadedCount; totalCount += res.totalCount;
      const years = res.rows.flatMap((r) => r.years).sort();
      return {
        name,
        cups: res.rows.length,
        teams: res.rows.reduce((s, r) => s + r.totalTeams, 0),
        matches: res.rows.reduce((s, r) => s + r.totalMatches, 0),
        classes: new Set(res.rows.flatMap((r) => [...r.classes])).size,
        yearsSpan: years.length ? (years[0] === years[years.length - 1]
          ? years[0] : years[0] + "–" + years[years.length - 1]) : "–",
        detailRows: res.rows,
      };
    });
    if (pending) {
      resultHost.append(archiveProgressBlock(loadedCount, totalCount));
      return;
    }

    // Namnkolumnen får en ▾/▸-pil (i stället för en egen kolumn) som enda
    // visuella ledtråd om att raden går att fälla ut — sortableTable saknar
    // en egen per-rad-styling-krok, se dess kommentar.
    const columns = [
      { key: "name", label: "Klubb/lag", align: "l", defaultDir: 1,
        get: (r) => (state.compareExpanded.has(r.name) ? "▾ " : "▸ ") + r.name },
      { key: "cups", label: "Cuper", defaultDir: -1, get: (r) => r.cups },
      { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.teams },
      { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.matches },
      { key: "classes", label: "Klasser", defaultDir: -1, get: (r) => r.classes },
      { key: "yearsSpan", label: "År", align: "l", defaultDir: 1, get: (r) => r.yearsSpan },
    ];
    resultHost.append(sortableTable(columns, rows, clubCompareTableSort, null, (r) => {
      if (state.compareExpanded.has(r.name)) state.compareExpanded.delete(r.name);
      else state.compareExpanded.add(r.name);
      renderContent();
    }));

    for (const row of rows) {
      if (state.compareExpanded.has(row.name)) resultHost.append(clubCompareDetailBlock(row));
    }
  }

  // Klubbjämförelsens radexpansion (klicka en rad, se onRowClick ovan) —
  // en cup-för-cup-nedbrytning av VILKA klasser och, viktigast, VILKA rå
  // lagnamn som faktiskt matchade söktermen. Tänkt som en snabb egenkontroll
  // när man undrar om två snarlika sökningar (t.ex. en stavning med/utan
  // "s") råkar råka in på samma klubb i praktiken eller inte.
  function clubCompareDetailBlock(row) {
    return h("div", { class: "table-box compare-detail" },
      h("h3", { class: "compare-detail-name" }, row.name),
      row.detailRows.map((r) => h("div", { class: "compare-detail-cup" },
        h("div", { class: "compare-detail-cup-head" },
          h("strong", null, r.cupName), h("span", { class: "muted" }, r.years.join(", "))),
        h("p", { class: "muted" },
          "Klasser: " + [...r.classes].sort((a, b) => catSortKey(a) - catSortKey(b))
            .map((c) => HB.shortCat(c)).join(", ")),
        h("p", { class: "muted" }, "Lagnamn: " + [...r.names].sort((a, b) => a.localeCompare(b, "sv")).join(", ")))));
  }

  // Cuper-fliken (under Stats): en översiktsrad per cup, byggd helt ur
  // state.archiveIndex (redan hämtat via fetchArchiveIndex() i init(),
  // se dess kommentar) — INGEN ensureYearMatches krävs, index.json:s
  // per-upplaga-nyckeltal (matches/teams/classes/clubs/countries/days) räcker. Klick
  // på en rad borrar ner i den cupens egna år-för-år-historik.
  let cupsOverviewSort = { key: "cupName", dir: 1 };
  let cupsOverviewDetailSort = { key: "edition", dir: -1 };

  function statsCupOverviewRows() {
    const idx = state.archiveIndex || {};
    return trendCupOptions().map((cupId) => {
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const editions = ((idx[cupId] && idx[cupId].editions) || [])
        .filter((e) => e.matches > 0).slice().sort((a, b) => b.edition.localeCompare(a.edition));
      const latest = editions[0];
      return {
        cupId, cupName: (cupObj && cupObj.name) || (idx[cupId] && idx[cupId].cupName) || cupId,
        sport: (cupObj && cupObj.sport) || "handboll",
        years: editions.length, latestEdition: latest.edition,
        latestTeams: latest.teams || 0, latestMatches: latest.matches || 0,
        latestClasses: latest.classes || 0, latestClubs: latest.clubs || 0,
        latestCountries: latest.countries == null ? null : latest.countries,
        editions,
      };
    });
  }

  function renderCupsOverviewView(root) {
    if (state.statsCupDrill) { renderCupsOverviewDetail(root, state.statsCupDrill); return; }
    const rows = statsCupOverviewRows();
    if (!rows.length) {
      root.append(h("p", { class: "muted" }, "Ingen cup har ännu någon arkiverad historik."));
      return;
    }
    root.append(h("p", { class: "muted" },
      rows.length + " cuper · senaste upplagans nyckeltal — klicka en rad för år-för-år."));
    const columns = [
      { key: "cupName", label: "Cup", align: "l", defaultDir: 1, get: (r) => r.cupName },
      { key: "sport", label: "Sport", align: "l", defaultDir: 1, get: (r) => SPORT_LABELS[r.sport] || r.sport },
      { key: "years", label: "År", defaultDir: -1, get: (r) => r.years },
      { key: "latestEdition", label: "Senaste", align: "l", defaultDir: -1, get: (r) => r.latestEdition },
      { key: "latestTeams", label: "Lag", defaultDir: -1, get: (r) => r.latestTeams },
      { key: "latestMatches", label: "Matcher", defaultDir: -1, get: (r) => r.latestMatches },
      { key: "latestClasses", label: "Klasser", defaultDir: -1, get: (r) => r.latestClasses },
      { key: "latestClubs", label: "Klubbar", defaultDir: -1, get: (r) => r.latestClubs },
      { key: "latestCountries", label: "Länder", defaultDir: -1,
        get: (r) => r.latestCountries == null ? -1 : r.latestCountries,
        render: (r) => r.latestCountries == null ? "–" : String(r.latestCountries) },
    ];
    root.append(sortableTable(columns, rows, cupsOverviewSort, null,
      (r) => { state.statsCupDrill = r.cupId; renderContent(); }));
  }

  function renderCupsOverviewDetail(root, cupId) {
    const cupObj = HB.allCups().find((c) => c.id === cupId);
    const idx = state.archiveIndex || {};
    const cupName = (cupObj && cupObj.name) || (idx[cupId] && idx[cupId].cupName) || cupId;
    root.append(h("div", { class: "row" },
      h("button", {
        class: "chip back-chip", type: "button",
        onclick: () => { state.statsCupDrill = null; renderContent(); },
      }, "← Tillbaka till alla cuper")));
    root.append(h("h2", { class: "day-h" }, cupName));
    const editions = ((idx[cupId] && idx[cupId].editions) || []).filter((e) => e.matches > 0);
    if (!editions.length) {
      root.append(h("p", { class: "muted" }, "Ingen arkiverad historik hittades."));
      return;
    }
    const columns = [
      { key: "edition", label: "År", align: "l", defaultDir: -1, get: (r) => r.edition },
      { key: "teams", label: "Lag", defaultDir: -1, get: (r) => r.teams || 0 },
      { key: "matches", label: "Matcher", defaultDir: -1, get: (r) => r.matches || 0 },
      { key: "classes", label: "Klasser", defaultDir: -1, get: (r) => r.classes || 0 },
      // clubs = 0 betyder "uppgift saknas", inte "noll klubbar": det rena
      // klubbnamnsfältet tillkom i skraporna 2026-07-24, och år som
      // arkiverades dessförinnan (och ännu inte backfillats) har det inte
      // alls. Visa "–" som Länder redan gör — en nolla läses som att cupen
      // saknade klubbar, vilket den förstås inte gjorde. Trend-fliken gömmer
      // hela kolumnen i samma läge (se renderTrendChartBlock).
      { key: "clubs", label: "Klubbar", defaultDir: -1,
        get: (r) => r.clubs || -1,
        render: (r) => r.clubs ? String(r.clubs) : "–" },
      { key: "countries", label: "Länder", defaultDir: -1,
        get: (r) => r.countries == null ? -1 : r.countries,
        render: (r) => r.countries == null ? "–" : String(r.countries) },
      { key: "days", label: "Speldagar", defaultDir: -1, get: (r) => r.days || 0 },
    ];
    root.append(sortableTable(columns, editions, cupsOverviewDetailSort));
  }

  // Stats: samlar Trend/Karta/Klubb-Lag/Klubbjämförelse/Cuper under EN
  // toppnivåflik (index.html #viewTabs, state.view === "stats") i stället
  // för fem separata — alla fem svarar på samma sorts "tvärs över cuper/år"-
  // frågor, bara med olika linser, så en gemensam underflikrad (samma
  // [key,label,renderFn]-mönster som HISTORY_TABS ovan, se renderBrowseMode)
  // håller ihop dem utan att trycka undan Schema/Tabeller/Slutspel/Bana ur
  // huvudnavigeringen.
  // --- Vinnare (Stats-underflik): troféskåp, årets mästare, vinnartoppen ----
  // Läser data/champions.json (byggd av scripts/archive_results.py) — en rad
  // per A-slutspelsfinal över alla arkiverade cup-upplagor. Lägena/valen hålls
  // på modulnivå (som historyMode) så de överlever växling till en annan
  // Stats-underflik och tillbaka, men nollställs vid full sidladdning.
  let vinnareMode = "trofe";     // trofe | ar | topp
  let championsData = null;      // rows[] eller null tills laddat
  let championsLoading = false;
  let vinnareQuery = null;       // sökterm (troféskåp); null = default favoritklubb
  let vinnareMedals = { guld: true, silver: false, brons: false }; // vilka medaljer troféskåpet visar
  let vinnareCup = null;         // vald cup (årets mästare)
  let vinnareYear = null;        // valt år (årets mästare)
  let vinnareToppCup = "";       // cupfilter (vinnartoppen); "" = alla cuper
  let vinnareToppMedals = { guld: true, silver: false, brons: false }; // medaljer som räknas i topplistan

  // Tillhör lagnamnet/klubben favoritklubben? gc/sc/bc är redan normaliserade
  // klubbnamn (se normalize_club i archive_results.py); favoritklubben jämförs
  // både exakt och som lagnamnsprefix ("Alingsås HK" ⊂ "Alingsås HK Vit").
  function vinnareIsFav(clubCode, teamName) {
    const fav = (state.favoriteClub || "").trim().toLowerCase();
    if (!fav) return false;
    return (clubCode || "").toLowerCase() === fav ||
      (teamName || "").toLowerCase().startsWith(fav);
  }

  function renderVinnareView(root) {
    if (championsData === null) {
      root.append(h("p", { class: "muted" }, "Hämtar mästare …"));
      if (!championsLoading) {
        championsLoading = true;
        HB.api.fetchChampions()
          .then((d) => { championsData = (d && d.rows) || []; renderContent(); })
          .catch(() => { championsData = []; renderContent(); });
      }
      return;
    }
    const rows = championsData;
    if (!rows.length) {
      root.append(h("p", { class: "muted" },
        "Inga mästare arkiverade än — fylls på automatiskt allteftersom slutspel avgörs."));
      return;
    }
    root.append(h("div", { class: "row" },
      h("div", { class: "seg", role: "group", "aria-label": "Vinnarläge" },
        chip("Troféskåp", vinnareMode === "trofe", () => { vinnareMode = "trofe"; renderContent(); }),
        chip("Årets mästare", vinnareMode === "ar", () => { vinnareMode = "ar"; renderContent(); }),
        chip("Vinnartoppen", vinnareMode === "topp", () => { vinnareMode = "topp"; renderContent(); }))));
    const body = h("div", { class: "vinnare-body" });
    root.append(body);
    if (vinnareMode === "trofe") renderTrofeskap(body, rows);
    else if (vinnareMode === "ar") renderAretsMastare(body, rows);
    else renderVinnartoppen(body, rows);
  }

  function renderTrofeskap(root, rows) {
    const clubs = [...new Set(rows.map((r) => r.gc).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv"));
    if (vinnareQuery === null) vinnareQuery = state.favoriteClub || (clubs[0] || "");
    const listId = "vinnare-club-list";
    const dl = h("datalist", { id: listId }, clubs.map((c) => h("option", { value: c })));
    const input = h("input", {
      type: "text", class: "vinnare-club-input", list: listId, autocomplete: "off",
      placeholder: "Sök klubb, t.ex. Lugi …", value: vinnareQuery, "aria-label": "Klubb",
    });
    const apply = () => { if (input.value !== vinnareQuery) { vinnareQuery = input.value; renderContent(); } };
    input.addEventListener("change", apply);
    root.append(h("div", { class: "row vinnare-controls" },
      h("span", { class: "muted" }, "Klubb:"),
      h("div", { class: "autocomplete-wrap" }, input, dl)));

    // Fri delsträngssökning som tar med ALLA namnvarianter — "lugi" matchar
    // Lugi HF, Lugi HF 2, Lugi … (både klubbnyckeln gc och det råa lagnamnet g).
    const q = (vinnareQuery || "").trim().toLowerCase();
    const matchC = (club, name) => !!q && (((club || "").toLowerCase().includes(q)) || ((name || "").toLowerCase().includes(q)));
    // Klubbens medaljer: guld = vann finalen, silver = förlorade finalen,
    // brons = förlorade semifinalen (eller vann bronsmatchen). Se champions.json.
    const golds = q ? rows.filter((r) => matchC(r.gc, r.g)).map((r) => ({ r, medal: "guld", team: r.g, club: r.gc })) : [];
    const silvers = q ? rows.filter((r) => matchC(r.sc, r.s)).map((r) => ({ r, medal: "silver", team: r.s, club: r.sc })) : [];
    const bronzes = [];
    if (q) rows.forEach((r) => (r.bc || []).forEach((bc, i) => {
      const nm = (r.b || [])[i];
      if (matchC(bc, nm)) bronzes.push({ r, medal: "brons", team: nm, club: bc });
    }));
    const total = golds.length + silvers.length + bronzes.length;

    // Toggla vilka medaljer som visas (guld på från start = klassiskt troféskåp).
    if (q) {
      root.append(h("div", { class: "row vinnare-controls" },
        h("div", { class: "seg", role: "group", "aria-label": "Medaljer" },
          chip("🥇 Guld (" + golds.length + ")", vinnareMedals.guld, () => { vinnareMedals.guld = !vinnareMedals.guld; renderContent(); }),
          chip("🥈 Silver (" + silvers.length + ")", vinnareMedals.silver, () => { vinnareMedals.silver = !vinnareMedals.silver; renderContent(); }),
          chip("🥉 Brons (" + bronzes.length + ")", vinnareMedals.brons, () => { vinnareMedals.brons = !vinnareMedals.brons; renderContent(); }))));
    }

    const shown = [].concat(
      vinnareMedals.guld ? golds : [], vinnareMedals.silver ? silvers : [], vinnareMedals.brons ? bronzes : [])
      .sort((a, b) => b.r.ed.localeCompare(a.r.ed) || a.r.cupName.localeCompare(b.r.cupName, "sv"));
    const distinct = [...new Set([...golds, ...silvers, ...bronzes].map((x) => x.club).filter(Boolean))];
    const active = ["guld", "silver", "brons"].filter((t) => vinnareMedals[t]);
    const numLabel = active.length === 1
      ? (active[0] === "guld" ? (shown.length === 1 ? "titel" : "titlar") : active[0])
      : "medaljer";
    const heading = !q ? "Troféskåp"
      : distinct.length === 1 ? distinct[0] + "s troféskåp"
      : "Medaljer för “" + vinnareQuery.trim() + "”";
    const lead = !q ? "Skriv en klubb ovan för att se dess medaljer."
      : !total ? "Inga medaljer som matchar “" + vinnareQuery.trim() + "”."
      : "🥇 " + golds.length + "   🥈 " + silvers.length + "   🥉 " + bronzes.length +
        (distinct.length > 1 ? " · " + distinct.length + " lagnamn" : "") + " · klicka ett kort för slutspelsträdet.";
    root.append(h("div", { class: "trophy-hero" },
      h("div", { class: "trophy-num" },
        h("div", { class: "trophy-big" }, String(shown.length)),
        h("div", { class: "trophy-lbl" }, numLabel)),
      h("div", { class: "trophy-lead" },
        h("h3", null, heading),
        h("p", { class: "muted" }, lead))));
    if (!q) return;
    if (!shown.length) { root.append(h("p", { class: "muted" }, total ? "Välj minst en medaljtyp ovan." : "")); return; }
    const medalEmoji = { guld: "🥇", silver: "🥈", brons: "🥉" };
    root.append(h("div", { class: "tro-grid" },
      shown.map((x) => h("div", {
        class: "tro tro-click tro-" + x.medal, role: "button", tabindex: "0",
        title: "Öppna slutspelsträdet — " + x.r.cat + " (" + x.r.cupName + " " + x.r.ed + ")",
        onclick: () => gotoBrowseSlutspel(x.r.cup, x.r.ed, x.r.cat),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gotoBrowseSlutspel(x.r.cup, x.r.ed, x.r.cat); } },
      },
        h("span", { class: "tro-medal" }, medalEmoji[x.medal]),
        h("div", { class: "tro-yr" }, x.r.ed),
        h("div", { class: "tro-cup" }, x.r.cupName),
        h("div", { class: "tro-cls" }, x.r.cat),
        h("div", { class: "tro-team" }, x.team),
        h("span", { class: "tro-go" }, "Visa slutspel →")))));
  }

  function renderAretsMastare(root, rows) {
    const cups = [...new Map(rows.map((r) => [r.cup, r.cupName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "sv"));
    if (vinnareCup === null || !cups.some((c) => c[0] === vinnareCup)) {
      vinnareCup = cups.some((c) => c[0] === state.cupId) ? state.cupId : (cups[0] && cups[0][0]);
    }
    const years = [...new Set(rows.filter((r) => r.cup === vinnareCup).map((r) => r.ed))]
      .sort((a, b) => b.localeCompare(a));
    if (vinnareYear === null || !years.includes(vinnareYear)) vinnareYear = years[0];
    const cupSel = h("select", { class: "select", "aria-label": "Cup" },
      cups.map(([id, name]) => h("option", { value: id, ...(id === vinnareCup ? { selected: "" } : {}) }, name)));
    cupSel.addEventListener("change", () => { vinnareCup = cupSel.value; vinnareYear = null; renderContent(); });
    const yearSel = h("select", { class: "select", "aria-label": "År" },
      years.map((y) => h("option", { value: y, ...(y === vinnareYear ? { selected: "" } : {}) }, y)));
    yearSel.addEventListener("change", () => { vinnareYear = yearSel.value; renderContent(); });
    root.append(h("div", { class: "row vinnare-controls" }, cupSel, yearSel));

    const champs = rows.filter((r) => r.cup === vinnareCup && r.ed === vinnareYear)
      .sort((a, b) => a.cat.localeCompare(b.cat, "sv"));
    if (!champs.length) {
      root.append(h("p", { class: "muted" }, "Inga avgjorda A-slutspel för den upplagan."));
      return;
    }
    const rankRow = (medal, team, club) => team ? h("div", { class: "rank" },
      h("span", { class: "medal-badge" }, medal),
      h("span", { class: "rank-team" + (vinnareIsFav(club, team) ? " us" : "") }, team)) : null;
    root.append(h("div", { class: "champ-grid" },
      champs.map((c) => {
        const brons = c.b || [];
        const bronsFav = (c.bc || []).some((bc) => vinnareIsFav(bc, ""));
        return h("div", { class: "champ" },
          h("div", { class: "champ-cls" }, c.cat),
          rankRow("🥇", c.g, c.gc),
          rankRow("🥈", c.s, c.sc),
          brons.length ? h("div", { class: "rank" },
            h("span", { class: "medal-badge" }, "🥉"),
            h("span", { class: "rank-team" + (bronsFav ? " us" : "") }, brons.join(" · "))) : null);
      })));
  }

  function renderVinnartoppen(root, rows) {
    const cups = [...new Map(rows.map((r) => [r.cup, r.cupName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "sv"));
    // Ett cupfilter som inte finns i listan (t.ex. ett ?vtcup= för en cup
    // utan arkiverade A-finaler) hade annars gett en tom topplista medan
    // väljaren påstod "Alla cuper" — samma giltighetskoll som renderArets-
    // Mastare gör för sitt cupval.
    if (vinnareToppCup && !cups.some((c) => c[0] === vinnareToppCup)) vinnareToppCup = "";
    const cupSel = h("select", { class: "select", "aria-label": "Cup" },
      h("option", { value: "", ...(vinnareToppCup === "" ? { selected: "" } : {}) }, "Alla cuper"),
      cups.map(([id, name]) => h("option", { value: id, ...(id === vinnareToppCup ? { selected: "" } : {}) }, name)));
    cupSel.addEventListener("change", () => { vinnareToppCup = cupSel.value; renderContent(); });
    root.append(h("div", { class: "row vinnare-controls" }, h("span", { class: "muted" }, "Cup:"), cupSel));

    // Samma medaljval som troféskåpet — ranka på guld, silver, brons eller totalt.
    root.append(h("div", { class: "row vinnare-controls" },
      h("div", { class: "seg", role: "group", "aria-label": "Medaljer" },
        chip("🥇 Guld", vinnareToppMedals.guld, () => { vinnareToppMedals.guld = !vinnareToppMedals.guld; renderContent(); }),
        chip("🥈 Silver", vinnareToppMedals.silver, () => { vinnareToppMedals.silver = !vinnareToppMedals.silver; renderContent(); }),
        chip("🥉 Brons", vinnareToppMedals.brons, () => { vinnareToppMedals.brons = !vinnareToppMedals.brons; renderContent(); }))));
    const active = ["guld", "silver", "brons"].filter((t) => vinnareToppMedals[t]);
    const cntLabel = active.length === 1 ? " " + active[0] : " medaljer";

    const scope = vinnareToppCup ? rows.filter((r) => r.cup === vinnareToppCup) : rows;
    const count = new Map();
    const add = (club) => { if (club) count.set(club, (count.get(club) || 0) + 1); };
    scope.forEach((r) => {
      if (vinnareToppMedals.guld) add(r.gc);
      if (vinnareToppMedals.silver) add(r.sc);
      if (vinnareToppMedals.brons) (r.bc || []).forEach(add);
    });
    const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sv"));
    if (!ranked.length) {
      root.append(h("p", { class: "muted" }, active.length ? "Inga mästare för den cupen ännu." : "Välj minst en medaljtyp ovan."));
      return;
    }
    // Tät rangordning (samma antal medaljer delar placering).
    let rank = 0, prev = null;
    const withRank = ranked.map(([club, n], i) => {
      if (n !== prev) { rank = i + 1; prev = n; }
      return { club, n, rank };
    });
    const fav = (state.favoriteClub || "").trim().toLowerCase();
    const board = h("div", { class: "board" });
    withRank.slice(0, 25).forEach((e) => {
      board.append(h("div", { class: "brow" + (e.rank <= 3 ? " top3" : "") + (e.club.toLowerCase() === fav ? " us" : "") },
        h("span", { class: "brow-pos" }, String(e.rank)),
        h("span", { class: "brow-club" }, e.club, e.rank === 1 ? " 🏆" : ""),
        h("span", { class: "brow-cnt" }, String(e.n), h("small", null, cntLabel))));
    });
    root.append(board);
    // Ligger favoritklubben utanför topp 25 — visa dess placering separat sist.
    const favRow = fav && withRank.find((e) => e.club.toLowerCase() === fav);
    if (favRow && favRow.rank > 25) {
      board.append(h("div", { class: "brow us brow-sep" },
        h("span", { class: "brow-pos" }, String(favRow.rank)),
        h("span", { class: "brow-club" }, favRow.club),
        h("span", { class: "brow-cnt" }, String(favRow.n), h("small", null, cntLabel))));
    }
  }

  // --- Kalender (Stats-underflik): Gantt över cupernas speldagar -----------
  // Bygger på first/last-datumen i data/archive/index.json (se build_index i
  // scripts/archive_results.py). En rad per cup-upplaga, staplad på en
  // årsaxel (jan–dec) så man ser hela säsongen på en gång.
  let kalenderYear = null;

  // Öppnar en cup+upplaga från Kalender-fliken: live-upplagan i den vanliga
  // vyn, äldre upplagor i historik-bläddraren (schema).
  function gotoCupEdition(cupId, edition) {
    const live = (HB.allCups() || []).find((c) => c.id === cupId);
    if (live && String(live.edition) === String(edition)) {
      if (cupId !== state.cupId) switchCup(cupId);
      state.view = "schema"; saveUi(); render();
    } else {
      browseTarget = { cupId, edition, view: "schema", catFilter: "" };
      vinnareReturn = false; historyMode = "browse";
      state.statsView = "historik"; state.view = "stats"; saveUi(); renderContent();
    }
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function renderKalenderView(root) {
    const idx = state.archiveIndex;
    if (!idx) { root.append(h("p", { class: "muted" }, "Hämtar arkivindex …")); return; }
    const items = [];
    for (const cid in idx) {
      for (const e of (idx[cid].editions || [])) {
        if (e.first && e.last) {
          items.push({ cup: cid, cupName: idx[cid].cupName, ed: e.edition,
            first: e.first, last: e.last, matches: e.matches, days: e.days });
        }
      }
    }
    if (!items.length) { root.append(h("p", { class: "muted" }, "Ingen speldata med datum att visa än.")); return; }
    const years = [...new Set(items.map((i) => i.first.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
    const curY = String(new Date().getFullYear());
    if (kalenderYear === null || !years.includes(kalenderYear)) kalenderYear = years.includes(curY) ? curY : years[0];
    const yearSel = h("select", { class: "select", "aria-label": "Säsong" },
      years.map((y) => h("option", { value: y, ...(y === kalenderYear ? { selected: "" } : {}) }, y)));
    yearSel.addEventListener("change", () => { kalenderYear = yearSel.value; renderContent(); });
    root.append(h("div", { class: "row vinnare-controls" }, h("span", { class: "muted" }, "Säsong:"), yearSel));

    const Y = +kalenderYear;
    const yearDays = ((Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0) ? 366 : 365;
    const doy = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(Y, 0, 1)) / 86400000;
    const clampStart = (iso) => (+iso.slice(0, 4) < Y ? 0 : doy(iso));
    const clampEnd = (iso) => (+iso.slice(0, 4) > Y ? yearDays - 1 : doy(iso));
    const byCup = {};
    for (const i of items) (byCup[i.cup] = byCup[i.cup] || []).push(i);
    const realShown = items.filter((i) => i.first.slice(0, 4) === kalenderYear || i.last.slice(0, 4) === kalenderYear);
    const realCupIds = new Set(realShown.map((i) => i.cup));
    // Preliminär förhandsvisning: för den NYASTE säsongen, visa cuper som ännu
    // inte fått årets datum satt med FÖRRA årets datum (tydligt märkta) så man
    // ändå får en känsla för ungefär när de brukar spelas.
    const previews = [];
    if (kalenderYear === years[0]) {
      for (const cid in byCup) {
        if (realCupIds.has(cid)) continue;
        const past = byCup[cid].filter((e) => +e.first.slice(0, 4) < Y)
          .sort((a, b) => b.first.localeCompare(a.first))[0];
        if (!past) continue;
        previews.push({
          cup: cid, cupName: past.cupName, ed: past.ed,
          first: kalenderYear + past.first.slice(4), last: kalenderYear + past.last.slice(4),
          matches: past.matches, days: past.days, preview: true, srcYear: past.first.slice(0, 4),
        });
      }
    }
    const shown = [...realShown, ...previews]
      .sort((a, b) => a.first.localeCompare(b.first) || a.cupName.localeCompare(b.cupName, "sv"));
    if (!shown.length) { root.append(h("p", { class: "muted" }, "Inga cuper med speldagar det här året.")); return; }

    const months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    const monthStart = []; { let acc = 0; for (let mo = 0; mo < 12; mo++) { monthStart.push(acc); acc += new Date(Y, mo + 1, 0).getDate(); } }
    const pct = (d) => (d / yearDays) * 100;
    const gridlines = () => months.map((_, mo) => h("span", { class: "gantt-line", style: "left:" + pct(monthStart[mo]) + "%" }));
    const todayEl = () => {
      if (kalenderYear !== curY) return null;
      const t = doy(new Date().toISOString().slice(0, 10));
      return (t < 0 || t > yearDays) ? null : h("span", { class: "gantt-today", style: "left:" + pct(t) + "%" });
    };
    const fmtRange = (i) => {
      const day = (iso) => +iso.slice(8, 10);
      const mon = (iso) => months[+iso.slice(5, 7) - 1];
      if (i.first === i.last) return day(i.first) + " " + mon(i.first);
      if (i.first.slice(5, 7) === i.last.slice(5, 7)) return day(i.first) + "–" + day(i.last) + " " + mon(i.last);
      return day(i.first) + " " + mon(i.first) + " – " + day(i.last) + " " + mon(i.last);
    };

    const header = h("div", { class: "gantt-row gantt-headrow" },
      h("span", { class: "gantt-label" }, ""),
      h("div", { class: "gantt-track" }, months.map((mn, mo) => h("span", { class: "gantt-month", style: "left:" + pct(monthStart[mo]) + "%" }, mn))));
    const rows = shown.map((i) => {
      const s = Math.max(0, clampStart(i.first)), e = Math.min(yearDays - 1, clampEnd(i.last));
      const label = (i.preview ? "≈ " : "") + fmtRange(i);
      const tip = i.preview
        ? i.cupName + " — preliminärt: förra årets datum (" + i.srcYear + "). " + kalenderYear + " ännu inte spikat. Klicka för att se " + i.srcYear + " års schema."
        : i.cupName + " " + i.ed + " · " + i.first + " – " + i.last + " · " + i.days + " speldagar · " + i.matches + " matcher";
      const bar = h("div", {
        class: "gantt-bar" + (i.preview ? " gantt-preview" : ""),
        style: "left:" + pct(s) + "%;width:" + Math.max(pct(e - s + 1), 1.2) + "%", title: tip,
      }, h("span", { class: "gantt-bar-txt" }, label));
      return h("div", {
        class: "gantt-row gantt-row-click" + (i.preview ? " gantt-row-prev" : ""), role: "button", tabindex: "0",
        "aria-label": i.cupName + (i.preview ? " (preliminärt datum)" : " " + i.ed) + ", " + fmtRange(i),
        onclick: () => gotoCupEdition(i.cup, i.ed),
        onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); gotoCupEdition(i.cup, i.ed); } },
      },
        h("span", { class: "gantt-label", title: i.cupName }, i.cupName),
        h("div", { class: "gantt-track" }, gridlines(), todayEl(), bar));
    });
    root.append(h("div", { class: "gantt" }, header, ...rows));
    const hint = previews.length
      ? "Klicka en cup för att öppna dess schema. Röd linje = idag. Streckade staplar (≈) är förra årets datum — årets är ännu inte spikat."
      : "Klicka en cup för att öppna dess schema. Röd linje = idag.";
    root.append(h("p", { class: "muted gantt-hint" }, hint));
  }

  const STATS_TABS = [
    ["trend", "Trend", renderTrendView],
    ["vinnare", "🏆 Vinnare", renderVinnareView],
    ["kalender", "Kalender", renderKalenderView],
    ["karta", "Karta", renderMapView],
    ["klubb", "Klubb/Lag", renderClubView],
    ["klubbjamforelse", "Klubbjämförelse", renderClubCompareView],
    ["cuper", "Cuper", renderCupsOverviewView],
    ["historik", "Historik", renderHistoryView],
  ];

  function renderStatsView(root) {
    // state.statsSupport/statsKnown sätts av renderTabs() (körs alltid innan
    // renderContent() i render(), se dess kommentar) — men kan saknas om
    // renderContent() undantagsvis anropas direkt utan en föregående
    // renderTabs() (några asynkrona callbacks gör det, se t.ex.
    // ensureCupClubGeo/fetchArchiveIndex). Anta då att allt är stött hellre
    // än att gömma hela vyn i onödan.
    const support = state.statsSupport ||
      { trend: true, karta: true, vinnare: true, kalender: true, klubb: true, klubbjamforelse: true, cuper: true, historik: true };
    const visibleTabs = STATS_TABS.filter(([key]) => support[key]);
    // Den valda underfliken kan ha blivit ogiltig sen sist (t.ex. Karta
    // förlorade sitt stöd) — falla då tillbaka på den första som fortfarande
    // finns kvar, i stället för att rendera en tom/dold flik. Görs BARA när
    // vi vet säkert (state.statsKnown): Kartans klubbdata (litet, cup-
    // specifikt anrop) hinner ofta svara FÖRE det stora gemensamma
    // arkivindexet, så en mellanliggande omritning kan annars se ut som att
    // bara Karta är stödd än så länge — utan spärren skulle det permanent
    // knuffa bort en direktlänkad/sparad Trend-/Klubb-flik till Karta.
    if (state.statsKnown && !visibleTabs.some(([v]) => v === state.statsView)) {
      state.statsView = (visibleTabs[0] || STATS_TABS[0])[0];
    }
    // Visa alltid den just nu valda underfliken i listan, även om den ännu
    // inte hunnit bekräftas stödd (se ovan) — annars skulle den kunna blinka
    // bort ur fliklistan under en enda mellanliggande omritning.
    const shownKeys = new Set([...visibleTabs.map(([v]) => v), state.statsView]);
    const shownTabs = STATS_TABS.filter(([key]) => shownKeys.has(key));
    const tabBar = h("nav", { class: "history-tabs", role: "tablist", "aria-label": "Stats" },
      shownTabs.map(([v, label]) => h("button", {
        class: "tab" + (state.statsView === v ? " on" : ""), role: "tab", type: "button",
        onclick: () => { state.statsView = v; saveUi(); renderContent(); },
      }, label)));
    const content = h("div", { class: "history-viewer-body" });
    root.append(tabBar, content);
    const tabFn = (STATS_TABS.find(([v]) => v === state.statsView) || STATS_TABS[0])[2];
    tabFn(content);
    // Underflikraden är fast placerad på mobil (se style.css) — mät om
    // stapeln så innehållets bottenmarginal räknar med den.
    requestAnimationFrame(syncBottomStack);
  }

  function renderBrowseMode(root, idx, cupIds) {
    // hs = lokal, isolerad "state" för EN vald cup+edition — motsvarar
    // huvudappens state.matches/state.view men rör aldrig den riktiga
    // state, så bläddring i historik kan inte läcka in i eller störa
    // den vanliga live-cupen.
    //
    // Återanvänds från browseOpen när en upplaga redan är öppnad: render-
    // Content() kan köras när som helst (bakgrundsuppdatering var tredje
    // minut, arkivindexet som anländer, en URL-synk) och byggde tidigare
    // alltid ett tomt hs — vilket slängde tillbaka en pågående bläddring
    // till cup/år-väljaren mitt i. browseOpen sätts av renderViewer och
    // nollas av renderPicker, se deras kommentarer.
    const hs = (browseOpen && browseOpen.matches) ? browseOpen : {
      cupId: cupIds.includes(state.cupId) ? state.cupId : cupIds[0],
      edition: null, cupName: "", matches: [],
      view: "schema", catFilter: "", teamQuery: state.favoriteClub || "", arena: "",
    };

    function renderPicker() {
      const editions = idx[hs.cupId].editions.slice().sort((a, b) => b.edition.localeCompare(a.edition));
      const cupSel = h("select", { class: "select", "aria-label": "Välj cup" },
        cupIds.map((id) => h("option", { value: id, ...(id === hs.cupId ? { selected: "" } : {}) }, idx[id].cupName)));
      const edSel = h("select", { class: "select", "aria-label": "Välj år" },
        editions.map((e) => h("option", { value: e.edition },
          e.edition + " (" + e.matches + " matcher" +
          // Ospelad upplaga: matchantalet växer fortfarande allteftersom
          // arrangören publicerar klasserna (se preliminary i
          // scripts/archive_results.py).
          (e.preliminary ? ", preliminärt" : "") + ")")));
      cupSel.addEventListener("change", () => { hs.cupId = cupSel.value; renderPicker(); });
      const browseBtn = h("button", {
        class: "btn primary", type: "button",
        onclick: async () => {
          const edition = edSel.value;
          root.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
          const data = await HB.api.fetchArchiveEdition(hs.cupId, edition);
          hs.edition = edition;
          hs.cupName = idx[hs.cupId].cupName;
          hs.matches = (data && data.matches) || [];
          hs.view = "schema"; hs.catFilter = ""; hs.arena = "";
          renderViewer();
          syncUrl();
        },
      }, "Bläddra i " + idx[hs.cupId].cupName + " " + edSel.value);
      // Ingen upplaga öppen (eller på väg att öppnas) längre — släpp URL:ens
      // b*-parametrar.
      browseOpen = null; browseTarget = null;
      syncUrl();
      // Etiketten ska följa vald årtal, inte alltid det nyaste — edSel.value
      // är ännu tomt vid skapandet (första <option> sätts av webbläsaren
      // efter att elementet är i DOM:et), så sätt om texten en gång direkt
      // efter att den faktiskt fått ett värde, och sen vid varje ändring.
      const updateBrowseLabel = () => {
        browseBtn.textContent = "Bläddra i " + idx[hs.cupId].cupName + " " + edSel.value;
      };
      edSel.addEventListener("change", updateBrowseLabel);
      root.replaceChildren(h("div", { class: "history-picker" },
        h("p", { class: "muted" }, "Välj cup och år för att bläddra precis som i den vanliga appen — " +
          "Schema, Tabeller, Slutspel och Bana, men för en tidigare upplaga."),
        h("div", { class: "history-controls" }, cupSel, edSel),
        browseBtn));
      updateBrowseLabel();
    }

    function renderViewer() {
      // syncSubViewUrl läser hs live via browseOpen — sätts här (och nollas i
      // renderPicker) så URL:en alltid speglar den upplaga som faktiskt visas.
      browseOpen = hs;
      const tabBar = h("nav", { class: "history-tabs", role: "tablist", "aria-label": "Historikvy" },
        HISTORY_TABS.map(([v, label]) => h("button", {
          class: "tab" + (hs.view === v ? " on" : ""), role: "tab", type: "button",
          onclick: () => { hs.view = v; renderViewer(); syncUrl(); },
        }, label)));
      const content = h("div", { class: "history-viewer-body" });
      root.replaceChildren(
        h("div", { class: "history-viewer-head" },
          // Kom vi hit via ett klick i Vinnare-fliken (troféskåpet) — visa en
          // väg tillbaka dit, inte bara "byt cup/år" inom historiken.
          vinnareReturn ? h("button", {
            class: "chip", type: "button",
            onclick: () => {
              vinnareReturn = false; browseTarget = null;
              state.view = "stats"; state.statsView = "vinnare"; vinnareMode = "trofe";
              saveUi(); renderContent();
            },
          }, "← Tillbaka till troféskåpet") : null,
          h("button", { class: "chip", type: "button", onclick: () => { vinnareReturn = false; renderPicker(); } }, "← Byt cup/år"),
          h("span", { class: "cat" }, hs.cupName + " " + hs.edition),
          h("span", { class: "muted" }, hs.matches.length + " matcher")),
        tabBar, content);
      const tabFn = (HISTORY_TABS.find(([v]) => v === hs.view) || HISTORY_TABS[0])[2];
      tabFn(content, hs);
    }

    // Direktlänkning hit från t.ex. Vinnare-fliken (se gotoBrowseSlutspel):
    // ladda en bestämd cup+upplaga direkt i viewern i stället för väljaren.
    async function openTarget(t) {
      if (!idx[t.cupId] || !(idx[t.cupId].editions || []).some((e) => e.edition === t.edition)) {
        renderPicker(); // nollar browseTarget/browseOpen
        return;
      }
      hs.cupId = t.cupId; hs.edition = t.edition; hs.cupName = idx[t.cupId].cupName;
      hs.view = t.view || "slutspel"; hs.catFilter = t.catFilter || "";
      hs.arena = t.arena || ""; if (t.teamQuery != null) hs.teamQuery = t.teamQuery;
      root.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
      const data = await HB.api.fetchArchiveEdition(t.cupId, t.edition);
      hs.matches = (data && data.matches) || [];
      // Först NU är beställningen utförd. Att nolla den före await:en hade
      // gjort att en omritning under hämtningen (den är långsam första
      // gången) inte hittade något att öppna och föll tillbaka på väljaren —
      // fetchArchiveEdition cachar, så en omkörning är billig.
      if (browseTarget === t) browseTarget = null;
      renderViewer();
      syncUrl();
    }

    // En beställd upplaga (djuplänk eller klick i troféskåpet) väger tyngst,
    // därefter ett redan öppnat läge, annars cup/år-väljaren.
    if (browseTarget) {
      // Sätt browseOpen redan NU (inte först i renderViewer efter openTargets
      // await) så URL:en behåller sina b*-parametrar under hämtningen.
      browseOpen = { ...browseTarget };
      openTarget(browseTarget);
    } else if (browseOpen && browseOpen.matches) {
      renderViewer();
    } else {
      renderPicker();
    }
  }

  // Öppnar Historik-bläddraren direkt på en viss cup+upplaga+klass i slutspels-
  // vyn — används av Vinnare-fliken (klick på ett troféskåpskort). browseTarget
  // konsumeras av renderBrowseMode vid nästa render (nollställs där).
  let browseTarget = null;
  // Bläddrarens lokala hs-objekt medan en upplaga är öppnad (null = cup/år-
  // väljaren visas). syncSubViewUrl läser cupId/edition/view/catFilter/arena/
  // teamQuery direkt ur det — hs muteras ju av väljarna inuti bläddrarens
  // egna flikar, som bara anropar sin lokala refresh() och aldrig render().
  let browseOpen = null;
  const syncBrowseUrl = () => { if (browseOpen) syncUrl(); };
  let vinnareReturn = false;   // kom vi till historik-bläddraren via Vinnare?
  function gotoBrowseSlutspel(cupId, edition, catName) {
    browseTarget = { cupId, edition, view: "slutspel", catFilter: catName || "" };
    vinnareReturn = true;
    historyMode = "browse";
    state.statsView = "historik";
    state.view = "stats";
    saveUi();
    renderContent();
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // Historik (under Stats): "Jämför lag" (renderCompareMode) och "Bläddra i
  // ett år" (renderBrowseMode) var tidigare en fristående knapp+modal
  // (#historyBtn/openHistoryDialog) — flyttad hit 2026-07-26 som en sjätte
  // Stats-underflik, samma sorts "tvärs över cuper/år"-funktion som resten
  // av Stats i stället för en egen dialog vid sidan om. historyMode hålls
  // på modulnivå (INTE i state) så det överlever att man växlar till en
  // annan Stats-underflik och tillbaka, men nollställs vid en full
  // sidladdning — matchar hur läget redan fungerade som dialog (alltid
  // samma startläge, "Jämför lag", varje gång man öppnade den).
  let historyMode = "compare";

  function renderHistoryView(root) {
    const idx = state.archiveIndex;
    if (!idx) { root.append(h("p", { class: "muted" }, "Hämtar arkivindex …")); return; }
    const cupIds = Object.keys(idx).filter((id) => (idx[id].editions || []).length)
      .sort((a, b) => idx[a].cupName.localeCompare(idx[b].cupName, "sv"));
    if (!cupIds.length) {
      root.append(h("p", { class: "muted" },
        "Ingen historik arkiverad än — byggs upp automatiskt allteftersom cuperna spelas."));
      return;
    }
    root.append(h("div", { class: "row" },
      h("div", { class: "seg", role: "group", "aria-label": "Historikläge" },
        chip("Jämför lag", historyMode === "compare", () => { historyMode = "compare"; renderContent(); }),
        chip("Bläddra i ett år", historyMode === "browse", () => { historyMode = "browse"; renderContent(); }))));
    const body = h("div", null);
    root.append(body);
    if (historyMode === "compare") renderCompareMode(body, idx, cupIds);
    else renderBrowseMode(body, idx, cupIds);
  }

  function renderCompareMode(root, idx, cupIds) {
    let selCup = cupIds.includes(state.cupId) ? state.cupId : cupIds[0];
    let query = state.favoriteClub || "";
    let classFilter = "";
    let sortKey = "tid_desc";
    let allTeamNames = [];
    let editionsData = []; // [{edition, matches}] för selCup — hämtas bara vid cupbyte

    const cupSel = h("select", { class: "select", "aria-label": "Välj cup" },
      ...cupIds.map((id) => h("option", { value: id }, idx[id].cupName)));
    cupSel.value = selCup;

    const teamInput = h("input", {
      type: "text", placeholder: "Lag/klubb, t.ex. Alingsås HK",
    });
    teamInput.value = query;
    const teamOptions = h("div", { class: "autocomplete-list" });
    teamOptions.hidden = true;
    // teamInput.value läses bara i "change"/Enter-lyssnarna nedan (inte
    // "input", för att inte söka om vid varje tangenttryckning) — ×-
    // knappen skickar bara ett "input"-event, så onClear måste själv
    // uppdatera query/renderFiltered i stället för att förlita sig på
    // de vanliga lyssnarna.
    const teamWrap = h("div", { class: "autocomplete-wrap" },
      withClearButton(teamInput, () => { query = ""; classFilter = ""; renderFiltered(); }),
      teamOptions);

    const classSel = h("select", { class: "select", "aria-label": "Klass" },
      h("option", { value: "" }, "Alla klasser"));
    const sortSel = h("select", { class: "select", "aria-label": "Sortering" },
      ARCHIVE_SORTS.map(([v, l]) => h("option",
        { value: v, ...(v === sortKey ? { selected: "" } : {}) }, l)));

    const body = h("div", { class: "history-body" });
    root.replaceChildren(
      h("div", { class: "history-controls" }, cupSel, teamWrap, classSel, sortSel),
      body);

    // Filtrerar/sorterar redan hämtad data — ingen ny nätverksfråga, så
    // klass-/sorteringsbyten känns direkta.
    function renderFiltered() {
      if (!query.trim()) {
        classSel.replaceChildren(h("option", { value: "" }, "Alla klasser"));
        classSel.disabled = true;
        body.replaceChildren(h("p", { class: "muted" },
          "Skriv ett lag- eller klubbnamn ovan för att se resultat år för år."));
        return;
      }
      classSel.disabled = false;
      const rowsByYear = editionsData.map((d) =>
        ({ edition: d.edition, rows: summarizeArchiveMatches(d.matches, query) }));

      const classes = new Set();
      rowsByYear.forEach((y) => y.rows.forEach((r) => { if (r.catName) classes.add(r.catName); }));
      const classList = [...classes].sort((a, b) => catSortKey(a) - catSortKey(b));
      if (!classList.includes(classFilter)) classFilter = "";
      classSel.replaceChildren(
        h("option", { value: "" }, "Alla klasser"),
        ...classList.map((c) => h("option",
          { value: c, ...(c === classFilter ? { selected: "" } : {}) }, HB.shortCat(c))));

      const summaries = rowsByYear.map((y) => {
        const filtered = classFilter ? y.rows.filter((r) => r.catName === classFilter) : y.rows;
        const sorted = sortArchiveRows(filtered, sortKey);
        return { edition: y.edition, rows: sorted, ...archiveStats(sorted) };
      }).filter((s) => s.rows.length);

      if (!summaries.length) {
        body.replaceChildren(h("p", { class: "muted" },
          'Inga matcher hittades för "' + query + '"' +
          (classFilter ? " i " + HB.shortCat(classFilter) : "") +
          " i " + idx[selCup].cupName + "."));
        return;
      }
      body.replaceChildren(...summaries.map((s, i) => {
        const children = [
          h("summary", null,
            h("span", { class: "history-year-label" }, s.edition),
            h("span", { class: "history-year-stats" },
              s.played + " sp · " + s.won + "V " + s.tied + "O " + s.lost +
              "F · mål " + s.gf + "–" + s.ga)),
          h("div", { class: "arena-quick-list" }, s.rows.map(archiveMatchRow)),
        ];
        // Slutspelsträd/tabeller kräver ALLA lag i klassen, inte bara den
        // sökta klubbens — bara meningsfullt (och görligt att bygga rimligt
        // brett) när man smalnat av till en enda klass.
        let redraw = null;
        if (classFilter) {
          const yearMatches = (editionsData.find((d) => d.edition === s.edition) || {}).matches || [];
          const extra = historicalExtras(yearMatches, classFilter);
          if (extra.nodes.length) children.push(h("div", { class: "history-extra" }, extra.nodes));
          redraw = extra.redraw;
        }
        const isOpen = i === 0;
        const detailsEl = h("details", { class: "history-year", open: isOpen ? "" : null }, children);
        if (redraw) {
          if (isOpen) requestAnimationFrame(redraw);
          // Stängda år ritas om (rätt mått) först när de faktiskt fälls ut.
          detailsEl.addEventListener("toggle", () => { if (detailsEl.open) redraw(); });
        }
        return detailsEl;
      }));
    }

    async function loadCupData() {
      body.replaceChildren(h("p", { class: "muted" }, "Hämtar …"));
      const editions = idx[selCup].editions.slice()
        .sort((a, b) => b.edition.localeCompare(a.edition));
      const loaded = await Promise.all(
        editions.map((e) => HB.api.fetchArchiveEdition(selCup, e.edition)));
      editionsData = editions.map((e, i) =>
        ({ edition: e.edition, matches: (loaded[i] && loaded[i].matches) || [] }));
      const names = new Set();
      editionsData.forEach((d) => d.matches.forEach((m) => {
        names.add(m.home.name); names.add(m.away.name);
      }));
      allTeamNames = [...names].sort((a, b) => a.localeCompare(b, "sv"));
      classFilter = "";
      renderFiltered();
    }

    attachAutocomplete(teamInput, teamOptions, () => allTeamNames, (name) => {
      query = name; classFilter = ""; renderFiltered();
    });
    teamInput.addEventListener("change", () => {
      query = teamInput.value; classFilter = ""; renderFiltered();
    });
    teamInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); query = teamInput.value; classFilter = ""; renderFiltered();
      }
    });
    cupSel.addEventListener("change", () => { selCup = cupSel.value; loadCupData(); });
    classSel.addEventListener("change", () => { classFilter = classSel.value; renderFiltered(); });
    sortSel.addEventListener("change", () => { sortKey = sortSel.value; renderFiltered(); });

    loadCupData();
  }

  // Länken bakom "Data hämtad …"/"Uppdaterad …" i headern (#meta, se
  // renderMeta) — en enkel logg över VILKA matcher som räknas in i det
  // visade antalet. SAMMA urval som siffran (scoped(), dvs styrt av
  // klubb-/hela cupen-läget precis som Schema) — svarar direkt på "stämmer
  // det här antalet?"/"vilka matcher kom faktiskt med i hämtningen?". Klick
  // på en rad öppnar samma matchdialog som Schema-kortens (openMatchDialog).
  function openMatchLogDialog() {
    const matches = scoped().slice().sort((a, b) => a.start - b.start);
    const dataTs = HB.api.localDataTs[state.cupId];
    const fetchedLabel = dataTs
      ? "Data hämtad " + new Intl.DateTimeFormat("sv-SE", {
          day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        }).format(new Date(dataTs))
      : "Uppdaterad " + fmtDayLong.format(new Date(state.loadedAt)) + " " + fmtClock.format(new Date(state.loadedAt));
    const dlg = h("dialog", { class: "match-dialog history-dialog" });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    const openMatch = (m) => { dlg.close(); openMatchDialog(m); };
    const makeRow = (m) => h("tr", {
      class: "sortable-row-clickable", role: "button", tabindex: "0",
      onclick: () => openMatch(m),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatch(m); } },
    },
      h("th", { class: "l", scope: "row" },
        m.start ? fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)) : "–"),
      h("td", { class: "l" }, HB.shortCat(m.catName)),
      h("td", { class: "l" }, m.home.name),
      h("td", { class: "l" }, m.away.name),
      h("td", null, scoreText(m.res) || "–"));

    // Bygg raderna i omgångar (minne/miljö) — ~50 direkt, resten på begäran.
    // De flesta öppnar bara för att se de översta, inte alla 400+, så det är
    // onödigt att skapa hundratals DOM-rader i onödan.
    const BATCH = 50;
    let shown = 0;
    const tbody = h("tbody", null);
    const moreWrap = h("div", { class: "match-log-more" });
    function addRows(count) {
      const to = Math.min(shown + count, matches.length);
      const frag = document.createDocumentFragment();
      for (let i = shown; i < to; i++) frag.append(makeRow(matches[i]));
      tbody.append(frag);
      shown = to;
      renderMore();
    }
    function renderMore() {
      moreWrap.replaceChildren();
      const remaining = matches.length - shown;
      if (remaining <= 0) {
        if (matches.length > BATCH) moreWrap.append(h("span", { class: "muted" }, "Visar alla " + matches.length + "."));
        return;
      }
      moreWrap.append(
        h("span", { class: "muted" }, "Visar " + shown + " av " + matches.length + " · "),
        h("button", { class: "btn small", type: "button", onclick: () => addRows(BATCH) },
          "Visa fler (" + remaining + " kvar)"),
        remaining > BATCH
          ? h("button", { class: "btn small", type: "button", onclick: () => addRows(matches.length) }, "Visa alla")
          : null);
    }

    dlg.append(
      h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng", onclick: () => dlg.close() }, "×"),
      h("div", { class: "match-dialog-head" },
        h("span", { class: "cat" }, "Matcher i vyn"),
        h("span", null, cup().name),
        h("span", { class: "muted" }, fetchedLabel + " · " + matches.length + " matcher")),
      h("p", { class: "muted match-log-note" },
        "Det här är matcherna som räknas in i antalet högst upp — din nuvarande vy (" +
        (state.scope === "club" ? state.favoriteClub : "hela cupen") +
        "), inte en logg över ändringar. Tidsstämpeln är när schemat senast hämtades " +
        "från arrangören; för en avslutad cup ändras inget efteråt."),
      matches.length
        ? h("div", { class: "table-box match-log-table" },
            h("table", { class: "standings" },
              h("thead", null, h("tr", null,
                h("th", { class: "l" }, "Tid"), h("th", { class: "l" }, "Klass"),
                h("th", { class: "l" }, "Hemma"), h("th", { class: "l" }, "Borta"),
                h("th", null, "Resultat"))),
              tbody))
        : h("p", { class: "muted" }, "Inga matcher hämtade ännu."),
      moreWrap);
    if (matches.length) addRows(BATCH);
    dlg.showModal();
  }

  function openMatchDialog(m) {
    const sc = scoreText(m.res);
    const dlg = h("dialog", { class: "match-dialog" },
      h("button", {
        class: "dialog-x", type: "button", "aria-label": "Stäng",
        onclick: () => dlg.close(),
      }, "×"),
      h("div", { class: "match-dialog-head" },
        h("span", { class: "cat" }, HB.shortCat(m.catName)),
        m.divName ? h("span", { class: "div" }, m.divName) : null,
        h("span", null,
          fmtDayLong.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))),
        m.arena ? h("span", null, m.arena) : null,
        sc ? h("span", { class: "match-dialog-score" }, sc) : null),
      teamStatBlock(m, m.home, "home"),
      teamStatBlock(m, m.away, "away"),
      previousMeetingsBlock(m));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // --- render: schema --------------------------------------------------------

  function matchCard(m) {
    const sc = scoreText(m.res);
    const live = isLive(m);
    // Väder bara meningsfullt för matcher som inte redan är spelade.
    const weather = (!m.res || !m.res.fin)
      ? HB.weather.at(HB.weather.cached(cup()), m.start) : null;
    const teamEl = (side, other) => {
      const color = teamColor(side.name);
      return h("div", {
        class: "team" + (isClubName(side.name) ? " us" : "") +
          (m.res && m.res.fin && m.res.winner &&
            ((m.res.winner === "home") === (side === m.home)) ? " won" : ""),
        // stopPropagation: klick på ett lagnamn ska öppna EN­ dast lagets
        // egen snabbvy, inte trigga hela kortets onclick (matchdialogen
        // med båda lagen) ovanpå.
        ...(side.id ? {
          role: "button", tabindex: "0",
          onclick: (e) => { e.stopPropagation(); openTeamQuickView(m, side); },
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault(); e.stopPropagation(); openTeamQuickView(m, side);
            }
          },
        } : {}),
      },
        color ? h("span", { class: "team-color-dot", style: "background:" + color }) : null,
        side.name || "–",
        isFavoriteTeam(side.name, m.catName) ? h("span", { class: "fav-team-star" }, "⭐") : null);
    };
    const tint = cardTintColor(m);
    return h("article", {
      class: "match" + (isClubMatch(m) ? " ours" : "") + (tint ? " tinted" : ""),
      style: tint ? ("--card-tint:" + tint) : null,
      role: "button", tabindex: "0",
      "aria-label": "Visa lagstatistik för " + m.home.name + " mot " + m.away.name,
      onclick: () => openMatchDialog(m),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchDialog(m); }
      },
    },
      h("div", { class: "match-head" },
        h("span", { class: "cat" }, HB.shortCat(m.catName)),
        // m.edition är bara satt för matcher som blandats in från ett extra
        // år (state.years, se allActiveMatches) — odefinierad för
        // innevarande live-upplaga. Så länge man tittar på ETT år är det
        // rätt: en badge på varje kort vore brus när alla ändå är från
        // samma år. Blandas år in blir det däremot skevt — de gamla
        // matcherna märks med årtal medan årets står omärkta, och man kan
        // inte se vilket år ett omärkt kort hör till. Då får innevarande
        // upplaga sitt årtal också, så alla kort går att läsa likadant.
        (m.edition || (state.years.size ? cup().edition : null))
          ? h("span", { class: "match-year-badge" }, m.edition || cup().edition) : null,
        m.divName ? h("span", { class: "div" }, m.divName) : null,
        m.roundName && m.roundName !== m.divName
          ? h("span", { class: "div" }, m.roundName) : null,
        outcomeLetter(m)
          ? h("span", { class: "outcome-badge outcome-" + outcomeLetter(m).toLowerCase() },
              outcomeLetter(m)) : null,
        h("span", { class: "match-head-right" },
          weather ? h("span", { class: "weather", title: weather.temp + "°C" },
            weather.icon, weather.temp + "°") : null,
          m.arena ? h("span", {
            class: "arena arena-link", role: "button", tabindex: "0",
            title: "Visa alla matcher på " + m.arena,
            onclick: (e) => { e.stopPropagation(); openArenaQuickView(m.arena); },
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault(); e.stopPropagation(); openArenaQuickView(m.arena);
              }
            },
          }, m.arena) : h("span", { class: "arena" }, m.arena))),
      h("div", { class: "match-body" },
        h("div", { class: "teams" }, teamEl(m.home), teamEl(m.away)),
        h("div", {
          // Tiden visas redan en gång ovanför/till vänster (räls i tid-läge,
          // "when"-prefix i övriga sorteringar) — upprepa den inte på kortet.
          class: "score" + (live ? " live" : "") +
            (sc === "spelad" ? " played" : "") + (!sc && !live ? " pending" : ""),
        },
          live ? h("span", { class: "live-tag" }, h("span", { class: "live-dot" }), "LIVE") : null,
          sc || (live ? "" : "–"))));
  }

  function timeGroups(list, multiDay) {
    const groups = [];
    for (const m of list) {
      const key = multiDay
        ? dayKey(m.start) + " " + fmtTime.format(new Date(m.start))
        : fmtTime.format(new Date(m.start));
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, start: m.start, items: [m] });
    }
    return groups;
  }

  // Tidslinje (dagshuvuden, NU-linje, vätskepaus-indikator) — bruten ut ur
  // renderSchema() så den kan återanvändas rakt av för Bana-vyn (alltid
  // tidssorterad, oavsett state.sort som annars styr schemat).
  function renderTimeline(main, list) {
    // Dagshuvuden/veckodagsetiketter visas när listan faktiskt spänner
    // över mer än en kalenderdag — oavsett om det beror på att inget
    // dagfilter är satt eller att flera dagar valts samtidigt.
    const multiDay = new Set(list.map((m) => dayKey(m.start))).size > 1;
    const now = Date.now();
    const today = dayKey(now);
    let nowPlaced = false;
    let lastDay = "";
    let prevGroupStart = null; // för vätskepaus-indikatorn
    const wrap = h("div", { class: "timeline" });
    for (const g of timeGroups(list, multiDay)) {
      const gDay = dayKey(g.start);
      if (multiDay && gDay !== lastDay) {
        lastDay = gDay;
        nowPlaced = nowPlaced || gDay > today;
        wrap.append(h("h2", { class: "day-h" },
          fmtDayLong.format(new Date(g.start))));
        prevGroupStart = null; // ny dag: räkna inte paus över dagsgränsen
      }
      if (state.breakMinutes > 0 && prevGroupStart != null) {
        // Ledig tid = tid till nästa match minus föregåendes speltid,
        // inte bara mellanrummet mellan två starttider.
        const rawGapMin = Math.round((g.start - prevGroupStart) / 60000);
        const gapMin = rawGapMin - state.matchMinutes;
        if (gapMin >= state.breakMinutes) {
          wrap.append(h("div", { class: "break-line" },
            h("span", null,
              "🥤 " + gapMin + " min till nästa match — dags för mat/vätska")));
        }
      }
      prevGroupStart = g.start;
      if (!nowPlaced && gDay === today && g.start > now) {
        nowPlaced = true;
        wrap.append(h("div", { class: "nowline", id: "nowline" },
          h("span", null,
            "NU " + fmtTime.format(new Date(now)) +
            " · nästa match " + countdownText(g.start))));
      }
      wrap.append(h("div", { class: "slot" },
        h("div", { class: "rail" },
          fmtTime.format(new Date(g.start)),
          multiDay
            ? h("small", null, fmtDay.format(new Date(g.start))) : null),
        h("div", { class: "slot-matches" }, g.items.map(matchCard))));
    }
    main.append(wrap);
    // Nyast/kommande överst: bygg allt i den vanliga (äldst→nyast) ordningen
    // ovan helt oförändrat (dagshuvuden/NU-linje/vätskepaus räknas rätt då)
    // och vänd bara den FÄRDIGA DOM-ordningen på barnen efteråt — enklare
    // och säkrare än att skriva om hela den temporala logiken två gånger.
    if (state.timeOrder === "desc") {
      [...wrap.children].reverse().forEach((c) => wrap.appendChild(c));
    }
    // Flaggan sätts INNE i timeouten (inte här) och #nowline slås upp på
    // nytt då — under den första sidladdningen hinner flera
    // renderContent()-anrop rulla in i rad (laddningsläge → data → väder),
    // som var och en byter ut #content. Om flaggan sattes redan här och
    // just DEN HÄR renderingens nl-referens hann bli en losskopplad nod
    // innan timeouten körde, skulle scrollIntoView() tyst misslyckas och
    // aldrig försöka igen.
    if (!autoScrolledToNow && $("#nowline") &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTimeout(() => {
        if (autoScrolledToNow) return;
        const freshNl = $("#nowline");
        if (!freshNl) return;
        autoScrolledToNow = true;
        freshNl.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }

  // Hur många speldagar cupen BRUKAR ha, ur arkivindexets färdigspelade år
  // (max av de tre senaste — snittet skulle dras ner av corona-år och
  // enstaka nedbantade upplagor). null = ingen historik att jämföra med.
  function typicalMatchDays() {
    const eds = ((state.archiveIndex && state.archiveIndex[state.cupId] || {}).editions || [])
      .filter((e) => !e.preliminary && e.matches > 0 && e.days > 0);
    if (!eds.length) return null;
    return Math.max(...eds.slice(-3).map((e) => e.days));
  }

  // Innevarande cups schema är publicerat men inte färdigt: inget spelat än
  // OCH schemat är kortare/glesare än en färdig upplaga brukar vara.
  // Arrangören släpper klasser och tider löpande fram till cupstart, så
  // talen man ser är en ögonblicksbild som växer.
  //
  // Antalet SPELDAGAR mot historiken är den signal som faktiskt skiljer ett
  // halvpublicerat schema från ett färdigt: andelen otidsatta matcher duger
  // inte ensam. Göteborg Cup 2026 hade 47 % otidsatta (bara första helgen av
  // två publicerad, 3 av normalt 6 dagar) — under en ren 50 %-tröskel, alltså
  // osynlig precis när upplysningen behövs som mest. Örebro 2026 har tvärtom
  // ett komplett schema där bara slutspelsmatcherna väntar på tid (12 av 416),
  // och dess 3 dagar ÄR dess normala. null = inget att flagga.
  function pendingSchedule() {
    const ms = state.matches;
    if (!ms.length) return null;
    if (ms.some((m) => m.res && (m.res.fin || m.res.live))) return null;
    const timed = ms.filter((m) => m.start).length;
    const untimed = ms.length - timed;
    if (!untimed) return null;
    // start = svensk väggtid kodad som UTC-epoch-ms (se normalize i api.js),
    // så heltalsdivisionen ger rätt svenskt kalenderdatum direkt.
    const days = new Set();
    for (const m of ms) if (m.start) days.add(Math.floor(m.start / 86400000));
    const typicalDays = typicalMatchDays();
    const short = typicalDays != null && days.size < typicalDays;
    // Utan historik att jämföra med får andelen otidsatta avgöra (samma
    // trubbiga fallback som tidigare — en cup utan arkiv har inget bättre).
    if (!short && timed * 2 > ms.length) return null;
    const classes = new Set();
    for (const m of ms) if (m.catName) classes.add(m.catName);
    return {
      total: ms.length, timed, untimed, classes: classes.size,
      days: days.size, typicalDays: short ? typicalDays : null,
    };
  }

  function renderSchema(main) {
    renderHero(main);
    const pending = pendingSchedule();
    if (pending) {
      main.append(h("div", { class: "banner banner-info" },
        h("p", null,
          h("strong", null, "Schemat är inte klart än. "),
          pending.timed === 0
            ? "Inga speltider är satta ännu (" + pending.total + " matcher i " +
              pending.classes + " klasser är publicerade)"
            : pending.typicalDays
              // Det mest talande: cupen brukar spelas över fler dagar än det
              // som hunnit publiceras (Göteborg Cup: en av två helger).
              ? "Hittills är " + pending.days + " speldagar publicerade — " +
                cup().name + " brukar spelas över " + pending.typicalDays +
                " — och " + pending.untimed + " av " + pending.total +
                " matcher saknar fortfarande tid"
              : pending.untimed + " av " + pending.total +
                " matcher saknar fortfarande speltid",
          ". Arrangören fyller på med fler klasser och tider ända fram till cupstart, " +
          "så antalen här växer de närmaste veckorna."),
        h("p", null,
          "Titta in igen om några dagar. När tiderna är på plats kan du filtrera fram " +
          "just dina matcher och lägga dem i kalendern via " +
          // Exportmenyn sitter i verktygsraden, som på mobil är hopfälld i
          // två steg bakom bottenradens Filter-knapp (se filters-open/
          // filters-expanded i style.css) — hänvisa till hela vägen, annars
          // står man i remsan och hittar ingen export.
          (sheetMode() ? "“Filter” → “Mer” → “Exportera”" : "“Exportera”") +
          " → “📅 Kalender (.ics)” — de följer sedan med automatiskt i din telefon.")));
    }
    const hasSelection = hasFilterSelection();
    let automaticMatches = null;
    let automaticLabel = "";
    if (!hasSelection) {
      const cupMatches = allActiveMatches();
      const isFavoriteMatch = (m) =>
        isFavoriteTeam(m.home.name, m.catName) ||
        isFavoriteTeam(m.away.name, m.catName);
      const favoriteMatches = cupMatches.filter(isFavoriteMatch);
      const clubMatches = favoriteMatches.length ? [] : cupMatches.filter(isClubMatch);
      // Dag och matchstatus räcker avsiktligt inte för att öppna schemat på
      // egen hand (se hasFilterSelection), men om användaren redan valt dem
      // ska även det automatiska favorit-/klubburvalet respektera valet.
      const visibleCupMatches = cupMatches.filter((m) => {
        if (state.days.size && !state.days.has(dayKey(m.start))) return false;
        if (state.matchFilter === "upcoming" && m.res && m.res.fin) return false;
        if (state.matchFilter === "played" && !(m.res && m.res.fin)) return false;
        return true;
      });

      if (state.schemaShowAllCup) {
        // filtered() börjar i scoped(), vilket normalt är favoritklubben.
        // Här är avsikten uttryckligen hela cupen, så behåll bara de övriga
        // vyvalen som fortfarande kan vara aktiva (dag/matchstatus).
        automaticMatches = visibleCupMatches;
        // Hela cupen är över tusen matcher i en stor cup — vägen tillbaka
        // måste finnas kvar, annars sitter man fast i den listan tills man
        // laddar om eller byter cup. Etiketten sätts bara när det FINNS ett
        // favoriturval att gå tillbaka till.
        if (favoriteMatches.length) automaticLabel = "back:dina lag";
        else if (cupMatches.some(isClubMatch)) automaticLabel = "back:din klubb";
      } else if (favoriteMatches.length) {
        automaticMatches = visibleCupMatches.filter(isFavoriteMatch);
        automaticLabel = "Visar dina lag";
      } else if (clubMatches.length) {
        automaticMatches = visibleCupMatches.filter(isClubMatch);
        automaticLabel = "Visar din klubb";
      } else {
        main.append(h("div", { class: "banner" },
          // Knappen heter olika saker beroende på layout — "Filter och
          // sortering" i verktygsraden på dator, bara "Filter" i mobilens
          // bottenrad. Att hänvisa till fel namn hjälper ingen.
          sheetMode()
            ? "Välj klass, lag eller plan under “Filter” för att visa schemat."
            : "Välj klass, lag eller plan ovan (“Filter och sortering”) för att visa schemat."));
        return;
      }
    }

    if (automaticLabel) {
      const tillbaka = automaticLabel.startsWith("back:");
      main.append(h("div", { class: "banner" },
        h("div", { class: "row" },
          h("span", null, tillbaka ? "Visar hela cupen" : automaticLabel),
          h("button", {
            class: "btn", type: "button",
            onclick: () => {
              state.schemaShowAllCup = !tillbaka;
              renderContent();
            },
          }, tillbaka ? "Visa bara " + automaticLabel.slice(5) : "Visa hela cupen"))));
    }
    const list = sorted((automaticMatches || filtered()).filter(matchesViewFilter));
    if (!list.length) {
      if (state.scope === "club" && !scoped().length && state.matches.length) {
        main.append(h("div", { class: "banner" },
          h("p", null, state.favoriteClub + " verkar inte ha några matcher i " +
            cup().name + "."),
          h("button", {
            class: "btn", type: "button",
            onclick: () => { state.scope = "all"; saveUi(); render(); },
          }, "Visa hela cupen")));
      } else {
        main.append(h("div", { class: "banner" },
          "Inga matcher matchar filtren. Prova att rensa något filter."));
      }
      return;
    }

    if (state.sort === "tid") {
      // Antalsbaserat, inte tidsbaserat: "senaste timmen" gav noll matcher i
      // en gles cup och femtio i en tät. Man vill se DE SENASTE spelade,
      // oavsett hur länge sedan de spelades — samma resonemang som Bana
      // redan bygger på (se splitRecentPlayedByCount).
      const retro = isRetrospective(list);
      const visaAntal = retro ? SCHEMA_RETRO_BATCH : state.recentMatchCount;
      const batch = retro ? SCHEMA_RETRO_BATCH : state.revealBatchSize;
      const { visible, hiddenCount } = splitRecentPlayedByCount(
        list, visaAntal, state.schemaOlderRevealCount);
      const loadMoreBtn = loadMorePlayedButtons(hiddenCount, batch,
        state.timeOrder === "desc" ? "↓" : "↑",
        () => { state.schemaOlderRevealCount += batch; renderContent(); },
        () => { state.schemaOlderRevealCount = Infinity; renderContent(); });
      // Äldre matcher hamnar överst i asc-ordning (äldst→nyast) och underst
      // i desc-ordning (nyast/kommande överst) — knappen placeras därefter.
      if (loadMoreBtn && state.timeOrder === "asc") main.append(loadMoreBtn);
      renderTimeline(main, visible);
      if (loadMoreBtn && state.timeOrder === "desc") main.append(loadMoreBtn);
    } else {
      const outcomeLabels = ["Vunnet", "Oavgjort", "Förlorat", "Ospelat"];
      const keyOf = {
        klass: (m) => m.catName + (m.divName ? " · " + m.divName : ""),
        plan: (m) => m.arena || "Plan ej satt",
        resultat: (m) => outcomeLabels[outcomeRank(m)],
      }[state.sort] || (() => null); // "mal": ingen gruppering, bara löpande lista
      let lastKey; // undefined ≠ null: tvingar fram en första sektion
      const wrap = h("div", { class: "grouped" });
      let sect = null;
      for (const m of list) {
        const k = keyOf(m);
        if (k !== lastKey || !sect) {
          lastKey = k;
          sect = h("div", { class: "slot-matches" });
          // Samma Element.append()-fälla som ovan (stringifierar null till
          // "null") — hoppa över rubriken helt i stället för att skicka in
          // ett null-argument när "Sortera: mål" (ingen gruppering) är valt.
          if (k !== null) wrap.append(h("h2", { class: "day-h" }, k));
          wrap.append(sect);
        }
        const card = matchCard(m);
        card.prepend(h("div", { class: "when" },
          fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))));
        sect.append(card);
      }
      main.append(wrap);
    }
  }

  // Döljer gamla spelade matcher bakom en knapp, så en lång lista (ett fullt
  // schema) blir överskådlig — behåller alltid ALLA kommande/pågående
  // matcher plus spelade matcher från de senaste cutoffHours timmarna.
  // revealExtra öppnar upp DE NÄRMAST cutoff (dvs de senast spelade av de
  // gömda) — antingen ett fast antal i taget ("visa fler tidigare",
  // schemat) eller Infinity ("visa alla"). Bana/slutspelstabellen använder
  // i stället den antalsbaserade splitRecentPlayedByCount() nedan, se dess
  // kommentar för varför.

  // "Visa fler/alla tidigare"-knapparna kan lägga till matcher antingen
  // OVANFÖR eller NEDANFÖR där man redan tittar, beroende på
  // sorteringsordning (stigande/fallande) — att försöka bevara exakt
  // skärmposition (tidigare försök) blir därför inkonsekvent och svårt
  // att förutsäga, och kan dessutom krocka med renderTimeline()s egen
  // engångs-auto-scroll till NU-linjen. Enklare, tydligare regel:
  // - Schemat: scrolla till NU-linjen, som en tidslinje — några
  //   föregående matcher, aktuell, och kommande, enligt aktuellt filter.
  //   Samma idé som det vanliga förstagångs-scrollet, fast upprepad.
  // - Övriga vyer (Bana, slutspelstabellen): stanna högst upp i
  //   innehållet — förutsägbart oavsett åt vilket håll nytt innehåll
  //   landade.
  function preserveScrollOnExpand(rerenderFn) {
    autoScrolledToNow = true; // hindra renderTimeline() från att scrolla dit SJÄLV också
    rerenderFn();
    if (state.view === "schema") {
      const nl = $("#nowline");
      if (nl) { nl.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // Visar alltid de N SENAST SPELADE matcherna plus alla ännu ospelade.
  // Ett fast timfönster vore opålitligt: matchlängden varierar
  // för mycket mellan cuper (korta beachmatcher kontra långa 11-manna-
  // matcher) för att t.ex. "senaste 2 tim" ska ge samma antal synliga
  // matcher överallt. Visar i stället alltid de N SENAST SPELADE matcherna
  // (oavsett hur länge sedan de spelades) plus alla ännu ospelade — man
  // ser matchflödet (senaste resultatet + vad som är på gång) lika bra på
  // en kort som en lång cup. N styrs av inställningen state.recentMatchCount.
  function splitRecentPlayedByCount(list, recentCount, revealExtra) {
    const finished = [];
    const rest = [];
    for (const m of list) {
      if (m.res && m.res.fin) finished.push(m); else rest.push(m);
    }
    finished.sort((a, b) => a.start - b.start);
    const keep = revealExtra === Infinity ? finished.length : recentCount + revealExtra;
    const always = finished.slice(Math.max(0, finished.length - keep));
    const hiddenCount = finished.length - always.length;
    const visible = [...always, ...rest].sort((a, b) => a.start - b.start);
    return { visible, hiddenCount };
  }

  function showAllPlayedButtonCount(hiddenCount, recentCount, onClick) {
    if (!hiddenCount) return null;
    return h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onClick),
    }, "Visa " + hiddenCount + " äldre spelade matcher (senaste " +
      recentCount + " visas alltid)");
  }

  // Samma idé men laddar bara BATCH matcher i taget (klicka flera gånger
  // för att gå längre bakåt, eller "Visa alla" för att hoppa hela vägen)
  // — bättre för schemats ofta mycket längre historik än bana/slutspelets
  // "visa allt på en gång". batchSize styrs av inställningen
  // state.revealBatchSize (förval 4, valfritt tal).
  function loadMorePlayedButtons(hiddenCount, batchSize, arrow, onLoadMore, onLoadAll) {
    if (!hiddenCount) return null;
    const moreBtn = h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onLoadMore),
    }, arrow + " Visa " + Math.min(batchSize, hiddenCount) + " tidigare matcher (" +
      hiddenCount + " till)");
    const allBtn = hiddenCount > batchSize ? h("button", {
      class: "btn small show-all-played", type: "button",
      onclick: () => preserveScrollOnExpand(onLoadAll),
    }, "Visa alla (" + hiddenCount + ")") : null;
    return h("div", { class: "load-more-row" }, moreBtn, allBtn);
  }

  // Två helt olika användningslägen för schemat:
  //
  //   PÅGÅENDE CUP — man står i hallen och vill veta hur det nyss gick. Då
  //   räcker de par senast spelade (state.recentMatchCount); att scrolla
  //   förbi femtio avklarade matcher för att hitta den kommande är rent
  //   motstånd.
  //
  //   I EFTERHAND — man går igenom en avslutad cup för att se hur det gick,
  //   vilka man mötte, hur det slutade. Då är de spelade matcherna hela
  //   poängen, och att klicka fram fyra åt gången är tröttsamt.
  //
  // Gränsen dras vid en vecka sedan sista matchen. Kortare än så kan cupen
  // fortfarande pågå (eller nyss ha avslutats, då man ännu kollar resultat
  // löpande); längre än så är man där för historiken.
  const SCHEMA_RETRO_DAYS = 7;
  const SCHEMA_RETRO_BATCH = 20;

  function isRetrospective(list) {
    let senaste = 0;
    for (const m of list) if (m.start > senaste) senaste = m.start;
    if (!senaste) return false;
    return Date.now() - senaste > SCHEMA_RETRO_DAYS * 86400000;
  }

  // --- render: bana -----------------------------------------------------------

  // Egen flik för att snabbt välja en bana och se dess kommande/spelade
  // matcher — till skillnad från openArenaQuickView() (en tillfällig
  // dialog som inte rör filtret) är det här en riktig vy man kan stanna
  // kvar i. Lyder under EXAKT samma verktygsradsfilter (klubb/hela cupen,
  // dagar, klasser, egna lag, matchstatus, sök) som schema/tabeller/
  // slutspel via filtered() — hade tidigare en egen inline-kopia av bara
  // matchstatus-växlaren (dubblett av verktygsradens) och struntade helt
  // i klubbfiltret, vilket gjorde att fliken både såg och betedde sig
  // annorlunda än resten av appen.
  function renderArenaView(main) {
    const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
    if (!arenas.length) {
      main.append(h("div", { class: "banner" }, "Inga planer hittades för den här cupen."));
      return;
    }
    if (state.viewArena && !arenas.includes(state.viewArena)) state.viewArena = "";
    main.append(h("div", { class: "row" },
      h("select", {
        class: "select", "aria-label": "Välj bana",
        onchange: (e) => {
          state.viewArena = e.target.value; state.showAllPlayedArena = false;
          saveUi(); renderContent();
        },
      },
        h("option", { value: "" }, "Välj bana …"),
        arenas.map((a) => h("option",
          { value: a, ...(state.viewArena === a ? { selected: "" } : {}) }, a)))));

    renderArenaPlaceBlock(main, arenas);

    if (!state.viewArena) {
      main.append(h("div", { class: "banner" }, "Välj en bana ovan för att se dess matcher."));
      return;
    }
    const list = filtered(state.viewArena);
    if (!list.length) {
      main.append(h("div", { class: "banner" },
        "Inga matcher matchar filtret på " + state.viewArena + "."));
      return;
    }
    const { visible, hiddenCount } = splitRecentPlayedByCount(
      list, state.recentMatchCount, state.showAllPlayedArena ? Infinity : 0);
    renderTimeline(main, visible);
    const btn = showAllPlayedButtonCount(hiddenCount, state.recentMatchCount, () => {
      state.showAllPlayedArena = true; renderContent();
    });
    if (btn) main.append(btn);
  }

  // --- Bana-vyns platsblock (adress + karta) -------------------------------
  // Banorna bär bara ett NAMN i matchdatan ("Bana 14", "Noltorpshallen 2").
  // HB.api.arenaGeo (se arenaGeoFromStore i api.js / arenas_from_store i
  // scripts/fetch_cupmanager.py) kopplar namnet till en PLATS med adress och
  // koordinater. Bara klassiska Cup Manager-cuper har datan — ProCup och
  // Gothia exponerar ingen arenaadress alls, och deras banor får därför
  // inget platsblock (samma begränsning som Karta-flikens klubbadresser).
  //
  // Flera banor delar ofta plats: Åhus Beach har 19 banor på EN adress
  // eftersom de ligger utspridda på samma inhägnade festivalområde, och
  // Noltorpshallen 1/2/3 är en hall. Därför grupperas nålarna på loc
  // (location-id), inte på banans namn — annars hade de lagts i en hög på
  // exakt samma punkt.
  function arenaGeoFor(name) {
    return (HB.api.arenaGeo[state.cupId] || {})[name] || null;
  }

  // Adressdatan kan saknas trots att cupen i övrigt är laddad: loadCup()
  // läser i FÖRSTA hand localStorage-cachen, och poster skrivna innan
  // arenas-fältet infördes (2026-08-07) har det inte. Snapshot-vägen som
  // annars fyller fältet körs bara när det inte finns NÅGON cache, och för
  // en avslutad cup görs ingen live-hämtning heller (refreshTtl är lång) —
  // utan den här lata hämtningen skulle Bana-vyn sakna adress ända tills
  // cachen en dag naturligt förnyas. Samma princip som ensureCupClubGeo.
  const arenaGeoStatus = {}; // cupId -> "loading" | "done"

  function ensureCupArenaGeo(cupId) {
    if (HB.api.arenaGeo[cupId] || arenaGeoStatus[cupId]) return;
    const c = HB.allCups().find((x) => x.id === cupId);
    // ProCup/Gothia (dataUrl-cuper) har ingen arenaadress i källan alls —
    // markera som färdig direkt i stället för att hämta en snapshot som
    // inte finns.
    if (!c || c.dataUrl) { arenaGeoStatus[cupId] = "done"; return; }
    arenaGeoStatus[cupId] = "loading";
    fetch("data/snapshot-" + cupId + ".json?_=" + Date.now().toString(36))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        HB.api.arenaGeo[cupId] = (j && j.arenas) || {};
        arenaGeoStatus[cupId] = "done";
        // Skriv tillbaka till cachen så nästa besök slipper hämta om hela
        // snapshotten (Åhus är 6382 matcher) bara för adresserna.
        if (state.cupId === cupId && state.matches.length) {
          HB.api.writeCache(c, state.matches, state.loadedAt);
        }
        if (state.view === "bana" && state.cupId === cupId) renderContent();
      })
      .catch(() => { HB.api.arenaGeo[cupId] = {}; arenaGeoStatus[cupId] = "done"; });
  }

  // [{loc, venue, street, city, lat, lng, arenas:[banor], matches:n}] för
  // cupens alla banor med känd adress — en post per PLATS.
  function arenaPlaces(arenas) {
    const byLoc = new Map();
    for (const a of arenas) {
      const g = arenaGeoFor(a);
      if (!g) continue;
      const key = g.loc != null ? String(g.loc) : g.lat + "," + g.lng;
      if (!byLoc.has(key)) {
        byLoc.set(key, { key, venue: g.venue, street: g.street, city: g.city,
                          lat: g.lat, lng: g.lng, arenas: [], matches: 0 });
      }
      byLoc.get(key).arenas.push(a);
    }
    for (const p of byLoc.values()) {
      p.matches = scoped().filter((m) => p.arenas.includes(m.arena)).length;
    }
    return [...byLoc.values()];
  }

  // Platsens rubrik: location-namnet ("Estrad", "Noltorpshallen"), med
  // gatan som reserv när platsen saknar namn. Popupen visar adressen på
  // egen rad under, så rubriken utelämnas när den skulle bli en ren
  // dubblett av den (en namnlös plats där rubrik och adress är samma gata).
  function placeLabel(place) {
    return (place.venue || "").trim() || place.street || place.city || "";
  }

  function addressText(place) {
    return [place.street, place.city].filter(Boolean).join(", ");
  }

  function renderArenaPlaceBlock(main, arenas) {
    ensureCupArenaGeo(state.cupId); // ritar om själv när datan landat
    const places = arenaPlaces(arenas);
    if (!places.length) return; // ProCup/Gothia: ingen adressdata att visa
    const sel = state.viewArena ? arenaGeoFor(state.viewArena) : null;
    const selKey = sel ? (sel.loc != null ? String(sel.loc) : sel.lat + "," + sel.lng) : null;

    if (sel) {
      const place = places.find((p) => p.key === selKey);
      const siblings = place ? place.arenas.filter((a) => a !== state.viewArena) : [];
      // Räkna i stället för att räkna upp när platsen har många banor —
      // Åhus 18 syskon skulle annars bli en rad text som dränker adressen.
      const siblingText = !siblings.length ? null
        : siblings.length > ARENA_SIBLING_NAMES
          ? " · " + siblings.length + " andra banor på samma plats"
          : " · samma plats som " + siblings.join(", ");
      main.append(h("p", { class: "muted arena-address" },
        h("span", { class: "arena-pin" }, "📍"),
        addressText(sel),
        siblingText ? h("span", { class: "arena-siblings" }, siblingText) : null));
    }

    main.append(h("div", { class: "row" },
      h("button", {
        class: "chip" + (state.arenaMapOpen ? " on" : ""), type: "button",
        "aria-expanded": state.arenaMapOpen ? "true" : "false",
        onclick: () => { state.arenaMapOpen = !state.arenaMapOpen; renderContent(); },
      }, (state.arenaMapOpen ? "▾ " : "▸ ") + "Visa på karta"
         + (places.length > 1 ? " (" + places.length + " platser)" : ""))));

    if (!state.arenaMapOpen) return;
    const box = h("div", { class: "arena-map-box" });
    main.append(box);
    ensureMapLibre().then((maplibregl) => {
      // Vyn kan ha bytts ut medan MapLibre laddades — rita då ingenting.
      if (!box.isConnected) return;
      createArenaMap(maplibregl, box, places, selKey);
    }).catch((e) => {
      box.replaceChildren(h("p", { class: "muted" },
        "Kartan kunde inte laddas: " + e.message));
    });
  }

  // Egen kartinstans, HELT skild från Karta-flikens currentMap — de två kan
  // aldrig vara synliga samtidigt (olika toppnivåflikar), men att dela
  // variabel hade gjort att den enas städning rev den andras karta.
  let arenaMap = null;
  const ARENA_POPUP_COURTS = 12; // hur många banchips en platspopup visar
  const ARENA_SIBLING_NAMES = 4; // fler syskonbanor än så räknas i stället för att räknas upp

  let arenaMapResizeObserver = null;

  function destroyArenaMap() {
    // Koppla ner observern FÖRST: den anropar arenaMap.resize(), och en
    // resize på en redan borttagen karta kastar inifrån MapLibre — ett fel
    // som dessutom bara syns som "Script error." eftersom biblioteket
    // laddas från unpkg (se crossOrigin i ensureMapLibre).
    if (arenaMapResizeObserver) { arenaMapResizeObserver.disconnect(); arenaMapResizeObserver = null; }
    if (!arenaMap) return;
    arenaMap.remove();
    arenaMap = null;
  }

  function createArenaMap(maplibregl, container, places, selKey) {
    destroyArenaMap();
    arenaMap = new maplibregl.Map({
      container,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [places[0].lng, places[0].lat],
      zoom: 11,
    });
    arenaMap.addControl(new maplibregl.NavigationControl(), "top-right");
    // Boxen ligger i ett innehåll som just ritats om, så MapLibre hinner
    // mäta containern innan layouten satt sig — utan den här omstorleken
    // ritas rutorna i en mindre yta än canvasen och lämnar tomma marginaler.
    // ResizeObserver (inte bara ett engångsanrop) täcker även fönsterbyten
    // och att verktygsraden fälls ut/ihop ovanför medan kartan är öppen.
    // MapLibre har INGEN "remove"-händelse att haka av på, så observern
    // måste ägas på modulnivå och kopplas ner explicit i destroyArenaMap.
    // Tidigare låg den i en once("remove")-callback som aldrig kördes,
    // vilket lämnade en observer per öppnad karta vid liv.
    arenaMapResizeObserver = new ResizeObserver(() => {
      if (arenaMap) arenaMap.resize();
    });
    arenaMapResizeObserver.observe(container);
    const bounds = new maplibregl.LngLatBounds();
    for (const p of places) {
      bounds.extend([p.lng, p.lat]);
      const el = h("div", { class: "arena-marker" + (p.key === selKey ? " on" : "") });
      const label = placeLabel(p);
      const addr = addressText(p);
      // Ett stort område (Åhus: 19 banor på en adress) skulle ge en popup
      // längre än kartan — visa ett hanterbart urval, med den valda banan
      // alltid med så man ser var man står.
      const courts = p.arenas.length > ARENA_POPUP_COURTS
        ? [...new Set([...(p.arenas.includes(state.viewArena) ? [state.viewArena] : []),
                        ...p.arenas])].slice(0, ARENA_POPUP_COURTS)
        : p.arenas;
      const body = h("div", { class: "arena-popup" },
        h("strong", null, label),
        addr && addr !== label ? h("div", { class: "muted" }, addr) : null,
        h("div", { class: "muted" },
          p.arenas.length + (p.arenas.length === 1 ? " bana" : " banor") +
          " · " + p.matches + " matcher"),
        h("div", { class: "arena-popup-courts" },
          courts.map((a) => h("button", {
            class: "chip" + (a === state.viewArena ? " on" : ""), type: "button",
            onclick: () => {
              state.viewArena = a; state.showAllPlayedArena = false;
              saveUi(); renderContent();
            },
          }, a)),
          courts.length < p.arenas.length
            ? h("span", { class: "muted" }, "+" + (p.arenas.length - courts.length) + " till")
            : null));
      new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setDOMContent(body))
        .addTo(arenaMap);
    }
    // En enda plats (t.ex. hela Åhus-området) ger tomma bounds att zooma
    // till — centrera i stället på den med en läsbar kvartersnivå.
    if (places.length > 1) {
      arenaMap.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else {
      arenaMap.setCenter([places[0].lng, places[0].lat]);
      arenaMap.setZoom(14);
    }
  }

  // --- render: karta -----------------------------------------------------------
  // Plottar deltagande klubbars registrerade hemorter (HB.api.clubGeo, se
  // api.js/scripts/fetch_cupmanager.py) på en riktig karta. Bara klassiska
  // Cup Manager-cuper har den datan (varken ProCup eller Gothia exponerar
  // klubbadresser), se renderTabs() mapSupported-villkoret.
  //
  // MapLibre GL JS + OpenFreeMap (gratis, ingen API-nyckel) laddas lat från
  // CDN först när fliken faktiskt öppnas — appens ENDA externa JS-beroende,
  // så det ska inte belasta alla andra besök som aldrig tittar på kartan.

  const MAPLIBRE_VERSION = "4.7.1";
  let mapLibreLoadPromise = null;

  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibreLoadPromise) return mapLibreLoadPromise;
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.css";
      document.head.append(css);
      const script = document.createElement("script");
      // crossOrigin: unpkg skickar Access-Control-Allow-Origin: *, och utan
      // attributet döljer webbläsaren ALLA fel från skriptet bakom det
      // intetsägande "Script error." — utan fil, rad eller stack. Med det
      // satt går ett MapLibre-fel att felsöka i stället för att bara gissa.
      script.crossOrigin = "anonymous";
      script.src = "https://unpkg.com/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.js";
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error("kunde inte nås (kontrollera nätet)"));
      document.head.append(script);
    });
    return mapLibreLoadPromise;
  }

  // Klubbnamnsmatchning (clubGeoFromMatches nedan, se matchClubName längre
  // ner för själva flernivålogiken): ett lagnamn ("Karlskrona Handboll",
  // "LUGI HF 1", "Alingsås HK Röd") jämförs mot klubbkatalogen i tre steg
  // med FALLANDE säkerhet — exakt namn, sedan ett ordnings-/klubbtyps-
  // bevarande prefix (skiftläges-/genitiv-okänsligt), och bara som sista
  // utväg en stopordsrensad "kärna" (klubbtypsord som HK/IF/Handbollsklubb
  // bortstrukna, ordning ignorerad). De två sista fångar tillsammans tre
  // återkommande missmatchningar som en ren startsWith-prefixjämförelse
  // missar: skiftläge (ProCup skriver ofta VERSALER), genitiv-s ("Kungälv"
  // vs "Kungälvs"), och omvänd ordning på klubbtyp/ortnamn ("HF Karlskrona"
  // vs "Karlskrona Handboll").
  const CLUB_STOPWORD_PREFIXES = [
    "handbollsförening", "handbollsforening", "handbollsklubb", "handboll",
    "fotbollsförening", "fotbollsforening", "fotbollsklubb", "fotboll",
    "idrottsförening", "idrottsforening", "idrottsklubb", "idrottsallians", "idrott",
    "bollklubb", "förening", "forening", "klubb", "allmänna", "allmanna",
  ];
  const CLUB_STOPWORD_EXACT = new Set([
    "ik", "hk", "if", "ff", "bk", "gf", "sk", "hf", "fk", "gif", "aif", "bif", "kif", "fbk", "tk",
  ]);
  function isClubStopword(word) {
    return CLUB_STOPWORD_EXACT.has(word) || CLUB_STOPWORD_PREFIXES.some((p) => word.startsWith(p));
  }
  // Bara ord längre än 3 tecken — annars riskerar korta äkta förkortningar
  // (som redan hunnit filtreras bort som stoppord ändå) att stympas i onödan.
  function stripGenitive(word) {
    return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  }
  function coreClubTokens(name) {
    return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/)
      .filter(Boolean).filter((w) => !isClubStopword(w)).map(stripGenitive);
  }
  function clubSignature(tokens) {
    return tokens.slice().sort().join("|");
  }

  // En katalog kan ha FLERA namn som normaliserar till samma kärna (t.ex.
  // "HF Karlskrona" och "Handbollsföreningen Karlskrona") — antingen för
  // att det bara är stavningsvarianter av SAMMA klubb, eller (farligare)
  // för att det råkar vara TVÅ olika klubbar med samma ortnamn men olika
  // sport/sektion (t.ex. "Vallentuna HK" och "Vallentuna Fotboll" — båda
  // tappar sin sportbeteckning som stoppord och blir "vallentuna"). Kan
  // inte skiljas åt på namnet ensamt efter normaliseringen — så gissa
  // bara om alla kandidater faktiskt pekar på (nästan) samma koordinat,
  // annars är det för osäkert och vi hoppar hellre över klubben helt.
  function pickUnambiguousClub(candidates, directory) {
    if (candidates.length === 1) return candidates[0];
    const coordKey = (n) => Math.round(directory[n].lat * 500) + "," + Math.round(directory[n].lng * 500);
    return new Set(candidates.map(coordKey)).size === 1 ? candidates[0] : null;
  }

  // Bevarar ORDNING och klubbtypsord (till skillnad från coreClubTokens,
  // som medvetet slår ihop t.ex. "Kungälvs HK" och "Kungälvs FF" till
  // samma "kungälv"-kärna) — bara skiftläge/skiljetecken/genitiv-s
  // normaliserat bort, per ord. Används för en rak prefixjämförelse
  // (matchClubName tier 2) som INTE kan förväxla två olika sporters
  // klubbar i samma ort, till skillnad från den stopordsrensade
  // kärnmatchningen (tier 3, se där).
  function normalizeForPrefix(name) {
    return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
      .split(/\s+/).filter(Boolean).map(stripGenitive).join(" ");
  }

  // Cachar indexet per katalog-objekt (WeakMap — directory är samma
  // objekt-referens genom hela sessionen, se HB.api.fetchClubDirectory) så
  // det bara byggs en gång i stället för vid varje anrop.
  const clubDirIndexCache = new WeakMap();
  function clubDirIndex(directory) {
    if (clubDirIndexCache.has(directory)) return clubDirIndexCache.get(directory);
    const byExact = new Map();     // gemener+trim -> exakt katalognamn
    const byPrefix = [];           // [normaliseratNamn, katalognamn], längst-först
    const bySignature = new Map(); // stopordsrensad kärn-signatur -> [katalognamn, ...]
    for (const dirName of Object.keys(directory)) {
      byExact.set(dirName.toLowerCase().trim(), dirName);
      byPrefix.push([normalizeForPrefix(dirName), dirName]);
      const sig = clubSignature(coreClubTokens(dirName));
      if (!sig) continue;
      if (!bySignature.has(sig)) bySignature.set(sig, []);
      bySignature.get(sig).push(dirName);
    }
    byPrefix.sort((a, b) => b[0].length - a[0].length); // längsta (mest specifika) prefixet vinner
    const index = { byExact, byPrefix, bySignature };
    clubDirIndexCache.set(directory, index);
    return index;
  }

  // Bara DESSA sista-token-mönster stryks vid ett omatchat helnamn — rena
  // siffror, en enstaka bokstav (t.ex. "A"-laget) eller ett vanligt
  // lagfärgsord. Testat (se länken i commit-meddelandet): en OBEGRÄNSAD
  // strypning av "vad som helst sist i namnet" gav falska träffar som
  // "IF Malmö Redhawks" → "HK Malmö" (helt annan sport/klubb) eller
  // "Kristianstads Bladet" → "Kristianstad HK" — "Redhawks"/"Bladet" är
  // INTE bortdragbara suffix, de är en del av ett namn som bara råkar dela
  // inledande ord med en riktig klubb. Med den här spärren stannar
  // sökningen i stället direkt om sista token inte ser ut som ett äkta
  // lag-suffix, hellre "okänd adress" än en gissning som pekar helt fel.
  const CLUB_COLOR_WORDS = new Set([
    "röd", "blå", "gul", "vit", "svart", "grön", "orange", "lila", "rosa", "silver", "guld", "grå",
  ]);
  function isStrippableSuffixToken(word) {
    return /^\d+$/.test(word) || word.length === 1 || CLUB_COLOR_WORDS.has(word);
  }

  // Tre nivåer, i FALLANDE säkerhetsordning — varje nivå försöks bara om
  // den föregående inte gav träff:
  //
  // 1. Exakt (skiftläges-okänsligt) — "Kungälvs HK" mot katalogens egna
  //    "Kungälvs HK".
  // 2. Ordnings- OCH klubbtypsbevarande prefix ("Kungälvs HK Röd" mot
  //    "Kungälvs HK", "LUGI HF 1" mot "Lugi HF") — skiftläge/genitiv-s
  //    normaliserat, men INTE klubbtypsordet (HK/FF/...) bortstruket,
  //    så den kan aldrig förväxla "Kungälvs HK" med "Kungälvs FF": de
  //    normaliserar till olika strängar ("kungälv hk" vs "kungälv ff")
  //    som aldrig är prefix av varandra.
  // 3. Stopordsrensad kärn-signatur (se coreClubTokens/pickUnambiguousClub
  //    ovan) — sista utväg, för ordnings-omkastade namn som "IK Sävehof"
  //    mot "Sävehof" eller "HF Karlskrona" mot "Karlskrona Handboll", där
  //    klubbtypsordet MÅSTE strykas för att över huvud taget hitta en
  //    gemensam kärna. Riskerar att slå ihop olika sporters klubbar i
  //    samma ort (se pickUnambiguousClub) — därför sist, och bara om
  //    resultatet är entydigt.
  // Memoiserad per katalog (WeakMap, samma mönster som clubDirIndexCache) —
  // matchClubName är en REN funktion av (name, directory), men anropas nu
  // (sedan clubGeoFromMatches/allClubNamesFromMatches/clubCountryFromMatches
  // alla prioriterar den, se deras kommentarer om identitetskonsekvens) upp
  // till 3 gånger för SAMMA lagnamn per omritning — uppmätt ~130ms per
  // anropsomgång för Åhus Beachs största årgång (~15 000 matcher), alltså
  // ~400ms totalt innan cachen. Cachen gör om det till en enda beräkning
  // per unikt namn, ~140ms totalt. Rensas aldrig manuellt — precis som
  // clubDirIndexCache lever den så länge katalog-objektet gör (en ny
  // katalog, t.ex. efter en omladdning, får sin egen tomma cache).
  const matchClubNameCache = new WeakMap(); // directory -> Map(name -> resultat)
  function matchClubName(name, directory) {
    let cache = matchClubNameCache.get(directory);
    if (!cache) { cache = new Map(); matchClubNameCache.set(directory, cache); }
    if (cache.has(name)) return cache.get(name);
    const result = matchClubNameUncached(name, directory);
    cache.set(name, result);
    return result;
  }

  function matchClubNameUncached(name, directory) {
    const index = clubDirIndex(directory);
    const exact = index.byExact.get(name.toLowerCase().trim());
    if (exact) return exact;
    const normalized = normalizeForPrefix(name);
    const prefixHit = index.byPrefix.find(([normDir]) => normDir && normalized.startsWith(normDir));
    if (prefixHit) return prefixHit[1];
    let tokens = coreClubTokens(name);
    // Tier 3 nekas för ett namn som ORDAGRANT bara är ett landsnamn (t.ex.
    // "Croatia" i en landslagsklass, se scripts/fetch_*.py:s country-fält)
    // — annars kolliderar det lätt med en RIKTIG klubb vars namn råkar
    // sluta på ett stoppord ("Croatia BK" -> stopordet "BK" stryks, kärnan
    // blir också bara "croatia"). Ett bredare försök (neka tier 3 varje
    // gång INGET stoppord gick att stryka ur inkommande namn) testades
    // först men gav 259 regressioner mot riktiga klubbar (t.ex. "Näset" ->
    // "Näsets SK", "IFK Malmö" -> "IFK Malmö HF") — verifierat med ett
    // Node-skript mot data/club-directory.json + samtliga lagnamn i data/
    // archive. COUNTRY_NAME_WORDS (landsnamn på sv+en, se nedan) är
    // tillräckligt smalt för att bara träffa den faktiska bug-klassen.
    if (COUNTRY_NAME_WORDS.has(name.toLowerCase().trim())) return null;
    while (tokens.length) {
      const candidates = index.bySignature.get(clubSignature(tokens));
      if (candidates) {
        const picked = pickUnambiguousClub(candidates, directory);
        if (picked) return picked;
      }
      if (!isStrippableSuffixToken(tokens[tokens.length - 1])) break;
      tokens = tokens.slice(0, -1);
    }
    return null;
  }

  // En Levenshtein-baserad "tier 4" (fuzzy-matcha stavningsvarianter som
  // "Baltikhov" mot katalogens "IK Baltichov") byggdes och testades här,
  // men skrotades efter regressionstest mot alla riktiga lagnamn i data/
  // archive: bara ~12 av 62 nya träffar var korrekta stavningsvarianter —
  // resten var farliga sammanblandningar av HELT OLIKA, riktiga orter/
  // klubbar som råkar ligga nära varandra i redigeringsavstånd (t.ex.
  // "Kristiansund HK" (norskt) -> "Kristianstad HK" (svenskt), "Nacka HK"
  // -> "Backa HK", "Vallentuna" -> "Sollentuna HK", "Hellerup" (danskt)
  // -> "Melleruds HK" (svenskt), "Torslanda" -> det obegripliga
  // "Korslagda"). Nordiska ortnamn är för korta och för många för att ett
  // rent redigeringsavstånd ska vara säkert nog — en felaktig men
  // självsäker adressnål är värre än en ärlig "okänd", se
  // isStrippableSuffixToken-kommentaren ovan för samma resonemang.

  // {klubbnamn: {city,lat,lng,country}} — gissar adress åt cuper som INTE
  // har egen adressdata (ProCup/Gothia, samt ALLA cupers arkiverade år)
  // genom att slå upp deras lagnamn mot den samlade klubbkatalogen
  // (scripts/build_club_directory.py, byggd ur ALLA klassiska Cup Manager-
  // cupers riktiga adresser) via matchClubName ovan. En klubb som ALDRIG
  // spelat i någon klassisk Cup Manager-cup går fortfarande inte att lösa
  // upp, ingen adress för den då.
  function clubGeoFromMatches(matches, directory) {
    const geo = {};
    const seenTeamNames = new Set();
    for (const m of matches) {
      for (const side of [m.home, m.away]) {
        if (!side.name || seenTeamNames.has(side.name)) continue;
        seenTeamNames.add(side.name);
        const club = matchClubName(side.name, directory);
        if (club) geo[club] = directory[club];
      }
    }
    return geo;
  }

  // ALLA distinkta klubbar (kända+okända adress) bland matchernas lag —
  // matchClubName(side.name, directory) FÖRST (samma anrop, samma
  // resultat som clubGeoFromMatches redan använder för att bygga merged),
  // annars side.club (rent klubbnamn, se normalize() i fetch_cupmanager.py/
  // fetch_gothia.py), annars side.name som sista utväg. matchClubName
  // FÖRE .club (inte bara som reserv när .club saknas) är medvetet:
  // Cup Managers EGET .club-fält stämmer inte alltid ORDAGRANT överens med
  // katalogens kanoniska stavning (upptäckt på Åhus Beach 2019 — bara 7
  // klubbar av 270 räckte för att räkningen skulle gå upp i 277 i stället,
  // samma sorts dubbelräkning som Hellton-fallet nedan, fast ovanligare).
  // Genom att ALLTID föredra exakt samma matchClubName-resultat som merged
  // nycklas på kan allClubs/countryMap (clubCountryFromMatches) ALDRIG
  // hamna i en annan namnrymd än merged, oavsett vilken cup/källa det
  // gäller — den enda vägen att helt eliminera den här buggklassen i
  // stället för att lappa specialfall för specialfall (ProCups saknade
  // .club, Hellton 2025:s saknade .club, Åhus 2019:s avvikande .club, …).
  function allClubNamesFromMatches(matches, directory) {
    const names = new Set();
    for (const m of matches) {
      for (const side of [m.home, m.away]) {
        const name = (directory && matchClubName(side.name, directory)) || side.club || side.name;
        if (name) names.add(name);
      }
    }
    return names;
  }

  // {klubbnamn: landskod} — landet är inbäddat direkt på varje matchsida
  // (home/away.country, se js/api.js normalize() och scripts/fetch_*.py),
  // så till skillnad från clubGeoFromMatches krävs INGEN namnmatchning mot
  // klubbkatalogen: gäller lika bra för klubbar som aldrig spelat i någon
  // klassisk Cup Manager-cup (och därför saknas helt ur data/
  // club-directory.json), t.ex. de flesta utländska Partille-lagen.
  // Oberoende av om klubben OCKSÅ har en känd adress — den avvägningen
  // (adress vinner om båda finns) görs vid slutlig sammanslagning i
  // renderMapView, inte här.
  //
  // COUNTRY_CENTROIDS[side.country]-kollen filtrerar bort koder som INTE är
  // riktiga ISO 3166-1 alpha-2-koder — Gothia ger ibland Storbritanniens
  // "home nations" som egna, gemena koder (t.ex. "en"/"ct" för engelska/
  // skotska klubbar i Partille Cup) i stället för "GB". Utan filtret skulle
  // en sådan klubb tyst falla ur BÅDA "ungefärlig landsplacering" (countryGridLngLat
  // hittar ingen centroid, se paintMapMarkers) OCH "helt okänd" (den räknas
  // ju som känd här) — osynlig på kartan i stället för att hamna i
  // Atlant-rutnätet som en ärlig "okänd". Definieras längre ner i filen,
  // men är redan initierad vid modulladdning innan denna funktion någonsin
  // anropas (samma closure-scope).
  //
  // directory (valfri): samma matchClubName-först-prioritering som
  // allClubNamesFromMatches, se dess kommentar — garanterar att
  // clubCountryFromMatches ALDRIG nycklar en klubb annorlunda än merged
  // (clubGeoFromMatches), oavsett om orsaken är ett saknat .club-fält
  // (äldre arkiv, t.ex. Hellton Cup 2025) eller bara en avvikande stavning
  // i ett annars ifyllt .club-fält (t.ex. Åhus Beach 2019).
  function clubCountryFromMatches(matches, directory) {
    const byClub = new Map();
    for (const m of matches) {
      for (const side of [m.home, m.away]) {
        const name = (directory && matchClubName(side.name, directory)) || side.club || side.name;
        if (!name || byClub.has(name) || !side.country || !COUNTRY_CENTROIDS[side.country]) continue;
        byClub.set(name, side.country);
      }
    }
    return byClub;
  }

  // Antal DISTINKTA lag (id, inte klubbnamn — ett lag är en åldersklass-
  // trupp, en klubb kan ha flera) och Set(klassnamn) ur en matchlista —
  // till Kartans sammanfattningsrad ("X lag · Y klubbar totalt · ...").
  // Platshållare i ospelade slutspelsträd ("Vinn.", "Förl. 1/4 Final - 2",
  // "1:an i Grupp A", "10:e bästa 3:an") har egna unika lag-id och skulle
  // annars nästan tredubbla lagräkningen för en ännu inte spelad upplaga.
  // Samma mönster i scripts/archive_results.py (is_placeholder_team) —
  // håll dem i synk.
  const PLACEHOLDER_TEAM_RE = /^(?:vinn\.|förl\.|\d+:an i |\d+:e bästa )/i;
  function isPlaceholderTeam(side) {
    const name = ((side && side.name) || "").trim();
    return !name || PLACEHOLDER_TEAM_RE.test(name);
  }

  function teamsAndClassesFromMatches(matches) {
    const teamIds = new Set();
    const classes = new Set();
    for (const m of matches) {
      if (m.home && m.home.id != null && !isPlaceholderTeam(m.home)) teamIds.add(m.home.id);
      if (m.away && m.away.id != null && !isPlaceholderTeam(m.away)) teamIds.add(m.away.id);
      if (m.catName) classes.add(m.catName);
    }
    return { teamCount: teamIds.size, classes };
  }

  // Hämtar en ANNAN cups (inte nödvändigtvis den just nu aktiva) klubbdata
  // direkt ur dess CI-byggda snapshot — helt fristående från loadCup()/
  // huvudappens matchdata, så att Karta kan visa flera cuper samtidigt utan
  // att byta vilken cup som är "aktiv" i headern. state.mapCupStatus
  // (session, sparas ej) förhindrar dubbletthämtningar.
  function ensureCupClubGeo(cupId) {
    if (HB.api.clubGeo[cupId] || state.mapCupStatus[cupId]) return;
    state.mapCupStatus[cupId] = "loading";
    const done = (geo, allClubs, teamCount, classes, countryByClub) => {
      HB.api.clubGeo[cupId] = geo;
      state.mapCupAllClubs[cupId] = allClubs;
      state.mapCupTeamCount[cupId] = teamCount;
      state.mapCupClasses[cupId] = classes;
      state.mapCupCountryByClub[cupId] = countryByClub;
      state.mapCupStatus[cupId] = "done";
      // renderTabs() alltid — kan avgöra om Stats-fliken ska visas/döljas nu
      // när vi vet säkert. render() (dyrare, ritar om hela sidan) bara om
      // man faktiskt står på Karta-underfliken just nu.
      renderTabs();
      if (state.view === "stats" && state.statsView === "karta") render();
    };
    const c = HB.allCups().find((x) => x.id === cupId);
    if (c && c.dataUrl) {
      // ProCup/Gothia: ingen egen adressdata alls — gissa via namnmatchning
      // mot klubbkatalogen i stället för att bara visa en tom karta.
      Promise.all([
        fetch(c.dataUrl + "?_=" + Date.now().toString(36)).then((r) => (r.ok ? r.json() : null)),
        HB.api.fetchClubDirectory(),
      ]).then(([data, directory]) => {
        const matches = (data && data.matches) || [];
        const { teamCount, classes } = teamsAndClassesFromMatches(matches);
        done(clubGeoFromMatches(matches, directory || {}), allClubNamesFromMatches(matches, directory || {}),
          teamCount, classes, clubCountryFromMatches(matches, directory || {}));
      }).catch(() => done({}, new Set(), 0, new Set(), new Map()));
      return;
    }
    fetch("data/snapshot-" + cupId + ".json?_=" + Date.now().toString(36))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const matches = (j && j.matches) || [];
        const { teamCount, classes } = teamsAndClassesFromMatches(matches);
        done((j && j.clubs) || {}, allClubNamesFromMatches(matches), teamCount, classes,
          clubCountryFromMatches(matches));
      })
      .catch(() => done({}, new Set(), 0, new Set(), new Map()));
  }

  // Slår ihop klubbdata för flera valda cuper till en enda lista, med vilka
  // AV DE VALDA cuperna varje klubb faktiskt förekommer i (visas i popupen
  // — svarar direkt på "vilka cuper har den här klubben deltagit i?"), som
  // {id, name}-par (INTE bara namnet) så popupen kan länka rakt in i
  // Schema/Tabeller/Slutspel för rätt cup (se clubDeepLinkUrl). Samma
  // klubbnamn i flera cuper delar samma verkliga adress, så en enkel
  // namnnyckel räcker för att deduplicera pricken på kartan.
  function mergedClubGeo(cupIds) {
    const merged = {};
    for (const cupId of cupIds) {
      const geo = HB.api.clubGeo[cupId];
      if (!geo) continue;
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const cupName = (cupObj && cupObj.name) || cupId;
      for (const [name, info] of Object.entries(geo)) {
        if (!merged[name]) merged[name] = { ...info, cups: [] };
        merged[name].cups.push({ id: cupId, name: cupName });
      }
    }
    return merged;
  }

  // Kartans mellannivå (live-läge): klubbar UTAN känd adress (merged, se
  // ovan — den vinner om en klubb har båda) men med en känd landskod,
  // sammanslaget över de valda cuperna på samma sätt som mergedClubGeo.
  // state.mapCupCountryByClub fylls av loadCup()/ensureCupClubGeo, se deras
  // kommentarer — oberoende av merged, uteslutningen görs HÄR, inte vid
  // insamlingen, så samma råa data kan användas oavsett vilka cuper som
  // råkar vara valda just nu.
  function mergedCountry(cupIds, merged) {
    const result = new Map();
    for (const cupId of cupIds) {
      const byClub = state.mapCupCountryByClub[cupId];
      if (!byClub) continue;
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const cupName = (cupObj && cupObj.name) || cupId;
      for (const [name, code] of byClub) {
        if (merged[name]) continue;
        if (!result.has(name)) result.set(name, { code, cups: [] });
        result.get(name).cups.push({ id: cupId, name: cupName });
      }
    }
    return result;
  }

  // Samma sammanslagning som mergedClubGeo, men för ETT specifikt arkiverat
  // år i stället för live-data. Arkiverade matcher sparar bara ett RENT
  // klubbnamn (se normalize() i fetch_cupmanager.py/fetch_gothia.py), ingen
  // egen adress — så adressen slås alltid upp via klubbkatalogen
  // (namnmatchning, clubGeoFromMatches), oavsett om cupen normalt har egen
  // adressdata (klassisk Cup Manager) eller inte (ProCup/Gothia). Kräver
  // att ensureYearMatches(year, cupId) redan körts (se renderMapView) —
  // hoppar tyst över cuper vars år inte hunnit laddas än.
  function mergedClubGeoForYear(cupIds, year, directory) {
    const merged = {};
    for (const cupId of cupIds) {
      const ym = state.yearMatches[cupId + ":" + year];
      if (!ym || ym.status !== "done") continue;
      const geo = clubGeoFromMatches(ym.matches, directory);
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const cupName = (cupObj && cupObj.name) || cupId;
      for (const [name, info] of Object.entries(geo)) {
        if (!merged[name]) merged[name] = { ...info, cups: [] };
        merged[name].cups.push({ id: cupId, name: cupName });
      }
    }
    return merged;
  }

  // mergedCountry ovan, för årsläget — landskoden är inbäddad direkt på de
  // arkiverade matchernas home/away.country (se scripts/fetch_*.py).
  // directory skickas vidare till clubCountryFromMatches — bara till för
  // ÄLDRE arkiverade år som (till skillnad från vanliga klassiska
  // Cup Manager-cuper) saknar side.club helt, se dess kommentar.
  function mergedCountryForYear(cupIds, year, merged, directory) {
    const result = new Map();
    for (const cupId of cupIds) {
      const ym = state.yearMatches[cupId + ":" + year];
      if (!ym || ym.status !== "done") continue;
      const byClub = clubCountryFromMatches(ym.matches, directory);
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const cupName = (cupObj && cupObj.name) || cupId;
      for (const [name, code] of byClub) {
        if (merged[name]) continue;
        if (!result.has(name)) result.set(name, { code, cups: [] });
        result.get(name).cups.push({ id: cupId, name: cupName });
      }
    }
    return result;
  }

  // "Visa landshistorik"-kryssrutan (state.mapCountryHistory): för VARJE
  // land som någonsin haft en klubb i de valda cuperna — över ALLA
  // arkiverade år PLUS innevarande upplaga, inte bara det år Karta just nu
  // råkar visa — hur många distinkta klubbar och vilka år. Landskoden är
  // inbäddad direkt på varje match (home/away.country, se js/api.js
  // normalize()/scripts/fetch_*.py) så det spelar ingen roll om klubben
  // också har en känd adress eller ej — adressens egen .country-fält
  // (clubs_from_store/clubGeoFromStore) räknas här också, annars skulle
  // Sverige (där de flesta klubbar HAR adress) se tomt ut trots att det är
  // just Sverige användaren oftast vill se aggregerat (se ensureCountryHistory
  // nedan för vilken data som måste vara laddad innan detta anropas).
  function countryYearSummary(cupIds) {
    // clubs: dedupat på klubbnamn (side.club), teams: dedupat på FULLT
    // lagnamn (side.name, med åldersklass-/färgsuffix) — två olika, båda
    // roliga tal ("X klubbar, Y lag", se countryHistoryPopupBody). Bara
    // arkiverade år (ym.matches nedan) har kvar den fulla per-match-
    // upplösningen — de förhämtade per-cup-aggregaten (mapCupCountryByClub/
    // HB.api.clubGeo) är redan hopslagna till klubbnivå innan de når hit,
    // så innevarande upplaga bidrar bara till klubb-räkningen, inte
    // lag-räkningen (teamName utelämnad = ingen extra lag-post där).
    const acc = new Map(); // landskod -> {clubs:Set(namn), teams:Set(lagnamn), years:Set(år)}
    const add = (code, name, year, teamName) => {
      if (!code || !name) return;
      if (!acc.has(code)) acc.set(code, { clubs: new Set(), teams: new Set(), years: new Set() });
      acc.get(code).clubs.add(name);
      if (teamName) acc.get(code).teams.add(teamName);
      if (year) acc.get(code).years.add(year);
    };
    for (const cupId of cupIds) {
      const cupObj = HB.allCups().find((c) => c.id === cupId);
      const liveYear = cupObj && cupObj.edition;
      for (const [name, code] of (state.mapCupCountryByClub[cupId] || new Map())) add(code, name, liveYear);
      for (const [name, info] of Object.entries(HB.api.clubGeo[cupId] || {})) add(info.country, name, liveYear);
      const editions = ((state.archiveIndex[cupId] && state.archiveIndex[cupId].editions) || [])
        .filter((e) => e.matches > 0);
      for (const em of editions) {
        const ym = state.yearMatches[cupId + ":" + em.edition];
        if (!ym || ym.status !== "done") continue;
        for (const m of ym.matches) {
          for (const side of [m.home, m.away]) {
            add(side.country, side.club || side.name, em.edition, side.name);
          }
        }
      }
    }
    return acc;
  }

  // Ser till att ALLA arkiverade år (inte bara det just synliga, se
  // ensureYearMatches/state.mapYear) är laddade för de valda cuperna, så
  // countryYearSummary ovan har fullständig data — bara körs när "Visa
  // landshistorik" faktiskt är ikryssad (annars onödigt tungt, en cup med
  // många år kan vara flera MB). true = klart, false = fortfarande laddar.
  function ensureCountryHistory(cupIds) {
    let allDone = true;
    for (const cupId of cupIds) {
      const editions = ((state.archiveIndex[cupId] && state.archiveIndex[cupId].editions) || [])
        .filter((e) => e.matches > 0);
      for (const em of editions) {
        ensureYearMatches(em.edition, cupId);
        const ym = state.yearMatches[cupId + ":" + em.edition];
        if (!ym || ym.status !== "done") allDone = false;
      }
    }
    return allDone;
  }

  // Klubbkatalogen (data/club-directory.json) behövs för årsläget oavsett
  // cuptyp (se mergedClubGeoForYear ovan) — HB.api.fetchClubDirectory()
  // cachar redan själva fetch-anropet, men vi vill dessutom trigga en
  // omritning när den blir klar (annars sitter Karta fast på "Hämtar …"
  // tills nästa oberoende omritning råkar ske).
  let clubDirectoryCache = null;
  function ensureClubDirectory() {
    if (clubDirectoryCache) return;
    HB.api.fetchClubDirectory().then((dir) => {
      clubDirectoryCache = dir || {};
      if (state.view === "stats" && state.statsView === "karta") render();
    });
  }

  // Tidslinje-uppspelning: klickar man "Spela upp" stegas state.mapYear
  // fram genom de arkiverade åren automatiskt (loopar om från början) tills
  // man pausar eller lämnar Karta-fliken (self-check i själva tickern —
  // samma "inget explicit unmount-hook"-mönster som !document.body.
  // contains(mapBox) används för kartan själv).
  let mapPlayTimer = null;
  function stopMapPlay() {
    if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; }
  }
  function toggleMapPlay(years) {
    if (mapPlayTimer) { stopMapPlay(); renderContent(); return; }
    mapPlayTimer = setInterval(() => {
      if (state.view !== "stats" || state.statsView !== "karta") { stopMapPlay(); return; }
      const cur = years.indexOf(state.mapYear);
      state.mapYear = years[cur === -1 || cur === years.length - 1 ? 0 : cur + 1];
      renderContent();
    }, 1400);
    renderContent();
  }

  let currentMap = null;        // föregående kartinstans — måste .remove()'as explicit,
                                 // annars läcker en WebGL-kontext varje gång fliken byts bort
  // klubbnamn -> {marker, color}: EN karta för varje klubbnål som sitter på
  // currentMap just nu. Diffas mot nästa urval i stället för att rensas och
  // byggas om i sin helhet (se paintMapMarkers) — en klubb som finns kvar
  // mellan två år ska INTE blinka till bara för att andra klubbar
  // tillkommit/försvunnit, annars går det inte att visuellt följa vad som
  // faktiskt ändrats mellan åren (precis det "Spela upp" är till för).
  let currentMapMarkerByKey = new Map();
  let currentUnknownMarkerByKey = new Map(); // klubbnamn -> marker, samma diff-princip som currentMapMarkerByKey ovan
  let currentCountryMarkerByKey = new Map(); // klubbnamn -> {marker, color}, samma diff-princip, se paintMapMarkers
  let currentHistoryMarkerByKey = new Map(); // landskod -> {marker, clubCount, yearsKey}, "Visa landshistorik"
  let mapBoxEl = null;          // DOM-noden kartan bor i — sparas modulnivå (INTE i renderMapView)
                                 // så samma nod kan flyttas in i det nya innehållet varje
                                 // omritning i stället för att byggas om från grunden; annars
                                 // skulle årsbyte/"Spela upp" förstöra och återskapa hela
                                 // MapLibre-instansen varje gång — synligt som att kartan
                                 // "laddar om" (zoom/panorering återställs) i stället för att
                                 // bara pinnarna byts ut, vilket användaren uttryckligen inte vill.
  let mapBoxKey = null;         // vilka cuper (sorterad, kommaseparerad id-lista) kartan
                                 // just nu byggts för — bara EN cupändring (inte årsbyte)
                                 // motiverar att faktiskt återskapa kartinstansen.

  function renderMapView(root) {
    // Alla cuper AV SAMMA SPORT som innevarande cup listas — inte bara
    // klassiska Cup Manager-cuper (ProCup/Gothia-cuper kan också få
    // (gissad) klubbdata, se ensureCupClubGeo/clubGeoFromMatches), men att
    // blanda t.ex. handbolls- och fotbollsklubbar på samma karta är
    // förvirrande snarare än informativt. Byt aktiv cup (Inställningar)
    // för att se fotbollscupernas klubbar i stället. En cup utan några
    // träffar ger bara en tom karta för just den, inget att spärra bort
    // i förväg. state.exploreCupIds delas med Trend (se dess kommentar) —
    // cupurvalet hänger alltså med om man växlar mellan de två flikarna.
    const mapCupOptions = HB.allCups().filter((c) => (c.sport || "handboll") === (cup().sport || "handboll"));
    // Städa bort ev. kvarvarande urval från en ANNAN sport, se motsvarande
    // kommentar i renderTrendView.
    for (const id of [...state.exploreCupIds]) if (!mapCupOptions.some((c) => c.id === id)) state.exploreCupIds.delete(id);
    // Förval: bara innevarande cup, en gång — renderTabs() garanterar redan
    // att man bara kan NÅ Karta-fliken när innevarande cup stödjer den, så
    // ingen ytterligare giltighetskoll behövs här.
    if (!state.exploreCupIds.size) state.exploreCupIds.add(state.cupId);

    const cupPicker = buildPicker({
      items: mapCupOptions.map((c) => ({ id: c.id, label: c.name, sortKey: 0, sortName: c.name })),
      selected: state.exploreCupIds,
      emptyLabel: "Välj cup(er)",
      countLabel: (n) => n + " cuper",
      searchPlaceholder: "Sök cup …",
      sortToggle: false, // cuper har inget "klass"-begrepp — bara namnsortering
      soloClickable: true, // klick på cupnamnet väljer bara den cupen
      onChange: () => { stopMapPlay(); renderContent(); },
    });
    root.append(h("div", { class: "history-controls" }, cupPicker));

    const selectedIds = [...state.exploreCupIds];

    // År-väljare: union av arkiverade (spelade) år över VALDA cuper — "Nu"
    // (dagens live-data) är alltid ett alternativ, även utan arkivhistorik.
    const idx = state.archiveIndex || {};
    const yearSet = new Set();
    for (const id of selectedIds) {
      for (const e of ((idx[id] && idx[id].editions) || [])) if (e.matches > 0) yearSet.add(e.edition);
    }
    const years = [...yearSet].sort();
    // t.ex. efter cupbyte. Bara när arkivindexet FAKTISKT är laddat — annars
    // är years alltid tom vid första ritningen, och ett djuplänkat ?mapYear=
    // hade nollställts innan indexet ens hunnit svara.
    if (state.archiveIndex && state.mapYear && !years.includes(state.mapYear)) state.mapYear = null;
    if (years.length) {
      const yearSelect = h("select", { class: "select", "aria-label": "År" },
        h("option", { value: "" }, "Nu"),
        years.map((y) => h("option", { value: y }, y)));
      yearSelect.value = state.mapYear || "";
      yearSelect.addEventListener("change", () => {
        stopMapPlay();
        state.mapYear = yearSelect.value || null;
        renderContent();
      });
      const playBtn = h("button", {
        class: "btn small", type: "button", ...(years.length < 2 ? { disabled: "" } : {}),
        onclick: () => toggleMapPlay(years),
      }, mapPlayTimer ? "⏸ Pausa" : "▶ Spela upp");
      root.append(h("div", { class: "row trend-baseline-row" }, yearSelect, playBtn));
    }

    // "Visa landshistorik": extra lila markörer, en per land som NÅGONSIN
    // haft en klubb i de valda cuperna (alla arkiverade år + innevarande
    // upplaga, se countryYearSummary) — oberoende av vilket enskilt år
    // (state.mapYear) Karta just nu råkar visa. Av som förval: kräver att
    // ALLA arkiverade år laddas (kan vara flera MB för en cup med lång
    // historik), inte bara det synliga året.
    const historyToggle = h("label", { class: "inline-toggle" },
      h("input", {
        type: "checkbox", ...(state.mapCountryHistory ? { checked: "" } : {}),
        onchange: (e) => { state.mapCountryHistory = e.target.checked; renderContent(); },
      }),
      " Visa landshistorik (alla år, per land)");
    root.append(h("div", { class: "row" }, historyToggle));

    let merged, countryMap, allClubs, totalTeams;
    // klubbnamn -> [{id, name}, ...] (samma form som merged/countryMaps
    // .cups) — bara till för "helt okänd"-nivåns popup-länkar
    // (unknownPopupBody), som annars inte skulle veta vilken cup en
    // adresslös/landslös klubb faktiskt hörde till.
    const allClubCups = new Map();
    const addClubCup = (name, cupId, cupName) => {
      if (!allClubCups.has(name)) allClubCups.set(name, []);
      allClubCups.get(name).push({ id: cupId, name: cupName });
    };
    const classSet = new Set();
    if (state.mapYear) {
      ensureClubDirectory();
      for (const id of selectedIds) ensureYearMatches(state.mapYear, id);
      const pending = !clubDirectoryCache || selectedIds.some((id) => {
        const ym = state.yearMatches[id + ":" + state.mapYear];
        return !ym || ym.status === "loading";
      });
      if (pending) {
        root.append(h("p", { class: "muted" }, "Hämtar arkiverad klubbdata …"));
        return;
      }
      merged = mergedClubGeoForYear(selectedIds, state.mapYear, clubDirectoryCache);
      countryMap = mergedCountryForYear(selectedIds, state.mapYear, merged, clubDirectoryCache);
      allClubs = new Set();
      totalTeams = 0;
      for (const id of selectedIds) {
        const ym = state.yearMatches[id + ":" + state.mapYear];
        if (!ym || ym.status !== "done") continue;
        const cupName = (HB.allCups().find((c) => c.id === id) || {}).name || id;
        for (const name of allClubNamesFromMatches(ym.matches, clubDirectoryCache)) {
          allClubs.add(name); addClubCup(name, id, cupName);
        }
        const tc = teamsAndClassesFromMatches(ym.matches);
        totalTeams += tc.teamCount;
        for (const c of tc.classes) classSet.add(c);
      }
    } else {
      for (const id of selectedIds) ensureCupClubGeo(id);
      if (selectedIds.some((id) => state.mapCupStatus[id] === "loading")) {
        root.append(h("p", { class: "muted" }, "Hämtar klubbdata …"));
        return;
      }
      merged = mergedClubGeo(selectedIds);
      countryMap = mergedCountry(selectedIds, merged);
      allClubs = new Set();
      totalTeams = 0;
      for (const id of selectedIds) {
        const cupName = (HB.allCups().find((c) => c.id === id) || {}).name || id;
        for (const name of (state.mapCupAllClubs[id] || [])) { allClubs.add(name); addClubCup(name, id, cupName); }
        totalTeams += state.mapCupTeamCount[id] || 0;
        for (const c of (state.mapCupClasses[id] || [])) classSet.add(c);
      }
    }

    const entries = Object.entries(merged);
    // Alla klubbar (känd adress, ungefärligt land, eller helt okänd) i de
    // valda cuperna, oavsett om vi lyckades placera dem på kartan —
    // mängdskillnaden mot merged/countryMap ger hur många som saknar
    // BÅDE adress och land (helt okänd, Atlant-rutnätet nedan).
    const unknownNames = [...allClubs].filter((name) => !merged[name] && !countryMap.has(name))
      .sort((a, b) => a.localeCompare(b, "sv"));
    if (!entries.length && !countryMap.size && !unknownNames.length) {
      root.append(h("p", { class: "muted" },
        "Ingen klubbdata i valda cuper" + (state.mapYear ? " för " + state.mapYear : "") + "."));
      return;
    }
    const cityCount = new Set(entries.map(([, info]) => info.city).filter(Boolean)).size;
    const countryCount = new Set(entries.map(([, info]) => info.country).filter(Boolean)).size;
    const approxCountryCount = new Set([...countryMap.values()].map((v) => v.code)).size;
    root.append(h("p", { class: "muted map-count" },
      totalTeams + " lag · " +
      allClubs.size + " klubbar totalt" + (state.mapYear ? " (" + state.mapYear + ")" : "") + " · " +
      entries.length + " med känd adress (" +
      cityCount + " städer" + (countryCount > 1 ? " · " + countryCount + " länder" : "") + ")" +
      (countryMap.size ? " · " + countryMap.size + " med ungefärlig landsplacering (" +
        approxCountryCount + " länder)" : "") +
      (unknownNames.length ? " · " + unknownNames.length + " helt okänd" : "") +
      " · " + classSet.size + " klasser"));
    root.append(h("div", { class: "map-legend" },
      h("span", { class: "map-legend-item" },
        h("span", { class: "map-legend-dot", style: "background:" + MAP_SHARED_COLOR }), "Känd adress"),
      countryMap.size ? h("span", { class: "map-legend-item" },
        h("span", { class: "map-legend-dot", style: "background:" + MAP_SHARED_COLOR + ";opacity:.55" }),
        "Ungefärlig landsplacering (boll = antal)") : null,
      unknownNames.length ? h("span", { class: "map-legend-item" },
        h("span", { class: "map-legend-dot", style: "background:#8a94a3" }), "Helt okänd (Atlanten)") : null));

    // Flercupsläge: en färg per vald cup (MAP_CUP_COLORS, cykliskt) plus en
    // reserverad delad färg (MAP_SHARED_COLOR) för klubbar som spelat i
    // FLERA av de valda cuperna — se cupColorForClub/legenden nedan.
    const showCups = selectedIds.length > 1;
    const cupColorByName = new Map(selectedIds.map((id, i) => [
      (HB.allCups().find((c) => c.id === id) || {}).name || id,
      MAP_CUP_COLORS[i % MAP_CUP_COLORS.length],
    ]));
    if (showCups) {
      root.append(h("div", { class: "trend-legend" },
        [...cupColorByName.entries()].map(([name, color]) =>
          h("div", { class: "trend-legend-item" },
            h("span", { class: "trend-swatch", style: "background:" + color }),
            h("span", null, name))).concat(
          h("div", { class: "trend-legend-item" },
            h("span", { class: "trend-swatch", style: "background:" + MAP_SHARED_COLOR }),
            h("span", null, "Flera av de valda cuperna")))));
    }
    const cupColorForClub = (info) => !showCups || info.cups.length > 1
      ? MAP_SHARED_COLOR : (cupColorByName.get(info.cups[0].name) || MAP_SHARED_COLOR);

    // countryHistory: null = avstängd ELLER fortfarande laddar (samma
    // ensureYearMatches som årsväljaren ovan, men för ALLA år på en gång) —
    // paintMapMarkers/createMap hoppar bara över den extra pin-nivån tills
    // den är redo, resten av kartan renderas som vanligt under tiden.
    let countryHistory = null;
    if (state.mapCountryHistory) {
      const ready = ensureCountryHistory(selectedIds);
      if (ready) countryHistory = countryYearSummary(selectedIds);
      else root.append(h("p", { class: "muted" }, "Laddar landshistorik …"));
    }

    // Samma cupurval som senast (bara årtalet eller "spela upp" har ändrats)
    // → återanvänd den redan levande kartinstansen och byt bara ut
    // pinnarna, i stället för att förstöra och återskapa allt (skulle synas
    // som att kartan "laddar om" — panorering/zoom nollställs, se
    // mapBoxEl-kommentaren ovan).
    const cupsKey = selectedIds.slice().sort().join(",");
    const needsNewMap = !mapBoxEl || mapBoxKey !== cupsKey || !currentMap;
    if (needsNewMap) { mapBoxEl = h("div", { class: "map-box" }); mapBoxKey = cupsKey; }
    // Lokal, stabil referens för DENNA körnings async-callback — mapBoxEl
    // (modulnivå) kan hinna bytas ut av en SENARE renderMapView-körning
    // innan löftet nedan löser sig (t.ex. snabba cupbyten i rad), annars
    // skulle den gamla callbacken råka rita i/kolla fel nod.
    const box = mapBoxEl;
    root.append(box);
    ensureMapLibre().then((maplibregl) => {
      // Om användaren hunnit byta cup/flik medan biblioteket laddade från
      // CDN: box sitter inte kvar i dokumentet längre, rita inte i den.
      if (!document.body.contains(box)) return;
      if (needsNewMap) {
        createMap(maplibregl, box, merged, countryMap, unknownNames, cupColorForClub, state.mapYear, allClubCups,
          countryHistory);
      } else {
        currentMap.resize(); // återfäst nod kan ha bytt storlek medan den var frånkopplad
        paintMapMarkers(maplibregl, merged, countryMap, unknownNames, cupColorForClub, state.mapYear, allClubCups,
          countryHistory);
      }
    }).catch((e) => {
      if (!document.body.contains(box)) return;
      box.replaceChildren(h("p", { class: "muted" }, "Kunde inte ladda kartan: " + e.message));
    });
  }

  // ISO 3166-1 alpha-2 -> [lng, lat], ungefärlig geografisk mittpunkt (INTE
  // huvudstaden — bättre för ett stort/avlångt land som t.ex. Norge eller
  // Ryssland). Statisk referensdata, samma katalog oavsett cup — landskoden
  // kommer från Cup Managers/Gothias egna Nation-entiteter (se home/away.
  // country, js/api.js normalize()/scripts/fetch_*.py), bara centrumpunkten
  // slås upp här. Bara koder som faktiskt kan förekomma i handbolls-/
  // fotbollscuper är strikt nödvändiga, men en bred, världstäckande tabell
  // kostar inget extra och slipper framtida håltäckning.
  const COUNTRY_CENTROIDS = {
    SE: [16.7, 62.2], NO: [10.5, 62.0], DK: [10.0, 56.1], FI: [26.0, 63.9],
    IS: [-19.0, 65.0], FO: [-6.9, 62.0], GL: [-42.0, 72.0], AX: [19.9, 60.2],
    DE: [10.3, 51.2], NL: [5.5, 52.2], BE: [4.5, 50.6],
    LU: [6.1, 49.7], FR: [2.5, 46.6], GB: [-2.0, 54.0], IE: [-8.0, 53.4],
    ES: [-3.7, 40.3], PT: [-8.2, 39.6], IT: [12.6, 42.8], CH: [8.2, 46.8],
    AT: [14.6, 47.6], PL: [19.4, 52.0], CZ: [15.5, 49.8], SK: [19.5, 48.7],
    HU: [19.5, 47.2], SI: [14.8, 46.1], HR: [16.4, 45.1], BA: [17.8, 44.2],
    RS: [21.0, 44.0], ME: [19.3, 42.8], MK: [21.7, 41.6], AL: [20.2, 41.2],
    BG: [25.5, 42.7], RO: [24.9, 45.9], GR: [22.9, 39.1], TR: [35.2, 39.0],
    CY: [33.4, 35.1], MT: [14.4, 35.9], UA: [31.2, 48.4], BY: [27.9, 53.7],
    LT: [23.9, 55.2], LV: [24.6, 56.9], EE: [25.0, 58.6], RU: [96.7, 61.5],
    MD: [28.4, 47.2], LI: [9.5, 47.2], MC: [7.4, 43.7], AD: [1.6, 42.5],
    SM: [12.4, 43.9], VA: [12.5, 41.9], XK: [20.9, 42.6],
    US: [-98.6, 39.8], CA: [-106.3, 56.1], MX: [-102.5, 23.6],
    BR: [-51.9, -10.8], AR: [-63.6, -38.4], CL: [-71.5, -35.7],
    UY: [-56.0, -32.8], PY: [-58.4, -23.4], BO: [-63.6, -16.3],
    PE: [-75.0, -9.2], EC: [-78.2, -1.8], CO: [-74.3, 4.6],
    VE: [-66.6, 6.4], CR: [-84.1, 9.7], PA: [-80.0, 8.5],
    CU: [-77.8, 21.5], DO: [-70.2, 18.7], JM: [-77.3, 18.1],
    JP: [138.3, 36.2], CN: [104.2, 35.9], KR: [127.8, 36.0],
    KP: [127.5, 40.3], IN: [78.9, 22.4], PK: [69.3, 30.4],
    BD: [90.4, 23.7], LK: [80.8, 7.9], NP: [84.1, 28.4],
    TH: [101.0, 15.9], VN: [108.3, 14.1], KH: [104.9, 12.6],
    LA: [102.5, 19.9], MM: [95.9, 21.9], MY: [101.9, 4.2],
    SG: [103.8, 1.35], ID: [113.9, -0.8], PH: [121.8, 12.9],
    AU: [133.8, -25.3], NZ: [174.9, -40.9], FJ: [178.1, -17.7],
    SA: [45.1, 23.9], AE: [54.3, 23.4], QA: [51.2, 25.4],
    KW: [47.6, 29.3], BH: [50.6, 26.0], OM: [55.9, 21.5],
    IL: [34.9, 31.0], PS: [35.2, 31.9], JO: [36.9, 30.6],
    LB: [35.9, 33.9], SY: [38.9, 34.8], IQ: [43.7, 33.1],
    IR: [53.7, 32.4], AF: [66.0, 33.9], EG: [30.8, 26.8],
    MA: [-7.1, 31.8], DZ: [2.6, 28.0], TN: [9.5, 34.0],
    LY: [17.2, 26.3], ZA: [24.7, -30.6], NG: [8.7, 9.1],
    KE: [37.9, -0.0], ET: [40.5, 9.1], GH: [-1.0, 7.9],
    CI: [-5.5, 7.5], SN: [-14.5, 14.5], TZ: [34.9, -6.4],
    UG: [32.3, 1.4], ZW: [29.2, -19.0], ZM: [27.8, -13.1],
    NA: [17.1, -22.1], BW: [24.7, -22.3], MZ: [35.5, -18.7],
    CM: [12.7, 6.4], MG: [46.9, -18.8], GE: [43.4, 42.3],
    AM: [45.0, 40.1], AZ: [47.6, 40.1], KZ: [66.9, 48.0],
    UZ: [64.6, 41.4], KG: [74.8, 41.2], TJ: [71.3, 38.9],
    TM: [59.6, 38.9], MN: [103.8, 46.9], HK: [114.2, 22.4],
    TW: [121.0, 23.7], MO: [113.5, 22.2],
  };

  // Landsnamn (svenska OCH engelska, via Intl.DisplayNames) för samtliga
  // koder i COUNTRY_CENTROIDS — används av matchClubName ovan för att
  // neka en riskabel tier-3-gissning när ett lagnamn ORDAGRANT bara är ett
  // landsnamn (landslagsklasser som EOC, se Gothias Team.nation). Byggs en
  // gång vid modulladdning, inte per anrop.
  const COUNTRY_NAME_WORDS = (() => {
    const words = new Set();
    for (const locale of ["sv", "en"]) {
      let dn;
      try { dn = new Intl.DisplayNames([locale], { type: "region" }); }
      catch { continue; }
      for (const code of Object.keys(COUNTRY_CENTROIDS)) {
        try {
          const n = dn.of(code);
          if (n) words.add(n.toLowerCase());
        } catch { /* okänd kod för denna Intl-version — hoppa */ }
      }
    }
    return words;
  })();

  // "Ungefärlig plats" — klubbar UTAN känd adress men med en känd landskod
  // klustras runt landets centroid i stället för att spridas ut i Atlanten
  // (se UNKNOWN_GRID nedan, den nivån är för klubbar helt UTAN varken
  // adress eller land). Samma stabila-slot-princip som UNKNOWN_GRID —
  // slotet återanvänds ALDRIG, annars skulle en orelaterad klubb i samma
  // land hoppa till en ny position bara för att en annan klubb i samma
  // land försvann ur urvalet. Slotnumreringen är PER LAND (egen Map per
  // landskod), inte global — annars skulle land #2 i tur och ordning börja
  // sitt kluster mitt i land #1:s om många länder bara har en handfull
  // klubbar var.
  const COUNTRY_GRID_COLS = 4;
  const COUNTRY_GRID_SPACING = [0.4, 0.3]; // [lng, lat] grader mellan klustrets punkter
  let countryGridSlotByCode = new Map(); // landskod -> Map(klubbnamn -> slotindex)

  // Hur långt norr om landets centroid "Visa landshistorik"-pinnen läggs
  // (grader latitud) — se paintMapMarkers — bara till för att den aldrig
  // ska hamna EXAKT ovanpå landsbollen/klubbnålarna på samma centroid.
  const HISTORY_PIN_OFFSET = 0.9;
  function countryGridLngLat(name, code) {
    const centroid = COUNTRY_CENTROIDS[code];
    if (!centroid) return null; // okänd/orimlig landskod — bör inte hända, men failsafe
    if (!countryGridSlotByCode.has(code)) countryGridSlotByCode.set(code, new Map());
    const slots = countryGridSlotByCode.get(code);
    if (!slots.has(name)) slots.set(name, slots.size);
    const slot = slots.get(name);
    const col = slot % COUNTRY_GRID_COLS;
    const row = Math.floor(slot / COUNTRY_GRID_COLS);
    // Centrerat kring centroid (inte startande FRÅN den) så klustret växer
    // åt alla håll i stället för att bara skjuta ut söderut/österut.
    const colOffset = col - (COUNTRY_GRID_COLS - 1) / 2;
    return [centroid[0] + colOffset * COUNTRY_GRID_SPACING[0],
            centroid[1] + row * COUNTRY_GRID_SPACING[1]];
  }

  // "Okända" klubbar (ingen adress att slå upp) plottas var för sig i ett
  // rutnät långt ute i Atlanten — mitt-Atlanten (inte Nordsjön som förut)
  // för att garanterat inte råka överlappa någon verklig klubbs nål ens
  // vid ett stort rutnät. Ger ett direkt visuellt mått på HUR STOR andel
  // av klubbarna som saknar känd adress, i stället för en enda samlad nål
  // med en textlista i popupen.
  const UNKNOWN_GRID_ORIGIN = [-30, 45]; // mitt-Atlanten, sydväst om Portugal
  const UNKNOWN_GRID_COLS = 20;
  const UNKNOWN_GRID_SPACING = [0.5, 0.3]; // [lng, lat] grader mellan rutnätspunkter

  // Varje klubbnamn får en STABIL rutnätsplats (tilldelas EN gång, sedan
  // aldrig omtilldelad) — annars skulle en helt orelaterad klubbs nål
  // hoppa till en ny position bara för att någon ANNAN klubb försvann ur
  // listan (indexbaserad placering skulle skifta alla efterföljande),
  // vilket precis som paintMapMarkers ovan skulle se ut som att kartan
  // "blinkar" vid varje årsbyte.
  let unknownGridSlotByName = new Map();
  function unknownGridLngLat(name) {
    if (!unknownGridSlotByName.has(name)) unknownGridSlotByName.set(name, unknownGridSlotByName.size);
    const slot = unknownGridSlotByName.get(name);
    const col = slot % UNKNOWN_GRID_COLS;
    const row = Math.floor(slot / UNKNOWN_GRID_COLS);
    return [UNKNOWN_GRID_ORIGIN[0] + col * UNKNOWN_GRID_SPACING[0],
            UNKNOWN_GRID_ORIGIN[1] + row * UNKNOWN_GRID_SPACING[1]];
  }

  // Länk rakt in i Schema (scope=all så den INTE begränsas till egna
  // klubben, q=klubbnamnet som fritextsökning, samma matchning som
  // sökrutan i verktygsraden — se matchesSearchQuery) för en given cup.
  // mapYear: Kartans just nu valda år (state.mapYear, null = "Nu") — allt
  // Karta visar just nu hör till EXAKT det året, så popupens länk ska visa
  // SAMMA år, inte nödvändigtvis cupens live-upplaga. years+curYear=0
  // isolerar till bara det arkiverade året (annars skulle live-upplagans
  // matcher blandas in också, se allActiveMatches).
  function clubDeepLinkUrl(clubName, cupId, mapYear) {
    const p = new URLSearchParams();
    p.set("cup", cupId);
    p.set("view", "schema");
    p.set("scope", "all");
    p.set("q", clubName);
    if (mapYear) { p.set("years", mapYear); p.set("curYear", "0"); }
    return "?" + p.toString();
  }

  // Delad av alla tre popup-nivåerna (klubbPopupBody/countryPopupBody/
  // unknownPopupBody) — en klubb kan förekomma i FLERA av de valda cuperna
  // samtidigt (se .cups, {id,name}-par), då blir det en länk per cup.
  // target=_blank så Kartans egen zoom/panorering/utfällda-länder-state
  // inte går förlorad när man bara vill kika snabbt på en klubbs matcher.
  function clubCupLinksBody(clubName, cups, mapYear) {
    if (!cups || !cups.length) return null;
    const kids = [];
    cups.forEach((c, i) => {
      if (i > 0) kids.push(", ");
      kids.push(h("a", { href: clubDeepLinkUrl(clubName, c.id, mapYear), target: "_blank", rel: "noopener" }, c.name));
    });
    return h("div", { class: "muted map-popup-cups" }, "Visa matcher: ", ...kids);
  }

  function clubPopupBody(name, info, mapYear) {
    return h("div", { class: "map-popup" },
      h("strong", null, name),
      h("br"),
      info.city + (info.country ? ", " + info.country : ""),
      clubCupLinksBody(name, info.cups, mapYear));
  }

  // Intl.DisplayNames — inbyggd webbläsar-API för att slå upp landsnamn
  // ("NO" -> "Norge") ur en landskod, ingen egen namntabell behövs (till
  // skillnad från COUNTRY_CENTROIDS, som bara kan hämtas ur koordinater).
  const countryNameLookup = (() => {
    try { return new Intl.DisplayNames(["sv"], { type: "region" }); }
    catch { return null; }
  })();
  function countryDisplayName(code) {
    try { return (countryNameLookup && countryNameLookup.of(code)) || code; }
    catch { return code; }
  }

  // collapseFn: bara ifylld när landets kluster är UTFÄLLT (se
  // expandedCountryCodes) — en chip i popupen för att fälla ihop det igen,
  // annars finns inget sätt att komma tillbaka till bollen utan att byta
  // cup/år (som återställer allt) eller ladda om sidan.
  function countryPopupBody(name, entry, collapseFn, mapYear) {
    return h("div", { class: "map-popup" },
      h("strong", null, name),
      h("br"),
      h("span", { class: "muted" }, "Ungefärlig plats — land: " + countryDisplayName(entry.code)),
      clubCupLinksBody(name, entry.cups, mapYear),
      collapseFn ? h("button", {
        class: "chip small", type: "button", style: "margin-top:6px",
        onclick: collapseFn,
      }, "← Gruppera " + countryDisplayName(entry.code) + " igen") : null);
  }

  // "Helt okänd"-nivåns popup (varken adress eller land, se
  // unknownGridLngLat) — cups kommer från renderMapViews allClubCups
  // (samma {id,name}-form som merged/countryMap, byggd separat eftersom
  // allClubNamesFromMatches/state.mapCupAllClubs annars bara ger platta
  // klubbnamn utan cup-koppling).
  function unknownPopupBody(name, cups, mapYear) {
    return h("div", { class: "map-popup" },
      h("strong", null, name),
      h("br"),
      h("span", { class: "muted" }, "Ingen känd adress eller land"),
      clubCupLinksBody(name, cups, mapYear));
  }

  // "Visa landshistorik"-pinnen: en lila RING (ihålig, INTE fylld som
  // countryBubbleElement) med landskoden som text — medvetet en annan form
  // OCH färg än både adressnivåns nålar och den (adresslösa) landsbollen,
  // så de tre aldrig kan förväxlas när de visas samtidigt (historikpinnen
  // är ett tillägg OVANPÅ resten av kartan, inte en ersättning för någon
  // av de andra nivåerna).
  function countryHistoryElement(code) {
    const el = document.createElement("div");
    el.className = "map-country-history-pin";
    el.textContent = code;
    return el;
  }

  function countryHistoryPopupBody(code, entry) {
    const years = [...entry.years].sort();
    // entry.teams kan vara tomt (bara innevarande upplaga bidrog, se
    // countryYearSummary) — visa då bara klubbantalet, ingen "0 lag".
    const teamsPart = entry.teams.size ? ", " + entry.teams.size + " lag" : "";
    return h("div", { class: "map-popup" },
      h("strong", null, countryDisplayName(code)),
      h("br"),
      h("span", { class: "muted" }, entry.clubs.size + " klubbar" + teamsPart + " totalt"),
      years.length ? h("div", { class: "muted" }, "Deltagit: " + years.join(", ")) : null);
  }

  // Landsklustrens boll (ihopfälld — se expandedCountryCodes): en cirkel
  // med antalet klubbar som text (klubbnamn, INTE fullt lagnamn — se
  // countryMap/clubCountryFromMatches, .club || .name men .club är alltid
  // ifyllt för Cup Manager/Gothia, som är de enda källorna landsdata
  // täcker just nu), storleken skalad (kvadratrot, inte
  // linjärt — annars skulle t.ex. 40 klubbar bli en orimligt stor cirkel
  // jämfört med 5) så den syns tydligt utzoomat utan att dominera kartan.
  // Ett vanligt maplibregl.Marker({color}) stödjer varken text inuti eller
  // dynamisk storlek — bygger därför ett eget DOM-element (stöds direkt av
  // Marker via {element: ...}).
  function countryBubbleElement(count, color) {
    const size = Math.round(Math.min(56, Math.max(24, 16 + Math.sqrt(count) * 8)));
    const el = document.createElement("div");
    el.className = "map-country-bubble";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.background = color;
    el.style.fontSize = Math.max(10, Math.min(15, Math.round(size * 0.32))) + "px";
    el.textContent = String(count);
    return el;
  }

  // Vilka landskoder som just nu är "utfällda" till enskilda klubbnålar i
  // stället för en samlad boll (se paintMapMarkers) — klick på en boll
  // lägger till, popupens "Gruppera igen"-chip tar bort. Modulnivå (inte
  // state) så den överlever renderContent()-anrop under en session, precis
  // som countryGridSlotByCode — nollställs bara när kartan byggs om helt
  // (createMap, ny cup-/årskombination).
  let expandedCountryCodes = new Set();
  let currentCountryBubbleByCode = new Map(); // landskod -> {marker, count, color}

  // Diffar mot markörerna som redan sitter på kartan i stället för att
  // rensa och bygga om alla — en klubb som förekommer i BÅDA det gamla och
  // nya urvalet (samma namn, oavsett om året eller cupvalet ändrats) rörs
  // inte alls (bara popupen uppdateras om "Deltar i"-listan ändrats), så
  // den INTE blinkar till. Bara faktiska tillägg/borttag ger en synlig
  // förändring — det är själva poängen med "Spela upp": kunna FÖLJA vad
  // som ändras mellan åren i stället för att hela kartan verkar blinka om.
  // Rör INTE kartans center/zoom (ingen fitBounds här), till skillnad från
  // createMap nedan.
  function paintMapMarkers(maplibregl, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups, countryHistory) {
    const nextNames = new Set(Object.keys(geo));
    for (const [name, entry] of currentMapMarkerByKey) {
      if (!nextNames.has(name)) { entry.marker.remove(); currentMapMarkerByKey.delete(name); }
    }
    for (const [name, info] of Object.entries(geo)) {
      const color = cupColorForClub(info);
      const existing = currentMapMarkerByKey.get(name);
      if (existing && existing.color === color) {
        // Oförändrad position OCH färg — uppdatera bara popupinnehållet
        // (kan skilja mellan år, t.ex. "Deltar i"-listan) utan att röra
        // själva nålens DOM-element.
        existing.marker.setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(clubPopupBody(name, info, mapYear)));
        continue;
      }
      if (existing) existing.marker.remove(); // färgen bytte (sällsynt, se cupColorForClub) — måste återskapas
      const marker = new maplibregl.Marker({ color })
        .setLngLat([info.lng, info.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(clubPopupBody(name, info, mapYear)))
        .addTo(currentMap);
      currentMapMarkerByKey.set(name, { marker, color });
    }
    // Mellannivån: känt land, okänd adress — grupperas per land till EN
    // "boll" (countryBubbleElement, storlek+siffra = antal klubbar) om
    // landet inte är utfällt (expandedCountryCodes), annars enskilda
    // klubbnålar precis som förut (countryGridLngLat, scale 0.7). Klick på
    // en boll fäller ut den (se click-lyssnaren nedan), popupens "Gruppera
    // igen"-chip (countryPopupBody) fäller ihop den igen.
    const byCode = new Map(); // landskod -> [[klubbnamn, entry], ...]
    for (const [name, entry] of (countryMap || new Map())) {
      if (!byCode.has(entry.code)) byCode.set(entry.code, []);
      byCode.get(entry.code).push([name, entry]);
    }

    const nextBubbleCodes = new Set([...byCode.keys()].filter((code) => !expandedCountryCodes.has(code)));
    for (const [code, entry] of currentCountryBubbleByCode) {
      if (!nextBubbleCodes.has(code)) { entry.marker.remove(); currentCountryBubbleByCode.delete(code); }
    }
    for (const code of nextBubbleCodes) {
      const clubs = byCode.get(code);
      const colors = new Set(clubs.map(([, e]) => cupColorForClub(e)));
      // Bollen aggregerar FLERA klubbar — om de inte alla delar samma
      // cupfärg (bara möjligt när flera cuper är valda, se cupColorForClub)
      // används den delade färgen i stället för att godtyckligt välja en.
      const color = colors.size === 1 ? [...colors][0] : MAP_SHARED_COLOR;
      const centroid = COUNTRY_CENTROIDS[code];
      if (!centroid) continue;
      const existing = currentCountryBubbleByCode.get(code);
      if (existing && existing.count === clubs.length && existing.color === color) continue; // oförändrad — rör inte
      if (existing) existing.marker.remove();
      const el = countryBubbleElement(clubs.length, color);
      el.title = countryDisplayName(code) + " — " + clubs.length +
        " klubbar utan känd adress. Klicka för att visa dem enskilt.";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        expandedCountryCodes.add(code);
        renderContent();
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(currentMap);
      currentCountryBubbleByCode.set(code, { marker, count: clubs.length, color });
    }

    const nextCountryNames = new Set([...(countryMap ? countryMap.keys() : [])]
      .filter((name) => expandedCountryCodes.has(countryMap.get(name).code)));
    for (const [name, entry] of currentCountryMarkerByKey) {
      if (!nextCountryNames.has(name)) { entry.marker.remove(); currentCountryMarkerByKey.delete(name); }
    }
    for (const name of nextCountryNames) {
      const cInfo = countryMap.get(name);
      const color = cupColorForClub(cInfo);
      const collapseFn = () => { expandedCountryCodes.delete(cInfo.code); renderContent(); };
      const existing = currentCountryMarkerByKey.get(name);
      if (existing && existing.color === color) {
        existing.marker.setPopup(
          new maplibregl.Popup({ offset: 12 }).setDOMContent(countryPopupBody(name, cInfo, collapseFn, mapYear)));
        continue;
      }
      if (existing) existing.marker.remove();
      const lngLat = countryGridLngLat(name, cInfo.code);
      if (!lngLat) continue; // okänd landskod (borde inte hända) — hoppa hellre än att krascha
      const marker = new maplibregl.Marker({ color, scale: 0.7 })
        .setLngLat(lngLat)
        .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(countryPopupBody(name, cInfo, collapseFn, mapYear)))
        .addTo(currentMap);
      currentCountryMarkerByKey.set(name, { marker, color });
    }
    const nextUnknown = new Set(unknownNames || []);
    for (const [name, marker] of currentUnknownMarkerByKey) {
      if (!nextUnknown.has(name)) { marker.remove(); currentUnknownMarkerByKey.delete(name); }
    }
    for (const name of nextUnknown) {
      if (currentUnknownMarkerByKey.has(name)) continue; // redan där, samma stabila rutnätsplats — rör inte
      const cups = (allClubCups && allClubCups.get(name)) || [];
      const marker = new maplibregl.Marker({ color: "#8a94a3" }) // grå — skiljer klubbarna utan känd adress från de med
        .setLngLat(unknownGridLngLat(name))
        .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(unknownPopupBody(name, cups, mapYear)))
        .addTo(currentMap);
      currentUnknownMarkerByKey.set(name, marker);
    }

    // "Visa landshistorik": en lila ringpin per land, förskjuten en bit
    // norr om landets centroid (HISTORY_PIN_OFFSET) så den aldrig hamnar
    // exakt ovanpå den (adresslösa) landsbollen på samma centroid — de två
    // ska gå att se och klicka på samtidigt. null = avstängd/ej redo,
    // rensa alla eventuella kvarvarande pinnar från förra gången den VAR
    // på (annars skulle de bli kvar efter att kryssrutan kryssats ur).
    const nextHistoryCodes = new Set(countryHistory ? countryHistory.keys() : []);
    for (const [code, entry] of currentHistoryMarkerByKey) {
      if (!nextHistoryCodes.has(code)) { entry.marker.remove(); currentHistoryMarkerByKey.delete(code); }
    }
    for (const [code, hEntry] of (countryHistory || new Map())) {
      const centroid = COUNTRY_CENTROIDS[code];
      if (!centroid) continue;
      const yearsKey = [...hEntry.years].sort().join(",");
      const existing = currentHistoryMarkerByKey.get(code);
      if (existing && existing.clubCount === hEntry.clubs.size && existing.teamCount === hEntry.teams.size &&
          existing.yearsKey === yearsKey) continue;
      if (existing) existing.marker.remove();
      const el = countryHistoryElement(code);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([centroid[0], centroid[1] + HISTORY_PIN_OFFSET])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(countryHistoryPopupBody(code, hEntry)))
        .addTo(currentMap);
      currentHistoryMarkerByKey.set(code, { marker, clubCount: hEntry.clubs.size, teamCount: hEntry.teams.size, yearsKey });
    }
  }

  // Städar upp en aktiv maplibregl.Map-instans när man lämnar Karta för en
  // annan Stats-underflik (eller huvudflik) — createMap() nedan tar bara
  // hand om det gamla instansen vid NÄSTA Karta-besök (currentMap.remove()
  // precis innan en ny karta byggs), så en övergiven instans (kvarhållen
  // WebGL-kontext + egen renderloop) kunde annars leva kvar i bakgrunden
  // hur länge som helst, tills man råkade gå tillbaka till Karta. Misstänkt
  // orsak till en rapporterad bugg: i Chrome (till skillnad från Safari,
  // vars WebGL-/kompositorhantering verkar tåla en övergiven kontext
  // bättre) kunde en sådan kvarglömd renderloop göra HELA sidans scroll
  // trögstartad/låst på HELT ANDRA flikar (GPU-processen upptagen av en
  // loop som aldrig fick städa sig själv), trots att varken CSS eller
  // scroll-relaterad JS visade något fel. mapBoxEl/mapBoxKey nollställs
  // också, så nästa Karta-besök bygger en helt ny container i stället för
  // att försöka återansluta till en sedan länge bortkopplad nod.
  function destroyMapIfLeavingKarta() {
    if (!currentMap) return;
    stopMapPlay();
    currentMap.remove();
    currentMap = null;
    mapBoxEl = null;
    mapBoxKey = null;
    currentMapMarkerByKey = new Map();
    currentUnknownMarkerByKey = new Map();
    currentCountryMarkerByKey = new Map();
    currentCountryBubbleByCode = new Map();
    currentHistoryMarkerByKey = new Map();
    expandedCountryCodes = new Set();
  }

  function createMap(maplibregl, container, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups,
      countryHistory) {
    if (currentMap) { currentMap.remove(); currentMap = null; }
    currentMapMarkerByKey = new Map();
    currentUnknownMarkerByKey = new Map();
    currentCountryMarkerByKey = new Map();
    currentCountryBubbleByCode = new Map();
    currentHistoryMarkerByKey = new Map();
    expandedCountryCodes = new Set(); // ny karta = börja ihopfällt igen
    currentMap = new maplibregl.Map({
      container,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [15, 62], // ungefärligt Sverige-centrum, ersätts direkt av fitBounds nedan
      zoom: 4,
    });
    currentMap.addControl(new maplibregl.NavigationControl(), "top-right");
    paintMapMarkers(maplibregl, geo, countryMap, unknownNames, cupColorForClub, mapYear, allClubCups, countryHistory);
    // Landsnivåns markörer är RIKTIGA (om än ungefärliga) geografiska
    // positioner — till skillnad från Atlant-rutnätet (bara EN representativ
    // punkt räknas in där, se nedan) räknas VARJE lands centroid in i
    // inzoomningen, så t.ex. en internationell cup med lag från många länder
    // faktiskt zoomar ut till hela Europa/världen i stället för att klämma
    // ihop dem mot en enda punkt.
    const bounds = new maplibregl.LngLatBounds();
    for (const info of Object.values(geo)) bounds.extend([info.lng, info.lat]);
    for (const entry of (countryMap ? countryMap.values() : [])) {
      const centroid = COUNTRY_CENTROIDS[entry.code];
      if (centroid) bounds.extend(centroid);
    }
    // Historikpinnar för länder som HAR haft klubbar tidigare men inte i
    // det just nu visade läget (state.mapYear) skulle annars kunna hamna
    // helt utanför den automatiska inzoomningen.
    for (const code of (countryHistory ? countryHistory.keys() : [])) {
      const centroid = COUNTRY_CENTROIDS[code];
      if (centroid) bounds.extend(centroid);
    }
    if (unknownNames && unknownNames.length) bounds.extend(UNKNOWN_GRID_ORIGIN);
    if (!bounds.isEmpty()) currentMap.fitBounds(bounds, { padding: 40, maxZoom: 10 });
  }

  // --- render: tabeller -------------------------------------------------------

  function divisionsToShow() {
    // Grupper (divisioner) ur de filtrerade matcherna, med klubbens först.
    // Slutspelsdivisioner (divType "Playoff") hör hemma i Slutspel-fliken,
    // inte här — Division$table för dem är inte en meningsfull tabell.
    // m.divType saknas för gammal cachad data (fylls i vid nästa synk) och
    // för ProCup — då räknas matchen in som förr (odiskriminerat).
    const map = new Map();
    for (const m of scoped()) {
      if (state.cats.size && !state.cats.has(m.catId)) continue;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) continue;
      if (!matchesSearchQuery(m)) continue;
      if (!matchesViewFilter(m)) continue;
      if (!m.divId) continue;
      if (m.divType === "Playoff") continue;
      if (!map.has(m.divId)) {
        map.set(m.divId, {
          // edition: null för innevarande (live) upplaga, annars årtalet —
          // avgör i renderTables()/ensureTable() om tabellen ska hämtas
          // live från Cup Manager eller räknas fram lokalt ur redan
          // inladdade arkivmatcher (samma divId-rymd krockar aldrig
          // mellan upplagor, se allActiveMatches()).
          id: m.divId, name: m.divName, catId: m.catId, catName: m.catName,
          edition: m.edition || null, ours: false,
        });
      }
      const d = map.get(m.divId);
      if (isClubMatch(m)) d.ours = true;
    }
    let divs = [...map.values()];
    if (state.scope === "club") divs = divs.filter((d) => d.ours);
    divs.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
      a.catName.localeCompare(b.catName, "sv") ||
      (b.edition || "").localeCompare(a.edition || "") ||
      a.name.localeCompare(b.name, "sv", { numeric: true }));
    return divs;
  }

  // Köerna nedan (tabeller/slutspel/grupptabeller) serialiserar sina anrop
  // genom att kedja .then på en promise som lever kvar mellan anropen. Blir
  // ett led AVVISAT poisonas hela kön: varje efterföljande .then hoppas
  // över, så inga fler tabeller laddas — och rejection:en är ohanterad,
  // vilket triggar "något gick fel"-rutan (se felfångaren i index.html).
  //
  // Fetchen är redan try/catch:ad i varje kö, men den avslutande
  // renderContent() låg UTANFÖR: ett renderingsfel (t.ex. i en enskild vy)
  // förvandlades därför till ett köhaveri i stället för att bara vara det
  // fel det är. queued() ser till att kön ALLTID lämnas i löst tillstånd
  // och loggar felet i stället för att tysta det.
  function queued(prev, fn) {
    return prev.then(fn, fn).catch((e) => {
      try { console.error("[hboll] fel i bakgrundskö:", e); } catch { /* ingen konsol */ }
    });
  }

  let tableQueue = Promise.resolve();

  function ensureTable(divId, edition) {
    if (state.tables[divId]) return;
    if (edition) {
      // Arkiverat år: all data redan hämtad (state.yearMatches), ingen
      // fetch — cupens egen slutgiltiga tabell arkiveras inte (bara
      // matcherna), så räkna fram den lokalt precis som Historik gör
      // (computeGroupTableRows, delad med historicalGroupTables).
      const divMatches = allActiveMatches().filter((m) => m.divId === divId);
      state.tables[divId] = { status: "done", rows: computeGroupTableRows(divMatches) };
      return;
    }
    state.tables[divId] = { status: "loading", rows: [] };
    const complete = allMatchesFinished(state.matches.filter((m) => m.divId === divId));
    tableQueue = queued(tableQueue, async () => {
      try {
        const rows = await HB.api.fetchTable(cup(), divId, complete);
        state.tables[divId] = { status: "done", rows };
      } catch {
        state.tables[divId] = { status: "error", rows: [] };
      }
      if (state.view === "tabeller") renderContent();
    });
  }

  function renderTables(main) {
    if (!hasFilterSelection()) {
      main.append(h("div", { class: "banner" },
        "Välj en eller flera klasser eller lag ovan för att visa tabeller."));
      return;
    }
    const divs = divisionsToShow();
    if (!divs.length) {
      main.append(h("div", { class: "banner" }, "Inga grupper att visa."));
      return;
    }
    let lastGroupKey = null;
    let groupEl = null;
    for (const d of divs) {
      ensureTable(d.id, d.edition);
      // Gruppnyckeln inkluderar årtal — annars skulle två olika års
      // klasser med IDENTISKT namn (typ vuxenklasser utan födelseår i
      // namnet) råka slås ihop under samma rubrik när flera år är aktiva.
      const groupKey = d.catName + "|" + (d.edition || "");
      if (groupKey !== lastGroupKey) {
        lastGroupKey = groupKey;
        const heading = d.catName + (state.years.size ? " · " + (d.edition || cup().edition) : "");
        main.append(h("h2", { class: "day-h" }, heading));
        groupEl = h("div", { class: "table-group" });
        main.append(groupEl);
      }
      const t = state.tables[d.id];
      const box = h("section", { class: "table-box" },
        h("h3", null, d.name || "Grupp"));
      if (!t || t.status === "loading") {
        box.append(h("p", { class: "muted" }, "Hämtar tabell …"));
      } else if (t.status === "error") {
        box.append(h("p", { class: "muted" }, "Ingen tabell för den här gruppen."));
      } else if (!t.rows.length) {
        box.append(h("p", { class: "muted" }, "Tabellen är tom ännu."));
      } else {
        box.append(h("table", { class: "standings" },
          h("thead", null, h("tr", null,
            ["#", "Lag", "S", "V", "O", "F", "+/-", "P"].map((c, i) =>
              h("th", { class: i < 2 ? "l" : "" }, c)))),
          h("tbody", null, t.rows.map((r, i) =>
            h("tr", { class: isClubName(r.name) ? "us" : "" },
              h("td", null, String(i + 1)),
              h("td", { class: "l" },
                r.teamId != null
                  ? h("button", {
                      class: "team-link", type: "button",
                      title: "Visa " + r.name + "s matcher",
                      onclick: () => gotoTeamMatches({ id: r.teamId }, "all"),
                    }, r.name)
                  : r.name),
              h("td", null, String(r.played)),
              h("td", null, String(r.won)),
              h("td", null, String(r.tied)),
              h("td", null, String(r.lost)),
              h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
              h("td", { class: "pts" }, String(r.points)))))));
      }
      groupEl.append(box);
    }
  }

  // --- render: slutspel --------------------------------------------------------

  function categoriesToShow() {
    // Kategorier ur de filtrerade matcherna, med klubbens först — samma
    // urvalslogik som divisionsToShow(), fast per kategori (en kategori kan
    // ha flera slutspelsträd: A-/B-/C-Slutspel).
    const map = new Map();
    for (const m of scoped()) {
      if (state.cats.size && !state.cats.has(m.catId)) continue;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) continue;
      if (!matchesSearchQuery(m)) continue;
      if (!matchesViewFilter(m)) continue;
      if (!m.catId) continue;
      if (!map.has(m.catId)) {
        // edition: se motsvarande kommentar i divisionsToShow().
        map.set(m.catId, { catId: m.catId, catName: m.catName, edition: m.edition || null, ours: false });
      }
      if (isClubMatch(m)) map.get(m.catId).ours = true;
    }
    let cats = [...map.values()];
    if (state.scope === "club") cats = cats.filter((c) => c.ours);
    cats.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
      a.catName.localeCompare(b.catName, "sv") ||
      (b.edition || "").localeCompare(a.edition || ""));
    return cats;
  }

  let playoffQueue = Promise.resolve();

  function ensurePlayoffs(catId, edition) {
    if (state.playoffs[catId]) return;
    if (edition) {
      // Arkiverat år: matcherna är redan hämtade (state.yearMatches) och
      // bär redan roundRank/matchRank/nextWinnerId/nextLoserId — samma
      // fält HB.api.fetchPlayoffs() ger live — så trädet kan byggas lokalt
      // utan ny fetch, med samma gruppering (groupPlayoffDivisionsById)
      // som Historik-modalen använder.
      const catMatches = allActiveMatches()
        .filter((m) => m.catId === catId && m.divType === "Playoff");
      state.playoffs[catId] = { status: "done", divisions: groupPlayoffDivisionsById(catMatches) };
      return;
    }
    state.playoffs[catId] = { status: "loading", divisions: [] };
    const complete = allMatchesFinished(
      state.matches.filter((m) => m.catId === catId && m.divType === "Playoff"));
    playoffQueue = queued(playoffQueue, async () => {
      try {
        const divisions = await HB.api.fetchPlayoffs(cup(), catId, complete);
        state.playoffs[catId] = { status: "done", divisions };
      } catch {
        state.playoffs[catId] = { status: "error", divisions: [] };
      }
      if (state.view === "slutspel") renderContent();
    });
  }

  // --- slutspelsprognos: fyller i platshållarplatser ("N:an i Grupp M",
  // "Bästa N:an", "Vinn. X") med nuvarande tabellplacering, och förutspår
  // vinnare av ospelade möten (bäst placerade laget — poäng, sen
  // målskillnad, sen gjorda mål — antas gå vidare). Rör aldrig
  // originaldatan i state.playoffs; bygger en separat projektionskarta som
  // bracketMatchBox/bracketTableBlock läser om inställningen är på.
  //
  // OBS: siffran i "Vinn. 18072137" är INTE samma id-rymd som Match.id —
  // det är en Cup Manager-intern etikett vi inte kan slå upp direkt
  // (verifierat: en semifinals "Vinn. 18072137" refererar till en
  // kvartsfinal vars riktiga id är 82143330). Vi använder i stället
  // matchens EGNA nextWinnerId-fält (redan i datan) för att koppla ihop
  // matcher framåt i trädet, positionerat via matchRank när en match har
  // två olösta sidor (t.ex. finalen).

  const PLACEHOLDER_WINNER_OF = /^vinn/i;
  const PLACEHOLDER_NTH_BEST_OF_RANK = /^(\d+)\s*:\s*\w+\s+b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
  const PLACEHOLDER_BEST_OF_RANK = /^b[äa]sta\s+(\d+)\s*:\s*\w+$/i;
  const PLACEHOLDER_RANK_IN_GROUP = /^(\d+)\s*:\s*\w+\s+i\s+grupp\s+(\d+)$/i;

  let groupTablesQueue = Promise.resolve();

  function ensureGroupTables(catId) {
    if (state.groupTables[catId]) return;
    state.groupTables[catId] = { status: "loading" };
    const complete = allMatchesFinished(
      state.matches.filter((m) => m.catId === catId && m.divType !== "Playoff"));
    groupTablesQueue = queued(groupTablesQueue, async () => {
      try {
        const groups = await HB.api.fetchGroupDivisions(cup(), catId, complete);
        const byGroupNum = {};
        const teamStrength = {};
        await Promise.all(groups.map(async (g) => {
          const gm = /grupp\s*(\d+)/i.exec(g.name || "");
          if (!gm) return;
          const rows = await HB.api.fetchTable(cup(), g.id, complete);
          byGroupNum[+gm[1]] = rows;
          for (const r of rows) {
            if (r.teamId) teamStrength[r.teamId] = { points: r.points, gf: r.gf, ga: r.ga, name: r.name };
          }
        }));
        state.groupTables[catId] = { status: "done", byGroupNum, teamStrength };
      } catch {
        state.groupTables[catId] = { status: "error" };
      }
      if (state.view === "slutspel") renderContent();
    });
  }

  // En grupp räknas som klar (dess tabellplats INTE längre kan ändras) när
  // alla lag spelat lika många matcher som en fulltalig serie kräver
  // (grupp­storlek − 1, dvs alla mot alla en gång) — den vanliga
  // gruppspelsformen i de här cuperna. Styr om ett gruppbaserat
  // platshållarlag ("N:an i Grupp M") ska visas som en SÄKER deltagare
  // (normal stil) eller en osäker prognos (kursiv), se buildPlayoffProjection.
  function isGroupComplete(rows) {
    return rows.length > 0 && rows.every((r) => r.played === rows.length - 1);
  }

  // Wildcard-poolen för en given tabellposition (t.ex. alla 5:or, en per
  // grupp) — sorterad efter samma kriterier som en vanlig tabell, så
  // "Bästa 5:an"/"2:a bästa 5:an" kan plockas ur rätt position. Cachad per
  // anrop av buildPlayoffProjection (wcCache), inte globalt.
  function wildcardPool(byGroupNum, rank, wcCache) {
    if (wcCache.has(rank)) return wcCache.get(rank);
    const pool = Object.values(byGroupNum)
      .map((rows) => ({ row: rows[rank - 1], groupComplete: isGroupComplete(rows) }))
      .filter((e) => e.row)
      .sort((a, b) => b.row.points - a.row.points ||
        (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga) || b.row.gf - a.row.gf);
    wcCache.set(rank, pool);
    return pool;
  }

  // Löser upp ETT gruppbaserat platshållarnamn ("N:an i Grupp M"/"Bästa
  // N:an") mot aktuell tabellplacering. Returnerar null om strängen inte
  // känns igen — antingen redan ett riktigt lagnamn, eller en "Vinn. X"-
  // platshållare (hanteras separat i buildPlayoffProjection via
  // nextWinnerId, se kommentaren ovanför regexarna). `certain` är true bara
  // om HELA gruppen (för N:an i Grupp M) eller ALLA bidragande grupper (för
  // wildcards) redan är färdigspelade — annars kan ordningen fortfarande
  // ändras och laget är en gissning, inte ett säkert faktum.
  function resolvePlaceholderTeam(name, gd, wcCache) {
    const s = (name || "").trim();
    let m;
    if ((m = PLACEHOLDER_NTH_BEST_OF_RANK.exec(s))) {
      const pool = wildcardPool(gd.byGroupNum, +m[2], wcCache);
      const e = pool[+m[1] - 1];
      return e ? { teamId: e.row.teamId, name: e.row.name, points: e.row.points,
        gf: e.row.gf, ga: e.row.ga, certain: pool.every((x) => x.groupComplete) } : null;
    }
    if ((m = PLACEHOLDER_BEST_OF_RANK.exec(s))) {
      const pool = wildcardPool(gd.byGroupNum, +m[1], wcCache);
      const e = pool[0];
      return e ? { teamId: e.row.teamId, name: e.row.name, points: e.row.points,
        gf: e.row.gf, ga: e.row.ga, certain: pool.every((x) => x.groupComplete) } : null;
    }
    if ((m = PLACEHOLDER_RANK_IN_GROUP.exec(s))) {
      const rows = gd.byGroupNum[+m[2]] || [];
      const row = rows[+m[1] - 1];
      return row ? { teamId: row.teamId, name: row.name, points: row.points, gf: row.gf, ga: row.ga,
        certain: isGroupComplete(rows) } : null;
    }
    return null;
  }

  // Bäst placerade laget (poäng, sen målskillnad, sen gjorda mål) — en
  // enkel, öppet deklarerad "formen håller i sig"-prognos, inte en
  // matchspecifik gissning.
  function betterTeam(a, b) {
    if (a.points !== b.points) return a.points > b.points ? a : b;
    const ad = a.gf - a.ga, bd = b.gf - b.ga;
    if (ad !== bd) return ad > bd ? a : b;
    return a.gf >= b.gf ? a : b;
  }

  // Bygger en prognoskarta (matchId -> {home, away, winnerSide}) för EN
  // slutspelsdivision. Går igenom omgångarna tidigast→senast (samma
  // ordning som groupPlayoffRounds ger) och matar vinnare framåt via
  // nextWinnerId — så en "Vinn. X"-platshållare i en senare omgång alltid
  // redan har sin matarmatch upplöst när den behövs. Redan spelade matcher
  // projiceras inte (deras VERKLIGA vinnare används rakt av som grund för
  // senare omgångar) — bara ospelade matcher hamnar i kartan.
  function buildPlayoffProjection(div, gd) {
    const wcCache = new Map();
    // targetMatchId -> [{matchRank, winner}], i ankomstordning (tidigast
    // omgång först); sorteras på matchRank innan den konsumeras nedan så
    // matcher med TVÅ olösta sidor (t.ex. finalen) får en stabil
    // hemma/borta-tilldelning.
    const feederQueue = new Map();
    const proj = new Map();
    for (const [, ms] of groupPlayoffRounds(div)) {
      for (const m of ms) {
        const feeders = (feederQueue.get(m.id) || []).sort((a, b) => a.matchRank - b.matchRank);
        let feederIdx = 0;
        // `certain`: false = laget självt är en gissning (kursiv i UI:t);
        // true = laget är ett säkert faktum (redan bestämt), även om
        // MATCHEN de ska spela inte är avgjord än. En "Vinn. X"-sida ärver
        // matchcertainty från matarmatchen (f.certain) — INTE lagets egen
        // certain-flagga — eftersom vem som vinner alltid är en gissning
        // tills den matchen faktiskt är spelad.
        const resolveSide = (side) => {
          const r = resolvePlaceholderTeam(side.name, gd, wcCache);
          if (r) return r;
          if (PLACEHOLDER_WINNER_OF.test((side.name || "").trim())) {
            const f = feeders[feederIdx++];
            return f ? { ...f.winner, certain: f.certain } : null;
          }
          if (side.id == null || !side.name) return null;
          const strength = gd.teamStrength[side.id];
          return {
            teamId: side.id, name: side.name,
            points: strength ? strength.points : -1,
            gf: strength ? strength.gf : 0, ga: strength ? strength.ga : 0,
            certain: true,
          };
        };
        const home = resolveSide(m.home);
        const away = resolveSide(m.away);
        let winner = null;
        const realResult = !!(m.res && m.res.fin);
        if (realResult) {
          winner = m.res.winner === "home"
            ? (home || { teamId: m.home.id, name: m.home.name, points: -1, gf: 0, ga: 0, certain: true })
            : (away || { teamId: m.away.id, name: m.away.name, points: -1, gf: 0, ga: 0, certain: true });
        } else if (home && away) {
          winner = betterTeam(home, away);
          proj.set(m.id, { home, away, winnerSide: winner === home ? "home" : "away" });
        }
        if (winner && m.nextWinnerId != null) {
          if (!feederQueue.has(m.nextWinnerId)) feederQueue.set(m.nextWinnerId, []);
          feederQueue.get(m.nextWinnerId).push({ matchRank: m.matchRank, winner, certain: realResult });
        }
      }
    }
    return proj;
  }

  // projMap: matchId -> {home, away, winnerSide} från buildPlayoffProjection()
  // — ospelade matcher som kunnat lösas upp visar ett prognosticerat lagnamn
  // (tydligt markerat, class "predicted") i stället för det råa
  // platshållarnamnet ("N:an i Grupp M" osv).
  // onClick: valfri override — historikens brackettrad matar in matcher
  // som inte finns i state.matches (fel år), så gotoMatch(m) skulle inte
  // hitta något att hoppa till där.
  function bracketMatchBox(m, projMap, onClick) {
    const sc = scoreText(m.res);
    const handleClick = onClick || (() => gotoMatch(m));
    const proj = projMap ? projMap.get(m.id) : null;
    const teamRow = (side, isHome) => {
      const projSide = proj ? (isHome ? proj.home : proj.away) : null;
      const name = projSide ? projSide.name : (side.name || "TBD");
      const won = proj
        ? proj.winnerSide === (isHome ? "home" : "away")
        : (m.res && m.res.fin && m.res.winner &&
            ((m.res.winner === "home") === isHome));
      // Kursiv "predicted"-stil bara om LAGET SJÄLVT är en gissning (t.ex.
      // en grupp som fortfarande spelas) — inte bara för att MATCHEN de ska
      // mötas i är ospelad. Ett redan säkert lag (grupp klar, eller vann en
      // riktigt spelad tidigare omgång) visas normalt även i en prognosmatch.
      const uncertain = projSide && projSide.certain === false;
      return h("div", {
        class: "bracket-team" + (isClubName(name) ? " us" : "") +
          (won ? " won" : "") + (uncertain ? " predicted" : ""),
      }, name);
    };
    return h("div", {
      class: "bracket-match" + (isClubMatch(m) ? " ours" : "") + (proj ? " predicted-match" : ""),
      "data-match-id": String(m.id),
      role: "button", tabindex: "0",
      title: onClick ? undefined : "Visa i schemat",
      "aria-label": "Visa " + (m.home.name || "TBD") + " mot " + (m.away.name || "TBD") +
        (onClick ? "" : " i schemat"),
      onclick: handleClick,
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); }
      },
    },
      h("div", { class: "bracket-teams" }, teamRow(m.home, true), teamRow(m.away, false)),
      h("div", { class: "bracket-score" }, proj ? "Prognos" : (sc || "–")),
      h("div", { class: "bracket-meta" },
        (m.matchNr ? "Match " + m.matchNr + " · " : "") +
        fmtTime.format(new Date(m.start)) + (m.arena ? " · " + m.arena : "")));
  }

  function groupPlayoffRounds(div) {
    const byRound = new Map();
    for (const m of div.matches) {
      if (!byRound.has(m.roundRank)) byRound.set(m.roundRank, []);
      byRound.get(m.roundRank).push(m);
    }
    // Högre rank = tidigare omgång; sorterat så finalen (rank 0) hamnar sist/till höger.
    const rounds = [...byRound.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, ms] of rounds) ms.sort((a, b) => a.matchRank - b.matchRank);
    return rounds;
  }

  // Ritar linjer mellan en match och matchen dess vinnare går vidare till
  // (m.nextWinnerId) — en SVG-overlay i stället för en ren CSS-lösning,
  // eftersom nextWinnerId ger den FAKTISKA kopplingen (byes/ojämna
  // trädformer gör att man inte kan anta att match 0+1 i en omgång alltid
  // matar match 0 i nästa). Måste köras EFTER att .bracket-box:en är
  // inklistrad i det levande DOM-trädet, annars ger getBoundingClientRect()
  // meningslösa mått — anropas via requestAnimationFrame från renderPlayoffs.
  // Mjukt rundade hörn i stället för raka 90°-vinklar — samma tre-segments-
  // elbow som förut (rakt ut, rakt över, rakt in) men med en liten kurva i
  // svängarna, som i välgjorda bracket-visualiseringar. Om käll- och
  // målmatchen råkar ligga i exakt samma höjd blir det bara en rak linje.
  function roundedElbowPath(x1, y1, midX, y2, x2, r) {
    if (Math.abs(y2 - y1) < 1) return "M" + x1 + "," + y1 + " L" + x2 + "," + y2;
    const dir = y2 > y1 ? 1 : -1;
    const rr = Math.max(0, Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX)));
    return [
      "M" + x1 + "," + y1,
      "L" + (midX - rr) + "," + y1,
      "Q" + midX + "," + y1 + " " + midX + "," + (y1 + rr * dir),
      "L" + midX + "," + (y2 - rr * dir),
      "Q" + midX + "," + y2 + " " + (midX + rr) + "," + y2,
      "L" + x2 + "," + y2,
    ].join(" ");
  }

  // zoomOverride: historikens brackettrad har ingen egen zoomreglering
  // (renderas alltid utan CSS zoom) och ska inte påverkas av vad
  // användaren råkar ha ställt in på live-Slutspel-fliken.
  function drawBracketConnectors(boxEl, div, zoomOverride) {
    const bracketEl = boxEl.querySelector(".bracket");
    if (!bracketEl) return;
    const old = bracketEl.querySelector(".bracket-connectors");
    if (old) old.remove();
    // SVG:n hamnar SJÄLV inuti .bracket-row (samma element som får CSS
    // zoom:X) — webbläsaren skalar alltså SVG:ns egen box en gång TILL när
    // den renderas, utöver den zoomning som redan syns i
    // getBoundingClientRect(). Sätter man koordinater direkt i redan-
    // zoomade skärmpixlar dubbel-skalas allt (stämmer bara vid 100 %,
    // driftar isär i takt med zoomnivån) — dela bort zoom-faktorn för
    // path-koordinaterna nedan så de är i samma "ozoomade" enheter som
    // webbläsaren själv multiplicerar med zoom vid rendering.
    //
    // Bredd/höjd på SVG:n är ett SEPARAT problem: .bracket-box har
    // overflow-x:auto (för att kunna scrolla breda träd i sidled i stället
    // för att svälla hela sidan) — .bracket:s getBoundingClientRect()
    // ger då bara den SYNLIGA (ev. scrollade) bredden, inte trädets
    // fulla innehållsyta. Sätter man SVG:ns viewBox till den synliga
    // bredden klipper SVG:n själv bort alla linjer som ligger bortom vad
    // som råkar synas just nu (upptäckt 2026-07-19: linjerna "försvann"
    // efter första omgången). scrollWidth/scrollHeight ger den fulla
    // innehållsytan OCH är redan i lokala (ozoomade) enheter — behöver
    // alltså inte delas med zoom, till skillnad från positionsmåtten.
    const zoom = zoomOverride != null ? zoomOverride : (state.bracketZoom || 1);
    const raw = bracketEl.getBoundingClientRect();
    const base = {
      left: raw.left, top: raw.top,
      width: bracketEl.scrollWidth, height: bracketEl.scrollHeight,
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bracket-connectors");
    svg.setAttribute("width", String(base.width));
    svg.setAttribute("height", String(base.height));
    svg.setAttribute("viewBox", "0 0 " + base.width + " " + base.height);
    for (const m of div.matches) {
      if (m.nextWinnerId == null) continue;
      const src = bracketEl.querySelector('[data-match-id="' + m.id + '"]');
      const dst = bracketEl.querySelector('[data-match-id="' + m.nextWinnerId + '"]');
      if (!src || !dst) continue;
      const sr = src.getBoundingClientRect(), dr = dst.getBoundingClientRect();
      const x1 = (sr.right - base.left) / zoom, y1 = (sr.top + sr.height / 2 - base.top) / zoom;
      const x2 = (dr.left - base.left) / zoom, y2 = (dr.top + dr.height / 2 - base.top) / zoom;
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "bracket-connector-line" + (isClubMatch(m) ? " ours" : ""));
      path.setAttribute("d", roundedElbowPath(x1, y1, midX, y2, x2, 10));
      svg.appendChild(path);
    }
    bracketEl.prepend(svg);
  }

  function bracketBlock(div, projMap, matchOnClick) {
    return h("section", { class: "bracket-box" },
      h("h3", null, div.name),
      h("div", { class: "bracket" },
        groupPlayoffRounds(div).map(([, ms]) =>
          h("div", { class: "bracket-round" },
            h("div", { class: "bracket-round-label" }, ms[0].roundName || ""),
            ms.map((m) => bracketMatchBox(m, projMap, matchOnClick))))));
  }

  // Sortering av den avancerade slutspelstabellen — delad mellan alla
  // synliga A-/B-/C-tabeller (session, sparas ej). null = trädets naturliga
  // omgångsordning (tidigast→final); annars {col, dir}.
  let bracketSort = null;

  const BRACKET_SORT_COLS = {
    // roundRank: lägre = senare omgång (finalen = 0) — se groupPlayoffRounds().
    // Stigande sortering på detta ger alltså finalen överst, samma ordning
    // som det naturliga (ej klickade) läget nedan.
    omgang: (m) => m.roundRank * 1000 + (m.matchRank || 0),
    nr: (m) => m.matchNr || "",
    lag: (m) => (m.home.name || "").toLowerCase(),
    resultat: (m) => (m.res && m.res.fin && !m.res.wo) ? (m.res.hg || 0) + (m.res.ag || 0) : -1,
    tid: (m) => m.start,
    bana: (m) => m.arena || "",
  };

  function sortBracketRows(rows) {
    if (!bracketSort) return rows;
    const key = BRACKET_SORT_COLS[bracketSort.col];
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const ka = key(a), kb = key(b);
      const cmp = typeof ka === "string" ? ka.localeCompare(kb, "sv", { numeric: true }) : ka - kb;
      return bracketSort.dir * cmp;
    });
  }

  // "Avancerad tabell": samma slutspelsmatcher som bracketBlock, men som en
  // radbaserad tabell med tid/plan — mer detaljer och lättare att scrolla
  // på smala skärmar än trädets sidledes kolumner. Kolumnrubrikerna är
  // klickbara och sorterar (klick igen växlar riktning). "Omgång" är
  // förvalt (utan att en egen sortering behöver klickas fram) i samma
  // ordning som trädet fast omvänd — finalen överst.
  function bracketTableBlock(div, projMap) {
    const allRows = groupPlayoffRounds(div).flatMap(([, ms]) => ms);
    const { visible: splitRows, hiddenCount } = splitRecentPlayedByCount(
      allRows, state.recentMatchCount, state.showAllPlayedBracket ? Infinity : 0);
    // splitRecentPlayedByCount sorterar alltid kronologiskt stigande internt
    // (för att avgöra äldst/nyast) — den egentliga sorteringen (bracketSort,
    // eller naturlig omgångsordning) måste därför läggas på EFTER, annars
    // skrivs den över och kolumnklick/riktningsbyten ser ut att inte ha
    // någon effekt.
    const rows = bracketSort ? sortBracketRows(splitRows) : [...splitRows].reverse();
    const headerCell = (label, col, wide) => {
      const active = bracketSort ? bracketSort.col === col : col === "omgang";
      return h("th", {
        class: (wide ? "l " : "") + "bracket-th-sort" + (active ? " on" : ""),
        role: "button", tabindex: "0",
        onclick: () => {
          if (bracketSort && bracketSort.col === col) { bracketSort.dir *= -1; }
          else { bracketSort = { col, dir: 1 }; }
          renderContent();
        },
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); }
        },
      }, label, active ? h("span", { class: "sort-arrow" }, bracketSort ? (bracketSort.dir > 0 ? " ▲" : " ▼") : "") : null);
    };
    return h("section", { class: "table-box" },
      h("h3", null, div.name),
      h("table", { class: "standings bracket-table" },
        h("thead", null, h("tr", null,
          headerCell("Omgång", "omgang", true),
          headerCell("Nr", "nr"),
          headerCell("Lag", "lag", true),
          headerCell("Resultat", "resultat"),
          headerCell("Tid", "tid"),
          headerCell("Bana", "bana"))),
        h("tbody", null, rows.map((m) => {
          const sc = scoreText(m.res);
          const proj = projMap ? projMap.get(m.id) : null;
          const homeName = proj ? proj.home.name : (m.home.name || "TBD");
          const awayName = proj ? proj.away.name : (m.away.name || "TBD");
          return h("tr", {
            class: "bracket-table-row" + (isClubMatch(m) ? " us" : "") + (proj ? " predicted-match" : ""),
            role: "button", tabindex: "0",
            onclick: () => gotoMatch(m),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gotoMatch(m); }
            },
          },
            h("td", { class: "l" }, m.roundName || ""),
            h("td", null, m.matchNr || "–"),
            h("td", { class: "l" },
              h("span", {
                class: (isClubName(homeName) ? "us " : "") +
                  (proj && proj.home.certain === false ? "predicted" : ""),
              }, homeName),
              " – ",
              h("span", {
                class: (isClubName(awayName) ? "us " : "") +
                  (proj && proj.away.certain === false ? "predicted" : ""),
              }, awayName)),
            h("td", { class: "pts" }, proj ? "Prognos" : (sc || "–")),
            h("td", null, fmtTime.format(new Date(m.start))),
            h("td", null, m.arena || ""));
        }))),
      showAllPlayedButtonCount(hiddenCount, state.recentMatchCount, () => {
        state.showAllPlayedBracket = true; renderContent();
      }));
  }

  function renderPlayoffs(main) {
    if (!hasFilterSelection()) {
      main.append(h("div", { class: "banner" },
        "Välj en eller flera klasser eller lag ovan för att visa slutspel."));
      return;
    }
    const cats = categoriesToShow();
    if (!cats.length) {
      main.append(h("div", { class: "banner" }, "Inga klasser att visa."));
      return;
    }

    // Flera klasser filtrerade fram samtidigt (t.ex. både pojkar och
    // flickor) visades tidigare staplade under varandra — en klassväljare
    // (dropdown, eftersom antalet klasser kan bli stort — till skillnad
    // från A-/B-/C-fliken som alltid är max tre) gör i stället att bara EN
    // klass byggs/visas åt gången, precis som divisionsvalet nedan.
    let selCat = cats[0];
    if (cats.length > 1) {
      selCat = cats.find((c) => c.catId === state.playoffCatTab) || cats[0];
    }

    // Klass-etiketten får ett årtal på slutet så fort mer än innevarande
    // år är inblandat (state.years) — annars kan t.ex. "Damer Elit" 2024
    // och 2025 se ut som samma alternativ i listan.
    const catLabel = (c) => c.catName + (state.years.size ? " · " + (c.edition || cup().edition) : "");
    if (cats.length > 1) {
      main.append(h("div", { class: "row" },
        h("select", {
          class: "select", "aria-label": "Välj klass",
          onchange: (e) => { state.playoffCatTab = +e.target.value; renderContent(); },
        }, cats.map((c) => h("option", {
          value: String(c.catId), ...(c.catId === selCat.catId ? { selected: "" } : {}),
        }, catLabel(c))))));
    }
    let any = false, anyLoading = false;
    const pendingConnectors = []; // {el, div} — träden vars kopplingslinjer ska ritas efter insättning
    const c = selCat;
    ensurePlayoffs(c.catId, c.edition);
    const p = state.playoffs[c.catId];
    if (!p || p.status === "loading") {
      anyLoading = true;
      main.append(h("h2", { class: "day-h" }, catLabel(c)),
        h("p", { class: "muted" }, "Hämtar slutspel …"));
    } else if (p.status === "error" || !p.divisions.length) {
      // inget slutspel ännu — hoppa tyst
    } else {
      any = true;
      main.append(h("h2", { class: "day-h" }, catLabel(c)));

      // Flera slutspelsträd i samma klass (A-/B-/C-Slutspel) visas som
      // flikar i stället för alla staplade ovanpå varandra — bara den
      // valda divisionen byggs (kopplingslinjer, ev. prognos), så växling
      // mellan A/B/C kostar inget förrän man faktiskt klickar dit.
      let selDiv = p.divisions[0];
      const divTabs = p.divisions.length > 1
        ? (() => {
            const curId = state.playoffDivTab[c.catId];
            selDiv = p.divisions.find((d) => d.id === curId) || p.divisions[0];
            return h("div", { class: "seg playoff-div-tabs", role: "tablist", "aria-label": "Slutspelsträd" },
              p.divisions.map((d) => chip(d.name, d.id === selDiv.id, () => {
                state.playoffDivTab[c.catId] = d.id; renderContent();
              })));
          })()
        : null;

      // Träd/Tabell-växlaren och zoomen (samma state.advancedPlayoffTable
      // som inställningens kryssruta, så de två alltid är i synk) delar rad
      // med A-/B-/C-Slutspel-flikarna i stället för att ligga på en egen
      // rad ovanför — en tunn vertikal avdelare (.row-sep, bara när det
      // faktiskt finns flikar att skilja från) visar att de hör till en
      // annan kategori, utan att pressas hela vägen till högerkanten.
      main.append(h("div", { class: "row playoff-tabs-row" }, divTabs, divTabs ? h("span", { class: "row-sep" }) : null,
        h("div", { class: "seg-group" },
          h("div", { class: "seg", role: "group", "aria-label": "Slutspelsvy" },
            chip("Träd", !state.advancedPlayoffTable, () => {
              state.advancedPlayoffTable = false; saveSettings(); renderContent();
            }),
            chip("Tabell", state.advancedPlayoffTable, () => {
              state.advancedPlayoffTable = true; saveSettings(); renderContent();
            })),
          // Zoom är bara meningsfull i trädvyn — tabellen radbryter/scrollar
          // redan naturligt och behöver ingen skalning.
          !state.advancedPlayoffTable ? h("div", { class: "seg bracket-zoom", role: "group", "aria-label": "Zoom" },
            h("button", {
              class: "chip", type: "button", "aria-label": "Zooma ut",
              disabled: state.bracketZoom <= 0.6 ? "" : null,
              onclick: () => { state.bracketZoom = Math.max(0.6, +(state.bracketZoom - 0.2).toFixed(2)); renderContent(); },
            }, "−"),
            h("button", {
              class: "chip", type: "button", title: "Återställ zoom",
              onclick: () => { state.bracketZoom = 1; renderContent(); },
            }, Math.round(state.bracketZoom * 100) + "%"),
            h("button", {
              class: "chip", type: "button", "aria-label": "Zooma in",
              disabled: state.bracketZoom >= 3 ? "" : null,
              onclick: () => { state.bracketZoom = Math.min(3, +(state.bracketZoom + 0.2).toFixed(2)); renderContent(); },
            }, "+")) : null)));

      // Prognosen bygger på ANNU OSPELADE mötens sannolika utgång — inget
      // ett arkiverat (avslutat) år har, och ensureGroupTables() skulle
      // ändå fråga live-API:t om en kategori som inte finns i innevarande
      // tournamentId. Bara meningsfull/möjlig för innevarande upplaga.
      let gd = null;
      if (state.showPlayoffProjection && !c.edition) {
        ensureGroupTables(c.catId);
        const gt = state.groupTables[c.catId];
        if (gt && gt.status === "done") gd = gt;
      }
      const projMap = gd ? buildPlayoffProjection(selDiv, gd) : null;
      if (state.showPlayoffProjection && !c.edition && state.groupTables[c.catId] &&
          state.groupTables[c.catId].status === "loading") {
        main.append(h("p", { class: "muted" }, "Hämtar tabeller för prognosen …"));
      }
      if (state.advancedPlayoffTable) {
        main.append(bracketTableBlock(selDiv, projMap));
      } else {
        const box = bracketBlock(selDiv, projMap);
        main.append(h("div", { class: "bracket-row", style: "zoom:" + state.bracketZoom }, [box]));
        pendingConnectors.push({ el: box, div: selDiv });
      }
    }
    if (!any && !anyLoading) {
      main.append(h("div", { class: "banner" },
        "Inget slutspel publicerat för de valda klasserna ännu."));
    }
    if (pendingConnectors.length) {
      // Måste vänta tills boxarna faktiskt sitter i det levande DOM-trädet
      // (main.append ovan) innan getBoundingClientRect() ger meningsfulla
      // mått — requestAnimationFrame räcker, kräver ingen extra timeout.
      requestAnimationFrame(() => {
        pendingConnectors.forEach(({ el, div }) => drawBracketConnectors(el, div));
      });
    }
  }

  // Greppa-och-dra-panorering i slutspelsträdet: .bracket-box scrollar redan
  // vågrätt (overflow-x:auto) och sidan lodrätt som vanligt, men bara via
  // scrollbar/hjul/touch. En delegerad pointerdown/move/up (satt upp en gång,
  // inte per rendering) ger samma "greppa kartan"-känsla. Bara musen — touch
  // har redan sin egen naturliga scroll/pinch, och att kapa pointermove där
  // skulle bara krocka med den.
  function setupBracketPan() {
    let box = null, dragging = false, moved = false;
    let startX = 0, startY = 0, startScrollLeft = 0, startScrollY = 0;
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const b = e.target.closest(".bracket-box");
      if (!b) return;
      box = b; dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      startScrollLeft = box.scrollLeft; startScrollY = window.scrollY;
    });
    document.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      // Självläkande: släpper man musknappen UTANFÖR webbläsarfönstret
      // (t.ex. drar uppåt förbi fliksraden, eller alt-tabbar mitt i draget)
      // når varken pointerup eller pointercancel någonsin document — dragging
      // skulle annars fastna på true för gott, och VARJE senare musrörelse
      // (på VILKEN flik som helst, detta är en global lyssnare) skulle då
      // fortsätta tvinga scrollpositionen tillbaka till startScrollY-dy och
      // e.preventDefault() — upplevs som att sidan "låst sig" och inte går
      // att scrolla, även långt efter man lämnat slutspelsträdet. e.buttons
      // === 0 (ingen knapp nertryckt) är den tillförlitliga signalen om att
      // en pointerup missades, se window "blur" nedan för ett andra skydd.
      if (e.buttons === 0) { endDrag(); return; }
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        box.classList.add("panning");
        document.documentElement.classList.add("bracket-panning");
      }
      box.scrollLeft = startScrollLeft - dx;
      window.scrollTo(window.scrollX, startScrollY - dy);
      e.preventDefault();
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove("bracket-panning");
      // b: lokal kopia — box nollställs längre ner INNAN setTimeout-callbacken
      // hinner köra, annars kraschar den (box.removeEventListener på null).
      const b = box;
      if (b) {
        b.classList.remove("panning");
        if (moved) {
          // Sväljer klicket efter en drag så matchkortet under muspekaren
          // inte öppnas som om man klickat det.
          const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
          b.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => b.removeEventListener("click", swallow, { capture: true }), 0);
        }
      }
      box = null;
    }
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    // Andra skyddsnätet: tappar webbläsarfönstret fokus mitt i ett drag
    // (alt-tab, klick i ett annat program) utan att musen rört sig igen
    // efteråt hinner e.buttons-kollen ovan aldrig triggas — blur täcker det.
    window.addEventListener("blur", endDrag);
  }

  // --- lägg till cup ----------------------------------------------------------

  function setupAddCup() {
    const dlg = $("#addCupDialog");
    $("#addCupBtn").addEventListener("click", () => {
      renderCustomCupList();
      dlg.showModal();
    });
    $("#addCupForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const host = f.host.value.trim()
        .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const cupDef = {
        id: "custom-" + Date.now(),
        name: f.cupname.value.trim(),
        place: f.place.value.trim() || "–",
        edition: f.edition.value.trim() || "",
        host,
        tournamentId: +f.tid.value.trim(),
        custom: true,
      };
      if (!cupDef.name || !cupDef.host || !cupDef.tournamentId) return;
      const list = HB.customCups();
      list.push(cupDef);
      localStorage.setItem("hb:customCups", JSON.stringify(list));
      f.reset();
      dlg.close();
      switchCup(cupDef.id);
    });
    $("#addCupClose").addEventListener("click", () => dlg.close());
  }

  // Egen, webbläsaroberoende autocomplete — native <datalist> stöds inte
  // tillförlitligt för textfält på Safari/iOS (visar ofta inga förslag
  // alls), så inställningarnas fält bygger sin egen minimala dropdown.
  // getCandidates: () => string[], anropas vid varje input för att alltid
  // spegla den cup som råkar vara laddad just då. minLen (valfri, default 1):
  // hur många tecken som krävs innan förslag visas — Klubbjämförelsens
  // sökruta (se renderClubCompareView) höjer den till 2 så listan (som
  // spänner alla cupers klubbar) inte känns brusig efter bara en bokstav.
  // getCandidates får ge antingen rena strängar eller objekt
  // {label, search, value} — det senare när det som VISAS skiljer sig från
  // det som matchas eller väljs (favoritlagen visar "Alingsås HK 1 (Flickor
  // 2011)", matchar även på "f2011" och lämnar tillbaka {name, cohort}).
  function attachAutocomplete(input, list, getCandidates, onPick, minLen = 1) {
    const hide = () => { list.hidden = true; list.replaceChildren(); };
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < minLen) { hide(); return; }
      const matches = getCandidates()
        .map((c) => (typeof c === "string" ? { label: c, search: c, value: c } : c))
        .filter((c) => (c.search || c.label).toLowerCase().includes(q))
        .slice(0, 8);
      if (!matches.length) { hide(); return; }
      list.hidden = false;
      list.replaceChildren(...matches.map((m) =>
        h("div", {
          class: "autocomplete-item",
          // mousedown (inte click) så den hinner före inputs "blur"-döljning
          onmousedown: (e) => {
            e.preventDefault();
            input.value = typeof m.value === "string" ? m.value : "";
            hide();
            onPick(m.value);
          },
        }, m.label)));
    });
    input.addEventListener("blur", () => setTimeout(hide, 150));
  }

  function setupSettings() {
    const dlg = $("#settingsDialog");

    const clubInput = $("#favoriteClubInput");
    clubInput.value = state.favoriteClub;
    const applyFavoriteClub = () => {
      const v = clubInput.value.trim();
      state.favoriteClub = v || HB.CLUB.name;
      clubInput.value = state.favoriteClub;
      saveSettings();
      render();
    };
    clubInput.addEventListener("change", applyFavoriteClub);
    attachAutocomplete($("#favoriteClubInput"), $("#favoriteClubOptions"),
      clubNameCandidates, applyFavoriteClub);
    $("#favoriteClubClear").addEventListener("click", () => {
      clubInput.value = ""; applyFavoriteClub(); clubInput.focus();
    });

    // Sökfältet LÄGGER TILL i listan i stället för att hålla ett värde —
    // därför töms det efter varje val, och de valda lagen visas som chips
    // under (renderFavoriteTeamList).
    const teamInput = $("#favoriteTeamInput");
    const addFavoriteTeam = (picked) => {
      const name = (typeof picked === "string" ? picked : (picked && picked.name) || "").trim();
      if (!name) { teamInput.value = ""; return; }
      const cohort = typeof picked === "string" ? null : (picked.cohort || null);
      if (favoriteTeamIndex(name, cohort) < 0) state.favoriteTeams.push({ name, cohort });
      teamInput.value = "";
      saveSettings();
      renderFavoriteTeamList();
      render();
    };
    // Fritext (utan att välja ur listan) räknas också — men bara på Enter,
    // annars skulle varje halvskrivet ord bli ett favoritlag.
    teamInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && teamInput.value.trim()) {
        e.preventDefault();
        addFavoriteTeam(teamInput.value.trim());
      }
    });
    attachAutocomplete($("#favoriteTeamInput"), $("#favoriteTeamOptions"),
      favoriteTeamCandidates, addFavoriteTeam);
    $("#favoriteTeamClear").addEventListener("click", () => {
      teamInput.value = ""; teamInput.focus();
    });
    renderFavoriteTeamList();

    const themeBtns = $$("#themeSeg [data-theme-opt]");
    const syncThemeBtns = () => {
      themeBtns.forEach((b) =>
        b.classList.toggle("on", b.dataset.themeOpt === state.theme));
    };
    syncThemeBtns();
    themeBtns.forEach((b) => b.addEventListener("click", () => {
      state.theme = b.dataset.themeOpt;
      saveSettings();
      syncThemeBtns();
    }));

    const colorsBox = $("#teamColorsToggle");
    colorsBox.checked = state.teamColors;
    colorsBox.addEventListener("change", () => {
      state.teamColors = colorsBox.checked;
      saveSettings();
      render();
    });

    const fullCardBox = $("#fullCardColorsToggle");
    fullCardBox.checked = state.fullCardColors;
    fullCardBox.addEventListener("change", () => {
      state.fullCardColors = fullCardBox.checked;
      saveSettings();
      render();
    });

    const advTableBox = $("#advancedPlayoffTableToggle");
    advTableBox.checked = state.advancedPlayoffTable;
    advTableBox.addEventListener("change", () => {
      state.advancedPlayoffTable = advTableBox.checked;
      saveSettings();
      renderContent();
    });

    const projBox = $("#playoffProjectionToggle");
    projBox.checked = state.showPlayoffProjection;
    projBox.addEventListener("change", () => {
      state.showPlayoffProjection = projBox.checked;
      saveSettings();
      renderContent();
    });

    // Egna lagfärger: fritextnamn (slugifierat, cup-oberoende) → hexfärg.
    const renderTeamColorList = () => {
      const box = $("#teamColorList");
      const entries = Object.entries(state.teamColorOverrides);
      box.replaceChildren(...entries.map(([slug, color]) =>
        h("div", { class: "team-color-item" },
          h("span", { class: "team-color-swatch", style: "background:" + color }),
          h("span", { class: "name" }, slug),
          h("button", {
            class: "btn small", type: "button",
            onclick: () => {
              delete state.teamColorOverrides[slug];
              saveSettings(); renderTeamColorList(); render();
            },
          }, "Ta bort"))));
    };
    renderTeamColorList();
    const teamColorNameInput = $("#teamColorNameInput");
    attachAutocomplete(teamColorNameInput, $("#teamColorOptions"), () =>
      [...new Set(state.matches.flatMap((m) =>
        [m.home.name, m.away.name].filter(Boolean)))].sort((a, b) => a.localeCompare(b, "sv")),
      () => {});
    $("#teamColorNameClear").addEventListener("click", () => {
      teamColorNameInput.value = "";
      teamColorNameInput.dispatchEvent(new Event("input", { bubbles: true }));
      teamColorNameInput.focus();
    });
    $("#teamColorAddBtn").addEventListener("click", () => {
      const nameInp = $("#teamColorNameInput");
      const colorInp = $("#teamColorPickerInput");
      const name = nameInp.value.trim();
      if (!name) return;
      state.teamColorOverrides[slugifySv(name)] = colorInp.value;
      nameInp.value = "";
      saveSettings();
      renderTeamColorList();
      render();
    });

    const matchMinInput = $("#matchMinutesInput");
    matchMinInput.value = state.matchMinutes;
    matchMinInput.addEventListener("change", () => {
      state.matchMinutes = Math.max(5, +matchMinInput.value || 30);
      matchMinInput.value = state.matchMinutes;
      saveSettings();
      renderContent();
    });

    const breakInput = $("#breakMinutesInput");
    breakInput.value = state.breakMinutes || "";
    breakInput.addEventListener("change", () => {
      state.breakMinutes = Math.max(0, +breakInput.value || 0);
      breakInput.value = state.breakMinutes || "";
      saveSettings();
      renderContent();
    });

    const revealBatchInput = $("#revealBatchInput");
    revealBatchInput.value = state.revealBatchSize;
    revealBatchInput.addEventListener("change", () => {
      state.revealBatchSize = Math.max(1, +revealBatchInput.value || 4);
      revealBatchInput.value = state.revealBatchSize;
      saveSettings();
      renderContent();
    });

    const recentMatchCountInput = $("#recentMatchCountInput");
    recentMatchCountInput.value = state.recentMatchCount;
    recentMatchCountInput.addEventListener("change", () => {
      state.recentMatchCount = Math.max(1, +recentMatchCountInput.value || 2);
      recentMatchCountInput.value = state.recentMatchCount;
      saveSettings();
      renderContent();
    });

    // advancedPlayoffTable kan numera ändras utanför dialogen (snabbväxlingen
    // i slutspelsvyn) — synka kryssrutan mot state igen varje gång dialogen
    // öppnas, annars kan den visa fel läge efter en sådan ändring.
    const openSettings = () => {
      advTableBox.checked = state.advancedPlayoffTable;
      // Öppna alltid mot INNEVARANDE cups sport, oavsett vilken sport man
      // råkade bläddra i senast dialogen var öppen — annars kan den se ut
      // att "glömt" vilken cup som faktiskt är aktiv.
      cupSwitcherSport = null;
      // Favoritklubb/-lag väljs ur data som inte hör till den öppna cupen
      // (klubbkatalogen och arkivets lagnamnsindex, se clubNameCandidates/
      // favoriteTeamCandidates). Båda hämtas lat och en gång — starta dem
      // här så de finns när man börjar skriva, i stället för att listan ska
      // vara tom just i en cup som inte publicerat sina lag än.
      ensureClubDirectory();
      ensureTeamIndex();
      renderCups();
      dlg.showModal();
    };
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#currentCupBtn").addEventListener("click", openSettings);
    $("#settingsClose").addEventListener("click", () => dlg.close());

    placeFooterLinks();

    // Versionsmärke + nödutgång ur en envis service worker-cache. En
    // installerad PWA (eller bara en registrerad SW) kan servera gammalt
    // skal långt efter en driftsättning, och då syns inga rättningar hur
    // många gånger man än laddar om — utan att det märks att det är
    // orsaken. Knappen river SW:n och HELA dess cache; localStorage rörs
    // INTE, så filter, favoritklubb och övriga inställningar överlever.
    const verEl = $("#appVersion");
    if (verEl) verEl.textContent = "Version " + (HB.VERSION || "okänd");

    // Viewport-siffrorna uppdateras medan dialogen är öppen, så man kan
    // scrolla, se adressfältet ändra sig och läsa av vad webbläsaren
    // faktiskt rapporterar. Utan dem går den här klassen av buggar bara att
    // gissa sig till.
    const resetBtn = $("#resetAppBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = "Tömmer …";
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch { /* inget att tömma — ladda om ändå */ }
        // Cache-bust i URL:en: annars kan webbläsarens EGEN HTTP-cache
        // fortfarande servera samma gamla index.html som nyss låg i SW:n.
        const u = new URL(location.href);
        u.searchParams.set("_v", Date.now().toString(36));
        location.replace(u.toString());
      });
    }
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  function renderCustomCupList() {
    const box = $("#customCupList");
    const list = HB.customCups();
    box.replaceChildren(...list.map((c) =>
      h("div", { class: "custom-cup" },
        h("span", null, c.name + " (" + c.host + ")"),
        h("button", {
          class: "btn small", type: "button",
          onclick: () => {
            localStorage.setItem("hb:customCups",
              JSON.stringify(HB.customCups().filter((x) => x.id !== c.id)));
            if (state.cupId === c.id) state.cupId = HB.CUPS[0].id;
            renderCustomCupList(); renderCups();
          },
        }, "Ta bort"))));
  }

  // --- uppstart ------------------------------------------------------------------

  // Startcup för ett förstabesök: hellre "det som händer nu" än första
  // raden i data/cups.json, vars ordning inte har med kalendern att göra.
  // windows är data/cup-windows.json (byggd av scripts/build_cup_windows.py)
  // — varje cups matchfönster i ms epoch. Väljer i tur och ordning:
  //
  //   1. cup som pågår           — första matchen har startat och sista
  //                                spelades för mindre än ett dygn sedan
  //                                (resultaten kollas ofta dagen efter)
  //   2. annars närmast kommande
  //   3. annars senast spelade
  //
  // Uppskattade fönster ("est") väljs aldrig: en gissad upplaga utan
  // publicerat schema ger en tom app.
  const DEFAULT_CUP_GRACE_MS = 24 * 3600 * 1000;

  function pickDefaultCup(windows) {
    if (!windows || typeof windows !== "object") return null;
    const now = Date.now();
    let ongoing = null, upcoming = null, past = null;
    for (const c of HB.allCups()) {
      const w = windows[c.id];
      if (!w || !w.first) continue;
      if (w.est) continue;
      const last = w.last || w.first;
      if (w.first <= now && now <= last + DEFAULT_CUP_GRACE_MS) {
        // Två cuper kan överlappa (t.ex. Göteborg Cup och Örebrocupen
        // samma helg) — den som startade senast är den mest aktuella.
        if (!ongoing || w.first > ongoing.first) ongoing = { id: c.id, first: w.first };
      } else if (w.first > now) {
        if (!upcoming || w.first < upcoming.first) upcoming = { id: c.id, first: w.first };
      } else if (!past || last > past.last) {
        past = { id: c.id, last };
      }
    }
    return (ongoing || upcoming || past || {}).id || null;
  }

  async function init() {
    // PWA: relativ sökväg (inte "/sw.js") så det funkar under en undermapp,
    // t.ex. GitHub Pages-projektsidor (callesjoberg.github.io/hboll/).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    // Scrolla-till-toppen: syns när man scrollat mer än en skärmhöjd.
    const scrollTopBtn = $("#scrollTopBtn");
    document.addEventListener("scroll", () => {
      scrollTopBtn.classList.toggle("visible", window.scrollY > window.innerHeight);
    }, { passive: true });
    scrollTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto" : "smooth",
      });
    });

    // Länkens cup läses redan här, synkront: då vet vi INNAN cups.json ens
    // hämtats om startcupen behöver väljas åt besökaren, och kan hämta
    // cup-windows.json parallellt i stället för i ett andra varv efteråt.
    // Själva valet sker längre ner — pickDefaultCup behöver den skarpa
    // cuplistan, som inte finns än här.
    const params = new URLSearchParams(location.search);
    const urlCup = params.get("cup");
    const windowsPromise = (urlCup || savedCupId) ? null
      : fetch("data/cup-windows.json?_=" + Date.now().toString(36))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null); // utan filen: första cupen i listan, som förr

    // Skarp cuplista från data/cups.json (redigeras via admin.html);
    // HB.CUPS i config.js är reserv om filen saknas eller är trasig.
    try {
      const r = await fetch("data/cups.json?_=" + Date.now().toString(36));
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.cups) && j.cups.length) HB.CUPS = j.cups;
      }
    } catch { /* kör på reservlistan */ }

    // Djuplänk: ?cup=potatis&view=...&scope=...&days=...&cats=...&teams=...
    // &arena=...&sort=...&mf=...&q=... — hela filtret/sorteringen kan delas,
    // liksom underflikarnas egna val (se syncSubViewUrl för hela listan).
    if (urlCup && HB.allCups().some((c) => c.id === urlCup)) {
      state.cupId = urlCup;
    } else if (windowsPromise) {
      const picked = pickDefaultCup(await windowsPromise);
      if (picked) state.cupId = picked;
    }
    // "Har länken något MER än bara cup?" i stället för en uppräkning av
    // nycklar — listan växer med varje ny underflik, och en bortglömd nyckel
    // hade tyst gjort att just den delen av länken tappades till förmån för
    // det som råkade ligga sparat i webbläsaren. (tune tillhör välkomst-
    // överlägget, se js/welcome.js — inte ett vyval.)
    const hasUrlFilters = [...params.keys()].some((k) => !NON_VIEW_PARAMS.has(k));
    $$("#viewTabs .tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view; saveUi(); render();
      }));
    $("#refreshBtn").addEventListener("click", () => loadCup(true));
    setupAddCup();
    setupSettings();
    setupBracketPan();
    // Välkomstöverlägget (js/welcome.js) visar sig självt en gång för nya
    // besökare — den här knappen (sidfoten) låter vem som helst öppna det
    // igen när de vill. Null-koll (till skillnad från övriga $(...)-anrop
    // här) — en gammal cachad index.html (t.ex. service worker-fallback
    // under en pågående ny driftsättning) som saknar knappen ska aldrig få
    // krascha HELA appens initiering för en så liten sak.
    const welcomeBtn = $("#welcomeReopenBtn");
    if (welcomeBtn) welcomeBtn.addEventListener("click", () => HB.openWelcome());

    // Stäng en öppen lag-dropdown vid klick utanför den. En enda global
    // lyssnare (i stället för en per renderToolbar-anrop) hittar alltid
    // den dropdown som råkar vara monterad just nu. Bakgrundstäckets klick
    // fångas också här: det ligger utanför <details>, så villkoret nedan
    // stänger arket precis som ett klick i matchlistan bakom.
    document.addEventListener("click", (e) => {
      const dd = document.querySelector(".team-picker-dd[open]");
      if (!dd) return;
      // Kryssar man i en post i en LAT lista (>60 val, se
      // PICKER_LAZY_THRESHOLD) bygger change-hanteraren om listan MITT I
      // klickets bubbling — den klickade kryssrutan är då redan borttagen ur
      // DOM:et när den här lyssnaren nås, contains() ger false, och panelen
      // stängdes mitt i ett val. Ett bortkopplat mål betyder att klicket kom
      // inifrån något vi själva just ritat om, alltså inte "utanför".
      if (!e.target.isConnected) return;
      if (!dd.contains(e.target)) dd.open = false;
    });
    setupPickerSheets();
    setupViewportOffset();
    loadUi();
    updateClubLogo();
    if (hasUrlFilters) {
      // En delad länk vinner över det som råkar ligga sparat i webbläsaren.
      applyUrlToState(params);
      saveUi(); // spara den delade vyn som din egen, och normalisera URL:en
    }

    // Bakåt-/framåtknappen: läs tillbaka den strukturella vyn ur URL:en (som
    // syncUrl:s pushState skrev). Nollställ URL-fälten först så inget gammalt
    // filter hänger kvar, och byt cup med cache-nollställning om cupen ändrats.
    window.addEventListener("popstate", () => {
      const pp = new URLSearchParams(location.search);
      const urlCup = pp.get("cup");
      const cupChange = urlCup && urlCup !== state.cupId && HB.allCups().some((c) => c.id === urlCup);
      applyingPopstate = true;
      resetUrlState();
      if (cupChange) {
        state.cupId = urlCup;
        state.tables = {}; state.playoffs = {}; state.groupTables = {}; dialogTableCache = {};
        state.matches = []; state.loadedAt = 0; heroIndex = 0; stashedFilter = null;
        autoScrolledToNow = false; hasSyncedFreshData = false;
        applyUrlToState(pp);
        lastNavSig = navSig();
        loadCup();
      } else {
        applyUrlToState(pp);
        lastNavSig = navSig();
        render();
      }
      applyingPopstate = false;
    });

    navInitialized = true; // härefter pushar strukturella vy-byten en historik-post
    loadCup();

    // Stats-underflikarna Trend/Klubb-Lag/Klubbjämförelse/Cuper behöver
    // arkivindexet för att veta om de ska visas alls (Trend döljs t.ex. om
    // innevarande cup har färre än två arkiverade år) — hämtas en gång,
    // oberoende av loadCup(), samma index.json som ensureArchiveEditions()/
    // Historik redan använder.
    HB.api.fetchArchiveIndex().then((idx) => {
      state.archiveIndex = idx || {};
      renderTabs();
      if (state.view === "stats") render();
    }).catch(() => { state.archiveIndex = {}; renderTabs(); });

    // Auto-uppdatera var tredje minut — men bara cuper som faktiskt pågår.
    const isLiveCup = () => refreshTtl(state.matches) <= 180000;
    setInterval(() => {
      if (document.visibilityState === "visible" && isLiveCup() &&
          Date.now() - state.loadedAt > 170000) loadCup(true);
    }, 180000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isLiveCup() &&
          Date.now() - state.loadedAt > 300000) loadCup(true);
    });
    // Nedräkningen i heron tickar utan full omrendering — för det kort
    // (heroIndex) som just nu visas i karusellen, inte alltid det första.
    setInterval(() => {
      const el = $(".hero-count");
      const matches = nextClubMatches();
      const m = matches[heroIndex] || matches[0];
      if (el && m) el.textContent = countdownText(m.start);
    }, 30000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
