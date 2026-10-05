# QA turu 2 (01:15–01:30) — O: senaryolu kural akışları

Yöntem: `scripts/qa-scenarios.mjs` (gerçek GPU). Topu, son dokunanı ya da birkaç oyuncunun konumunu ayarlayıp gerçek kural + AI + klavye/fare akışını izler. Penaltı senaryosunda temas olayı elle yayıldı (hakem kararı gerçek). Kanıtlar `qa/r2-senaryo/`, `qa/r2-var/`.

| Akış | Sonuç | Ayrıntı |
|---|---|---|
| Taç (ayakla) | geçti | doğru takım (1), AI kullandı, oyun devam; VAR başlamadı |
| Korner | geçti | savunan son dokundu → rakibe korner, kullanan bayrakta (03-korner-hazir) |
| Ofsayt (net, 1,87 m) | geçti | insan K + fare ile pas; endirekt serbest vuruş, VAR yok |
| Ceza sahasında faul → penaltı | geçti | insan Boşluk ile kullandı, kaleci kurtardı |
| Net aut → kale vuruşu | geçti | VAR yok |
| AI kaleci 3 s | geçti | 1,8 s'de bıraktı |
| İnsan kaleci 3 s kuralı | doğrulanamadı | 3,0 s'de AI oyuncu 6 elinde top olan kaleciye faul yaptı (C4 tekrarı) |
| Gol sonrası elle VAR (X) | geçti | listen → koşu → monitör → işaret → karar 'gol' → santra |
| Elle VAR, pozisyon yokken | doğru | "İncelenecek pozisyon yok" (tasarım) |
| Otomatik kıl payı çizgi VAR | doğrulanamadı | sahnelenemedi; G'ye soruldu |

## Yeni bulgular
- **(K, orta)** Elle VAR'da hakem dinledikten sonra önce monitörün tersine ~10 m koşuyor, 2,5 s sonra dönüyor; monitöre varış 5,0 s.
- **(G, kozmetik)** Açık golde VAR kararı "+0,42 cm" gösteriyor (geçiş karesi payı), kıl payı izlenimi veriyor.
- **(E, ciddi-görsel)** VAR monitör yakın çekiminde saç tırtıklı kenarlı lastik başlık gibi (05-var-var-var-monitor.png).
- **(F, kozmetik)** "Duran top kuruluyor…" ipucu VAR tam ekranında da görünüyor.
- **Tasarım riski (K/F)**: insan serbest vuruş/taç/kornerde 3 s içinde kullanmazsa top rakibe geçiyor (RESTART_LIMIT=3).

## Düzelenler (regresyon)
- C5 seyirciler: artık renkli formalı, kol kaldırıp tezahürat eden figürler (qa/r2-var/02). Kapandı.
- tsc temiz.
