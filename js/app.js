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
    // "F12", "P 12", "Flickor 12 år Classic (födda 2014)", "U12" → {g, age}
    const s = catName || "";
    let m = /\b([PFU])\s?(\d{1,2})\b/.exec(s);
    if (m) return { g: m[1].toUpperCase(), age: +m[2] };
    m = /(Flickor|Pojkar|Damer|Herrar)\s*(\d{1,2})?/i.exec(s);
    if (m) {
      const g = { f: "F", p: "P", d: "D", h: "H" }[m[1][0].toLowerCase()];
      return { g, age: m[2] ? +m[2] : 0 };
    }
    return null;
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

  function catRule(catName) {
    // Särskiljande ord ur kategorinamnet ("Classic", "Beach+", "Mini" …).
    const m = /(Classic|Beach\w*\+?|Mini|Motion|Elit|Utveckling)/i.exec(catName || "");
    return m ? m[1] : "";
  }

  function teamSuffix(name) {
    const stripped = name.replace(HB.CLUB.pattern, "").trim();
    return stripped || name;
  }

  function isClubName(name) {
    return HB.CLUB.pattern.test(name || "");
  }

  function isClubMatch(m) {
    return isClubName(m.home.name) || isClubName(m.away.name);
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

  // --- state ---------------------------------------------------------------

  const state = {
    cupId: localStorage.getItem("hb:cup") || (HB.allCups()[0] || {}).id,
    view: "schema",          // schema | tabeller
    scope: "club",           // club | all
    day: "all",
    cats: new Set(),
    teams: new Set(),
    arena: "",
    q: "",
    sort: "tid",             // tid | klass | plan
    matchFilter: "all",      // all | upcoming | played
    matches: [],
    loadedAt: 0,
    loading: false,
    error: null,
    tables: {},              // divId -> {status, rows}
  };

  function cup() {
    return HB.allCups().find((c) => c.id === state.cupId) || HB.allCups()[0];
  }

  function uiKey() { return "hb:ui:" + state.cupId; }

  function saveUi() {
    localStorage.setItem("hb:cup", state.cupId);
    localStorage.setItem(uiKey(), JSON.stringify({
      view: state.view, scope: state.scope, day: state.day,
      cats: [...state.cats], teams: [...state.teams],
      arena: state.arena, sort: state.sort, matchFilter: state.matchFilter,
    }));
  }

  function loadUi() {
    state.view = "schema"; state.scope = "club"; state.day = "all";
    state.cats = new Set(); state.teams = new Set();
    state.arena = ""; state.q = ""; state.sort = "tid"; state.matchFilter = "all";
    try {
      const s = JSON.parse(localStorage.getItem(uiKey()) || "{}");
      if (s.view) state.view = s.view;
      if (s.scope) state.scope = s.scope;
      if (s.day) state.day = s.day;
      if (Array.isArray(s.cats)) state.cats = new Set(s.cats);
      if (Array.isArray(s.teams)) state.teams = new Set(s.teams);
      if (s.arena) state.arena = s.arena;
      if (s.sort) state.sort = s.sort;
      if (["all", "upcoming", "played"].includes(s.matchFilter)) state.matchFilter = s.matchFilter;
      else if (s.played === false) state.matchFilter = "upcoming"; // migrera gammal boolean
    } catch { /* trasig state: kör default */ }
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

  async function loadCup(force) {
    const c = cup();
    if (!c) return;
    // Förhämtade cuper (dataUrl) läses alltid färskt — filen ligger lokalt.
    const cached = c.dataUrl ? null : HB.api.readCache(c);
    if (cached && cached.matches) {
      state.matches = cached.matches;
      state.loadedAt = cached.ts;
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
    render();
    try {
      const matches = await HB.api.fetchMatches(c, (n) => {
        const el = $("#loadNote");
        if (el) el.textContent = "Hämtar schema … " + n + "+ matcher";
      });
      state.matches = matches;
      state.loadedAt = Date.now();
      if (!c.dataUrl) HB.api.writeCache(c, matches);
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
    dialogTableCache = {};
    state.matches = [];
    state.loadedAt = 0;
    loadUi();
    saveUi();
    loadCup();
  }

  // --- härledningar ------------------------------------------------------

  function scoped() {
    return state.scope === "club" ? state.matches.filter(isClubMatch) : state.matches;
  }

  function clubTeams() {
    const map = new Map();
    for (const m of state.matches) {
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

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return scoped().filter((m) => {
      if (state.day !== "all" && dayKey(m.start) !== state.day) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (state.arena && m.arena !== state.arena) return false;
      if (state.matchFilter === "upcoming" && m.res && m.res.fin) return false;
      if (state.matchFilter === "played" && !(m.res && m.res.fin)) return false;
      if (q) {
        const hay = (m.home.name + " " + m.away.name + " " + m.arena + " " +
          m.catName + " " + m.divName + " " + m.roundName).toLowerCase();
        if (!hay.includes(q)) return false;
      }
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
  function renderContent() {
    const main = $("#content");
    main.replaceChildren();
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
    if (!state.matches.length && !state.loading && !state.error) {
      main.append(h("div", { class: "banner" },
        cup().name + " har inte publicerat något spelschema ännu."));
      return;
    }
    if (state.view === "schema") renderSchema(main);
    else renderTables(main);
  }

  function renderCups() {
    const row = $("#cupRow");
    row.replaceChildren(
      ...HB.allCups().map((c) =>
        h("button", {
          class: "cup" + (c.id === state.cupId ? " on" : ""),
          type: "button", onclick: () => switchCup(c.id),
        },
          h("span", { class: "cup-name" }, c.name),
          h("span", { class: "cup-place" }, c.place + " " + c.edition))
      ));
  }

  function renderTabs() {
    $$("#viewTabs .tab").forEach((b) => {
      b.classList.toggle("on", b.dataset.view === state.view);
      b.setAttribute("aria-selected", String(b.dataset.view === state.view));
    });
  }

  function renderMeta() {
    const el = $("#meta");
    if (!state.loadedAt) { el.textContent = ""; return; }
    const n = scoped().length;
    const dataTs = HB.api.localDataTs[state.cupId];
    el.textContent = (dataTs
      ? "Data hämtad " + new Intl.DateTimeFormat("sv-SE", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(new Date(dataTs))
      : "Uppdaterad " + fmtClock.format(new Date(state.loadedAt))) +
      " · " + n + " matcher" + (state.loading ? " · hämtar nytt …" : "");
  }

  // --- lagväljare: sök-, filter- och sorterbar dropdown -----------------------

  function buildTeamPicker(teams) {
    // Egen, självstyrande komponent: sökning/sortering/bockning inuti den
    // sköts med direkt DOM-manipulation i stället för renderToolbar(), så
    // att den kan hållas öppen genom flera val utan att byggas om.
    const dd = h("details", { class: "team-picker-dd" });
    const summary = h("summary", { class: "chip team-picker-summary" });
    const setSummary = () => {
      summary.textContent = state.teams.size
        ? "Lag (" + state.teams.size + ")" : "Alla lag";
    };
    setSummary();

    const search = h("input", {
      class: "team-picker-search", type: "search", placeholder: "Sök lag …",
    });
    const clearBtn = h("button", {
      class: "btn small", type: "button",
      onclick: () => {
        state.teams.clear();
        saveUi(); setSummary(); renderContent();
        list.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
      },
    }, "Rensa");

    let sortMode = "klass";
    const sortBtns = {};
    const applySort = () => {
      const cmp = sortMode === "namn"
        ? (a, b) => a.dataset.name.localeCompare(b.dataset.name, "sv")
        : (a, b) => (+a.dataset.catkey - +b.dataset.catkey) ||
            a.dataset.name.localeCompare(b.dataset.name, "sv");
      [...list.children].sort(cmp).forEach((el) => list.append(el));
    };
    const sortRow = h("div", { class: "team-picker-sort-row" },
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

    const list = h("div", { class: "team-picker-list" },
      teams.map((t) => {
        const label = HB.shortCat(t.catName) + " " + t.suffix;
        const cb = h("input", {
          type: "checkbox", ...(state.teams.has(t.id) ? { checked: "" } : {}),
          onchange: (e) => {
            e.target.checked ? state.teams.add(t.id) : state.teams.delete(t.id);
            saveUi(); setSummary(); renderContent();
          },
        });
        const row = h("label", { class: "team-picker-item" }, cb, label);
        row.dataset.name = t.suffix;
        row.dataset.catkey = String(catSortKey(t.catName));
        row.dataset.search = label.toLowerCase();
        return row;
      }));

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const item of list.children) item.hidden = !!q && !item.dataset.search.includes(q);
    });

    dd.append(summary, h("div", { class: "team-picker-panel" },
      h("div", { class: "team-picker-search-row" }, search, clearBtn),
      sortRow, list));
    return dd;
  }

  // --- render: verktygsrad ----------------------------------------------------

  function renderToolbar() {
    const bar = $("#toolbar");
    bar.replaceChildren();
    if (!state.matches.length) return;

    // Klubb / hela cupen
    bar.append(h("div", { class: "row scope-row" },
      h("div", { class: "seg", role: "group", "aria-label": "Omfattning" },
        chip(HB.CLUB.name, state.scope === "club", () => {
          state.scope = "club"; saveUi(); render();
        }),
        chip("Hela cupen", state.scope === "all", () => {
          state.scope = "all"; saveUi(); render();
        })),
      h("div", { class: "seg", role: "group", "aria-label": "Matchstatus" },
        [["all", "Alla"], ["upcoming", "Kommande"], ["played", "Spelade"]].map(([v, l]) =>
          chip(l, state.matchFilter === v, () => {
            state.matchFilter = v; saveUi(); render();
          }))),
    ));

    // Dagar
    const days = [...new Set(scoped().map((m) => dayKey(m.start)))].sort();
    if (days.length > 1) {
      bar.append(h("div", { class: "row day-row" },
        chip("Alla dagar", state.day === "all", () => {
          state.day = "all"; saveUi(); render();
        }, "day"),
        days.map((d) =>
          chip(fmtDay.format(new Date(d + "T00:00:00Z")), state.day === d, () => {
            state.day = state.day === d ? "all" : d; saveUi(); render();
          }, "day"))));
    }

    // Klasser
    const cats = new Map();
    for (const m of scoped()) if (m.catId) cats.set(m.catId, m.catName);
    if (cats.size > 1) {
      const entries = [...cats.entries()].sort((a, b) =>
        catSortKey(a[1]) - catSortKey(b[1]) || a[1].localeCompare(b[1], "sv"));
      // Vid krock på förkortning (t.ex. F12 Classic + F12 Mini) läggs regeln till.
      const shorts = entries.map(([, name]) => HB.shortCat(name));
      const dups = new Set(shorts.filter((s, i) => shorts.indexOf(s) !== i));
      const label = (name) => {
        const s = HB.shortCat(name);
        if (state.scope !== "club") return name;
        return dups.has(s) ? (s + " " + (catRule(name) || name)).trim() : s;
      };
      bar.append(h("div", { class: "row" },
        entries.map(([id, name]) =>
          chip(label(name),
            state.cats.has(id), () => {
              state.cats.has(id) ? state.cats.delete(id) : state.cats.add(id);
              saveUi(); render();
            }))));
    }

    // Egna lag (bara i klubbläge)
    if (state.scope === "club") {
      const teams = clubTeams();
      if (teams.length > 1) {
        bar.append(h("div", { class: "row" }, buildTeamPicker(teams)));
      }
    }

    // Sök · plan · sortering · export
    const arenas = [...new Set(scoped().map((m) => m.arena).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
    bar.append(h("div", { class: "row tools-row" },
      h("input", {
        class: "search", type: "search", placeholder: "Sök lag, plan, grupp …",
        value: state.q,
        // renderContent() (inte render()) — annars byggs sökfältet om vid
        // varje tangenttryckning och tappar fokus/mobiltangentbordet.
        oninput: (e) => { state.q = e.target.value; renderContent(); },
      }),
      arenas.length > 1 ? h("select", {
        class: "select", "aria-label": "Plan",
        onchange: (e) => { state.arena = e.target.value; saveUi(); render(); },
      },
        h("option", { value: "" }, "Alla planer"),
        arenas.map((a) => h("option",
          { value: a, ...(state.arena === a ? { selected: "" } : {}) }, a))) : null,
      h("select", {
        class: "select", "aria-label": "Sortering",
        onchange: (e) => { state.sort = e.target.value; saveUi(); render(); },
      },
        [["tid", "Sortera: tid"], ["klass", "Sortera: klass"], ["plan", "Sortera: plan"]]
          .map(([v, l]) => h("option",
            { value: v, ...(state.sort === v ? { selected: "" } : {}) }, l))),
      h("button", {
        class: "btn", type: "button",
        onclick: exportIcs, title: "Ladda ner filtrerade matcher som kalenderfil",
      }, "📅 .ics"),
    ));
  }

  function exportIcs() {
    const list = sorted(filtered()).filter((m) => !(m.res && m.res.fin));
    const all = list.length ? list : sorted(filtered());
    if (!all.length) return;
    HB.ics.download(cup(), all, cup().id + "-" +
      (state.scope === "club" ? "ahk" : "alla") + ".ics");
  }

  // --- render: hero (nästa match) ------------------------------------------

  function nextClubMatch() {
    const now = Date.now();
    const pool = state.matches.filter(isClubMatch).filter((m) => {
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) return false;
      if (state.cats.size && !state.cats.has(m.catId)) return false;
      return !(m.res && m.res.fin) && m.start >= now - 30 * 60000;
    });
    return pool.length ? pool.reduce((a, b) => (a.start <= b.start ? a : b)) : null;
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

  function renderHero(main) {
    const m = nextClubMatch();
    if (!m) return;
    const live = isLive(m);
    main.append(h("section", { class: "hero", id: "hero" },
      h("div", { class: "hero-eyebrow" },
        live ? h("span", { class: "live-dot" }) : null,
        live ? "Pågår nu" : "Nästa match",
        h("span", { class: "hero-count" }, live ? "" : countdownText(m.start))),
      h("div", { class: "hero-teams" },
        h("span", { class: isClubName(m.home.name) ? "us" : "" }, m.home.name),
        h("span", { class: "vs" }, live && scoreText(m.res) ? scoreText(m.res) : "mot"),
        h("span", { class: isClubName(m.away.name) ? "us" : "" }, m.away.name)),
      h("div", { class: "hero-info" },
        fmtDayLong.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start)),
        h("span", { class: "dot" }, "·"), m.arena || "plan ej satt",
        h("span", { class: "dot" }, "·"),
        HB.shortCat(m.catName) + (m.divName ? " " + m.divName : ""))));
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

  function gotoTeamMatches(team, mode) {
    state.scope = "all";
    state.q = team.name;
    state.teams = new Set();
    state.cats = new Set();
    state.day = "all";
    state.arena = "";
    state.matchFilter = mode;
    state.view = "schema";
    saveUi();
    closeMatchDialog();
    render();
  }

  function closeMatchDialog() {
    const dlg = $(".match-dialog");
    if (dlg) dlg.close();
  }

  function teamStatBlock(m, team, side) {
    const counts = teamMatchCounts(team.id);
    const statLine = h("p", { class: "muted team-stat-line" }, "Hämtar tabellplacering …");
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
        }, "Spelade matcher")));

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
      teamStatBlock(m, m.away, "away"));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // --- render: schema --------------------------------------------------------

  function matchCard(m) {
    const sc = scoreText(m.res);
    const live = isLive(m);
    const teamEl = (side, other) => h("div", {
      class: "team" + (isClubName(side.name) ? " us" : "") +
        (m.res && m.res.fin && m.res.winner &&
          ((m.res.winner === "home") === (side === m.home)) ? " won" : ""),
    }, side.name || "–");
    return h("article", {
      class: "match" + (isClubMatch(m) ? " ours" : ""),
      role: "button", tabindex: "0",
      "aria-label": "Visa lagstatistik för " + m.home.name + " mot " + m.away.name,
      onclick: () => openMatchDialog(m),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatchDialog(m); }
      },
    },
      h("div", { class: "match-head" },
        h("span", { class: "cat" }, HB.shortCat(m.catName)),
        m.divName ? h("span", { class: "div" }, m.divName) : null,
        m.roundName && m.roundName !== m.divName
          ? h("span", { class: "div" }, m.roundName) : null,
        h("span", { class: "arena" }, m.arena)),
      h("div", { class: "match-body" },
        h("div", { class: "teams" }, teamEl(m.home), teamEl(m.away)),
        h("div", {
          class: "score" + (live ? " live" : "") +
            (sc === "spelad" ? " played" : ""),
        },
          live ? h("span", { class: "live-tag" }, h("span", { class: "live-dot" }), "LIVE") : null,
          sc || fmtTime.format(new Date(m.start)))));
  }

  function timeGroups(list) {
    const groups = [];
    for (const m of list) {
      const key = state.day === "all"
        ? dayKey(m.start) + " " + fmtTime.format(new Date(m.start))
        : fmtTime.format(new Date(m.start));
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, start: m.start, items: [m] });
    }
    return groups;
  }

  function renderSchema(main) {
    renderHero(main);
    const list = sorted(filtered());
    if (!list.length) {
      if (state.scope === "club" && !scoped().length && state.matches.length) {
        main.append(h("div", { class: "banner" },
          h("p", null, HB.CLUB.name + " verkar inte ha några matcher i " +
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
      const now = Date.now();
      const today = dayKey(now);
      let nowPlaced = false;
      let lastDay = "";
      const wrap = h("div", { class: "timeline" });
      for (const g of timeGroups(list)) {
        const gDay = dayKey(g.start);
        if (state.day === "all" && gDay !== lastDay) {
          lastDay = gDay;
          nowPlaced = nowPlaced || gDay > today;
          wrap.append(h("h2", { class: "day-h" },
            fmtDayLong.format(new Date(g.start))));
        }
        if (!nowPlaced && gDay === today && g.start > now) {
          nowPlaced = true;
          wrap.append(h("div", { class: "nowline", id: "nowline" },
            h("span", null, "NU " + fmtTime.format(new Date(now)))));
        }
        wrap.append(h("div", { class: "slot" },
          h("div", { class: "rail" },
            fmtTime.format(new Date(g.start)),
            state.day === "all"
              ? h("small", null, fmtDay.format(new Date(g.start))) : null),
          h("div", { class: "slot-matches" }, g.items.map(matchCard))));
      }
      main.append(wrap);
      const nl = $("#nowline");
      if (nl && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setTimeout(() => nl.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
      }
    } else {
      const keyOf = state.sort === "klass"
        ? (m) => m.catName + (m.divName ? " · " + m.divName : "")
        : (m) => m.arena || "Plan ej satt";
      let lastKey = null;
      const wrap = h("div", { class: "grouped" });
      let sect = null;
      for (const m of list) {
        const k = keyOf(m);
        if (k !== lastKey) {
          lastKey = k;
          sect = h("div", { class: "slot-matches" });
          wrap.append(h("h2", { class: "day-h" }, k), sect);
        }
        const card = matchCard(m);
        card.prepend(h("div", { class: "when" },
          fmtDay.format(new Date(m.start)) + " " + fmtTime.format(new Date(m.start))));
        sect.append(card);
      }
      main.append(wrap);
    }
  }

  // --- render: tabeller -------------------------------------------------------

  function divisionsToShow() {
    // Grupper (divisioner) ur de filtrerade matcherna, med klubbens först.
    const map = new Map();
    for (const m of scoped()) {
      if (state.cats.size && !state.cats.has(m.catId)) continue;
      if (state.teams.size &&
          !state.teams.has(m.home.id) && !state.teams.has(m.away.id)) continue;
      if (!m.divId) continue;
      if (!map.has(m.divId)) {
        map.set(m.divId, {
          id: m.divId, name: m.divName, catId: m.catId, catName: m.catName,
          ours: false,
        });
      }
      const d = map.get(m.divId);
      if (isClubMatch(m)) d.ours = true;
    }
    let divs = [...map.values()];
    if (state.scope === "club") divs = divs.filter((d) => d.ours);
    divs.sort((a, b) => catSortKey(a.catName) - catSortKey(b.catName) ||
      a.catName.localeCompare(b.catName, "sv") ||
      a.name.localeCompare(b.name, "sv", { numeric: true }));
    return divs;
  }

  let tableQueue = Promise.resolve();

  function ensureTable(divId) {
    if (state.tables[divId]) return;
    state.tables[divId] = { status: "loading", rows: [] };
    tableQueue = tableQueue.then(async () => {
      try {
        const rows = await HB.api.fetchTable(cup(), divId);
        state.tables[divId] = { status: "done", rows };
      } catch {
        state.tables[divId] = { status: "error", rows: [] };
      }
      if (state.view === "tabeller") renderContent();
    });
  }

  function renderTables(main) {
    const divs = divisionsToShow();
    if (state.scope === "all" && !state.cats.size) {
      main.append(h("div", { class: "banner" },
        "Välj minst en klass ovan för att visa tabeller för hela cupen."));
      return;
    }
    if (!divs.length) {
      main.append(h("div", { class: "banner" }, "Inga grupper att visa."));
      return;
    }
    let lastCat = null;
    for (const d of divs) {
      ensureTable(d.id);
      if (d.catName !== lastCat) {
        lastCat = d.catName;
        main.append(h("h2", { class: "day-h" }, d.catName));
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
              h("td", { class: "l" }, r.name),
              h("td", null, String(r.played)),
              h("td", null, String(r.won)),
              h("td", null, String(r.tied)),
              h("td", null, String(r.lost)),
              h("td", null, (r.gf - r.ga > 0 ? "+" : "") + (r.gf - r.ga)),
              h("td", { class: "pts" }, String(r.points)))))));
      }
      main.append(box);
    }
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

  async function init() {
    // Skarp cuplista från data/cups.json (redigeras via admin.html);
    // HB.CUPS i config.js är reserv om filen saknas eller är trasig.
    try {
      const r = await fetch("data/cups.json?_=" + Date.now().toString(36));
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.cups) && j.cups.length) HB.CUPS = j.cups;
      }
    } catch { /* kör på reservlistan */ }

    // Djuplänk: ?cup=potatis öppnar en viss cup direkt (delbar länk).
    const urlCup = new URLSearchParams(location.search).get("cup");
    if (urlCup && HB.allCups().some((c) => c.id === urlCup)) {
      state.cupId = urlCup;
    }
    $$("#viewTabs .tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view; saveUi(); render();
      }));
    $("#refreshBtn").addEventListener("click", () => loadCup(true));
    setupAddCup();

    // Stäng en öppen lag-dropdown vid klick utanför den. En enda global
    // lyssnare (i stället för en per renderToolbar-anrop) hittar alltid
    // den dropdown som råkar vara monterad just nu.
    document.addEventListener("click", (e) => {
      const dd = document.querySelector(".team-picker-dd[open]");
      if (dd && !dd.contains(e.target)) dd.open = false;
    });
    loadUi();
    loadCup();

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
    // Nedräkningen i heron tickar utan full omrendering.
    setInterval(() => {
      const el = $(".hero-count");
      const m = nextClubMatch();
      if (el && m) el.textContent = countdownText(m.start);
    }, 30000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
