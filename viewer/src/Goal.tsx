import type { World } from './sim'
import { Net } from './goal/Net'

export { GoalFrame } from './goal/Frame'
export { CornerFlags } from './goal/CornerFlag'

// Eski ad korunur (App.tsx): ag artik kalinlikli ip + dugum olarak cizilir
export function NetLines({ world }: { world: World }) {
  return <Net world={world} />
}
