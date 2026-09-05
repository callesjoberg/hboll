#!/usr/bin/env bash
# Skrapa och publicera cupdata — och fortsätt göra det i femminuterstakt
# så länge det spelas matcher någonstans.
#
# Bakgrunden: workflowet är schemalagt var 20:e minut, men GitHub kör
# schemalagda jobb "best effort" och startar oss i praktiken bara var
# andra till var femte timme (mätt över hela augusti–september). Att be
# om tätare cron ger inte en enda extra körning — så i stället för att
# be oftare stannar EN körning kvar och jobbar. Publika repon har fria
# Actions-minuter, och en körning som inte träffar matchtid avslutas
# efter första varvet precis som förut.
#
# Loopen bryts när ingen cup längre har matcher inom sitt tidsfönster
# (se playing_now i scripts/_freshness.py) eller när taket nåtts —
# jobbtaket hos GitHub är sex timmar, så vi håller oss under det med
# marginal och låter nästa schemalagda körning ta vid.

set -uo pipefail

LOOP_MAX_SECONDS="${LOOP_MAX_SECONDS:-16200}"      # 4 h 30 min
LOOP_PERIOD_SECONDS="${LOOP_PERIOD_SECONDS:-300}"  # 5 min mellan varv

ROT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROT"

git config user.name "procup-bot"
git config user.email "actions@users.noreply.github.com"

hämta() {
  python3 scripts/fetch_procup.py                || return 1
  python3 scripts/fetch_gothia.py                || return 1
  python3 scripts/fetch_cupmanager.py            || return 1
  python3 scripts/build_snapshot_index.py        || return 1
  python3 scripts/build_club_directory.py        || return 1
  python3 scripts/archive_results.py             || return 1
  python3 scripts/build_team_index.py            || return 1
  python3 scripts/build_landing_map.py           || return 1
  python3 scripts/build_cup_windows.py           || return 1
}

publicera() {
  git add data/
  if git diff --cached --quiet; then
    echo "Ingen ändring — hoppar över commit."
    return 0
  fi
  git commit -m "Uppdatera cupdata"
  # Race-härdad push: schemalagda körningar (plus manuella pushar) kan
  # hinna krocka. Försök integrera och pusha om, annars hoppa tyst över
  # just den här publiceringen i stället för att fela jobbet.
  local n=0
  until git push; do
    n=$((n+1))
    if [ "$n" -ge 5 ]; then
      echo "Push misslyckades efter $n försök."
      return 1
    fi
    echo "Push avvisad (kapplöpning) — försöker igen ($n)."
    if ! git pull --rebase --autostash origin main; then
      git rebase --abort 2>/dev/null || true
      echo "Rebase-konflikt — hoppar över den här publiceringen (nästa varv fixar)."
      return 0
    fi
    sleep $(( (RANDOM % 4) + 2 ))
  done
}

start="$(date +%s)"
varv=0
while :; do
  varv=$((varv+1))
  varv_start="$(date +%s)"
  echo "::group::Varv $varv ($(date -u +%H:%M:%S) UTC)"
  hämta || echo "Varv $varv: en skrapa felade — publicerar det som hann bli klart."
  publicera || { echo "::endgroup::"; exit 1; }
  echo "::endgroup::"

  # Loopa bara vidare när det faktiskt spelas. Utanför matchtid räcker
  # den schemalagda kadensen gott — då ändras ingenting ändå.
  if ! python3 scripts/any_cup_playing.py; then
    echo "Ingen matchtid kvar — avslutar efter $varv varv."
    break
  fi

  nu="$(date +%s)"
  if [ $(( nu - start )) -ge "$LOOP_MAX_SECONDS" ]; then
    echo "Nått taket på ${LOOP_MAX_SECONDS}s efter $varv varv — nästa körning tar vid."
    break
  fi

  # Mät perioden från varvets BÖRJAN, så takten blir fem minuter även när
  # skrapningen tar två av dem.
  sov=$(( LOOP_PERIOD_SECONDS - (nu - varv_start) ))
  [ "$sov" -gt 0 ] && sleep "$sov"
done
