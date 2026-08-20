/* chrome.js — delat UI-läge för meny, filterark och inställningsvy.
   Inte appens cup-state; bara flaggor som nav/ark/app.js alla behöver. */

export const CURRENT_VIEWS = ["schema", "tabeller", "slutspel", "bana"];

export const chrome = {
  lastCurrentView: "schema",
  desktopMenuOpen: "current",
  desktopFilterExpanded: false,
  currentMenuOpen: true,
  statsMenuOpen: true,
  moreMenuOpen: false,
  settingsViewOpen: false,
  settingsReturnFocus: null,
  menuMinimized: false,
};
