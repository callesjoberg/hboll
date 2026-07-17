/* ics.js — export av matcher till kalenderfil (.ics).
   Matchstart lagras som svensk väggtid kodad i UTC-epoch; vi skriver
   DTSTART med TZID=Europe/Stockholm och väggtiden rakt av. */

window.HB = window.HB || {};

(function () {
  const MATCH_MINUTES = 30; // schemarutan är oftast 15–30 min; 30 ger marginal

  function wallStamp(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
      "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "00"
    );
  }

  function esc(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;")
      .replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function buildIcs(cup, matches) {
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
        "DTEND;TZID=Europe/Stockholm:" + wallStamp(m.start + MATCH_MINUTES * 60000),
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

  function download(cup, matches, filename) {
    const blob = new Blob([buildIcs(cup, matches)], {
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
