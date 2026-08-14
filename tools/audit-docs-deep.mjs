// 审查体系文档深度元审查 v3 —— 修正 0.x 章节/加粗干扰/路径检查三处缺陷, 新增正文-附录负载分解
// 用法: node tools/audit-docs-deep.mjs
import fs from 'node:fs'
import path from 'node:path'

const dir = 'docs/根基文档/审查体系专项'
const map = {
  1: '专项1-数据链审查.md', 2: '专项2-生命周期审查.md', 3: '专项3-TS类型审查.md',
  4: '专项4-WebGIS审查.md', 5: '专项5-工程化审查.md', 6: '专项6-架构耦合审查.md',
  7: '专项7-设计Token与样式一致性审查.md', 8: '专项8-算法与结果正确性审查.md',
}
const CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' }
const files = fs.readdirSync(dir).filter((f) => f.startsWith('专项')).sort()
const texts = {}
for (const f of files) texts[f] = fs.readFileSync(path.join(dir, f), 'utf8')

function sec6(t) {
  const m = t.match(/### 0\.6[^\n]*\n([\s\S]*?)(?=\n### |\n## |$)/)
  return m ? m[1] : ''
}

console.log('=== A. 0.6 契约关键规则(全段) ===')
const rules = [
  ['部分原子(1部分=1子agent)', /1\s*部分\s*=\s*1\s*子\s*agent/],
  ['合并规则(重叠>50%)', /重叠\s*>\s*50%\s*可合并/],
  ['单专项上限 6', /上限\s*6/],
  ['禁止二次拆分', /禁止二次拆分/],
  ['建议子 agent 数', /建议[^。\n]{0,40}?(\d+)\s*[–—-]\s*(\d+)\s*个[*\s]*子\s*agent|建议[^。\n]{0,40}?(\d+)\s*个[*\s]*子\s*agent/],
  ['输入=单元指标+代码', /该单元指标/],
  ['主agent汇总去重', /汇总去重|合并同根因|统一定级/],
]
for (const f of files) {
  const s = sec6(texts[f])
  const flags = rules.map(([, re]) => (re.test(s) ? '✓' : '✗'))
  const hint = (s.match(/建议[^。\n]{0,50}/) ?? [''])[0].replace(/\*\*/g, '')
  console.log(`${f.slice(0, 7)} | 段长=${s.length} | ${flags.join(' ')}`)
  if (hint.includes('子 agent')) console.log(`    └ ${hint}`)
}

console.log('\n=== B. 跨专项引用(编号形式指向 0.x/指标/部分 任一真实章节) ===')
let numRef = 0, nameRef = 0, bad = 0
for (const f of files) {
  const t = texts[f]
  for (const m of t.matchAll(/专项(\d)(?!\d)/g)) {
    const n = Number(m[1])
    if (!map[n]) continue
    const tail = t.slice(m.index, m.index + 30).replace(/\n/g, ' ')
    if (/\d+\.\d+/.test(tail)) {
      numRef++
      const id = tail.match(/(\d+\.\d+)/)[1]
      const target = texts[map[n]]
      const ok = target.includes(`### 指标 ${id}`) || target.includes(`### ${id} `) || target.includes(`## 第${CN[Number(id.split('.')[0])] || '?'}部分`)
      if (!ok) { bad++; console.log(`  ❌ ${f.slice(0, 7)}: 专项${n} ${id} @${m.index} tail="${tail}"`) }
    } else nameRef++
  }
}
console.log(`编号形式=${numRef}, 名字形式=${nameRef}, 失效=${bad}${bad ? '' : ' ✅'}`)

console.log('\n=== C. 各部分负载: 正文行数(附录前) 与 附录行数 分解 ===')
for (const f of files) {
  const t = texts[f]
  const lines = t.split('\n')
  const appIdx = lines.findIndex((ln) => /^## 附录/.test(ln))
  const bodyEnd = appIdx === -1 ? lines.length : appIdx
  const partIdx = []
  lines.forEach((ln, i) => { if (/^## 第[一二三四五六七八]+部分/.test(ln)) partIdx.push(i) })
  const bodySizes = partIdx.map((p, i) => (i + 1 < partIdx.length ? partIdx[i + 1] : bodyEnd) - p)
  const indCount = [...t.matchAll(/^### 指标 \d+\.\d+/gm)].length
  const appLines = lines.length - bodyEnd
  const max = Math.max(...bodySizes), min = Math.min(...bodySizes)
  console.log(`${f.slice(0, 7)}: 正文部分=${bodySizes.length} 正文行数=[${bodySizes.join(',')}] 失衡=${(max / min).toFixed(1)}x | 附录=${appLines}行(${(appLines / lines.length * 100).toFixed(0)}%) | 指标=${indCount}`)
}

console.log('\n=== D. 建议子 agent 数 vs 上限(修正加粗干扰) ===')
for (const f of files) {
  const s = sec6(texts[f])
  const m = s.match(/建议[^。\n]{0,40}?(\d+)\s*[–—-]\s*(\d+)\s*个[*\s]*子\s*agent|建议[^。\n]{0,40}?(\d+)\s*个[*\s]*子\s*agent/)
  if (m) {
    const lo = Number(m[1] ?? m[3]), hi = Number(m[2] ?? m[3])
    console.log(`${f.slice(0, 7)}: 建议 ${lo}–${hi} 子agent ${hi <= 6 && lo >= 2 ? '✅ [2,6]内' : '⚠️ 越界'}`)
  } else console.log(`${f.slice(0, 7)}: ⚠️ 未见建议数`)
}

console.log('\n=== E. 产出路径与执行记录(0.6 段内) ===')
for (const f of files) {
  const s = sec6(texts[f])
  const hasCopy = /问题副本\.md/.test(s)
  const hasRec = /执行记录\.md/.test(s)
  const hasDir = /docs\/audits\//.test(s)
  console.log(`${f.slice(0, 7)}: 批次目录=${hasDir ? '✓' : '✗'} 问题副本=${hasCopy ? '✓' : '✗'} 执行记录=${hasRec ? '✓' : '✗'}`)
}

console.log('\n=== F. 00 §4 逐条 vs 0.6 文本一致性(抽查各专项 0.6 是否含 00 全部 4 条规则) ===')
const fourRules = [/1\s*部分\s*=\s*1\s*子\s*agent/, /重叠\s*>\s*50%\s*可合并/, /上限\s*6/, /禁止二次拆分/]
for (const f of files) {
  const s = sec6(texts[f])
  const miss = fourRules.map((re, i) => (re.test(s) ? '' : i + 1)).filter(Boolean)
  console.log(`${f.slice(0, 7)}: ${miss.length ? `⚠️ 缺规则#${miss.join(',')}` : '✅ 4条齐全'}`)
}

console.log('\n=== G. 附录索引/协作引用核对(附录B 协作关系是否指向真实专项) ===')
const appB = /## 附录 ?B[：:][^\n]*\n([\s\S]*?)(?=\n## 附录|\n## 第|$)/m
for (const f of files) {
  const t = texts[f]
  const m = t.match(appB)
  if (!m) { console.log(`${f.slice(0, 7)}: 无附录B`); continue }
  const refs = [...m[1].matchAll(/专项(\d)(?!\d)/g)].map((x) => Number(x[1]))
  const uniq = [...new Set(refs)].filter((n) => map[n])
  console.log(`${f.slice(0, 7)}: 附录B协作引用专项=${uniq.join(',') || '无'} (${uniq.length}个)`)
}
