/* url-state.js — den delbara vyns huvudfilter, utan DOM/history. */

export const NAME_SEP = "~";
export const NON_VIEW_PARAMS = new Set(["cup", "tune", "_v"]);
export const toId = (s) => (/^\d+$/.test(s) ? +s : s);

export const MAIN_VIEW_DEFAULTS = {
  view: "schema",
  statsView: "trend",
  scope: "club",
  sort: "tid",
  timeOrder: "asc",
  matchFilter: "all",
  includeCurrentYear: true,
};

export function encodeMainViewParams(view, { defaultClubName = "", hasChosenClub = false } = {}) {
  const p = new URLSearchParams();
  if (view.cupId) p.set("cup", view.cupId);
  const favoriteClub = (view.favoriteClub || "").trim();
  if (favoriteClub && (hasChosenClub ||
      favoriteClub.toLowerCase() !== (defaultClubName || "").toLowerCase())) {
    p.set("fav", favoriteClub);
  }
  if (view.view && view.view !== MAIN_VIEW_DEFAULTS.view) p.set("view", view.view);
  if (view.view === "stats" && view.statsView && view.statsView !== MAIN_VIEW_DEFAULTS.statsView) {
    p.set("stats", view.statsView);
  }
  if (view.scope && view.scope !== MAIN_VIEW_DEFAULTS.scope) p.set("scope", view.scope);
  if (view.days && view.days.size) p.set("days", [...view.days].join(","));
  if (view.cats && view.cats.size) p.set("cats", [...view.cats].join(","));
  if (view.teams && view.teams.size) p.set("teams", [...view.teams].join(","));
  if (view.years && view.years.size) p.set("years", [...view.years].join(","));
  if (view.includeCurrentYear === false) p.set("curYear", "0");
  if (view.arena) p.set("arena", view.arena);
  if (view.viewArena) p.set("viewArena", view.viewArena);
  if (view.sort && view.sort !== MAIN_VIEW_DEFAULTS.sort) p.set("sort", view.sort);
  if (view.timeOrder && view.timeOrder !== MAIN_VIEW_DEFAULTS.timeOrder) p.set("order", view.timeOrder);
  if (view.matchFilter && view.matchFilter !== MAIN_VIEW_DEFAULTS.matchFilter) p.set("mf", view.matchFilter);
  if (view.q) p.set("q", view.q);
  return p;
}

export function decodeMainViewParams(params) {
  const out = {};
  if (params.has("fav")) {
    const favoriteClub = (params.get("fav") || "").trim();
    if (favoriteClub) out.favoriteClub = favoriteClub;
  }
  if (params.get("view")) out.view = params.get("view");
  if (params.get("stats")) out.statsView = params.get("stats");
  if (params.get("scope")) out.scope = params.get("scope");
  if (params.get("days")) out.days = new Set(params.get("days").split(","));
  if (params.get("cats")) out.cats = new Set(params.get("cats").split(",").map(toId));
  if (params.get("teams")) out.teams = new Set(params.get("teams").split(",").map(toId));
  if (params.get("years")) out.years = new Set(params.get("years").split(","));
  if (params.get("curYear") === "0") out.includeCurrentYear = false;
  if (params.get("arena")) out.arena = params.get("arena");
  if (params.get("viewArena")) out.viewArena = params.get("viewArena");
  if (params.get("sort")) out.sort = params.get("sort");
  if (params.get("order") === "desc") out.timeOrder = "desc";
  if (["all", "upcoming", "played"].includes(params.get("mf"))) out.matchFilter = params.get("mf");
  if (params.get("q")) out.q = params.get("q");
  return out;
}

export function splitNameList(raw, slugify) {
  return (raw || "").split(NAME_SEP)
    .map((name) => slugify(name.trim()))
    .filter(Boolean);
}

export function hasUrlViewParams(params) {
  return [...params.keys()].some((k) => !NON_VIEW_PARAMS.has(k));
}

export const MEDAL_KEYS = ["guld", "silver", "brons"];
export const PLAYOFF_SORT_COLS = ["omgang", "nr", "lag", "resultat", "tid", "bana"];

export function medalsToStr(m) {
  return MEDAL_KEYS.filter((k) => m && m[k]).join(",");
}

export function strToMedals(s) {
  const on = new Set(String(s || "").split(",").filter(Boolean));
  return { guld: on.has("guld"), silver: on.has("silver"), brons: on.has("brons") };
}

export function defaultSubViewSnap(now = new Date()) {
  const year = String(now.getFullYear());
  return {
    view: "schema",
    statsView: "trend",
    schemaSelectionKey: "all",
    tableGroupKey: "all",
    tableSortKey: "points",
    tableSortOrder: "desc",
    arenaMapOpen: false,
    playoffTimeOrder: "asc",
    bracketSort: null,
    playoffCatTab: null,
    playoffDivTab: {},
    exploreCupIds: new Set(),
    trendCats: new Set(),
    trendBaselineYear: null,
    trendCompareMetric: "matches",
    mapYear: null,
    mapCountryHistory: false,
    clubQuery: "",
    clubDrillCup: null,
    clubDrillClass: null,
    clubYears: new Set([year]),
    clubShowGaps: true,
    compareNames: [],
    compareExpanded: new Set(),
    compareYears: new Set([year]),
    statsCupDrill: null,
    kalenderYear: null,
    vinnareMode: "trofe",
    vinnareQuery: null,
    vinnareMedals: { guld: true, silver: false, brons: false },
    vinnareCup: null,
    vinnareYear: null,
    vinnareToppCup: "",
    vinnareToppMedals: { guld: true, silver: false, brons: false },
    historyMode: "compare",
    browse: null,
  };
}

export function applySubViewPatch(snap, patch) {
  const out = { ...snap, ...patch };
  if (patch.exploreCupIds) out.exploreCupIds = new Set(patch.exploreCupIds);
  if (patch.trendCats) out.trendCats = new Set(patch.trendCats);
  if (patch.clubYears) out.clubYears = new Set(patch.clubYears);
  if (patch.compareExpanded) out.compareExpanded = new Set(patch.compareExpanded);
  if (patch.compareYears) out.compareYears = new Set(patch.compareYears);
  if (patch.playoffDivTab) out.playoffDivTab = { ...patch.playoffDivTab };
  if (patch.vinnareMedals) out.vinnareMedals = { ...patch.vinnareMedals };
  if (patch.vinnareToppMedals) out.vinnareToppMedals = { ...patch.vinnareToppMedals };
  if (patch.bracketSort) out.bracketSort = { ...patch.bracketSort };
  if (patch.browse) out.browse = { ...patch.browse };
  if (patch.compareNames) out.compareNames = [...patch.compareNames];
  return out;
}

// Bara parametrar för den JUST NU visade fliken, så en Schema-länk inte
// släpar på stats-val den inte läser.
export function encodeSubViewParams(p, snap) {
  if (snap.view === "schema") {
    if (snap.schemaSelectionKey && snap.schemaSelectionKey !== "all") {
      p.set("ssel", snap.schemaSelectionKey);
    }
    return p;
  }
  if (snap.view === "tabeller") {
    if (snap.tableGroupKey && snap.tableGroupKey !== "all") p.set("tgroup", snap.tableGroupKey);
    if (snap.tableSortKey && snap.tableSortKey !== "points") p.set("tsort", snap.tableSortKey);
    if (snap.tableSortOrder && snap.tableSortOrder !== "desc") p.set("torder", snap.tableSortOrder);
    return p;
  }
  if (snap.view === "bana") {
    if (snap.arenaMapOpen) p.set("amap", "1");
    return p;
  }
  if (snap.view === "slutspel") {
    if (snap.playoffTimeOrder && snap.playoffTimeOrder !== "asc") p.set("porder", snap.playoffTimeOrder);
    const bracketSort = snap.bracketSort;
    if (bracketSort && bracketSort.col && bracketSort.col !== "tid") {
      p.set("psort", bracketSort.col);
      if (bracketSort.dir < 0) p.set("pdir", "desc");
    }
    if (snap.playoffCatTab != null) p.set("pcat", String(snap.playoffCatTab));
    const divs = Object.entries(snap.playoffDivTab || {});
    if (divs.length) p.set("pdiv", divs.map(([c, d]) => c + ":" + d).join(","));
    return p;
  }
  if (snap.view !== "stats") return p;
  const sv = snap.statsView;
  if ((sv === "trend" || sv === "karta") && snap.exploreCupIds && snap.exploreCupIds.size) {
    p.set("cups", [...snap.exploreCupIds].join(","));
  }
  if (sv === "trend") {
    if (snap.trendCats && snap.trendCats.size) p.set("tcats", [...snap.trendCats].join(NAME_SEP));
    if (snap.trendBaselineYear) p.set("tbase", snap.trendBaselineYear);
    if (snap.trendCompareMetric && snap.trendCompareMetric !== "matches") {
      p.set("tmetric", snap.trendCompareMetric);
    }
  } else if (sv === "karta") {
    if (snap.mapYear) p.set("mapYear", snap.mapYear);
    if (snap.mapCountryHistory) p.set("mapCh", "1");
  } else if (sv === "klubb") {
    p.set("club", snap.clubQuery == null ? "" : String(snap.clubQuery));
    if (snap.clubDrillCup) p.set("clubCup", snap.clubDrillCup);
    if (snap.clubDrillClass) p.set("clubClass", snap.clubDrillClass);
    p.set("clubYears", snap.clubYears && snap.clubYears.size ? [...snap.clubYears].join(",") : "all");
    if (snap.clubShowGaps === false) p.set("clubGaps", "0");
  } else if (sv === "klubbjamforelse") {
    if (snap.compareNames && snap.compareNames.length) p.set("cmp", snap.compareNames.join(NAME_SEP));
    if (snap.compareExpanded && snap.compareExpanded.size) {
      p.set("cmpOpen", [...snap.compareExpanded].join(NAME_SEP));
    }
    p.set("cmpYears", snap.compareYears && snap.compareYears.size
      ? [...snap.compareYears].join(",") : "all");
  } else if (sv === "cuper") {
    if (snap.statsCupDrill) p.set("cupDrill", snap.statsCupDrill);
  } else if (sv === "kalender") {
    if (snap.kalenderYear) p.set("kyear", snap.kalenderYear);
  } else if (sv === "vinnare") {
    if (snap.vinnareMode && snap.vinnareMode !== "trofe") p.set("vm", snap.vinnareMode);
    if (snap.vinnareMode === "trofe") {
      if (snap.vinnareQuery !== null && snap.vinnareQuery !== undefined) p.set("vq", snap.vinnareQuery);
      if (medalsToStr(snap.vinnareMedals) !== "guld") p.set("vmed", medalsToStr(snap.vinnareMedals));
    } else if (snap.vinnareMode === "ar") {
      if (snap.vinnareCup) p.set("vcup", snap.vinnareCup);
      if (snap.vinnareYear) p.set("vyear", snap.vinnareYear);
    } else {
      if (snap.vinnareToppCup) p.set("vtcup", snap.vinnareToppCup);
      if (medalsToStr(snap.vinnareToppMedals) !== "guld") {
        p.set("vtmed", medalsToStr(snap.vinnareToppMedals));
      }
    }
  } else if (sv === "historik") {
    if (snap.historyMode && snap.historyMode !== "compare") p.set("hmode", snap.historyMode);
    const b = snap.browse;
    if (snap.historyMode === "browse" && b) {
      p.set("bcup", b.cupId);
      p.set("bed", b.edition);
      if (b.view && b.view !== "schema") p.set("bview", b.view);
      if (b.catFilter) p.set("bcat", b.catFilter);
      if (b.arena) p.set("bar", b.arena);
      if (b.teamQuery) p.set("bq", b.teamQuery);
    }
  }
  return p;
}

export function decodeSubViewParams(params) {
  const out = {};
  if (params.get("ssel")) out.schemaSelectionKey = params.get("ssel");
  if (params.get("tgroup")) out.tableGroupKey = params.get("tgroup");
  if (["rank", "name", "points"].includes(params.get("tsort"))) out.tableSortKey = params.get("tsort");
  if (params.get("torder") === "asc") out.tableSortOrder = "asc";
  if (params.get("amap") === "1") out.arenaMapOpen = true;
  if (params.get("pcat")) out.playoffCatTab = +params.get("pcat");
  if (params.get("porder") === "desc") out.playoffTimeOrder = "desc";
  if (params.get("psort") && PLAYOFF_SORT_COLS.includes(params.get("psort"))) {
    out.bracketSort = {
      col: params.get("psort"),
      dir: params.get("pdir") === "desc" ? -1 : 1,
    };
  } else if (params.has("porder")) {
    out.bracketSort = { col: "tid", dir: params.get("porder") === "desc" ? -1 : 1 };
  }
  if (params.get("pdiv")) {
    const map = {};
    params.get("pdiv").split(",").forEach((pair) => {
      const i = pair.indexOf(":");
      if (i > 0) map[pair.slice(0, i)] = toId(pair.slice(i + 1));
    });
    out.playoffDivTab = map;
  }
  if (params.get("cups")) out.exploreCupIds = new Set(params.get("cups").split(","));
  if (params.get("tcats")) out.trendCats = new Set(params.get("tcats").split(NAME_SEP));
  if (params.get("tbase")) out.trendBaselineYear = params.get("tbase");
  if (params.get("tmetric")) out.trendCompareMetric = params.get("tmetric");
  if (params.get("mapYear")) out.mapYear = params.get("mapYear");
  if (params.get("mapCh") === "1") out.mapCountryHistory = true;
  if (params.has("club")) out.clubQuery = params.get("club");
  if (params.get("clubCup")) out.clubDrillCup = params.get("clubCup");
  if (params.get("clubClass")) out.clubDrillClass = params.get("clubClass");
  if (params.has("clubYears")) {
    const years = params.get("clubYears");
    out.clubYears = years === "all" ? new Set() : new Set(years.split(",").filter(Boolean));
  }
  if (params.get("clubGaps") === "0") out.clubShowGaps = false;
  if (params.get("cmp")) out.compareNames = params.get("cmp").split(NAME_SEP);
  if (params.get("cmpOpen")) out.compareExpanded = new Set(params.get("cmpOpen").split(NAME_SEP));
  if (params.has("cmpYears")) {
    const years = params.get("cmpYears");
    out.compareYears = years === "all" ? new Set() : new Set(years.split(",").filter(Boolean));
  }
  if (params.get("cupDrill")) out.statsCupDrill = params.get("cupDrill");
  if (params.get("kyear")) out.kalenderYear = params.get("kyear");
  if (["trofe", "ar", "topp"].includes(params.get("vm"))) out.vinnareMode = params.get("vm");
  if (params.has("vq")) out.vinnareQuery = params.get("vq");
  if (params.has("vmed")) out.vinnareMedals = strToMedals(params.get("vmed"));
  if (params.get("vcup")) out.vinnareCup = params.get("vcup");
  if (params.get("vyear")) out.vinnareYear = params.get("vyear");
  if (params.has("vtcup")) out.vinnareToppCup = params.get("vtcup");
  if (params.has("vtmed")) out.vinnareToppMedals = strToMedals(params.get("vtmed"));
  if (["compare", "browse"].includes(params.get("hmode"))) out.historyMode = params.get("hmode");
  if (params.get("bcup") && params.get("bed")) {
    out.browse = {
      cupId: params.get("bcup"), edition: params.get("bed"),
      view: params.get("bview") || "schema", catFilter: params.get("bcat") || "",
      arena: params.get("bar") || "", teamQuery: params.get("bq"),
    };
    out.historyMode = "browse";
  }
  return out;
}

export function resolveNamedUrlFilters(matches, params, slugify, classKeysFn) {
  const out = { teams: null, cats: null };
  if (params.has("team") && !params.has("teams")) {
    const names = new Set(splitNameList(params.get("team"), slugify));
    const ids = new Set();
    for (const m of matches) {
      if (names.has(slugify(m.home.name))) ids.add(m.home.id);
      if (names.has(slugify(m.away.name))) ids.add(m.away.id);
    }
    out.teams = ids;
  }
  if (params.has("klass") && !params.has("cats")) {
    const names = new Set(splitNameList(params.get("klass"), slugify));
    const ids = new Set();
    for (const m of matches) {
      if ((classKeysFn(m) || []).some((key) => names.has(key))) ids.add(m.catId);
    }
    out.cats = ids;
  }
  return out;
}
