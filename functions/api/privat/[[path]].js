/* GET /api/privat/<fil> — skyddad data, bara för den som får se den.

   Filerna ligger i en egen R2-hink (bindningen PRIVAT) som saknar publik
   adress. Det här är enda vägen ut, och varje förfrågan kontrolleras mot
   Clerks sessionstoken (server/clerk.js).

   Svaren cachas bara i användarens egen webbläsare (private) och varierar
   på Authorization, så ett CDN-lager kan aldrig råka ge en inloggads svar
   till någon annan. */
import { verifieraSession, räcker } from "../../../server/clerk.js";
import { CLERK_PUBLISHABLE_KEY, tillåtetUrsprung, kravFör } from "../../../server/config.js";

const svar = (status, text) => new Response(JSON.stringify({ fel: text }), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function onRequestGet({ request, env, params }) {
  const fil = [].concat(params.path || []).join("/");
  const krav = kravFör(fil);
  if (!krav) return svar(404, "finns inte");
  const publishableKey = env.CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY;
  if (!publishableKey || !env.PRIVAT) return svar(503, "inloggning ej konfigurerad");

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = token && await verifieraSession(token, {
    publishableKey, tillåtetUrsprung,
  });
  if (!session) return svar(401, "logga in");
  if (!räcker(session.nivå, krav)) return svar(403, "kräver " + krav);

  const obj = await env.PRIVAT.get("data/" + fil);
  if (!obj) return svar(404, "finns inte");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
      "vary": "Authorization",
    },
  });
}
