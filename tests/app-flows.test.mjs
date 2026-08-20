import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeMainViewParams, decodeMainViewParams, hasUrlViewParams,
  encodeSubViewParams, decodeSubViewParams, defaultSubViewSnap, applySubViewPatch,
  resolveNamedUrlFilters,
} from "../js/url-state.js";
import {
  hasFilterSelection, hasLockableSelection, isFilterLocked,
} from "../js/filters.js";
import { slugifySv } from "../js/domain/club.js";
import { cohortKey, shortCat } from "../js/domain/category.js";
import {
  schemaSearchFocusValue, captureSchemaSearchFocus, resetSchemaUi, schemaUiSnapshot,
} from "../js/ui/schema.js";
import { resetMatchUi, matchUiSnapshot } from "../js/ui/match-ui.js";
import {
  getStatsUrlFields, applyStatsUrlFields, resetStatsUrlFields,
} from "../js/ui/stats.js";
import {
  splitScheduleWindow, splitRecentPlayedByCount, SCHEMA_UPCOMING_BATCH,
} from "../js/ui/reveal.js";

const NOW = new Date("2026-08-20T12:00:00+02:00");

test("Stats URL-session nollställs till standardvärden", () => {
  resetStatsUrlFields(defaultSubViewSnap(NOW));
  const fields = getStatsUrlFields();
  assert.equal(fields.vinnareMode, "trofe");
  assert.equal(fields.historyMode, "compare");
  assert.equal(fields.kalenderYear, null);
  assert.equal(fields.browse, null);
});

test("Stats URL-session applicerar vinnarläge och kan nollställas", () => {
  const defaults = defaultSubViewSnap(NOW);
  resetStatsUrlFields(defaults);
  applyStatsUrlFields({ vinnareMode: "topp", vinnareToppCup: "ahus" });
  assert.equal(getStatsUrlFields().vinnareMode, "topp");
  assert.equal(getStatsUrlFields().vinnareToppCup, "ahus");
  resetStatsUrlFields(defaults);
  assert.equal(getStatsUrlFields().vinnareMode, "trofe");
  assert.equal(getStatsUrlFields().vinnareToppCup, "");
});

test("tom klubbsökning kan appliceras och Stats-sessionen återställas", () => {
  const defaults = defaultSubViewSnap(NOW);
  assert.doesNotThrow(() => applyStatsUrlFields({ clubQuery: "" }));
  resetStatsUrlFields(defaults);
  assert.deepEqual(getStatsUrlFields(), {
    kalenderYear: defaults.kalenderYear,
    vinnareMode: defaults.vinnareMode,
    vinnareQuery: defaults.vinnareQuery,
    vinnareMedals: defaults.vinnareMedals,
    vinnareCup: defaults.vinnareCup,
    vinnareYear: defaults.vinnareYear,
    vinnareToppCup: defaults.vinnareToppCup,
    vinnareToppMedals: defaults.vinnareToppMedals,
    historyMode: defaults.historyMode,
    browse: defaults.browse,
  });
});

const fixtureMatches = [
  {
    id: 1, catId: 10, catName: "Flickor 12 (födda 2014)", arena: "Hall 1",
    home: { id: 101, name: "Alingsås HK Blå" },
    away: { id: 202, name: "IK Sävehof" },
    res: null,
  },
  {
    id: 2, catId: 11, catName: "P12", arena: "Hall 2",
    home: { id: 103, name: "Alingsås HK 1" },
    away: { id: 204, name: "Kungälvs HK" },
    res: { fin: true, winner: "home", hg: 12, ag: 8 },
  },
];

function classKeys(m) {
  return [
    slugifySv(m.catName), slugifySv(shortCat(m.catName)),
    slugifySv(cohortKey(m.catName) || ""),
  ];
}

test("delad länk: vy, filter och favoritklubb runtreser", () => {
  const view = {
    cupId: "potatis",
    favoriteClub: "IK Sävehof",
    view: "schema",
    scope: "club",
    cats: new Set([10]),
    teams: new Set([101]),
    q: "blå",
  };
  const params = encodeMainViewParams(view, { defaultClubName: "Alingsås HK" });
  encodeSubViewParams(params, { ...defaultSubViewSnap(NOW), view: "schema", schemaSelectionKey: "cat:10" });
  const main = decodeMainViewParams(params);
  const sub = decodeSubViewParams(params);
  assert.equal(params.get("cup"), "potatis");
  assert.equal(main.favoriteClub, "IK Sävehof");
  assert.deepEqual([...main.cats], [10]);
  assert.deepEqual([...main.teams], [101]);
  assert.equal(main.q, "blå");
  assert.equal(sub.schemaSelectionKey, "cat:10");
  assert.equal(hasUrlViewParams(params), true);
});

test("namnbaserad delningslänk slår upp lag och klass mot cupens matcher", () => {
  const params = new URLSearchParams("team=alingsas-hk-bla&klass=f2014");
  const resolved = resolveNamedUrlFilters(fixtureMatches, params, slugifySv, classKeys);
  assert.deepEqual([...resolved.teams], [101]);
  assert.deepEqual([...resolved.cats], [10]);
  const idsWin = new URLSearchParams("teams=101&team=alingsas-hk-bla");
  const skip = resolveNamedUrlFilters(fixtureMatches, idsWin, slugifySv, classKeys);
  assert.equal(skip.teams, null);
});

test("cupbyte nollställer hero, schemasök och dialogcache", () => {
  globalThis.document = { activeElement: { id: "schemaStartSearch", value: "hk blå" } };
  assert.equal(captureSchemaSearchFocus(), true);
  assert.equal(schemaUiSnapshot().searchQuery, "hk blå");
  assert.equal(schemaUiSnapshot().searchDeferred, true);
  resetSchemaUi();
  resetMatchUi();
  const schema = schemaUiSnapshot();
  const match = matchUiSnapshot();
  assert.equal(schema.searchQuery, "");
  assert.equal(schema.searchOpen, false);
  assert.equal(schema.searchDeferred, false);
  assert.equal(schema.autoScrolledToNow, false);
  assert.equal(schema.untimedPanelOpen, true);
  assert.equal(match.heroIndex, 0);
  assert.equal(match.heroDir, 1);
  assert.equal(match.heroLastAnimatedIdx, null);
  assert.equal(match.dialogTables, 0);
  assert.equal(match.heroTimer, null);
});

test("filterlås bara på desktop när det finns något att låsa", () => {
  const lockable = hasLockableSelection({
    days: new Set(["2026-07-18"]), cats: new Set(), teams: new Set(),
    years: new Set(), includeCurrentYear: true,
  });
  assert.equal(lockable, true);
  assert.equal(isFilterLocked({ sheetMode: false, filterLocked: true, lockable: true }), true);
  assert.equal(isFilterLocked({ sheetMode: true, filterLocked: true, lockable: true }), false);
  assert.equal(isFilterLocked({ sheetMode: false, filterLocked: true, lockable: false }), false);
  assert.equal(isFilterLocked({ sheetMode: false, filterLocked: false, lockable: true }), false);
});

test("schema-sök: fokuserat fält ska skjuta upp omritning", () => {
  assert.equal(schemaSearchFocusValue({ id: "schemaStartSearch", value: "blå" }), "blå");
  assert.equal(schemaSearchFocusValue({ id: "schemaStartSearch", value: "" }), "");
  assert.equal(schemaSearchFocusValue({ id: "q", value: "blå" }), null);
  assert.equal(schemaSearchFocusValue(null), null);
  globalThis.document = { activeElement: { id: "other", value: "x" } };
  assert.equal(captureSchemaSearchFocus(), false);
});

test("tabeller och slutspel kräver klass, lag, plan eller sök — inte bara dag", () => {
  assert.equal(hasFilterSelection({
    cats: new Set(), teams: new Set(), arena: "", q: "",
  }), false);
  assert.equal(hasLockableSelection({
    days: new Set(["2026-07-18"]), cats: new Set(), teams: new Set(),
    years: new Set(), includeCurrentYear: true,
  }), true);
  assert.equal(hasFilterSelection({
    cats: new Set([10]), teams: new Set(), arena: "", q: "",
  }), true);
  assert.equal(hasFilterSelection({
    cats: new Set(), teams: new Set([101]), arena: "", q: "",
  }), true);
  assert.equal(hasFilterSelection({
    cats: new Set(), teams: new Set(), arena: "Hall 1", q: "",
  }), true);
  assert.equal(hasFilterSelection({
    cats: new Set(), teams: new Set(), arena: "", q: "blå",
  }), true);
});

test("bakåt: psort, club och vm nollställs innan ny URL läses in", () => {
  const dirty = applySubViewPatch(defaultSubViewSnap(NOW), {
    view: "stats",
    statsView: "vinnare",
    vinnareMode: "topp",
    vinnareToppCup: "ahus",
    clubQuery: "Sävehof",
    bracketSort: { col: "lag", dir: -1 },
    playoffTimeOrder: "desc",
  });
  const vinnareUrl = encodeSubViewParams(new URLSearchParams(), {
    ...dirty, view: "stats", statsView: "vinnare",
  });
  assert.equal(vinnareUrl.get("vm"), "topp");
  assert.equal(vinnareUrl.get("vtcup"), "ahus");
  assert.equal(vinnareUrl.get("psort"), null, "schema/stats-länk ska inte bära slutspelssortering");

  const klubbUrl = encodeSubViewParams(new URLSearchParams(), {
    ...defaultSubViewSnap(NOW), view: "stats", statsView: "klubb", clubQuery: "Sävehof",
  });
  assert.equal(klubbUrl.get("club"), "Sävehof");

  const playoffUrl = encodeSubViewParams(new URLSearchParams(), {
    ...defaultSubViewSnap(NOW), view: "slutspel",
    bracketSort: { col: "lag", dir: -1 }, playoffTimeOrder: "asc",
  });
  assert.equal(playoffUrl.get("psort"), "lag");
  assert.equal(playoffUrl.get("pdir"), "desc");

  let snap = applySubViewPatch(defaultSubViewSnap(NOW), decodeSubViewParams(vinnareUrl));
  assert.equal(snap.vinnareMode, "topp");
  const leaked = applySubViewPatch(snap, decodeSubViewParams(klubbUrl));
  assert.equal(leaked.vinnareMode, "topp", "utan nollställning hänger vm kvar på en klubb-URL");
  snap = applySubViewPatch(defaultSubViewSnap(NOW), decodeSubViewParams(klubbUrl));
  assert.equal(snap.vinnareMode, "trofe");
  assert.equal(snap.clubQuery, "Sävehof");
  snap = applySubViewPatch(defaultSubViewSnap(NOW), decodeSubViewParams(playoffUrl));
  assert.equal(snap.clubQuery, "");
  assert.equal(snap.bracketSort.col, "lag");
  assert.equal(snap.bracketSort.dir, -1);
});

test("tom klubbsökning i URL ska överleva (medvetet tömd ruta)", () => {
  const params = encodeSubViewParams(new URLSearchParams(), {
    ...defaultSubViewSnap(NOW), view: "stats", statsView: "klubb", clubQuery: "",
  });
  assert.equal(params.has("club"), true);
  assert.equal(params.get("club"), "");
  const back = decodeSubViewParams(params);
  assert.equal(back.clubQuery, "");
  assert.equal("clubQuery" in back, true);
});

function matchAt(id, start, extra = {}) {
  return { id, start, arena: "A", home: { id: 1, name: "H" }, away: { id: 2, name: "B" }, ...extra };
}

test("schemafönster: senast spelade plus nästa 20, inte hela Åhus-dagen", () => {
  const finished = Array.from({ length: 10 }, (_, i) =>
    matchAt(i, 1000 + i, { res: { fin: true } }));
  const upcoming = Array.from({ length: 50 }, (_, i) => matchAt(100 + i, 2000 + i));
  const { visible, hiddenPast, hiddenFuture } = splitScheduleWindow(
    [...finished, ...upcoming],
    { recentCount: 2, olderExtra: 0, upcomingCount: SCHEMA_UPCOMING_BATCH, newerExtra: 0 },
  );
  assert.equal(hiddenPast, 8);
  assert.equal(hiddenFuture, 30);
  assert.equal(visible.filter((m) => m.res && m.res.fin).length, 2);
  assert.equal(visible.filter((m) => !(m.res && m.res.fin)).length, 20);
  const more = splitScheduleWindow([...finished, ...upcoming], {
    recentCount: 2, olderExtra: 0, upcomingCount: SCHEMA_UPCOMING_BATCH, newerExtra: 20,
  });
  assert.equal(more.hiddenFuture, 10);
  assert.equal(more.visible.filter((m) => !(m.res && m.res.fin)).length, 40);
});

test("schemafönster: live och otidsatta räknas inte mot kommande-taket", () => {
  const upcoming = Array.from({ length: 25 }, (_, i) => matchAt(i, 2000 + i));
  const live = matchAt(99, 1500, { res: { live: true } });
  const untimed = matchAt(98, 0);
  const { visible, hiddenFuture } = splitScheduleWindow(
    [...upcoming, live, untimed],
    { recentCount: 2, olderExtra: 0, upcomingCount: 20, newerExtra: 0 },
  );
  assert.equal(visible.some((m) => m.id === 99), true);
  assert.equal(visible.some((m) => m.id === 98), true);
  assert.equal(hiddenFuture, 5);
  assert.equal(visible.length, 22);
});

test("Bana/slutspel: splitRecentPlayedByCount visar fortfarande alla kommande", () => {
  const upcoming = Array.from({ length: 50 }, (_, i) => matchAt(i, 2000 + i));
  const { visible, hiddenCount } = splitRecentPlayedByCount(upcoming, 2, 0);
  assert.equal(hiddenCount, 0);
  assert.equal(visible.length, 50);
});
