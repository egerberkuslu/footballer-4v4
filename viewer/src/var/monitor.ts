// VAR monitorunun dunya konumu (K hakemi buraya goturur). Bagimliliksiz.
// Kenar cizgisinin (z = -PITCH_W/2) 1,6 m disi, orta saha hizasi; ekran sahaya (+z) bakar.
// facing: ekranin baktigi yon, yaw (rad), 0 = +z.
import { PITCH_W } from '../pitch'

export const VAR_MONITOR = { x: 0, z: -(PITCH_W / 2 + 1.6), facing: 0 }
/** ekran merkezinin yuksekligi (m) */
export const VAR_SCREEN_Y = 1.45
