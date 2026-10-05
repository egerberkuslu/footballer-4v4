# F → F2-kontrol devir notu

Alan: insan girdisi, hareket ve top aksiyonları (locomotion), kamera, HUD, App.tsx bağlama, antrenman şut modu.
Durum (2026-10-05): son adım bitti. Benim dosyalarımda tsc temiz (kalan hata yalnız src/ai/brain.ts, J'nin `process` kullanımı). Firefox ?mode=mac diag'ı temiz.

## Dosyalar (hepsi viewer/src altında)
| Dosya | İş |
|---|---|
| `control/locomotionApi.ts` | **Arayüz ve tüm sabitler**: aksiyon semantiği, hızlar, zamanlamalar. J, K ve I buna göre yazıyor; değiştirince bildir. |
| `control/locomotion.ts` | `stepLocomotion(gdt)`: saf, React'siz adım (useFrame -15). Hareket, aksiyonlar, ilk dokunuş, sürme, jockey, omuz/itişme, kaleci, kapsüller (`world.setDynamicColliders`), `touch`/`contact` olayları. `setControlled(id)`, `locoTuning`, `lobVelocity`, `passSpeed`. |
| `control/MatchControl.tsx` | Maç insan girdisi (-30) + locomotion çağrısı (-15). Tuşlar, gamepad, duran top kilidi, HUD ipucu (`ctl.hint`), çok oyunculu kancalar (`lockedPlayer`, `isGuest`). `window.__loco`. |
| `control/ShotController.tsx` | Antrenman şut modu: nişan halkası, yörünge, topu sürükleme/sağ tık yerleştirme, olay yazıları (GOL/DİREK…), M tuşu (mod). `window.__shot`. |
| `control/actions.ts` | Şarj/bırakma/koşu sonu vuruş, `placeSpot`, `setMode` / `switchMode` (M'nin perdesiyle), `takeCharge` / `tickCharge`. |
| `control/aim.ts` | Şut çözücü `solveShot` (sürükleme + Magnus, falsonun %80'i telafi edilir), `predictPath`. |
| `control/training.ts` | Antrenmanda oyuncu dizilişi (şutçu topun arkasında, diğerleri kenarda) ve şutçu kapsülü. |
| `control/store.ts` | `ctl` deposu (mod, kamera, sarj, falso, ipucu…), `playMode()`. `useMode.ts` → `usePlayMode()`. |
| `control/worldApi.ts` | B'nin API'sine ince katman. |
| `control/shot.css` | Şut HUD'u, ipucu bandı, yardım paneli. |
| `CameraRig.tsx` | Şutçu kamerası, maç yayın kamerası ('yayin', topu ve kontrol edilen oyuncuyu izler), presetler, VAR kilidi (`cameraLock`). |
| `Hud.tsx` | Mod düğmeleri, skor (antrenmanda world sayaçları), güç/falso/kondisyon, gün saati (D), "?" paneli (iki mod). |
| `App.tsx` | Bağlama noktası: Characters (I), TeamAI ve Rules (maçta, misafirde değil), NetSync/MpOverlay (L), VarScene/VarOverlay (G), Warmup/BootOverlay (M). |

## Son iş: top sürme ve savunma yeniden yazımı (kullanıcının 1 numaralı şikâyeti)
Yapılanlar ve ölçümleri `scripts/ctl-feel.mjs` ile (önce → sonra):
- Yakın kontrol: `dribble()` + `steerBall()`. Top hedef noktaya hız doğrudan yazılarak (world.ball.vx/vz + yuvarlanma spini) yapışık sürülüyor. Top 0,44–0,57 m önde (%100 bantta). Girdi yönü aynı karede uygulanıyor; durunca top tabanda.
- Sprintle sürme: top 1–1,8 m önde, düşük kazanç (k=4,5); 75°'nin üstündeki dönüşte %18 kaçma. 90° dönüşte kaçma: yakın %0, sprint %23.
- Girdi gecikmesi: 90° dönüş 0,73 → 0,25 s; kalkış 0,47 → 0,17 s (ACCEL 20, DECEL 32, TURN_RATE 16).
- Jockey: `inputs[id].jockey` (types.ts'e eklenmesi istendi; şimdilik `PlayerInput & {jockey?}`). E ≥0,18 s basılı ya da gamepad RB basılı. Mesafe ~1,54 m, %100 kale tarafında.
- Ayakta müdahale: E dokunuş. 0,22 s atılma (3,2 m/s) + 0,5 m bacak, ulaşma bacak segmentiyle (`segDist`). Durgun topta menzil 1,3 m; ıska kilidi 0,58 s, başarıda 0,3 s. Önden kazanınca top müdahale edene geçer, yandan dürtülür.
- Kayarak: Shift+E (gamepad LB+RB). 0,15 s hazırlık, 3,5 m kayma, ıskada 0,9 s yerde. Top kayan oyuncudan hızlı çıkıyor (`max(7+2k, v*1.2+2)`).
- Pas: vurucunun kapsülü 0,22 s hayalet, çift lead kaldırıldı. AI maçında pas isabeti %90/76.
GPU kare dizisi: `scripts/run-browser.sh node scripts/ctl-feel-shots.mjs` → shots/feel-*.png, özet shots/feelsheet-*.png.

### Eksik / sıradaki (öncelik sırasıyla)
1. **I'nin yeni animasyon sözleşmesine uyum** (I2-anim; son mesajı):
   - Dokunuşu `footTiming` ile senkronla: `import { footTiming } from '../anim/events'`. `min(l,r) < gdt` olan karede dokun, hep aynı ayak (sağ: `.r`). Şu an ritim `dribPhase` ile kendi sayacımızda (f = 1,6 + 0,25·hız).
   - Ani dönüşte (≥90°) 'cut-l' / 'cut-r' (0,45 s, temas 0,22) ya da 'drag-back' (0,55 s) anim'i yaz; durmada 'sole-stop' (0,4 s). types.ts'te yoksa team-lead'den iste. Mekanik hazır, yalnız anim adı ve zamanlama bağlanacak.
   - tackle temas anı artık 0,22 s (CLIP_LEN.tackleContact güncellendi; kod bunu okuyor) ve klip 0,75 s. TACKLE_LOCK (0,58) toparlanmayla uyumlu mu bak; ıska kilidini ~0,75'e çekmek gerekebilir.
   - slide: CLIP_LEN.slide = 0,8, oturur kalıyor. Kalkış için ıska sonunda (ve temasta) `getup` yazılmalı. Şu an slide'da getup yazılmıyor; kilidin son ~1,0 s'sinde `setAnim(p,'getup')` ekle.
2. **QA (O2-qa) bulguları:**
   - (C1) Slide contact intensity 1,0'a doyuyor; önden ballFirst bir kayma direkt kırmızı aldı. Formül `runAction` slide: `0.55 + (v0*k)/14 + …`; v0=14 olduğu için hep ≥1. Hıza göre 0,3–0,8 aralığına ölçekle (ballFirst ise düşük); K2 ile eşikleri konuş.
   - (K1) Maçta "Yayın" kamera düğmesi (preset index 4) sabit preset açıyor ve ctl.cam='serbest' yapıyor. Maçta index 4 → `ctl.cam='yayin'` olmalı (CameraRig apply). HUD'da camOn vurgusu da düzelmeli.
   - (K3) "Duran top kuruluyor…" ipucu gol kutlamasında ve VAR monitöründe görünüyor. MatchControl'deki hint koşuluna `phase==='stopped'` iken (gol/VAR) gizleme ekle; ya da yalnız `restart` kuruluyken ve faz freekick/corner/kickin/goalkick/penalty/kickoff iken göster.
   - Duran topta 3 s RESTART_LIMIT (K) insan nişanı için kısa olabilir; karar team-lead/K2'de.
3. **J'nin pas göstergesi:** `import { passHints, humanReceiver } from '../ai/brain'`. q>0,5 olan en iyi bir iki arkadaşın ayağının altına ince halka (opaklık q). Kimin çizeceği I2 ile kararlaştırılacak; HUD/MatchControl tarafında yapılacaksa yeni bir `control/PassHints.tsx` (Canvas içi, useFrame öncelik ≤0) uygun.
4. types.ts: PlayerInput.jockey alanı eklenince `InputX` cast'i kaldırılabilir.

## Tuzaklar
- **Pozitif useFrame önceliği YASAK** (efekt zincirini bozuyor). Sıra: MatchControl girdi -30, AI -25, K -20, locomotion -15, Sim -1, K -0.5, I 0.
- **Firefox'ta Ctrl+W/Q** sekmeyi/tarayıcıyı kapatıyor. Hiçbir oyun tuşunda Ctrl kullanma (aşırtma Z). Oyun tuşlarında keydown'da preventDefault.
- **HMR dinamik import farklı modül örneği döndürür.** Testlerde `window.__shot`, `window.__loco`, `window.__game` kullan.
- **world.kick `shots++` yapar ve olay bayraklarını sıfırlar.** Sürmede her kare kick çağırma; hız doğrudan `world.ball.vx/vz` yazılıyor (steerBall).
- **world.onEvent nesne verir** (`e.type`); 'oyuncu' olayı kapsül temasıdır ve locomotion bunu `touch` olarak yayar (topu süren hariç).
- **Duran topta** yalnız `restart.taker` topu alıp sürebilir; kurulumda `restart` null olabilir (K). İnsan girdisi faz 'play' değilken yalnız taker için çalışıyor.
- **ShotController mount'ta** topu yalnız antrenmanda yerleştiriyor; maçta yerleştirirse başlama vuruşu kurulmaz (eski hata).
- **Kaleci kendi ceza alanında** topu ayakla karşılamaz (keeperSave elle alır); geri paslar hariç (`backPass`, K'nın match.lastTouch'u).
- **Omuz teması**: başlatan, karşıya doğru yanal hızı büyük olan; fromBehind açısı >120°; intensity 0,15 + yanal×0,12 + güç farkı×0,06 (+0,13 sprint). K2 eşiği: ≥0,7 faul, arkadan faul.
- **Dalış yönü**: karakterin solu dünyada (cos f, −sin f).
- **Sayfa kırılmasın**: JSX'te koşullu blok açarken kapanışını aynı yazmada ekle (bir kez birkaç saniye kırıldı).
- Shield açık kalacak (team-lead kararı).

## Test komutları (viewer içinde)
- `npx tsc -b`
- `npx -y tsx scripts/ctl-feel.mjs`: his ölçümü (sürme, dönüş, gecikme, durma, müdahale eğrisi, jockey, kayma menzili)
- `npx -y tsx scripts/ctl-loco-unit.mjs`: trap/göğüs/kötü dokunuş, omuz senaryoları, shield, kaleci tutma/yumruk/atış/dalış, duran topta sürme
- `npx -y tsx scripts/ctl-pass-unit.mjs`: rakipsiz pas (38/40)
- `npx -y tsx scripts/ai-match.mjs 150 <tohum>`: J'nin başsız AI maçı (pas, out, faul, pas kayıp sınıfları)
- `scripts/run-browser.sh node scripts/ctl-diag-ff.mjs [mode=mac]`: Firefox pageerror
- `scripts/run-browser.sh node scripts/ctl-match-ff.mjs`: Firefox maç e2e (K ile başlama, sürme, şut)
- `scripts/run-browser.sh node scripts/ctl-feel-shots.mjs shots/feel`: gerçek GPU kare dizisi
- Antrenman: `scripts/ctl-aimtest.mjs` (20 şut, hedef hatası), `scripts/ctl-events-sw.mjs` (GOL/DİREK yazıları)
