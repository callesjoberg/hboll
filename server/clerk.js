/* clerk.js — verifierar en Clerk-sessionstoken på servern.

   Körs i Cloudflares Pages Functions men är ren Web Crypto, så samma kod
   går att testa i Node (tests/server-auth.test.mjs).

   Ingen hemlig nyckel behövs. Clerk signerar sessionstoken med RS256 och
   publicerar de publika nycklarna på <frontend-api>/.well-known/jwks.json;
   frontend-API:ts adress står kodad i den publika publishable key. En
   läckt serverhemlighet kan alltså aldrig bli en väg in, för det finns
   ingen.

   Det här är den ENDA spärren som räknas. Allt klienten gör — dölja
   knappar, visa "logga in" — är bara bekvämlighet, eftersom vem som
   helst kan läsa och ändra koden i sin egen webbläsare. */

// "pk_test_<base64("abc.clerk.accounts.dev$")>" -> "abc.clerk.accounts.dev"
export function frontendApiFrånNyckel(publishableKey) {
  const delar = String(publishableKey || "").split("_");
  if (delar.length < 3 || !/^pk$/.test(delar[0])) throw new Error("ogiltig publishable key");
  return atob(delar.slice(2).join("_")).replace(/\$$/, "");
}

const b64urlBytes = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

// Nycklarna byts sällan; en timme i minnet sparar ett anrop per förfrågan.
// Okänt kid tvingar ändå fram en ny hämtning, så en roterad nyckel börjar
// fungera direkt i stället för efter en timme.
const nyckelCache = new Map();
async function nycklarFör(frontendApi, fetchImpl, tvinga) {
  const url = "https://" + frontendApi + "/.well-known/jwks.json";
  const c = nyckelCache.get(url);
  if (!tvinga && c && Date.now() - c.tid < 3600_000) return c.nycklar;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error("jwks " + r.status);
  const nycklar = (await r.json()).keys || [];
  nyckelCache.set(url, { nycklar, tid: Date.now() });
  return nycklar;
}

/* Nivåer, i stigande ordning. "full" sätts i Clerk som publicMetadata.plan
   och läggs in i sessionstoken via en egen claim; tills betalningen finns
   har alla inloggade nivån "inloggad". */
export const NIVÅER = ["anonym", "inloggad", "full"];
export const räcker = (har, krav) => NIVÅER.indexOf(har) >= NIVÅER.indexOf(krav);

/* Returnerar {användare, nivå} för en giltig token, annars null. Varje
   avvisning är null och aldrig ett undantag: servern ska svara 401, inte
   500, på en trasig eller förfalskad token. */
export async function verifieraSession(token, {
  publishableKey, tillåtetUrsprung = () => true,
  nu = Math.floor(Date.now() / 1000), fetchImpl = fetch,
} = {}) {
  const delar = String(token || "").split(".");
  if (delar.length !== 3) return null;
  const [h, p, s] = delar;
  let huvud, kropp, frontendApi;
  try {
    huvud = b64urlJson(h); kropp = b64urlJson(p);
    frontendApi = frontendApiFrånNyckel(publishableKey);
  } catch { return null; }
  // Bara RS256. Att godta "none" eller en symmetrisk algoritm är den
  // klassiska vägen att förfalska en JWT.
  if (huvud.alg !== "RS256" || !huvud.kid) return null;

  let nycklar;
  try {
    nycklar = await nycklarFör(frontendApi, fetchImpl, false);
    if (!nycklar.some((k) => k.kid === huvud.kid)) {
      nycklar = await nycklarFör(frontendApi, fetchImpl, true);
    }
  } catch { return null; }
  const jwk = nycklar.find((k) => k.kid === huvud.kid);
  if (!jwk) return null;

  let äkta = false;
  try {
    const nyckel = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    äkta = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", nyckel,
      b64urlBytes(s), new TextEncoder().encode(h + "." + p));
  } catch { return null; }
  if (!äkta) return null;

  // Fem sekunders marginal för klockor som inte går exakt lika.
  const MARGINAL = 5;
  if (typeof kropp.exp !== "number" || kropp.exp < nu - MARGINAL) return null;
  if (typeof kropp.nbf === "number" && kropp.nbf > nu + MARGINAL) return null;
  if (kropp.iss !== "https://" + frontendApi) return null;
  // azp är sidan som bad om token. En token utfärdad åt en annan sajt som
  // råkar använda samma Clerk-app ska inte gälla här.
  if (kropp.azp && !tillåtetUrsprung(kropp.azp)) return null;
  if (!kropp.sub) return null;

  return { användare: kropp.sub, nivå: kropp.plan === "full" ? "full" : "inloggad" };
}
