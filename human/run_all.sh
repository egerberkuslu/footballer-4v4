#!/bin/bash
# Tüm hattı sırayla çalıştırır (MPFB eklentisi + varlık paketi kurulu olmalı)
set -e
cd /home/ege/Blender-MCP/footballer/human
B="nice -n 19 blender -b"
F="Traceback|Error:|TAMAM|PİŞTİ|sim |itilen|GLB|silinen|çivi"
[ "$1" = "1" ] && $B --factory-startup -P s1_human.py 2>&1 | grep -E "$F" || true
$B stage1.blend -P s2_shells.py 2>&1 | grep -E "$F"
$B stage2.blend -P s3_cloth.py 2>&1 | grep -E "$F"
$B stage3.blend -P s4a_bake.py 2>&1 | grep -E "$F"
python3 tex_make.py
# (eski numaralı maske; yalnız s5 içindi, artık gerekmez)
$B stage3.blend -P s4b_finish.py -- noexport 2>&1 | grep -E "$F"
# web: 5 draw call (Govde, Kiyafet, Forma, Sort, Sac) LOD0 + LOD1, takım varyantları
NUMARASIZ=1 python3 tex_make.py maske
python3 kit_make.py
$B stage4.blend -P s6_web.py 2>&1 | grep -E "$F|ÖZET"
$B stage6.blend -P check_rig.py 2>&1 | grep -E "^TAMAM|^HATA|SONUÇ"
