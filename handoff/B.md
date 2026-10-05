# B → B2-fizik devir notu (top, ağ, çarpışma)

Dosyaların: `viewer/src/sim.ts` (World, ana döngü, torba modeli, çarpışmalar, API), `viewer/src/sim/ball.ts` (top dinamiği), `viewer/src/sim/net.ts` (ağ topolojisi), `viewer/scripts/sim-test.mjs`. Koordinatörün ölçüm betiği: `viewer/scripts/koord-net-probe.mjs`.

## Mimari (3 katman)

### 1. Top — `sim/ball.ts`
- Kütle 0.43 kg, R 0.11. İnce kabuk eylemsizliği I = 2/3 m R².
- `airStep`: karesel sürükleme; Cd hıza bağlı (0.24 → 0.44, ~11 m/s'de kritik geçiş) + Magnus. C_L = min(0.32, 1.1·S), S = Rω/v. Havada spin sönümü τ = 4 s.
- `contactImpulse(b, n, e, mu)`: normal dürtü + teğetsel sürtünme dürtüsü (kaymayı en fazla sıfırlar, artanı spine döner). Direk, zemin ve çarpışmalar bunu kullanır.
- `groundContact(b, v0y, h, e?)`: v0y < −0.8 ise sekme (GROUND_E 0.58, mu 0.5). Değilse kayma → yuvarlanma: kaymada Coulomb ROLL_MU 0.4, yuvarlanırken a = 0.9 + 0.09·v m/s².
- `integrateSpin`: dünya çerçevesinde q += ½ω⊗q. C, `ball.q`'dan döndürür.
- Ölçülen değerler: 10 m/s kayan top yaklaşık 5 m/s'de yuvarlanmaya geçiyor. 8 m/s yuvarlanan top ~2.7 m/s² yavaşlıyor (hava dahil). 2 m'den düşen top ~0.6 m sekiyor. 45 rad/s falso 20 m'de ~2.4 m sapıyor.

### 2. Topun gördüğü ağ: ÇÖZÜMSEL TORBA (`World.bagForce`, `faceQuery`)
- Top görsel ağ düğümleriyle ÇARPIŞMAZ. Önce XPBD iki yönlü bağlama denendi; kütle oranı (top/düğüm ~300) ve az yineleme yüzünden top ağdan tünelledi. Vazgeçildi, geri dönme.
- Her kale 4 yüzden oluşur: 0 arka (eğik), 1 üst, 2 ve 3 yanlar. `faceSide` her yüz için topun hangi tarafta olduğunu tutar: +1 kale içi, −1 dışı. Bu taraf yalnız top yüzden uzaktayken (|sd| > R + max + 0.25) ya da bölge dışındayken güncellenir; temas bandında kilitlidir. Bu sayede top ağdan geçemez, dışarıdan gelen top da (yan ağ) içeri giremez.
- Köşe kapatma: top kale içindeyse komşu yüzün bölgesi X = 0.6 m genişler (`eL`/`eR`). Olmazsa top köşeden kaçar.
- Kuvvet:
  - depth = topun dinlenme düzlemini aştığı miktar.
  - F = K0·depth + K_HARD·max(0, depth − lim), lim = max·g + 0.04.
  - Sönüm: aga doğru C_IN/gE, geri dönüşte C_OUT/√(0.12 + 0.88·g).
  - Arka yüzde itme YATAY (px = −s, py = 0). Eğik normal kullanılınca top yere bastırılıp yukarı sekiyordu; kullanıcı şikâyeti buydu.
- g (kenar etkeni): `bagShape(u)·bagShape(v)²`. Çerçevede 0, ortada 1; alt kenar zemin borusuna kelepçeli olduğu için dikeyde karesi alınır. gd, sönüm için daha yumuşak (√gv).
- Ağa yaslanan top yere çarparsa sekme katsayısı 0.1 (`groundContact` son parametresi).
- İki kale de her zaman aktif: topa yakın kale `b.x` işaretiyle seçilir. `world.side` YALNIZ `shoot()` ve `resetBall()` içindir.

### 3. Görsel ağ — `sim/net.ts` + `World.netSubstep`
- Tek parça ağ, göz 12 cm (42×18 arka, 7 sıra üst, yanlar eğik kenarda kesik kare göz). Dikişlerde ortak düğüm. 2992 düğüm (iki kale).
- Kenarlar boru eksenlerinde: alt kenar y = 0.017 ve her düğüm kelepçeli (etek yok, C'nin isteği); üst kenar H − 0.026; diğer çerçeve hatlarında her 2 düğümde bir kelepçe.
- İpler yalnız gerilir (SLACK arka 1.10, yan 1.06, üst 1.05). (i, i+2) kıvrım bağları ve köşegenler yalnız çökmeye karşı, zayıf (SOFT_FRAC).
- Uzun bağlar (tether): her düğüm en yakın 2 kelepçe grubuna ağ üzerinden Dijkstra mesafesiyle bağlı. Geri toplanma hızı RETURN_SPEED ile sınırlı; topa son 3 adımda değen düğümde bağ atlanır.
- Top ağı TEK YÖNLÜ iter (`pushNet`, küre–kapsül, adım başındaki göreli tarafa göre). İpte topun ittiği düğüm 50 kat ağır sayılır (`solveRopes`). Böylece top çevresinde koni oluşur ve ağ topu sarar; bu olmazsa ip düğümü topun içinden geri çeker.
- Adımlama: top kaleye 3 m yakınsa o kale HOT_TIME = 3 s boyunca ince adımlanır (H_NET 1/240, ağ adımında top yolu ≤ 7 cm). Değilse kare başına 1 kaba adım. SLEEP_T = 1.5 s dinginlikten sonra ağ uyur (rüzgâr salınımı da durur).
- Top alt adımı: ≤ 1/600 s ve ≤ 3 cm yol.

## Sabitler ve ayar kılavuzu (`sim.ts` başı)
| Sabit | Değer | Etki |
|---|---|---|
| NET_C_IN | 10 | aga doğru viskoz sönüm. Derinlik ≈ m·v/c, yani hızla orantılı. Küçültürsen torba derinleşir. |
| NET_K0 | 90 | topu geri toplayan zayıf yay |
| NET_C_OUT | 220 | geri tepme sönümü. Büyütürsen top torbada daha ölü kalır. |
| NET_K_HARD | 1500 | torba sınırında sertleşen yay. Büyütürsen top yukarı sekmeye başlar, dikkat. |
| DEPTH_BACK / TOP / SIDE | 1.05 / 0.45 / 0.6 | panel ortasında en fazla torba |
| POST_E / BAR_E | 0.62 / 0.15 | direk ve ağa sarılı çelik iskelet sekmesi |

Hedefler (koordinatör): ağın dinlenme düzleminin ötesine geçiş 15 m/s → 0.3–0.45 m, 25 → 0.55–0.8 m, 32 → 0.75–1.0 m. Durma süresi 0.08–0.18 s. Geri tepme ≤ 1.5 m/s. Top sahaya taşmamalı.
Son probe (y = 1.0, top yüzeyi): 15 m/s ~0.4 m, 25 ~0.65 m, 32 ~0.8 m. En derine 5–9 kare. Geri tepme ≤ 0.54 m/s. exitBack hep false.

## API (CONTRACT'ta kullanılanlar)
- `kick(v, w)`: v ve w `{x,y,z}` ya da `[x,y,z]`. Konum değişmez. scored ve olay bayraklarını sıfırlar, holdBall'u kapatır, `shots++` yapar.
- `placeBall(x, z)`: plakaya kısıtlar, hız ve spini sıfırlar.
- `holdBall(on, x?, y?, z?)`: on iken top fizik dışı, verilen konumda.
- `onEvent(fn)` → `{type, speed?, side?, line?, x?, z?, id?, tag?}`. type: gol | direk | ust-direk | ag | aut (line yan/kale) | durdu | kafes | nesne | oyuncu. 'oyuncu' her temas başında gelir; diğerleri vuruş başına bir kez (`fired` kümesi).
- `predictTrajectory(start, v, w, steps, dt, ground?)`: saf fonksiyon, `Float32Array(steps*3)` döner. Hem export hem `world.` metodu.
- `setDynamicColliders([{a, b, r, vx, vy, vz, e, mu, tag, id}])`: her kare çağrılır. Kapsül alt adımda a + v·dynT ile ilerler. Hızı topa aktarılır (hareketli yüzey: göreli hızla `contactImpulse`).
- `staticColliders`: D'nin `env/colliders.ts` dosyasından (rect, box, capsule). Yalnız top plakanın kenarına 0.5 m kalınca test edilir. Rect için sürekli çarpışma var.
- Public alanlar: `pos` (kimliği sabit, VAR `pos.set` yapıyor), `renderEdges`, `invMass`, `capsules` (direkler; indeks % 11 < 2 direk, = 2 üst direk), `ball`, `netContact`, `goalRanges`, `time`, `goals`, `shots`, `side`, `timeScale`, `seed(n)`, `lastShot`. `world.step(dt)` imzası değişmez; dev paneli onu sarmalıyor.

## Test komutları (`viewer/` içinde, başlarına `nice -n 19`)
- `npx -y tsx scripts/sim-test.mjs 200 1`: NaN, ağdan kaçma, dışarıdan sızma, gol uyumu, torba derinliği, kare ms ve olay testi. Beklenen: hepsi 0 ya da %100.
- `npx -y tsx scripts/koord-net-probe.mjs`: önce/sonra tablosu.
- Görsel: `scripts/run-browser.sh node <film betiği>`. Örnek betik `/tmp/claude-1000/.../scratchpad/film.mjs` geçicidir; deseni şöyle: sayfadaki gerçek sim modülünü `performance.getEntriesByType('resource')` ile bul ve `import(u)` et. `/src/sim.ts`'i doğrudan import etme: HMR `?t=` yüzünden AYRI bir world örneği gelir. Sonra `world.timeScale = 0` yapıp elle `step` et, ekran görüntüsü al. Kamera: `window.dispatchEvent(new CustomEvent('rig', {detail: 2}))` (2 = Yan ağ).

## Açık sorunlar
- Ağ uyurken rüzgâr salınımı da duruyor.
- Görsel ağ hızlı ve yüksek şutların ~%15'inde topu bir anlığına bırakıyor (en yakın düğüm > 0.2 m). Torba fiziği doğru, görsel kısa süre geride kalıyor.
- Üst direkten dönüp kale içine yüksekten düşen top yerden normal sekiyor (doğru davranış); nadiren kale çizgisine kadar çıkabiliyor.
- Kare süresi: 1–1.5 ms ortalama, p95 ~2.4 ms. Ölçümler makine yükü 40+ iken alındı; sakin makinede ~0.9 ms.
- F2'nin `worldApi.ts`'i olayları string bekliyordu; nesneye (`ev.type`) geçip geçmediğini kontrol et.

## Tuzaklar
- `NetBuild` nesnesine alan eklersen kurucu (`sim.ts`) ve `net.ts` TEK yazmada birlikte değişmeli. Ara durumda Firefox açılışta çöktü (`B.nrm` undefined).
- Ağ temasında dinlenme normaline göre taraf testi, ağ topu sarınca belirsizleşir (sn ≈ 0). Yalnız |s0| > 0.4·RC iken kullan.
- Arka yüzde eğik normalle itmek topu yere bastırıp sektirir. Yatay kalmalı.
- `faceSide`'ı her alt adımda güncelleme; yalnız uzaktayken güncellenir. Yoksa top ağdan geçer.
- Görsel ağı top fiziğine bağlama (iki yönlü). Kütle oranı tünellemeye yol açar.
