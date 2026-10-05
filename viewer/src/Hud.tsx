import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { CAMERA_NAMES, SHOOTER_CAM } from './CameraRig'
import { autoShot, chargeSpeed, overchargeSigma, resetSpot, switchMode } from './control/actions'
import { toggleCam } from './control/ShotController'
import { CURL_STEPS, V_MAX, V_MIN, bumpCtl, ctl, ctlVersion, shotType, subscribeCtl } from './control/store'
import './control/shot.css'
import { TimeOfDayPicker } from './env/TimeOfDayPicker'
import { getTimeOfDay, setTimeOfDay } from './env/timeOfDay'
import { game } from './game/store'
import { lockedPlayer } from './mp/role'
import { world } from './sim'
import { actionLabel, getPadInfo, getSettings } from './control/gamepadConfig'

const TYPE_NAMES = { normal: 'Normal', asirtma: 'Aşırtma', yerden: 'Yerden sert' } as const

// guc bari: her karede DOM'a dogrudan yazilir (React render'i yok)
function PowerBar() {
  const fill = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let id = 0
    const loop = () => {
      const c = ctl.charge
      const f = fill.current
      if (f) {
        const k = c < 0 ? 0 : Math.min(1, c)
        f.style.transform = `scaleX(${k})`
        f.classList.toggle('over', overchargeSigma(c) > 0)
        f.classList.toggle('shake', c > 1)
      }
      // asirtmada guc aciyi belirler (60 -> 40 derece)
      if (label.current)
        label.current.textContent =
          c < 0 ? '' : shotType() === 'asirtma' ? `${Math.round(60 - 20 * Math.min(1, c))}°` : `${Math.round(chargeSpeed(c) * 3.6)} km/sa`
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
  // kirmizi bolge: sapmanin basladigi yer
  const red = (1 - 0.88) * 100
  return (
    <div className="power">
      <div className="track">
        <div className="red" style={{ width: `${red}%` }} />
        <div ref={fill} className="fill" />
      </div>
      <span ref={label} className="pv" />
    </div>
  )
}

function CurlGauge({ curl, wheel = false }: { curl: number; wheel?: boolean }) {
  const cells = []
  for (let i = -CURL_STEPS; i <= CURL_STEPS; i++) {
    if (i === 0) {
      cells.push(<i key={i} className="mid" />)
      continue
    }
    const on = (i < 0 && curl <= i) || (i > 0 && curl >= i)
    cells.push(<i key={i} className={on ? 'on' : ''} />)
  }
  return (
    <div className="curl">
      <span className="k">{wheel ? ',' : 'Q'}</span>
      <div className="cells">{cells}</div>
      <span className="k">{wheel ? '.' : 'E'}</span>
      <span className="cv">{curl === 0 ? 'Falso yok' : `Falso ${curl < 0 ? 'sola' : 'sağa'} ${Math.abs(curl)}`}</span>
    </div>
  )
}

// kontrol edilen oyuncunun kondisyonu (rAF ile)
function StaminaBar() {
  const fill = useRef<HTMLDivElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let id = 0
    const loop = () => {
      const p = game.controlledPlayer()
      if (fill.current) fill.current.style.transform = `scaleX(${p ? p.stamina : 0})`
      if (name.current) name.current.textContent = p ? `${p.number} ${p.name}` : ''
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="power">
      <span ref={name} className="pv" />
      <div className="track stamina">
        <div ref={fill} className="fill" />
      </div>
      <span className="pv">Kondisyon</span>
    </div>
  )
}

const HELP_MAC: [string, string][] = [
  ['WASD / oklar', 'Koş (kameraya göre)'],
  ['Shift', 'Sprint'],
  ['Sol tık / Boşluk', 'Basılı tut + bırak: şut (fareyle nişan)'],
  ['Sağ tık / K', 'Pas (fare yönündeki arkadaşa)'],
  ['Z + pas / Z + şut', 'Aşırtma pas / aşırtma şut'],
  ['Falso', 'Şut şarjı sırasında fare tekerleği ya da , ve . tuşları (sola / sağa); pas ve ortada da geçerli'],
  ['E dokun / E basılı', 'Ayakta müdahale (sprintte de) / jockey (rakibe dönük yan adım)'],
  ['E E (çift dokunuş)', 'Kayarak müdahale'],
  ['Kırmızı kart', 'İkinci sarı dahil: 30 saniye ceza, oyuncu sonra geri döner'],
  ['Q', 'Topa en yakın oyuncuya geç'],
  ['M', 'Antrenman / maç'],
  ['V', 'Serbest kamera'],
  ['F3', 'Geliştirici paneli'],
]

/** bagli kol icin dinamik, baglam duyarli yardim satirlari (PS kolunda simgelerle) */
function padHelp(): [string, string][] {
  const L = actionLabel
  const ad = getPadInfo().ps ? 'PlayStation' : 'Gamepad'
  if (getSettings().preset === 'klasik') {
    return [
      [`Kol (${ad}, klasik)`, `Sol çubuk hareket, ${L('pass')} pas, ${L('shoot')} şut (basılıyken sol çubuk falso, sağ çubuk nişan), ${L('lob')} aşırtma, ${L('tackle')} müdahale / basılı jockey, L1+${L('tackle')} kayarak, ${L('switch')} oyuncu değiştir, ${L('sprint')} sprint, ${L('precise')} hassas yürüme`],
    ]
  }
  return [
    [`Kol topla (${ad})`, `${L('pass')} pas (basılı: güç), ${L('shoot')} şut (basılı: şarj, sol çubuk falso), ${L('lob')} orta, ${L('through')} ara pas, ${L('driven')}+${L('pass')} sert pas, ${L('finesse')}+${L('shoot')} falsolu şut, ${L('shield')} top koruma, ${L('sprint')} sprint`],
    [`Kol topsuz (${ad})`, `${L('tackle')} müdahale, ${L('slide')} kayarak, ${L('press')} baskı, ${L('jockey')} jockey, ${L('switch')} oyuncu değiştir, ${L('sprint')} sprint`],
    ['Kol genel', `${L('camera')} kamera, ${L('hints')} pas halkaları, ${L('camPrev')}/${L('camNext')} kamera önayarı, ${L('pause')} menü`],
  ]
}

const HELP: [string, string][] = [
  ['Fare', 'Kale düzleminde nişan al'],
  ['Sol tık / Boşluk', 'Basılı tut: güç, bırak: şut'],
  ['Q / E ya da , / .', 'Falso sola / sağa'],
  ['Shift', 'Aşırtma (basılıyken)'],
  ['Z', 'Yerden sert (basılıyken)'],
  ['Sağ tık', 'Topu sahaya koy'],
  ['Oklar', 'Topu 0,5 m kaydır'],
  ['R', 'Penaltı noktası'],
  ['V', 'Serbest kamera'],
  ['F', 'Topu takip et'],
  ['H', 'Yörünge önizlemesi'],
  ['O', 'Otomatik şut'],
  ['Topu sürükle', 'Sol tıkla tutup taşı'],
  ['C / G / T', 'Kamera / kale / yavaş çekim'],
  ['M', 'Antrenman / maç'],
  ['F3', 'Geliştirici paneli'],
]

export function Hud() {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useSyncExternalStore(subscribeCtl, ctlVersion)
  const [cam, setCam] = useState(SHOOTER_CAM)
  const [slow, setSlow] = useState(false)

  useEffect(() => world.subscribe(bump), [])

  const go = (i: number) => {
    setCam(i)
    window.dispatchEvent(new CustomEvent('rig', { detail: i }))
  }
  const swap = () => {
    world.side = world.side === 1 ? -1 : 1
    resetSpot()
    go(ctl.cam === 'sutcu' ? SHOOTER_CAM : cam)
  }
  const toggleSlow = () => {
    const next = !slow
    world.timeScale = next ? 0.2 : 1
    setSlow(next)
  }
  const flip = (k: 'follow' | 'preview' | 'help' | 'passHints') => {
    ctl[k] = !ctl[k]
    bumpCtl()
  }

  // sut tuslari ShotController'da; burada kamera/kale/yavas cekim
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'c') go(((ctl.cam === 'sutcu' ? SHOOTER_CAM : cam) + 1) % CAMERA_NAMES.length)
      else if (e.key === 'g' && ctl.mode === 'antrenman') swap()
      else if (e.key === 't') toggleSlow()
      else if (e.key === 'n') {
        // gun saati: gunduz -> aksam -> gece
        const order = ['gunduz', 'aksam', 'gece'] as const
        const i = order.indexOf(getTimeOfDay() as (typeof order)[number])
        setTimeOfDay(order[(i + 1) % order.length])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const camOn = ctl.cam === 'sutcu' ? SHOOTER_CAM : ctl.cam === 'yayin' ? 4 : cam
  // tek kaynak: antrenmanda world sayaclari, macta mac skoru
  const goals = world.goals
  const shots = world.shots
  const acc = shots ? Math.round((100 * goals) / shots) : 0
  const type = shotType()
  const mac = ctl.mode === 'mac'
  // izleyici (cok oyunculu ya da ?watch=1): kontrol edilen oyuncu yok, guc/kondisyon paneli gizli
  const spectator = mac && game.humanTeam === null && lockedPlayer() < 0

  return (
    <>
      <div className="hud">
        <div className="row mode">
          <button className={!mac ? 'on' : ''} onClick={() => switchMode('antrenman')}>
            Antrenman
          </button>
          <button className={mac ? 'on' : ''} onClick={() => switchMode('mac')}>
            Maç (M)
          </button>
        </div>
        {!mac && (
        <div className="score">
          <span className="lbl">GOL</span>
          <b>{goals}</b>
          <span className="sep" />
          <span className="lbl">ŞUT</span>
          <b>{shots}</b>
          <span className="sep" />
          <span className="lbl">İSABET</span>
          <b>%{acc}</b>
          <span className="sep" />
          <span className="lbl">{world.side === 1 ? 'Doğu kalesi' : 'Batı kalesi'}</span>
        </div>
        )}
        <div className="panel">
          <div className="title">Kontrol</div>
          {!mac && (
          <div className="row">
            <button onClick={autoShot}>Otomatik şut (O)</button>
            <button onClick={resetSpot}>Penaltı noktası (R)</button>
            <button onClick={swap}>Kale değiştir (G)</button>
            <button onClick={toggleSlow} className={slow ? 'on' : ''}>
              Yavaş çekim (T)
            </button>
          </div>
          )}
          <div className="row">
            <button onClick={toggleCam} className={ctl.cam === 'serbest' ? 'on' : ''}>
              Serbest kamera (V)
            </button>
            {mac ? (
              <>
                <button onClick={toggleSlow} className={slow ? 'on' : ''}>
                  Yavaş çekim (T)
                </button>
                <button onClick={() => flip('passHints')} className={ctl.passHints ? 'on' : ''}>
                  Pas halkaları (H)
                </button>
              </>
            ) : (
              <>
                <button onClick={() => flip('follow')} className={ctl.follow ? 'on' : ''}>
                  Topu takip (F)
                </button>
                <button onClick={() => flip('preview')} className={ctl.preview ? 'on' : ''}>
                  Yörünge (H)
                </button>
              </>
            )}
          </div>
          <div className="title">Gün saati (N)</div>
          <TimeOfDayPicker />
          <div className="title">Kamera (C)</div>
          <div className="row">
            {CAMERA_NAMES.map((n, i) => (
              <button key={n} onClick={() => go(i)} className={i === camOn ? 'on' : ''}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!spectator && (
      <div className="shot-hud">
        {mac ? (
          <>
            <PowerBar />
            <CurlGauge curl={ctl.curl} wheel />
            <StaminaBar />
          </>
        ) : (
        <>
        <div className="types">
          {(['normal', 'asirtma', 'yerden'] as const).map((t) => (
            <span key={t} className={t === type ? 'on' : ''}>
              {TYPE_NAMES[t]}
              {t === 'asirtma' ? ' · Shift' : t === 'yerden' ? ' · Z' : ''}
            </span>
          ))}
        </div>
        <PowerBar />
        <CurlGauge curl={ctl.curl} />
        <div className="last">
          {ctl.lastKmh > 0 ? (
            <>
              Son şut <b>{ctl.lastKmh}</b> km/sa
            </>
          ) : (
            <>
              Basılı tut, bırak: şut · {Math.round(V_MIN * 3.6)}–{Math.round(V_MAX * 3.6)} km/sa
            </>
          )}
        </div>
        </>
        )}
      </div>
      )}

      {mac && ctl.hint && <div className="match-hint">{ctl.hint}</div>}

      {ctl.msg && (
        <div key={ctl.msgId} className={`shot-msg ${ctl.msg === 'GOL!' ? 'goal' : ctl.msg === 'AUT' ? 'out' : 'post'}`}>
          {ctl.msg}
        </div>
      )}

      <button className="help-btn" onClick={() => flip('help')} title="Kısayollar">
        ?
      </button>
      {ctl.help && (
        <div className="help-panel">
          {/* etkin mod ustte, diger mod soluk */}
          {(mac ? (['mac', 'antrenman'] as const) : (['antrenman', 'mac'] as const)).map((m) => (
            <div key={m} className={m === ctl.mode ? 'hgroup' : 'hgroup dim'}>
              <div className="title">{m === 'mac' ? 'Maç' : 'Antrenman'} kısayolları</div>
              {[...(m === 'mac' ? HELP_MAC : HELP), ...(m === 'mac' && getPadInfo().connected ? padHelp() : [])].map(([k, v]) => (
                <div key={k} className="hr">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
