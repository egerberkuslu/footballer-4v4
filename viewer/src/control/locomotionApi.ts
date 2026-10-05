// Hareket/aksiyon arayuzu (F). J (AI) ve K (kurallar) bu dosyaya gore yazar; uygulama control/locomotion.ts.
//
// stepLocomotion(gdt): React'siz saf adim. game.inputs -> game.players (+ world.kick, game.emit).
//   <Locomotion /> bunu useFrame(-15) ile gdt = min(dt,1/30) * world.timeScale ile cagirir. gdt<=0 ise hicbir sey yapmaz.
//
// AKSIYON SEMANTIGI (PlayerInput.action)
//   Aksiyon AYNI karede tuketilir: locomotion okur ve game.inputs[id].action = null yazar (kabul edilmese de).
//   actionLock > 0 iken yeni aksiyon ve hareket yok sayilir.
//   Topa temas, animasyondaki vurus aninda olur (anim/timing.ts CLIP_LEN): sut/asirtma kickContact 0.28 s, pas passContact 0.22,
//   tackle 0.18, slide 0.25 (pencere 0.15..0.6), header 0.38, dive yatay en uzak an 0.40. O an hasBall/menzil yeniden denetlenir.
//   Dusme: fall 1.0 s + getup 1.1 s (actionLock 2.1). Dalis: 0.9 s + getup 1.1 s (kilit 2.0).
//   'shoot' : aim = rakip kale duzleminde hedef nokta (x = kale cizgisi, y, z). power 0..1 -> V_MIN..V_MAX (8..34 m/s).
//             spin.y falso olarak cozucuye verilir (CURL_W=48 rad/s tam falso, %80 telafi); yoksa hafif ust donme.
//   'pass'  : aim = topun yerde varacagi nokta (alici ya da onu). power <= 0: hiz mesafeden otomatik (top hedefe ~4.5 m/s ile varir);
//             power > 0: sutla ayni olcek V_MIN..V_MAX (v = 8 + 26*power). Yerden pas.
//   'lob'   : aim = topun inecegi nokta; ~40 derece, hiz otomatik. power yok sayilir.
//   'tackle': ayakta; TACKLE_REACH icindeki topa uzanir (top y < 0.6). Topu alirsa hasBall, yoksa kisa dokunusla uzaklasir.
//             Rakip 1 m icindeyse 'contact' (kind 'tackle') yayar. Kilit TACKLE_LOCK.
//   'slide' : aim yonunde SLIDE_DIST kayar; yoldaki topu (ayak 0.7 m) iter; kilit SLIDE_LOCK (sonunda 'getup').
//             Yoldaki rakibe 'contact' (kind 'slide').
//   'header': top y 1.1..2.5 ve yatayda HEADER_REACH icindeyse aim'e dogru kafa vurusu (power -> 8..18 m/s).
//   'dive'  : yalniz kaleci; aim = uzanacagi nokta (x,y,z). DIVE_DIST'e kadar 0.35 s'de uzanir, sonra yerde.
//             Kalecinin top yakalama/cikarmasi OTOMATIKTIR (dive sirasinda ya da ayaktayken kendi ceza alaninda):
//             menzilde ve top hizi < CATCH_SPEED ise tutar (hasBall, world.holdBall), degilse cikarir. touch 'save' yayar.
//
// SAHIPLIK VE SURME
//   hasBall: top ayak noktasina (oyuncunun 0.35 m onu) TRAP_DIST'ten yakin, top y < 0.5, goreli hiz < TRAP_SPEED iken alinir
//   (touch 'trap'). Ayni anda tek sahip; sahip elinden alinan top yalniz tackle/slide/govde itisi ya da kacirma ile.
//   Surme otomatiktir: hasBall + move != 0 ise kosu ritmiyle ileri kucuk dokunuslar (touch 'dribble'), top 0.5..1.5 m onde
//   (hizla acilir). Sert donuste top kacabilir. Top LOSE_DIST'ten uzaga giderse hasBall=false.
//   Topu tutan kaleci: move ile yurur, pass/lob/shoot ile birakir.
//
// TOP KONTROLU (ilk dokunus, otomatik): top y < 1.6 ve govdeye/ayaga yakinken alinir. Yukseklige gore anim
//   'trap-foot' (y<0.35) / 'trap-thigh' (<0.95) / 'trap-chest'. Gelen hiz sondurulur, top ayagin onune duser.
//   Kotu ilk dokunus olasiligi: goreli hiz, ters aci (arkadan gelen), dusuk stamina ve yukseklikle artar;
//   kotu dokunusta top 1-2 m seker (sahiplik yok, kisa sure alinamaz). Insan: ilk dokunus yonu hareket girdisi.
//
// IKILI MUCADELE (otomatik): rakip iki oyuncu paralel kosarken (>2.5 m/s, top 4 m icinde) kapsuller birbirini iter;
//   'shoulder' animasyonu, contact kind 'shoulder' (yasal omuz mucadelesi). Guc = hiz, stamina, topa sahiplik;
//   guc farki buyukse zayif olan 'stumble' (STUMBLE_LOCK) ve top elinden cikabilir. Paralel olmayan itis 'body'.
//   'shield': topa sahip oyuncu yavaskken (<2.5 m/s) rakip 1.6 m icindeyse sirtini doner, topu uzak ayakla korur.
//
// KALECI (otomatik + 'dive'): duruslar 'keeper-ready' (top 25 m icinde), 'keeper-shuffle-l/r' (yavas yan adim),
//   bire birde 'keeper-spread' (rakip topla 4 m icinde; yavas, govde genis kapsul).
//   'dive' -> 'keeper-dive-low-l/r' (aim.y <= 1.0) ya da 'keeper-dive-high-l/r'; yatay en uzak an 0.40 s, kapsul yatay.
//   Ulasim: ayrica el kapsulu (ayakta omuz hizasinda yatay, dalista govdenin ucunda). Top el alaninda:
//     hiz < CATCH_SPEED -> tutar ('keeper-catch-high' y>1.2 ya da 'keeper-collect'), sonra elde 'keeper-hold' (holdBall);
//     hiz < PUNCH_SPEED -> 'keeper-punch' (sahanin icine/yana sektirir); daha hizli -> yalniz kapsul carpismasi.
//   Elde top: 'pass' -> 'keeper-throw' (temas KEEPER_THROW_CONTACT), 'shoot'/'lob' -> 'keeper-kick' (vole, KEEPER_KICK_CONTACT).
//
// HIZLAR (m/s, stamina 1): RUN_SPEED (move=1), SPRINT_SPEED; topla DRIBBLE_MUL carpani. Kaleci KEEPER_MUL.
//   Ivme ACCEL, yavaslama DECEL, donus TURN_RATE (rad/s, hizla azalir). Stamina sprintte azalir, yururken dolar.
//
// OLAYLAR (game.emit): 'touch' {player, kind}; 'contact' {a,b,ballFirst,fromBehind,intensity,kind,x,z}
//   (oyuncu-oyuncu: govde itisi kind 'body', intensity goreli hiz/8, 0.25 alti yayilmaz).
//
// KONTROL / KURALLAR
//   setControlled(id): insan kontrolunu bu oyuncuya gecirir (tek kontrollu oyuncu). K duran topta bunu cagirabilir.
//   Duran top (phase !== 'play'): kimse hasBall almaz/surmez; kullanan durgun topa 1.1 m'den sahipliksiz vurur.
//   Insan girdisi (F): phase !== 'play' iken yalniz restart?.taker === kontrol edilen ise hareket+aksiyon; degilse bos. K oyunculari yerlestirirken p.x/p.z/p.facing yazabilir (vx,vz'yi sifirla).
//   Mod: control/store ctl.mode ('antrenman' | 'mac'). Antrenmanda AI ve kurallar calismamali (playMode() ile oku).

export const V_MIN = 8
export const V_MAX = 34
export const CONTACT_DELAY = 0.28 // s (sut; digerleri yukarida)
export const RUN_SPEED = 6.2
export const SPRINT_SPEED = 8.0
export const DRIBBLE_MUL = 0.85 // topla, sprintsiz
export const SPRINT_DRIBBLE_MUL = 0.92 // topla sprint
export const KEEPER_MUL = 0.9
export const ACCEL = 20 // duyarli: yon degisiminde ~0.15-0.2 s
export const DECEL = 32
export const TURN_RATE = 16
export const TRAP_DIST = 0.55
export const TRAP_SPEED = 9
export const LOSE_DIST = 2.2
export const TACKLE_REACH = 1.3
export const TACKLE_LOCK = 0.7 // temas 0.22 + iskada ~0.45 toparlanma (klip 0.75; basarida 0.3)
export const SLIDE_DIST = 3.5
export const SLIDE_LOCK = 1.8 // hazirlik 0.15 + kayma 0.5 + oturus; getup 0.8'de baslar, iskada kilit 1.8 s (temasta ~1.5)
export const SLIDE_GETUP_AT = 0.8 // iskada getup baslangici (animT); klip 0.8 s
export const HEADER_REACH = 0.9
export const DIVE_DIST = 2.6
export const CATCH_SPEED = 19

export const PUNCH_SPEED = 32
export const STUMBLE_LOCK = 0.6
export const TRAP_ANIM_T = { foot: 0.3, thigh: 0.45, chest: 0.55 }
export const KEEPER_CATCH_T = 0.6 // catch-high / collect klibi, sonra keeper-hold
export const KEEPER_PUNCH_T = 0.5
export const KEEPER_THROW_T = 0.8
export const KEEPER_THROW_CONTACT = 0.35
export const KEEPER_KICK_T = 0.9
export const KEEPER_KICK_CONTACT = 0.45

// top surme / savunma hissi
export const SPRINT_ESCAPE = 0.18 // sprintle surmede sert (>75 derece) donuste topun kacma olasiligi
export const JOCKEY_DIST = 1.5
export const JOCKEY_SPEED = 3.2
export const TACKLE_LUNGE = 3.2 // m/s, 0.22 s atilma (~0.6 m)
export const TACKLE_LEG = 0.5 // bacak uzanimi
export const TACKLE_HIT_R = 0.3 // bacak boyunca topa ulasma toleransi (ayak dahil; surucu topu 0.44-0.57 m onde)
export const SLIDE_PREP = 0.15
export const SLIDE_LEG = 0.85
export const SLIDE_HIT_R = 0.55
