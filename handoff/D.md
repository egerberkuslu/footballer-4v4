# D → D2-ortam devir notu (ortam, ışık, kamera altyapısı, seyirci; artık çim ve kale görseli de sende)

## Dosyalar (`viewer/src/env/*`, `src/index.css`, `public/env/*`)
- `Surroundings.tsx`: zemin halkaları (beton/çakıl/dış çim, plakanın dışı), tel örgü kafes (direk + boru instanced, 4 panel tek mesh), birleşik donatılar (`Props`: bordür, 4 projektör, kulübe, bank, çöp kutusu, 3 basamaklı tribün + korkuluk; malzeme başına tek draw call), ağaçlar (Flux sprite, tür başına 1 InstancedMesh, CPU'da kameraya dönen billboard), binalar (3 birleşik geometri: sıva/tuğla/çatı, bina rengi vertex renginde), seyirciler (ModelBoundary + Suspense içinde).
- `colliders.ts`: TÜM yerleşim sabitleri (FENCE_*, FLOODLIGHTS, DUGOUT, BENCH, BIN, CURB, TRIBUNE) + `STATIC_COLLIDERS` (saf veri, three/React yok). `sim.ts` (B2) ve `dev/StaticColliders.tsx` bunu okur. Görselde konum değiştireceksen SABİTİ değiştir; görsel ve çarpışma birlikte kayar.
- `merge.ts`: `mat/mul/mergeParts` (parça listesini malzeme başına birleştirir).
- `textures.ts`: yordamsal canvas dokular (tel örgü elle kurulmuş mip seviyeleriyle → uzakta hare yok; beton, çakıl, dış zemin, cephe).
- `Lighting.tsx`: saate göre gök (drei Sky ya da gece gradyan kubbe + Stars), güneş (sabit ±34×±30 m gölge kutusu, kamerayı izlemez), `<Environment frames={1}>` (saat değişince `key` ile bir kez yeniden üretilir; CDN yok), hemisphere, gece `Floodlights`.
- `timeOfDay.ts`: `?time=gunduz|aksam|gece` + `get/set/subscribeTimeOfDay` + `TOD` ayar tablosu (güneş yönü, renk, şiddet, gök, sis, env, hemi). `TimeOfDayPicker.tsx` HUD'da (F2 yerleştirdi, N tuşu).
- `Effects.tsx`: N8AO (yalnız q=high, yarım çöz.), Bloom (mipmapBlur), AgX ToneMapping, HueSat/BrightContrast, SMAA, Vignette. `?fx=0` kapatır, `?fx=tm,bloom,grade,vig,ao` seçer.
- `quality.ts`: `?q=low|med|high` (gölge haritası, dpr, efektler).
- `Spectators.tsx`: 16 seyirci (tribün 8 oturan + 2 ayakta, kafes dibi 2, bank 2, kulübe 2).
- `public/env/tree_*.png`: Flux ile üretilmiş, gri artıkları temizlenmiş ağaç sprite'ları.
- Kamera presetleri `CameraRig.tsx` artık F2'nin (kamera F'ye geçti); App.tsx F2'nin.

## Durum (hepsi çalışıyor, görüntüyle doğrulandı)
- Gündüz/akşam/gece: `shots/D-t2-{gunduz,aksam,gece}-cam{0,3,4}.png`. Akşam alçak turuncu güneş + uzun gölgeler; gece 4 SpotLight, yalnız 2'si gölgeli ve bu 2 gölge kamera hedefine en yakın direklere TAŞINIR (ışık sayısı sabit → yeniden derleme yok), lamba camı emissive (bloom).
- FPS (gerçek GPU 1080p, dpr 1): her saat ve kamerada 156–282 fps.
- Seyirci renkleri DÜZELDİ. `I-27.png`'deki siyah siluet, düzeltmeden önce (00:39) alınmıştı. Sebep vertexColors değil: React StrictMode `useMemo`'yu iki kez çağırıyordu, instanced renk attribute'ları paylaşılan geometriye bağlanınca ikinci çağrı birincisinin attribute'larını eziyordu. Çözüm geometri `.clone()`. Seyirci malzemesi yeni bir MeshStandardMaterial ve vertexColors kullanmıyor (GLB'deki COLOR_0 pişirmede kopyalanmıyor). Maç modunda aynı açıdan doğrulama: `shots/D-sp6.png`. Yakın planlar: `D-sp4.png` (gece), `D-sp2.png` (bank), `D-sp5.png` (gol sevinci, `?seyirci=sevinc`).
- Firefox diag temiz.

## Seyirci mimarisi (dokunmadan önce oku)
- E'nin `futbolcu_lod1.glb`'si yüklemede `SkeletonUtils.clone` edilir, I'nın `RigDriver` + `Pose/applySpec` ile 8 poz uygulanır, her vertex `getVertexPosition` ile CPU'da deriye bağlanır. Normal, ofsetli noktanın `applyBoneTransform`'u ile bulunur. Her poz statik geometri olur.
- Her poz tek InstancedMesh, tek ortak malzeme (`onBeforeCompile`): vertex `part` (0 ten, 1 üst, 2 alt, 3 çorap, 4 ayakkabı, 5 saç). Kit bölgesi `human/kit_layout.json` UV dikdörtgenlerinden (Blender v = 1 − glTF v). Örnek başına `iSkin/iTop/iBottom/iSocks/iHair` instanced attribute. Ten bölgesi gövde albedo dokusu × ten tonu.
- Her kare kişiler pozlarına göre yeniden paketlenir (`count`, boş poz `visible=false`). Gol: `world.onEvent('gol')` ya da `game.on('goal')` → 4,5 s ayağa kalk + kollar yukarı + zıpla.

## Sıradaki işler (öncelik sırasıyla)
1. Seyirciyi yakından daha inandırıcı yapmak: şu an forma kalıbı (şort + tozluk) taşıyorlar. Pantolon için alt bölgeyi bacağa uzatmak (ten bölgesinde diz altı vertex'leri `part=2` yapmak: bind pozunda y < diz ve ten ise) kolay bir kazanç. Ceket ya da şapka varyantı yok. Boy 0.94–1.04 arası değişiyor.
2. Gece: kulüp binası cephesi projektör saçılmasından fazla aydınlık; binalara gece için ayrı karartma (`TOD.gece` iken bina malzemesi rengi) ya da spot `distance` sınırı. İstenirse projektör başı için ince ışık konisi (volumetrik hile, additive koni) eklenebilir.
3. Akşam: gök biraz daha turuncu ve sis daha sıcak olabilir; şimdi makul.
4. Uzun kenar: tribün + kulüp binası var. Tribüne çatı (çelik makas + polikarbonat) eklenebilir. Merge ile ucuz.
5. Çim ve kale görseli (A ve C'nin işleri, artık sende): `src/grass/*`, `src/goal/*`, `PitchGrass.tsx`, `Goal.tsx`, `Ball.tsx`. Önce kendi devir notlarına ya da CONTRACT'a bak (A ve C devir notu yazmamış olabilir). Bilinen not: top altındaki beyaz disk (temas gölgesi) bazen beyaz halka gibi görünüyor.
6. Draw call: çevre ~25 nesne. Sahne toplamının büyük kısmı karakterler ve kalelerden gelir.

## Tuzaklar
- **StrictMode + useMemo yan etkisi**: memo içinde sahne grafiğine ekleme ya da paylaşılan nesneye attribute bağlama YAPMA. Player'da da aynı hata vardı (model görünmüyordu).
- **MSAA + Bloom(mipmapBlur) = siyah kare** (headless Vulkan'da kesin görüldü). EffectComposer `multisampling={0}` kalmalı, kenar yumuşatma SMAA ile.
- **Tel örgü haresi**: `chainLinkAlpha` mip seviyeleri elle kuruludur; anizotropiyi artırma, otomatik mipmap'e dönme.
- **Gece ışık sayısı**: gölgeli spot sayısını kare içinde değiştirme (tüm malzemeler yeniden derlenir). Sabit 4 spot ve 2 gölge tut, yalnız konumlarını taşı.
- **Environment** `frames={1}`: değişiklik `key` ile yeniden bağlanmadan yansımaz.
- **`hemisphereLight args`** yalnız kurulumda okunur → `key` ile yeniden kur.
- `window.__r3f` onCreated anındaki anlık görüntüdür; canlı durum için `__r3f.get()` kullan (`controls` aksi halde null).
- Sayfa ilk yüklemede ~10–15 s sürüyor (ön ısıtma): test betiklerinde `--wait 16000`.
- `pitch.ts` sabitleri ortak sözleşme; `paintPitch` A'nındı (artık sende).

## Test komutları (viewer/ içinden)
- Tip: `npx tsc -b` (diğer ajanların geçici hataları olabilir; `| grep src/env` ile süz).
- Gerçek GPU görüntüsü: `GPU=1 scripts/run-browser.sh node scripts/.d-shot.mjs shots/X.png --q "blades=20000&time=gece" --wait 16000 --after 2500 --eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Tribün')?.click()"`
- Serbest kamera açısı: eval içinde `const s=__r3f.get(); s.camera.position.set(...); s.controls.target.set(...); s.controls.update()` (CameraRig ezmesin diye `setInterval` ile tekrarla). Hazır betik: `/tmp/claude-1000/-home-ege-Blender-MCP/d4aa7604-52b1-4a9f-9df8-92a5ec2eed15/scratchpad/look.sh <ad> <sorgu> px py pz tx ty tz` (geçici dizin; silinmişse yukarıdaki kalıbı kullan).
- FPS (1080p, gerçek GPU): `scripts/run-browser.sh node scripts/.d-fps.mjs "time=gece"` (Tribün / Şutçu arkası / Yayın).
- Firefox: `scripts/run-browser.sh node scripts/diag-ff.mjs` → `shots/koord-ff.png`.
- Kalite: `?q=low|med|high`, `?fx=0`, `?time=...`, `?seyirci=sevinc`, `?dev=1` (dev paneli, collider çizimi).
- Düzenleme kuralı: yeni dosyayı `src/env/_X.tsx` adıyla yaz → tsc → `mv` ile yerine koy (kullanıcı Firefox'ta canlı izliyor).
