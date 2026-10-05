# M1 sanity kosusu: MAPPO + deepsets, 4v4 vs heuristic:kolay

Komut: `train.py --encoder deepsets --opponent heuristic:kolay --steps 5000000 --envs 10 --seed 1` (tohum 1, W=10 Node isci, cuda, torch 2.13.0+cu130, OBS_VERSION 1). Kayit: `rl/runs/m1a/` (config.json, log.csv, ckpt.pt, curve.png, eval_*.json).

Sure 38 dk, 5000960 ortam adimi, ortalama 2222 adim/s uctan uca (hedef >= 4000 TUTMADI: Python lockstep + GPU cikarimi). GPU kullanimi (nvidia-smi ornekleri, egitim sirasinda): ortalama 18%, bellek 749 MB.

## Ogrenme egrisi (egitim bolumleri, stokastik politika)
![egri](runs/m1a/curve.png)

| adim | ort. bolum odulu | gol farki (biz-rakip) |
|---|---|---|
| 0.0-0.5 M | -1.55 | -1.40 |
| 0.5-1.0 M | -0.56 | -0.53 |
| 1.0-2.0 M | -0.46 | -0.46 |
| 2.0-3.0 M | -0.26 | -0.27 |
| 3.0-4.0 M | +0.15 | +0.11 |
| 4.0-5.1 M | +0.30 | +0.24 |

Odul terimleri (bolum ortalamasi, ajan basina): goal -1.398 -> +0.239, ball_approach -1.029 -> -1.494, ball_progress -0.655 -> +0.180, pass_ok +0.097 -> +0.001, steal +1.424 -> +1.494, foul -0.229 -> -0.126, card -0.290 -> -0.009 (ilk 0.5 M adim -> son 1 M adim).

## Degerlendirme (100 mac, farkli tohum, deterministik politika, bootstrap %95 GA)
| rakip / politika | mac | gol (biz) | gol (rakip) | gol farki [GA] | G/B/M |
|---|---|---|---|---|---|
| heuristic:kolay / **MAPPO deepsets** | 100 | 2.84 | 3.93 | -1.09 [-1.62, -0.57] | 26/18/56 |
| heuristic:kolay / rastgele | 100 | 0.65 | 4.27 | -3.62 [-3.99, -3.27] | 1/5/94 |
| heuristic:kolay / her zaman bosta | 100 | 0.00 | 0.26 | -0.26 [-0.39, -0.15] | 0/82/18 |
| heuristic:orta / **MAPPO deepsets** | 100 | 3.17 | 3.93 | -0.76 [-1.13, -0.41] | 21/26/53 |
| heuristic:orta / rastgele | 100 | 0.61 | 5.12 | -4.51 [-4.86, -4.15] | 0/0/100 |
| heuristic:orta / her zaman bosta | 100 | 0.00 | 0.49 | -0.49 [-0.68, -0.33] | 0/71/29 |
| heuristic:zor / **MAPPO deepsets** | 100 | 2.58 | 4.83 | -2.25 [-2.60, -1.90] | 5/12/83 |
| heuristic:zor / rastgele | 100 | 0.43 | 5.84 | -5.41 [-5.77, -5.05] | 0/0/100 |
| heuristic:zor / her zaman bosta | 100 | 0.00 | 0.87 | -0.87 [-1.17, -0.59] | 0/62/38 |

## Yorum (dürüst)
- Ogrenme VAR: egitim gol farki ve bolum odulu yukseliyor, deterministik degerlendirmede rastgele tabana gore buyuk fark (kolay: -3.6 -> -1.1) ve atilan gol 0.65 -> 2.8.
- Ama 5 M adimda el yazmasi `kolay`i YENEMIYOR (G/B/M 26/18/56); hucum ogrenildi (gol atiyor), savunma/kaleci zayif (yenen gol 3.9). 'Her zaman bosta' tabani gol farkinda daha iyi (-0.26) cunku el yazmasi AI bos takima neredeyse gol atamiyor (0.26): yani goal_diff tek basina yeterli bir olcut degil, atilan ve yenen gol ayri okunmali.
- Olasi nedenler / sonraki adim (ara olcut: odul terimleri ve entropi): yenen gol cezasi sekillendirmesiz ve seyrek; ayrik entropi hizla ~0.02-0.05'e coktu (maske cogu zaman tek gecerli eylem birakiyor); sabit gamma 0.99 ve 1200 adimlik bolum; daha uzun egitim (>= 20 M), savunma icin top-kale araligi/konumlanma sekillendirmesi, kolay seviyeden orta seviyeye mufredat. Hicbiri bu kosuda denenmedi.
- Egitim (stokastik) son 1 M adim gol farki pozitif iken deterministik degerlendirmede negatif: deterministik eylem (ortalama + argmax) stokastikten daha kotu; `eval.py --stochastic` ile ayrica olculmedi (acik is).
- Tek tohum (1), tek koşu: guven araligi yalniz degerlendirme mac orneklemini yansitir, egitim tohumu varyansini degil (planin >= 5 tohum kurali henuz uygulanmadi).

## Parite: egitim vs degerlendirme tutarsizligi (cozuldu)

Belirti: ayni ckpt egitimde son bolumlerde gol farki +0.2..+0.3 iken `eval.py --stochastic --seed 777` vs `kolay` -0.99 verdi.

**Neden: egitim/eval hatasi degil, rakip adi.** `eval_stoch.json` rakipleri `kolay|orta|zor` (on eksiz) olarak verilmis; env eski surumde `s.split(':')[1] ?? 'orta'` ile bilinmeyen adi sessizce `orta` seviyesine dusuruyordu, yani o tablonun uc satiri da AYNI rakipti (orta). Kanit: dogru `heuristic:orta` stokastik gol farki -1.00 (atilan 2.53, yenen 3.53) ile on eksiz 'kolay' satiri -0.99 (atilan 2.60, yenen 3.59) birebir ortusuyor.
Duzeltme: `rl/node/env.mjs` artik `kolay|orta|zor` ve `heuristic:*` kabul eder, bilinmeyen adda HATA verir.

| rakip | stokastik gol farki [GA] (dogru ad, seed 777, 100 mac) | deterministik (seed 100000) | on eksiz ad ile (eski, aslinda orta) |
|---|---|---|---|
| heuristic:kolay | +0.54 [+0.18, +0.90] | -1.09 | -0.99 |
| heuristic:orta | -1.00 [-1.27, -0.72] | -0.76 | -0.65 |
| heuristic:zor | -2.04 [-2.34, -1.75] | -2.25 | -0.86 |

Parite testi (`rl/tests/train_eval_parity.py`, ayni ckpt, ayni tohum, ayni normalizasyon, vs kolay, 100 bolum, stokastik): egitim rollout yolu gol farki +0.17, eval.py yolu +0.49 [GA +0.15, +0.84] (fark orneklem gurultusu icinde); normalize gozlem ortalamasi -0.001, std 1.015 (calisan normalizasyon ckpt'ten yukleniyor ve donduruluyor). Dolayisiyla gozlem normalizasyonu, yan/aynalama, rol esleme, auto-reset ve gol farki hesabi egitim ile eval'de ayni.
Not: deterministik eylem (ortalama + argmax) stokastikten kotu (kolay: -1.09 vs +0.54): degerlendirmede iki mod ayri raporlanmali; yukaridaki 'MAPPO deepsets' degerlendirme tablosu deterministiktir. Bundan sonra egitim gunlugunde `eval_gd` sutunu her 400 guncellemede eval.py ile ayni kod yolundan (20 mac, stokastik) yazilir (`--eval-every`).
Onceki 'bosta tabani daha iyi' yorumu yalniz deterministik tablo icin gecerlidir: stokastik politika kolay'a karsi pozitif gol farki veriyor (+0.54 [+0.18, +0.90], G/B/M 50/21/29), yani kolay seviyesi YENILIYOR; orta ve zor yenilmiyor.

## Bağımsız doğrulama (koordinatör, tohum 4242, doğru rakip adları, stokastik, 100 maç)

Aynı kontrol noktası (`rl/runs/m1a/ckpt.pt`), `rl/runs/m1a/eval_stoch_verify.json`:

| Rakip | Gol farkı [%95 GA] | G/B/M (%) | atılan / yenen |
|---|---|---|---|
| kolay | +0,01 [−0,29; +0,31] | 38/23/39 | 2,90 / 2,89 |
| orta | −1,13 [−1,46; −0,78] | 17/19/64 | 2,45 / 3,58 |
| zor | −1,78 [−2,09; −1,47] | 8/10/82 | 2,14 / 3,92 |

Not 1: Önceki tutarsızlığın (eğitimde +0,3, değerlendirmede −1,0) nedeni değerlendirme komutunda rakip adlarının önekli (`heuristic:kolay`) verilmemesiydi; ortam bilinmeyen adı sessizce `orta`ya düşürüyordu (artık hata veriyor). Eğitim ve değerlendirme yolu parite testinde uyuşuyor (`rl/tests/train_eval_parity.py`).

Not 2: Kolay rakibe karşı iki bağımsız tohum seti farklı nokta tahmini veriyor (+0,54 ve +0,01). Güven aralıkları örtüşüyor; doğru okuma "kolay rakibe karşı kabaca başa baş, ≈ +0,3 civarı", "kolayı yendi" değildir. Orta ve zor rakipler net yeniyor. Bu tek tohumlu (eğitim tohumu 1), 5M adımlık bir sanity koşusudur; yayın sonucu değildir.
