# J-ai -> J2-ai devir notu (takım yapay zekâsı, src/ai/*)

## Sahiplik ve sözleşme
- Dosyalar: `src/ai/brain.ts` (her şey), `src/ai/config.ts` (zorluk ve tohum), `src/ai/predict.ts` (top yolu, pas hızı modeli), `src/ai/TeamAI.tsx` (useFrame -25), `src/ai/mockLocomotion.ts` (yalnız test yedeği, oyunda kullanılmaz).
- Testler: `scripts/ai-match.mjs`, `scripts/ai-human.mjs`, `scripts/ai-env.mjs` (Node için `location` taklidi, ilk import), `scripts/ai-ff.mjs` (Firefox).
- AI yalnız `game.inputs[id]` yazar. `human(p)` = `p.controlled || isRemoteHuman(id) || game.remote.has(id)` olan oyuncular atlanır, ama takım arkadaşı sayılır.
- Aksiyon anlamları F'nin `src/control/locomotionApi.ts` başındaki yorumunda. Pas `power 0` = mesafeden otomatik (varış 4,5 m/s), aşırtmada power yok sayılır, şut 8+26p m/s.
- F aksiyonu aynı karede tüketir. AI `b.act`'i kilit bitene dek (en çok 0,7 s) bekletir ve `act.sent` ile tüketimi izler. Bu olmadan ilk dokunuş kilidi sırasında kararlar sessizce kayboluyordu.
- Duran top: K top hazır olunca `match.restart.taker`'ı doldurur. Taker'ın bekleme süresi `takerDelay` ayarıyla belirlenir; 2,3 s'de 1,1 m içindeyse yine vurur (3 s kuralı). `restart.indirect` doluyken doğrudan şut çekilmez.

## Mimari (brain.ts)
- `updateAI(gdt)`: top yolu tahmini her kare (`predictBall`, 3 s, 1/30 s örnek). Takım kararı `decideHz` ile (5/7/10 Hz). Hareket girdisi her kare `writeInput`'ta: hedefe yönelim, göreli hızla çarpışma kaçınması, top sürerken sert dönüşte yavaşlama.
- Kaleci her iki karede bir düşünür. Elde tutma sayacı her kare çalışır (`holdStart`, dağıtım en geç 2,2 s'de gönderilir).
- `decideTeam`:
  - Sahiplik belirlenir; serbest topta, topa belirgin önce ulaşacak takım hücum dizilişine geçer.
  - Kovalayan (chaser) yalnız AI'dan seçilir. İnsan 4 m içinde ya da 8 m'den topa koşuyorsa baskıyı o yapar, AI markajda kalır.
  - Hücumda yerleşim: `attackSlots` destek (`supportSpot`: 7 m çevresinde altı aday nokta), derinlik (ofsayt çizgisine dek) ve dengeleyici.
  - Savunmada: `defendTargets` kale tarafından markaj, hattı birlikte tutma (toptan en çok 9 m derin) ve zor seviyede ofsayt tuzağı.
- Taşıyıcı (`decideCarrier`):
  - Önce şut değerlendirmesi, sonra pas: `bestPass` + `laneMargin` (rakibin ivmeli koşu süresi, pasördeki koni kuralı, varış noktası yarışı).
  - Pas eşikleri: kısa pas gevşek, aşırtma sıkı (0,7).
  - Pas yoksa ve rakip arkadaysa top koruma (en çok 1,5 s), aksi hâlde sürme.
- Kaleci (`keeperThink`): açıyı kapatma (seviye hatası `keeperPosErr`), şut tahmini ve dalış (çizgiyi kesmesine 0,55–0,6 s kala, y'ye göre alçak ya da yüksek), bire bir, dağıtım (15 m içinde boş arkadaşa elle atış, uzağa vole).
- `aiFlags` (duel, shield, touch, attackBall) başsız A/B testi için. `attackBall` A/B'de kötü çıktı, kapalı.
- `passHints` ve `humanReceiver`: insan için pas göstergesi verisi ve insan pasının AI alıcısı. F2 ve I2'ye gösterge önerildi; kimin çizeceği henüz belli değil.

## Ölçüm komutları (Node: `nice -n 19`)
- `npx -y tsx scripts/ai-match.mjs 150 <tohum> [kolay|orta|zor]` → AI-AI maç, K'nın gerçek kurallarıyla (`rules.start()` şart). Raporladığı satırlar:
  - skor, şut, pas ve isabet;
  - pas kayıp sınıfları;
  - duran top bekleme süresi (en çok);
  - kaleci elde tutma süresi;
  - temaslar, animasyon sayıları ve taşıyıcı kararları.
- Ortam değişkenleri:
  - `AI_OFF=duel,shield,touch`: davranış kapatma.
  - `CAL=1`: tahmini marj ile pas sonucu eşleşmesi.
  - `DBG5=1`: pas sapması 2 m'yi aşan vakaların dökümü.
  - `DBG4=1`: kalecinin tutma izi.
- `npx -y tsx scripts/ai-human.mjs 120 <tohum> <seviye>` → ev takımında insan taklidi sürücü, zorluk hissi ve insana destek ölçümü.
- Çok tohum ortalaması için örnek kabuk döngüsü: 6 tohumda pas/takım, isabet, faul ve gol ortalaması (`scratchpad/multi.sh` gibi bir döngü yaz; tek maç varyansı çok yüksek, kararları en az 6 tohumla ver).
- Firefox: `scripts/run-browser.sh node scripts/ai-ff.mjs` (`?watch=1&mode=mac`, `window.__ai` istatistiği, `shots/J-ff-N.png`).

## Son durum (orta seviye, 2×150 s)
- 6 tohum ortalaması: takım başına 41 pas, isabet %69, faul ~8, ~3,3 gol/maç.
- Kaleci elde tutma ≤2,5 s; duran top bekleme ≤1,95 s (ikisi de 3 s kuralının altında).
- Pas kayıp sınıfları (3 tohum):

| Sınıf | Pay | Sahibi |
|---|---|---|
| (a) Uçuşta kesildi | ~%50, çoğu yerden pas, pasördan 2,5–3,5 m ötede | AI |
| (b) Alıcı yetişmedi | ~%28 | AI |
| Hedefsiz (uzaklaştırma/yedek) | ~%17 | – |
| (c) Kötü ilk dokunuş | ~%4 | F |
| (d) Hedef/güç sapması | 0 (F başlama vuruşundaki çift öne atmayı kaldırdı) | F |

- İnsan taklidi (2×120 s), insan–AI skorları: kolay 9-1 ve 5-2; orta 2-1 ve 5-1; zor 2-3 ve 2-3. Rakip kaleci dokunuşu kolayda 2–4, zorda 15–31; zorluk farkı ölçülüyor.

## Açık sorunlar
1. İnsan pasının AI arkadaşa ulaşma oranı düşük (%13–31) ve top insandayken açık pas seçeneği az (ortalama 0,2–0,3). Kısmen taklit sürücü yüzünden: sürekli deparla kaleye koşuyor ve yalnız sıkışınca pas veriyor. Ama destek oyuncusu da pres altındaki taşıyıcıya yeterince açılmıyor olabilir.
2. Pasördeki koni kuralı pres altında hemen her yolu "riskli" sayıyor (insan taşıyıcıda ortalama marj −0,48 s). Gösterge eşiği bu yüzden −0,15'e gevşetildi.
3. "İnsan baskıdayken 2,5 m içinde AI arkadaş da var" metriği %12–33 çıkıyor. Bunun bir kısmı markajdaki AI'ın oradan geçmesi; AI'ın gerçekten ikinci adam olarak baskıya çıkıp çıkmadığı ayrıca ölçülmeli.
4. QA C4 HÂLÂ AÇIK (QA r2'de tekrar üretildi, viewer/qa/r2-senaryo/04-05). Çözüm planı J2'ye mesajla iletildi: baskıcıyı sahaya doğru 2,5 m öne koy, writeInput'ta 2,2 m dışlama, bekleyen tackle/slide'ı sil. Önceki not: son adımda düzeltildi sanılmıştı. Kaleci topu tutarken (`role kaleci`, top y>0,3) AI ayakta ya da kayarak müdahaleye girmiyor, 2,2 m'de baskı yapıyor. Tek tohumluk koşuda kaleciye müdahale temas kaydında görünmedi, ama aynı koşuda 9 kart çıktı ve nedenine bakılmadı. QA senaryosuyla (`qa/r1-mac`) yeniden doğrulanmadı.
5. İnsan penaltı kullanıcısıyken K'nın yedek vuruşu yok (K'nın kararı); taklit sürücü topa yürümezse maç takılır.

## Sıradaki işler (öncelik sırasıyla)
1. **İnsan takım arkadaşlarına destek:**
   - Pres altındaki insana yakın destek açısı (topun geldiği tarafa çapraz geri, 5–7 m), "üçüncü adam" koşusu.
   - Gösterge çizimini bağla. I'nin önerisi: halka karakter katmanında, ayak altında çizilsin (`Characters.tsx` içindeki mevcut kontrol halkasının yanına, `set.ring`). passHints'te q>0,5 olan en iyi bir-iki arkadaş, opaklık q'ya bağlı. Bu işi I2-anim'e yaz, F2-kontrol'e bilgi ver.
   - `ai-human.mjs`'teki sürücüyü daha insansı yap (koşu hızında sür, boşta pas ver) ki ölçüm anlamlı olsun.
2. **Zorluk farkı:** Kolay rakipte kaleci daha belirgin hata yapsın (yanlış köşe), zorda baskı tetikleyicileri (geri pas, kötü ilk dokunuş) olsun. Her seviyeyi `ai-human.mjs` ile 3+ tohumda raporla.
3. **F'nin yeni savunma aksiyonlarını kullan (jockey/müdahale):** Kullanıcı top sürme, jockey ve müdahaleyi çok kötü buluyor. F2'nin locomotionApi'sinde yeni aksiyon ya da animasyon (jockey duruşu, gecikmeli müdahale) varsa baskı yapan oyuncu onları kullansın:
   - taşıyıcının 1,5–2 m önünde yan duruş;
   - top ayaktan açılınca müdahale;
   - arkadan asla (top koruyan rakibe yanından dolan).

## F'nin son değişiklikleri (devirden sonra geldi, J2'ye iletildi)
- ACCEL 20, DECEL 32, TURN_RATE 16. brain.ts'teki `runTime` (ACC=7) güncellenmeli; pas eşiklerini yeniden ölç.
- Jockey: `game.inputs[id].jockey = true`. Baskıcı taşıyıcıya 3 m içindeyken kullanılsın.
- Tackle: 0,22 s atılma, menzil 1,3–1,7 m, ıska kilidi 0,58 s. Slide: 3,5 m, ıska kilidi 1,55 s, kırmızı kart riski.
- F'nin ölçümü: pas %90/76 ve %91/76, faul 5.

## Tuzaklar
- Tek maç varyansı çok büyük (pas sayısı 16–63). Karar vermeden önce 6 tohum ortalaması al; davranışları tek tek kapatıp karşılaştırmak, toptan ayardan çok daha bilgilendirici.
- Başsız testte K'da `rules.start()` çağrılmazsa maç 'setup'ta takılır. Node'da `location` yok: `ai-env.mjs` ilk import olmalı.
- Ölçüm hataları: aşırtma inişini 1/30 s örneklemeyle ölçme (sekmeyi kaçırır, 1/240 s freeStep kullan); niyeti bayat kayıttan değil gerçek `action.aim`'den al.
- F'nin `fromBehind` ölçütü mesafeye değil, müdahalecinin hareket yönü ile kurbanın bakışı arasındaki açıya bakar. Top koruyan rakibe arkadan girmek faul sayılır.
- Paralel olmayan itiş 'body' teması sayılır ve faul olur; omuz mücadelesi yalnız gerçekten paralel koşuda yasal. Topa yarışırken çarpışma kaçınmasını tamamen kapatmak (`duel`) faulü 2 katına çıkarmıştı.
- Kaleci ve duran toplarda 3 s kuralı: süreyi oyun akarken say (oyun dururken kaleci topu tutmaya devam edebiliyor).
- `aiStats` ve `hintDbg` yalnız ölçüm içindir; kare başına ayırma (allocation) eklememeye dikkat (AI ~0,05 ms/kare).
