// MenuStage test sayfasi: /src/ui/test/index.html?kit=home&variant=0
import { createRoot } from 'react-dom/client'
import MenuStage from '../MenuStage'
import type { KitId } from '../../characters/kit'

const q = new URLSearchParams(location.search)
createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#05080c' }}>
    <div style={{ flex: 1 }} />
    <div style={{ width: '60%' }}>
      <MenuStage kit={(q.get('kit') as KitId) ?? 'home'} variant={Number(q.get('variant') ?? 0)} />
    </div>
  </div>,
)
