/* auth.js — inloggning i klienten, via Clerk.

   Viktigt att förstå vad den här filen INTE gör: den skyddar ingenting.
   Vem som helst kan läsa och ändra koden i sin egen webbläsare. Spärren
   sitter i functions/api/privat, som kontrollerar Clerks signerade token
   på servern. Här finns bara bekvämligheten: veta om man är inloggad,
   hämta en token att skicka med, och visa rätt knappar.

   Vilande utan nyckel. Är HB.CLERK_PUBLISHABLE_KEY tom laddas ingenting,
   HB.auth.aktiv är false, och appen hämtar skyttedatan som den alltid
   gjort. Det gör att klientändringen kan driftsättas före omkopplingen.

   Clerk laddas efter att appen ritats, i bakgrunden. Den är flera hundra
   kilobyte och schemat ska inte vänta på den; när den är klar ritas
   appen om med rätt nivå. */

window.HB = window.HB || {};

(function () {
  const nyckel = HB.CLERK_PUBLISHABLE_KEY || "";
  let clerk = null;
  let laddning = null;
  const lyssnare = new Set();

  function frontendApi() {
    // "pk_test_<base64("abc.clerk.accounts.dev$")>" -> "abc.clerk.accounts.dev"
    try { return atob(nyckel.split("_").slice(2).join("_")).replace(/\$$/, ""); }
    catch { return ""; }
  }

  function meddela() { for (const fn of lyssnare) { try { fn(); } catch { /* en trasig lyssnare får inte stoppa de andra */ } } }

  function starta() {
    if (!nyckel) return Promise.resolve(null);
    if (laddning) return laddning;
    laddning = new Promise((klar) => {
      const s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.src = "https://" + frontendApi() + "/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      s.setAttribute("data-clerk-publishable-key", nyckel);
      s.onload = async () => {
        try {
          clerk = window.Clerk;
          await clerk.load();
          clerk.addListener(meddela);
          meddela();
        } catch (e) {
          console.warn("[hboll] inloggningen kunde inte startas", e);
          clerk = null;
        }
        klar(clerk);
      };
      // Går Clerk inte att nå fungerar appen som för en utloggad besökare.
      s.onerror = () => { console.warn("[hboll] Clerk gick inte att ladda"); klar(null); };
      document.head.append(s);
    });
    return laddning;
  }

  HB.auth = {
    get aktiv() { return !!nyckel; },
    get redo() { return !!clerk; },

    // Nivån här styr bara vad som VISAS. Servern avgör vad som lämnas ut.
    nivå() {
      const u = clerk && clerk.user;
      if (!u) return "anonym";
      return (u.publicMetadata && u.publicMetadata.plan === "full") ? "full" : "inloggad";
    },
    inloggad() { return HB.auth.nivå() !== "anonym"; },
    användare() {
      const u = clerk && clerk.user;
      return u ? (u.firstName || u.primaryEmailAddress?.emailAddress || "Inloggad") : null;
    },

    // Kortlivad sessionstoken (en minut) att skicka i Authorization.
    // Clerk förnyar den själv, så den hämtas färsk vid varje anrop.
    async token() {
      if (!clerk || !clerk.session) return null;
      try { return await clerk.session.getToken(); } catch { return null; }
    },

    async loggaIn() {
      const c = await starta();
      if (c) c.openSignIn({});
    },
    async loggaUt() {
      if (clerk) await clerk.signOut();
    },
    monteraKonto(el) {
      if (clerk && el) clerk.mountUserButton(el);
    },

    /* Vad varje sorts data kräver för att VISAS. Speglar kravFör i
       server/config.js — när betalningen kommer ändras spelardata till
       "full" på båda ställena. Servern är den som faktiskt spärrar; det
       här avgör bara om vyn visar datan eller en "logga in"-ruta. */
    krav: { spelardata: "inloggad" },

    // Innan inloggningen är aktiv visas allt, precis som förut.
    harTillgång(vad) {
      if (!nyckel) return true;
      const ordning = ["anonym", "inloggad", "full"];
      return ordning.indexOf(HB.auth.nivå()) >= ordning.indexOf(HB.auth.krav[vad] || "anonym");
    },

    vidÄndring(fn) { lyssnare.add(fn); return () => lyssnare.delete(fn); },
    starta,
  };
})();
