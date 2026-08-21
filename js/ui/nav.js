/* nav.js — desktop- och mobilmeny, hopfälld rad, filterräknare. */

import { h, $, $$ } from "../dom.js";
import { chrome, CURRENT_VIEWS } from "./chrome.js";
import {
  SHEET_QUERY, sheetMode, enforceMobileMenuHost, toggleFilterSheet,
  toggleFiltersExpanded, closePrototypeDialogs, openPrototypeSheetKey,
  syncBottomStack, syncSheetBackdrop, closeFilterBackdrop,
} from "./sheets.js";

const MENU_MINIMIZED_KEY = "hb:menuMinimized";

let persist, storageGet, render, saveUi, cup, filterSummaryText;
let getStatsTabs, openHeaderExportDialog, state;

export function initNav(deps) {
  ({ persist, storageGet, render, saveUi, cup, filterSummaryText,
     getStatsTabs, openHeaderExportDialog, state } = deps);
  chrome.menuMinimized = storageGet(MENU_MINIMIZED_KEY) === "1";
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

  function renderDesktopNav() {
    const main = $("#desktopMainNav");
    const sub = $("#desktopSubNav");
    if (!main || !sub) return;
    if (sheetMode()) {
      main.hidden = true;
      sub.hidden = true;
      document.body.classList.remove("desktop-filter-open");
      return;
    }
    main.hidden = false;
    if (CURRENT_VIEWS.includes(state.view)) chrome.lastCurrentView = state.view;
    // Undermenyn följer alltid innehållssidan. Filter är inte en egen
    // navigationsnivå, utan en oberoende panel under de synliga menyraderna.
    chrome.desktopMenuOpen = state.view === "stats" ? "stats" : "current";
    document.body.classList.toggle("desktop-filter-open", chrome.desktopFilterExpanded);
    const pageGroup = state.view === "stats" ? "stats" : "current";
    const primary = (key, label, icon, onclick) => {
      const pageActive = pageGroup === key;
      const menuActive = key === "filter" ? chrome.desktopFilterExpanded : chrome.desktopMenuOpen === key;
      const button = h("button", {
        class: "desktop-primary-tab desktop-primary-" + key +
          (pageActive ? " page-on" : "") +
          (menuActive ? " menu-on" : ""),
        type: "button",
        ...(pageActive ? { "aria-current": "page" } : {}),
        "aria-expanded": String(menuActive),
        onclick,
      }, h("span", { class: "desktop-primary-icon", "aria-hidden": "true" },
        bottomMenuIcon(key === "filter"
          ? (chrome.desktopFilterExpanded ? "filter-open" : "filter-closed") : icon)),
      h("span", null, label));
      if (key === "filter" && activeFilterCount()) button.append(
        h("span", { class: "desktop-filter-badge" }, String(activeFilterCount())));
      return button;
    };
    main.replaceChildren(
      primary("filter", "Filter", "filter", () => {
        chrome.desktopFilterExpanded = !chrome.desktopFilterExpanded;
        saveUi(); render();
      }),
      primary("current", "Aktuellt", "current", () => {
        chrome.desktopMenuOpen = "current";
        if (!CURRENT_VIEWS.includes(state.view)) state.view = chrome.lastCurrentView;
        saveUi(); render();
      }),
      primary("stats", "Statistik", "stats", () => {
        chrome.desktopMenuOpen = "stats";
        state.view = "stats";
        saveUi(); render();
      }));

    const action = (label, active, onclick) => h("button", {
      class: "desktop-subtab" + (active ? " on" : ""), type: "button",
      ...(active ? { "aria-current": "page" } : {}), onclick,
    }, label);
    const supported = new Map($$("#viewTabs .tab").map((b) => [b.dataset.view, !b.hidden]));
    if (chrome.desktopMenuOpen === "current") {
      const labels = { schema: "Schema", tabeller: "Tabeller", slutspel: "Slutspel", bana: "Bana" };
      sub.replaceChildren(...CURRENT_VIEWS.filter((v) => supported.get(v) !== false).map((v) =>
        action(labels[v], state.view === v, () => {
          if (v === "tabeller" && state.view !== "tabeller") state.tableGroupKey = "all";
          chrome.desktopMenuOpen = "current";
          state.view = v; saveUi(); render();
        })));
    } else if (chrome.desktopMenuOpen === "stats") {
      const support = state.statsSupport || {};
      const visible = getStatsTabs().filter(([key]) => support[key] || key === state.statsView);
      sub.replaceChildren(...visible.map(([key, label]) =>
        action(label, state.statsView === key, () => {
          state.statsView = key; saveUi(); render();
        })));
    } else sub.replaceChildren();
    sub.hidden = !sub.childElementCount;
  }

  function closeSubmenuOverlays({ closeFilters = true } = {}) {
    closePrototypeDialogs();
    // Mobila matchdialoger ligger under bottenmenyn. När användaren väljer
    // en annan huvud-/underflik ska panelen lämna plats åt den nya vyn.
    for (const dlg of document.querySelectorAll("dialog.match-dialog[open]")) dlg.close();
    const openPickers = document.querySelectorAll(".team-picker-dd[open]");
    if (openPickers.length) {
      openPickers.forEach((dd) => { dd.open = false; });
    }
    syncSheetBackdrop(false);
    document.body.classList.remove("picker-open");
    if (closeFilters) {
      closeFilterBackdrop();
      document.body.classList.remove("filters-open", "filters-expanded");
    }
  }

  // Brytpunkt för "Tillbaka till toppen": knappen dyker upp när ungefär en
  // halv synlig skärmbild har passerats. Med visualViewport följer den den
  // faktiskt synliga mobilytan även när webbläsarens adressfält ändrar höjd.
  function scrollTopRevealY() {
    const height = window.visualViewport && window.visualViewport.height
      ? window.visualViewport.height : window.innerHeight;
    return height * 0.5;
  }

  // Alla menyrader som kan scrolla i sidled när valen inte får plats.
  const MENU_SCROLLERS = [
    "#bottomBar", "#currentViewBar", "#currentSelectionBar .selection-tabs-scroll",
    "#moreMenuBar", "#toolbar", '#content .history-tabs[aria-label="Stats"]',
  ];

  function revealSelectedSubmenuItem() {
    requestAnimationFrame(() => {
      for (const selector of [
        "#currentViewBar", "#currentSelectionBar .selection-tabs-scroll", "#moreMenuBar",
        '#content .history-tabs[aria-label="Stats"]',
      ]) {
        const menu = document.querySelector(selector);
        if (!menu || menu.hidden || menu.clientWidth === 0) continue;
        const active = menu.querySelector(".on, [aria-selected=true]");
        if (!active) continue;
        const menuRect = menu.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        const margin = 10;
        if (activeRect.left < menuRect.left + margin) {
          menu.scrollLeft -= menuRect.left + margin - activeRect.left;
        } else if (activeRect.right > menuRect.right - margin) {
          menu.scrollLeft += activeRect.right - (menuRect.right - margin);
        }
      }
      for (const selector of MENU_SCROLLERS) hintMenuScroll(document.querySelector(selector));
    });
  }

  // Kanttoningen (se "sidscroll-hint" i style.css) visar att raden fortsätter,
  // men bara för den som tittar åt rätt håll. Första gången en rad faktiskt
  // har dolda val puttas den därför en liten bit åt höger och tillbaka —
  // rörelsen fångar ögat och visar samtidigt VAD som ligger utanför kanten.
  //
  // Villkoren håller den diskret: bara när något är dolt, bara om raden står
  // orörd i sitt vänsterläge (har man redan scrollat, eller har
  // revealSelectedSubmenuItem flyttat den till en aktiv flik, vet man
  // redan), och bara en gång per uppsättning val — måtten fungerar som
  // signatur, så en ombyggd men likadan rad puttas inte om. Aldrig med
  // "minska rörelse" påslaget.
  function hintMenuScroll(el) {
    if (!el || !sheetMode() || el.hidden) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hidden = el.scrollWidth - el.clientWidth;
    if (!el.clientWidth || hidden < 12 || el.scrollLeft > 2) return;
    const signature = el.scrollWidth + "/" + el.clientWidth;
    if (el.dataset.scrollHint === signature) return;
    el.dataset.scrollHint = signature;
    const distance = Math.min(30, hidden);
    const duration = 520;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // sin(t·π) går 0 -> 1 -> 0: ut och tillbaka i en enda mjuk rörelse.
      el.scrollLeft = distance * Math.sin(t * Math.PI);
      if (t < 1) requestAnimationFrame(step);
      else el.scrollLeft = 0;
    };
    requestAnimationFrame(step);
  }

  // Menyn ligger fast i toppen och krymper inte längre ihop vid scroll (den
  // hopfällbara "dynamic island" hörde till bottenplaceringen, där raden åt
  // läsyta i varje läge). Kvar behövs bara det som håller layouten i synk
  // när skärmen byter storlek eller korsar mobil/dator-brytpunkten.
  function setupResponsiveMenuLayout() {
    window.matchMedia(SHEET_QUERY).addEventListener("change", (event) => {
      enforceMobileMenuHost();
      // Inställningssidan är ett mobilläge. Vid byte till desktop återgår
      // innehållet till föregående vy; nästa öppning använder modal dialog.
      if (!event.matches && chrome.settingsViewOpen) {
        chrome.settingsViewOpen = false;
        chrome.currentMenuOpen = true;
        render();
      }
      requestAnimationFrame(renderBottomBar);
    });

    const refreshLayout = () => enforceMobileMenuHost();
    window.addEventListener("resize", refreshLayout, { passive: true });
    window.addEventListener("orientationchange", refreshLayout, { passive: true });
  }

  // Emoji har olika inbyggd storlek och baslinje mellan iOS/Android, vilket
  // fick huvudmenyns ikoner att se ut som olika storlekar trots
  // samma font-size. Enkla linjeikoner i samma 24x24-system blir optiskt
  // jämnstora och följer knappens currentColor i både ljust och mörkt tema.
  function bottomMenuIcon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    for (const [key, value] of Object.entries({
      class: "bottom-tab-icon-svg", viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    })) svg.setAttribute(key, value);
    const add = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      svg.append(el);
    };
    if (name === "current") {
      add("rect", { x: "3", y: "4", width: "18", height: "17", rx: "2" });
      add("path", { d: "M7 2v4M17 2v4M3 9h18" });
    } else if (name === "search") {
      add("circle", { cx: "11", cy: "11", r: "7" });
      add("path", { d: "m20 20-4-4" });
    } else if (name === "filter") {
      add("path", { d: "M4 5h16M7 12h10M10 19h4" });
    } else if (name === "filter-closed" || name === "filter-open") {
      add("path", { d: "M4 4h16M7 10h10M10 16h4" });
      add("path", { d: name === "filter-open" ? "m8 22 4-4 4 4" : "m8 19 4 4 4-4" });
    } else if (name === "collapse") {
      add("path", { d: "m6 14 6-6 6 6" });
    } else if (name === "stats") {
      add("path", { d: "M4 20V10M10 20V4M16 20v-7M22 20H2" });
    } else {
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("stroke", "none");
      for (const cx of [5, 12, 19]) add("circle", { cx: String(cx), cy: "12", r: "1.7" });
    }
    return svg;
  }

  function renderBottomBar() {
    const bar = $("#bottomBar");
    if (!bar) return;
    // [hidden] ska vara sanningen även semantiskt. Tidigare tvingade CSS
    // fram raden trots attributet, vilket gjorde den synlig men fortsatt
    // dold för hjälpmedel. Desktop har sin fulla toppnavigation.
    const mobile = sheetMode();
    // Ett sparat "håll menyn minimerad" ska gälla direkt vid sidladdning, inte
    // först när något råkar anropa setMenuCollapsed. Idempotent, så det är
    // ofarligt att den här raden körs vid varje omritning.
    if (mobile && chrome.menuMinimized) document.body.classList.add("menu-collapsed");
    else if (!mobile) document.body.classList.remove("menu-collapsed");
    enforceMobileMenuHost();
    renderDesktopNav();
    bar.hidden = !mobile;
    if (!mobile) {
      $("#currentViewBar").hidden = true;
      $("#currentSelectionBar").hidden = true;
      $("#moreMenuBar").hidden = true;
      return;
    }
    // Stats har ingen verktygsrad (se renderToolbar) — då ska filterknappen
    // inte heller finnas, annars öppnar den ett tomt ark. Stats egna
    // underflikar ligger i innehållet och göms när menyn är hopfälld.
    document.body.classList.toggle("stats-tabs-collapsed", state.view === "stats" && !chrome.statsMenuOpen);
    placeFooterLinks();
    if (CURRENT_VIEWS.includes(state.view)) chrome.lastCurrentView = state.view;
    const mainItem = (label, icon, pageActive, menuActive, onclick, extraClass) => h("button", {
      class: "bottom-tab" + (pageActive ? " page-on" : "") +
        (menuActive ? " menu-on" : "") + (extraClass ? " " + extraClass : ""),
      type: "button",
      ...(pageActive ? { "aria-current": "page" } : {}),
      "aria-expanded": String(menuActive),
      "aria-controls": icon === "filter" || icon === "filter-open" ? "toolbar" :
        icon === "current" ? "currentViewBar" :
        icon === "stats" ? "content" : "moreMenuBar",
      onclick,
    }, h("span", { class: "bottom-tab-icon", "aria-hidden": "true" }, bottomMenuIcon(icon)),
    h("span", { class: "bottom-tab-label" }, label));
    const inCurrentView = CURRENT_VIEWS.includes(state.view);
    const filterOpen = document.body.classList.contains("filters-open");
    const filtersExpanded = document.body.classList.contains("filters-expanded");
    // Sidläge och öppen meny är två olika saker: en tillfällig filter-/mer-
    // panel ska inte släcka markeringen för innehållet bakom den.
    const filterButton = mainItem(
      "Filter",
      filtersExpanded ? "filter-open" : "filter",
      false, filterOpen, () => {
        const leavingSettings = chrome.settingsViewOpen;
        chrome.settingsViewOpen = false;
        closeSubmenuOverlays({ closeFilters: false });
        chrome.currentMenuOpen = false; chrome.statsMenuOpen = false; chrome.moreMenuOpen = false;
        if (state.view === "stats") { state.view = chrome.lastCurrentView; saveUi(); render(); }
        else if (leavingSettings) render();
        if (filterOpen) {
          if (filtersExpanded) {
            toggleFiltersExpanded(false);
          } else {
            toggleFilterSheet(false);
          }
        } else {
          toggleFilterSheet();
        }
      }, "bottom-filter");
    if (activeFilterCount()) filterButton.append(
      h("span", { class: "bottom-filter-badge" }, String(activeFilterCount())));
    bar.replaceChildren(
      filterButton,
      mainItem("Aktuellt", "current", inCurrentView, inCurrentView && chrome.currentMenuOpen, () => {
        const leavingSettings = chrome.settingsViewOpen;
        chrome.settingsViewOpen = false;
        closeSubmenuOverlays(); toggleFilterSheet(false);
        chrome.statsMenuOpen = false; chrome.moreMenuOpen = false;
        if (leavingSettings) { chrome.currentMenuOpen = true; render(); }
        else if (inCurrentView) { chrome.currentMenuOpen = !chrome.currentMenuOpen; renderBottomBar(); }
        else { chrome.currentMenuOpen = true; state.view = chrome.lastCurrentView; saveUi(); render(); }
      }),
      mainItem("Statistik", "stats", state.view === "stats", state.view === "stats" && chrome.statsMenuOpen, () => {
        const leavingSettings = chrome.settingsViewOpen;
        chrome.settingsViewOpen = false;
        closeSubmenuOverlays(); toggleFilterSheet(false);
        chrome.currentMenuOpen = false; chrome.moreMenuOpen = false;
        // Inställningar är en egen innehållsvy på mobil. Om Statistik råkar
        // vara den underliggande state.view räcker det inte att bara rita om
        // bottenraden — då ligger inställningsdialogen kvar i #content.
        if (leavingSettings) {
          chrome.statsMenuOpen = true;
          state.view = "stats";
          saveUi(); render();
        }
        else if (state.view === "stats") { chrome.statsMenuOpen = !chrome.statsMenuOpen; renderBottomBar(); }
        else { chrome.statsMenuOpen = true; state.view = "stats"; saveUi(); render(); }
      }),
      mainItem("Mer", "more", chrome.settingsViewOpen, chrome.moreMenuOpen, () => {
        const leavingSettings = chrome.settingsViewOpen;
        chrome.settingsViewOpen = false;
        closeSubmenuOverlays(); toggleFilterSheet(false);
        chrome.currentMenuOpen = false; chrome.statsMenuOpen = false;
        chrome.moreMenuOpen = leavingSettings ? true : !chrome.moreMenuOpen;
        // Samma princip här: lämnar vi inställningsinnehållet krävs en hel
        // rendering. Därefter visas Mer-raden ovanpå den vanliga sidan.
        if (leavingSettings) render();
        else renderBottomBar();
      }),
      // Minimera: håller menyn hopfälld tills man själv fäller ut den igen,
      // också mellan besök. Ikonknapp utan etikett och med fast bredd — de
      // fyra flikarna delar på resten av raden, och en femte etikett hade
      // tryckt ihop dem till oläsbarhet på en smal telefon.
      h("button", {
        class: "bottom-tab bottom-minimize", type: "button",
        title: "Minimera menyn — ligger kvar tills du fäller ut den igen",
        "aria-label": "Minimera menyn",
        onclick: () => setMenuMinimized(true),
      }, h("span", { class: "bottom-tab-icon", "aria-hidden": "true" },
        bottomMenuIcon("collapse"))));
    renderCollapsedMenuBar();
    renderCurrentViewBar();
    renderMoreMenuBar();
    const selectionBar = $("#currentSelectionBar");
    if (selectionBar) {
      const supportsSelectionBar = state.view === "schema" ||
        state.view === "tabeller" || state.view === "slutspel";
      selectionBar.hidden = !(chrome.currentMenuOpen && supportsSelectionBar && selectionBar.childElementCount);
    }
    // (--bottombar-h behövdes när väljararken skulle sluta precis ovanför
    // bottenraden. Raden ligger i toppen nu och arken går ända ner till
    // skärmkanten; höjden på menyn publiceras i stället som --menuhost-h,
    // se syncTopStack.)
    syncBottomStack();
    revealSelectedSubmenuItem();
  }

  // Hopfälld meny: en enda rad i stället för två till fyra. Menyn tar annars
  // upp till en fjärdedel av en telefonskärm i varje läge, också när man bara
  // läser sig neråt i en lång matchlista. Raden svarar på "var är jag och vad
  // ser jag" — vy plus aktuell filtrering — och fäller ut hela menyn igen vid
  // tryck.
  function collapsedMenuLabel() {
    const labels = {
      schema: "Schema", tabeller: "Tabeller", slutspel: "Slutspel",
      bana: "Bana", stats: "Statistik",
    };
    const filter = filterSummaryText();
    return [
      labels[state.view] || cup().name,
      filter || (state.scope === "club" ? state.favoriteClub : "Hela cupen"),
    ].join(" · ");
  }

  function renderCollapsedMenuBar() {
    const bar = $("#menuCollapsedBar");
    if (!bar) return;
    const visible = sheetMode() && document.body.classList.contains("menu-collapsed");
    bar.hidden = !visible;
    if (!visible) { bar.replaceChildren(); return; }
    const filterCount = activeFilterCount();
    bar.replaceChildren(h("button", {
      class: "collapsed-menu-btn", type: "button",
      "aria-expanded": "false", "aria-controls": "bottomBar",
      title: "Visa menyn",
      onclick: () => setMenuMinimized(false),
    },
      h("span", { class: "collapsed-menu-icon", "aria-hidden": "true" },
        bottomMenuIcon("filter")),
      h("span", { class: "collapsed-menu-text" }, collapsedMenuLabel()),
      filterCount ? h("span", { class: "collapsed-menu-badge", "aria-label": filterCount + " aktiva filter" },
        String(filterCount)) : null,
      h("span", { class: "collapsed-menu-chevron", "aria-hidden": "true" })));
  }

  function setMenuCollapsed(collapsed) {
    collapsed = !!collapsed && sheetMode();
    if (collapsed === document.body.classList.contains("menu-collapsed")) return;
    // Menyn ligger ovanför innehållet i flödet, så att fälla in eller ut den
    // flyttar allt nedanför. Mät hur mycket innehållet FAKTISKT rörde sig och
    // flytta scrollpositionen lika mycket — då ligger raden man läste kvar på
    // samma plats på skärmen. Att mäta i stället för att räkna på menyns höjd
    // gör det självkorrigerande mot webbläsarens egen scroll-ankring.
    const content = $("#content");
    const startY = window.scrollY;
    const beforeTop = content ? content.getBoundingClientRect().top : 0;
    document.body.classList.toggle("menu-collapsed", collapsed);
    renderBottomBar();
    // Överst på sidan finns inget att kompensera: där SKA menyn bara växa
    // nedåt från sidhuvudet.
    if (!content || startY <= 2) return;
    const shift = Math.round(content.getBoundingClientRect().top - beforeTop);
    if (shift) window.scrollTo({ top: Math.max(0, window.scrollY + shift), behavior: "auto" });
  }

  // Har man själv tryckt upp menyn ska den inte smälla igen vid nästa lilla
  // skrollning — då krävs en halv skärm till av nedåtläsning först.
  // Hur långt man ska ha rullat NEDÅT I STRÄCK innan menyn fälls in.
  // Måttet är sträcka, inte position på sidan: förut krävdes en hel
  // skärmhöjd räknat från toppen, så menyn låg kvar och åt läsyta långt
  // efter att man tydligt börjat läsa neråt. Sträcka gör att den viker undan
  // så snart avsikten är klar, medan ett ryck eller en studs inte räcker.
  const MENU_COLLAPSE_TRAVEL = 64;
  // Har man SJÄLV fällt ut menyn krävs betydligt mer, annars smäller den
  // igen direkt efter att man bett om den.
  const MENU_COLLAPSE_TRAVEL_AFTER_TAP = 240;
  let downwardTravel = 0;
  let travelNeeded = MENU_COLLAPSE_TRAVEL;

  // Fast minimerad meny. Samma tanke som filterlåset: har man ställt in sitt
  // urval en gång vill man kunna titta in nu, om en timme och i morgon och
  // bara se schemat. Sparas GLOBALT och inte per cup — det är ett sätt att
  // använda appen på, inte en egenskap hos en viss cup.

  // Två lägen, inget dolt tredje: menyn syns = inte minimerad. Minimera-
  // knappen fäller ihop och håller kvar, ett tryck på den hopfällda raden
  // fäller ut och släpper. Att i stället låta raden öppna menyn "tillfälligt"
  // hade gett ett läge man inte kan se på skärmen vilket det är.
  function setMenuMinimized(on) {
    chrome.menuMinimized = !!on;
    persist(MENU_MINIMIZED_KEY, chrome.menuMinimized ? "1" : "0");
    if (chrome.menuMinimized) setMenuCollapsed(true);
    else expandMenuFromTap();
  }

  // Fäll in efter en kort nedåtrullning, fäll ut igen när man är tillbaka i
  // toppen. Bara nedåtrörelse fäller in: att också reagera på uppåtrörelse
  // mitt på sidan gjorde navigeringen ryckig under vanlig läsning (samma
  // erfarenhet som den gamla bottenmenyn). En vändning uppåt nollställer
  // däremot sträckan, så att läsa fram och tillbaka i en lista inte råkar
  // summera ihop till en infällning.
  function setupMenuAutoCollapse() {
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      lastY = y;
      if (!sheetMode() || chrome.settingsViewOpen) return;
      // Med ett ark eller en väljare öppen hänger den från menyn — då får
      // stacken inte byta höjd under fötterna på den.
      if (document.body.classList.contains("picker-open")) return;
      if (document.querySelector("dialog[open]:not(.settings-view)")) return;
      if (document.body.classList.contains("menu-collapsed")) {
        downwardTravel = 0;
        if (y <= 2 && !chrome.menuMinimized) {
          travelNeeded = MENU_COLLAPSE_TRAVEL;
          setMenuCollapsed(false);
        }
        return;
      }
      if (delta < 0) downwardTravel = 0;
      else downwardTravel += delta;
      // Inte medan menyn ändå håller på att rulla bort av sig själv: så länge
      // den inte ens hunnit fastna i toppen finns ingen läsyta att vinna.
      const host = document.querySelector("#mobileMenuHost");
      const menuH = host ? host.getBoundingClientRect().height : 0;
      if (downwardTravel >= travelNeeded && y >= menuH) {
        downwardTravel = 0;
        travelNeeded = MENU_COLLAPSE_TRAVEL;
        setMenuCollapsed(true);
      }
    }, { passive: true });
  }

  function expandMenuFromTap() {
    downwardTravel = 0;
    travelNeeded = MENU_COLLAPSE_TRAVEL_AFTER_TAP;
    setMenuCollapsed(false);
  }

  function renderCurrentViewBar() {
    const bar = $("#currentViewBar");
    if (!bar) return;
    const visible = !chrome.settingsViewOpen && CURRENT_VIEWS.includes(state.view) && chrome.currentMenuOpen;
    bar.hidden = !visible;
    if (!visible) { bar.replaceChildren(); return; }
    const supported = new Map($$("#viewTabs .tab").map((b) => [b.dataset.view, !b.hidden]));
    const labels = { schema: "Schema", tabeller: "Tabeller", slutspel: "Slutspel", bana: "Bana" };
    bar.replaceChildren(...CURRENT_VIEWS.filter((v) => supported.get(v) !== false).map((v) =>
      h("button", {
        class: "current-view-tab" + (state.view === v ? " on" : ""), type: "button",
        ...(state.view === v ? { "aria-current": "page" } : {}),
        onclick: () => {
          toggleFilterSheet(false);
          // När man går in i Tabeller på nytt ska hela det valda underlaget
          // synas. Ett specifikt klassläge väljs därefter i tredje raden;
          // annars kan ett gammalt läge få elva grupper att se ut som två.
          if (v === "tabeller" && state.view !== "tabeller") state.tableGroupKey = "all";
          state.view = v; saveUi(); render();
        },
      }, labels[v])));
  }

  function renderMoreMenuBar() {
    const bar = $("#moreMenuBar");
    if (!bar) return;
    bar.hidden = !chrome.moreMenuOpen;
    if (!chrome.moreMenuOpen) { bar.replaceChildren(); return; }
    const activeSheet = openPrototypeSheetKey();
    const action = (label, fn, sheetKey) => h("button", {
      class: "current-view-tab more-submenu-tab" +
        (activeSheet === sheetKey || (sheetKey === "settings" && chrome.settingsViewOpen) ? " on" : ""),
      type: "button",
      "aria-pressed": String(activeSheet === sheetKey ||
        (sheetKey === "settings" && chrome.settingsViewOpen)),
      ...(sheetKey ? { "data-sheet-key": sheetKey } : {}),
      onclick: fn,
    }, label);
    const leaveSettingsThen = (fn) => {
      if (chrome.settingsViewOpen) {
        chrome.settingsViewOpen = false;
        chrome.currentMenuOpen = false;
        chrome.moreMenuOpen = true;
        // Flytta tillbaka #settingsDialog från #content innan nästa panel
        // öppnas. render() är synkron; därefter kan Export/Hjälp/Om använda
        // sina vanliga öppningsfunktioner precis som från vilken sida som
        // helst.
        render();
      }
      fn();
    };
    bar.replaceChildren(
      action("Dela", () => leaveSettingsThen(openHeaderExportDialog), "export"),
      action("Inställningar", () => {
        // En redan öppen Export-panel ska aldrig ligga kvar över
        // inställningsvyn. openSettings städar också, men gör växlingen
        // explicit här så Mer-alternativen alltid är ömsesidigt uteslutande.
        closePrototypeDialogs();
        if (chrome.settingsViewOpen) {
          chrome.settingsViewOpen = false;
          chrome.currentMenuOpen = false;
          chrome.moreMenuOpen = true;
          render();
        } else $("#settingsBtn").click();
      }, "settings"),
      action("Hjälp", () => leaveSettingsThen(() => {
        closePrototypeDialogs();
        $("#helpBtn").click();
      })),
      action("Om", () => leaveSettingsThen(() => {
        closePrototypeDialogs();
        HB.openWelcome();
      })));
  }

  function placeFooterLinks() {
    const footer = document.querySelector("body > footer");
    const linkSlot = $("#settingsLinks");
    if (!footer || !linkSlot) return;
    const host = sheetMode() ? linkSlot : footer;
    for (const el of [...footer.children, ...linkSlot.children]) {
      if (el.tagName === "SPAN") continue;
      if (el.parentElement !== host) host.append(el);
    }
  }

export {
  activeFilterCount,
  renderDesktopNav,
  closeSubmenuOverlays,
  scrollTopRevealY,
  revealSelectedSubmenuItem,
  setupResponsiveMenuLayout,
  bottomMenuIcon,
  renderBottomBar,
  collapsedMenuLabel,
  renderCollapsedMenuBar,
  setMenuCollapsed,
  setMenuMinimized,
  setupMenuAutoCollapse,
  expandMenuFromTap,
  renderCurrentViewBar,
  renderMoreMenuBar,
  placeFooterLinks,
};
