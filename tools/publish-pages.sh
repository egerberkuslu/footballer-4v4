#!/usr/bin/env bash
# GitHub Pages yayini: viewer/dist -> AYRI public depo (yalniz derlenmis oyun) -> Pages.
# Kaynak depo (egerberkuslu/footballer-4v4) PRIVATE kalir; public depoda yalniz derlenmis site vardir.
# Commit e-postasi GitHub noreply adresidir (gercek e-posta public gecmise girmez).
# Ev dizini bir git deposu: yalnizca footballer/ icinde calisir.
set -euo pipefail
cd /home/ege/Blender-MCP/footballer
SRC=egerberkuslu/footballer-4v4
SITE=egerberkuslu/footballer-4v4-play
NOREPLY="33733776+egerberkuslu@users.noreply.github.com"

# 1) kaynak deposunu kaydet (private)
git add -A
git commit -q -m "yayin oncesi kayit $(date +%F-%H%M)" || true
git push -q origin main

# 2) temiz uretim derlemesi (tsc -b + vite build; base './' alt yol icin)
( cd viewer && npm run build >/dev/null )
[ -f viewer/dist/index.html ] || { echo "dist/index.html yok, derleme basarisiz"; exit 4; }

# 3) site deposu (public) yoksa olustur
if ! gh repo view "$SITE" >/dev/null 2>&1; then
  gh repo create "$SITE" --public --description "Esnaf Kupasi, Hali Saha 4'e 4: oynanabilir surum (Three.js, React, WebGL)" >/dev/null
fi

# 4) dist + README -> orphan dal
TMP=$(mktemp -d)
cp -r viewer/dist/. "$TMP/"
touch "$TMP/.nojekyll"
cat > "$TMP/README.md" <<'EOF'
# ESNAF KUPASI

Hali Saha 4'e 4: mahalle esnaf turnuvasi (Berberler Spor ve Bakkallar Spor), tarayicida oynanan gercekci 4'e 4 futbol oyunu (Three.js, React, WebGL). Bu depo yalnizca derlenmis surumu icerir.

Kontroller: WASD hareket, Shift kos, Bosluk (basili tut) sut, K pas, E mudahale (cift dokunus: kayarak), Q oyuncu degistir, `,` `.` falso. PS4/DualShock destekli (Menu > Kol Ayarlari). Cok oyunculu (oda kodu ile, P2P).
EOF
cd "$TMP"
git init -q -b main
git config user.name  "egerberkuslu"
git config user.email "$NOREPLY"
git add -A
git commit -q -m "yayin: $(date +%F-%H%M)"
git remote add origin "https://github.com/$SITE.git"
git push -q -f origin main

# 5) Pages'i main kokunden ac (zaten aciksa guncelle)
gh api -X POST "repos/$SITE/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$SITE/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
echo "PAGES_URL https://egerberkuslu.github.io/footballer-4v4-play/"
