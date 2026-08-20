/* countries.js — ISO-koder, centroid och visningsnamn för kartan. */

// ISO 3166-1 alpha-2 -> [lng, lat], ungefärlig geografisk mittpunkt (INTE
// huvudstaden — bättre för ett stort/avlångt land som t.ex. Norge eller
// Ryssland). Statisk referensdata, samma katalog oavsett cup — landskoden
// kommer från Cup Managers/Gothias egna Nation-entiteter (se home/away.
// country, js/api.js normalize()/scripts/fetch_*.py), bara centrumpunkten
// slås upp här. Bara koder som faktiskt kan förekomma i handbolls-/
// fotbollscuper är strikt nödvändiga, men en bred, världstäckande tabell
// kostar inget extra och slipper framtida håltäckning.
export const COUNTRY_CENTROIDS = {
  SE: [16.7, 62.2], NO: [10.5, 62.0], DK: [10.0, 56.1], FI: [26.0, 63.9],
  IS: [-19.0, 65.0], FO: [-6.9, 62.0], GL: [-42.0, 72.0], AX: [19.9, 60.2],
  DE: [10.3, 51.2], NL: [5.5, 52.2], BE: [4.5, 50.6],
  LU: [6.1, 49.7], FR: [2.5, 46.6], GB: [-2.0, 54.0], IE: [-8.0, 53.4],
  ES: [-3.7, 40.3], PT: [-8.2, 39.6], IT: [12.6, 42.8], CH: [8.2, 46.8],
  AT: [14.6, 47.6], PL: [19.4, 52.0], CZ: [15.5, 49.8], SK: [19.5, 48.7],
  HU: [19.5, 47.2], SI: [14.8, 46.1], HR: [16.4, 45.1], BA: [17.8, 44.2],
  RS: [21.0, 44.0], ME: [19.3, 42.8], MK: [21.7, 41.6], AL: [20.2, 41.2],
  BG: [25.5, 42.7], RO: [24.9, 45.9], GR: [22.9, 39.1], TR: [35.2, 39.0],
  CY: [33.4, 35.1], MT: [14.4, 35.9], UA: [31.2, 48.4], BY: [27.9, 53.7],
  LT: [23.9, 55.2], LV: [24.6, 56.9], EE: [25.0, 58.6], RU: [96.7, 61.5],
  MD: [28.4, 47.2], LI: [9.5, 47.2], MC: [7.4, 43.7], AD: [1.6, 42.5],
  SM: [12.4, 43.9], VA: [12.5, 41.9], XK: [20.9, 42.6],
  US: [-98.6, 39.8], CA: [-106.3, 56.1], MX: [-102.5, 23.6],
  BR: [-51.9, -10.8], AR: [-63.6, -38.4], CL: [-71.5, -35.7],
  UY: [-56.0, -32.8], PY: [-58.4, -23.4], BO: [-63.6, -16.3],
  PE: [-75.0, -9.2], EC: [-78.2, -1.8], CO: [-74.3, 4.6],
  VE: [-66.6, 6.4], CR: [-84.1, 9.7], PA: [-80.0, 8.5],
  CU: [-77.8, 21.5], DO: [-70.2, 18.7], JM: [-77.3, 18.1],
  JP: [138.3, 36.2], CN: [104.2, 35.9], KR: [127.8, 36.0],
  KP: [127.5, 40.3], IN: [78.9, 22.4], PK: [69.3, 30.4],
  BD: [90.4, 23.7], LK: [80.8, 7.9], NP: [84.1, 28.4],
  TH: [101.0, 15.9], VN: [108.3, 14.1], KH: [104.9, 12.6],
  LA: [102.5, 19.9], MM: [95.9, 21.9], MY: [101.9, 4.2],
  SG: [103.8, 1.35], ID: [113.9, -0.8], PH: [121.8, 12.9],
  AU: [133.8, -25.3], NZ: [174.9, -40.9], FJ: [178.1, -17.7],
  SA: [45.1, 23.9], AE: [54.3, 23.4], QA: [51.2, 25.4],
  KW: [47.6, 29.3], BH: [50.6, 26.0], OM: [55.9, 21.5],
  IL: [34.9, 31.0], PS: [35.2, 31.9], JO: [36.9, 30.6],
  LB: [35.9, 33.9], SY: [38.9, 34.8], IQ: [43.7, 33.1],
  IR: [53.7, 32.4], AF: [66.0, 33.9], EG: [30.8, 26.8],
  MA: [-7.1, 31.8], DZ: [2.6, 28.0], TN: [9.5, 34.0],
  LY: [17.2, 26.3], ZA: [24.7, -30.6], NG: [8.7, 9.1],
  KE: [37.9, -0.0], ET: [40.5, 9.1], GH: [-1.0, 7.9],
  CI: [-5.5, 7.5], SN: [-14.5, 14.5], TZ: [34.9, -6.4],
  UG: [32.3, 1.4], ZW: [29.2, -19.0], ZM: [27.8, -13.1],
  NA: [17.1, -22.1], BW: [24.7, -22.3], MZ: [35.5, -18.7],
  CM: [12.7, 6.4], MG: [46.9, -18.8], GE: [43.4, 42.3],
  AM: [45.0, 40.1], AZ: [47.6, 40.1], KZ: [66.9, 48.0],
  UZ: [64.6, 41.4], KG: [74.8, 41.2], TJ: [71.3, 38.9],
  TM: [59.6, 38.9], MN: [103.8, 46.9], HK: [114.2, 22.4],
  TW: [121.0, 23.7], MO: [113.5, 22.2],
};

// Landsnamn (svenska OCH engelska, via Intl.DisplayNames) för samtliga
// koder i COUNTRY_CENTROIDS — används av matchClubName för att neka en
// riskabel tier-3-gissning när ett lagnamn ORDAGRANT bara är ett landsnamn
// (landslagsklasser som EOC, se Gothias Team.nation). Byggs en gång vid
// modulladdning, inte per anrop.
export const COUNTRY_NAME_WORDS = (() => {
  const words = new Set();
  for (const locale of ["sv", "en"]) {
    let dn;
    try { dn = new Intl.DisplayNames([locale], { type: "region" }); }
    catch { continue; }
    for (const code of Object.keys(COUNTRY_CENTROIDS)) {
      try {
        const n = dn.of(code);
        if (n) words.add(n.toLowerCase());
      } catch { /* okänd kod för denna Intl-version — hoppa */ }
    }
  }
  return words;
})();
