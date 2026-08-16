// 检测 @/ 别名的 .vue 组件 import 链是否成环（Q4 收口回归检查）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'src')

function resolveAlias(p) {
  const cands = [path.join(ROOT, p), path.join(ROOT, p + '.vue')]
  for (const c of cands) if (fs.existsSync(c)) return c
  return null
}

function vueDeps(file) {
  const t = fs.readFileSync(file, 'utf8')
  const out = []
  for (const m of t.matchAll(/from ['"]@\/([^'"]+)['"]/g)) {
    if (!m[1].endsWith('.vue')) continue
    const r = resolveAlias(m[1])
    if (r) out.push(r)
  }
  return out
}

const seeds = [
  'business/flood-analysis/FloodAnalysisPage.vue',
  'business/site-selection/SiteSelectionPage.vue',
  'business/forecast/ForecastPage.vue',
  'views/HomePage.vue',
  'views/ProfilePage.vue',
  'core/layout/AppLayout.vue',
  'core/map/UnifiedMap.vue',
  'App.vue',
]

let cycleFound = false
for (const s of seeds) {
  const start = resolveAlias(s)
  if (!start) continue
  const stack = []
  function walk(f, trail) {
    if (trail.includes(f)) {
      console.log('CYCLE:', trail.concat(f).map((x) => path.basename(x)).join(' -> '))
      cycleFound = true
      return
    }
    for (const x of vueDeps(f)) walk(x, trail.concat(f))
  }
  walk(start, [])
}
console.log(cycleFound ? '有环！' : '无 .vue 组件环')
