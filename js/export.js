/* export.js — CSV- och XLSX-export av matchlistan (samma urval som .ics).
   XLSX skrivs för hand: en osminkad, okomprimerad (STORE) ZIP med minimal
   OOXML-kalkylbladstruktur. Inga beroenden, samma no-build-filosofi som
   resten av sajten. */

window.HB = window.HB || {};

(function () {
  const wallParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  function wallDateTime(ms) {
    const p = {};
    for (const part of wallParts.formatToParts(new Date(ms))) p[part.type] = part.value;
    return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute };
  }

  function resultText(res) {
    if (!res || !res.fin) return "";
    if (res.wo) return "WO";
    if (res.hg || res.ag) return res.hg + "-" + res.ag;
    return "spelad";
  }

  // Delad radkälla för CSV och XLSX — ändra kolumner på ett ställe.
  function rows(matches) {
    const header = ["Datum", "Tid", "Klass", "Grupp", "Hemmalag", "Bortalag", "Resultat", "Plan"];
    const body = matches.map((m) => {
      const { date, time } = wallDateTime(m.start);
      return [date, time, m.catName, m.divName, m.home.name, m.away.name,
        resultText(m.res), m.arena];
    });
    return [header, ...body];
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // --- CSV -------------------------------------------------------------------

  function csvEscape(v) {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(matches) {
    // Semikolon som avgränsare — svensk Excel tolkar annars kommatecken som
    // decimaltecken och klämmer ihop allt i en kolumn. BOM för rätt å/ä/ö.
    const lines = rows(matches).map((r) => r.map(csvEscape).join(";"));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  function downloadCsv(cup, matches, filename) {
    const blob = new Blob([buildCsv(matches)], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, filename || cup.id + "-schema.csv");
  }

  // --- XLSX: minimal ZIP (STORE) + OOXML --------------------------------------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]; }

  function dosDateTime(d) {
    return {
      time: ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F),
      date: (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F),
    };
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const { time: dosTime, date: dosDate } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const localHeader = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,        // local file header signature
        20, 0,                          // version needed to extract
        0, 8,                           // flags: bit 11 = UTF-8 filename
        0, 0,                           // compression: 0 = stored
        ...u16(dosTime), ...u16(dosDate),
        ...u32(crc),
        ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0),
      ]);
      localParts.push(localHeader, nameBytes, data);
      const localOffset = offset;
      offset += localHeader.length + nameBytes.length + data.length;

      const centralHeader = new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,        // central directory header signature
        20, 0, 20, 0,                   // version made by / needed
        0, 8,
        0, 0,
        ...u16(dosTime), ...u16(dosDate),
        ...u32(crc),
        ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0),
        ...u32(0),
        ...u32(localOffset),
      ]);
      centralParts.push(centralHeader, nameBytes);
    }

    const centralStart = offset;
    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,          // end of central directory signature
      0, 0, 0, 0,
      ...u16(files.length), ...u16(files.length),
      ...u32(centralSize),
      ...u32(centralStart),
      0, 0,
    ]);

    return new Blob([...localParts, ...centralParts, end],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function xmlEscape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function colLetter(idx) {
    let s = "", n = idx + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetXml(tableRows) {
    const body = tableRows.map((row, ri) => {
      const cells = row.map((val, ci) =>
        '<c r="' + colLetter(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlEscape(val) + "</t></is></c>").join("");
      return '<row r="' + (ri + 1) + '">' + cells + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      "<sheetData>" + body + "</sheetData></worksheet>";
  }

  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";

  const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const WORKBOOK_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Matcher" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";

  function buildXlsx(matches) {
    const enc = new TextEncoder();
    return zipStore([
      { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
      { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
      { name: "xl/workbook.xml", data: enc.encode(WORKBOOK_XML) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(rows(matches))) },
    ]);
  }

  function downloadXlsx(cup, matches, filename) {
    triggerDownload(buildXlsx(matches), filename || cup.id + "-schema.xlsx");
  }

  HB.exportRows = rows;
  HB.csv = { build: buildCsv, download: downloadCsv };
  HB.xlsx = { build: buildXlsx, download: downloadXlsx };
})();
