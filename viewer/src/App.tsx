import { useSyncExternalStore } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { BallMesh } from './Ball'
import { CameraRig } from './CameraRig'
import { MatchControl } from './control/MatchControl'
import { MpOverlay } from './mp/Lobby'
import { isVarActive, subscribeVar, varVersion } from './var/store'
import { BootOverlay } from './ui/BootOverlay'
import { QualityPrompt } from './env/QualityPrompt'
import { PadPoll } from './control/gamepad'
import { PadNav, PadNotice } from './ui/padNav'
import { Warmup } from './ui/Warmup'
import { NetSync } from './mp/NetSync'
import { isGuest } from './mp/role'
import { ShotController } from './control/ShotController'
import { usePlayMode } from './control/useMode'
import { TeamAI } from './ai/TeamAI'
import { Characters } from './characters/Characters'
import { DevPanel } from './dev/DevPanel'
import { DevProbe } from './dev/DevProbe'
import { Effects, FX } from './env/Effects'
import { DPR } from './env/quality'
import { Lighting } from './env/Lighting'
import { Surroundings } from './env/Surroundings'
import { CornerFlags, GoalFrame, NetLines } from './Goal'
import { Hud } from './Hud'
import { PitchGrass, PitchGround } from './PitchGrass'
import { Rules } from './rules/Rules'
import { RulesHud } from './rules/RulesHud'
import { world } from './sim'
import { VarOverlay } from './var/VarOverlay'
import { VarScene } from './var/VarScene'


function Sim() {
  useFrame((_, dt) => world.step(dt), -1)
  return null
}

// VAR incelemesinde ana menu dugmesi gizli
function MpGate() {
  useSyncExternalStore(subscribeVar, varVersion)
  return isVarActive() ? null : (
    <>
      <MpOverlay />
      <QualityPrompt />
    </>
  )
}

export default function App() {
  // mac modu (HUD'dan ya da M tusu; ?mode=mac ile baslangic): kurallar, hakem, AI, karakterler
  const MATCH = usePlayMode() === 'mac'
  // cok oyunculu misafir: AI ve kurallar host'ta kosar
  const GUEST = isGuest()
  return (
    <>
      <Canvas
        shadows="percentage"
        dpr={DPR}
        // ayiklama/test icin sahne durumuna erisim
        onCreated={(s) => Object.assign(window, { __r3f: s })}
        camera={{ position: [2, 6.5, 25], fov: 40, near: 0.1, far: 900 }}
        gl={{
          // son isleme acikken ton eslemesi ToneMapping efektinde yapilir
          toneMapping: FX ? THREE.NoToneMapping : THREE.AgXToneMapping,
          toneMappingExposure: 1,
          powerPreference: 'high-performance',
        }}
      >
        <Lighting />

        <PitchGround />
        <PitchGrass />
        <CornerFlags />
        <GoalFrame side={1} />
        <GoalFrame side={-1} />
        <NetLines world={world} />
        <BallMesh world={world} />

        <Surroundings />
        {/* 8 oyuncu + hakem (I); antrenmanda sutcu dizilisini control/training yazar */}
        <Characters />

        <Sim />
        <DevProbe />
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} minDistance={1.5} maxDistance={140} />
        <CameraRig world={world} />
        <VarScene world={world} />
        <ShotController />
        <MatchControl />
        <NetSync />
        {MATCH && !GUEST && <TeamAI />}
        {MATCH && !GUEST && <Rules />}
        <Warmup />
        <Effects />
      </Canvas>
      <Hud />
      <VarOverlay />
      {MATCH && <RulesHud />}
      <PadPoll />
      <PadNav />
      <PadNotice />
      <MpGate />
      <DevPanel />
      <BootOverlay />
    </>
  )
}
