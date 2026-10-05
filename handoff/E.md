# E-insan → E2-insan devir notu (Blender model hattı)

Sahiplik: `footballer/human/*`, `viewer/public/futbolcu.glb`, `viewer/public/futbolcu_lod1.glb`, `viewer/public/kits/*`. `src/` altına dokunma.

## Mevcut teslim (2026-10-05)
| Dosya | Boyut | Üçgen | İçerik |
|---|---|---|---|
| `public/futbolcu.glb` | 4.6 MB | 26.6k | 5 skinned mesh = 5 draw call |
| `public/futbolcu_lod1.glb` | 2.1 MB | 9.0k | aynı yapı, 1k dokular |

Mesh / malzeme:
- `Govde` / `Govde`: deri + göz, 2k atlas, backface cull. Forma altı dahil kapalı gövde.
- `Kiyafet` / `Kiyafet`: tozluk + krampon + çivi.
- `Forma` / `Kiyafet_Forma`: bol, kumaşa uygun ağ, 1892 köşe. COLOR_0.R = pin.
- `Sort` / `Kiyafet_Sort`: 594 köşe. COLOR_0.R = pin.
- `Sac` / `Sac`: saç + kaş + kirpik, alpha MASK 0.3, 1k.

Kiyafet, Forma ve Sort aynı kit atlasını kullanır, kit_layout.json'daki düzenle.

İskelet ve yön:
- MPFB "game_engine" iskeleti, 53 kemik, kök düğüm "Futbolcu". Kemikler: pelvis, spine_01-03, neck_01, head, clavicle/upperarm/lowerarm/hand_{l,r}, parmaklar (thumb, index, middle, ring, pinky _01-03), thigh/calf/foot/ball_{l,r}.
- Rest pose T/A değil, doğal duruş: kollar ~16° açık, avuçlar uyluğa dönük. Kumaş bu pozda pişirildi.
- İleri yön +Z, Y yukarı, metre, boy 1.80 m (+1.2 cm çivi). Animasyon klibi yok.

Kit varyantları: `public/kits/{home,away,gk_home,gk_away,ref}.png` (2048², Kiyafet UV0).
- Sırt numarası dokuda yok. Numara alanı ayrı UV adasında. glTF UV'sinde (u0,v0,u1,v1) = (0.700, 0.605, 0.890, 0.795).
- Bu alan sırtta 0.26 m karedir (rest z 1.115–1.375). I-anim gölgelendiricide basıyor.

Pin ağırlıkları (N-kumas için, COLOR_0.R, float, sRGB dönüşümü yok):
- Forma: yaka/omuz üstü 1; göğüs/sırt 0.65→1; bele doğru 0.3; etek son 7 cm → 0. Kol: omuz 0.7 → kol ağzı 0.
- Sort: bel 1, kalça ~0.6, paça 0.1.
- Hesap `s6_web.py` içinde `pins_forma` / `pins_sort`; d_* öznitelikleri s2'den gelir.

## Hat (`human/run_all.sh`; `./run_all.sh 1` insanı da sıfırdan üretir)
1. `s1_human.py`: MPFB ile insan üretilir (makrolar, boy 1.80) ve game_engine rig'i takılır. Göz, kaş, kirpik, diş, dil, saç short02 ve ayakkabı shoes05 eklenir, el/duruş pozu verilir → `stage1.blend`. `--factory-startup` ile çalışır.
2. `s2_shells.py`: poz rest'e uygulanır, yardımcı geometri silinir. Gövdeden Forma/Sort/Tozluk kabukları kesilir (düzlem kesimi, yumuşat ve dışa it, `jersey_off` açıklıkları), UV ve kenar mesafeleri (`d_*`) çıkarılır → `stage2.blend`.
3. `s3_cloth.py`: rest/rnorm/part öznitelikleri yazılır, şort ve forma kumaş simülasyonundan geçirilir. Etek şortun 1.3 cm dışına itilir → `stage3.blend`.
4. `s4a_bake.py`: desen girdileri `bake/*.npz`'ye pişirilir. `tex_make.py` (sistem python'u) deri, saç, krampon, forma dokularını üretir.
5. `s4b_finish.py -- noexport`: çiviler, PBR malzemeler ve skin temizliği → `stage4.blend`.
6. `NUMARASIZ=1 tex_make.py maske` ve `kit_make.py`: maskeler (R birincil, G ikincil, B beyaz, A AO) ve kit atlasları üretilir (`kit_layout.json`).
7. `s6_web.py`: atlaslar, göz korneası silme, seyreltme, ağırlık düzeltmeleri (kasık→pelvis, yumuşatma, sol/sağ ayrımı), pin ve saç inceltme yapılır. LOD0 ve LOD1 GLB'leri yazılır, `stage6.blend` kaydedilir.
8. `check_rig.py`: denetimler aşağıda.

Eski adımlar: `s5_optimize.py` artık kullanılmıyor.

Yardımcılar:
- `render.py`: Cycles önizleme. Kullanım: `blender -b X.blend -P render.py -- <önek> <örnek> <on,yan,arka,uc_ceyrek,yuz,goz,el,govde> <px>`.
- `glb_check.py`: GLB'yi geri yükler, kemik ve skin sayar.
- `shot_url.mjs`: URL ekran görüntüsü. Kullanım: `scripts/run-browser.sh node ../human/shot_url.mjs <url> <png> <ms>`.

## check_rig.py (her değişiklikten sonra koş)
Denetler:
- Ağırlık toplamı 1 ve bağsız tepe yok.
- Hiçbir tepe iki bacak kemiğine birden bağlı değil.
- Uyluk/diz derisi bantları eksiksiz.
- Kapalı gövde: yalnız göz ve ayak bileği halkaları izinli.
- 3 aşırı pozda (geniş koşu, kayarak müdahale, kaleci uçuşu) 3 kattan fazla ve 5 cm'den uzun gerilen kenar sayısı.

Bilinen kalan uyarılar: Forma koltuk altında ≤10 cm gerilme; kaleci pozunda Govde koltuk altında 2 kenar. Render'larda görünmüyor.

## Tuzaklar
- **Yük:** Tüm Blender işleri `nice -n 19`; render ≤64 örnek, küçük çözünürlük. Tarayıcı yalnız `scripts/run-browser.sh` ile.
- **Cycles:** OpenImageDenoiser yok, `use_denoising=False` olmadan bake sessizce boş çıkar.
- **GUI soketi:** Blender GUI'deki MCP soketi (127.0.0.1:9876, `tools/bl.py`) uzun işte bloklar. Ağır işler başsız (`blender -b`) yapılmalı.
- **MPFB:** Eklenti 2.0-b1, `~/.config/blender/4.0/scripts/addons/mpfb`. Varlıklar `~/.config/blender/4.0/mpfb/data` altında, CC0. Etkinleştirme `addon_utils.enable("mpfb", default_set=True)`.
- **Blender API:**
  - `me.attributes.new` önceki öznitelik referanslarını geçersiz kılar; önce hepsini ekle, sonra adla al.
  - `o.data.attributes.active = None` Blender'ı çökertir.
  - `vertex_group_smooth` operatörü nesne kipinde çalışmaz; bunun yerine `s6_web.smooth_weights`.
- **Geometri:**
  - Solidify `use_even_offset` sivri uç üretiyor; kalınlık kapalı, malzeme iki taraflı.
  - Vertex-group korumalı Decimate bacakları çökertti; düz oran kullan.
  - Kumaş patlaması kısa ya da çakışık kenarlardan çıkar; s2 kaynaklıyor (remove_doubles). Forma ile şort arasında çarpışma sim'i yok, statik itme var.
- **Doku:** Gözde saydam kornea katmanı opak atlası örtüyordu; s6 siliyor. Göz dokusu `brownlight_eye.png`.
- **Dosya:** `dl/` (~370 MB zip) SİLME. Önceki sürüm yedeği `human/yedek_v2/`.

## Açık sorunlar / gerekirse yapılacaklar
- Saç hâlâ hafif kask görünümlü. MakeHuman kart saçının sınırı; kullanıcı bu tur kabul etti. Daha iyisi için ayrı saç modeli ya da kart saçının yeniden üretimi gerekir.
- I-anim'in kit dokusu ve numara gölgelendiricisi yeni `Kiyafet_Forma` / `Kiyafet_Sort` malzemelerine de uygulanmalı. E-7.png'de düz renkti; I2'ye hatırlatılabilir.
- N2-kumas ileride daha yüksek ya da düşük çözünürlüklü forma isterse `s2_shells.py` içinde `subdiv` ve `jersey_off` ayarları değiştirilir. Sonra run_all çalıştırılır: s2'den itibaren tüm adımlar, ~10 dk.
- Yeni kit rengi eklemek için `kit_make.py` içindeki `PALETTES`'e ekleyip yalnız `python3 kit_make.py` çalıştırmak yeterli (GLB değişmez).

## E2-insan güncellemesi (2026-10-05)
- Saç alfa kenarı: s6_web.py'de saç atlası alfası yeniden yazıldı (iç bölge tam opak, yalnız kenarda ince tel dokusu, yumuşak kontrastlı geçiş). Eski gürültülü alfa MASK testinde testere dişi veriyordu. Tarayıcı tarafında Sac malzemesinde `alphaToCoverage=true` (MSAA açıksa) kenarı ayrıca yumuşatır; bu I2'nin işi.
- Varyantlar: `public/futbolcu_v2.glb` (koyu ten, kısa taranmış siyah saç short04, daha iri yapı) ve `public/futbolcu_v3.glb` (açık ten, kumral saç short02 kısa kesim, daha ince yapı), her ikisinin `_lod1` karşılığı var. Aynı 53 kemik, aynı UV düzeni, aynı malzeme adları; kit atlasları (`kits/*.png`) hepsinde ortak. Üçgen: v2 25.2k, v3 26.6k.
- Üretim: `human/run_variant.sh <ad>` ortam değişkenleriyle (HAIR, BROW, V_MUSCLE, V_WEIGHT, V_AGE, V_RACE, V_TGT, SKIN_MUL, HAIR_MUL, HAIR_CLOSE); ana modele dokunmaz, wip/var_<ad>/ içinde çalışır (~4 dk). Girdi örnekleri `wip/e2/tgts.sh`. short03 ve short01 denendi, kötü (short03 gözü kapatan kask, short01 dağınık kart parçaları); short04 ve short02 kullanılabilir.
- Yüz farkı MPFB hedefleriyle ve yarış karışımıyla sınırlı kaldı (ince). Daha belirgin yüz için V_TGT'ye ek hedef ver.
- Bilinen: saç çizgisinde Cycles'ta çok ince koyu çizgi, tarayıcıda test edilmedi.

## E2-insan saç kartları (2026-10-05, ikinci tur)
- Saç kabuğu (kask) kaldırıldı; yerine `human/hair_cards.py` ile prosedürel saç: ~780 ince şerit kart (2 segment, rastgele yön, yuvarlanma ve katman yüksekliği), kafa derisine yakın seyreltilmiş opak taban (yalnız tepe ve arka) ve tel dokulu 4 sütunlu atlas (kök opak değil, uçlar tel tel erir). Sac mesh'i ~3.9k üçgen (kaşlar ve kirpikler dahil), LOD1 ~1.6k.
- `s6_web.py` ortam değişkenleri: HAIR_CARDS=1 (kapatmak için 0), HAIR_STYLE=fringe|back, HAIR_MUL, HAIR_CLOSE. Kart sayısı `card_mesh(780, 2, ...)` çağrısında.
- Kartlar yalnız "head" kemiğine 1.0 ağırlıklı (check_rig Sac satırları TAMAM). Eski hat bu grubu hiç oluşturmuyordu, kart eklenirken zorunlu hâle geldi.
- Malzeme: Sac MASK 0.3, çift taraflı değil. Tarayıcıda alphaToCoverage=true ve mipmap açık olmalı (I2).
- Bilinen: kulak çevresinde ve ense kenarında deri küçük aralıklardan görünüyor; saç çizgisi hafif sivri.

## E2-insan son durum (2026-10-05, üçüncü tur)
- Saç: kart saç + dolu alfa yatağı + kafa derisi boyama (paint_scalp) + taban için atlas köşesinde opak blok. Şeffaf texel RGB'si koyu (ölçüldü), beyaz sızıntı yok.
- Kit atlasları: `kits/*.png` ana model içindir. Varyantların UV adaları kendi gövdelerinden çıktığı için v2 ve v3 `kits/v2/*.png` ve `kits/v3/*.png` kullanmak ZORUNDA (ana atlasla forma/şortta yırtık gibi lekeler çıkar; Blender'da `wip/e2/swap_cmp.png` ile kanıtlandı). Yeni varyant üretirken run_variant.sh kit PNG'lerini `wip/var_<ad>/kits/` altına yazar.
- Kumaş dokuması kit_make.py'de (`weave()`), ref (hakem) paleti açıldı.
- Forma eteği: s6_web.py sonunda HEM_GAP ile şort üstüne yaklaştırılıyor (hem ucu şortun ~7 mm üstü).
- Forma/şort maskelerini yeniden üretmek gerekmedi: ana modelde yırtık yok, sorun varyant atlas uyuşmazlığıydı.

## E2-insan son durum (2026-10-05, dördüncü tur)
- Varyantlar: ana (futbolcu.glb), v2 (koyu ten, geriye taranmış saç, hakem), v3 (açık ten, kısa saç), v4 (kıvırcık kaleci); hepsinin `_lod1`'i var. Üretim: `human/run_variant.sh <ad>` + ortam değişkenleri (HAIR, HAIR_STYLE=fringe|back|curly, HAIR_CLOSE, HAIR_N, HAIR_SEG, V_*, SKIN_MUL, HAIR_MUL). Örnek ayarlar bu notun yukarısında ve `wip/e2/tgts.sh`.
- Kit atlasları: ana model `kits/*.png` (2048², paletli); varyantlar `kits/v2|v3|v4/` (home/away 1024², ref/gk_* 2048², yalnız kullanılan çiftler). Varyant UV'leri farklı olduğundan ana atlasla kullanılamaz. kits/ toplamı 15.7 MB; dokuma genliği düşük, geri açma.
- Saç: `hair_cards.py` kartları (tepe odaklı ilk 1/9, opak taban, atlas köşesinde opak blok), `paint_scalp` ile deri boyama. Balık sırtı deseni atlas değil, test sahnesinin gölge acne'siydi.
- Şort: pin değişti (bel 1, 8 cm altı 0.1, ön üst kalça 0.2), paça uyluğa bağlı (`SORT_STICK`), küçük delikler kapanıyor; hakem şort yarığı N2'nin uyluk kapsül yarıçapıyla kapandı. Forma eteği şorta yaklaştırıldı ve halka yumuşatıldı.
- Test araçları: `human/render.py` (ense, ense_yan, kalca, kalca_yan, tepe), `wip/e2/short_test.py`, `wip/e2/bnd.py` (açık kenar taraması), test sahnesi ve `scripts/.i-gseq.mjs`.
