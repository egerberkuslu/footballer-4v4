#!/usr/bin/env bash
# O2 (QA): tek komutla saglik turu. Kullanim: scripts/qa-round.sh <etiket>
cd "$(dirname "$0")/.."
E=$1; mkdir -p qa/$E
echo "tsc:"; npx tsc -b 2>&1 | tail -3
scripts/run-browser.sh node scripts/qa-ff.mjs qa/$E/ff >/dev/null 2>&1
python3 - <<PY
import json
for r in json.load(open('qa/$E/ff/ff.json')): print('ff',r['name'],r['info']['phase'],[l['kind']+':'+l['msg'][:80] for l in r['logs'] if l['kind']!='reload'] or 'temiz')
PY
scripts/run-browser.sh node scripts/qa-match.mjs qa/$E/mac --sec 90 --shots 8 2>&1 | grep OZET | cut -c1-400
scripts/run-browser.sh node scripts/qa-scenarios.mjs qa/$E/sc 2>&1 | grep -E "^(GECTI|KALDI|DOGRULANAMADI)" | cut -c1-80
