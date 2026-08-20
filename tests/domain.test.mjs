import assert from "node:assert/strict";
import { test } from "node:test";

import { dayKey, hasScheduledStart, matchTimeLabel } from "../js/time.js";
import {
  parseCat, parseCohort, cohortKey, cohortLabel, shortCat, catSortKey,
} from "../js/domain/category.js";
import {
  slugifySv, slugifyTeamId, clubPatternFromName, isClubName,
  detectTeamColor, isFavoriteTeam, favoriteTeamIndex,
} from "../js/domain/club.js";
import {
  isLive, scoreText, clubOutcomeLetter, totalGoals,
  referenceSide, hasReference, outcomeLetter, outcomeRank,
} from "../js/domain/match.js";
import { computeGroupTableRows } from "../js/domain/tables.js";
import { pickDefaultCup } from "../js/domain/cup.js";
import { isPlaceholderTeam } from "../js/domain/placeholder.js";
import { COUNTRY_CENTROIDS, COUNTRY_NAME_WORDS } from "../js/domain/countries.js";
import {
  matchClubName, clubGeoFromMatches, allClubNamesFromMatches,
  clubCountryFromMatches, teamsAndClassesFromMatches, normalizeForPrefix,
} from "../js/domain/club-match.js";
import { clubInitials, clubBadgeColor, clubBadgeDataUri, escapeXml } from "../js/domain/club-badge.js";
import { calendarSubscribeUrl, calendarWebcalUrl } from "../js/domain/calendar.js";
import { refreshTtl, allMatchesFinished } from "../js/domain/refresh.js";
import {
  summarizeArchiveMatches, archiveStats, sortArchiveRows,
  groupPlayoffDivisionsById, historicalPlayoffDivisions, historicalGroupTables,
  groupArchiveByDay, archiveClassOptions,
} from "../js/domain/archive.js";
import {
  isGroupComplete, possibleGroupCandidates, groupProgress,
  resolvePlaceholderTeam, playoffWinnerSide, playoffExplicitPlaces,
  playoffRoundDepth, playoffPlacementRows, groupPlayoffRounds,
  playoffGroupReference, buildPlayoffProjection,
} from "../js/domain/playoff.js";
import {
  matchesBooleanQuery, matchesSearchQuery, matchPassesFilters, hasFilterSelection,
} from "../js/filters.js";
import {
  encodeMainViewParams, decodeMainViewParams, hasUrlViewParams, toId, NAME_SEP,
} from "../js/url-state.js";
import { chrome, CURRENT_VIEWS } from "../js/ui/chrome.js";

function match(overrides = {}) {
  return {
    id: 1, start: Date.UTC(2026, 6, 18, 10, 0, 0), catId: 10, catName: "F12",
    divName: "Grupp A", roundName: "", arena: "Hall 1",
    home: { id: 1, name: "Alingsås HK Blå" },
    away: { id: 2, name: "IK Sävehof" },
    res: null,
    ...overrides,
  };
}

test("parseCat läser F/P/U och utskrivna kön", () => {
  assert.deepEqual(parseCat("F12"), { g: "F", age: 12 });
  assert.deepEqual(parseCat("P 12"), { g: "P", age: 12 });
  assert.deepEqual(parseCat("F-14 (f 2012) Lätt"), { g: "F", age: 14 });
  assert.deepEqual(parseCat("Flickor 12 år Classic (födda 2014)"), { g: "F", age: 12 });
  assert.deepEqual(parseCat("U12"), { g: "U", age: 12 });
  assert.deepEqual(parseCat("Damer"), { g: "D", age: 0 });
  assert.equal(parseCat("Para Gul"), null);
});

test("parseCohort täcker de fyra skrivsätten i skarp data", () => {
  assert.deepEqual(parseCohort("Flickor 13 (födda 2012)"), { g: "F", born: 2012 });
  assert.deepEqual(parseCohort("Boys 11 (boys born 2014)"), { g: "P", born: 2014 });
  assert.deepEqual(parseCohort("Flickor 10 år (f 2015)"), { g: "F", born: 2015 });
  assert.deepEqual(parseCohort("F10(2014)"), { g: "F", born: 2014 });
  assert.equal(parseCohort("F09"), null);
  assert.equal(parseCohort("Para Gul"), null);
  assert.equal(cohortKey("Flickor 13 (födda 2012)"), "F2012");
  assert.equal(cohortLabel("Flickor 13 (födda 2012)"), "Flickor 2012");
});

test("shortCat och catSortKey", () => {
  assert.equal(shortCat("Flickor 12 år Classic"), "F12");
  assert.equal(shortCat("Para Gul"), "Para Gul");
  assert.ok(catSortKey("F10") < catSortKey("F12"));
  assert.ok(catSortKey("F12") < catSortKey("P12"));
  assert.equal(catSortKey("Okänd klass"), 9999);
});

test("dayKey följer svensk kalenderdag, inte UTC", () => {
  assert.equal(hasScheduledStart(0), false);
  assert.equal(hasScheduledStart({ start: 0 }), false);
  assert.equal(matchTimeLabel({ start: 0 }), "Tid ej satt");
  // 2026-07-18 00:30 i Stockholm = 2026-07-17 22:30 UTC
  const afterMidnightCest = Date.UTC(2026, 6, 17, 22, 30, 0);
  assert.equal(dayKey(afterMidnightCest), "2026-07-18");
  const beforeMidnight = Date.UTC(2026, 6, 17, 21, 30, 0);
  assert.equal(dayKey(beforeMidnight), "2026-07-17");
});

test("klubbmönster är tolerant mot å/ä/ö och mellanrum", () => {
  const p = clubPatternFromName("Alingsås HK");
  assert.equal(isClubName("Alingsås HK Blå", p), true);
  assert.equal(isClubName("Alingsas HK", p), true);
  assert.equal(isClubName("alingsås  hk 1", p), true);
  assert.equal(isClubName("IK Sävehof", p), false);
  assert.equal(detectTeamColor("Alingsås HK Blå"), "#1f5fbf");
  assert.equal(detectTeamColor("Lödde Vikings HK Svart/Röd"), "#23303a");
  assert.equal(slugifyTeamId("Åhus 1"), "ahus-1");
  assert.equal(slugifySv("Alingsås HK 1"), "alingsas-hk-1");
});

test("favoritlag kräver exakt årskull när den är satt", () => {
  const favs = [{ name: "Alingsås HK 1", cohort: "F2010" }];
  assert.equal(isFavoriteTeam("Alingsås HK 1", "Flickor 13 (födda 2010)", favs), true);
  assert.equal(isFavoriteTeam("Alingsås HK 1", "Herrjunior (födda 07-09)", favs), false);
  assert.equal(isFavoriteTeam("Alingsås HK 1", "P16 (födda 2010)", favs), false);
  const legacy = [{ name: "Alingsås HK 1", cohort: null }];
  assert.equal(isFavoriteTeam("Alingsås HK 1", "Herrjunior (födda 07-09)", legacy), true);
  assert.equal(favoriteTeamIndex("Alingsås HK 1", "F2010", favs), 0);
  assert.equal(favoriteTeamIndex("Alingsås HK 1", "P2010", favs), -1);
});

test("scoreText, live, V/O/F och målsumma", () => {
  assert.equal(scoreText(null), null);
  assert.equal(scoreText({ fin: true, hg: 12, ag: 8 }), "12–8");
  assert.equal(scoreText({ fin: true, wo: true }), "WO");
  assert.equal(scoreText({ fin: true, hidden: true }), "spelad");
  assert.equal(scoreText({ fin: true }), "spelad");
  const now = Date.UTC(2026, 6, 18, 10, 15, 0);
  const live = match({ start: now, res: { live: true, fin: false, hg: 1, ag: 0 } });
  assert.equal(isLive(live, now), true);
  assert.equal(isLive({ ...live, res: { live: true, fin: true, hg: 1, ag: 0 } }, now), false);
  const finished = match({
    res: { fin: true, winner: "home", hg: 10, ag: 8 },
  });
  assert.equal(clubOutcomeLetter(finished, 1), "V");
  assert.equal(clubOutcomeLetter(finished, 2), "F");
  assert.equal(totalGoals(finished), 18);
  assert.equal(totalGoals(match({ res: { fin: true, wo: true } })), -1);
});

test("grupptabell: handboll 2 p, fotboll 3 p, basket förlust ger 1", () => {
  const games = [
    match({
      home: { id: 1, name: "A" }, away: { id: 2, name: "B" },
      res: { fin: true, winner: "home", hg: 20, ag: 10 },
    }),
    match({
      id: 2, home: { id: 1, name: "A" }, away: { id: 3, name: "C" },
      res: { fin: true, winner: null, hg: 12, ag: 12 },
    }),
  ];
  const handball = computeGroupTableRows(games, "handboll");
  assert.equal(handball[0].name, "A");
  assert.equal(handball[0].points, 3); // 2 för vinst + 1 för oavgjort
  const football = computeGroupTableRows(games, "fotboll");
  assert.equal(football[0].points, 4); // 3 + 1
  const basketLoss = computeGroupTableRows([
    match({
      home: { id: 1, name: "A" }, away: { id: 2, name: "B" },
      res: { fin: true, winner: "home", hg: 80, ag: 70 },
    }),
  ], "basket");
  const b = basketLoss.find((r) => r.name === "B");
  assert.equal(b.points, 1);
});

test("pickDefaultCup föredrar pågående, hoppar över est", () => {
  const cups = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const now = 1_000_000;
  assert.equal(pickDefaultCup(cups, {
    a: { first: now - 1000, last: now + 1000 },
    b: { first: now + 10_000, last: now + 20_000 },
  }, now), "a");
  assert.equal(pickDefaultCup(cups, {
    a: { first: now - 1000, last: now + 1000, est: true },
    b: { first: now + 60_000, last: now + 120_000 },
  }, now), "b");
  assert.equal(pickDefaultCup(cups, null, now), null);
});

test("boolesk sökning: & är OCH, / och komma är ELLER", () => {
  assert.equal(matchesBooleanQuery("alingsås hk blå f2011", "2011&flickor"), false);
  assert.equal(matchesBooleanQuery("alingsås hk blå flickor 2011", "2011&flickor"), true);
  assert.equal(matchesBooleanQuery("alingsås hk blå f2011", "2011/savehof"), true);
  assert.equal(matchesBooleanQuery("ik sävehof", "2011/sävehof"), true);
  assert.equal(matchesBooleanQuery("ik sävehof", "2011/savehof"), false);
  assert.equal(matchesBooleanQuery("hall 1", ""), true);
});

test("matchPassesFilters: dag, klass, lag, plan, status, sök", () => {
  const m = match({
    start: Date.UTC(2026, 6, 18, 10, 0, 0),
    res: { fin: true, winner: "home", hg: 1, ag: 0 },
  });
  const day = dayKey(m.start);
  assert.equal(matchPassesFilters(m, { days: new Set([day]) }), true);
  assert.equal(matchPassesFilters(m, { days: new Set(["1999-01-01"]) }), false);
  assert.equal(matchPassesFilters(m, { cats: new Set([10]) }), true);
  assert.equal(matchPassesFilters(m, { cats: new Set([99]) }), false);
  assert.equal(matchPassesFilters(m, { teams: new Set([2]) }), true);
  assert.equal(matchPassesFilters(m, { teams: new Set([9]) }), false);
  assert.equal(matchPassesFilters(m, { arena: "Hall 1" }), true);
  assert.equal(matchPassesFilters(m, { arena: "Hall 2" }), false);
  assert.equal(matchPassesFilters(m, { matchFilter: "played" }), true);
  assert.equal(matchPassesFilters(m, { matchFilter: "upcoming" }), false);
  assert.equal(matchesSearchQuery(m, "alingsås"), true);
  assert.equal(matchesSearchQuery(m, "göteborg"), false);
  assert.equal(hasFilterSelection({ cats: new Set(), teams: new Set(), arena: "", q: "" }), false);
  assert.equal(hasFilterSelection({ cats: new Set([10]), teams: new Set(), arena: "", q: "" }), true);
  assert.equal(hasFilterSelection({ cats: new Set(), teams: new Set(), arena: "Hall 1", q: "" }), true);
});

test("URL-huvudfilter rundresa: encode → decode", () => {
  const view = {
    cupId: "potatis",
    favoriteClub: "IK Sävehof",
    view: "tabeller",
    scope: "all",
    days: new Set(["2026-07-18"]),
    cats: new Set([12, 15]),
    teams: new Set([1001]),
    years: new Set(["2024"]),
    includeCurrentYear: false,
    arena: "Heden 3",
    sort: "klass",
    timeOrder: "desc",
    matchFilter: "upcoming",
    q: "blå",
  };
  const params = encodeMainViewParams(view, { defaultClubName: "Alingsås HK" });
  const back = decodeMainViewParams(params);
  assert.equal(params.get("cup"), "potatis");
  assert.equal(back.favoriteClub, "IK Sävehof");
  assert.equal(back.view, "tabeller");
  assert.equal(back.scope, "all");
  assert.deepEqual([...back.days], ["2026-07-18"]);
  assert.deepEqual([...back.cats], [12, 15]);
  assert.equal(typeof [...back.cats][0], "number");
  assert.deepEqual([...back.teams], [1001]);
  assert.deepEqual([...back.years], ["2024"]);
  assert.equal(back.includeCurrentYear, false);
  assert.equal(back.arena, "Heden 3");
  assert.equal(back.sort, "klass");
  assert.equal(back.timeOrder, "desc");
  assert.equal(back.matchFilter, "upcoming");
  assert.equal(back.q, "blå");
  assert.equal(hasUrlViewParams(params), true);
  assert.equal(hasUrlViewParams(new URLSearchParams("cup=potatis")), false);
  assert.equal(toId("12"), 12);
  assert.equal(toId("F12"), "F12");
  assert.equal(NAME_SEP, "~");
});

test("förvald klubb skrivs inte ut i URL", () => {
  const params = encodeMainViewParams({
    cupId: "ahus", favoriteClub: "Alingsås HK", view: "schema",
  }, { defaultClubName: "Alingsås HK", hasChosenClub: false });
  assert.equal(params.get("fav"), null);
  assert.equal(params.get("view"), null);
});

test("chrome-flaggor startar i schema/aktuellt, inte inställningar", () => {
  assert.deepEqual(CURRENT_VIEWS, ["schema", "tabeller", "slutspel", "bana"]);
  assert.equal(chrome.settingsViewOpen, false);
  assert.equal(chrome.currentMenuOpen, true);
  assert.equal(chrome.lastCurrentView, "schema");
});

test("resultatbokstav följer valt lag eller klubbmönster", () => {
  const finished = match({
    res: { fin: true, winner: "home", hg: 10, ag: 8 },
  });
  const isClub = (name) => name.startsWith("Alingsås");
  assert.equal(referenceSide(finished, { isClubName: isClub }), "home");
  assert.equal(outcomeLetter(finished, { isClubName: isClub }), "V");
  assert.equal(outcomeLetter(finished, { selectedTeamId: 2 }), "F");
  assert.equal(hasReference(finished, { selectedTeamId: 9 }), false);
  assert.equal(outcomeRank(finished, { isClubName: isClub }), 0);
  assert.equal(outcomeRank(match({ res: null })), 3);
});

test("platshållarlag i ospelat slutspel", () => {
  assert.equal(isPlaceholderTeam({ name: "Vinn. 12" }), true);
  assert.equal(isPlaceholderTeam({ name: "Förl. 1/4 Final - 2" }), true);
  assert.equal(isPlaceholderTeam({ name: "1:an i Grupp A" }), true);
  assert.equal(isPlaceholderTeam({ name: "10:e bästa 3:an" }), true);
  assert.equal(isPlaceholderTeam({ name: "Plats 5 i 6" }), true);
  assert.equal(isPlaceholderTeam({ name: "Alingsås HK Blå" }), false);
  assert.equal(isPlaceholderTeam({ name: "" }), true);
});

test("klubbnamn matchas i tre nivåer utan att blanda sporter", () => {
  const directory = {
    "Kungälvs HK": { lat: 57.87, lng: 11.98, city: "Kungälv" },
    "Kungälvs FF": { lat: 57.87, lng: 11.99, city: "Kungälv" },
    "Karlskrona Handboll": { lat: 56.16, lng: 15.59, city: "Karlskrona" },
    "HF Karlskrona": { lat: 56.16, lng: 15.59, city: "Karlskrona" },
    "Vallentuna HK": { lat: 59.53, lng: 18.08, city: "Vallentuna" },
    "Vallentuna Fotboll": { lat: 59.53, lng: 18.20, city: "Vallentuna" },
    "Alingsås HK": { lat: 57.93, lng: 12.53, city: "Alingsås" },
    "Lugi HF": { lat: 55.70, lng: 13.19, city: "Lund" },
    "IK Sävehof": { lat: 57.72, lng: 12.04, city: "Partille" },
    "Croatia BK": { lat: 45.8, lng: 16.0, city: "Zagreb" },
  };
  assert.equal(matchClubName("Kungälvs HK", directory), "Kungälvs HK");
  assert.equal(matchClubName("Kungälvs HK Röd", directory), "Kungälvs HK");
  assert.equal(matchClubName("KUNGÄLVS HK 1", directory), "Kungälvs HK");
  assert.notEqual(matchClubName("Kungälvs HK Röd", directory), "Kungälvs FF");
  assert.equal(matchClubName("LUGI HF 1", directory), "Lugi HF");
  assert.equal(matchClubName("Alingsås HK Blå", directory), "Alingsås HK");
  assert.equal(matchClubName("HF Karlskrona", directory), "HF Karlskrona");
  assert.equal(matchClubName("Karlskrona Handboll", directory), "Karlskrona Handboll");
  assert.equal(matchClubName("Vallentuna HK 1", directory), "Vallentuna HK");
  assert.equal(matchClubName("Vallentuna Fotboll", directory), "Vallentuna Fotboll");
  assert.equal(matchClubName("Croatia", directory), null);
  assert.equal(normalizeForPrefix("Kungälvs HK Röd"), "kungälv hk röd");

  const games = [
    match({ home: { id: 1, name: "Alingsås HK Blå" }, away: { id: 2, name: "1:an i Grupp A" } }),
    match({
      home: { id: 3, name: "Kungälvs HK Röd", club: "Kungälvs HK", country: "SE" },
      away: { id: 4, name: "Lugi HF 1", club: "Lugi HF", country: "SE" },
    }),
  ];
  const geo = clubGeoFromMatches(games, directory);
  assert.ok(geo["Alingsås HK"]);
  assert.ok(geo["Kungälvs HK"]);
  assert.equal(geo["1:an i Grupp A"], undefined);
  assert.equal(allClubNamesFromMatches(games, directory).has("Alingsås HK"), true);
  assert.equal(clubCountryFromMatches(games, directory).get("Kungälvs HK"), "SE");
  const counts = teamsAndClassesFromMatches(games);
  assert.equal(counts.teamCount, 3); // platshållaren räknas inte
  assert.equal(counts.classes.size, 1);
});

test("landskoder har centroid och visningsnamn", () => {
  assert.ok(COUNTRY_CENTROIDS.SE);
  assert.equal(COUNTRY_CENTROIDS.SE.length, 2);
  assert.equal(COUNTRY_NAME_WORDS.has("sweden"), true);
  assert.equal(COUNTRY_NAME_WORDS.has("sverige"), true);
  assert.equal(COUNTRY_NAME_WORDS.has("croatia"), true);
});

test("klubbbadge: initialer, färgord och XML-escape", () => {
  assert.equal(clubInitials("Alingsås HK"), "AHK");
  assert.equal(clubInitials("IFK Kristianstad"), "IK");
  assert.equal(clubInitials("Lugi HF"), "LHF");
  assert.equal(clubInitials(""), "?");
  assert.equal(clubBadgeColor("Alingsås HK Blå"), "#1f5fbf");
  assert.equal(escapeXml('a<b>"c"'), "a&lt;b&gt;&quot;c&quot;");
  assert.match(clubBadgeDataUri("Alingsås HK"), /^data:image\/svg\+xml/);
});

test("kalender-URL: livetjänst, statisk ics, webcal", () => {
  const team = { id: "42", name: "Alingsås HK Blå" };
  assert.equal(
    calendarSubscribeUrl(team, { calendarHost: "cm.example" }, false),
    "https://cm.example/service/GetTeamCalendarService?teamId=42",
  );
  assert.equal(
    calendarSubscribeUrl(team, { host: "live.example" }, false),
    "https://live.example/service/GetTeamCalendarService?teamId=42",
  );
  assert.equal(
    calendarSubscribeUrl(team, { id: "potatis", dataUrl: "data/potatis.json" }, true),
    "data/ics/potatis/42.ics",
  );
  assert.equal(
    calendarSubscribeUrl(team, { id: "potatis", dataUrl: "data/potatis.json" }, false),
    null,
  );
  assert.equal(
    calendarWebcalUrl("https://cm.example/cal", "https://app.example/"),
    "webcal://cm.example/cal",
  );
  assert.equal(
    calendarWebcalUrl("data/ics/potatis/42.ics", "https://app.example/"),
    "webcal://app.example/data/ics/potatis/42.ics",
  );
});

test("refreshTtl skiljer pågående, framtida och avslutade cuper", () => {
  const now = Date.UTC(2026, 6, 18, 12, 0, 0);
  assert.equal(refreshTtl([], now), 0);
  assert.equal(refreshTtl([match({ start: 0 })], now), 60000);
  const hour = 3600000;
  assert.equal(refreshTtl([match({ start: now })], now), 10 * 60000);
  assert.equal(refreshTtl([match({ start: now + 48 * hour })], now), 30 * 60000);
  assert.equal(refreshTtl([match({ start: now - 2 * 24 * hour })], now), 24 * hour);
  assert.equal(refreshTtl([match({ start: now - 30 * 24 * hour })], now), 7 * 24 * hour);
  assert.equal(allMatchesFinished([]), false);
  assert.equal(allMatchesFinished([match({ res: { fin: true } })]), true);
  assert.equal(allMatchesFinished([match({ res: { fin: false } })]), false);
});

test("arkivrader, statistik och gruppering", () => {
  const games = [
    match({
      start: Date.UTC(2025, 6, 18, 10, 0, 0),
      home: { id: 1, name: "Alingsås HK Blå" },
      away: { id: 2, name: "IK Sävehof" },
      res: { fin: true, winner: "home", hg: 20, ag: 10 },
      divId: 7, divName: "A-Slutspel", divType: "Playoff",
    }),
    match({
      id: 2, start: Date.UTC(2025, 6, 19, 10, 0, 0),
      home: { id: 2, name: "IK Sävehof" },
      away: { id: 1, name: "Alingsås HK Blå" },
      res: { fin: true, winner: "home", hg: 12, ag: 8 },
      divId: 3, divName: "Grupp A", divType: "Conference",
    }),
  ];
  const rows = summarizeArchiveMatches(games, "Alingsås");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].outcome, "V");
  assert.equal(rows[1].outcome, "F");
  assert.equal(rows[0].opponent, "IK Sävehof");
  const stats = archiveStats(rows);
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1);
  assert.equal(stats.lost, 1);
  assert.equal(stats.gf, 28);
  assert.equal(stats.ga, 22);
  const byResult = sortArchiveRows(rows, "resultat");
  assert.equal(byResult[0].outcome, "V");
  assert.equal(groupArchiveByDay(games).length, 2);
  assert.deepEqual(archiveClassOptions(games), ["F12"]);
  assert.equal(groupPlayoffDivisionsById(games).length, 2);
  assert.equal(historicalPlayoffDivisions(games, "F12").length, 1);
  const tables = historicalGroupTables(games, "F12", "handboll");
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows[0].points, 2);
});

test("slutspelsprognos: gruppklar, kandidater och platshållare", () => {
  const row = (id, name, played, points, gf = 10, ga = 5) => ({
    teamId: id, name, played, points, gf, ga, won: 0, tied: 0, lost: 0,
  });
  const complete = [row(1, "A", 2, 4), row(2, "B", 2, 2), row(3, "C", 2, 0)];
  assert.equal(isGroupComplete(complete), true);
  assert.equal(groupProgress(complete), 1);
  assert.equal(possibleGroupCandidates(complete, 1)[0].name, "A");

  const open = [row(1, "A", 0, 0), row(2, "B", 0, 0), row(3, "C", 0, 0)];
  assert.equal(isGroupComplete(open), false);
  assert.equal(possibleGroupCandidates(open, 1).length, 3);

  const gd = { byGroupNum: { a: complete } };
  const resolved = resolvePlaceholderTeam("1:an i Grupp A", gd, new Map(), "handboll");
  assert.equal(resolved.name, "A");
  assert.equal(resolved.certain, true);

  assert.equal(playoffWinnerSide({ res: { fin: true, winner: "away" } }), "away");
  assert.equal(playoffWinnerSide({ res: { fin: true, hg: 12, ag: 8 } }), "home");
  assert.deepEqual(playoffExplicitPlaces({ roundName: "Final" }), [1, 2]);
  assert.deepEqual(playoffExplicitPlaces({ roundName: "Bronsmatch" }), [3, 4]);
  assert.deepEqual(playoffExplicitPlaces({ roundName: "Placering 5-6" }), [5, 6]);
  assert.equal(playoffRoundDepth({ roundRank: 0 }), 0);
  assert.equal(playoffRoundDepth({ roundName: "Semifinal" }), 1);
  assert.deepEqual(playoffGroupReference("2:an i Grupp C"), {
    rank: 2, token: "c", label: "Grupp C",
  });

  const div = {
    matches: [{
      id: 10, roundRank: 0, matchRank: 1, roundName: "Final",
      home: { id: 1, name: "Alingsås HK" },
      away: { id: 2, name: "IK Sävehof" },
      res: { fin: true, winner: "home", hg: 20, ag: 18 },
    }],
  };
  const places = playoffPlacementRows(div);
  assert.equal(places.rows[0].place, 1);
  assert.equal(places.rows[1].place, 2);
  assert.equal(groupPlayoffRounds(div).length, 1);

  const unfinished = {
    matches: [{
      id: 11, roundRank: 1, matchRank: 1, roundName: "Semifinal",
      home: { id: null, name: "1:an i Grupp A" },
      away: { id: 2, name: "IK Sävehof" },
      res: null, nextWinnerId: null,
    }],
  };
  const proj = buildPlayoffProjection(unfinished, gd, "handboll");
  assert.equal(proj.get(11).home.name, "A");
  assert.equal(proj.get(11).home.certain, true);
});
