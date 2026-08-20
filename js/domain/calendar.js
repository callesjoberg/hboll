/* calendar.js — prenumererbar kalender-URL för ett lag. */

import { slugifyTeamId } from "./club.js";

// Prenumererbar kalender-URL för ETT lags matcher, eller null om ingen
// finns för den här cupen/laget. Cup Manager har en egen inbyggd
// livetjänst (regenereras vid varje hämtning, alltid färsk) som funkar
// för ALLA lag. calendarHost pekar ut livetjänstens värd när den skiljer
// sig från cupens vanliga host (Partille kör den via Cup Manager). ProCup
// (procup.se) saknar kalenderexport helt — verifierat genom att deras sidor
// inte innehåller några ics/ical/webcal-länkar — så där finns bara statiska
// filer (byggda av scripts/_ics.py, uppdaterade i samma takt som resten av
// cupens data) och bara för klubbens egna lag.
export function calendarSubscribeUrl(team, cup, isClubTeam) {
  if (!team || !cup) return null;
  if (cup.calendarHost) {
    return "https://" + cup.calendarHost + "/service/GetTeamCalendarService?teamId=" + team.id;
  }
  if (!cup.dataUrl) {
    return "https://" + cup.host + "/service/GetTeamCalendarService?teamId=" + team.id;
  }
  if (isClubTeam) {
    return "data/ics/" + cup.id + "/" + slugifyTeamId(team.id) + ".ics";
  }
  return null;
}

// webcal:// gör att kalenderappen PRENUMERERAR (auto-uppdaterar) i stället
// för att bara ladda ner en engångsfil. Samma omvandling i lagrutan och
// exportpanelen, så byts den här följer båda med.
export function calendarWebcalUrl(raw, baseHref) {
  if (!raw) return null;
  return new URL(raw, baseHref).href.replace(/^https?:/i, "webcal:");
}
