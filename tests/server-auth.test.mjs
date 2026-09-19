/* Serverns tokenkontroll — den enda spärren som faktiskt skyddar datan.
   Testas med en riktig RSA-nyckel skapad här, så signaturvägen prövas på
   riktigt i stället för att mockas bort. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifieraSession, frontendApiFrånNyckel, räcker } from "../server/clerk.js";

const FRONTEND = "test-app.clerk.accounts.dev";
const PK = "pk_test_" + btoa(FRONTEND + "$");
const NU = 1_800_000_000;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const par = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const publik = { ...(await crypto.subtle.exportKey("jwk", par.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const främmande = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);

async function signera(kropp, { huvud = { alg: "RS256", kid: "k1", typ: "JWT" }, nyckel = par.privateKey } = {}) {
  const h = b64urlJson(huvud), p = b64urlJson(kropp);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", nyckel, new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64url(sig);
}
const giltig = (extra = {}) => ({ sub: "user_1", iss: "https://" + FRONTEND, azp: "https://cupschema.se",
  exp: NU + 60, nbf: NU - 10, iat: NU - 10, ...extra });
let hämtningar = 0;
const fetchImpl = async (url) => {
  hämtningar++;
  assert.equal(url, "https://" + FRONTEND + "/.well-known/jwks.json");
  return { ok: true, json: async () => ({ keys: [publik] }) };
};
const opts = { publishableKey: PK, nu: NU, fetchImpl,
  tillåtetUrsprung: (o) => o === "https://cupschema.se" };

test("frontend-API läses ur publishable key", () => {
  assert.equal(frontendApiFrånNyckel(PK), FRONTEND);
  assert.throws(() => frontendApiFrånNyckel("sk_test_abc"));
});

test("en äkta, färsk token godtas och ger nivån inloggad", async () => {
  assert.deepEqual(await verifieraSession(await signera(giltig()), opts),
    { användare: "user_1", nivå: "inloggad" });
});

test("plan=full i token ger nivån full", async () => {
  const s = await verifieraSession(await signera(giltig({ plan: "full" })), opts);
  assert.equal(s.nivå, "full");
});

test("förfalskningar och fel avvisas — alltid null, aldrig undantag", async () => {
  const fall = {
    "fel nyckel": await signera(giltig(), { nyckel: främmande.privateKey }),
    "utgången": await signera(giltig({ exp: NU - 60 })),
    "inte giltig än": await signera(giltig({ nbf: NU + 60 })),
    "annan utfärdare": await signera(giltig({ iss: "https://ond.clerk.accounts.dev" })),
    "annan sajt": await signera(giltig({ azp: "https://ond.example" })),
    "utan användare": await signera(giltig({ sub: undefined })),
    "alg none": b64urlJson({ alg: "none", kid: "k1" }) + "." + b64urlJson(giltig()) + ".",
    "okänt kid": await signera(giltig(), { huvud: { alg: "RS256", kid: "okänd" } }),
    "skräp": "inte.en.token",
    "tom": "",
  };
  for (const [namn, token] of Object.entries(fall)) {
    assert.equal(await verifieraSession(token, opts), null, namn);
  }
});

test("ändrad kropp med behållen signatur avvisas", async () => {
  const [h, , s] = (await signera(giltig())).split(".");
  const förfalskad = h + "." + b64urlJson(giltig({ plan: "full" })) + "." + s;
  assert.equal(await verifieraSession(förfalskad, opts), null);
});

test("nycklarna hämtas en gång och återanvänds", async () => {
  const före = hämtningar;
  for (let i = 0; i < 3; i++) await verifieraSession(await signera(giltig()), opts);
  assert.equal(hämtningar - före, 0);
});

test("nivåer jämförs i stigande ordning", () => {
  assert.ok(räcker("full", "inloggad"));
  assert.ok(räcker("inloggad", "inloggad"));
  assert.ok(!räcker("inloggad", "full"));
  assert.ok(!räcker("anonym", "inloggad"));
});

test("serverfunktionen: rätt statuskod i varje läge", async () => {
  const { onRequestGet } = await import("../functions/api/privat/[[path]].js");
  const orgFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const R2 = { get: async (k) => (k === "data/scorers-ahus.json"
      ? { body: '{"players":[]}' } : null) };
    const anrop = async (fil, { token, env = { PRIVAT: R2, CLERK_PUBLISHABLE_KEY: PK } } = {}) => {
      const headers = new Headers(token ? { authorization: "Bearer " + token } : {});
      const r = await onRequestGet({ request: new Request("https://cupschema.se/api/privat/" + fil, { headers }),
        env, params: { path: fil.split("/") } });
      return r;
    };
    // Klockan i funktionen är den riktiga, så token måste vara färsk nu.
    const nu = Math.floor(Date.now() / 1000);
    const färsk = await signera(giltig({ exp: nu + 60, nbf: nu - 5, iat: nu - 5 }));

    assert.equal((await anrop("hemlig.json", { token: färsk })).status, 404, "okänd fil");
    assert.equal((await anrop("scorers-ahus.json", { token: färsk, env: { PRIVAT: R2 } })).status, 503, "utan nyckel");
    assert.equal((await anrop("scorers-ahus.json")).status, 401, "utan token");
    assert.equal((await anrop("scorers-ahus.json", { token: "skräp.skräp.skräp" })).status, 401, "trasig token");
    assert.equal((await anrop("../index.json", { token: färsk })).status, 404, "vägtraversering");
    assert.equal((await anrop("scorers-bohus.json", { token: färsk })).status, 404, "saknas i hinken");

    const ok = await anrop("scorers-ahus.json", { token: färsk });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "private, max-age=60");
    assert.equal(ok.headers.get("vary"), "Authorization");
    assert.equal(await ok.text(), '{"players":[]}');
  } finally {
    globalThis.fetch = orgFetch;
  }
});

test("klientens och serverns publishable key är samma", async () => {
  const { readFileSync } = await import("node:fs");
  const klient = /HB\.CLERK_PUBLISHABLE_KEY\s*=\s*"([^"]*)"/.exec(readFileSync("js/config.js", "utf8"));
  const { CLERK_PUBLISHABLE_KEY } = await import("../server/config.js");
  assert.ok(klient, "js/config.js saknar HB.CLERK_PUBLISHABLE_KEY");
  assert.equal(klient[1], CLERK_PUBLISHABLE_KEY,
    "js/config.js och server/config.js har olika nycklar — servern skulle avvisa varje inloggning");
});
