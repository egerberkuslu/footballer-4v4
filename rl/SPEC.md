# RL ortami sozlesmesi (M0) , `OBS_VERSION = 1`

Kaynak: `rl/node/env.mjs` (sabitler orada). Oyunun gercek `sim`, `locomotion`, `rules` ve el yazmasi `ai/brain` kodunu kullanir; oyun davranisi degismez. Ortam yalniz bayrakla ek kancalar ister: `world.netPhysics=false` (kale agi XPBD dugumleri cozulmez, top-torba cozumsel kurali aynen islar), `world.resetEpisode`, `resetLocomotion`, `resetAI` genisletmesi.

Surum kurali: gozlem, durum, eylem, maske, odul terimi ya da bilgi vektorunun boyutu/sirasi degisirse `OBS_VERSION` artar; ONNX modeli bu surum numarasi ile birlikte kaydedilmeli (`meta.obs_version`, `VecEnv.obs_version`).

## 1. Yapilandirma
`FootballEnv({teamSize:4, seed, decisionHz:10, episodeSec:120, onGoal:'continue'|'end', team0:'external', opponent:'external'|'heuristic:kolay|orta|zor', rolesOn:true, weights:{...}})`

- `teamSize`: M0'da yalniz 4 (oyun 4'e 4 sabit; 5v5+ icin parametrik saha ayri is, RL_PLAN.md S10). `rolesOn` kabul edilir, etkisi yok (roller her zaman sabit).
- Her takim ya `external` (eylemler disaridan) ya da `heuristic:<seviye>` (oyunun el yazmasi AI'si; iki takim ayni seviyeyi paylasir, AI ayari globaldir). Iki takim da `external` olabilir (oz-oyun), ikisi de el yazmasi olabilir (ajan 0, hiz/kural testi).
- Karar sikligi 10 Hz: bir karar = 6 oyun karesi (60 Hz). Eylem 6 kare boyunca sabit tutulur; ayrik eylem (pas, sut vb.) yalniz ilk karede uygulanir, hareket/sprint/jockey her karede.
- `episodeSec`: oyun saniyesi, ilk `play` fazindan baslar (kickoff, el yazmasi AI ile `play`e kadar isitilir). `onGoal='continue'`: gol sonrasi kurallar kickoff'u yurutur, bolum sure dolana dek surer; `'end'`: ilk golde `terminated`.
- Sure dolarsa `truncated=True` (terminated degil). `fulltime` fazi da biter.

## 2. Roller ve oyuncu kimlikleri (sabit)
Oyuncu id = `takim*4 + rol_indeksi`, rol indeksi: 0 KL (`kaleci`), 1 DEF (`defans`), 2 ORT (`orta`), 3 FRV (`forvet`). El yazmasi AI zaten `Player.role` ile calisir, yani KL/DEF/ORT/FRV eslemesi birebirdir (ayri slot esleme gerekmez). Ajan sirasi: dis takimlar takim sirasiyla (0 sonra 1), her takimda KL, DEF, ORT, FRV.

## 3. Koordinat cercevesi
Her ajan icin, hucum yonu daima `+x` olacak sekilde aynalanir (takim 1 icin `(x,z) -> (-x,-z)`, 180 derece donus): `x' = sgn*x`, `z' = sgn*z`, `sgn = match.attackDir[takim]`. Hareket eylemi de bu cercevede verilir ve ortamda dunya cercevesine cevrilir. Olcekler: konum `x/20`, `z/12.5`; goreli konum `/20`; hiz `/8`; top hizi `/25`.

## 4. Gozlem (ajan basina, `OBS_DIM = 113`, float32)
| Indeks | Boyut | Icerik |
|---|---|---|
| 0-13 | 14 | kendi: `x'/20, z'/12.5, vx'/8, vz'/8`, bakis `(fx', fz')`, kondisyon, topa sahip, rol one-hot (4), ceza kalan sure `/30`, sari kart `/2` |
| 14-22 | 9 | top: goreli `(dx, dz)/20`, hiz `(vx', vz')/25`, yukseklik `y/3`, dikey hiz `vy/15`, mesafe `/40`, mutlak `(x'/20, z'/12.5)` |
| 23-26 | 4 | rakip kale ve kendi kale yonu (benmerkezli, `/20`) |
| 27-56 | 30 | 3 takim arkadasi x 10: goreli konum (2), goreli hiz (2), rol one-hot (4), topa sahip, cezali/atilmis. Mesafeye gore, yakin once; eksikse sifir |
| 57-96 | 40 | 4 rakip x 10, ayni bicim |
| 97-107 | 11 | faz one-hot: kickoff, play, stopped, freekick, penalty, corner, kickin, goalkick, halftime, fulltime, var |
| 108 | 1 | duran top bizim takimda mi |
| 109 | 1 | duran topu kullanacak ben miyim |
| 110 | 1 | kalan sure orani |
| 111 | 1 | skor farki `/3` (kirpilmis, benim takim bakisi) |
| 112 | 1 | topa vurabilir mi (`canKick`) |

Takim arkadasi ve rakip kumeleri permutasyon-degismez bir kume olarak kullanilabilir (satirlar mesafeye gore siralidir; sira bilgisi yalniz yakinlik).

## 5. Kritik durumu (`STATE_DIM = 70`, ajan basina ayni takim bakisi)
Top (6: konum, hiz, y, vy) + kendi takim 4 oyuncu x 6 + rakip takim 4 x 6 (rol sirasiyla: `x', z', vx', vz', topa sahip, cezali`) + faz one-hot (11) + `[duran top bizde, kalan sure, skor farki, skor_biz/5, skor_rakip/5]`. Merkezi kritik icin ajan basina satir; ayni takimin ajanlari ayni vektoru verir (sifir bilgi kaybi).

## 6. Eylem (`ACT_DIM = 8`, float32, ajan basina)
`[move_x, move_z, sprint, aim_z, aim_y, power, curl, discrete]`
- `move_x, move_z` in [-1,1]: istenen hareket yonu, takim cercevesinde (+x = hucum yonu); buyukluk 1'e kirpilir.
- `sprint`: `> 0` ise sprint.
- `aim_z, aim_y` in [-1,1]: hedef nokta kale duzleminde (`z = aim_z*(2.5+1.5)`, `y = 0.11 + (aim_y+1)/2*(3.2-0.11)`); `power` in [-1,1] -> [0,1] (`V = 8 + 26*power`); `curl` in [-1,1] -> {-3..3} falso adimi (oyundaki `CURL_W` ile `spin.y`).
- `discrete` (indeks, float olarak): 0 yok, 1-3 pas (en yakin 1/2/3. takim arkadasi; hedef = konum + 0.3 s hiz; `power > 0.05` ise guc, degilse mesafeden otomatik), 4 sut (`aim_z, aim_y, power, curl`), 5 asirtma (kale hattina, `aim_z`), 6 ayakta mudahale, 7 kayarak mudahale, 8 jockey (basili tutulur, karar suresince), 9 dalis (yalniz KL, kendi kale duzleminde `aim_z, aim_y`).
- Oyundaki karsiligi `PlayerInput {move:{x,z}, sprint, jockey, action:{type, power, aim:{x,y,z}, spin}}` (`rl/node/env.mjs` `_decodeActions`).
- Gecersiz ayrik eylem (maske 0) sessizce `yok`a duser.

## 7. Eylem maskesi (`N_DISC = 10`, bool)
`none` her zaman gecerli. Pas/sut/asirtma: `canKick` (topa sahip ya da top 1 m icinde ve `y<0.7`, `actionLock=0`, faz `play` ya da duran topun kullanicisi). Pas k: o siradaki takim arkadasi var. Mudahale: kaleci degil, topu tasiyan rakip 3 m icinde. Kayma: kaleci degil, topu tasiyan rakip 4 m icinde ya da serbest top 3 m icinde. Jockey: kaleci degil, topu tasiyan rakip 5 m icinde. Dalis: yalniz KL, top elde degil ve kendi kalesine dogru hizi `> 4 m/s`. Kaleci icin mudahale/kayma/jockey maskeli (rol kosullu alt kume); top alma/yumruklama/yakalama otomatiktir (`locomotion.keeperSave`), dalis yalniz `dive` eylemiyle.

## 8. Odul terimleri (`info['reward_terms']`, `[ortam, ajan, 7]`)
Sira: `goal, ball_approach, ball_progress, pass_ok, steal, foul, card`. `reward = sum(w_k * term_k)`, agirliklar `config.weights` (varsayilan `goal 1, ball_approach 0.02, ball_progress 0.2, pass_ok 0.05, steal 0.05, foul 0.1, card 0.2`; `foul` ve `card` terimleri zaten negatif isaretlidir).
- `goal`: takimin golu +1, yenen gol -1 (takimdaki tum ajanlar).
- `ball_approach`: takimin topa en yakin oyuncusunun topa mesafe azalmasi `/20` (yalniz o oyuncu; `play` fazi).
- `ball_progress`: top x'in karar basina degisimi `/40` (takim bakisi; tum takim ajanlari).
- `pass_ok`: pas atan +1, 4 s icinde ayni takimdan baska oyuncu topu alinca.
- `steal`: top el degistirip kendi takimindan biri toplayinca (`trap/dribble/tackle/save`) +1.
- `foul`: faul yapana -1. `card`: sari -1, kirmizi -3.

## 9. Bilgi vektoru (`INFO_DIM = 6`, ortam basina)
`[skor_takim0, skor_takim1, oyun_suresi_s, faz_indeksi, karar_sayisi, bolum_indeksi]`. Bolum bittiginde (`done`), `info` terminal adima aittir.

## 10. Toplu sunucu ve Python istemcisi
- `rl/node/server.mjs` (`npx -y tsx rl/node/server.mjs --sock <yol>`): W is parcacigi, her biri TEK ortam (oyunun `game`, `world`, `locomotion` modulleri tekildir, ayni surecte ikinci ortam olamaz; `num_envs == workers`). Ana is parcacigi ile isciler `SharedArrayBuffer + Atomics` ile konusur, istemci ile Unix soketi uzerinden ikili protokol.
- Protokol (little-endian): istek `u8 cmd` (1 INIT: `u32 uzunluk + JSON{cfg, workers}`, 2 RESET: `i32[W]` tohum (-1 otomatik), 3 STEP: `f32[W*n_ajan*8]`, 4 CLOSE); yanit `u8 durum + u32 uzunluk + govde`. RESET/STEP govdesi sirayla: `obs f32[W,A,113], state f32[W,A,70], mask u8[W,A,10], reward f32[W,A], terms f32[W,A,7], info f32[W,6], done u8[W], truncated u8[W]`.
- `rl/py/vec_env.py`: `VecEnv(num_envs, workers=None, **cfg)`; `reset(seeds=None) -> (obs, {'state','action_mask','info_vec'})`, `step(actions[W,A,8]) -> (obs, reward, terminated, truncated, {'state','action_mask','reward_terms','info_vec'})`. Otomatik reset: `done` olan ortamda donen `obs/state/mask` YENI bolumun ilk gozlemidir, `reward/terms/info` terminal adima aittir.
- Tohum: `reset(seed)` verilirse o; yoksa `cfg.seed + isci*100003 + 7919*bolum`. Ayni tohum ve ayni eylem dizisi ayni yorungeyi uretir (bkz. BENCH.md determinizm).

## 11. ONNX aktarimi icin sabitler
`OBS_DIM=113`, `STATE_DIM=70`, `ACT_DIM=8` (7 surekli + ayrik indeks, ayrik kafa 10 sinif), `N_DISC=10`, `N_TERMS=7`, `OBS_VERSION=1`. Boyutlar derleme zamaninda sabit; degisimde `OBS_VERSION` artirilir ve eski modeller yuklenmez. Permutasyon-degismez kume girisleri (takim arkadasi 3 satir, rakip 4 satir) GNN/Deep Sets icin ayri dilimlenebilir (indeksler S4).

## 12. Bilinen sinirlar (M0)
- Yalniz 4'e 4; ortam basina bir is parcacigi; ayni surecte tek etkin `FootballEnv`.
- Kale agi XPBD fizigi kapali (gorsel); gol/direk/top-torba kurali ve kaleci fizigi acik. Ag kapaliyken top agin icinde yine analitik torba kuralina tabidir.
- Dis takim oyunculari `game.remote` kumesine alinir (AI atlar); `locomotion` bu oyuncularin sutlarini insan sutu sayar: kaleci ayakta-kurtarma zari etkin (insan sutu kurtarma ayari). Tum oyuncular dis olsa da bu aynidir.
- Duran toplarda dis takim bir sey yapmazsa kurallar zaman asimi ile yedek vurusu yurutur (3 sn kurallari).
- Gozlem gurultusu, parametrik saha/kadro ve 5v5-11v11 henuz yok.
