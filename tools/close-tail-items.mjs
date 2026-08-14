// 收尾: a027/a042 标注 + b031(8.2) 重编号为 b077(主本+引用同步)
import fs from 'node:fs'

// 1. 主本: b031(8.2) → b077 重编号
const P = 'docs/已解决问题.md'
let t = fs.readFileSync(P, 'utf8')
const before = t
t = t.replace('| p0       | b031(8.2)-生产路径默认含mock数据', '| p0       | b077-生产路径默认含mock数据(原 b031(8.2)，2026-08-14 勘误重编号——与 b031-401软登录缺口撞号)')
t = t.replace('已被 b031(8.2)（默认 api）推翻', '已被 b077（原 b031(8.2)，默认 api）推翻')
t = t.replace('b022/b024→b031(8.2)', 'b022/b024→b077（原 b031(8.2)）')
if (t !== before) { fs.writeFileSync(P, t, 'utf8'); console.log('b031(8.2) → b077 重编号完成') }
else console.log('⚠️ 主本替换无变化')

// 2. 副本: a027/a042/b031 标注
const C = 'docs/问题副本-2026-08-14-已解决后遗症.md'
let c = fs.readFileSync(C, 'utf8')
const marks = [
  ['a027', '**✅ 已解决（2026-08-14 核实）**：`_setupTerrain` catch（CesiumRenderer L360-363）已有 `logger.warn`（生产保留），terrain 失败可观测日志已落地（并入 z095 批次的诉求已满足）。'],
  ['a042', '**📋 待真浏览器验证（2026-08-14 登记）**：防御逻辑核实存在（UnifiedMap L343-346：`newType===3d && !cesiumInitialized` 时 nextTick×2 等容器挂载）；headless 被 route watch immediate 掩盖不触发，真浏览器直进 3D 验证已登记人工核验单。'],
  ['b031', '**✅ 已处置（2026-08-14）**：b031(8.2) 重编号为 **b077**（主本+引用同步），与 b031-401软登录缺口撞号消除。'],
]
let done = 0
for (const [id, mark] of marks) {
  const re = new RegExp(`^(\\|\\s*${id}[^\\n]*?)(\\|\\s*)$`, 'm')
  if (!re.test(c)) { console.log(`⚠️ 副本未找到: ${id}`); continue }
  c = c.replace(re, `$1<br>${mark}$2`)
  done++
}
fs.writeFileSync(C, c, 'utf8')
console.log(`副本标注: ${done}/3`)
