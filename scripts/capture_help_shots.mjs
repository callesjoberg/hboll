// capture_help_shots.mjs — tar riktiga skärmbilder av appen till assets/help/
// för hjälp-/manualsidan. Kör en headless Chrome via DevTools-protokollet
// (CDP) och styr appens tillstånd via URL-parametrar + små JS-injektioner.
//
//   1) Starta den lokala servern:  python3 -m http.server 8000
//   2) node scripts/capture_help_shots.mjs
//
// Node 22+ krävs (inbyggd global WebSocket + fetch). Ingen npm-install.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const BASE = "http://localhost:8000/index.html";
const OUTDIR = fileURLToPath(new URL("../assets/help/", import.meta.url));
mkdirSync(OUTDIR, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--hide-scrollbars",
  "--window-size=1440,900",
  "--user-data-dir=/tmp/hboll-shot-" + Date.now(),
  "--no-first-run", "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

async function devtoolsWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("devtools not ready");
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) {
        for (const l of this.listeners.slice()) l(m);
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
  once(method, sessionId) {
    return new Promise((res) => {
      const l = (m) => {
        if (m.method === method && (!sessionId || m.sessionId === sessionId)) {
          this.listeners = this.listeners.filter((x) => x !== l); res(m.params);
        }
      };
      this.listeners.push(l);
    });
  }
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => res(ws));
    ws.addEventListener("error", rej);
  });
}

const HIDE = `(()=>{let s=document.getElementById('__hs');if(!s){s=document.createElement('style');s.id='__hs';document.head.appendChild(s);}s.textContent='.welcome-tune{display:none!important}';return 'ok';})()`;

const wsUrl = await devtoolsWs();
const browser = new CDP(await connect(wsUrl));
const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const page = {
  send: (m, p) => browser.send(m, p, sessionId),
  once: (m) => browser.once(m, sessionId),
};

await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

// Frys klockan mitt i Åhus Beach (2026-07-14 12:30 svensk tid) så att
// "nästa match"-kortet, NU-linjen och live-resultat syns i skärmbilderna —
// annars är alla sommarcuper redan spelade relativt dagens datum.
// Injiceras FÖRE appens skript på varje ny sida.
const FROZEN = Date.UTC(2026, 6, 14, 10, 30, 0); // 10:30 UTC = 12:30 Europe/Stockholm
const { identifier: freezeId } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(function(){var F=${FROZEN},_D=Date;function K(){if(arguments.length===0)return new _D(F);return new _D(...arguments);}
    K.now=function(){return F;};K.parse=_D.parse;K.UTC=_D.UTC;K.prototype=_D.prototype;Object.setPrototypeOf(K,_D);window.Date=K;})();`,
});
async function unfreezeClock() {
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: freezeId });
}

async function goto(url) {
  const done = page.once("Page.loadEventFired");
  await page.send("Page.navigate", { url });
  await Promise.race([done, sleep(9000)]);
}
async function ev(expr) {
  const r = await page.send("Runtime.evaluate", { expression: expr, awaitPromise: true });
  if (r.exceptionDetails) console.warn("eval err:", r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function shot(name) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUTDIR + name + ".png", Buffer.from(data, "base64"));
  console.log("saved", name + ".png");
}

async function capture(name, { url = BASE, prep = "", wait = 1800 } = {}) {
  await goto(url);
  await ev(HIDE);
  if (prep) await ev(prep);
  await sleep(wait);
  await ev(HIDE);
  await shot(name);
}

// prime the origin (skip welcome, force light theme)
await goto(BASE);
await ev(`localStorage.setItem('hb:welcomeSeen','1');localStorage.setItem('hb:theme','light');document.documentElement.dataset.theme='light';'ok'`);

// Klubbens egna matcher (rikt schema med hero + tidslinje) via fritextsök.
const AHUS = `${BASE}?cup=ahus&q=alings%C3%A5s`;

// 1. Welcome / "Om appen"
await capture("welcome", {
  url: BASE,
  prep: `localStorage.removeItem('hb:welcomeSeen'); if(window.HB&&HB.openWelcome)HB.openWelcome();`,
  wait: 4500,
});

// 2. Hero — "Nästa match"-kortet (klass med kommande Alingsås-matcher, scrollad topp)
await capture("hero", {
  url: `${BASE}?cup=ahus&view=schema&cats=70944414`,
  prep: `window.scrollTo(0,0);`,
  wait: 2800,
});
// scrolla säkert till toppen efter appens egen auto-scroll
await ev(`window.scrollTo(0,0);`); await sleep(500); await ev(HIDE); await shot("hero");
// OBS: "Nästa match"-kortet syns inte i historisk snapshot-data (alla matcher
// har redan resultat → inga "ospelade" klubbmatcher). Det illustreras med en
// HTML-figur i hjalp.html i stället.

// 3. Schema (tidslinje + NU-linje + matchkort, appens egen auto-scroll)
await capture("schema", { url: `${BASE}?cup=ahus&view=schema&q=alings%C3%A5s`, wait: 2800 });

// 4. Matchdialog (klick på ett matchkort)
await capture("matchdialog", {
  url: `${BASE}?cup=ahus&view=schema&q=alings%C3%A5s`,
  prep: `const cards=[...document.querySelectorAll('article.match')]; (cards[2]||cards[0]) && (cards[2]||cards[0]).click(); 'clicked';`,
  wait: 2200,
});

// 5. Tabeller
await capture("tabeller", { url: `${BASE}?cup=ahus&view=tabeller&cats=70944496`, wait: 2600 });

// 6. Bana (välj första banan)
await capture("bana", {
  url: `${BASE}?cup=ahus&view=bana`,
  prep: `const s=document.querySelector('#content select'); if(s&&s.options.length>1){s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));} 'ok';`,
  wait: 2600,
});

// 7. Inställningar
await capture("settings", {
  url: `${BASE}?cup=ahus&view=schema&q=alings%C3%A5s`,
  prep: `document.getElementById('settingsBtn').click(); 'ok';`,
  wait: 1600,
});

// 8. Stats — Trend (tillväxtkurva)
await capture("stats", { url: `${BASE}?cup=ahus&view=stats&stats=trend`, wait: 3400 });

// 9. Filter/sortering — öppna klass-dropdownen för att visa filtren
await capture("filter", {
  url: `${BASE}?cup=ahus&view=schema&cats=70944496`,
  prep: `const chips=[...document.querySelectorAll('#toolbar button')]; const k=chips.find(b=>/klass/i.test(b.textContent)); if(k)k.click(); 'ok';`,
  wait: 1800,
});

// 10. Slutspel — riktig klocka (Åhus är avslutad → komplett slutspelsträd)
await unfreezeClock();
await capture("slutspel", { url: `${BASE}?cup=ahus&view=slutspel&cats=70944496`, wait: 5000 });

await browser.send("Target.closeTarget", { targetId }).catch(() => {});
await sleep(300);
chrome.kill();
console.log("done →", OUTDIR);
process.exit(0);
