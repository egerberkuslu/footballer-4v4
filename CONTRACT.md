# Paralel ajan sözleşmesi — 4'e 4 gerçekçi saha

Amaç: **fotogerçekçilik**. Kullanıcı (Ege) işi görüntüyle yargılar; primitif/low-poly görünüm kabul edilmez.
Uygulama: `viewer/` (Vite + React 19 + TypeScript + @react-three/fiber 9 + drei 10 + three 0.186).
Dev sunucusu ZATEN çalışıyor: http://127.0.0.1:5173 — ikinci sunucu başlatma.

## Dosya sahipliği (yalnız kendi dosyalarını düzenle)

| Ajan | Sahip olduğu dosyalar |
|---|---|
| A — çim/zemin | `src/PitchGrass.tsx`, `src/pitch.ts` içindeki `paintPitch` (sabitler HARİÇ), yeni `src/grass/*`, `public/textures/grass/*` |
| B — fizik | `src/sim.ts`, yeni `src/sim/*`, `scripts/sim-*.mjs` |
| C — ağ/top/kale görseli | `src/Goal.tsx`, `src/Ball.tsx`, yeni `src/goal/*`, `public/textures/ball/*` |
| D — ortam/ışık/kamera/oyuncu yerleşimi | `src/App.tsx`, `src/CameraRig.tsx`, `src/Hud.tsx`, `src/Player.tsx`, `src/ModelBoundary.tsx`, `src/index.css`, yeni `src/env/*`, `public/env/*` |
| E — gerçekçi insan (Blender) | `footballer/human/*`, çıktı `viewer/public/futbolcu.glb`; `src/` altına dokunmaz |

Başkasının dosyasında değişiklik gerekiyorsa yapma, raporunda "X ajanından istek" olarak yaz.

## Ortak sabitler — `src/pitch.ts` (DEĞİŞTİRME)
PITCH_L=40, PITCH_W=25 (4'e 4 saha), PLATE_L=48, PLATE_W=33 (zemin plakası), GOAL_W=5, GOAL_H=2,
NET_D_BOTTOM=1.5, NET_D_TOP=0.8, POST_R=0.05, BALL_R=0.11, SPOT_DIST=7. Eksenler: x = boy, z = en, y = yukarı, zemin y=0.
Kale ağzı x = ±PITCH_L/2 çizgisinde, ağ dışarı (|x| artan) doğru uzanır. `goalPoint(side,d,y,w)` = [side*(PITCH_L/2+d), y, w].

## `world` arayüzü (`src/sim.ts`, B'nin sorumluluğu; imzalar korunur)
```ts
export const world: World
world.side: 1 | -1          // hangi kaleye şut
world.timeScale: number     // 1 normal, 0.2 yavaş çekim
world.goals, world.shots: number
world.subscribe(fn): () => void
world.resetBall(); world.shoot(); world.step(frameDt)
world.ball: { x,y,z, vx,vy,vz, q:{x,y,z,w} /* yönelim, B ekler */, wx,wy,wz /* açısal hız, B ekler */ }
world.pos: Float32Array      // ağ düğüm konumları, xyz; KİMLİĞİ SABİT (yeniden ayırma yok)
world.renderEdges: Uint32Array // çizilecek ip parçaları, pos indeks çiftleri
world.capsules: {a,b,r}[]    // direk/üst direk çarpışma kapsülleri
```
B yeni alan eklerse (ör. düğüm normalleri, ip kalınlığı) burada belgeleyip raporunda bildirir; C onu kullanabilir.
C, `ball.q` varsa dönüşü oradan alır; yoksa yuvarlanmadan tahmin eder.

## Kurallar
- `npm install` YAPMA (paket dosyası çakışır). Kurulu: three, @react-three/fiber, drei, @react-three/postprocessing, postprocessing, playwright. Gerekirse raporda iste.
- git komutu çalıştırma (ev dizini bir git deposu, karışır).
- Doğrulama: `cd viewer && npx tsc -b` (kendi dosyaların temiz olmalı) +
  `node scripts/shot.mjs shots/<ajan>-<n>.png --q "blades=40000" [--eval "<js>"] [--wait 4000]`
  Her ajan kendi başsız Chromium'unu açar (SwiftShader, yavaş ama doğru). Playwright MCP'nin paylaşılan sekmesini KULLANMA.
  Görüntüye MUTLAKA bak (Read ile PNG), kusurları düzelt, en az 2 tur.
- Sayfa düğmeleri: `.hud button` (Şut, Topu sıfırla, Kale değiştir, Yavaş çekim, kamera adları). `--eval` ile tıklanabilir.
- GPU tek (RTX 3060 12 GB). Flux: `mcp__figure-maker__flux_tile` / `flux_sprite` (figure-maker MCP) veya ComfyUI (~/Desktop/video-gen). Aynı anda başka ajan da kullanıyor olabilir; OOM olursa bekleyip tekrar dene.
- Performans hedefi: RTX 3060'ta 1080p ~60 fps. `?blades=N` gibi kalite parametreleri bassız test için düşürülebilir olsun.
- Kod yorumları Türkçe, kısa; arayüz metinleri Türkçe.
- Bitince kısa rapor: ne yaptın, hangi dosyalar, ekran görüntüsü yolları, açık kalan sorunlar, diğer ajanlardan istekler.

---

# Oynanış mimarisi (4'e 4 maç) — ORTAK SÖZLEŞME

Hedef: gerçekten oynanabilir maç. Her takımda 4 oyuncu var: 1 kaleci ve 3 saha oyuncusu. Kullanıcı ev takımının (0) bir oyuncusunu kontrol eder, diğerlerini yapay zekâ oynar. Top sürme ve karakter animasyonları, hakem, faul, kart ve duran toplar olacak.
Ortak tipler: `viewer/src/game/types.ts`. Oyun durumu: `viewer/src/game/store.ts` (`game` tekil nesnesi). Bu iki dosyayı yalnız koordinatör değiştirir; ihtiyacını team-lead'e yaz.

## Kare sırası (`useFrame` öncelikleri; POZİTİF öncelik YASAK, efekt zincirini bozar)
| Öncelik | Sahip | İş |
|---|---|---|
| -30 | F | İnsan girdisini oku → `game.inputs[kontrol edilen id]` |
| -25 | J | Yapay zekâ → kalan oyuncuların `game.inputs[id]`'i |
| -20 | K | Kurallar (ön): oyun 'play' değilse duran top dizilişi; girdileri ezebilir ya da oyuncuları yerleştirebilir |
| -15 | F | Hareket + top aksiyonları: girdileri uygular (hız, dönüş, stamina), top sürme dokunuşları ve şut/pas `world.kick` ile; `touch`/`contact` olaylarını yayar; oyuncu kapsüllerini `world.setDynamicColliders`'a yazar |
| -1 | (mevcut Sim) | `world.step(dt)` |
| -0.5 | K | Kurallar (son): gol/out (`world.onEvent`), faul kararı (`contact` olayları), saat, hakem hareketi, kart, duran top kurulumu |
| 0 | I | Karakter render + animasyon: `game.players` ve `game.referee` durumundan okur |

Oyun zamanı: `gdt = dt * world.timeScale`. Yavaş çekimde ve VAR'da (timeScale=0) herkes durur.

## Yazma yetkileri
- F (`src/control/*`): insan girdisi, hareket ve top aksiyonları (`control/locomotion.ts` → AI de AYNI `PlayerInput`'u üretir, ayrı fizik yazmaz), oyuncu `x,z,vx,vz,facing,anim,animT,actionLock,hasBall,stamina`, kamera, HUD, App.tsx.
- J (`src/ai/*`): yalnız `game.inputs[id]` (insan kontrolündekiler hariç).
- K (`src/rules/*`, `src/referee/*` mantığı): `game.match`, `game.referee`, `players[].yellow/sentOff`; duran toplarda oyuncu ve top yerleştirme (`world.placeBall`). Düdük ve ses (WebAudio sentezi) K'da.
- I (`src/anim/*`, `src/characters/*`): render. Oyuncu ve hakem karakterleri, forma renkleri, numaralar, animasyon karışımı. Mantık yazmaz; animasyon olaylarını (ör. vuruş anı) gerekirse okunur bir alanla bildirir.
- B (`src/sim*`): top, ağ ve çarpışma fiziği; `kick`, `placeBall`, `onEvent`, `setDynamicColliders`, `predictTrajectory`.
- G (`src/var/*`): VAR. Karar sonuçlarını `game.emit` ile bildirir, K bunları uygular.

## Oyuncu modeli
E ajanı rigli gerçekçi GLB üretiyor: `public/futbolcu.glb`. I bunu 8 oyuncu ve 1 hakem için klonlar (`SkeletonUtils.clone`), forma rengi ve numarayı malzemeyle değiştirir. Animasyon klipleri GLB içinde ya da ayrı `public/anim/*.glb` olarak gelir; gelene kadar I prosedürel (IK ile) bir yedek kullanır.

## B'nin world arayüzü (güncel)
- `world.ball`: x,y,z, px,py,pz (önceki), vx,vy,vz, wx,wy,wz (rad/s), q {x,y,z,w} (yönelim).
- `world.kick(v, w)`, `world.placeBall(x, z)`, `world.onEvent(fn) → () => void`; olaylar 'gol' | 'direk' | 'ust-direk' | 'ag' | 'aut' | 'durdu', şut başına en fazla bir kez.
- `world.shoot(kind?)`: 'yerden' | 'vole' | 'falso' | 'asirtma' | 'direk'. `world.lastShot`, `world.netContact`, `world.seed(n)`, `world.goalRanges`.
- `world.capsules[]`: {a,b,r,e}. Ağ: `pos` / `renderEdges` kimliği sabit (3362 düğüm, iki kale).
- Bekleyen: `setDynamicColliders`, statik collider entegrasyonu (`src/env/colliders.ts`), `holdBall`, `predictTrajectory`.
- Test: `npx -y tsx scripts/sim-test.mjs [şut] [tohum]`, ağ hissi: `npx -y tsx scripts/koord-net-probe.mjs`.

## VAR sahada inceleme akışı (G + K + I)
1. G sessiz kontrol yapar; yalnız ince pozisyonlarda (çizgi ≤ ~6 cm, ofsayt |margin| ≤ 0,3 m) inceleme önerir → `game.emit({type:'var-start'})`. Oyun durur (`match.phase='var'`, K).
2. K: hakem `var-listen` (eli kulakta, ~1 s), sonra kenardaki VAR monitörüne koşar (`run`), monitörde `var-monitor`.
3. G: monitör sahnesi ve ekranı (render target ile tekrar), kenar çizgisinde, orta sahanın yanında. Monitörün dünya konumu `src/var/monitor.ts` → `VAR_MONITOR = {x, z, facing}` (K hakemi buraya götürür).
4. Hakem monitördeyken G tekrarı oynatır (monitör ekranı + kullanıcıya tam ekran); karar → `var-decision`.
5. K: hakem `var-signal` (TV işareti), ardından kararı uygular (gol/ofsayt serbest vuruşu vb.) ve oyunu yeniden başlatır.

## Başsız tarayıcı kuralı (KESİN)
Kullanıcı Firefox'ta oynuyor; makine yükü 47'ye çıkıp FPS'i yere indirdi. Tüm başsız tarayıcı çalıştırmaları (shot.mjs, diag-ff.mjs ve kendi betiklerin) şu sarmalayıcıdan geçer:
`scripts/run-browser.sh node scripts/<betik>.mjs ...` → makine genelinde tek kilit (aynı anda tek test tarayıcısı) + nice 19.
Başsız Node testleri (tsx) için de `nice -n 19` kullan. Doğrudan `node scripts/shot.mjs` çalıştırmak yasak.
