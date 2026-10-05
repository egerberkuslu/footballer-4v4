# G → G2-var devir notu (VAR)

Sahiplik: `viewer/src/var/*`, `viewer/scripts/var-*.{mjs,js}`.
Yazdığın oyun durumu:
- Olaylar: `game.emit` ile `var-start` ve `var-decision`.
- Tekrar sırasında geçici olarak `world.ball`, `world.pos/prev/vel`, `game.players[].x,z,vx,vz,facing,anim,animT,hasBall`, `game.referee` ve `world.timeScale` alanlarına yazıyorsun. Hepsi geri yükleniyor.

## Dosyalar
| Dosya | İş |
|---|---|
| `src/var/scene.tsx` | **Ana mantık** (`VarScene`). Kayıt, otomatik algılama (kale çizgisi kıl payı + ofsayt zinciri), sahada inceleme akışı, tekrar oynatma, kamera devralma, `window.__var` test erişimi. |
| `src/var/overlay.tsx` | DOM arayüzü (`VarOverlay`). Bant, kamera adı, zaman çubuğu, ölçüm paneli, karar kartı, sağ altta VAR düğmesi + "Oto VAR açık/kapalı", toast. Tuşlar: X elle inceleme, Esc atla, inceleme sırasında diğer tuşlar capture'da yutulur (F3 ve ` serbest). |
| `src/var/VarScene.tsx`, `VarOverlay.tsx` | Tek satırlık yeniden ihraç. App bunları import ediyor; geçişi tek yazmayla yapmak için öyle bırakıldı. |
| `src/var/judge.ts` | Saf karar mantığı. `LINE_TOL=0.06`, `OFFSIDE_TOL=0.3` (eşikler TEK yerde), `classify`, `judgeTrack`, `eventVerdict`, `lineDisplay`, `offsideDisplay`, `fmtCm`. |
| `src/var/recorder.ts` | Halka tampon, 600 kare (10 s), 60 Hz, sim zamanıyla örnekleniyor. İçeriği aşağıda. |
| `src/var/graphics.tsx` | 3B grafikler. `LineGraphics`: çizgi düzlemi paneli, top izdüşümü, boşluk ölçeği, Html cm etiketi. `OffsideGraphics`: iki renkli zemin şeridi + dikey perdeler, SAVUNMA/HÜCUM etiketleri, cm etiketi. |
| `src/var/VarMonitor.tsx` | Kenardaki monitör + tente + kablo + ekipman kutusu (5 çizim çağrısı, birleştirilmiş geometri). Ekran bostayken "VAR" logosu. İnceleme sırasında 512x292 render hedefine `monitorLink.cam`'den 2 karede bir çiziliyor (`monitorLink.live`). `hold` iken son kare ekranda kalıyor. |
| `src/var/monitor.ts` | `VAR_MONITOR = {x:0, z:-(PITCH_W/2+1.6), facing:0}`, `VAR_SCREEN_Y=1.45`. Bağımlılıksız; K2 import ediyor. |
| `src/var/store.ts` | `varState` (active, phase, auto, case, display…), `cameraLock()`, `isVarActive()`, `requestVar`, `skipVar`, `toast`. Çok oyunculu kancalar: `startRemoteReview(case)`, `endRemoteReview()`. |
| `src/var/var.css` | Tüm VAR stili. `body.var-on` iken `.shot-hud`, `.hud`, `.shot-msg`, `.help-*` gizleniyor. |

Kaydın içeriği:
- Top: konum + kuaterniyon.
- Ağ: yalnız top bir kaleye 4,5 m yakınken o kalenin düğümleri, Int16 mm farkı.
- Oyuncular + hakem: x, z, vx, vz, facing, anim indeksi, animT, hasBall.
- `cut[]`: top ışınlandı mı. Böyle bir karede segment başlar.

Toplam ~5,5 MB, kayıt maliyeti ~0,05–0,1 ms/kare.

## Akış (scene.tsx `begin` → `plan` adımları)
Maçta (`ctl.mode==='mac'`):
1. `var-start` yayılır.
2. **walk:** canlı, timeScale'e dokunulmaz. Kamera hakemi izler. `referee.anim==='var-monitor'` olup hakem durma noktasına <1,3 m yaklaşınca biter; en fazla 14 s bekler.
3. Tekrar adımları:
   - Çizgi: yayın (monitör görünümü) → kuş bakışı → gol çizgisi kamerası → donmuş sanal analiz.
   - Ofsayt: yayın (pas anına kadar) → donmuş kuş bakışı → donmuş yan açı.
   - Sonra 1,4 s omuz üstü monitör görünümü.
4. **signal:** canlıya dönülür (`thaw`), `var-decision` yayılır. Kamera hakemin TV işaretine bakar, kart alt bölümde görünür.
5. **outro:** kamera geri yüklenir.

Antrenmanda hakem yok: intro → tekrar → verdict kartı → outro. Olay yayılmaz.

Tekrar sırasında oyuncuları ve hakemi kayıttan yazıyorsun. `useFrame(-100)` kancası her karenin başında canlı değerleri geri koyuyor; böylece K ve F canlı durumda çalışıyor. Hakem yalnız tam ekran açılarda kayıttan yazılıyor; monitör görünümünde K'nın canlı hakemi kalıyor.

## Otomatik tetikleme (kullanıcı kuralı, değiştirme)
- **Kale çizgisi:** top merkezi direkler arasında, üst direğin altında, çizgiye 0,4 m'den yakınken bir "yaklaşma" başlar. `m = maxD − R` (tamamen geçme payının en büyüğü) izlenir.
  - `m > 0,06` olursa rahat gol sayılır, inceleme yapılmaz.
  - Yaklaşma topun 0,3 m geri dönmesiyle, bölgeden çıkmasıyla ya da topun 0,4 s durmasıyla biter. `|m| ≤ 0,06` ise incelenir.
- **Ofsayt:** K'nın `offside-check` olaylarından zincir kuruluyor. Takım arkadaşının `touch` olayı alıcıyı "müdahil" yapar; rakip dokunuşu zinciri siler. `goal` olayı gelince zincirdeki en son müdahil pasın `|margin| ≤ 0,3` olup olmadığına bakılır. Pas kayıt penceresi dışındaysa inceleme yapılmaz.
- **Taç/kickin ve direk dışı aut:** asla incelenmez.
- **Elle (X):**
  - Maçta: son golden sonraki 12 s içindeyse ofsayt zinciri; değilse son 4 s çizgi kararı. "TOP OYUNDA" çıkarsa toast gösterilir, inceleme açılmaz.
  - Antrenmanda: her şey.
- **Misafirde** (`isGuest()`): otomatik ve elle başlatma yok, yalnız `startRemoteReview`.

## Doğrulanan
- `npx tsc -b`: src/var temiz.
- Sayısal karar (`scripts/var-num.js`): çizgi üstü GOL DEĞİL −11 cm, 1 cm içeride GOL +1,0, 1 cm dışarıda GOL DEĞİL −1,0.
- Otomatik ölçüt (`scripts/var-auto.js`): +3 cm geçip dönen top GOL incelendi; −3 cm GOL DEĞİL incelendi; +9 cm incelenmedi; taç kıl payı incelenmedi; direk dışı incelenmedi.
- Maç akışı (`scripts/var-flow.mjs ... line G`): `shots/G-monitor.png`, `G-freeze.png`, `G-signal.png` (eski adlarıyla `G-6/7/8`). var-start → hakem monitörde, ekranda tekrar → tam ekran analiz → var-decision → TV işareti. K tarafı uyumlu (K: 123/123 test).
- O-qa gerçek GPU'da elle VAR akışını baştan sona çalışır gördü; taç, net aut ve net ofsaytta otomatik başlamadı.

## Açık sorunlar ve sıradaki işler (öncelik sırasıyla)
1. **Ofsayt akışı uçtan uca DOĞRULANAMADI.** Başsız test iki kez, başka ajanların HMR yeniden yüklemesi yüzünden yarıda kaldı (`__var` undefined). Çalıştırma: `scripts/run-browser.sh node scripts/var-flow.mjs "mode=mac&blades=12000&fx=0" offside G-9`. Betik `import('/src/game/store.ts')` ile sahte offside-check, touch ve goal yayıyor. Dikkat: canlı maçta rakip dokunuşu zinciri sıfırlar; sahte olaylar arasında AI topa dokunursa tetiklenmez. Gerekirse `window.__var.debug()` zinciri gösterir. Ofsayt çizgisi görselini (G-9-freeze) Read ile kontrol et.
2. **timeScale çelişkisi:** team-lead "timeScale=0 YAPMA" dedi. Şu an walk sırasında dokunulmuyor, yalnız tekrar karelerinde (hakem monitördeyken) 0 yapılıyor. K, hakemi rdt ile yürüttüğü için bunu uyumlu buldu. Bunun nedeni: fizik koşarken `world.ball`/ağ kayıttan yazılırsa sim yazılan durumu entegre eder ve ağ patlar; görsel olarak her kare üzerine yazılsa da gol/out olayları sahte tetiklenebilir. team-lead ısrar ederse ya top ve ağ için ayrı "hayalet" render (canlı dünyaya yazmadan) gerekir ya da team-lead'e bu gerekçe anlatılmalı.
3. **Alt-kare hassasiyeti (team-lead isteği):** kritik karede cm, kare aralığına bağlı; 60 fps'te 35 m/s'de ~58 cm'ye çıkabilir. Kayıtta hız yok; `recorder.ball`'a vx, vy, vz ekle (stride 7→10). İki kare arasında balistik interpolasyonla (`x0+v·t`, `y0+vy·t+½g·t²`) çizgi düzlemine mesafenin sıfır geçişini çöz. Kritik "an"ı kesirli kare olarak sakla: `rec.apply(world, f)` kesirli kareyi zaten destekliyor. Hedef 60 fps'te ve 35 m/s'de ≤ 1 cm. Hızlı şut testi ekle (`world.shoot('yerden')`, ball 25–31 m/s).
4. **Açık golde gösterim (O-qa):** açık golde "+0,4 cm" kıl payı gibi görünüyor. Şu an otomatik inceleme yalnız kıl payında açıldığı için bu yalnız elle X'te çıkıyor. Elle incelemede, m > LINE_TOL ise kartta "Açık gol · topun tamamı X cm geçti" (en büyük pay) yaz.
5. **"☰ Menü" düğmesi** inceleme sırasında görünüyor; F2-kontrol'e yazıldı, yanıt bekleniyor.
6. Analiz kamerası oyuncu kapatmasından kaçıyor (`clearAnalysis`, xz bakış doğrusu testi). Sonrasında görüntü alınmadı; G-7'de kaleci kadrajı kapatıyordu. Bir tur daha görüntüyle doğrula.
7. Monitör görünümünde hakemin saçı tırtıklı (O-qa) → E2/I2'nin alanı, G değil.
8. Walk kamerası başsızda neredeyse görülmedi (hakem büyük dt ile anında varıyor). Gerçek GPU'da yürüyüşün yayın kamerasıyla düzgün izlendiğini doğrula; gerekirse walk kamerasını hakemle monitör arasını kapsayacak şekilde ayarla.

## Tuzaklar
- **App'e bağlantı (F'nin dosyası):** `<VarScene world={world} />` CameraRig'den SONRA (aynı öncelik 0'da benim kameram son yazar), `<VarOverlay />` Canvas dışında. CameraRig `cameraLock()`'a, ShotController `isVarActive()`'a uyuyor.
- **useFrame öncelikleri:** VarScene 0 (Characters'tan önce mount, oyuncu yazımı I'nın render'ından önce), `-100` canlı geri yükleme. Pozitif öncelik YASAK. VarMonitor'un RT render'ı da 0'da; `gl.shadowMap.autoUpdate` geçici kapatılıyor, ekran mesh'i geri besleme olmasın diye gizleniyor.
- **Kesme algılama:** top bir örnekte 1 m + hız payından fazla zıplarsa `cut`. Elle `place` ile testte büyük sıçramalar segmenti keser. Kıl payı testlerinde adımları <1 m tut, örnekle senkron yerleştir: `smp()` `rec.lastT` değişimini bekler.
- **Başsız tarayıcı ~1–2 fps.** `varState.warp` tekrarı hızlandırır (yalnız test). `rec.sample` sim zamanıyla örneklediği için sabit sürelere değil örnek sayısına göre bekle.
- **Başka ajanların HMR'si** sayfayı yeniden yükleyebilir. `__var` undefined hatası alırsan tekrar dene; tsc'nin tamamı temiz mi bak.
- **Canlı sayfa:** yeni sürümleri ayrı dosyada yaz, tsc ile doğrula, sonra VarScene.tsx/VarOverlay.tsx yeniden ihracını tek `mv` ile değiştir (bu turda öyle yapıldı).
- **Ağ düğüm aralığı:** `goalRanges[i].n0..n1` (n1 hariç kabul edildi, `world.n` ile kırpılıyor).
- **Painted line:** saha çizgisi [g−0,1, g] arasında; karar kenarı x=±PITCH_L/2 = çizginin dış kenarı. "Tamamı geçti" = d ≥ BALL_R.

## Test komutları
```
cd viewer
nice -n 19 npx tsc -b
scripts/run-browser.sh node scripts/shot.mjs shots/x.png --q "blades=2000&fx=0" --wait 9000 --eval "$(tail -n +4 scripts/var-num.js)"
scripts/run-browser.sh node scripts/shot.mjs shots/x.png --q "blades=2000&fx=0" --wait 9000 --eval "$(tail -n +4 scripts/var-auto.js)"
scripts/run-browser.sh node scripts/var-flow.mjs "mode=mac&blades=12000&fx=0" line G-L     # G-L-{monitor,freeze,signal}.png
scripts/run-browser.sh node scripts/var-flow.mjs "mode=mac&blades=12000&fx=0" offside G-O
scripts/run-browser.sh node scripts/diag-ff.mjs
```

## Ekip arayüzü
- **K2-hakem:** var-start'ı alıp hakemi yürütüyor, var-decision'ı uyguluyor. Verdict değerleri 'gol' | 'gol-degil' | 'ofsayt' | 'korner' | 'kale-vurusu' | 'kickin'. VAR sırasında kendi HUD'unu gizliyor.
- **L2-mp:** host `varState.case`'i misafire gönderip `startRemoteReview(case)` / `endRemoteReview()` çağırıyor. Bağlantı L'de; bağlandığı doğrulanmadı.
- **F2-kontrol:** Menü düğmesini gizleme isteği bekliyor.
