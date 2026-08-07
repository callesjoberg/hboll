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

  // DTSTAMP kräver en UTC-tidpunkt ("...Z") — när kalenderobjektet skapades.
  function utcStamp(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
      "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  }

  // RFC 5545: en innehållsrad får vara högst 75 oktetter; längre rader viks
  // med CRLF följt av ett mellanslag (som strippas av läsaren igen). Vissa
  // strikta kalenderappar (bl.a. Outlook) hoppar annars över långa rader.
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = "", curBytes = 0, first = true;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      const limit = first ? 75 : 74; // fortsättningsrader har ett ledande mellanslag
      if (curBytes + b > limit) { out.push(cur); cur = ch; curBytes = b; first = false; }
      else { cur += ch; curBytes += b; }
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  // Europe/Stockholm-definition så att TZID inte pekar på en odefinierad zon
  // (annars tolkar strikta läsare tiderna som "flytande" lokaltid). CET/CEST
  // med EU:s sista-söndagen-regel — giltig för alla år cuperna spänner över.
  const VTIMEZONE = [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Stockholm",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
    "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET",
    "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  const round6 = (n) => Math.round(n * 1e6) / 1e6;

  // Parametrar (X-ADDRESS m.fl.) citeras i stället för att escapas som
  // vanliga värden — RFC 5545 §3.2: ett parametervärde med kommatecken,
  // semikolon eller kolon MÅSTE vara omgivet av citattecken, och får då
  // inte innehålla citattecken själv.
  function param(s) {
    return '"' + String(s || "").replace(/"/g, "'").replace(/[\r\n]+/g, " ") + '"';
  }

  // matches: matchlistan. geo (valfri): {banans namn: {venue, street, city,
  // lat, lng}} från HB.api.arenaGeo — bara klassiska Cup Manager-cuper har
  // den (se arenas_from_store i scripts/fetch_cupmanager.py). Finns den blir
  // LOCATION en riktig postadress i stället för bara bannamn + ort, plus
  // GEO/X-APPLE-STRUCTURED-LOCATION så kalenderappen kan visa kartnål och
  // vägbeskrivning direkt. alarmMinutes: minuter före start för en
  // påminnelse (VALARM), 0/null = ingen.
  function buildIcs(cup, matches, minutes, geo, alarmMinutes) {
    const dur = (minutes || DEFAULT_MATCH_MINUTES) * 60000;
    const stamp = utcStamp(Date.now());
    const alarm = Math.max(0, Math.round(+alarmMinutes || 0));
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//hboll//cupschema//SV",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + esc(cup.name + " " + cup.edition),
      ...VTIMEZONE,
    ];
    for (const m of matches) {
      const klass = HB.shortCat(m.catName);
      const grp = m.divName ? " " + m.divName : "";
      const g = (geo || {})[m.arena] || null;
      // Banan först (den är det man letar efter på plats), sedan hallen om
      // den heter något annat, sedan postadressen. Utan geodata: samma
      // "bana, ort" som tidigare.
      const locParts = [];
      if (m.arena) locParts.push(m.arena);
      if (g) {
        if (g.venue && g.venue !== m.arena && !m.arena.startsWith(g.venue)) locParts.push(g.venue);
        if (g.street) locParts.push(g.street);
        locParts.push(g.city || cup.place);
      } else {
        locParts.push(cup.place);
      }
      const location = locParts.filter(Boolean).join(", ");
      const descParts = [cup.name + " " + cup.edition, m.catName];
      if (m.divName) descParts.push(m.divName);
      if (m.arena) descParts.push("Bana: " + m.arena);
      if (g) descParts.push("Adress: " + [g.street, g.city].filter(Boolean).join(", "));
      lines.push(
        "BEGIN:VEVENT",
        "UID:match-" + m.id + "@" + cup.host,
        "DTSTAMP:" + stamp,
        "DTSTART;TZID=Europe/Stockholm:" + wallStamp(m.start),
        "DTEND;TZID=Europe/Stockholm:" + wallStamp(m.start + dur),
        "SUMMARY:" + esc(m.home.name + " – " + m.away.name + " (" + klass + grp + ")"),
        "LOCATION:" + esc(location)
      );
      if (g) {
        // GEO är standard (RFC 5545) och räcker för de flesta läsare;
        // X-APPLE-STRUCTURED-LOCATION är det Apples kalender faktiskt läser
        // för att göra adressen tappbar med vägbeskrivning. Sex decimaler
        // är ~10 cm — allt därutöver är brus från källans flyttal.
        const lat = round6(g.lat), lng = round6(g.lng);
        lines.push("GEO:" + lat + ";" + lng);
        lines.push("X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=" +
          param([g.street, g.city].filter(Boolean).join(", ")) +
          ";X-APPLE-RADIUS=100;X-TITLE=" + param(location) +
          ":geo:" + lat + "," + lng);
      }
      lines.push("DESCRIPTION:" + esc(descParts.join(" · ")));
      if (alarm > 0) {
        lines.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-PT" + alarm + "M",
          "DESCRIPTION:" + esc(m.home.name + " – " + m.away.name),
          "END:VALARM"
        );
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  function download(cup, matches, filename, minutes, geo, alarmMinutes) {
    const blob = new Blob([buildIcs(cup, matches, minutes, geo, alarmMinutes)], {
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
