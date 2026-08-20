/* share.js — delnings- och exportgränssnitt. */

import { h, $ } from "../dom.js";
import { prototypeDialog, sheetMode } from "./sheets.js";
import { chip } from "./controls.js";
import { NAME_SEP } from "../url-state.js";
import { cohortKey } from "../domain/category.js";
import { hasScheduledStart, matchTimeLabel, fmtDay } from "../time.js";
import { scoreText } from "../domain/match.js";

let state, cup, persist;
let filtered, sorted, isClubName, isFavoriteTeam;
let calendarWebcalUrl, buildViewUrlParams;
let groupPlayoffRounds, ensurePlayoffs, ensureCupArenaGeo;
let divisionsToShow, categoriesToShow;

export function initShare(deps) {
  ({
    state, cup, persist, filtered, sorted, isClubName, isFavoriteTeam,
    calendarWebcalUrl, buildViewUrlParams,
    groupPlayoffRounds, ensurePlayoffs, ensureCupArenaGeo,
    divisionsToShow, categoriesToShow,
  } = deps);
}

function exportBaseName() {
  return cup().id + "-" + (state.scope === "club" ? "ahk" : "alla");
}

export function buildExportPicker() {
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

export function openHeaderExportDialog() {
  const shell = prototypeDialog("Dela eller exportera", "export", $("#headerExportBtn"));
  if (!shell) return;
  const { dlg, body } = shell;
  const item = (label, onClick) => h("button", {
    class: "export-item", type: "button", onclick: () => { onClick(); dlg.close(); },
  }, label);
  if (state.view === "stats") {
    const panel = buildMatchExportPanel(item);
    panel.classList.add("header-export-panel");
    body.append(panel);
    return;
  }
  const panel = state.view === "tabeller" ? buildTablesExportPanel(item)
    : state.view === "slutspel" ? buildPlayoffExportPanel(item)
    : buildMatchExportPanel(item);
  panel.classList.add("header-export-panel");
  body.append(panel);
}

function exportArenaGeo() {
  return HB.api.arenaGeo[state.cupId] || {};
}

const ICS_ALARM_CHOICES = [
  ["0", "Ingen påminnelse"], ["15", "15 min innan"], ["30", "30 min innan"],
  ["60", "1 timme innan"], ["120", "2 timmar innan"], ["1440", "1 dygn innan"],
];

function buildNamedShareUrl() {
  const p = buildViewUrlParams();
  p.delete("cats");
  p.delete("teams");
  if (state.cats.size || state.teams.size) {
    const klasses = new Set();
    const teams = new Set();
    for (const m of state.matches) {
      if (state.cats.has(m.catId) && m.catName) klasses.add(cohortKey(m.catName) || m.catName);
      if (state.teams.has(m.home.id) && m.home.name) teams.add(m.home.name);
      if (state.teams.has(m.away.id) && m.away.name) teams.add(m.away.name);
    }
    if (klasses.size) p.set("klass", [...klasses].sort((a, b) => a.localeCompare(b, "sv")).join(NAME_SEP));
    if (teams.size) p.set("team", [...teams].sort((a, b) => a.localeCompare(b, "sv")).join(NAME_SEP));
  }
  const url = new URL(location.pathname, location.origin);
  url.search = p.toString();
  return url.toString();
}

function buildExportSubscribeBlock() {
  const teams = new Map();
  for (const m of sorted(filtered())) {
    for (const side of [m.home, m.away]) {
      if (!side || !side.id) continue;
      if (!isFavoriteTeam(side.name, m.catName) && !isClubName(side.name)) continue;
      let entry = teams.get(side.id);
      if (!entry) {
        const calUrl = calendarWebcalUrl(side);
        if (!calUrl) continue;
        entry = { team: side, calUrl, timed: 0 };
        teams.set(side.id, entry);
      }
      if (hasScheduledStart(m)) entry.timed++;
    }
  }
  if (!teams.size) return null;
  const links = [...teams.values()].filter(({ timed }) => timed > 0);
  const untimedTeams = teams.size - links.length;
  links.sort((a, b) => a.team.name.localeCompare(b.team.name, "sv"));
  return h("div", { class: "export-subscribe" },
    links.map(({ team, calUrl }) => h("a", {
      class: "export-item", href: calUrl, rel: "noopener",
      title: "Öppnar din kalenderapp och prenumererar på lagets matcher — nya/ändrade tider uppdateras sen automatiskt (funkar bäst på mobil).",
    }, "📅 Prenumerera — " + team.name)),
    links.length ? h("p", { class: "export-note muted" },
      "En prenumeration uppdateras av sig själv när arrangören ändrar tid, dag eller hall, till skillnad från .ics-filen ovanför.") : null,
    untimedTeams ? h("p", { class: "export-note muted" },
      "Lag utan speltid visas inte: prenumerationen är tom tills arrangören satt tiderna. Kom tillbaka då.") : null);
}

function buildMatchExportPanel(item) {
  ensureCupArenaGeo(state.cupId);
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
      if (list.length) HB.ics.download(cup(), list, exportBaseName() + ".ics", state.matchMinutes,
        exportArenaGeo(), state.icsAlarmMinutes);
    }),
    h("div", { class: "export-alarm-row" }, h("span", { class: "muted" }, "🔔"), alarmSel),
    h("p", { class: "export-note muted" },
      "Tips: skapa en egen kalender i telefonen för cupen och importera dit — då kan du radera allt i ett svep efteråt. ",
      h("a", { href: "hjalp.html#export", target: "_blank", rel: "noopener" }, "Så gör du")),
    buildExportSubscribeBlock(),
    item("📊 Kalkylark (.xlsx)", () => {
      const list = sorted(filtered());
      if (list.length) HB.xlsx.download(cup(), list, exportBaseName() + ".xlsx", exportArenaGeo());
    }),
    item("CSV (.csv)", () => {
      const list = sorted(filtered());
      if (list.length) HB.csv.download(cup(), list, exportBaseName() + ".csv", exportArenaGeo());
    }),
    (() => {
      const label = "🎧 Till ProCue DJ (kopiera)";
      const btn = h("button", { class: "export-item", type: "button" }, label);
      btn.onclick = () => {
        const list = sorted(filtered());
        if (!list.length) return;
        HB.procue.copy(cup(), list, exportBaseName() + "-procue.json").then((copied) => {
          btn.textContent = copied ? list.length + " matcher kopierade! ✓" : "nedladdad i stället ✓";
          setTimeout(() => (btn.textContent = label), 2500);
        });
      };
      return btn;
    })(),
    item("JSON (.json)", () => {
      const list = sorted(filtered());
      if (list.length) {
        const geo = exportArenaGeo();
        HB.json.downloadTable(HB.matchFieldsFor(list, geo), HB.exportRows(list, geo), exportBaseName() + ".json");
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
    buildShareLinkBlock(), buildSendToPhoneBlock());
}

function buildShareLinkBlock() {
  const canShare = typeof navigator.share === "function";
  const label = canShare ? "🔗 Dela" : "🔗 Kopiera länk";
  const btn = h("button", { class: "export-item", type: "button" }, label);
  btn.addEventListener("click", async () => {
    const url = buildNamedShareUrl();
    const copyToClipboard = () => {
      const write = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(url) : Promise.reject(new Error("inget urklipp"));
      return write.then(() => {
        btn.textContent = "Kopierad ✓";
        setTimeout(() => (btn.textContent = label), 2000);
      }).catch(() => { btn.textContent = "Kunde inte kopiera"; });
    };
    if (!canShare) return copyToClipboard();
    btn.textContent = "Delar…";
    try {
      await navigator.share({ title: cup().name, text: "Se den här vyn för " + cup().name + ".", url });
      btn.textContent = label;
    } catch (err) {
      if (err && err.name === "AbortError") { btn.textContent = label; return; }
      await copyToClipboard();
    }
  });
  return h("div", null, btn, h("p", { class: "export-note muted" },
    "Länken fungerar även nästa år, till skillnad från den i adressfältet."));
}

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
    const url = location.href;
    const svg = HB.qr.svg(url, { label: "QR-kod till den här vyn" });
    panel.append(
      svg || h("p", { class: "muted" }, "Länken är för lång för en QR-kod — kopiera den i stället."),
      h("p", { class: "muted" },
        "Skanna med telefonens kamera så öppnas exakt den här vyn där — med dina filter kvar. Lägg sedan matcherna i kalendern från telefonen."),
      h("div", { class: "export-phone-btns" },
        (() => {
          const copyBtn = h("button", { class: "btn small", type: "button" }, "Kopiera länk");
          copyBtn.addEventListener("click", () => navigator.clipboard.writeText(url).then(() => {
            copyBtn.textContent = "Kopierad ✓";
            setTimeout(() => (copyBtn.textContent = "Kopiera länk"), 2000);
          }).catch(() => { copyBtn.textContent = "Kunde inte kopiera"; }));
          return copyBtn;
        })(),
        h("a", {
          class: "btn small",
          href: "mailto:?subject=" + encodeURIComponent(cup().name + " – mitt schema") +
            "&body=" + encodeURIComponent("Här är matcherna jag filtrerat fram i cupschema:\n\n" + url + "\n"),
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

function tablesExportData() {
  const rows = [];
  for (const d of divisionsToShow()) {
    const t = state.tables[d.id];
    if (!t || t.status !== "done" || !t.rows.length) continue;
    const klass = d.catName + (state.years.size ? " " + (d.edition || cup().edition) : "");
    t.rows.forEach((r, i) => rows.push({
      klass, grupp: d.name || "Grupp", plac: i + 1, lag: r.name,
      spelade: r.played, vunna: r.won, oavgjorda: r.tied, forlorade: r.lost,
      malskillnad: r.gf - r.ga, poang: r.points,
    }));
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
    }), buildShareLinkBlock());
}

const PLAYOFF_EXPORT_FIELDS = [
  { label: "Klass", key: "klass" }, { label: "Slutspel", key: "slutspel" },
  { label: "Omgång", key: "omgang" }, { label: "Nr", key: "nr" },
  { label: "Hemmalag", key: "hemmalag" }, { label: "Bortalag", key: "bortalag" },
  { label: "Resultat", key: "resultat" }, { label: "Tid", key: "tid" }, { label: "Bana", key: "bana" },
];

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

function playoffDivExportRows(cat, div) {
  const klass = cat.catName + (state.years.size ? " " + (cat.edition || cup().edition) : "");
  return groupPlayoffRounds(div).flatMap(([, ms]) => ms).reverse().map((m) => ({
    klass, slutspel: div.name || "", omgang: m.roundName || "", nr: m.matchNr || "",
    hemmalag: m.home.name || "TBD", bortalag: m.away.name || "TBD",
    resultat: scoreText(m.res) || "",
    tid: hasScheduledStart(m) ? fmtDay.format(new Date(m.start)) + " " + matchTimeLabel(m) : "Tid ej satt",
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

async function ensureAllPlayoffsLoaded(cats) {
  for (const cat of cats) ensurePlayoffs(cat.catId, cat.edition);
  for (let i = 0; i < 50; i++) {
    if (cats.every((cat) => state.playoffs[cat.catId] && state.playoffs[cat.catId].status !== "loading")) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

let exportPlayoffScope = "current";

function buildPlayoffExportPanel(item) {
  const scopeBtnCurrent = chip("Visad tabell", exportPlayoffScope === "current", () => {
    exportPlayoffScope = "current"; syncScope();
  });
  const scopeBtnAll = chip("Samtliga tabeller", exportPlayoffScope === "all", () => {
    exportPlayoffScope = "all"; syncScope();
  });
  const syncScope = () => {
    scopeBtnCurrent.classList.toggle("on", exportPlayoffScope === "current");
    scopeBtnAll.classList.toggle("on", exportPlayoffScope === "all");
    scopeBtnCurrent.setAttribute("aria-pressed", String(exportPlayoffScope === "current"));
    scopeBtnAll.setAttribute("aria-pressed", String(exportPlayoffScope === "all"));
  };
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
      HB.xmlExport.downloadTable(fields, rows, "slutspel", "match", exportBaseName() + "-slutspel.xml"))),
    buildShareLinkBlock());
}
