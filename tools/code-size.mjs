// 统计前端/后端代码行数(按模块)
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const areas = [
  ['frontend/src', ['frontend/src'], ['ts', 'vue']],
  ['backend', ['backend'], ['ts', 'js']],
  ['flood-service', ['flood-service'], ['py']],
  ['tools', ['tools'], ['mjs', 'js', 'py', 'ps1']],
]
const results = {}
for (const [label, dirs, exts] of areas) {
  const all = []
  for (const d of dirs) {
    const abs = path.join(root, d)
    if (!fs.existsSync(abs)) continue
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__pycache__' || e.name === '.venv' || e.name === 'venv') continue
        const full = path.join(p, e.name)
        if (e.isDirectory()) walk(full)
        else if (exts.includes(e.name.split('.').pop())) all.push(full)
      }
    }
    walk(abs)
  }
  let total = 0
  for (const f of all) {
    try { total += fs.readFileSync(f, 'utf8').split('\n').length } catch { /* binary */ }
  }
  results[label] = { files: all.length, lines: total }
  console.log(`${label}: ${all.length} 文件 / ${total} 行`)
}
// frontend/src 子模块细分
const sub = {}
const walkSub = (p, top) => {
  if (!fs.existsSync(p)) return
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'assets', 'styles'].includes(e.name)) continue
    const full = path.join(p, e.name)
    if (e.isDirectory()) walkSub(full, top)
    else if (['ts', 'vue'].includes(e.name.split('.').pop())) {
      let n = 0
      try { n = fs.readFileSync(full, 'utf8').split('\n').length } catch { }
      sub[top] = (sub[top] ?? 0) + n
    }
  }
}
for (const e of fs.readdirSync(path.join(root, 'frontend/src'), { withFileTypes: true })) {
  if (e.isDirectory()) walkSub(path.join(root, 'frontend/src', e.name), e.name)
}
console.log('--- frontend/src 子模块(行数) ---')
for (const [k, v] of Object.entries(sub).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
