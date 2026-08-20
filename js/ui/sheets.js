/* sheets.js — mobilark, picker-portal, viewport och stackhöjder. */

import { h, $, $$ } from "../dom.js";

export const SHEET_QUERY = "(max-width: 700px)";

let persist, storageGet, render, renderToolbar, renderBottomBar, state;

export function initSheets(deps) {
  persist = deps.persist;
  storageGet = deps.storageGet;
  render = deps.render;
  renderToolbar = deps.renderToolbar;
  renderBottomBar = deps.renderBottomBar;
  state = deps.state;
}

export function closeFilterBackdrop() {
  if (filterBackdrop) {
    filterBackdrop.remove();
    filterBackdrop = null;
  }
}

  function closePrototypeDialogs() {
    for (const dlg of document.querySelectorAll("dialog.prototype-sheet[open]")) dlg.close();
  }

  function openPrototypeSheetKey() {
    const open = document.querySelector("dialog.prototype-sheet[open]");
    return open ? open.dataset.sheetKey || "" : "";
  }

  // Hur långt ned menyn i toppen slutar — arket hänger därifrån och kan som
  // mest bli så högt som resten av skärmen. Hette tidigare
  // prototypeBottomStackHeight och mätte bottenradens höjd.
  function prototypeMenuStackBottom() {
    const measured = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--topstack-bottom"));
    return Number.isFinite(measured) ? measured : 0;
  }

  function prototypeDialog(title, sheetKey, anchorElement = null) {
    const existing = document.querySelector("dialog.prototype-sheet[open]");
    if (existing && existing.dataset.sheetKey === sheetKey) {
      existing.close();
      return null;
    }
    closePrototypeDialogs();
    // På dator hör cupval och export direkt till varsin knapp i sidhuvudet.
    // Visa därför samma innehåll som ett förankrat popover där. Mobilen
    // behåller sina rymligare ark eftersom knapparna då ligger i menyraderna.
    const anchoredDesktop = !sheetMode() && anchorElement instanceof HTMLElement &&
      anchorElement.getClientRects().length > 0;
    const backdrop = h("div", {
      class: "prototype-sheet-backdrop" +
        (sheetKey === "export" || anchoredDesktop ? " prototype-sheet-backdrop-menu" : "") +
        (anchoredDesktop ? " prototype-sheet-backdrop-popover" : ""),
    });
    const fullScreenOnMobile = sheetKey === "export" && sheetMode();
    const body = h("div", { class: "prototype-sheet-body" });
    const grip = h("button", { class: "prototype-sheet-grip", type: "button",
      "aria-label": "Dra för att ändra panelens höjd",
      ...(fullScreenOnMobile ? { hidden: true } : {}) }, h("span"));
    const titleId = "prototypeSheetTitle-" + sheetKey;
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const dlg = h("dialog", {
      class: "prototype-sheet" + (fullScreenOnMobile ? " prototype-sheet-fullscreen" : "") +
        (anchoredDesktop ? " prototype-sheet-popover" : ""),
      "data-sheet-key": sheetKey,
      "aria-labelledby": titleId,
      tabindex: "-1",
    },
      h("div", { class: "prototype-sheet-head" },
        h("h2", { id: titleId }, title),
        h("button", { class: "dialog-x", type: "button", "aria-label": "Stäng",
          onclick: () => dlg.close() }, "×")), body,
      // Handtaget SIST: arket hänger från menyn i toppen och växer nedåt, så
      // det är underkanten som rör sig när man drar. Låg det kvar i
      // rubrikraden drog man i den ena änden och såg den andra flytta sig.
      grip);
    let cleanupPopover = () => {};
    backdrop.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      cleanupPopover();
      if (anchoredDesktop) anchorElement.setAttribute("aria-expanded", "false");
      backdrop.remove(); dlg.remove();
      syncPageScrollLock();
      requestAnimationFrame(() => {
        renderBottomBar();
        const target = returnFocus && returnFocus.isConnected
          ? returnFocus
          : document.querySelector(`#moreMenuBar [data-sheet-key="${sheetKey}"]`);
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      });
    });
    dlg.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dlg.close();
    });
    if (!fullScreenOnMobile && !anchoredDesktop) grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startHeight = dlg.getBoundingClientRect().height;
      const move = (ev) => {
        const viewportH = (window.visualViewport && window.visualViewport.height) || innerHeight;
        const topH = prototypeMenuStackBottom();
        const maxHeight = Math.max(260, viewportH - topH - 12);
        const next = Math.max(220, Math.min(maxHeight, startHeight + ev.clientY - startY));
        dlg.style.height = Math.round(next) + "px";
      };
      const stop = () => {
        const viewportH = (window.visualViewport && window.visualViewport.height) || innerHeight;
        const topH = prototypeMenuStackBottom();
        const available = Math.max(260, viewportH - topH - 12);
        const ratio = Math.max(0.25, Math.min(1, dlg.getBoundingClientRect().height / available));
        persist("hb:menuSheetHeight:" + sheetKey, String(ratio));
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", stop);
        grip.removeEventListener("pointercancel", stop);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", stop);
      grip.addEventListener("pointercancel", stop);
    });
    // Arket hänger från menyn: mät var den ligger PRECIS nu (överst på sidan
    // sitter den under sidhuvudet, nedscrollad mot skärmkanten) innan arket
    // positioneras mot --topstack-bottom.
    syncTopStack();
    document.body.append(backdrop, dlg);
    dlg.show();
    syncPageScrollLock();
    if (anchoredDesktop) {
      anchorElement.setAttribute("aria-expanded", "true");
      const gap = 8;
      const edge = 12;
      let positionRaf = 0;
      const positionPopover = () => {
        positionRaf = 0;
        if (!dlg.open || !anchorElement.isConnected) return;
        const anchorRect = anchorElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Mät först med hela skärmhöjden tillgänglig. Välj därefter sidan
        // med mest plats och låt bara innehållet scrolla om det verkligen
        // inte ryms vare sig över eller under knappen.
        dlg.style.maxHeight = Math.max(180, viewportHeight - edge * 2) + "px";
        let dialogRect = dlg.getBoundingClientRect();
        const below = Math.max(0, viewportHeight - edge - anchorRect.bottom - gap);
        const above = Math.max(0, anchorRect.top - gap - edge);
        const placeAbove = below < Math.min(dialogRect.height, 260) && above > below;
        const availableHeight = Math.max(180, placeAbove ? above : below);
        dlg.style.maxHeight = availableHeight + "px";
        dialogRect = dlg.getBoundingClientRect();

        const maxLeft = Math.max(edge, viewportWidth - edge - dialogRect.width);
        const left = Math.max(edge, Math.min(anchorRect.right - dialogRect.width, maxLeft));
        const top = placeAbove
          ? Math.max(edge, anchorRect.top - gap - dialogRect.height)
          : Math.min(viewportHeight - edge - dialogRect.height, anchorRect.bottom + gap);
        dlg.style.left = Math.round(left) + "px";
        dlg.style.top = Math.round(Math.max(edge, top)) + "px";
      };
      const schedulePosition = () => {
        if (!positionRaf) positionRaf = requestAnimationFrame(positionPopover);
      };
      const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(schedulePosition) : null;
      resizeObserver?.observe(dlg);
      resizeObserver?.observe(anchorElement);
      window.addEventListener("resize", schedulePosition);
      window.addEventListener("scroll", schedulePosition, true);
      window.visualViewport?.addEventListener("resize", schedulePosition);
      window.visualViewport?.addEventListener("scroll", schedulePosition);
      cleanupPopover = () => {
        if (positionRaf) cancelAnimationFrame(positionRaf);
        resizeObserver?.disconnect();
        window.removeEventListener("resize", schedulePosition);
        window.removeEventListener("scroll", schedulePosition, true);
        window.visualViewport?.removeEventListener("resize", schedulePosition);
        window.visualViewport?.removeEventListener("scroll", schedulePosition);
      };
      schedulePosition();
    }
    requestAnimationFrame(() => {
      if (!dlg.contains(document.activeElement)) dlg.focus({ preventScroll: true });
    });
    try {
      const saved = +localStorage.getItem("hb:menuSheetHeight:" + sheetKey);
      if (!fullScreenOnMobile && !anchoredDesktop && saved >= 0.25 && saved <= 1) {
        const viewportH = (window.visualViewport && window.visualViewport.height) || innerHeight;
        const topH = prototypeMenuStackBottom();
        dlg.style.height = Math.round((viewportH - topH - 12) * saved) + "px";
      }
    } catch { /* privat läge/full lagring: använd CSS-höjden */ }
    requestAnimationFrame(renderBottomBar);
    return { dlg, body };
  }

  // Total höjd på ALLT som ligger fast i botten just nu: bottenraden plus
  // filterremsan när den är uppfälld. Väljarpanelerna utgår från den och
  // lägger sig OVANFÖR i stället för att täcka raderna man just navigerade
  // med. Mäts i stället för att räknas ut — remsans höjd beror på hur många
  // brickor som ryms och på safe-area.
  let bottomStackRaf = null;

  function setBottomStackHeight(nextHeight) {
    const root = document.documentElement;
    const target = Math.max(0, Math.round(nextHeight));
    const current = parseFloat(root.style.getPropertyValue("--bottomstack-h")) || parseFloat(
      getComputedStyle(root).getPropertyValue("--bottomstack-h")) || 56;
    if (current === target || !sheetMode()) {
      root.style.setProperty("--bottomstack-h", target + "px");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.style.setProperty("--bottomstack-h", target + "px");
      return;
    }
    if (bottomStackRaf) cancelAnimationFrame(bottomStackRaf);
    const from = current;
    const to = target;
    const start = performance.now();
    const duration = 190;
    const easeOut = (x) => 1 - (1 - x) * (1 - x);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round(from + (to - from) * easeOut(t));
      root.style.setProperty("--bottomstack-h", v + "px");
      if (t < 1) bottomStackRaf = requestAnimationFrame(tick);
      else bottomStackRaf = null;
    };
    bottomStackRaf = requestAnimationFrame(tick);
  }

  function cssLengthToPx(value) {
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === "none" || normalized === "auto") return NaN;
    const n = parseFloat(normalized);
    if (!Number.isFinite(n)) return NaN;
    if (normalized.endsWith("vh")) return (window.innerHeight * n) / 100;
    if (normalized.endsWith("dvh")) return (window.innerHeight * n) / 100;
    if (normalized.endsWith("px")) return n;
    return n;
  }

  function syncBottomStack({ animate = false } = {}) {
    if (!animate && bottomStackRaf) {
      cancelAnimationFrame(bottomStackRaf);
      bottomStackRaf = null;
    }
    const bar = $("#bottomBar");
    let h = 0;
    if (bar) {
      const barStyle = getComputedStyle(bar);
      if (barStyle.position === "fixed" && barStyle.bottom !== "auto") {
        h = bar.getBoundingClientRect().height;
      }
    }
    const toolbar = $("#toolbar");
    if (toolbar && getComputedStyle(toolbar).position === "fixed") {
      let toolbarHeight = toolbar.getBoundingClientRect().height;
      const maxHeight = cssLengthToPx(getComputedStyle(toolbar).maxHeight);
      if (Number.isFinite(maxHeight)) toolbarHeight = Math.min(toolbar.scrollHeight, maxHeight);
      h += toolbarHeight;
    }
    // Allt annat som ligger FAST i botten just nu: filterremsan när den är
    // uppfälld, och Stats-underflikarna på den fliken. Mäts i stället för
    // att räknas ut — höjderna beror på antal brickor, teckenstorlek och
    // safe-area, och en gissad siffra gömmer slutet på matchlistan.
    for (const sel of ["#currentViewBar", "#currentSelectionBar", "#moreMenuBar", '#content .history-tabs[aria-label="Stats"]']) {
      const el = document.querySelector(sel);
      if (el && getComputedStyle(el).position === "fixed") {
        h += el.getBoundingClientRect().height;
      }
    }
    if (animate) setBottomStackHeight(h);
    else document.documentElement.style.setProperty("--bottomstack-h", Math.round(h) + "px");
    syncTopStack();
  }

  // Motsvarigheten till --bottomstack-h för menyn, nu när den ligger i
  // toppen. Två mått eftersom två olika saker behöver dem:
  //   --menuhost-h  bara menyraderna (#mobileMenuHost). Filterremsan
  //                 klistrar sig direkt under dem (style.css).
  //   --topstack-h  menyraderna PLUS filterremsan — allt som ligger fast
  //                 överst. Innehållets EGNA klistrade rader
  //                 (orienteringsraden, tabellernas gruppflikar, tidslinjens
  //                 rubrikrad) stannar mot det måttet i stället för mot
  //                 skärmkanten, där de hamnade bakom menyn och blev
  //                 osynliga så fort man scrollat förbi dem.
  // Mäts i stället för att räknas ut: höjden beror på hur många undernivåer
  // som är öppna just nu, på teckenstorlek och på hur många brickor som ryms.
  function syncTopStack() {
    const root = document.documentElement;
    if (!sheetMode()) {
      root.style.setProperty("--menuhost-h", "0px");
      root.style.setProperty("--topstack-h", "0px");
      root.style.setProperty("--topstack-bottom", "0px");
      return;
    }
    // Rektangeln för ett element som räknas till stacken, annars null.
    // Höjdkravet är inte en detalj: #toolbar behåller sin inline-satta
    // position:sticky även när den är DOLD (toggleFilterSheet sätter den en
    // gång och tar aldrig bort den), och en dold rad mäter noll — utan
    // kontrollen blev stackens underkant 0 och arken la sig över menyn.
    // Det UTFÄLLDA filterarket ("Mer") räknas inte heller in: det är ett
    // tillfälligt ark med eget bakgrundstäcke och ska inte trycka ner
    // innehållets klistrade rader med 72 vh.
    const stackRect = (el) => {
      if (!el || getComputedStyle(el).position !== "sticky") return null;
      const rect = el.getBoundingClientRect();
      return rect.height > 0 ? rect : null;
    };
    const hostRect = stackRect($("#mobileMenuHost"));
    const stripRect = document.body.classList.contains("filters-expanded")
      ? null : stackRect($("#toolbar"));
    const hostH = hostRect ? hostRect.height : 0;
    root.style.setProperty("--menuhost-h", Math.round(hostH) + "px");
    root.style.setProperty("--topstack-h",
      Math.round(hostH + (stripRect ? stripRect.height : 0)) + "px");
    // --topstack-h är en HÖJD och duger för sticky (den säger var raden ska
    // fastna). Ett position:fixed-ark behöver i stället stackens faktiska
    // UNDERKANT i viewporten, och de två är olika saker: överst på sidan
    // ligger menyn nedanför sidhuvudet, inte mot skärmkanten. Med höjden som
    // toppvärde la sig arket rakt över filterremsan.
    const bottoms = [hostRect, stripRect].filter(Boolean).map((r) => r.bottom);
    root.style.setProperty("--topstack-bottom",
      Math.round(bottoms.length ? Math.max(0, ...bottoms) : 0) + "px");
  }

  let filterBackdrop = null;

  let filterStripScrollLeft = 0;

  // Den kompakta remsan är BARA brickraden: omslagen (details/toolbar-body/
  // row) bidrog med marginaler och gjorde raden 73 px mot menyradens 49.
  //
  // Men bara i kompakt läge. Tidigare plattades raden till oavsett läge,
  // och då fanns det ingenting kvar för "Mer" att fälla ut — knappen bytte
  // bara padding och rundade hörn på exakt samma rad. Det som föll bort var
  // fritextsöket (som saknar egen väg in på mobil), filterlåset och
  // visningsvalen för en låst vy.
  function flattenMobileFilterBar(bar) {
    if (!sheetMode()) return;
    if (document.body.classList.contains("filters-expanded")) return;
    const group = bar.querySelector(".filter-primary-row .filter-group");
    if (group && group.parentElement !== bar) bar.replaceChildren(group);
  }

  function restoreFilterStripScroll() {
    if (!sheetMode()) return;
    requestAnimationFrame(() => {
      const strip = document.querySelector("#toolbar");
      if (strip) strip.scrollLeft = Math.min(filterStripScrollLeft,
        Math.max(0, strip.scrollWidth - strip.clientWidth));
    });
  }

  function setupFilterStripScrollMemory() {
    document.addEventListener("scroll", (event) => {
      if (event.target instanceof Element && event.target.matches("#toolbar")) {
        filterStripScrollLeft = event.target.scrollLeft;
      }
    }, { capture: true, passive: true });
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
    const toolbar = $("#toolbar");
    if (toolbar && sheetMode()) {
      toolbar.style.position = "sticky";
      // inset FÖRST — den nollställer top/right/bottom/left och skrev
      // tidigare över top:0 på raden efter, så remsan aldrig klistrade sig.
      toolbar.style.inset = "auto";
      toolbar.style.top = "var(--menuhost-h, 0px)";
    }
    // Efter en bildruta: remsan måste hinna få sin layout innan den mäts.
    requestAnimationFrame(() => syncBottomStack({ animate: true }));
    // Verktygsradens egen ihopfällning är meningslös inne i arket — arket ÄR
    // den öppna/stängda växlingen. Tvinga upp den så man inte behöver två
    // klick för att komma åt filtren.
    if (open) {
      state.toolbarOpen = true;
      const dd = document.querySelector(".toolbar-collapse");
      if (dd) dd.open = true;
      // Ingen scrollIntoView längre: remsan låg förut fast i botten, där en
      // scroll till den var harmlös. Nu ligger den klistrad högst upp i
      // dokumentet — samma anrop kastade i stället tillbaka läsaren till
      // sidans början varje gång Filter öppnades. Den är ändå alltid synlig.
    }
    renderBottomBar();
  }

  function setFiltersExpanded(open) {
    if (!sheetMode() || !document.body.classList.contains("filters-open")) return;
    open = !!open;
    const expanded = document.body.classList.contains("filters-expanded");
    if (expanded === open) return;
    document.body.classList.toggle("filters-expanded", open);
    syncFilterBackdrop();
    // Verktygsraden måste byggas OM, inte bara stylas om: flattenMobileFilter-
    // Bar kastar bort allt utom brickraden i kompakt läge, så resten (sök,
    // lås, visningsval) finns inte kvar i DOM:et att fälla ut.
    renderToolbar();
    reconcilePickerChrome();
    requestAnimationFrame(() => {
      syncBottomStack({ animate: true });
      renderBottomBar();
    });
  }

  function toggleFiltersExpanded(force) {
    const open = document.body.classList.contains("filters-open");
    const want = force === undefined ? !document.body.classList.contains("filters-expanded") : !!force;
    if (!sheetMode()) return;
    if (!open) {
      toggleFilterSheet(true);
      requestAnimationFrame(() => setFiltersExpanded(want));
      return;
    }
    setFiltersExpanded(want);
  }

  // --- mobil: filterpanelerna som bottenark --------------------------------
  // På smal skärm öppnas varje picker som ett ark underifrån i stället för
  // som en dropdown under sin knapp (se motsvarande @media i style.css).
  // Löser att en knapp långt till höger sköt ut panelen utanför skärmkanten,
  // och ger samtidigt hela bredden åt sök- och kryssrutor.
  //
  // Allt hängs på via delegering på document i stället för i buildPicker, så
  // det gäller ALLA pickers — även exportmenyn, som bygger sin panel själv.
  const SHEET_MIN_VH = 25;   // hur lågt arket får dras innan det är meningslöst
  const SHEET_MAX_VH = 92;   // ...och hur högt, med lite luft kvar upptill
  let sheetBackdrop = null;
  const portaledPickerPanels = new Map();

  function sheetMode() {
    return window.matchMedia(SHEET_QUERY).matches;
  }

  // För att undvika att gamla CSS-regler låser menyn i botten efter en
  // driftsättning, och för att kunna byta mellan mobile/desktop snabbt vid
  // orienteringsändring, styr vi själv de fyra mobilraderna här och ser till
  // att de faktiskt ligger i #mobileMenuHost.
  function enforceMobileMenuHost() {
    const host = document.querySelector("#mobileMenuHost");
    const desktopFilterHost = document.querySelector("#desktopFilterHost");
    const toolbar = document.querySelector("#toolbar");
    const mobile = sheetMode();
    const ids = ["bottomBar", "currentViewBar", "currentSelectionBar", "moreMenuBar"];
    const fixed = [
      { prop: "position", value: "static", important: true },
      { prop: "left", value: "auto", important: true },
      { prop: "right", value: "auto", important: true },
      { prop: "top", value: "auto", important: true },
      { prop: "bottom", value: "auto", important: true },
      { prop: "transform", value: "none", important: true },
      { prop: "z-index", value: "auto", important: true },
      { prop: "inset", value: "auto", important: true },
      { prop: "width", value: "100%", important: false },
    ];
    for (const id of ids) {
      const el = document.querySelector("#" + id);
      if (!el) continue;
      if (mobile && host && el.parentElement !== host) host.append(el);
      for (const { prop, value, important } of fixed) {
        if (mobile) {
          if (prop === "width") {
            el.style.setProperty(prop, value);
          } else {
            el.style.setProperty(prop, value, important ? "important" : undefined);
          }
        } else {
          el.style.removeProperty(prop);
        }
      }
      el.style.margin = mobile ? "0" : "";
    }
    if (mobile && host) {
      host.style.setProperty("position", "sticky", "important");
      host.style.setProperty("top", "0px", "important");
      host.style.setProperty("background", "var(--menu-surface)", "important");
      syncMenuHostLayer();
    } else if (host) {
      host.style.removeProperty("position");
      host.style.removeProperty("top");
      host.style.removeProperty("z-index");
      host.style.removeProperty("background");
    }
    // Samma filterkontroller är mobilens remsa men datorns tredje
    // menynivå. Flytta noden (inte en kopia) så lyssnare, öppna väljare och
    // tillgänglighetskopplingar alltid är gemensamma i de två layouterna.
    if (toolbar) {
      if (mobile && host && host.nextElementSibling !== toolbar) host.after(toolbar);
      else if (!mobile && desktopFilterHost && toolbar.parentElement !== desktopFilterHost) {
        desktopFilterHost.append(toolbar);
      }
    }
  }

  function savedSheetHeight() {
    const v = +storageGet("hb:sheetVh", 0);
    return v >= SHEET_MIN_VH && v <= SHEET_MAX_VH ? v : 0;
  }

  // Rubrikrad med titel och stängkryss, plus ett draghandtag längst NED i
  // panelen. Byggs en gång per panel och återanvänds; titeln uppdateras vid
  // varje öppning eftersom knappens text ändras med urvalet ("Alla lag" ->
  // "Lag (3)").
  //
  // Handtaget satt tidigare i rubrikraden, för ett ark som växte uppåt från
  // skärmens botten. Nu hänger arket från menyn och växer NEDÅT — då hör
  // handtaget hemma vid den kant som faktiskt rör sig, annars drar man i
  // ena änden och ser den andra röra sig. Head och handtag säkras var för
  // sig så en ombyggd panel aldrig blir av med bara det ena.
  function ensureSheetHead(dd) {
    const panel = dd.querySelector(".team-picker-panel");
    if (!panel) return null;
    const summary = dd.querySelector("summary");
    let head = panel.querySelector(".picker-sheet-head");
    if (!head) {
      const title = h("span", { class: "picker-sheet-title" });
      const close = h("button", {
        class: "picker-sheet-close", type: "button", "aria-label": "Stäng",
        onclick: () => { dd.open = false; },
      }, "×");
      head = h("div", { class: "picker-sheet-head" }, title, close);
      panel.prepend(head);
    }
    if (!panel.querySelector(":scope > .picker-sheet-grip")) {
      const grip = h("span", { class: "picker-sheet-grip", "aria-hidden": "true" });
      panel.append(grip);
      attachSheetDrag(grip, panel);
    }
    head.querySelector(".picker-sheet-title").textContent =
      (summary && summary.textContent.trim()) || "Filter";
    return head;
  }

  // Dra handtaget för att välja höjd. Arket hänger från menyn, så NEDÅT =
  // högre ark: höjden räknas från startpunkten PLUS aktuell y. Höjden sparas
  // så nästa öppning (och nästa besök) behåller den man valt.
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
      const raw = (startH + (e.clientY - startY)) / vh;
      const clamped = Math.min(SHEET_MAX_VH, Math.max(SHEET_MIN_VH, raw));
      // Standardläget är auto-höjd (panelen följer innehållet). Ett manuellt
      // drag får däremot vara ett uttryckligt önskemål och låser höjden tills
      // nästa panel byggs om.
      panel.style.height = clamped.toFixed(1) + "vh";
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

  // Bakgrunden ska stå stilla medan ett ark eller en väljarpanel är öppen.
  // INTE med overflow: hidden — den gör html/body till en egen scrollbox och
  // slår ut position:sticky på HELA sidan, så menyn i toppen rullar iväg och
  // arket som hänger från den lämnas med ett växande glapp (se den utförliga
  // kommentaren vid picker-open i style.css). Här blockeras i stället själva
  // gesten. Layouten rörs inte alls, och sticky fortsätter fungera.
  let pageScrollLocked = false;

  // Menyn ska ligga ÖVER väljarens bakgrundstäcke: en öppen panel ska inte
  // släcka ner raden man just tryckte i, och man ska kunna byta flik eller
  // öppna en annan bricka direkt utan att först stänga panelen.
  //
  // Lyftet måste ske på HOSTEN. Raderna ligger inuti dess staplingskontext
  // sedan menyn flyttade upp, så deras egna z-index når aldrig utanför —
  // filterremsan (syskon till hosten) lyste klart medan huvudmenyn precis
  // ovanför låg kvar under täcket. Inline eftersom hostens z-index skrivs
  // med !important i enforceMobileMenuHost och inte kan bytas från CSS.
  function syncMenuHostLayer() {
    const host = $("#mobileMenuHost");
    if (!host) return;
    if (!sheetMode()) { host.style.removeProperty("z-index"); return; }
    const överTäcket = document.body.classList.contains("picker-open");
    host.style.setProperty("z-index", överTäcket ? "85" : "72", "important");
  }

  function syncPageScrollLock() {
    const open = sheetMode() && (!!document.querySelector(".team-picker-dd[open]") ||
      !!document.querySelector("dialog.prototype-sheet[open]"));
    if (open === pageScrollLocked) return;
    pageScrollLocked = open;
    const method = open ? "addEventListener" : "removeEventListener";
    document[method]("wheel", blockBackgroundScroll, { passive: false, capture: true });
    document[method]("touchmove", blockBackgroundScroll, { passive: false, capture: true });
    // Skyddsnät: skulle sidan ändå röra sig (tangentbord, kvardröjande
    // momentum, programmatisk scroll) följer arket med menyn i stället för
    // att bli hängande på sin gamla plats.
    window[method]("scroll", syncTopStack, { passive: true });
  }

  function blockBackgroundScroll(event) {
    if (event.type === "touchmove"
      ? hasScrollableAncestor(event.target)
      : canScrollHere(event.target, event.deltaX, event.deltaY)) return;
    if (event.cancelable) event.preventDefault();
  }

  // Släpp igenom gesten bara när den sker i något som FAKTISKT kan rulla åt
  // det håll den drar — annars kedjas den vidare till sidan bakom. Vid
  // pekgester är riktningen okänd när touchmove börjar, så där räcker det
  // att ytan går att scrolla i någon riktning; kanterna sköts av
  // overscroll-behavior: contain på panelerna och menyraderna.
  function scrollableAxis(el, horizontal) {
    const overflow = getComputedStyle(el)[horizontal ? "overflowX" : "overflowY"];
    if (!/(auto|scroll)/.test(overflow)) return 0;
    const room = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    return room >= 2 ? room : 0;
  }

  function hasScrollableAncestor(target) {
    for (let el = target instanceof Element ? target : null;
      el && el !== document.body; el = el.parentElement) {
      if (scrollableAxis(el, false) || scrollableAxis(el, true)) return true;
    }
    return false;
  }

  function canScrollHere(target, dx, dy) {
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const delta = horizontal ? dx : dy;
    for (let el = target instanceof Element ? target : null;
      el && el !== document.body; el = el.parentElement) {
      const room = scrollableAxis(el, horizontal);
      if (!room) continue;
      if (!delta) return true;
      const pos = horizontal ? el.scrollLeft : el.scrollTop;
      return delta < 0 ? pos > 0 : pos < room - 1;
    }
    return false;
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

  function portalPickerPanel(dd) {
    if (!sheetMode() || portaledPickerPanels.has(dd)) return;
    const panel = dd.querySelector(":scope > .team-picker-panel");
    if (!panel) return;
    portaledPickerPanels.set(dd, panel);
    panel.classList.add("picker-panel-portaled");
    document.body.append(panel);
  }

  function restorePickerPanel(dd) {
    const panel = portaledPickerPanels.get(dd);
    if (!panel) return;
    panel.classList.remove("picker-panel-portaled");
    if (dd.isConnected) dd.append(panel);
    else panel.remove();
    portaledPickerPanels.delete(dd);
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
    for (const [dd] of portaledPickerPanels) {
      if (!dd.isConnected || !dd.open) restorePickerPanel(dd);
    }
    const nagonOppen = !!document.querySelector(".team-picker-dd[open]");
    syncSheetBackdrop(nagonOppen && sheetMode());
    document.body.classList.toggle("picker-open", nagonOppen);
    syncMenuHostLayer();
    syncPageScrollLock();
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
    // Väljarpanelernas höjd sattes i vh, alltså mot LAYOUT-viewporten. Med
    // tangentbordet uppe (eller ett utfällt adressfält) är den synliga ytan
    // mycket lägre än så, och panelen växte då ut under skärmkanten med
    // sina översta knappar utom räckhåll. Publicera den synliga höjden så
    // CSS kan begränsa panelen mot den i stället.
    document.documentElement.style.setProperty("--vv-height", Math.round(vv.height) + "px");
  }

  // Alla mått som beror på skärmens storlek, i ETT anrop. Bottenraden och
  // bottenstacken mättes bara om när brytpunkten (max-width: 700px) korsades
  // — men en rotation mellan porträtt och landskap på en telefon (t.ex.
  // 375x667 → 667x375) ligger i mobilläge i BÅDA riktningarna. matchMedia
  // ändrade alltså inte värde, lyssnaren kördes aldrig, och panelerna
  // positionerades mot gårdagens höjder efter varje vridning.
  function syncViewportMetrics() {
    syncViewportOffset();
    syncBottomStack();
  }

  function setupViewportOffset() {
    // resize/orientationchange gäller ALLA enheter och behövs även utan
    // Visual Viewport-API:t — därför utanför vv-kontrollen nedan.
    window.addEventListener("resize", syncViewportMetrics);
    window.addEventListener("orientationchange", () => setTimeout(syncViewportMetrics, 250));
    const vv = window.visualViewport;
    if (!vv) { syncBottomStack(); return; }
    // scroll OCH resize: adressfältet ändrar höjd under scrollning, inte
    // bara vid ett omritningstillfälle.
    vv.addEventListener("resize", syncViewportMetrics);
    vv.addEventListener("scroll", syncViewportOffset);
    syncViewportMetrics();
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
          if (other !== dd) { other.open = false; restorePickerPanel(other); }
        }
        if (!sheetMode()) return;
        const head = ensureSheetHead(dd);
        const saved = savedSheetHeight();
        if (head && saved) {
          dd.querySelector(".team-picker-panel").style.height = saved + "vh";
        }
        // Arket hänger från menyn och måste veta var den ligger PRECIS nu:
        // överst på sidan sitter den under sidhuvudet, nedscrollad mot
        // skärmkanten. Sidan låses ändå så fort panelen är öppen.
        syncTopStack();
        portalPickerPanel(dd);
      } else restorePickerPanel(dd);
      const nagonOppen = !!document.querySelector(".team-picker-dd[open]");
      syncSheetBackdrop(nagonOppen && sheetMode());
      // #toolbar är position:fixed med z-index och skapar därmed en EGEN
      // staplingskontext: väljarpanelens z-index gäller bara inom den, så
      // bakgrundstäcket (barn till body) la sig ovanpå hela raden — panelen
      // såg utgråad ut och gick inte att klicka i. Lyft raden över täcket
      // medan en väljare är öppen. Att jämföra z-index-SIFFROR räcker inte
      // mellan olika staplingskontexter.
      document.body.classList.toggle("picker-open", nagonOppen);
      syncMenuHostLayer();
      syncPageScrollLock();
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


export {
  sheetMode,
  enforceMobileMenuHost,
  savedSheetHeight,
  reconcilePickerChrome,
  setupViewportOffset,
  setupPickerSheets,
  closePrototypeDialogs,
  openPrototypeSheetKey,
  prototypeMenuStackBottom,
  prototypeDialog,
  syncBottomStack,
  syncTopStack,
  flattenMobileFilterBar,
  restoreFilterStripScroll,
  setupFilterStripScrollMemory,
  syncFilterBackdrop,
  toggleFilterSheet,
  setFiltersExpanded,
  toggleFiltersExpanded,
  syncSheetBackdrop,
  portalPickerPanel,
  restorePickerPanel,
  portaledPickerPanels,
};
