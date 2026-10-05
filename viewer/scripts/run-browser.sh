#!/usr/bin/env bash
# Tum bassiz tarayici testleri BU sarmalayicidan gecer:
#  - makine genelinde 2 yuvali kilit: ayni anda en fazla iki test tarayicisi
#  - nice 19: kullanicinin Firefox'u her zaman once CPU alir
# Kullanim: scripts/run-browser.sh node scripts/shot.mjs shots/x.png --q "..."
DIR=/tmp/claude-1000
mkdir -p "$DIR"
SLOTS=("$DIR/footballer-browser.lock" "$DIR/footballer-browser-2.lock")
deadline=$(( $(date +%s) + 900 ))
while :; do
  for L in "${SLOTS[@]}"; do
    exec 9>"$L"
    if flock -n 9; then
      # kilit fd 9 uzerinde, alt surece miras gecer; surec bitince birakilir
      exec nice -n 19 "$@"
    fi
    exec 9>&-
  done
  [ "$(date +%s)" -ge "$deadline" ] && { echo "run-browser: 900 s icinde yuva bulunamadi" >&2; exit 75; }
  sleep 2
done
