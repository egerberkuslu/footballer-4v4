# Takımlara pekiştirmeli öğrenme + sürü zekâsı ile futbol öğretmek (plan)

Amaç (Ege): 4'e 4 takımlar, elle yazılmış yapay zekâ yerine, pekiştirmeli öğrenme (RL) ve sürü zekâsı (swarm intelligence) ile takım olarak futbol oynamayı öğrensin. Bu belge tasarım taslağıdır; kod henüz yok.

## 1. Ortam (en önemli karar)

**Öneri: oyunun kendi simülasyonunu başsız (headless) kullan.** `viewer/src/sim` (top, kaleci, çarpışma), `control/locomotion`, `rules` zaten TypeScript ve görüntüsüz çalışıyor (`sim-test` 200 şutu ~0,9 ms/kare). Böylece öğrenilen politika, oyunda oynanan fizikle birebir aynı dünyada eğitilir (sim-to-real boşluğu yok).

- Node işçi süreçleri (8 çekirdek) N=64–128 paralel maç yürütür; ağ XPBD fiziği eğitimde kapalı (en pahalı kalem), yalnız top-ağ çizgisi kuralı.
- Python (PyTorch, RTX 3060) eğitimcisi gözlem/eylem partilerini paylaşılan bellek ya da yerel soket ile alır.
- Karar sıklığı 10 Hz (eylem tekrarı 6 kare). Tahmin: 1e8–1e9 karar adımı birkaç saatte.
- Alternatif (reddedilen): Python/JAX'a yeniden yazım. Hızlı ama oyunla uyumsuzluk riski ve çifte bakım.

## 2. Gözlem ve eylem

- **Gözlem (her ajan, benmerkezli):** kendi konum/hız/yön, topun göreli konum/hız, 3 takım arkadaşı ve 4 rakip (göreli konum/hız), kale yönleri, faz/duran top bayrakları, kalan süre, ceza durumu. Permütasyon-değişmez (set) giriş.
- **Eylem:** sürekli hareket yönü (2), sprint (ikili), ayrık eylem {yok, pas(k=1..3), şut, aşırtma, müdahale, kayma, jockey}, şutta nişan/güç ve falso (sürekli, 3). Kaleci rolü koşullu aynı ağ ya da ayrı politika.
- Oyundaki `PlayerInput` arayüzüne birebir eşlenir: eğitilen politika `ai/brain.ts` yerine takılır.

## 3. Sürü zekâsı bileşeni

"Sürü" burada: merkezi komuta olmadan, yerel gözlem ve sınırlı iletişimle yapılan dağıtık karar.

- **Dağıtık uygulama, merkezi eğitim (CTDE):** MAPPO, parametre paylaşımı, merkezi kritik (tam durum), politika yalnız yerel gözlem + komşu mesajları.
- **İletişim = grafik sinir ağı:** ajanlar düğüm, mesafe eşiği (örn. 10 m) içindekiler kenar; 2–3 tur mesaj geçişi (dikkat tabanlı). Kenar yarıçapı ve mesaj boyu ablasyon değişkeni (iletişim yok / var).
- **Popülasyon katmanı (sürü):** PBT ya da evrimsel strateji ile farklı hiperparametre/ödül ağırlığı taşıyan politika popülasyonu, çapraz eşleşme (self-play ligi), en iyiler kopyalanır. İsteğe bağlı: sürü benzeri "feromon" haritası (paylaşılan boşluk haritası) ek giriş olarak.

## 4. Ödül ve müfredat

- Seyrek: gol +1 / yenen gol −1. Şekillendirme (zamanla sönümlenir): topa yaklaşma, top ilerlemesi, isabetli pas, top kapma, faul cezası, kırmızı kart cezası.
- Müfredat: 1v0 şut → 2v1 → 3v2 → 4v4; sonra self-play ligi (geçmiş kontrol noktaları + el yazması yapay zekâ Kolay/Orta/Zor).
- Hile önleme: ödül yalnız kurallı davranışı teşvik eder (ofsayt, faul, 3 sn kuralları ortamda zaten uygulanır).

## 5. Deney geçerliliği (zorunlu disiplin)

Adil taban (el yazması AI seviyeleri, eşit gözlem erişimi), "önemsiz öğrenilebilirlik" tavanı (örn. yalnız-şut ajanı), güç analizli tohum sayısı (en az 5), ayarlar yalnız ara ölçütle, negatif sonuçlar kayıtta. Ölçütler: gol farkı, Elo (lige karşı), pas isabeti, topa sahip olma, koordinasyon (mesafe/yerleşim), iletişim ablasyonu (mesaj kapalı).

## 6. Oyuna geri bağlama

Eğitilen politika ONNX'e aktarılır, `onnxruntime-web` (ya da küçük MLP için saf TS) ile tarayıcıda çalışır: yeni zorluk seviyesi "Öğrenmiş takım" (menüde seçilebilir), Berberler ile Bakkallar arasında izleme modu, RL takımının kayıtlı maçları.

## 7. Kilometre taşları

| | İş | Çıktı |
|---|---|---|
| M0 | Başsız ortam + Gym benzeri API + hız ölçümü | adım/s, determinizm testi |
| M1 | 1v0 şut, 2v1 pas; MAPPO taban çizgisi | öğrenme eğrileri |
| M2 | 4v4 + GNN iletişim + self-play | el yazması AI'ya karşı galibiyet oranı |
| M3 | PBT/sürü katmanı + ablasyonlar | tez bölümü ve makale için tablolar |
| M4 | Oyuna entegrasyon ("Öğrenmiş takım") | demo ve video |

İzleme: wandb, tekrar üretilebilirlik: DVC (kullanıcının mevcut yığını).

## 8. Yöntem karşılaştırması ve yayın protokolü (akademik yayın hedefi)

Ege akademik yayın yapacak ve yöntemleri birbiriyle kıyaslamak istiyor. Bu yüzden tüm sayılar gerçek koşulardan gelir; hiçbir değer elle girilmez, uydurulmaz ya da seçilerek raporlanmaz. Negatif sonuçlar da raporlanır.

**Karşılaştırılacak yöntemler (aynı ortam, aynı gözlem bütçesi, aynı ortam-adımı bütçesi):**

| # | Yöntem | Rol |
|---|---|---|
| B0 | El yazması yapay zekâ (oyundaki Kolay/Orta/Zor) | öğrenmeyen taban |
| B1 | Davranış klonlama (B0'ı taklit) | denetimli taban |
| B2 | Klasik sürü sezgiseli: potansiyel alan / boids tabanlı biçim ve baskı (öğrenmeyen sürü) | "sürü zekâsı" klasik taban |
| M1 | IPPO (bağımsız PPO, iletişim yok) | bağımsız öğrenen |
| M2 | MAPPO (parametre paylaşımı, merkezi kritik) | CTDE standardı |
| M3 | MAPPO + GNN/dikkat iletişimi (önerilen) | önerilen yöntem |
| M4 | QMIX / VDN (değer ayrıştırma) | ayrık eylem karşılaştırması |
| M5 | MADDPG / MATD3 (sürekli eylem) | sürekli eylem karşılaştırması |
| M6 | Evrimsel strateji / PBT (popülasyon) | sürü benzeri evrimsel yol |
| M7 | M3 + PBT/self-play ligi | önerilen tam sistem |

**Ablasyonlar:** iletişim yok/var, iletişim yarıçapı (5/10/20 m), mesaj turu (1/2/3), merkezi kritik açık/kapalı, ödül şekillendirme açık/kapalı, gözlem gürültüsü, takım büyüklüğü genellemesi (3v3, 4v4, 5v5 sıfır-atış: GNN'nin permütasyon-değişmezliği avantajı), müfredat açık/kapalı.

**Ölçüm ve istatistik:**
- En az 5 (tercihen 10) bağımsız tohum, aynı hiperparametre arama bütçesi (eşit deneme sayısı), ayar yalnız ara ölçütle (yenen gol ve ödül), nihai testte tohumlar ayrı.
- `rliable` tarzı ölçüler: IQM, ortalama ve medyan, performans profilleri, bootstrap güven aralıkları (%95); tek koşu ya da en iyi tohum raporlanmaz.
- Tam turnuva (round-robin): Elo/TrueSkill ve α-Rank / Nash ortalaması; aynı çiftler için yer değiştirme (ev/deplasman) dengeli; gol farkı, galibiyet oranı, pas isabeti, topa sahip olma, yerleşim/mesafe ölçüleri, sömürülebilirlik (en iyi yanıt eğitimi ile).
- Hipotezler koşudan önce yazılır (ön kayıt): örn. H1 "iletişim 4v4'te gol farkını artırır", H2 "GNN politikası takım büyüklüğüne genellenir, MLP genellemez", H3 "PBT tohum varyansını azaltır".
- Önemsiz öğrenilebilirlik tavanı (yalnız-şut ajanı) ve el yazması tabana karşı adalet kontrolü şart.

**Dış doğrulama:** ortam bizim yazdığımız bir simülatör olduğu için yalnız kendi sonuçlarımız hakem için yetmez. İkinci bir ölçüt olarak Google Research Football (Kurach ve ark.) akademi senaryolarında (3v1 kaleciyle, hızlı hücum) M2/M3'ü çalıştırıp literatürdeki MAPPO sonuçlarıyla tutarlılığı doğrula. Atıflar gerçek makalelere karşı doğrulanır (litreview/OpenAlex; her atıf kontrol edilir).

**Tekrar üretilebilirlik:** sabit tohum, DVC boru hattı, wandb kayıtları, kod ve ortam sürümü yayınla; her tablo bir betikten üretilir.

## 9. Maç istatistikleri (her yöntem için aynı ölçüm hattı)

Simülasyon her maçta olay kaydı (event log) tutar; tüm istatistikler bu kayıttan betikle üretilir (elle girilen değer yok). Çıktı: maç başına JSON/Parquet, tablo ve şekiller `rl/analysis/` altında.

| Grup | Ölçüt |
|---|---|
| Sonuç | gol, gol farkı, galibiyet/beraberlik/mağlubiyet, Elo/TrueSkill |
| Şut ve xG | şut sayısı, isabetli şut, **xG** (beklenen gol), gol − xG (bitiricilik), şut başına xG, şut mesafesi ve açısı, baskı altında şut oranı |
| Pas | denenen ve başarılı pas, **pas isabeti (%)**, ileri/yatay/geri pas oranı, pas uzunluğu, ilerletici pas, kilit pas (şuta giden pas), pas ağı (kim kime) |
| Top hâkimiyeti | **topa sahip olma (%)**, bölgelere göre sahip olma, topu kapma ve kaybetme, topu kaptıktan sonra şuta kadar süre (geçiş hızı), PPDA (rakip pasına karşı savunma eylemi) |
| Takım yapısı | **takım arkadaşları arası ortalama/en küçük mesafe**, takım genişliği ve derinliği, ağırlık merkezi, biçim (şekil) tutarlılığı, ofsayt çizgisi yüksekliği, boşluk doldurma, ısı haritaları |
| Savunma/disiplin | müdahale sayısı ve başarısı, faul, kart, ofsayt, kurtarış yüzdesi |
| Koordinasyon (sürü) | oyuncular arası mesaj kullanımı (iletişim varsa), eşzamanlı hareket korelasyonu, rol çeşitliliği (rol dağılımı entropisi) |

**xG modeli:** simülasyonun kendi şutları üzerinde (mesafe, açı, top hızı, şut türü/falso, baskı, kaleci konumu, kalan süre) lojistik regresyon ve gradyan artırma ile eğitilir, ayrı doğrulama kümesinde kalibrasyon eğrisi ve log-loss raporlanır. Bu "sim-xG"dir; gerçek futbol xG'siyle karıştırılmaz ve öyle adlandırılır. Model sabit tutulur, tüm yöntemler aynı xG modeliyle değerlendirilir.

## 10. 11'e 11 ve rollü sürüm

Ege'nin isteği: bir sürümde 11'e 11, herkes kendi rolünde.

- **Parametrik saha ve kadro:** şu an saha 40×25 m ve 4'e 4 sabit (`pitch.ts`, kale boyu, ceza sahası, ofsayt, kural ayarları). Önce saha, kale, ceza sahası ve oyuncu sayısı yapılandırılabilir hâle getirilir (4v4, 5v5, 7v7 halı saha, 11v11), kurallar ve çizgiler ölçeğe göre türer.
- **Roller:** KL (kaleci), STP (stoper), BEK, DOS (defansif orta saha), OOS, KNT (kanat), FRV (forvet). Formasyon (4-4-2, 4-3-3, 3-5-2) rol başına temel konum ve görev verir; politikaya rol gömmesi (role embedding) ve formasyon konumu gözlem olarak girer. Rol bazlı ödül (bek: genişlik, stoper: hat tutma) isteğe bağlı ablasyon.
- **Ölçek deneyi (yayın için güçlü):** GNN politikası 4v4'te eğitilip 5v5, 7v7 ve 11v11'e sıfır-atış genellenir mi, MLP genellemez mi (H2). Ek olarak her ölçekte ayrı eğitim ve ince ayar karşılaştırılır.
- **Dürüst risk:** 22 ajanlı 11'e 11'de RL'i sıfırdan öğretmek çok pahalı (Google Research Football 11v11 on milyonlarca adım ve büyük işlem gücü ister). Tek RTX 3060 ile gerçekçi hedef: 4v4, 5v5 ve 7v7'de tam eğitim; 11v11'de müfredatla, 4v4/7v7 ağırlıklarından başlayarak ince ayar ve el yazması rol sezgiseliyle karşılaştırma. 11v11 sonuçları "ön sonuç" olarak etiketlenir, eğitim bütçesi açıkça yazılır.
- Oyunda: 11v11 menüde ayrı mod (büyük saha, kadro ve formasyon seçimi); görüntü ve performans için en çok 22 oyuncu LOD ve kumaş kapalı.

## 11. İşlem bütçesi: tek hafta sonu (en çok ~48 saat), RTX 3060 veya DGX Spark

**Kaynaklar:** masaüstü: Ryzen 7 5800X (8 çekirdek / 16 iş parçacığı), 46 GB RAM, RTX 3060 12 GB. DGX Spark: GB10, 20 ARM çekirdek, 128 GB birleşik bellek. **Darboğaz GPU değil, simülasyon çekirdekleridir** (ağlar küçük, yaklaşık 1 milyon parametre). Bu yüzden iki makine paralel kullanılır (tohumlar ikiye bölünür): toplam yaklaşık 34 simülasyon çekirdeği.

**Mühendislik ile hesaplama ayrı sayılır:** ortam, eğitimci, istatistik hattı ve analiz hafta sonundan önce yazılıp küçük ölçekte sınanır. "Hafta sonu" yalnızca toplu koşular, değerlendirme ve tablolar içindir.

**Tahmini hız (M0'da ölçülüp değiştirilecek, şimdilik varsayım):** ağsız simülasyon ~0,2 ms/kare, karar sıklığı 10 Hz (6 kare) ⇒ ~1,2 ms/karar ⇒ çekirdek başına ~800 karar/s, 14 işçi ile ~11 bin karar/s ⇒ ~40 milyon karar/saat. Bir eğitim koşusu 25 milyon karar (4v4'te ~200 milyon ajan adımı) ≈ 1 saat.

| Blok | Koşu | Tohum | Yaklaşık makine-saati |
|---|---|---|---|
| Çekirdek karşılaştırma: IPPO (M1), MAPPO (M2), MAPPO+GNN (M3) | 3 yöntem | 5 | 15 |
| Ablasyonlar: iletişim yarıçapı (3 değer), merkezi kritik kapalı, ödül şekillendirme kapalı | 5 varyant | 3 | 15 |
| Evrimsel/PBT (M6) | 1 | 3 | 6 |
| QMIX (M4) | 1 | 3 | 3 |
| Self-play ligi (M7) | 1 | 2 | 8 |
| Değerlendirme: tam turnuva, sıfır-atış ölçek (3v3, 5v5, 7v7, 11v11), istatistik hattı | | | 3 |
| **Toplam** | | | **~50 makine-saati** |

İki makine paralelken ≈ 25–30 saat duvar saati (güvenlik payı ile hafta sonuna sığar). **Tek makinede (yalnız 3060 ya da yalnız Spark):** zorunlu bloklar (çekirdek karşılaştırma 5 tohum, ablasyonlar 3 tohum, değerlendirme) ≈ 33 saat; QMIX, M6 ve M7 isteğe bağlıdır ve zaman kalırsa koşulur.

**Zorunlu / isteğe bağlı:**
- Zorunlu: B0 (el yazması AI), B2 (klasik sürü sezgiseli), M1, M2, M3, iletişim ablasyonu, turnuva ve istatistikler, GNN ölçek genellemesi (yalnız çıkarım, eğitim yok).
- İsteğe bağlı: M4 (QMIX), M5 (MADDPG), M6 (ES/PBT), M7 (self-play ligi), GRF dış doğrulaması, davranış klonlama (B1).
- **11'e 11: yalnız değerlendirme** (sıfır-atış genelleme ve el yazması rol sezgiseli ile karşılaştırma), eğitim yok; "ön sonuç" etiketi.

**Riskler ve önlemler:**
- Hız tahmini tutmazsa (300 karar/s/çekirdek altı): gözlemi küçült, 5 Hz karar, rakip AI'nın maliyetini azalt, koşu uzunluğunu 15 milyon karara indir ve tohum sayısını koru.
- Hafta sonu bütçesi dolarsa tohum sayısını değil yöntem sayısını azalt (en az 5 tohum çekirdek karşılaştırmada korunur).
- Sürekli kontrol noktası ve devam edebilme: bir makine çökerse koşu kaldığı yerden sürer.
- Uzun koşular `claude-train` ile ayrı tmux oturumunda, wandb ile izlenir.

## 12. Ölçek genelleme deneyi (H2) nasıl sağlam kurulur

Hipotez H2: 4v4'te eğitilen GNN politikası eğitimsiz 5v5, 7v7 ve 11v11'e genellenir; sabit boyutlu MLP genellemez. Bu doğal ama otomatik doğru değildir: hakem "MLP'yi saman adam yaptınız" diyebilir. Önlemler:

- **Adil karşılaştırma grubu (yalnız MLP değil):** (a) MLP, sabit en büyük N için sıfır doldurma ve maske ile (ölçek değişince çalışabilsin diye), (b) Deep Sets (permütasyon-değişmez, iletişimsiz), (c) Transformer/dikkat (tam bağlı, grafik yok), (d) önerilen GNN (yerel kenarlı mesaj geçişi). Böylece fark "grafik yapısı" mı "set girişi" mi ayrışır.
- **Dağılım kayması kontrolü:** 11v11 sahası büyük (105×68 m) ve mesafeler eğitimde görülenden büyük. Gözlemler saha ölçeğine normalize edilir, komşu sayısı en yakın k ile sınırlanır, mesafeler kırpılır. İki koşul ayrı raporlanır: (i) eğitim sahasıyla aynı mutlak ölçek (oyuncular seyrek), (ii) orantılı büyütülmüş saha.
- **Roller ölçekle nasıl taşınır:** 4v4'te roller kaleci (KL), defans (DEF), orta saha (ORT), forvet (FRV), takımda birer tane. Büyük ölçeklerde rol sayısı artar, tür aynı kalır: 5v5 = KL + 2 DEF + 1 ORT + 1 FRV (ya da 1 DEF + 2 ORT), 7v7 = KL + 2 DEF + 3 ORT + 1 FRV, 11v11 = KL + 4 DEF (2 stoper, 2 bek) + 4 ORT (2 merkez, 2 kanat) + 2 FRV. Rol gömmesi (role embedding) eğitimde görülen dört rolle sınırlıdır; yeni rol alt türleri (stoper/bek, kanat) ana rolün gömmesini alır. İki koşul ayrı raporlanır: rolleri doğru eşlenmiş ve rolsüz (rol gömmesi sıfırlanmış).
- **Negatif sonuç da sonuçtur:** GNN genellemezse bu raporlanır. Hipotez koşudan önce yazılı (ön kayıt), başarı ölçütü: 5v5/7v7'de el yazması tabana karşı kayıpsız kalma, ve GNN − en iyi karşılaştırma grubu farkı bootstrap güven aralığı sıfırı içermiyor.
- **Önemsiz tavan/taban:** eğitimsiz rastgele politika ve el yazması konumlanma sezgiseli aynı ölçeklerde ölçülür (taban), 4v4'te eğitilen politika kendi ölçeğinde tavandır.
- **Tek eksen:** yalnızca takım büyüklüğü değişir; fizik, oyuncu hızları, top ve kurallar aynı kalır (üç ölçekte de sabit simülasyon sürümü).

**4'e 4 rolleri (Ege, 2026-10-05):** kaleci (KL), defans (DEF), orta saha (ORT), forvet (FRV), takımda birer tane. Roller politikaya rol gömmesi (role embedding) ile verilir; temel konum ve görev rolden gelir (DEF: top ile kale arasında hat tutma, ORT: bağlantı ve boşluk, FRV: yüksek konum ve bitiricilik, KL: kaleci kontrolleri). Karşılaştırılacak rol tasarımları: (1) paylaşımlı parametre + rol gömmesi (varsayılan), (2) rol başına ayrı baş (head), (3) rolsüz. Rol sabit atanır, oyun içinde değişmez (rol takası ayrı deney). Oyundaki mevcut yapay zekâ "destek/derinlik slotları" ile çalışıyor; el yazması taban (B0, B2) bu dört role açıkça eşlenmelidir ki karşılaştırma adil olsun. Rol bazlı istatistikler: rol başına ısı haritası, pas ve top kaybı, konum disiplini.

## 13. Açık kaynaklı dil/karar modelleri ile karşılaştırma (ikinci aşama)

Ege'nin isteği: RL takımlarını açık kaynaklı karar modelleriyle de denemek. İstekte geçen isimler ("selfm", "laya") tam anlaşılmadı; varsayım: SmolLM ve Llama benzeri açık kaynaklı dil modelleri (LLM). Netleşince model listesi güncellenir. Bu, Paper D'deki "DRL ile LLM orkestratör, model boyutu spektrumu" çizgisinin futbol karşılığıdır.

**Neden doğrudan 10 Hz LLM kontrolü olmaz:** 8 ajan × 10 Hz = saniyede 80 karar; küçük LLM'in bile bir kararı ~0,1–0,3 s sürer. Bu yüzden LLM yüksek düzey taktikçi olur, düşük düzey RL/el yazması yetenekler uygular.

| # | Yöntem | Açıklama |
|---|---|---|
| L1 | Sıfır-atış LLM taktikçi | Metin durumu (roller, konumlar, top, skor, kalan süre) → JSON komut (her oyuncu için hedef bölge, pas alıcısı, baskı/yerleşim); 1–2 Hz, aralarda son komut tutulur; düşük düzey: el yazması yetenekler |
| L2 | LLM + RL düşük düzey | Aynı taktikçi, alt görevleri (git, pas ver, şut at, baskı yap) RL ile eğitilmiş yetenek politikaları yürütür (hiyerarşik) |
| L3 | Damıtılmış küçük LLM | RL politikasının (M3) kayıtlı yörüngelerinden davranış klonlama/ince ayar (LoRA), metin durum → eylem |
| L4 | Decision Transformer / çevrimdışı RL | Aynı kayıtlardan dizi modeli (hedef getiriye koşullu), RL ile aynı veri bütçesi |

**Model spektrumu (Paper D gibi boyut ekseni):** yaklaşık 0,1–0,5B (SmolLM sınıfı), 1–3B (Llama 3.2 1B/3B, Qwen2.5), 7B (Llama/Qwen/Gemma sınıfı); hepsi çıkarım ağırlıklı, DGX Spark'ta (128 GB) llama.cpp ya da vLLM ile yerel koşar. Aynı komut şeması, aynı karar sıklığı, aynı gözlem bilgisi.

**Adalet ve geçerlilik:** aynı gözlem bilgisi (LLM'e RL'in görmediği bilgi verilmez), aynı karar sıklığı, aynı seed'ler; istem (prompt) varyasyonları ve sıcaklık tohumları raporlanır; LLM çağrı sayısı, gecikme ve belirteç maliyeti RL'in hesap maliyetiyle birlikte tabloya girer (başarı/maliyet eğrisi); bozuk JSON ve geçersiz komut oranı raporlanır; en iyi istem seçimi yalnızca ara ölçütle (doğrulama maçları), nihai turnuva ayrı. LLM'ler eğitim maliyeti olmayan tabanlar gibi değil, çıkarım bütçesiyle birlikte sunulur.

**Bütçe:** çıkarım ağırlıklı olduğu için hafta sonu bütçesine sığar (turnuva başına birkaç yüz maç × 2 Hz × 4 ajan × model sayısı); L3/L4 için ek eğitim kısa (LoRA, saatler). Öncelik: L1 ve L2; L3 ve L4 zaman kalırsa.
