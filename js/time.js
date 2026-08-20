/* time.js — matchstart är en äkta UTC-epok, visad i Europe/Stockholm. */

export const TZ = "Europe/Stockholm";

export const fmtTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit",
});
export const fmtDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short",
});
export const fmtDayLong = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, weekday: "long", day: "numeric", month: "long",
});
export const fmtClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit",
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

export function hasScheduledStart(value) {
  const ms = typeof value === "object" && value !== null ? value.start : value;
  return Number.isFinite(ms) && ms > 0;
}

export function matchTimeLabel(m, dayFormatter) {
  if (!hasScheduledStart(m)) return "Tid ej satt";
  const time = fmtTime.format(new Date(m.start));
  return dayFormatter ? dayFormatter.format(new Date(m.start)) + " " + time : time;
}

export function dayKey(ms) {
  // Svensk kalenderdag (en-CA ger yyyy-mm-dd), inte UTC-datumet — en match
  // strax efter midnatt svensk tid kan annars hamna på fel dag.
  return hasScheduledStart(ms) ? dayKeyFmt.format(new Date(ms)) : "";
}
