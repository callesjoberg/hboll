// make_og_image.mjs — renderar delningsbilden assets/og.png (1200×630), den
// som dyker upp när sajten länkas i Messenger/SMS/WhatsApp/Slack.
//
// Kortet byggs som HTML här i filen och fotograferas med headless Chrome via
// DevTools-protokollet — samma teknik som capture_help_shots.mjs, och av
// samma skäl: ingen npm-install, ingen bildbehandling att underhålla, och
// kortet ärver appens egna färger direkt ur css/style.css-paletten.
//
//   node scripts/make_og_image.mjs
//
// Körs för hand när kortet ska ändras — INTE i workflowet. Bilden är statisk
// (ingen cupdata i den) och Facebook/WhatsApp cachar den hårt ändå; en
// ombyggnad varje kvart hade bara skapat commits utan mottagare.
//
// Node 22+ (inbyggd global WebSocket + fetch), som capture_help_shots.mjs.
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;                     // egen port, krockar inte med hjälpbilderna
const W = 1200, H = 630;               // Facebooks rekommenderade format, 1.91:1
const OUT = fileURLToPath(new URL("../assets/og.png", import.meta.url));
const LOGO = fileURLToPath(new URL("../assets/ahk-logo.svg", import.meta.url));

// Paletten är css/style.css ljusa läge: --ink, --blue-deep, --yellow.
const INK = "#16283f", BLUE_DEEP = "#17417e", YELLOW = "#f6c410";

const logoDataUri = "data:image/svg+xml;base64," +
  readFileSync(LOGO).toString("base64");

const CARD = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    background: ${INK};
    font-family: Barlow, system-ui, sans-serif;
    color: #e8edf4;
  }
  /* Samma varma glöd som välkomstskärmens kartbakgrund, fast stillastående
     — den gör kortet till "Cupschema" och inte vilken mörkblå ruta som helst. */
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(680px 420px at 78% 26%, rgba(246,196,16,.20), transparent 68%),
      radial-gradient(520px 360px at 12% 88%, rgba(31,95,191,.34), transparent 70%);
  }
  .frame {
    position: relative; height: 100%;
    display: flex; align-items: center; gap: 62px;
    padding: 0 84px;
  }
  .logo { width: 196px; flex: none; filter: drop-shadow(0 8px 28px rgba(0,0,0,.45)); }
  h1 {
    font-family: "Barlow Condensed", Barlow, sans-serif;
    font-weight: 700; font-size: 132px; line-height: .92;
    letter-spacing: -.5px; color: ${YELLOW};
    text-shadow: 0 6px 34px rgba(0,0,0,.4);
  }
  p { font-size: 34px; line-height: 1.32; max-width: 660px; margin-top: 20px; }
  .domain {
    margin-top: 34px; display: inline-block;
    font-family: "Barlow Condensed", Barlow, sans-serif;
    font-weight: 600; font-size: 27px; letter-spacing: 1.6px;
    text-transform: uppercase;
    color: ${INK}; background: ${YELLOW};
    padding: 9px 20px 7px; border-radius: 7px;
  }
  /* Diskret kant nedtill: bryter av mot ljusa chattbubblor så kortet inte
     flyter ihop med bakgrunden i Messenger. */
  .edge { position: absolute; left: 0; right: 0; bottom: 0; height: 9px;
          background: linear-gradient(90deg, ${YELLOW}, ${BLUE_DEEP}); }
</style>
<div class="glow"></div>
<div class="frame">
  <img class="logo" src="${logoDataUri}" alt="">
  <div>
    <h1>Cupschema</h1>
    <p>Spelschema, resultat, tabeller och slutspel för handbollscuper — följ vilken klubb som helst.</p>
    <span class="domain">cupschema.se</span>
  </div>
</div>
<div class="edge"></div>`;

const profile = "/tmp/hboll-og-" + process.pid;
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--hide-scrollbars",
  `--window-size=${W},${H}`,
  `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

// Profilkatalogen städas ALLTID bort — annars växer /tmp med en ny
// hundramegaderskatalog per körning. Chrome hinner skriva klart en stund
// efter kill(), så rensningen får några försök innan den ger upp.
async function cleanup() {
  chrome.kill();
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch { /* Chrome skriver fortfarande — försök igen */ }
  }
  console.warn(`kunde inte rensa ${profile} — ta bort den för hand`);
}

async function devtoolsWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* inte uppe än */ }
    await sleep(250);
  }
  throw new Error("devtools svarar inte");
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => res(ws));
    ws.addEventListener("error", rej);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

try {
  const browser = new CDP(await connect(await devtoolsWs()));
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (m, p) => browser.send(m, p, sessionId);

  await page("Page.enable");
  await page("Emulation.setDeviceMetricsOverride",
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(CARD) });
  // Webbtypsnitten hämtas över nätet — vänta tills de FAKTISKT är laddade,
  // annars fotograferas kortet med systemfonten och ser fel ut.
  await sleep(1200);
  await page("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
  await sleep(300);

  const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(OUT, Buffer.from(data, "base64"));
  const kb = Math.round(Buffer.from(data, "base64").length / 1024);
  console.log(`skrev assets/og.png — ${W}×${H}, ${kb} kB`);
} finally {
  await cleanup();
}
