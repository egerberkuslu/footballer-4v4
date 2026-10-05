# QA turu 1 (00:15–01:15) — O

Ortam: sistem Chrome `--use-angle=gl` (RTX 3060), 1920×1080, `scripts/run-browser.sh` (nice 19). Makine yükü 18–31 (diğer ajanların başsız tarayıcıları); kontrol ölçümü: **boş WebGL sayfası bile** bu yükte p1 35,8 ms ve 15 s'de 6 kare >50 ms veriyor (`scripts/qa-baseline.mjs`). Aşağıdaki takılma sayıları bu tabanla birlikte okunmalı.
Betikler: `scripts/qa-lib.mjs` (insan gibi klavye/fare botu + kayıtçı), `qa-match.mjs`, `qa-perf.mjs`, `qa-ff.mjs`, `qa-visual.mjs`, `qa-baseline.mjs`.
Testler sırasında 2 kez Vite tam yenilemesi oldu (başka ajan düzenlemesi, ör. Hud.tsx) ve maç baştan başladı; bunlar hata sayılmadı.

## Sağlık
- `npx tsc -b`: 00:17'de G'nin dosyalarında 3 hata (VarOverlay.tsx 'hepsi', VarScene.tsx:388 'kilpayi'); 01:05'te **temiz**.
- Chrome maç (200 s, insan botu) ve AI-AI (120 s): pageerror 0 (yalnız HMR anında geçici `useThree is not defined`, yenilemeyle kayboldu). NaN 0.
- Firefox: antrenman ve maç açılıyor, context kaybı yok. Maçta başlama vuruşu insanın K/Boşluk'una kadar bekliyor (tasarım; ipucu metni görünüyor).

## Akışlar (insan botu: W/A/S/D, Shift, Boşluk basılı-bırak, K, E, Q)
| Akış | Sonuç | Kanıt |
|---|---|---|
| Başlama vuruşu (insan K) | geçti | qa/r1-mac/00 |
| Top sürme, pas (15), şut (10), müdahale (10), Q (6) | geçti (girdiler çalışıyor) | qa/r1-mac/sonuc.json bot.log |
| Gol + yeniden başlama | geçti (AI 2 gol) | qa/r1-mac/38-goal |
| Kale vuruşu (insan kaleci kullanıyor) | geçti | qa/r1-mac/34 |
| Faul + serbest vuruş | geçti | qa/r1-mac/07–09 |
| Sarı kart (tekrar eden faul) | geçti | qa/r1-mac/15 |
| Kırmızı kart | **şüpheli** (aşağıda C1) | qa/r1-mac/19 |
| Devre arası → 2. yarı, taraf değişimi | geçti | qa/r1-mac/21,22 |
| Maç sonu | geçti (fulltime) | sonuc.json |
| Korner, taç (ayakla), ofsayt, penaltı, kaleci 3 s, VAR | **doğrulanamadı** (200+120 s'de oluşmadı) | tur 2'de senaryolu test |
| İnsan şut isabeti | 10 şut 0 gol (kaleci kurtarışları + 2 aut); hata kanıtı yok | |

## Bulgular (önem sırasıyla)
### Ciddi
- **C1 (K + F) Önce topa yapılan kayarak müdahaleye direkt kırmızı.** Olay: `contact {a:7,b:2,kind:'slide',ballFirst:true,fromBehind:false,intensity:1}` → faul + kırmızı (saat 43). `judgeContact` `intensity>=HARD_I` olunca ballFirst'i yok sayıyor; F'nin slide şiddeti 1,0'a doymuş. Önden, topa ilk dokunan kayma kırmızı olmamalı.
- **C2 (N-kumas / I-anim) Uyluk şortun içinden çıkıyor.** Yakın çekimde deplasman oyuncusunun sağ uyluğu şortun ön paçasını delip görünüyor; şort paçası yırtık gibi. qa/r1-gorsel/yakin-topcu-on.png, kırpım qa/r1-gorsel/crop-sort.png.
- **C3 (N-kumas) Hakem forması/şortu etek gibi duruyor.** Forma eteği sert levha gibi açılıyor, şort paçası geniş etek gibi bacaktan ayrık. qa/r1-gorsel/yakin-hakem.png, crop-hakem-uyluk.png.
- **C4 (J-ai) AI saha oyuncusu topu elinde tutan kaleciye müdahale ediyor.** 2. yarıda oyuncu 5, kaleci 0'a iki kez (saat 28,6 ve 39) → iki faul. Gerçekte kimse elinde top olan kaleciye girmez.
- **C5 (team-lead → D) Tribün ve yedek kulübesindeki seyirciler koyu gri düz siluet/manken.** Uzak ve orta çekimde primitif görünüyor (qa/r1-perf/mac-Yayın.png, qa/r1-gorsel/yakin-hakem.png arka plan).

### Kozmetik
- **K1 (F) Kamera düğmeleri maçta takip kamerasını kapatıyor.** "Yayın" düğmesi takip eden yayın kamerası değil, sabit preset (ctl.cam='serbest' olur) ve aynı anda "Serbest kamera (V)" yeşil yanıyor. Takibe dönmenin tek yolu V. "Yayın" düğmesi `ctl.cam='yayin'` yapmalı.
- **K2 (I/K) Kırmızı kart gören oyuncu anında yok oluyor** (sentOff → visible=false); sahadan yürüyerek çıkış yok.
- **K3 (F) Gol kutlaması sırasında ipucu "Duran top kuruluyor…"** görünüyor (qa/r1-mac/38).
- Devre arasında oyuncular olduğu yerde donuk bekliyor (qa/r1-mac/21).
- Tüm oyuncular aynı yüz/saç (E/I); gerçekçilik için 2–3 varyant iyi olur.

## Performans (gerçek GPU, yük 18–26 altında)
| Görünüm | fps | p1 ms | max ms | >50 ms / 15 s | draw call | üçgen |
|---|---|---|---|---|---|---|
| Maç takip (yayın) | 57,1 | 49,6 | 92 | 7 | 208 | 1,5 M |
| Maç tribün | 59,0 | 35,2 | 76 | 5 | 193 | 1,6 M |
| Maç kale arkası | 57,0 | 57,7 | 140 | 11 | 199 | 3,0 M |
| Antrenman şutçu | 57,0 | 60,4 | 115 | 14 | 220 | 2,9 M |
| Boş sayfa (taban) | 58,0 | 35,8 | 267 | 6 | – | – |
Oyun mantığı CPU 0,2–2 ms, fizik ≤1,7 ms. Ortalama fps hedefte; p1 ≤20 ms hedefi bu makine yükünde ölçülemez (taban zaten 35 ms). Uygulamaya özgü takılmalar: **sayfa açılışında ilk saniyede 280–890 ms kareler** (maç ve antrenman), **maç sonunda (fulltime) 323 ve 376 ms** iki kare. M'nin ~7 s donma işi: Chrome'da hazır olma 3,5 s; ilk 10 s'de >50 ms kare 8–9 adet.

## Regresyon listesi (sonraki turda doğrulanacak)
C1, C2, C3, C4, K1, fulltime takılması; korner/taç/ofsayt/penaltı/3 s/VAR senaryoları.
