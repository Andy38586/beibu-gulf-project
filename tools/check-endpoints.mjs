// P1-2 前后端端点对账 v2: 解析挂载前缀 + 前端全部 URL 字面量
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// 挂载映射: app.js use('/api/xxx', router)
const appJs = fs.readFileSync(path.join(ROOT, 'backend/app.js'), 'utf8')
const mounts = {}
for (const m of appJs.matchAll(/use\(\s*['"`](\/api\/[a-z-]+)['"`]\s*,\s*(\w+Router)/g)) {
  mounts[m[2]] = m[1]
}
console.log('挂载映射:', JSON.stringify(mounts))

// 后端全路径(带前缀)
const beFull = new Set()
for (const f of fs.readdirSync(path.join(ROOT, 'backend/routes')).filter((f) => f.endsWith('.js'))) {
  const t = fs.readFileSync(path.join(ROOT, 'backend/routes', f), 'utf8')
  const routerVar = f === 'floodAnalysis.js' ? 'floodRouter' : f.replace('.js', '') === 'siteAnalysis' ? 'siteAnalysisRouter' : f.replace('.js', '') + 'Router'
  const prefix = mounts[routerVar]
  for (const m of t.matchAll(/(?:router|Router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g)) {
    const p = m[2]
    const full = p.startsWith('/') ? (prefix ?? '') + p : p
    beFull.add(full)
    // 同时记录不含前缀形式(floodAnalysis.js 可能自带 /api)
    if (p.startsWith('/api/')) beFull.add(p)
  }
}
console.log(`后端注册路径: ${beFull.size} 个`)

// 前端调用(所有 URL 字面量)
const feCalls = []
const walkFe = (p) => {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue
    const f = path.join(p, e.name)
    if (e.isDirectory()) walkFe(f)
    else if (/\.(ts|vue)$/.test(e.name) && !/__tests__|\.test\./.test(f)) {
      const t = fs.readFileSync(f, 'utf8')
      for (const m of t.matchAll(/['"`](\/[a-zA-Z][^'"`]*?)['"`]/g)) {
        const u = m[1].split('?')[0]
        if (u.length > 3 && !u.includes(' ') && !u.includes('{')) feCalls.push({ file: f.replace(ROOT + '\\', '').replace(/\\/g, '/'), url: u })
      }
    }
  }
}
walkFe(path.join(ROOT, 'frontend/src'))

const norm = (u) => u.replace(/\/:(\w+)/g, '/:p').replace(/\$\{[^}]+\}/g, '/:p')
const beNorm = new Set([...beFull].map(norm))

console.log('\n--- 后端有、前端未调用(潜在孤儿端点) ---')
let orphan = 0
for (const p of [...beFull].sort()) {
  const np = norm(p)
  const used = [...feCalls].some((c) => norm(c.url) === np || norm(c.url) === np.replace(/^\/api/, ''))
  if (!used) { orphan++; console.log(`  ${p}`) }
}
if (!orphan) console.log('  (无)')

console.log('\n--- 前端调用、后端未注册(潜在断链) ---')
const seen = new Set()
let broken = 0
for (const c of feCalls) {
  const k = norm(c.url)
  if (seen.has(k)) continue
  seen.add(k)
  const hit = beNorm.has(k) || beNorm.has('/api' + k)
  if (!hit && !k.startsWith('/data/') && !k.startsWith('/static/') && !k.startsWith('/flood-online') && !k.startsWith('/cesium') && !k.startsWith('/tianditu') && !k.startsWith('/profile') && !k.startsWith('/site-selection') && !k.startsWith('/forecast ') && k !== '/api' && k !== '/site-analysis' && k !== '/forecast' && k !== '/flood-analysis' && k !== '/route-analysis') {
    broken++
    console.log(`  ${k}  ← ${c.file}`)
  }
}
if (!broken) console.log('  (无)')

console.log('\n--- 前端调用汇总(按 URL) ---')
for (const k of [...seen].sort()) console.log(`  ${k}`)
