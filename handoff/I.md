# I-anim → I2-anim devir notu (2026-10-05)

## Durum
`src/anim/*` ve `src/characters/*` canlıda, `npx tsc -b` temiz (anim/ ve characters/ için). Ara durumda yarım düzenleme yok.
Gerçek GPU'da maç sahnesi 60 fps (gseq ölçümü; başka ajan GPU kullanırken 23 fps'e düştüğü görüldü).

## Mimari (ne nerede)
- `anim/pose.ts`: parametrik poz (düz sayılar). Karakter uzayı: +z ileri, +y yukarı, **+x karakterin SOLU**. Pelvis (hx,hy,hz,hp,hyaw,hr), omurga (sp,syaw,sr), baş (np,nyaw), 2 bacak (IK hedefi x,y,z + FK flex/abd/twist/knee, pitch, yaw, toe), 2 kol (FK flex/abd/elbow/twist/shrug + IK tx,ty,tz). Karışım = lineer: `lerpPose` (tam), `lerpUpper` (yalnız gövde üstü), `lerpBody` (bacak IK hedefleri lokomosyondan, gerisi klipten). `mirrorPose` sol↔sağ. Anahtar kare kısaltmaları: `L.` `R.` `B.` (iki bacak; `B.x` aynalanır), `LA.` `RA.` `BA.`.
- `anim/rig.ts` `RigDriver`: rig'den bağımsız çözücü. Dinlenme pozunu yükleme anında ölçer; her kemiği "birincil yön + bükülme düzlemi normali" ile hedefe çevirir. Bacak ve kol 2 kemik IK, ayak IK'da zemine düz. Parmaklar bir kez gevşek yumruğa bükülür. Kare başına tahsis yok.
- `anim/gait.ts`: lokomosyon. Basma fazında ayak gövde hızının tersiyle kayar, yani kayma yok (ölçüm 0–2 cm). Salınım yolu referans eklem eğrilerinden: Winter yürüme, Novacheck koşu/sprint. Hıza göre adım frekansı, pelvis sekmesi, karşı dönüş, eğilme, dönüşte merkezcil yatma, `shuffle` (jokeyde çapraz adım yok), `dribble` duruşu.
- `anim/actions.ts`: tüm klipler (`clips()` + `clips2()`), `-l` klipleri otomatik aynalanıp `-r` üretilir. Klip bayrakları: `mode` ('upper' | 'body'), `hold`, `loop`, `hands` (kaleci el IK'sı), `fadeIn`.
- `anim/animator.ts`: karakter başına durum. Geçişler, `animT` geri sarılınca yeniden başlatma, 'getup' çözümü (dalıştan sonra `getup-side-l/r`, kaymadan sonra `getup-sit`, düşmeden sonra `getup`), top dokunuşu (`footToBall`: salınımın son %35'inde ayak topa yönelir), kaleci el IK'sı (`ballHands`, top yaklaşık 2,2 m menzilde), `contactIn(leg)`.
- `anim/events.ts`: `footTiming[id].l/.r` = salınım sonuna kalan süre; F dokunuşu buna göre zamanlamalı (F'ye yazıldı, uyguladığı doğrulanmadı).
- `anim/timing.ts`: `CLIP_LEN` temas anları; F bunları okuyor.
- `characters/Characters.tsx`: 8 oyuncu + hakem, `useFrame` önceliği 0. Konum ve yönelim yumuşatılıyor. Hız ve ivme render konumundan türetiliyor (kayma olmasın diye). Omuz itişinde rakibin yanı kendim seçiliyor. LOD1 (`futbolcu_lod1.glb`) LOD0 iskeletine bağlanıyor, 21/19 m histerezisle geçiyor. Kontrol halkası ve top sahibi işareti, hakem kartı, kumaş kancası (N2), `footTiming` yazımı. Atılan oyuncu gizlenmiyor: K'nin yürüttüğü konuma 'sent-off' klibiyle yürüyor. Ten ve saç ton varyantları var (`SKIN_TONES`, `HAIR_TONES`).
- `characters/kit.ts`: E'nin `public/kits/*.png` atlasları, oyuncu başına malzeme (program ortak). Sırt numarası gölgelendiricide UV dikdörtgeni (0.700, 0.605, 0.890, 0.795) içine basılıyor. **`vertexColors=false` ZORUNLU** (Forma/Sort'taki COLOR_0 kumaş pin ağırlığı; açık kalırsa formalar düz kırmızı/siyah çıkar). Kaleci eldiveni: Govde'ye `aGlove` niteliği (el/parmak kemik ağırlığı) ile gölgelendiricide boyanıyor. Malzeme adı eşlemesi: /kiyafet/ → atlas, /govde/ → ten ve eldiven, /^sac/ → saç tonu.
- `characters/mannequin.ts`: GLB rigsiz ya da yüklenemezse yedek (aynı kemik adları). `?char=manken` ile zorla açılır.
- `characters/test/index.html`: ana uygulamadan bağımsız test sahnesi. Örnekler: `?t=loco&anims=run&v=5&dist=6` (koşu), `?t=pose&anims=kick,tackle&at=0.2,0.3&cam=front&face=1.5708` (pozlar donmuş). `window.__chars.chars[i].anim.setPhase(p)` ve `world.timeScale=0` ile faz dondurulur.

## Klipler
- **Oyuncu:** kick, pass, tackle (temas 0,22), slide (yerde kalır), fall, getup, getup-side, getup-sit, celebrate, throwin, header.
- **Top kontrolü ve dönüş:** trap-foot/thigh/chest, drag-back, cut-l/r, sole-stop.
- **Mücadele:** jockey, shield, shoulder-l/r, stumble, sent-off.
- **Kaleci:** keeper-ready, keeper-shuffle-l/r, keeper-dive(-low/-high)-l/r, keeper-catch(-high), keeper-collect, keeper-punch, keeper-hold, keeper-throw, keeper-kick, keeper-spread.
- **Hakem:** whistle, point, card-yellow/red, advantage, indirect, var-listen, var-monitor, var-signal.

## Açık işler (öncelik sırasıyla)
1. **Sürme, dönüş, jokey, müdahale (kullanıcı: "çok kötü"):** F2 mekaniği yeniden kuruyor. Klipler hazır ama F2'nin bunları yazdığı ve dokunuşu `footTiming`'e göre zamanladığı DOĞRULANMADI. team-lead'den types.ts'e 'drag-back','cut-l','cut-r','jockey','sole-stop' eklemesini istedim; durumu kontrol et. Sonra gerçek GPU'da 100 ms arayla kare dizisi al: dokunuş anında ayak topa değiyor mu, gövde topun üstünde mi. Gerekirse `footToBall`'daki 0,14 m ve %35 değerlerini, `jockey`/`tackle`/`slide` anahtar karelerini ayarla.
2. **Kaleci el IK'sı ve LOD1 geçişi gerçek maçta DOĞRULANMADI.** Arka planda koşan çekim: `shots/I-31-*.png`; çıktı dosyası `/tmp/claude-1000/-home-ege-Blender-MCP/d4aa7604-52b1-4a9f-9df8-92a5ec2eed15/tasks/bccz5fokq.output` (probe: anim, animT, hasBall, handW). Önceki denemede (I-30) yakalama kare dizisi başlamadan bitmişti. Dikkat: `handW` 0 görüldü; F2 holdBall'da topu (önde 0,3 m, y=1,0) tutuyor, ama `ballHands`'teki menzil formülü yatık gövdede kaba. LOD: uzak kamerada geçiş anında atlama ve kayma kontrol edilmedi.
3. **Omuz itişi:** pozu güçlendirdim (yana ağırlık aktarımı, yaslanma); canlı maçta görülmedi.
4. **QA (O2) bulguları:** yakın çekimde uyluk şorttan çıkıyor; hakem şortu etek gibi. Muhtemelen N2'nin kumaşı ya da E2'nin ağırlıkları; bende değilse onlara yönlendir. Yüz aynı (klon): şimdilik yalnız ten ve saç tonu var, morf yok.
5. **Sırt numarası:** 26 cm'lik kutunun iç ~%80'inde kalmalı (E'nin uyarısı). Şu an tüm kutu kullanılıyor; kenarda kesik görünürse `numberAtlas`'ta yazı tipini küçült.

## Tuzaklar
- **+x = karakterin SOLU.** Dünyada sol = (cos f, -sin f), f = facing. F'nin dalış işareti bu yüzden tersti, düzeltildi.
- **Kodu canlıya atomik al:** `scratchpad/stage.sh` deseni: `src`'yi kopyala, kopyada `tsc -p` ile doğrula, dosya başına `cp tmp && mv`. Bağımlılık sırasıyla it (export eden önce). Bir kez çok adımlı düzenleme canlıyı kırdı (`clips2 is not defined`).
- **`animT`:** F her aksiyonda sıfırlıyor. 0 kalırsa kendi sayaç kullanılıyor; geri sarılınca klip yeniden başlıyor.
- **Kit dokusu:** yüklenene kadar GLB'nin gömülü dokusu kalır (`KitMaterials.kitTexture` bekleme listesi).
- **Kemikler:** E2 GLB'yi sık yeniliyor; kemik adları sabit, mesh ve malzeme adları değişebilir. Ad eşlemesi regex'le yapılıyor.
- **SwiftShader** ~1 fps: oyun akışı ilerlemez. Hareket testi için gerçek GPU şart.

## Test komutları
- tsc: `cd viewer && npx tsc -b 2>&1 | grep -E "anim/|characters/"`
- Gerçek GPU kare dizisi: `scratchpad/gseq.mjs` (sistem Chrome, `--use-angle=gl`). Kopyası yoksa `shots/gshotC.mjs` deseni.
  - Kullanım: `scripts/run-browser.sh node gseq.mjs shots/X --q "mode=mac&watch=1" --wait 12000 --eval "<js>" --frames 10 --gap 100 --probe "<js>"`
  - Takip kamerası: `ctl.cam='serbest'` (`/src/control/store.ts`) + her rAF'te `window.__lookAt(p, t)`; `window.__followMode = id`.
- SwiftShader poz testi: `scripts/run-browser.sh node scripts/shot.mjs` (test sahnesi için `--path src/characters/test/index.html` gereken bir sürüm: scratchpad'deki `shotI.mjs`).
- Firefox: `scripts/run-browser.sh node scripts/diag-ff.mjs`
- Ayak kayması ölçümü: test sahnesinde `foot_l` dünya konumu, her basma bölümünde ilk örnekten en büyük sapma (scratchpad `slip.js`; 2 cm altı iyi).

Scratchpad: `/tmp/claude-1000/-home-ege-Blender-MCP/d4aa7604-52b1-4a9f-9df8-92a5ec2eed15/scratchpad` (`stage.sh`, `gseq.mjs`, `follow.js`, `waitkeeper.js`, `slip.js`, `shotI.mjs`). Geçici olabilir; gerekenleri `viewer/scripts/`e taşımak için koordinatörden izin al.
