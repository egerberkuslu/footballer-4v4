#!/usr/bin/env bash
# Is kaydet + GitHub'a OZEL depo olarak yukle. Ev dizini bir git deposu: SADECE footballer/ icinde calisir.
set -euo pipefail
cd /home/ege/Blender-MCP/footballer
REPO=egerberkuslu/footballer-4v4

# 1) gizli bilgi taramasi (bulunursa durur)
if grep -rIE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dl --exclude-dir=shots \
     -e '(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|olp_[A-Za-z0-9]{10,})' . 2>/dev/null | head -3 | grep -q .; then
  echo "GIZLI BILGI BULUNDU, push iptal"; exit 2
fi

# 2) bu klasorde kendi deposu (ev dizinindeki git'e karismaz)
[ -d .git ] || git init -q -b main
git config user.name  "$(git config --global user.name  || echo egerberkuslu)"
git config user.email "$(git config --global user.email || echo noreply@users.noreply.github.com)"

# 3) boyut kontrolu: 50 MB ustu dosya girmesin
big=$(git ls-files -o --exclude-standard -z | xargs -0 -r du -k 2>/dev/null | awk '$1>50000{print $2}' | head -5)
if [ -n "$big" ]; then echo "50 MB ustu dosyalar (gitignore'a ekle):"; echo "$big"; exit 3; fi

[ "${DRY:-0}" = 1 ] && { echo "DRY_OK: gizli bilgi yok, buyuk dosya yok"; git status --short | wc -l | xargs echo "izlenmeyen/degisen dosya:"; du -sk --exclude=.git --exclude=node_modules . | awk '{print "boyut KB:", $1}'; exit 0; }
git add -A
git commit -q -m "kaydet: oyun durumu $(date +%F-%H%M)" || echo "degisiklik yok"

# 4) GitHub (ozel depo; Pages icin sonra public yapilir)
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --private --source=. --remote=origin --description "4v4 gercekci futbol oyunu (Three.js, R3F, Blender)" >/dev/null
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
git push -u origin main 2>&1 | tail -3
echo "PUSH_TAMAM $(git rev-parse --short HEAD)"
