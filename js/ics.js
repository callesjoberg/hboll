/* ics.js — export av matcher till kalenderfil (.ics).
   Matchstart är en äkta UTC-epok; vi läser ut svensk lokaltid ur den och
   skriver DTSTART med TZID=Europe/Stockholm + den lokala väggtiden. */

window.HB = window.HB || {};

(function () {
  const DEFAULT_MATCH_MINUTES = 30; // används om inget annat anges

  const wallParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  function wallStamp(ms) {
    const p = {};
    for (const part of wallParts.formatToParts(new Date(ms))) p[part.type] = part.value;
    return p.year + p.month + p.day + "T" + p.hour + p.minute + "00";
  }

  function esc(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;")
      .replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function buildIcs(cup, matches, minutes) {
    const dur = (minutes || DEFAULT_MATCH_MINUTES) * 60000;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//hboll//cupschema//SV",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + esc(cup.name + " " + cup.edition),
    ];
    for (const m of matches) {
      const klass = HB.shortCat(m.catName);
      const grp = m.divName ? " " + m.divName : "";
      lines.push(
        "BEGIN:VEVENT",
        "UID:match-" + m.id + "@" + cup.host,
        "DTSTART;TZID=Europe/Stockholm:" + wallStamp(m.start),
        "DTEND;TZID=Europe/Stockholm:" + wallStamp(m.start + dur),
        "SUMMARY:" + esc(m.home.name + " – " + m.away.name + " (" + klass + grp + ")"),
        "LOCATION:" + esc((m.arena ? m.arena + ", " : "") + cup.place),
        "DESCRIPTION:" + esc(cup.name + " " + cup.edition + " · " + m.catName +
          (m.divName ? " · " + m.divName : "")),
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function download(cup, matches, filename, minutes) {
    const blob = new Blob([buildIcs(cup, matches, minutes)], {
      type: "text/calendar;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || cup.id + "-schema.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  HB.ics = { buildIcs, download };
})();
