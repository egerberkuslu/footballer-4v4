// Cim ve zemin: uygulama bu iki bileseni kullanir; uygulama src/grass/ altinda.
// Parametreler: ?blades=N (yogunluk olcegi), ?grass=0 (yapraklar kapali), ?gprof=1 (GPU sure olcumu),
// ?gcam=x,y,z,tx,ty,tz ve ?gdbg=1 (ayiklama)
// Dokular onceden pisirilmis dosyalardan gelir: yuklenene kadar cim bilesenleri kurulmaz (Suspense).
import { Suspense, use, type ReactNode } from 'react'
import { GrassBlades, GrassGround } from './grass/GrassField'
import { loadGrassAssets } from './grass/grassAssets'

function Gate({ children }: { children: ReactNode }) {
  use(loadGrassAssets())
  return <>{children}</>
}

export function PitchGrass() {
  return (
    <Suspense fallback={null}>
      <Gate>
        <GrassBlades />
      </Gate>
    </Suspense>
  )
}

export function PitchGround() {
  return (
    <Suspense fallback={null}>
      <Gate>
        <GrassGround />
      </Gate>
    </Suspense>
  )
}
