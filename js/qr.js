/* qr.js — minimal QR-kodsgenerator (byte-läge, felkorrigering M).
   Finns för "öppna i telefonen": en QR med länken till exakt den vy man
   filtrerat fram på datorn, så man slipper knappa in adressen på mobilen.

   Egen implementation i stället för ett bibliotek: sajten laddar inga
   externa skript (ingen CDN, se index.html) och det här är den enda QR-
   användningen som finns — ~200 rader väger lättare än ett beroende.

   Stödjer version 1–10, vilket räcker med marginal för appens URL:er
   (version 10 rymmer 213 tecken vid felkorrigeringsnivå M). Behövs mer
   får anropet falla tillbaka på en ren länk, se buildShareToPhonePanel.

   Referens: ISO/IEC 18004. Tabellerna nedan är hämtade därifrån. */
window.HB = window.HB || {};
(function () {
  "use strict";

  // Antal datakodord (bytes) per version vid felkorrigeringsnivå M.
  const DATA_CODEWORDS_M = [null, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  // Felkorrigeringskodord per block, och blockindelning (nivå M).
  const EC_PER_BLOCK_M = [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  // [antal grupp1-block, kodord i grupp1-block, antal grupp2-block, kodord i grupp2-block]
  const BLOCKS_M = [null,
    [1, 16, 0, 0], [1, 28, 0, 0], [1, 44, 0, 0], [2, 32, 0, 0], [2, 43, 0, 0],
    [4, 27, 0, 0], [4, 31, 0, 0], [2, 38, 2, 39], [3, 36, 2, 37], [4, 43, 1, 44]];
  // Position av inriktningsmönstrens mittpunkter per version.
  const ALIGN_POS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // --- Galois-fält GF(256) för Reed-Solomon --------------------------------
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;          // primitivt polynom x^8+x^4+x^3+x^2+1
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const rem = new Array(ecLen).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.shift();
      rem.push(0);
      for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], factor);
    }
    return rem;
  }

  // --- bitström -------------------------------------------------------------
  function bitBuffer() {
    const bits = [];
    return {
      bits,
      put(value, length) {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
      },
    };
  }

  // --- kodning --------------------------------------------------------------
  function encodeData(bytes, version) {
    const buf = bitBuffer();
    buf.put(0b0100, 4);                                    // byte-läge
    buf.put(bytes.length, version < 10 ? 8 : 16);          // längdfält
    for (const b of bytes) buf.put(b, 8);
    const capacityBits = DATA_CODEWORDS_M[version] * 8;
    if (buf.bits.length > capacityBits) return null;
    // terminator + padding till hel byte
    buf.put(0, Math.min(4, capacityBits - buf.bits.length));
    while (buf.bits.length % 8) buf.bits.push(0);
    const words = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | buf.bits[i + j];
      words.push(v);
    }
    // fyllnadsbytes tills kapaciteten är full
    const pad = [0xec, 0x11];
    for (let i = 0; words.length < DATA_CODEWORDS_M[version]; i++) words.push(pad[i % 2]);
    return words;
  }

  // Delar upp i block, lägger på felkorrigering och flätar ihop i den
  // ordning standarden föreskriver.
  function interleave(words, version) {
    const [g1, c1, g2, c2] = BLOCKS_M[version];
    const ecLen = EC_PER_BLOCK_M[version];
    const blocks = [];
    let at = 0;
    for (let i = 0; i < g1; i++) { blocks.push(words.slice(at, at + c1)); at += c1; }
    for (let i = 0; i < g2; i++) { blocks.push(words.slice(at, at + c2)); at += c2; }
    const ecBlocks = blocks.map((b) => rsRemainder(b, ecLen));
    const out = [];
    const maxData = Math.max(c1, c2);
    for (let i = 0; i < maxData; i++) {
      for (const b of blocks) if (i < b.length) out.push(b[i]);
    }
    for (let i = 0; i < ecLen; i++) {
      for (const b of ecBlocks) out.push(b[i]);
    }
    return out;
  }

  // --- modulmatris ----------------------------------------------------------
  function buildMatrix(version) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

    // sökmönster + separatorer
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
            (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          set(r0 + r, c0 + c, inner ? 1 : 0);
        }
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // tidsmönster
    for (let i = 8; i < size - 8; i++) {
      m[6][i] = i % 2 === 0 ? 1 : 0;
      m[i][6] = i % 2 === 0 ? 1 : 0;
    }

    // inriktningsmönster
    const pos = ALIGN_POS[version];
    for (const r of pos) {
      for (const c of pos) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const edge = Math.max(Math.abs(dr), Math.abs(dc));
            m[r + dr][c + dc] = edge === 1 ? 0 : 1;
          }
        }
      }
    }

    m[size - 8][8] = 1;   // alltid mörk modul
    return m;
  }

  // Reserverar formatområdena så datan inte skrivs där.
  function reserveFormat(m) {
    const size = m.length;
    for (let i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
    }
  }

  // Version 7+ har ett eget versionsblock i två hörn.
  function placeVersionInfo(m, version) {
    if (version < 7) return;
    let rem = version << 12;
    for (let i = 0; i < 12; i++) {
      const top = rem >>> (17 - i);
      if (top & 1) rem ^= 0x1f25 << (5 - i);
    }
    const bits = (version << 12) | rem;
    const size = m.length;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      m[size - 11 + c][r] = bit;
      m[r][size - 11 + c] = bit;
    }
  }

  // Zigzag-placering av datamodulerna, nedifrån och upp i par av kolumner.
  function placeData(m, data, maskFn) {
    const size = m.length;
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                    // hoppa över tidskolumnen
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c++) {
          const col = right - c;
          if (m[row][col] !== null) continue;
          let bit = 0;
          if (bitIndex < data.length * 8) {
            bit = (data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
          m[row][col] = maskFn(row, col) ? bit ^ 1 : bit;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function placeFormat(m, maskIndex) {
    // nivå M = 00 i formatets två första bitar
    const data = (0b00 << 3) | maskIndex;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const size = m.length;
    // Två kopior. Standardens referensformler anges som (kolumn, rad) —
    // matrisen här indexeras [rad][kolumn], så paren är omkastade mot hur
    // de brukar skrivas. Att blanda ihop det ger en kod som ser korrekt ut
    // men inte går att läsa (formatinformationen hamnar transponerad).
    for (let i = 0; i <= 5; i++) m[i][8] = (bits >>> i) & 1;
    m[7][8] = (bits >>> 6) & 1;
    m[8][8] = (bits >>> 7) & 1;
    m[8][7] = (bits >>> 8) & 1;
    for (let i = 9; i < 15; i++) m[8][14 - i] = (bits >>> i) & 1;
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = (bits >>> i) & 1;
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = (bits >>> i) & 1;
  }

  // Straffpoäng enligt standarden — lägst poäng vinner, vilket ger den
  // mask som är lättast för en läsare att tolka.
  function penalty(m) {
    const size = m.length;
    let score = 0;
    const runScore = (line) => {
      let s = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) { run++; } else { if (run >= 5) s += run - 2; run = 1; }
      }
      if (run >= 5) s += run - 2;
      return s;
    };
    for (let i = 0; i < size; i++) {
      score += runScore(m[i]);
      score += runScore(m.map((row) => row[i]));
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  // Returnerar en matris av 0/1, eller null om texten är för lång.
  function encode(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      const lenBits = v < 10 ? 8 : 16;
      if (4 + lenBits + bytes.length * 8 <= DATA_CODEWORDS_M[v] * 8) { version = v; break; }
    }
    if (!version) return null;
    const words = encodeData(bytes, version);
    if (!words) return null;
    const data = interleave(words, version);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = buildMatrix(version);
      reserveFormat(m);
      placeVersionInfo(m, version);
      placeData(m, data, MASKS[mask]);
      placeFormat(m, mask);
      const score = penalty(m);
      if (!best || score < best.score) best = { m, score };
    }
    return best.m;
  }

  // Ritar koden som en SVG — skalar med containern och blir skarp i alla
  // storlekar, till skillnad från en canvas med fast pixelstorlek.
  function svg(text, opts) {
    const m = encode(text);
    if (!m) return null;
    const o = opts || {};
    const quiet = o.quiet == null ? 4 : o.quiet;
    const size = m.length;
    const total = size + quiet * 2;
    const NS = "http://www.w3.org/2000/svg";
    const el = document.createElementNS(NS, "svg");
    el.setAttribute("viewBox", "0 0 " + total + " " + total);
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", o.label || "QR-kod");
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", String(total));
    bg.setAttribute("height", String(total));
    bg.setAttribute("fill", o.light || "#ffffff");
    el.appendChild(bg);
    // En enda path för alla mörka moduler — långt färre DOM-noder än en
    // rect per modul (en version 10-kod har över 3000 moduler).
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (m[r][c]) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", o.dark || "#16283f");
    el.appendChild(path);
    return el;
  }

  HB.qr = { encode, svg };
})();
