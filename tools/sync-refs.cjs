const fs = require('fs')
const path = require('path')

const docsDir = path.join(__dirname, '..', 'docs')
const mapping = JSON.parse(fs.readFileSync(path.join(docsDir, '.id-mapping.json'), 'utf8'))

// base 映射：旧 base -> 新 base（重复 base 取第一个）
const baseMap = {}
for (const [raw, newId] of Object.entries(mapping)) {
  const base = raw.replace(/\(8\.2\)|-[A-Z]{2}$/, '')
  if (!baseMap[base]) baseMap[base] = newId
}

const files = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.id-mapping.json') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.md')) files.push(p)
  }
}
walk(docsDir)

const refRe = /(?<![a-zA-Z0-9])([a-z]\d{3})(?![a-zA-Z0-9])/g
let total = 0
for (const f of files) {
  if (path.basename(f) === '已解决问题.md') continue
  const content = fs.readFileSync(f, 'utf8')
  const hits = []
  let m
  while ((m = refRe.exec(content)) !== null) {
    if (baseMap[m[1]] && baseMap[m[1]] !== m[1])
      hits.push({ old: m[1], line: content.slice(0, m.index).split('\n').length })
  }
  if (hits.length === 0) continue
  const updated = content.replace(refRe, (match, id) => baseMap[id] || match)
  fs.writeFileSync(f, updated, 'utf8')
  const byLine = hits.reduce((acc, h) => {
    acc[h.line] = (acc[h.line] || 0) + 1
    return acc
  }, {})
  console.log(
    `${path.relative(docsDir, f)}: ${hits.length} 处 (第 ${Object.keys(byLine).join(',')} 行)`
  )
  total += hits.length
}
console.log('共同步', total, '处')
