# L-mp devir notu (çok oyunculu, src/mp) → L2-mp

## Durum: çalışıyor, `scripts/mp-test.mjs` 14/14 geçti
- Dev sunucuda geçti.
- Derlenmiş sitede de geçti: HTTPS, alt yol `/futbol/`, PeerJS bulutu ve `?oda=KOD` bağlantısıyla katılma.
- Derlenmiş sitede başkalarının mutlak varlık yolları 404 veriyor (açık iş 1). Bu yüzden testte o varlıklar köke bağlandı (symlink).
- App bağlantısı (F) tamam. MatchControl'de `lockedPlayer`/`isGuest` kancaları, AI'da (J) `isRemoteHuman`/`game.remote` atlaması ve VAR misafir kancası (G) var.
- Host arka plan tick'i yapıldı ve test edildi. İzleyicide güç/kondisyon paneli gizlendi (F).

## Mimari (host-otorite)
- `role.ts`: `net.role` ('off' | 'host' | 'guest'), `localPlayer`, `remote`. Bağımlılıksız; F, J ve G bunu okur.
  `keep()` oturum durumunu globalThis'te tutar. HMR'de modül yeniden çalışınca oda düşmesin diye var; KALDIRMA.
- `protocol.ts`: mesaj tipleri, doğrulama (`decodeGuest`/`decodeHost`), snapshot düzeni (`P_STRIDE` = 11), `PROTO`/`BUILD` sürüm kontrolü.
- `transport.ts`: PeerJS.
  - Peer id `futbol4v4-<KOD>`, json serileştirme, tek güvenilir kanal.
  - Misafir 30 s yeniden bağlanmayı dener; katılma zaman aşımı 30 s.
  - URL seçenekleri: `?peer=local` (127.0.0.1:9000), `?peer=host:port`, `?peerdebug=3`.
- `session.ts`:
  - Lobi; üye id = sekme anahtarı (sessionStorage), yeniden bağlanan aynı oyuncuya döner.
  - Ayarlar, kick/ban, sohbet, emoji, maç başlat/bitir.
  - Uzak oyuncular `net.remote` ve `game.remote` kümelerinde, ikisi birlikte güncellenir.
  - VAR: host `varState.case`'i gönderir, misafir `startRemoteReview`/`endRemoteReview` çağırır.
  - Geçişler `withCurtain` (M) ile sarılı.
- `sync.ts`:
  - Host -22: uzak girdiyi yazar (aksiyon bir kez uygulanır; izin yokken gelen aksiyon atılır).
  - Host -0.4: 20 Hz snapshot gönderir.
  - Misafir -29: girdi gönderir (30 Hz) ve kendi oyuncusunu tahmin eder (locomotion `move()`'un sade kopyası).
  - Misafir -14: 100 ms gecikmeli enterpolasyonla durumu yazar, olayları host zamanıyla emit eder ve seslendirir.
  - Uzlaştırma `ack` + `ag`'ye göre (girdinin host'ta uygulandığı süre).
- `NetSync.tsx`: useFrame kancaları ve `holdLock`.
  `bgTick.ts`: host sekmesi gizliyken Worker 60 Hz'te öncelik ≤ 0 aboneleri koşar; gl.render olmaz.
- `Lobby.tsx` + `mp.css`: ana menü, giriş, lobi, maç içi rozet/sohbet/emoji balonları.
  Menü yalnız parametresiz adreste ya da `?menu=1` ile açılır, diğer ajanların testlerini engellemez.

## Sıradaki işler (öncelik sırasıyla)
1. **GitHub Pages göreli yollar.** Benim dosyalarım temiz. Başkalarının dosyalarında `${import.meta.env.BASE_URL}…` yapılmalı (koordinatöre bildirildi):
   - Characters.tsx:16-17
   - env/Spectators.tsx:16
   - ui/Warmup.tsx:181
   - characters/kit.ts:170
   - env/Surroundings.tsx:316-318

   `vite.config.ts`'e `base: './'` eklenmeli (dosyanın sahibi koordinatör). Bunlar yapılınca derlenmiş siteyi symlink OLMADAN tekrar test et (aşağıdaki komut).
2. **Otomatik VAR'ı iki tarayıcıda dene.** Şimdiye dek yalnız protokol düzeyinde denendi (host'tan sentetik çizgi vakası).
   Gerçek tetiklemek için host'ta topu kale çizgisini kıl payı geçecek biçimde yavaş gönder ya da ince bir ofsayt kur. Sonra misafirde `__var.state.active` ve `case.kind`'a bak; görüntü al.
3. (İsteğe bağlı) Ağır kayıp için ikinci, güvenilmez kanal (snapshot ve girdi). Şu an enterpolasyon ve 0,25 s ileri tahmin örtüyor.
4. (İsteğe bağlı) Host arka plan tick'i gerçek Firefox'ta gizli sekmeyle elle doğrulanmadı. Başsızda rAF durdurulup `document.hidden` taklit edilerek test edildi.

## Tuzaklar
- Testi GERÇEK GPU ile koş (mp-test varsayılanı gl-egl). SwiftShader'da host ~0,5 fps olur; oyun zamanı kare başına en çok 1/30 s ilerlediği için hareket ve gol testleri boşuna kalır.
- Başsız Chromium'da `--disable-features=WebRtcHideLocalIpsWithMdns` gerekli (betikte var).
- Diğer ajanların düzenlemeleri Vite'ta tam sayfa yenilemesine yol açabilir ve test "Execution context was destroyed" ile düşer. Tekrar koş.
- Duran topta (`phase !== 'play'`) yalnız kullanan oyuncu hareket eder. Testler 'play'i bekleyip yeniden deniyor.
- Misafirde Rules ve TeamAI mount edilmez. `rules.banner` snapshot'tan yazılır; `rules` örneğinin kuyrukları misafirde boşaltılmaz (küçük, zararsız).
- Host'ta `rules.start()` sonrası `game.match.halfLength` ve `rules.d.halfLength` elle ayarlanıyor (lobideki devre süresi).

## Test komutları
- Tip: `cd viewer && npx tsc -b`
- Çok oyunculu (dev): `scripts/run-browser.sh node scripts/mp-test.mjs --shots shots/mpX`
- Yerel sinyal sunucusuyla: önce `npx -y peer --port 9000` (iş bitince kapat), sonra `... mp-test.mjs --local`
- Derlenmiş site (HTTPS alt yol):
  1. `npx vite build --base ./ --outDir <scratch>/site/futbol --emptyOutDir`
  2. Kendinden imzalı sertifika + küçük node https sunucusu: önceki oturumdaki `scratchpad/https-serve.mjs` deseni (openssl `req -x509 …`), örn. `node https-serve.mjs <scratch>/site 8443`
  3. `... mp-test.mjs --url https://127.0.0.1:8443/futbol/`
- Firefox: `scripts/run-browser.sh node scripts/diag-ff.mjs`
- Görüntüler: `shots/mp4-var-guest.png`, `shots/mp3-chat-host.png`, `shots/mp2-lobby-*.png`, `shots/mp-menu.png`
