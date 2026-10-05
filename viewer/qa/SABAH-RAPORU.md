# SON DURUM (koordinator, 06:50): OYUN YAYINDA
Canli: https://egerberkuslu.github.io/footballer-4v4-play/ (public depo yalniz derlenmis site). Kaynak depo egerberkuslu/footballer-4v4 PRIVATE.
Asagidaki O2 raporu 06:40 oncesi turlara dayanir; ASAGIDAKI MADDELERIN DURUMU:
- COZULDU: maç sonu 'Yeniden oyna / Ana menu' (K2, rules-test 176, mp-ft-test 10/10); mavi/turuncu forma lekeleri (kok neden v2/v3 govdelere ana atlas baglanmasiydi, I2+E2 duzeltti); AI endirekt FK dogrudan sut (J2, 20/20 pas); VAR hakem monitor yani durusu ve kadraj; acik gol karti birimi.
- YENI (bu raporda test edilmemisti, sahipleri kendi testlerini yapti, gercek cihazla degil): kirmizi kart = 30 sn ceza, falso (, . / tekerlek, onizleme egrisi), kaleci dalis sistemi (B2 keeperDive + I2 animasyon), PS4/DualSense kol destegi + Kol Ayarlari, kaleci/hakem/forma modelleri v2-v4.
- ENTEGRASYON TURU (koordinator, final kod): tsc temiz, Firefox temiz, 90 s mac pageerror/NaN/takilma 0, 9/9 senaryo gecti (tac, korner, kaleci 3 s x2, ofsayt, penalti, elle VAR, onden kayma, net aut), rules-test 176/0, sim-test temiz. Canli site: 4xx/5xx yok, 60 fps, hata yok.
- GERCEKTEN ACIK: gercek DS4/DualSense ile hicbir sey denenmedi; PeerJS bulutu (TURN yok) kati aglarda baglanamayabilir, gercek Pages alan adinda cok oyunculu denenmedi; Firefox'ta cok oyunculu denenmedi; ilk acilis ~56 MB indirme; hakemin ince sac cizgisi ve ense cevresinde kucuk deri araliklari (kozmetik); AI-AI maclarda gol 4-8/mac (hedef bandinda), AI ayakta mudahalede topu alma ~%14-31.
- Denge: ayakta kurtarma zari yalniz INSAN sutunda acik (AI-AI'da acikken gol 2x siserdi).

---
# SABAH RAPORU (O2-qa, 06:40 durumu; sabah 08:00'de son kod değişikliği yoksa geçerlidir)

Kapsam: gerçek GPU başsız Chrome 1080p, Firefox sağlık kontrolü, senaryo betikleri (`scripts/qa-*.mjs`, `scripts/qa-round.sh`). Kanıtlar `viewer/qa/r*/` altında, tur raporları `qa/rapor-*.md`.

## Çalışanlar (doğrulandı)
- `npx tsc -b` temiz. Firefox antrenman ve `?mode=mac`: pageerror yok, bağlam kaybı yok.
- 60 s ve 90 s maç koşuları, 420 s AI-AI izleme: pageerror 0, NaN 0, takılma 0, top boşta kalma 0.
- Yükleme ekranı (adım adım ilerleme, "Oyna" yaklaşık 6 s) ve "Menü" → "Tek oyunculu maç" (perde 1,3 s, santra) temiz.
- Senaryolar (topu belirli yere koyup gerçek kural+AI+klavye/fare akışı): taç (doğru takım, VAR yok), korner, penaltı (insan kullanır), net aut → kale vuruşu, ofsayt (düdük, endirekt serbest vuruş, VAR yok; betik AI müdahalesine bazen takılır), insan kaleci 3 s (düdük 3,0-3,2 s, "KALECİ 3 SANİYE"), AI kaleci 3 s içinde bırakıyor, önden topa kayma kırmızı değil, gol sonrası elle VAR (X): hakem dinler, 1,9 s'de monitöre varır, ters koşu yok, karar sonrası oyun devam.
- Otomatik kıl payı VAR gerçek maçta tetiklendi (−3,8 cm, "gol değil", 12,7 s). G'nin kayıt tabanlı testinde +3 / −3 cm doğru, +9 cm VAR yok, taç çizgisi ve direk dışı VAR yok.
- Top sürme: sprint 7,4 m/s, top kaybı yok, 180° dönüş 0,33 s (sole-stop + drag-back), durma yaklaşık 0,4 s; his 4/5. Sprintte top 1,5-1,6 m önde.
- Faul oranı ayakta müdahalede düzeldi (önce 23 temas / 12 faul; sonra 24 müdahale / 4 faul).
- Görsel: saç artık renkli (VAR monitörü aşırı yakın planda kart kenarları kıymık gibi, 3/5), saha çizgileri sürekli, seyirciler renkli formalı, VAR kulübesi, kaleci, hakem makul.
- Performans (makine sakinken): boş sayfa referansı 58 fps, en kötü %1 32,6 ms; uygulama yayın kamerasında 58,6 fps, %1 21,7 ms, diğer kameralarda %1 32-38 ms. Uygulamanın boş sayfaya eklediği maliyet yaklaşık 0-5 ms; kalıcı takılma yok. Kale arkası/şutçu arkası kamerada 2,8-2,9 M üçgen (yayında 1,6 M).

## Nasıl oynanır
Menüden "Tek oyunculu maç" (ya da üstte "Maç (M)"). WASD/oklar hareket, Shift sprint, sol tık ya da Boşluk basılı tut + bırak şut (tekerlek ya da , / . falso), sağ tık ya da K pas, Z + pas/şut aşırtma, E müdahale (basılı tut jockey), E E hızlı çift dokunuş kayarak, Q oyuncu değiştir, X elle VAR, V serbest kamera, C kamera, T yavaş çekim, H pas halkaları, F3 geliştirici paneli, "?" yardım. Duran toplarda insan 3 sn içinde kullanmazsa top rakibe geçer.

## Açık sorunlar (önem sırası)
1. (K2, düşük-orta) Maç sonunda yalnız "MAÇ SONU" bandı kalıyor, "Yeniden oyna / Ana menü" seçeneği yok (tek çıkış sağ üstte küçük Menü). fulltime'da "AVANTAJ" etiketi DOM'da duruyor. Devre arası bandı soluk yakalandı (opaklık/zamanlama kontrolü).
2. (J2/B2, düşük güven) AI-AI izlemede takım 0 / takım 1 gol dağılımı 2-10 (şut sayısı benzer): yön yanlılığı olabilir.
3. (J2, orta) AI endirekt serbest vuruşta kaleye doğrudan şut çekiyordu (kale vuruşu döngüsü); bu sürümde yeniden doğrulanmadı.
4. (N2/I2) Mavi formada yakın planda lekeler/tırtıklı kenar, turuncu kaleci formasında koyu bloklar bildirildi; son turlarda yeniden bakılmadı, kapanmış kabul edilmemeli.
5. (M2/L2, tasarım sorusu) "Oyna"dan sonra ana menü otomatik açılmıyor (mp.screen başlangıç 'none'), oyun antrenmana düşüyor, Menü düğmesi var.
6. (G2, kozmetik) Açık golde VAR kararı "+0,42 cm" gibi pay gösteriyor; monitör kamerasında hakem ekranı kısmen kapatıyor.
7. (Bilgi) Başsız ortamda açılış karelerinde 0,4-1 s'lik duraklamalar var (BOOT ekranı yok, ön ısıtma çalışmıyor); gerçek kullanıcıda yükleme ekranı bunu karşılıyor, ancak gerçek GPU'da yükleme ekranı sonrası ilk 20 s ölçülmedi.

## Doğrulanamayanlar
- Otomatik kıl payı VAR'ın gerçek GPU'da şutla sahnelenmesi (yalnız kayıt tabanlı test ve bir doğal tetikleme).
- Çok oyunculu (L2) akışı bu turlarda test edilmedi.
- Kart sonrası atılan oyuncunun yürüyerek çıkışı ve "player-return" süresi yalnız olay düzeyinde görüldü, görsel kare dizisi incelenmedi.
- Gamepad (yeni gamepad.ts/GamepadSettings) test edilmedi (başsız ortamda cihaz yok).

## Betikler
`scripts/qa-round.sh <etiket>` (tsc + Firefox + 90 s maç + senaryolar), `qa-match.mjs` (maç/izleme, `--half`, `--watch`), `qa-scenarios.mjs`, `qa-vartrace.mjs`, `qa-dribble.mjs`, `qa-boot.mjs`, `qa-menu.mjs`, `qa-fulltime.mjs`, `qa-keeper.mjs`, `qa-perf.mjs`, `qa-baseline.mjs`, `qa-visual.mjs`. Hepsi `scripts/run-browser.sh` ile çalışır.
