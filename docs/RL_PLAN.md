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
