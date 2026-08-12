// 生成映射模式：node tools\rebase-ids.cjs --gen
// 应用映射模式：node tools\rebase-ids.cjs
const fs = require('fs')
const path = require('path')

const genMode = process.argv.includes('--gen')
const docsDir = path.join(__dirname, '..', 'docs')
const file = path.join(docsDir, '已解决问题.md')

if (genMode) {
  const content = fs.readFileSync(file, 'utf8')
  const lines = content.split('\n')
  const entryRe = /^\|\s*p\d\s*\|\s*([a-z]\d{3}(?:\(8\.2\)|-[A-Z]{2})?)[-\s]/
  const entries = []
  lines.forEach((line, i) => {
    const m = line.match(entryRe)
    if (m) entries.push(m[1])
  })
  const counters = {}
  const mapping = {}
  entries.forEach((raw) => {
    const base = raw.replace(/\(8\.2\)|-[A-Z]{2}$/, '')
    counters[base[0]] = (counters[base[0]] || 0) + 1
    mapping[raw] = base[0] + String(counters[base[0]]).padStart(3, '0')
  })
  fs.writeFileSync(path.join(docsDir, '.id-mapping.json'), JSON.stringify(mapping, null, 2), 'utf8')
  console.log('映射已生成:', Object.keys(mapping).length, '条')
  process.exit(0)
}

const mapping = JSON.parse(fs.readFileSync(path.join(docsDir, '.id-mapping.json'), 'utf8'))

// base 形式映射（正文交叉引用用；重复 base 取第一个）
const baseMapping = {}
for (const [raw, newId] of Object.entries(mapping)) {
  const base = raw.replace(/\(8\.2\)|-[A-Z]{2}$/, '')
  if (!baseMapping[base]) baseMapping[base] = newId
}

let content = fs.readFileSync(file, 'utf8')
const lines = content.split('\n')

// 1. 条目行行首编号替换（用 raw 映射，保留 -FE/-BE 后缀，去掉 (8.2)）
// 2. 非条目行做正文交叉引用替换（单遍回调，防止 a015<->a016 二次替换）
const entryRe = /^(\|\s*p\d\s*\|\s*)([a-z]\d{3})((?:\(8\.2\)|-[A-Z]{2})?)([-\s])/
const refRe = /(?<![a-zA-Z0-9])([a-z]\d{3}(?:\(8\.2\)|-[A-Z]{2})?)(?![a-zA-Z0-9])/g

lines.forEach((line, i) => {
  const m = line.match(entryRe)
  if (m) {
    // 条目行：行首编号用 raw 映射（保留 -FE/-BE 后缀，去掉 (8.2)），行内引用也替换
    const raw = m[2] + m[3]
    const newBase = mapping[raw] || mapping[m[2]]
    const newSuffix = m[3] === '(8.2)' ? '' : m[3]
    const rest = line.slice(m[0].length).replace(refRe, (match, id) => {
      if (mapping[id]) return mapping[id]
      const base = id.replace(/\(8\.2\)|-[A-Z]{2}$/, '')
      return baseMapping[base] || match
    })
    lines[i] = m[1] + (newBase || m[2]) + newSuffix + m[4] + rest
  } else {
    // 非条目行：正文交叉引用
    lines[i] = line.replace(refRe, (match, id) => {
      if (mapping[id]) return mapping[id]
      const base = id.replace(/\(8\.2\)|-[A-Z]{2}$/, '')
      return baseMapping[base] || match
    })
  }
})
content = lines.join('\n')

fs.writeFileSync(file, content, 'utf8')
console.log('已解决问题.md 重编号完成')
