# K → K2-hakem devir notu (kurallar, hakem, ses)

Sahiplik: `viewer/src/rules/*`, `viewer/src/referee/*`, `viewer/scripts/rules-*.mjs`.
Yazdığın oyun durumu: `game.match`, `game.referee`, `players[].yellow/sentOff`.
- Duran top kurulumunda ayrıca oyuncu `x,z,vx,vz,facing` ve `placeBall`.
- Atılan oyuncunun çıkış yürüyüşü `x,z,vx,vz,facing`.
- Duraklama anında tüm `hasBall=false` (kaleci tutuşunu bırakmak için).

## Dosyalar
| Dosya | İş |
|---|---|
| `src/rules/engine.ts` | Tüm kural mantığı, saf (React/three/sim yok). `Rules` sınıfı, `judgeContact` saf faul kararı, sabitler. |
| `src/rules/instance.ts` | Tarayıcı örneği: gerçek `game`, `world.ball`, F'nin `placeBall/kick/setControlled`, G'nin `VAR_MONITOR`, `varState.active`. HMR kaydı (aşağıda). `window.__rules/__game/__world` ayıklama erişimi. |
| `src/rules/Rules.tsx` | Kare döngüsü: `useFrame(-20)` → `pre`, `useFrame(-0.5)` → `post(gdt, wallDt)`. Mount olunca `start()` (yeni maç), sökülünce maç biter. Ses tetikleri. |
| `src/rules/RulesHud.tsx` + `rules.css` | Skor/saat tabelası, karar bandı, faz satırı, avantaj çubuğu, insan taker ipucu, 3-2-1 sayacı, ses düğmesi + kaydırıcı. VAR tekrarında (`isVarActive()`) bant/ipucu/sayaç gizli. |
| `src/rules/audio.ts` | WebAudio sentezi: düdük (kısa / uzun / devre 2 uzun / maç sonu 3 uzun), vuruş, ağ, seyirci uğultusu + gol kabarması. İlk tıklamada açılır. Ses düzeyi `localStorage 'k-ses'`. |
| `src/rules/api.ts` | `varDecision`, `rulesHistory` (eski elle VAR API'si; G artık olaylarla çalışıyor). |
| `src/referee/motion.ts` | `RefereeBrain`: 8–12 m geride çapraz takip, oyunculardan ve top yolundan kaçınma, jestler (`gestureFor`), `goto` (VAR monitörü). |
| `scripts/rules-test.mjs` | Başsız kural testleri (134 kontrol). |
| `scripts/rules-ff.mjs` | Firefox teşhisi, `?mode=mac`. |
| `scripts/rules-walk.mjs` | koord-walk kopyası; mode/ball/timeScale/frame izi basar. |

## Test komutları
```
cd viewer
npx tsc -b                                   # rules/referee temiz olmalı
nice -n 19 npx -y tsx scripts/rules-test.mjs # 134 gecti, 0 basarisiz (son durum)
scripts/run-browser.sh node scripts/rules-ff.mjs
scripts/run-browser.sh node scripts/rules-walk.mjs   # W ile kickoff -> play
```
Testler `fresh()` ile sahte game + sahte top kurar, `step(sn, ts)` ile `pre/post`'u kare kare sürer. Yeni kural = yeni senaryo bloğu.

## Kural özeti
- **Akış:** başlama vuruşu (maç başı, devre, gol sonrası yiyen takım). `?half=` dakika (varsayılan 3). İki devre, devre arası 5 s, `attackDir` takası. Maç sonu. Saat yalnız 'play'de akar.
- **Modlar (`rules.mode`):** `play | stopped | setup | ready | halftime | fulltime`. `match.phase` bunlardan türetilir.
  - `stop()`: düdük, bekleme. `setup()`: dizilim, `match.restart` DOLU, top `placeBall`. `makeReady()`: vuruş beklenir. `resume()`: 'play'.
- **Out:** kale çizgisinde son dokunan savunmaysa korner, değilse kale vuruşu (kaleci kullanır). Yan çizgide rakibe kickin. Golü kendim tespit ediyorum (çizgi geçişi, iki kale), B'nin `onEvent`'i kullanılmıyor.
- **Faul (`judgeContact`):**
  - Sıra: önce topa + önden → temiz. Ayakta ≥ 0,92 ise faul + en fazla sarı. Kaymada şiddete bakılmaz, çünkü F'nin kayma şiddeti 1'e doyar (QA C1).
  - Arkadan kayma → faul + sarı.
  - Topsuz: tackle faul; body > 0,4 faul.
  - Shield (hedef `anim==='shield'`): arkadan gelmek tek başına faul değil; top ≤ 1,3 m ve şiddet ≤ 0,55 ise temiz.
  - Shoulder: yasal. Faul yalnız ≥ 0,7, arkadan (shield değilse) ya da top > 2 m.
  - Kart: arkadan kayma, ≥ 0,75 ya da her 3. faul sarı. Topa oynamadan ≥ 0,92 kırmızı. İkinci sarı kırmızı. Aynı çiftin 0,8 s içindeki temasları tek sayılır.
- **Avantaj:** faul yapılan takım topu tutuyor ve hücum üçte birlikte ise 2 s. Rakip topu alırsa geri dönülüp faul verilir. Kartlar bir sonraki duraklamada çıkar.
- **Penaltı:** ceza alanında faul. Dizilim tam: taker noktada, kaleci çizgide, diğerleri alan dışında.
- **Serbest vuruş:** rakipler 5 m; kaleye 18 m'den yakınsa 2 kişilik baraj (kale çizgisine kırpılır). Taç, kickin ve korner 3 m, kale vuruşu 6 m.
- **Ofsayt:** pas/lob/şut/kafa anında `offside-check` (her takım arkadaşı, margin = (x+0,25) − max(sondan ikinci savunmacı, top)). İlk dokunan takım arkadaşı margin > 0 ise düdük, `offside` olayı, ENDİREKT serbest vuruş. Korner, kickin ve kale vuruşundan ofsayt yok; kendi yarı sahada yok.
- **Endirekt:** ofsayt, VAR ofsayt kararı ve kaleci 3 s. Başka bir oyuncu dokunmadan rakip kaleye giren top gol değil, kale vuruşu verilir; kendi kalesine girerse korner. Hakem `anim='indirect'` (kol yukarıda).
- **3 s kuralları:**
  - Kaleci hasBall + top y ≥ 0,3 iken 'play'de 3 s → ceza alanı içinden endirekt. Sayaç her duraklamada sıfırlanır.
  - Serbest vuruş, kickin, korner: 'ready'den 3 s. İnsan aşarsa aynı tür top rakibe ("SÜRE DOLDU"). YZ taker için yedek pas 3 s'de (kickoff, kale vuruşu ve penaltıda da YZ yedeği 3 s). İnsan için yedek yok.
  - VAR tekrarında (`varState.active`) sayaç durur.
- **İnsan taker:** kurulumda kontrol `setControlled(taker)`. 0,15 s hareket girdisi verirse kilit hemen kalkar ('ready'). 'ready'de taker'ın topa her dokunuşu (dribble dahil, trap hariç) vuruş sayılır ve oyun başlar. Güvenlik ağı: top 0,35 m oynar ya da 1,5 m/s hızlanırsa 'play'.
- **Sahada VAR:**
  - `var-start` → faz 'var', oyuncular yavaş yürür, aksiyon yok.
  - Hakem 1 s `var-listen`, sonra `VAR_MONITOR`'un 0,9 m önüne koşu, `var-monitor`.
  - `var-decision` saklanır. Monitörde en az 1 s izlenir, 1,5 s `var-signal`, sonra `applyVerdict`: gol / gol-degil / ofsayt (endirekt, müdahil alıcının pas anındaki yeri) / korner / kale-vurusu / kickin / aut.
  - VAR hakemi `rdt` (gerçek zaman) ile yürür; G tekrarda timeScale=0 yapar.
- **Kaleci duraklamada:** `stop()` tüm `hasBall=false` + `world.holdBall(false)`. F de istisnayı kaldırdı.
- **Atılan oyuncu:** en yakın kenar çizgisine (z = ±16) 1,4 m/s yürür (`walkOff`). I'nın onu görünür çizmesi gerekiyor (istendi, doğrulanmadı).

## Tuzaklar
1. **HMR motor devri:** başka ajanların düzenlemesi `instance.ts` bağımlılık zincirini (store, sim, control) yeniden yükler ve yeni `Rules` kurulur.
   - Eskiden kare döngüleri ESKİ motoru sürüyor, eskinin dinleyicisi kapalı olduğu için maç 'ready'de kilitleniyordu.
   - Şimdi `globalThis.__kRules` kaydı var: yeni motor `adopt(prev)` ile durumu devralır, `prev.dispose()`.
   - Herkes `currentRules()` ile okur. `Rules.tsx`, `RulesHud.tsx` ve `api.ts`'te doğrudan `rules` KULLANMA.
   - Yeni özel alan eklersen `adopt()`'taki `keep` listesine ekle.
2. **Zaman:** oyun zamanı `min(dt,1/30)*timeScale`; yavaş karede çok ağır akar. Duran top, VAR ve devre arası zamanlayıcıları GERÇEK zamanla (`wallDt = min(dt,0.25)`) sayar. Yoksa başsız tarayıcıda ve takılmalarda kurulum bitmez.
3. **Sayfa içi `import('/src/...')`** Vite HMR yüzünden ayrı bir modül kopyası verebilir. Ayıklamada `window.__rules/__game/__world` kullan.
4. **Olay kuyrukları:** `touch`/`contact`/`var-*` olayları kuyruklanır ve `post`'ta işlenir. Testte emit'ten sonra bir `step(DT)` gerekir.
5. **Mount/start:** maç `<Rules />` mount olunca başlar (F: `ctl.mode==='mac'`). Antrenmana geçince `started=false`, tekrar Maç'a basınca yeni maç. HMR yeniden mount'u maçı sıfırlamaz (`mounted` sayacı + setTimeout).
6. **SwiftShader** fps'i anlamsız: başsız tarayıcıda oyun zamanı gerçek sürenin %3–15'i. Zamanlama mantığını `rules-test.mjs` ile doğrula.

## Açık sorunlar / sıradaki işler
- **Atılan oyuncunun yürüyüşü:** I2'nin `sentOff` oyuncuyu gizlemeyip vx,vz ile yürütmesi lazım. Görüntüyle doğrulanmadı.
- **Endirekt işaret:** I'nın 'indirect' klibi hazır dedi; maçta görsel olarak doğrulanmadı.
- **Hakem monitöre gidiş:** G'nin tente sahnesiyle uçtan uca görüntüde doğrulandı (G-8). Hakemin oyunculardan kaçınması yalnız itme tabanlı; kalabalıkta takılırsa `motion.ts` `PERSONAL`/`BALL_LANE`'e bak.
- **Gerçek GPU maç testi:** kart, penaltı, ofsayt ve avantajın görsel akışı (bantlar, hakem jestleri) GPU ile maçta gözle kontrol edilmeli (C'nin `shots/gshotC.mjs` deseni). QA raporu `viewer/qa/rapor-0115.md`.
- **Faul dengesi:** F'nin shield/shoulder değişikliklerinden sonra maç başı faul sayısını ölç (hedef ~8–10). Eşikler `engine.ts` başındaki sabitlerde.
- **Ses:** sentez basit (seyirci = filtreli gürültü). İstenirse gerçek örnek dosyalara geçilebilir (`public/` + `fetch`), ilk etkileşim kuralı korunmalı.
- **Önceki "play başında 7 s kare donması":** benim değildi (kurallar ~0,1 ms/kare); koordinatör başka ajana yönlendirdi.
