# QA turu 7-8 (02:40-03:05) O2

## Yukleme -> Oyna -> menu -> mac (gercek GPU, ?boot=1, qa/r7-boot, r7-menu)
- Yukleme ekrani gorunuyor, adimlar akiyor (%37 -> %63 ...), "Oyna" ~6,2 s'de hazir, tiklayinca antrenman sahnesi, pageerror yok.
- Oyna'dan sonra ana menu ACILMIYOR: oyun dogrudan antrenmana dusuyor, sag ustte "Menu" dugmesi var (mp.screen baslangic 'none'). Amaclandiysa sorun yok; "yukleme -> Oyna -> ana menu" bekleniyorsa M2/L2 mp.screen='menu' atamali. (Belirsiz, tasarim sorusu.)
- Menu -> "Tek oyunculu mac": perde 1,3 s, kickoff, K ile baslayinca play. Temiz.

## Top surme (qa/r8-surme/dribble.json; rakipler uzak, temassiz)
- Sprint hizi 7,4 m/s, top hic kaybolmadi (en uzak 1,65 m sprintte, yurumede 0,2-0,5 m).
- 180 derece (d -> a, shift): sole-stop + drag-back, hiz vektoru 0,33 s'de tersine doner, top ayakta. His: 4/5.
- Durma: sole-stop, ~0,4 s'de v=0, top 0,3 m'de ayakta. His: 4/5.
- Not: sprintte top 1,5-1,6 m onde; 4'e 4 dar sahada rakibe acik; F2 istersen 1,2 m'ye cek (oznel).
