/* sw-cache.test.mjs — skalcachen får aldrig blanda två versioner.

   Upptäckt 2026-10-03 på en telefon: sidhuvudets nya klubbknapp ritades
   som en vit systemknapp med oläslig text. HTML:en var ny, CSS:en en
   version gammal. Två hål i sw.js gjorde det möjligt:

     1. install hämtade "./css/style.css" UTAN ?v=, så webbläsarens egen
        HTTP-cache (max-age=600) kunde lägga förra versionens bytes i den
        nya skalcachen.
     2. reserven matchade med ignoreSearch, så ett enda misslyckat
        nätanrop på style.css?v=NY besvarades med den gamla filen.

   Felet syns inte som ett fel — appen laddar, den ser bara trasig ut. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const KÄLLA = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

class FalskCache {
  constructor(poster = {}) { this.poster = new Map(Object.entries(poster)); }
  async put(req, resp) { this.poster.set(url(req), resp); }
  async addAll(reqs) { this.senasteAddAll = reqs;
    for (const r of reqs) this.poster.set(url(r), { kropp: url(r) }); }
  async match(req, opts = {}) {
    const sökt = url(req);
    if (this.poster.has(sökt)) return this.poster.get(sökt);
    if (!opts.ignoreSearch) return undefined;
    const utan = (u) => u.split("?")[0];
    for (const [nyckel, värde] of this.poster) if (utan(nyckel) === utan(sökt)) return värde;
    return undefined;
  }
}
const url = (r) => (typeof r === "string" ? r : r.url);

function ladda(poster) {
  const lyssnare = new Map();
  const cache = new FalskCache(poster);
  const sandlåda = {
    location: { origin: "https://cupschema.se" },
    URL,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true,
              match: (req, opts) => cache.match(req, opts) },
    // Minsta möjliga Request: bevarar url, mode och init (cache-läget).
    Request: class { constructor(u, init = {}) { this.url = String(u); this.init = init;
                       this.method = init.method || "GET"; this.mode = init.mode || "no-cors"; } },
    fetch: async () => { throw new Error("nätet nere"); },
    self: {
      addEventListener: (namn, fn) => lyssnare.set(namn, fn),
      skipWaiting() {}, clients: { claim() {} },
    },
  };
  sandlåda.self.location = sandlåda.location;
  sandlåda.addEventListener = sandlåda.self.addEventListener;
  vm.createContext(sandlåda);
  vm.runInContext(KÄLLA, sandlåda);
  return { lyssnare, cache, sandlåda };
}

// Simulerar ett anrop som sidan gör och nätet inte svarar på.
async function svarPåTrasigtNät(ladd, begäran) {
  let svar;
  ladd.lyssnare.get("fetch")({
    request: begäran,
    respondWith: (p) => { svar = p; },
  });
  return svar === undefined ? undefined : await svar;
}

test("install hämtar css/js med versionsnyckel, förbi HTTP-cachen", async () => {
  const ladd = ladda();
  let väntat;
  ladd.lyssnare.get("install")({ waitUntil: (p) => { väntat = p; } });
  await väntat;
  const nycklar = [...ladd.cache.poster.keys()];
  const version = /hboll-shell-(\S+?)"/.exec(KÄLLA)[1];

  for (const n of nycklar) {
    const versionsmärkt = n.includes("?v=");
    assert.equal(versionsmärkt, /^\.\/(css|js)\//.test(n), `fel nyckel för ${n}`);
    if (versionsmärkt) assert.ok(n.endsWith("?v=" + version), `fel version på ${n}`);
  }
  assert.ok(nycklar.includes("./css/style.css?v=" + version));
  assert.ok(nycklar.includes("./index.html"), "sidan cachas utan nyckel — den begärs utan");
  for (const r of ladd.cache.senasteAddAll) {
    assert.equal(r.init.cache, "reload",
      `${r.url} hämtades ur HTTP-cachen — då kan förra versionens bytes hamna i den nya skalcachen`);
  }
});

test("ett versionsmärkt anrop besvaras aldrig med en annan versions fil", async () => {
  // Skalcachen innehåller förra versionens CSS, utan nyckel (det gamla felet).
  const ladd = ladda({ "https://cupschema.se/css/style.css": { kropp: "GAMMAL CSS" } });
  const svar = await svarPåTrasigtNät(ladd, new ladd.sandlåda.Request(
    "https://cupschema.se/css/style.css?v=20261003b"));
  assert.equal(svar, undefined, "hellre inget svar än en blandad app");
});

test("rätt version serveras ur cachen när nätet är nere", async () => {
  const ladd = ladda({ "https://cupschema.se/css/style.css?v=20261003b": { kropp: "RÄTT CSS" } });
  const svar = await svarPåTrasigtNät(ladd, new ladd.sandlåda.Request(
    "https://cupschema.se/css/style.css?v=20261003b"));
  assert.deepEqual(svar, { kropp: "RÄTT CSS" });
});

test("sidan själv matchas utan användarens frågeparametrar", async () => {
  const ladd = ladda({ "https://cupschema.se/index.html": { kropp: "SKALET" } });
  const svar = await svarPåTrasigtNät(ladd, new ladd.sandlåda.Request(
    "https://cupschema.se/index.html?cup=ahus&fav=Alings%C3%A5s+HK", { mode: "navigate" }));
  assert.deepEqual(svar, { kropp: "SKALET" }, "offline ska inte kräva exakt samma länk");
});

test("sw.js och index.html har samma versionsnyckel", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const iSw = /hboll-shell-(\S+?)"/.exec(KÄLLA)[1];
  const iIndex = /style\.css\?v=([^"]+)"/.exec(index)[1];
  assert.equal(iSw, iIndex, "scripts/bump_assets.py sätter båda — de får inte glida isär");
});
