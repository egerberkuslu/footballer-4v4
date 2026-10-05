# QA turu 3 (01:47–02:15) — O

Kanıtlar: `qa/r3-senaryo`, `qa/r3-mac`, `qa/r3-gorsel`, `qa/r3-ff`. tsc temiz. pageerror 0, NaN 0.

## Regresyon
| Kod | Durum | Kanıt |
|---|---|---|
| C1 önden ballFirst kayma → kırmızı (K/F) | **düzeldi** (kart yok, faul yok) | r3-senaryo "kayma" |
| C4 AI elinde top olan kaleciye müdahale (J) | **düzeldi** (insan kaleci 3 s tuttu, 3,1 s'de "KALECİ 3 SANİYE" endirekt) | r3-senaryo kaleci3 |
| Hakem VAR'da monitörün tersine koşuyor (K) | **düzeldi** (doğrudan monitöre, 2,9 s) | r3-senaryo var |
| C5 seyirciler primitif | düzeldi (tur 2) | |
| Tek tip yüz/saç (E/I) | **düzeldi**: yüz, ten ve saç varyantlı | r3-gorsel/yakin-topcu-0 |
| C2 uyluk/deri şorttan çıkıyor (N) | **açık**: şort arkasında deri yaması, çorapta tırtıklı kenar + boşluk | r3-gorsel/yakin-topcu-0 |
| C3 hakem şortu etek gibi (N) | doğrulanamadı (yakın kare yok) | |
| K1 "Yayın" düğmesi takibi kapatıyor (F) | açık (bakılmadı) | |
| Saç kenarları tırtıklı (E) | açık | r3-gorsel/yakin-kaleci4 |

## Akışlar (senaryo)
Korner, kaleci 3 s (insan), AI kaleci bırakma, ofsayt, penaltı (insan attı, **gol**), gol sonrası elle VAR, kayma, net aut: geçti. Taç: akış doğru (taç → AI kullandı → oyun), ancak AI kullanımı ekran görüntüsünden hızlı olduğu için test betiği restart'ı kaçırdı; betik düzeltildi, oyun hatası değil.
Firefox: antrenman ve maç açılıyor, maçta oyun 'play'e geçiyor (saat 22,6 s).

## Yeni bulgular
- **Ciddi (F) Ayakta müdahale neredeyse her zaman faul.** 150 s maçta insanın 13 tackle temasının 13'ü ballFirst:false, şiddet hep ~0,8 (tur 1'de 0,45/0,65); 10 faul, insan takımına 5 kart. Ayrıca Shift (sprint) basılıyken E her zaman kayarak müdahale.
- **Kozmetik (A, team-lead'e)** Alçak kamerada çim kümeler halinde seyrek tutam gibi; çizgi boyası beyaz yaprakları çizginin 1–2 m çevresine saçılıyor (r3-gorsel/crop-cim.png).

## Performans (maç, insan botu, 150 s, yük ~20)
10 s pencerelerde fps 53–59, p1 28–80 ms, >50 ms 1–8 kare. Açılış ilk saniyesi 700 ms ve 320 ms. Hazır olma 3,1 s.
