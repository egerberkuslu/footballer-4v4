import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { QUALITY } from './quality'

// ?fx=0 son islemeyi tamamen kapatir (o zaman renderer AgX ton eslemesi yapar)
// ?fx=tm,bloom,... yalniz listelenen efektler (ayiklama/performans icin)
const params = new URLSearchParams(location.search)
const FXP = params.get('fx')
export const FX = FXP !== '0' && QUALITY !== 'low'
const on = (k: string) => !FXP || FXP === '1' || FXP.split(',').includes(k)

// Not: MSAA + mipmapBlur bazi suruculerde kareyi karartiyor; kenar yumusatma SMAA ile.
// Olculu fotograf islemesi: AO temas golgeleri, hafif bloom, AgX, hafif renk ve vinyet
export function Effects() {
  if (!FX) return null
  const list = [
    QUALITY === 'high' && on('ao') && <N8AO key="ao" aoRadius={1.2} distanceFalloff={0.6} intensity={1.6} quality="medium" halfRes />,
    on('bloom') && <Bloom key="bloom" intensity={0.18} luminanceThreshold={1.1} luminanceSmoothing={0.25} mipmapBlur />,
    <ToneMapping key="tm" mode={ToneMappingMode.AGX} />,
    on('grade') && <HueSaturation key="hs" saturation={0.12} />,
    on('grade') && <BrightnessContrast key="bc" brightness={0.0} contrast={0.08} />,
    <SMAA key="smaa" />,
    on('vig') && <Vignette key="vig" offset={0.32} darkness={0.42} />,
  ].filter((e): e is React.JSX.Element => !!e)
  return <EffectComposer multisampling={0}>{list}</EffectComposer>
}
