// C-2: OLRenderer un 注销处去除 as any(listener 已类型化为 EventsKey['listener'])
import fs from 'node:fs'
const p = 'frontend/src/core/map/renderers/OLRenderer.ts'
let t = fs.readFileSync(p, 'utf8')
const pats = [
  'moveendKey.listener as any',
  'this._moveendKey.listener as any',
  'this._clickHandler as any',
  'this._pointerMoveHandler as any',
  'this._cameraChangedKey.listener as any',
]
let n = 0
for (const pat of pats) {
  const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const before = t
  t = t.replace(re, pat.replace(' as any', ''))
  if (t !== before) n++
}
fs.writeFileSync(p, t, 'utf8')
console.log(`去除 as any: ${n} 处`)
