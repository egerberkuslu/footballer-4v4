# Savunma ve kaleci tasarımı (FIFA/EA FC karşılaştırması)

Tarih 2026-10-06. Salt araştırma ve tasarım; kod değişmedi. Satır numaraları `viewer/src` altında, bu tarihteki ağaca göre.

## 1. Kaynaklı FIFA/EA FC savunma mantığı

| Mekanik | EA'daki karşılığı | Kaynak |
|---|---|---|
| Contain / jockey | "Contain: Cross (Press and Hold)", "Running Jockey: L2 + R2" | EA resmi FIFA 22 PS4 kontrolleri [1] |
| İkinci adam baskısı | "Teammate Contain: R1 (Press and Hold)" | [1]; FC 27'de YZ arkadaş biraz daha uzaktan markaj yapıyor [5] |
| Ayakta müdahale | "Tackle/Push or Pull (when chasing): Circle", "Hard Tackle: Circle (Press and Hold)" | [1] |
| Kayarak müdahale | "Sliding Tackle: Square", "Quick Get Up (after slide tackle): Square" | [1] |
| Temizleme | "Clearance: Circle", "Technical Clearance: R1 + Circle" | [1] |
| Omuz | "Shoulder Challenge/Sealout: Circle" | [1] |
| Kafa/vole ile pas | Pas tuşu "Ground Pass/Header", şut tuşu "Shoot/Volley/Header": havadaki topta aynı tuş bağlama göre kafa ya da vole olur | EA resmi FIFA 22 PC kontrolleri [2] |
| Top kesme (interception) | FC 26: kesmede "deflection control", seken top takım arkadaşına ya da tehlikeden uzağa gider. Engellenen şut da tehlikeden uzağa gider | EA FC 26 Pitch Notes [3] |
| Ayakta/kayarak müdahale sonucu | FC 26: müdahaleden sonra top daha çok takım arkadaşına gider; arkadan müdahale zayıflatıldı; art arda müdahaleye gecikme cezası geldi | [3] |
| Kaleci ileri çıkış | "Rush Goalkeeper Out: Triangle (Press and Hold)"; "Goalkeeper Cross Intercept: Triangle + Triangle (Press and Hold)" | [1] |
| Kalecinin elindeki top | "Drop Kick: Circle/Square", "Throw/Pass: Cross", "Drop Ball: Triangle", "Driven Throw/Kick: R1 +" | [1] |
| Kaleciyi elle oynatma | "Move Goalkeeper: R3 (Press and Hold) + Right Stick", "GK Cover Far Post: R3" | [1]; FC 26 Be-A-Goalkeeper modunda sağ çubukla dalış yönü, ortada yumruk ya da tutma seçimi, "Reaction Saves" var [3] |
| Kaleci konumlanması | FC 26 YZ kalecisi pekiştirmeli öğrenmeyle konumlanıyor; açıyı daha iyi kapatıyor (kurtarış ve tutma anlarında devre dışı) | [3] |
| Kurtarış türleri | FC 26 "Deflection Control": çelinen topların çoğu auta, takım arkadaşına ya da boş alana gider | [3] |
| Rush-to-contain (çift dokunuş) | Kaleci depar atıyor, rakibe yaklaşınca yavaşlıyor | Üçüncü taraf rehber [4]; EA kaynağıyla **doğrulanamadı** |
| Otomatik oyuncu değiştirme, otomatik kafa/blok ayarları | Oyun ayarlarında var olduğunu hatırlıyorum | **Doğrulanamadı** (bu turda resmi kaynak bulunamadı) |

Öncelik sırası (jockey > ayakta müdahale > kayma) üçüncü taraf rehberlerde ortak [4][6]. Resmi bir EA metni değil.

## 2. Bu oyundaki durum

| Mekanik | Durum | Kanıt |
|---|---|---|
| Jockey (E basılı, RB) | VAR | `control/MatchControl.tsx:194-219,443`; hareket `control/locomotion.ts:1039-1074`; YZ `ai/brain.ts:1125-1127`, `340-358` |
| Ayakta müdahale (E dokunuş) | VAR | `locomotion.ts:321-326` (topun 0,22 s sonraki yerini hedefler, satır 279-285), çözümü `474-549` (önden alınca top müdahale edende kalır, yandan dürtülür, kayma olasılığı var) |
| Kayarak müdahale (E E) | VAR | `MatchControl.tsx:197-199`, `locomotion.ts:551-593`; tackle'dan slide'a yükseltme `1367` |
| Baskı / ikinci adam | KISMEN | Kol FIFA düzeninde "press" basılıyken taşıyıcıya yürüyüp jockey yapıyor (`MatchControl.tsx:353-363`). "teamPress" yalnız oyuncu değiştiriyor, YZ'ye ikinci adam baskısı API'si yok (yorum satırı 348) |
| Oyuncu değiştirme (Q) | KISMEN | Q topa en yakın arkadaşa geçiyor (`MatchControl.tsx:185-189`, `95-107`); pas yolundaki oyuncuya geçme yok. Savunmada otomatik değiştirme yok (`264-275` yalnız top arkadaşa geçince) |
| Pas arası kesme | KISMEN, otomatik | Top 0,55 m içinde ve göreli hız 13 m/s altındaysa otomatik ilk dokunuş (`locomotion.ts:851-876`, `TRAP_DIST` `locomotionApi.ts:74`). Tuşla "uzanıp kes" yok. Kesmede top yönlendirmesi yok, yalnız iyi/kötü dokunuş (`763-809`) |
| Yerden gelen topa tek dokunuş pas (K) | KISMEN | Topsuzken K de bir `pass` aksiyonu başlatıyor. Temas 0,22 s'de top ayağa 0,9 m içinde ve y<0,7 ise ilk vuruş pası olur (`locomotion.ts:436-465`). Tampon yok; erken basılırsa boşa gidiyor ve tekrar denenmiyor |
| Yerden topa vole/şut (Boşluk) | KISMEN | Aynı kural (`436-451`) |
| Kafa | KISMEN, yalnız şut tuşunda ve kaleye | `MatchControl.tsx:494`: top y>1,1 ve 1,2 m içindeyse Boşluk kafaya döner, hedef her zaman **kale**. Sim'de erişim 0,9 m (`HEADER_REACH`), 1,2 m ile tutarsız. K ile kafa pası **YOK**: havadaki topta K, `pass` aksiyonu y<0,7 koşuluna takılıp boşa gidiyor (`locomotion.ts:441`) |
| Vole (0,7 m ≤ y ≤ 1,1 m) | YOK | Pas/şut y<0,7, kafa y>1,1 istiyor; aradaki bant hiçbir tuşla vurulamıyor |
| Temizleme | YOK (insan), KISMEN (YZ) | İnsan için tuş yok. YZ yalnız topla sıkışınca uzağa lob atıyor (`ai/brain.ts:547-553`) |
| YZ savunma kafası, hava düellosu | YOK | `ai/` altında `'header'` aksiyonu hiç kurulmuyor (grep); kafa yalnız insan girdisinde |
| Kafa ve kalecinin havadaki temas cezası | VAR | `locomotion.ts:389-391` (`high` bayrağı) |
| Kaleci konumlanması | VAR | `ai/brain.ts:735-743` (kale-top doğrusunda 0,4-2,6 m derinlik), seviye hatası `756-761`, yanal hız sınırı `747` |
| Kaleci ileri çıkış / 1'e 1 | VAR | 11 m içinde açıyı daraltma, 4 m'de yavaşlayıp `keeper-spread`, top açılınca ayağa dalış (`brain.ts:889-906`, `locomotion.ts:739-745`) |
| Süpürücü kaleci | KISMEN | Sahipsiz top yalnız **ceza alanı içinde** ve rakipten önce ulaşırsa çıkıyor (`brain.ts:875-888`). Alan dışına süpürme yok |
| Şuta dalış | VAR | Tahmin + tepki süresi + `diveReachable` (`brain.ts:847-869`), plan ve sonuç `sim/keeperDive.ts` (`locomotion.ts:337-359`, `676-693`) |
| Tutma / yumruk / çelme | VAR | Dalışta plan sonucu `parry` ya da tutma (`locomotion.ts:681-692`); ayakta 19 m/s üstü yumruk, 32 m/s üstü kapsülden seker (`712-723`, `locomotionApi.ts:84-86`). Çelmede top yönü planda; "tehlikeden uzağa" kuralı doğrulanmadı |
| Orta kapma (high claim) | KISMEN | Top ele girerse `keeper-catch-high` (`locomotion.ts:727`), fakat kaleci ortaya **koşmuyor**: `onTarget` olmayan havadaki topta özel karar yok |
| Geri pas eli yasağı | VAR | `locomotion.ts:658-661` |
| Atış ve vole ile oyun kurma | VAR | YZ `brain.ts:767-808`, insan K/Z/Boşluk `locomotion.ts:309-315`, `407-433` |
| Kaleciyi elle kontrol | KISMEN | Q kaleciyi seçebiliyor (en yakınsa); seçilince YZ kaleci beyni duruyor (`brain.ts:1626,1633`), ama insan için **dalış tuşu yok** (`MatchControl.tsx`'te `dive` yok); yalnız otomatik el alanı (`keeperSave`) çalışıyor |
| İnsan kaleci için ileri çıkış tuşu | YOK | |

## 3. Uygulama planı (etkisi yüksek ve riski düşük olandan başlayarak)

Ortak doğrulama: `npx tsc -b`, `npx -y tsx scripts/rules-test.mjs` 176/0, QA senaryoları (O-qa) ve maç sayfasında elle tetikleme. "Kural/VAR/ağ/sim" sütunu bu katmanlara dokunma gereğini gösterir.

| # | Davranış | Tetik | Dosya / fonksiyon | Risk | Animasyon | Boyut | Kural/VAR/ağ/sim |
|---|---|---|---|---|---|---|---|
| 1 | **Bağlamsal K ve Boşluk**: havadaki topta (y>1,1) K **kafa pası** olur (hedef `passTarget`), Boşluk eskisi gibi kaleye kafa vurur. 0,7-1,1 m bandında K vole pası, Boşluk vole şutu olur | Tuş | `MatchControl.tsx` 483-524 (karar dalı), `locomotion.ts` `runAction` `header` dalına pas hedefi; vole için `pass/shoot` dalında y<0,7 sınırını 1,1'e açıp dikey hızı hesaplamak | Düşük. Offside zaten `header`'ı sayıyor (`rules/engine.ts:88`). Kural motoruna dokunmaz | `header` klibi var (`anim_pass.json`: header, header_jump). Vole klibi **yok**; ilk sürümde `kick` katmanı kullanılır, mocap sonra | S | Yok |
| 2 | **Girdi tamponu (FIFA'daki erken basış)**: topsuzken K/Boşluk/E en çok 0,6 s bekletilir, top temas penceresine girince aksiyon başlar. Böylece "top gelirken bas" doğal çalışır, boşa sallama kalkar | Tuş | `MatchControl.tsx` (`queuedShot` benzeri yeni kuyruk, 445-468 yakını), varış tahmini için `ai/predict.ts` | Düşük-orta. Tekrar ve ağ (misafir girdisi) etkilenmez, çünkü yalnız yerel karar zamanını değiştiriyor | Mevcut klipler | S-M | Yok |
| 3 | **Temizleme**: savunma yarısında topsuzken Shift+K (ya da kolda ayrı tuş) yere/havaya göre ayak ya da kafa ile uzağa, kenara doğru yüksek vuruş. YZ: tehlikeli bölgede sahipsiz topa ilk varan savunmacı da temizler | Tuş + YZ | `MatchControl.tsx` yeni `want`, `locomotion.ts` `runAction` içinde `lob` ya da `header` dalına `clear` bayrağı (yeni ActionType eklemek `game/types.ts` ister, brife göre başka ajanın alanı: istek olarak raporla). YZ: `brain.ts` 547-553 genellemesi | Orta. `types.ts` değişirse ağ serileştirmesi (L-mp) kontrol edilmeli | `kick`/`header` yeter | M | `types.ts` (ağ şeması) |
| 4 | **YZ savunma kafası ve hava düellosu**: havadaki topa (orta, uzun top) iki takımdan en yakın oyuncu `header` ile karşılar. Savunmacı uzağa ve kenara, hücumcu kaleye ya da arkadaşa vurur | Otomatik (YZ) | `brain.ts` `decideTeam` içinde havadaki top dalı (predict ile iniş noktası), `setAct(b,'header',…)` | Orta. Temas `high` bayrağı ile faul sayısı artabilir; QA ile faul/maç oranı ölçülmeli | `header`, `header_jump` var; omuz itişi `shoulder` var | M | Yok (mevcut kural motoru `high` temasını zaten işliyor) |
| 5 | **Tuşla pas kesme / uzanma**: E dokunuşunda top sahipsizse ve pas yolundaysa ayakta müdahale yerine topa doğru 1,2 m uzanıp kesme. Kesilen top FIFA 26'daki gibi yakın arkadaşa ya da ileri sektirilir | Tuş | `MatchControl.tsx` 519-524 (sahipsiz top dalı), `locomotion.ts` `tackle` dalı 508-534 (sahip yokken yönlendirme hedefi arkadaş) | Düşük. Temas kodu değişmeden kalır | `tackle_reach`, `tackle_stretch` klipleri var | S | Yok |
| 6 | **Pas yolundaki oyuncuya otomatik geçiş**: rakip pas verince insan kontrolü alıcıya en hızlı varan arkadaşa (interceptTime) geçer; Q ise topa en yakın yerine "topa ilk ulaşacak" oyuncuyu seçer | Otomatik + Q | `MatchControl.tsx` 185-189, 264-275; `brain.ts` `interceptTime` dışa açılır | Düşük. Çok oyunculu kilitte (`lockedPlayer`) devre dışı kalmalı | Yok | S | Yok |
| 7 | **İkinci adam (teammate contain)**: R tuşu basılıyken YZ'de en yakın ikinci savunmacı taşıyıcıya çıkıp jockey yapar | Tuş | `brain.ts` 972-1005 (presser seçimi) için insan bayrağı; `MatchControl.tsx` 347-351 | Düşük-orta. YZ'nin markaj dengesi bozulabilir (boşta adam) | `jockey` var | S-M | Yok |
| 8 | **Kaleci orta kapma ve süpürme**: kaleye gitmeyen havadaki orta ceza alanı (6 m-11 m) içine inecekse kaleci iniş noktasına koşar, `keeper-catch-high` ya da yumrukla alır. Alan dışındaki boş topa süpürme ise ayakla uzaklaştırma olur | Otomatik (YZ) | `brain.ts` `keeperThink` 873-888 (orta dalı eklenir), `locomotion.ts` `keeperSave` el alanı `inHands` | Orta. Kalecinin tuttuğu top 3 sn kuralını tetikler (zaten var); kalecinin havada temas cezası `high` | `catch-high` klibi var; sıçrayarak yumruk klibi **yok** (`keeper-punch` parametrik) | M | Yok |
| 9 | **İnsan kaleci**: kaleci seçiliyken Boşluk dalış (fare/çubuk yönüne), E basılı ileri çıkış, çift E açıyı daraltarak çıkış; ayrı bir "kaleciyi seç" tuşu | Tuş | `MatchControl.tsx` (kaleci dalı), `locomotion.ts` `startAction('dive')` zaten insan girdisini kabul ediyor (`planDive`, aim.y'den yükseklik) | Orta. `planDive` sonucu olasılıksal; insan zamanlamasına göre ayarlanmalı | Dalış klipleri tam (`anim_keeper.json` 16 klip) | M | Sim (`sim/keeperDive.ts` ayarı gerekebilir) |
| 10 | **Çelme yönü kuralı**: parry ve yumrukta top kale önünden uzağa, kenara ya da korner çizgisine; müdahalede top arkadaşa | Otomatik | `sim/keeperDive.ts` parry vektörü, `locomotion.ts` 715-717 | Orta. Kurtarış ve gol istatistikleri değişir (bisect geçmişi var: `locomotion.ts:696`) | Yok | S | **Sim fiziği** |

Kural motoru (`rules/engine.ts`) ve VAR'a dokunan madde yok. Madde 3 `game/types.ts`'e yeni ActionType eklerse ağ şemasına (L-mp) dokunur; bundan kaçınmak için `pass/lob` üstüne `clear` bayrağı tercih edilir. Madde 9 ve 10 `sim/keeperDive.ts`'e dokunur.

Önerilen ilk dalga 1, 2, 5 ve 6. Hepsi S büyüklüğünde, mevcut klipleri kullanıyor ve Ege'nin isteği olan "top gelirken tuşa basınca kafa/vole/kapa top ile pas ya da yerden müdahale" bu dört maddeyle karşılanıyor. Eksik mocap klipleri vole (yan vole dahil), temizleme vuruşu, sıçrayarak yumruk ve hava düellosunda omuz sıçrayışı.

## Kaynaklar
1. EA, FIFA 22 Basic Controls for PS4 (resmi): https://www.ea.com/able/resources/fifa/fifa-22/ps4/basic-controls
2. EA, FIFA 22 Basic Controls for PC (resmi): https://www.ea.com/able/resources/fifa/fifa-22/pc/basic-controls
3. EA, FC 26 Pitch Notes Gameplay Deep Dive (resmi): https://www.ea.com/games/ea-sports-fc/fc-26/news/pitch-notes-fc26-gameplay-deep-dive
4. Magic Game World, EA FC 26 rush goalkeeper (üçüncü taraf): https://guides.magicgameworld.com/ea-fc-26-how-to-rush-the-goalkeeper-save-like-a-pro/
5. EA, FC 27 Pitch Notes Gameplay Deep Dive (yalnız arama özeti okundu, sayfa açılmadı): https://www.ea.com/games/ea-sports-fc/fc-27/news/pitch-notes-fc27-gameplay-deep-dive
6. Operation Sports, EA FC 25 defending (üçüncü taraf): https://www.operationsports.com/ea-fc-25-how-to-defend-like-a-pro-explained/

Not: EA'nın FC 25 kontrol sayfası (ea.com/.../fc-25/controls) 404 döndü. Bu yüzden düğme listesi FIFA 22 resmi sayfasından alındı; FC 25/26'da bazı düğmeler değişmiş olabilir.
