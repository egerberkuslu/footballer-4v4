# Devir kuralları (Opus -> Sonnet)

Kullanıcı (Ege) tüm ajanların Sonnet olmasını istedi. Eski Opus ajanlar mevcut adımı bitirip `handoff/<ROL>.md` yazar; yeni Sonnet ajan o notu okuyup devam eder.

## Ad eşlemesi (mesajları YENİ adlara gönder)
| Eski | Yeni | Alan |
|---|---|---|
| B-fizik | B2-fizik | top, ağ, çarpışma (src/sim*) |
| D-ortam | D2-ortam | ortam, ışık, seyirci, çim, kale görseli (A ve C emekli, işleri buraya) |
| E-insan | E2-insan | Blender model hattı (footballer/human) |
| F-kontrol | F2-kontrol | girdi, hareket, top aksiyonları, kamera, HUD, App |
| G-var | G2-var | VAR (src/var) |
| I-anim | I2-anim | karakter ve animasyon (src/anim, src/characters) |
| J-ai | J2-ai | takım yapay zekâsı (src/ai) |
| K-hakem | K2-hakem | kurallar, hakem, ses (src/rules, src/referee) |
| L-mp | L2-mp | çok oyunculu (src/mp) |
| M-yukleme | M2-yukleme | yükleme ekranı ve ön ısıtma (src/ui) |
| N-kumas | N2-kumas | gerçek zamanlı kumaş (src/cloth) |
| O-qa | O2-qa | kalite testi (scripts/qa-*, qa/) |
Eski adlara mesaj gönderme: o ajanlar emekli, uyandırırsan Opus çalışır.

## Değişmeyen kurallar
- CONTRACT.md tamamı geçerli (dosya sahipliği, kare sırası: pozitif useFrame önceliği YASAK, ortak tipler yalnız koordinatör).
- Başsız tarayıcı: `scripts/run-browser.sh node scripts/<betik>.mjs ...` (2 yuvalı kilit + nice 19). Node testleri `nice -n 19`. Gerçek GPU için C'nin `shots/gshotC.mjs` ya da D'nin `scripts/.d-shot.mjs` (GPU=1) deseni; SwiftShader fps'i anlamsız.
- Kullanıcı Firefox'ta canlı oynuyor: ara durumda sayfa kırılmasın. Yeni kodu ayrı dosyada tsc ile doğrula, sonra tek yazmayla bağla (tmp + mv). Firefox kontrolü: `scripts/run-browser.sh node scripts/diag-ff.mjs`.
- git komutu çalıştırma (koordinatör repoyu en sonda kurar). `npm install` yapma (gerekirse koordinatörden iste).
- Kod yorumları ve arayüz metinleri Türkçe. Kullanıcı görüntüyle yargılar: her değişiklikte görüntü al, Read ile incele.
- Sahte "geçti" yazma; doğrulayamadığını "doğrulanamadı" de.
- Kullanıcının son geri bildirimleri (öncelikli): top sürme, savunma (jockey), ayakta ve kayarak müdahale çok kötü; formalar gerçek zamanlı kumaş olmalı; 3 s kuralları (kaleci ve duran toplar); VAR yalnız kale çizgisi kıl payı ve ince ofsayt, taçta yok, hakem monitöre gider; yükleme ekranı; gerçekçi görünüm; 60 fps.
- Hedef: sabaha kadar oyunu mükemmelleştirmek; en sonda GitHub deposu ve Pages.
