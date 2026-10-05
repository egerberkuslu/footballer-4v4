# QA turu 4-6 (01:55-02:35) O2

Gecen: tsc temiz; Firefox antrenman+mac pageerror yok; Chrome 120 s: pageerror 0, NaN 0, takilma 0.
Senaryolar (qa/r5-senaryo, r5b-senaryo): tac, korner, penalti, kayma (C1 regresyon), net aut, AI kaleci 3 s, insan kaleci 3 s (KECALECI 3 SANIYE, 3,02 s), ofsayt net (5 m) hepsi GECTI. Ilk kosuda 2 senaryo kaldi cunku AI topu kesti / AI oyuncu pasoru fauller; senaryo betigine "diger oyunculari uzaga al" eklendi (kaleci3). Ofsayt betigi AI baskisina acik, tekrar kosuda gecti.
VAR: hakem izi dogrulandi (qa/r4-var): dinleme 0,8 s, ters kosu yok, varis 1,9 s. Otomatik kil payi VAR: G'nin kayit tabanli testi gecti, gercek GPU'da dogrulanamadi.
Acik:
- (F2) Ayakta mudahale: 120 s'de 12 faul/3 kart, 9 tackle temasinin hepsi ballFirst=false (qa/r6-mac/sonuc.json).
- (I2/E2) Hakem sac kartlari VAR monitorunde parazit benekli (r4-senaryo/03).
- (D2) Uzak cizgiler kesik kesik (r6-gorsel/yakin-hakem.png).
- (N2) Mavi forma lekeleri; kaleci formasi koyu bloklar.
- (J2) AI endirekt FK'da dogrudan sut dongusu.
- Perf: makine yuku ~18 iken olculebilir degil; sakin makinede yeniden olculecek.
Siradaki: sprintle surme, 180 donus, devre arasi, yukleme akisi, VAR ofsayt incelemesi, duran top nisani.
