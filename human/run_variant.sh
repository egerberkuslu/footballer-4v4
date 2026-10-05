#!/bin/bash
# Varyant üretimi: ./run_variant.sh <ad> (ortam değişkenleri varyant ayarıdır, bkz. s1_human.py başı)
# Ana modele dokunmaz: ayrı çalışma dizini wip/var_<ad>, çıktı wip/var_<ad>/out/futbolcu_<ad>*.glb
set -e
AD=$1
SRC=/home/ege/Blender-MCP/footballer/human
export HUMAN_DIR=$SRC/wip/var_$AD
mkdir -p $HUMAN_DIR/out $HUMAN_DIR/kits $HUMAN_DIR/bake $HUMAN_DIR/tex
cp $SRC/*.py $SRC/kit_layout.json $HUMAN_DIR/
export PUB_OUT=$HUMAN_DIR/out KITS_OUT=$HUMAN_DIR/kits
cd $HUMAN_DIR
B="nice -n 19 blender -b"
F="Traceback|Error:|TAMAM|PİŞTİ|HEDEF YOK"
$B --factory-startup -P s1_human.py 2>&1 | grep -E "$F" || true
$B stage1.blend -P s2_shells.py 2>&1 | grep -E "$F"
$B stage2.blend -P s3_cloth.py 2>&1 | tee s3.log | grep -E "$F"
$B stage3.blend -P s4a_bake.py 2>&1 | grep -E "$F"
nice -n 19 python3 tex_make.py
$B stage3.blend -P s4b_finish.py -- noexport 2>&1 | grep -E "$F"
NUMARASIZ=1 nice -n 19 python3 tex_make.py maske
nice -n 19 python3 kit_make.py
$B stage4.blend -P s6_web.py 2>&1 | grep -E "$F|ÖZET"
mv out/futbolcu.glb out/futbolcu_$AD.glb; mv out/futbolcu_lod1.glb out/futbolcu_${AD}_lod1.glb
$B stage6.blend -P check_rig.py 2>&1 | grep -E "^HATA|SONUÇ"
