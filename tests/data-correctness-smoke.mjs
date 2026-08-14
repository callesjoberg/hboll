import assert from "node:assert/strict";

// De berörda browsermodulerna är vanliga IIFE-skript. Ett minimalt,
// deterministiskt browser-skal räcker för att testa deras rena data-API:n
// direkt i Node utan att införa ett byggsystem eller testberoenden.
globalThis.window = globalThis;
window.HB = { shortCat: (name) => name || "" };

const storage = new Map();
class StorageMock {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; }
  setItem(key, value) {
    const text = String(value);
    storage.set(key, text);
    this[key] = text;
  }
  removeItem(key) {
    storage.delete(key);
    delete this[key];
  }
  clear() {
    for (const key of storage.keys()) delete this[key];
    storage.clear();
  }
  key(index) { return [...storage.keys()][index] || null; }
  get length() { return storage.size; }
}
globalThis.localStorage = new StorageMock();

await import("../js/export.js");
await import("../js/ics.js");
await import("../js/api.js");

const untimed = {
  id: 1, start: 0, catName: "F2011", divName: "Grupp A", arena: "Hall 1",
  home: { id: 10, name: "Lag A" }, away: { id: 11, name: "Lag B" }, res: null,
};
const rows = HB.exportRows([untimed]);
assert.equal(rows[0].datum, "", "otidssatt match ska sakna exportdatum");
assert.equal(rows[0].tid, "Tid ej satt", "otidssatt match ska ha begriplig tidstext");

const ics = HB.ics.buildIcs({ id: "test", host: "example.test" }, [untimed], 30);
assert.doesNotMatch(ics, /BEGIN:VEVENT/, "otidssatt match får inte bli 1970-händelse");

const cup = { id: "test", tournamentId: 42, host: "example.test" };
const base = Date.UTC(2026, 7, 14, 10, 0, 0);

const finished = { ...untimed, start: base, res: { fin: true, hg: 1, ag: 0 } };
let sourceIds = [1, 2];
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return {
    ok: true,
    json: async () => ({
      responses: Object.fromEntries(sourceIds.map((id) => ["Match:" + id, {
        entity: { __typename: "Match", id, start: base },
      }])),
    }),
  };
};

// Census hittar ett nytt id och signalerar full fetch med null, även om
// alla redan kända matcher är markerade som färdigspelade.
assert.equal(await HB.api.fetchIncremental(cup, [finished]), null);
assert.equal(fetchCalls, 1);

// Oförändrad id-mängd + allt färdigt kan behålla den billiga cachen.
sourceIds = [1];
fetchCalls = 0;
assert.deepEqual(await HB.api.fetchIncremental(cup, [finished]), [finished]);
assert.equal(fetchCalls, 1);

// Gamla cacheformat accepteras inte av misstag efter modelländringen.
HB.api.writeCache(cup, [untimed], base);
assert.deepEqual(HB.api.readCache(cup).matches, [untimed]);
localStorage.setItem("hb:matches:test:42", JSON.stringify({ ts: base, matches: [untimed] }));
assert.equal(HB.api.readCache(cup), null, "cache utan aktuell schemaversion ska ignoreras");

localStorage.setItem("hb:table:test:42:99", "stale");
localStorage.setItem("hb:playoffs:test:42:7", "stale");
HB.api.invalidateSubCaches(cup);
assert.equal(localStorage.getItem("hb:table:test:42:99"), null);
assert.equal(localStorage.getItem("hb:playoffs:test:42:7"), null);

// Den publika synken läser först det lilla, gemensamma versionsindexet.
// Storfilen hämtas bara när versionen är ny och får samma stabila URL för
// alla användare av den versionen.
const sharedCup = { id: "shared", tournamentId: 77, host: "source.invalid" };
const sharedMatch = { ...finished, id: 77 };
const sharedRequests = [];
globalThis.fetch = async (url) => {
  sharedRequests.push(String(url));
  if (String(url).startsWith("data/snapshot-index.json?v=")) {
    return {
      ok: true,
      json: async () => ({
        schema: 1,
        cups: { shared: { ts: 123456, url: "data/snapshot-shared.json" } },
      }),
    };
  }
  if (String(url) === "data/snapshot-shared.json?v=123456") {
    return {
      ok: true,
      json: async () => ({ ts: 123456, matches: [sharedMatch] }),
    };
  }
  throw new Error("oväntad test-URL: " + url);
};
const firstShared = await HB.api.fetchSharedSnapshot(sharedCup, 0);
assert.equal(firstShared.unchanged, false);
assert.equal(firstShared.hasClubs, false);
assert.deepEqual(firstShared.matches, [sharedMatch]);
assert.equal(HB.api.clubGeo.shared, undefined,
  "snapshot utan clubs får inte blockera klubbkatalogens fallback med ett tomt objekt");
assert.equal(sharedRequests.filter((url) => url.includes("snapshot-shared.json")).length, 1);
const unchangedShared = await HB.api.fetchSharedSnapshot(sharedCup, 123456);
assert.equal(unchangedShared.unchanged, true);
assert.equal(sharedRequests.filter((url) => url.includes("snapshot-shared.json")).length, 1,
  "oförändrad version ska inte ladda den stora snapshotfilen igen");

console.log("data-correctness-smoke: OK");
