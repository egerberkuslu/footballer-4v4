# Ajan brifi: Esnaf Kupasi gercekci animasyon (ORTAK, hepsi okur)

Oyun: `/home/ege/Blender-MCP/footballer/` (Three.js + React Three Fiber, TypeScript). Oyun kodu `viewer/src`.
Hedef: Ege (kullanici) oyundaki hareketlerin GERCEKCI gorunmesini istiyor. "Hayatimda boyle kosu gormedim, hic gercek degil"
dedi. Olcut gozle gorulen gerceklik + sayisal dogrulama (ayak kaymasi, zemin temasi, zamanlama). Iddia ancak kanitla.

## Mimari (kisa)
- Karakter: `viewer/public/futbolcu.glb`, MPFB `game_engine` iskeleti, 53 kemik, UE4 mankeni adlari (`Root, pelvis, spine_01..03,
  neck_01, head, clavicle/upperarm/lowerarm/hand_l|r, thigh/calf/foot/ball_l|r`, parmaklar). Dinlenme pozu ozel "kollar asagida",
  ASIMETRIK (sol ayak ~22 cm, sag ayak ~-12 cm dista). 0 animasyon klibi vardir.
- Hareketi `viewer/src/anim/rig.ts` `RigDriver` surer: parametrik `Pose` (anim/pose.ts) -> kemik yonelimleri. Parametrik animasyonlar:
  `anim/gait.ts` (kosu/yurume), `anim/actions.ts` (aksiyon klipleri: kick, pass, tackle, slide, fall, getup, header, keeper-*),
  `anim/animator.ts` (karisim, top dokunusu, el IK).
- **Katman sistemi (YENI, senin calisma alanin):** her karede `rig.apply(pose)` SONRASI `anim/layers/index.ts` `runLayers(ctx)`
  katmanlari sirayla calistirir: `loco.ts, kick.ts, pass.ts, tackle.ts, fall.ts, keeper.ts`. Her katman SADECE KENDI aksiyonunda
  (ctx.name) is yapar ve kemikleri mocap klibiyle ezer (`rig.blendBone/blendPelvis`), istenirse `rig.reachFoot` ile ayagi
  topa ceker. `ctx`: rig, anim, st (kalici durum: `layerState(ctx,'anahtar',()=>...)`), id, name (oyun anim adi), animT (aksiyon
  basindan beri s), hasBall, lvx/lvz (karakter uzayi hiz), gdt, ball (karakter uzayi, x sol, y yukseklik, z ileri).
  Ornekler: `layers/kick.ts` (calisan, CMU sut), `layers/loco.ts` (calisan, Quaternius jog/sprint).
- `rig.ts` ortak. YALNIZCA Edit ile, mevcut metotlari DEGISTIRMEDEN, dosya sonuna/uygun yere YENI public metot ekleyerek
  genislet (baska ajan da ekliyor; tum dosyayi yeniden yazma, Write yasak). Mevcut: `blendBone(name, delta, w)`,
  `blendPelvis(dx,dy,dz,w)` (metre, model uzayi), `bonePos(name,out)` (FK), `reachFoot(side,target,w)` (2 kemikli IK).
- Oyun anim adlari/sureleri: `anim/timing.ts` `CLIP_LEN` (kick 0.75/temas 0.28, pass 0.55/0.22, tackle 0.7/0.22, slide 0.8/0.25,
  fall 1.0, getup 1.1, header 0.6/0.38, ...). Simulasyon bu temas anlarinda topu/temasi isler; animasyon bunlara UYMALI.
  Aksiyonlari tetikleyen mantik: `control/locomotion.ts` (setAnim), `control/actions.ts`, `game/types.ts`. BUNLARA DOKUNMA.

## Klip boru hatti (calisan; kopyala-uyarla)
Referans betikler `anim_src/`: `bake_loco.py` (Quaternius UAL), `bake_kick.py` (CMU, cgspeed iskeleti). Calistirma:
`blender -b -P bake_xxx.py` (Blender 4.0.2, /usr/bin/blender). Kaynaklar `anim_src/` altinda ve **git disi** (`.gitignore`'da):
- `anim_src/ual1/...` Quaternius UAL1 Standard (CC0): Idle/Walk/Jog/Sprint/Roll/Jump/Hit_Chest/Death01/... 43 klip, 65 kemik.
- `anim_src/cmu_fbx.zip` CMU mocap (2552 FBX, RancidMilk dagitimi, **cgspeed iskeleti**: hip, abdomen, chest, neck, head,
  rCollar/rShldr/rForeArm/rHand, rThigh/rShin/rFoot, l*..., 30 fps, birim cm). `cmu_pick/` icine ihtiyacin olani cikar.
  CMU dizini: `anim_src/cmu_index.json` (subject 9,10,11,16,35,38,39 coz). Kelime arama:
  `http://mocap.cs.cmu.edu/search.php?subjectnumber=%25&motion=<kelime>&...` (curl). Futbol: 10_xx, 11_01 (sut). Dusme: 90_16
  (fall on face). Kalkis: 139_16/17/18, 140_01 (yuz ustu), 140_03/04 (yan). Kosu/jog: 09_xx, 35_17..26, 16_08 (ani durus), 38_03
  (daire kosu). Yurume: 35_01.., 16_15.. , donus: 16_17..20 (90 derece).
Yontem (DOGRULANMIS, bozma):
1. **Dunya-uzayi delta aktarimi**: her kemik icin `D = Ps @ Rs^-1` (kaynak poz/dinlenme dunya donusleri), hedefte `R = D @ Rd`;
   `pb.matrix = Translation(t) @ R` (ebeveynden cocuga, her kemikte `view_layer.update()`).
2. **Bacaklar (thigh/calf/foot) icin MUTLAK yon**: `q = Rd.col[1].rotation_difference(Rs.col[1]); Rd2 = q.to_matrix() @ Rd;
   R = Ps @ (Rs.inverted() @ Rd2)` (hedefin asimetrik dinlenme pozu bacaklara tasinmasin).
3. **Kollar icin T-poz duzeltmesi**: kaynak T-pozu, hedef kollar asagida. `K = rdir(dst upperarm).rotation_difference(rdir(src
   upperarm))` (dunya Y etrafinda, XZ'ye izdusum), `R = (Ps @ Rs.inverted()) @ (K.to_matrix() @ Rd)` (upperarm/lowerarm/hand).
4. Eksen: Blender Z-yukari, ileri = **-Y**; glTF/three Y-yukari, ileri +Z. Donusum `(x,y,z)_g = (x, z, -y)_b`, kuaterniyon
   `[q.x, q.z, -q.y, q.w]`. Cikti JSON: **dinlenmeden sapma** `delta = pb.matrix.rot @ matrix_local.rot^-1` (kemik rulosundan bagimsiz),
   `blendBone` `q = delta * dinlenme_yonelimi` uygular. Pelvis konumu metre cinsinden dinlenmeden sapma.
5. **Yer**: hedef bacak CMU'dan ~%27, Quaternius'tan ~%10 uzun. Pelvis yuksekligini kalca olceginden DEGIL, her karede yere basan
   bilek yuksekliginden coz (bake_kick.py'deki `srcmin` yontemi). Koku (yatay pelvis) yerinde (in-place) yap; yer degisimini simulasyon yapar.
6. Dongu klipleri: iki ayni-ayak temasi arasi tek devir, M=24 ornek, faz 0 = sol ayak basar (parametrik `gait.ts` ile ayni
   tanim: `u<beta` basma, faz 0'da sol temas). Referans hiz = basma fazindaki bilek yer hizi medyani (bake_loco.py).
7. Tuzaklar: Blender kaydederken kullanilmayan action'lari atar (`use_fake_user`); zsh'de degisken kelimelere bolunmez (dizi/joker
   kullan); CMU temas karesi = en yuksek ayak hizinin ~2 kare SONRASI; mocap koku kaldirinca basan ayak kayar (kisa sureli kabul).
Dogrulama araclari `viewer/scripts/`: `kick-seq.mjs` (tek karakter, kare kare profil: `scripts/run-browser.sh node
scripts/kick-seq.mjs /tmp/xx <varyant> <at-listesi>`; sayfa `characters/test/index.html?t=pose&anims=<ad>&at=<s>&face=1.5708&
cam=front&dist=3.4&h=1.0&ly=0.85&fx=4&clips=1`), `clip-run-shots.mjs` (kosu, `?t=loco&v=<hiz>&anims=<ad>&ball=0|1`),
`clip-kick-check.mjs` / `clip-match-check.mjs` (gercek mac sayfasinda sayac), `shot.mjs`. TUM tarayici testleri
`scripts/run-browser.sh node ...` uzerinden (2 yuvali kilit, nice 19). Birim testler: `npx -y tsx scripts/rules-test.mjs` (176/0 kalmali).
`window.__layers[ad] = {loaded, frames}` katman durumu; ekranda sol altta rozet (localhost / `?dbg=1`).

## Sunucu ve ortam
- Dev sunucusu `127.0.0.1:5173` CANLI (HMR) ve herkesin ortak agaci; ONU DURDURMA/YENIDEN BASLATMA, baska port acma.
  `public/*.json` degisince sayfayi yeniden yukle. Onizleme sunuculari 5188/5189 `dist/`'i sunar; `npm run build` SADECE sorulursa.
- Baska ajanlar ayni agacta paralel calisiyor: `npx tsc -b` her degisiklikten sonra temiz kalmali; baska dosyadaki gecici hata
  gorursen 1-2 dk bekle, sonra tekrar dene, o dosyaya DOKUNMA.
- Her ajanin kendi dosyalari (cakisma olmasin): bake betikleri `anim_src/bake_<senin_adin>*.py`, JSON'lar
  `viewer/public/anim_<senin_adin>*.json`, katman `src/anim/layers/<senin_adin>.ts` (+ gerekirse `layers/<senin_adin>_*.ts`).
  Kendi test betiklerin `viewer/scripts/<senin_adin>-*.mjs`. Baska ajanin dosyasini, `layers/index.ts`'i, `types.ts`'i, `Characters.tsx`'i
  DEGISTIRME (gerek varsa son raporunda iste).

## Mutlak kurallar
- COMMIT/PUSH/YAYIN YOK (git add/commit/push, tools/publish-pages.sh yasak). Degisiklikler yerelde kalir. Commit mesajina
  Co-Authored-By/Claude-Session EKLEME (zaten commit yok).
- Hesap/giris gerektiren indirme YOK; kimlik bilgisi isteme. Yalnizca lisansi yeniden dagitima izin veren (CC0, "ticari kullanim serbest"
  + oyuna gomulu dagitim) kaynak. LISANS METNINI OKU ve raporla; belirsizse KULLANMA. Ham kaynak dosyalari (FBX/BVH/GLB) `anim_src/`
  disina ve git'e GIRMEZ; oyuna yalnizca pisirilmis JSON gider. CMU icin `CREDITS` satiri gerekir (rapora yaz: kullanilan klipler).
- Dogrulama zorunlu: (a) `npx tsc -b` temiz, (b) `rules-test` 176/0, (c) kendi aksiyonunu GERCEK mac sayfasinda tetikleyip katman
  sayacini oku, (d) goruntu dizisi (kare kare) incele VE gozle degerlendir, (e) sayisal olcum (ayak kaymasi cm, zemin penetrasyonu,
  temas zamani hatasi ms). Goruntuleri `/tmp/asci/<ajan>/` altina koy, yollarini raporla.
- **Durust ol.** Ege uydurma sonuc istemiyor. Calismayani, dogrulayamadigini, ayarlayamadigini acikca yaz. "Gercekci" kelimesini
  yalniz kanitla kullan. Bulamadigin kaynagi uydurma. Belirsizligi raporla.
- Sinirlar (Ege'nin kurali): gercek kisit yalniz donanim ve olcek; baska "eksiklik/kisit" icat etme.
- Parametrik sisteme geri donus HER ZAMAN calismali: klip yoksa/yuklenmezse/`?clips=0` ise eski davranis aynen kalir.
- Performans: kare basina tahsis (new) azalt; 8+1 karakter 60 fps hedefi.

## Rapor bicimi (son mesajin)
1. Ne yaptin (dosyalar). 2. Dogrulama kaniti (komut, sayi, goruntu yollari). 3. Bilinen kusurlar / yapamadiklarin.
4. Baskasindan istedigin degisiklik. 5. CREDITS/lisans listesi. Kisa ve olgusal.
