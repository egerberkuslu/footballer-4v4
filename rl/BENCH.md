# M0 hiz ve determinizm olcumu

Makine: Ryzen 7 5800X (8 cekirdek / 16 is parcacigi), Node v20.19.5, tsx 4.23. Olcum sirasinda makine baska isler tarafindan paylasiliyordu (yuk ortalamasi 2-3), yani asagidaki sayilar tavan degil. Karar = bir ortam adimi (10 Hz, 6 oyun karesi); ajan karari = ortam adimi x ajan sayisi. Politika rastgele (maskeye uyumlu); gercek politika cikarimi bu sayilara dahil degildir.

Komutlar: `npx -y tsx rl/node/bench.mjs 12 1,4,8,14 heuristic:orta external` (yalniz Node, ortamlar is parcaciklarinda), `python3 rl/tests/py_bench.py <W>` (Python uctan uca, soket + lockstep).

## Yalniz Node (ortam adimi/s)
| Kurulum | W | toplam adim/s | cekirdek basina | ajan karari/s toplam | surec RSS |
|---|---|---|---|---|---|
| 4 dis ajan vs el yazmasi (orta) | 1 | 3993 | 3993 | 15972 | 218 MB |
| | 4 | 14822 | 3705 | 59288 | 607 MB |
| | 8 | 22951 | 2869 | 91804 | 1093 MB |
| | 14 | 19350 | 1382 | 77400 | 1579 MB |
| 4 dis ajan vs el yazmasi (zor) | 1 / 14 | 4019 / 18140 | 4019 / 1296 | 16076 / 72560 | 220 / 1554 MB |
| el yazmasi vs el yazmasi (ajan yok) | 1 / 14 | 4180 / 19703 | 4180 / 1407 | , | 224 / 1544 MB |
| oz-oyun, 8 dis ajan | 1 | 8734 | 8734 | 69872 | 215 MB |
| | 14 | 44514 | 3180 | 356112 | 1675 MB |

Bellek: ek is parcacigi basina ~105 MB (V8 yigini + modul grafigi), W=14'te surec ~1.6 GB. Ilk `reset` ~20 ms (isitma dahil).

## Python uctan uca (lockstep, rastgele eylem, 4 dis ajan vs orta)
| W | ortam adimi/s | ajan karari/s | adim basina |
|---|---|---|---|
| 1 | 1353 | 5411 | 0.7 ms |
| 8 | 3930 | 15721 | 2.0 ms |
| 14 | 4795 | 19179 | 2.9 ms |

## Sonuc: ~800 karar/s/cekirdek tahmini CURUTULDU (ortam adimi daha hizli)
- Tek cekirdekte ~4000 ortam adimi/s (el yazmasi rakip), tahminin 5 kati. Oz-oyunda (rakip AI maliyeti yok) ~8700/s.
- Olcek tablosu lineer degil: W=8'e kadar ~23 bin adim/s, W=14'te dusuyor (8 fiziksel cekirdek, SMT fayda vermiyor, makine paylasimli). Oneri: W = fiziksel cekirdek sayisi (8-10), geri kalan cekirdekler egitimciye.
- RL_PLAN S11 bagimli sayilar: Node tarafinda 8 is parcacigi ~23 bin ortam adimi/s => 25 milyon karar ~18 dk. Python lockstep ile ~4-5 bin adim/s => 25 milyon karar ~1.5-1.7 saat; darbogaz Python/soket senkronu ve en yavas ortami bekleyen lockstep bariyeri. Iyilestirme yollari (M1 oncesi, ihtiyac olursa): paylasimli bellek ile Python'a dogrudan okuma, asenkron/boru hatli adim, ortam basina bagimsiz otomatik reset ile bariyer payini azaltma, cok surecli (is parcacigi yerine) isciler.
- Not: kale agi XPBD kapali; ag acik olsa kale yakininda adim maliyeti artar (olculmedi).

## Determinizm (`rl/tests/determinism.mjs`)
Ayni tohum + ayni (tohumlu rastgele politika) eylem dizisi: yorunge ozeti (FNV-1a, her adimda gozlem, odul ve bilgi baytlari) ayni.
- Ayni surecte reset sonrasi tekrar (tohum 7, 90 s): `heuristic:orta`, `heuristic:zor` ve `external` (oz-oyun) icin GECTI (ilk = tekrar = ucuncu tekrar; farkli tohum farkli ozet).
- Ayri surecte taze baslangic: GECTI (ozet ayni).
Bulunan ve duzeltilen durum sizintilari: `sim/keeperDive` dalis plan haritasi, `ai/brain` `threatMiss/lastRestart/restartT/takerDelay/tick`, `locomotion` modul dizileri (`resetLocomotion`).

## Kural dumani (`rl/tests/rules_smoke.mjs`, 600 s oyun)
GECTI: rastgele politika vs orta (6000 karar, 30 gol, 23 faul, 9 kart, korner 4, tac 7, kale vurusu 16, serbest vurus 21, ofsayt olcumu 561 / ihlal 1, NaN yok); AI-AI (9 gol, penalti 2, serbest vurus 5, tac, kale vurusu, ofsayt); bolum sonlaniyor, gol olay sayisi skor toplamina esit; `onGoal='end'` ilk golde bitiyor.

## Mevcut testler
`tsc -b` temiz, `npm run build` temiz, `rules-test` 176 gecti 0 basarisiz, `sim-test` exit 0, `ctl-loco-unit` exit 0.
