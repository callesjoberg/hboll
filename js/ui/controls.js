/* controls.js — små, stateless UI-byggare. */

import { h } from "../dom.js";

export function chip(label, active, onClick, cls) {
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
export function withClearButton(input, onClear) {
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
export function attachAutocomplete(input, list, getCandidates, onPick, minLen = 1) {
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
