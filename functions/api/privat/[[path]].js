/* GET /api/privat/<fil> — skyddad data, bara för den som får se den.

   Filerna ligger i en egen R2-hink (bindningen PRIVAT) som saknar publik
   adress. Det här är enda vägen ut, och varje förfrågan kontrolleras mot
   Clerks sessionstoken (server/clerk.js).

   Svaren cachas bara i användarens egen webbläsare (private) och varierar
   på Authorization, så ett CDN-lager kan aldrig råka ge en inloggads svar
   till någon annan. */
import { verifieraSession, räcker } from "../../../server/clerk.js";
import { CLERK_PUBLISHABLE_KEY, tillåtetUrsprung, kravFör } from "../../../server/config.js";

/* CORS bara för våra egna ursprung (server/config.js). Det öppnar ingenting:
   varje anrop kräver ändå en giltig token utfärdad åt just det ursprunget.
   Det finns för att sajten ska kunna provas lokalt mot den riktiga
   funktionen; på cupschema.se är anropet samma ursprung och CORS används
   inte alls. */
function cors(request) {
  const ursprung = request.headers.get("origin");
  return ursprung && tillåtetUrsprung(ursprung)
    ? { "access-control-allow-origin": ursprung, "vary": "Origin, Authorization" }
    : {};
}

const svar = (request, status, text) => new Response(JSON.stringify({ fel: text }), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(request) },
});

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: {
    ...cors(request),
    "access-control-allow-methods": "GET",
    "access-control-allow-headers": "authorization",
    "access-control-max-age": "86400",
  } });
}

export async function onRequestGet({ request, env, params }) {
  const fil = [].concat(params.path || []).join("/");
  const krav = kravFör(fil);
  if (!krav) return svar(request, 404, "finns inte");
  const publishableKey = env.CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY;
  if (!publishableKey || !env.PRIVAT) return svar(request, 503, "inloggning ej konfigurerad");

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = token && await verifieraSession(token, {
    publishableKey, tillåtetUrsprung,
  });
  if (!session) return svar(request, 401, "logga in");
  if (!räcker(session.nivå, krav)) return svar(request, 403, "kräver " + krav);

  const obj = await env.PRIVAT.get("data/" + fil);
  if (!obj) return svar(request, 404, "finns inte");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
      "vary": "Authorization",
      ...cors(request),
    },
  });
}
