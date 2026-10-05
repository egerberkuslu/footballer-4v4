# QA turu 3 (01:45-02:10) O2: saglik, mac, performans, gorsel

Not: handoff/O.md gelmedi (20 dk beklendi), mevcut qa/ raporlarindan devam ettim. Makine yuku ~15-20 (diger ajanlar), fps/en kotu %1 olcumleri bu yuzden kotumser olabilir.

## Saglik
- tsc -b temiz. Firefox antrenman + ?mode=mac: pageerror YOK, context kaybi yok (qa/r3-ff).
- Chrome mac 120 s: pageerror 0, NaN 0, takilma 0.

## Bulgular (onem sirasi)
1. **(J2, orta) AI endirekt serbest vuruşta dogrudan kaleye sut cekiyor, sonsuz dongu.** qa/r3-mac/sonuc.json t=75-118 s: kale vurusu -> (insan kaleci tutup 3 s asti, bot kaleciyi birakmiyor) keeper-hold -> rakibe endirekt FK -> taker 5 dogrudan 'shoot' -> 'indirect' duduk -> kale vurusu -> ... 5 tur ayni. AI endirekt FK'da once pas vermeli (ya da K2 endirekt vurusta dogrudan golu es gecmeyip sut sayisini sinirlamali).
2. **(N2/I2, orta-gorsel) Mavi forma yakin plandaki lekeler.** qa/r3-gorsel/yakin-topcu-0.png: kalca/sort kenarinda beyazimsi leke, sort ve corap ucunda tirtikli kenar (corap kaftan sonra ucuk). Gercek zamanli kumas kenarlari.
3. **(Performans, bilgi)** 1080p GPU Chrome: ort 57-58 fps, en kotu %1 38-41 ms (hedef <=20), >50 ms kare 7-10 adet/20 s, max 90-118 ms (qa/r3-perf). Kale arkasi/sutcu arkasi kameralarda ucgen 2.7-2.9 M (yayinda 1.55 M). Yuk 20 iken oldugu icin kesin degil; sakin makinede tekrar olcecegim. Acilis: ilk 2 s'de 427 ms ve 300 ms kareler (shader derleme).
4. **(bilgi)** Kale vurusu insan icin dogru calisiyor: faz 0.6 s sonra 'play', kaleci tutuyor, K ile 1.1 s'de keeper-throw, kontrol savunmaciya geciyor (qa/r3-keeper). Onceki "insan kaleci 3 s" belirsizligi botun kaleciyi oynamamasindan; oyun hatasi degil.
5. **(F2, kozmetik)** dev=1 modunda tribun "cam kutu" gibi gorunuyor (collider telleri); dev disinda normal, hata degil.

## Iyi
Yakin kaleci, hakem, seyirci, saha cizgileri, ag, gol sonrasi santra akisi, VAR kulübesi gorsel olarak makul. Gol/aut/kale vurusu/faul/kart akislari 120 s'de hatasiz.

## Siradaki tur
Sakin makinede perf; sprintle surme/180 derece donus kare dizileri; ofsayt/VAR otomatik kil payi; devre arasi ve yukleme akisi.
