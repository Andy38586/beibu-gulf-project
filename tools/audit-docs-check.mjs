// 审查体系文档元审查——机械核对(替代子 agent 的降级执行)
// ⚠️ 注意: 本脚本 0.6 段检查(G/H)存在窗口截断缺陷(仅取标题后 700/900 字符, 子 agent 拆分行在窗口外),
// 跨专项引用(C2)仅识别「专项N X.Y」编号形式。0.6/建议数/引用检查请以 audit-docs-deep.mjs 为准。
// 本脚本保留作为指标计数与主体系残留检查的快速入口。
import fs from 'node:fs'
import path from 'node:path'

const dir = 'docs/根基文档/审查体系专项'
const files = fs.readdirSync(dir).filter((f) => f.startsWith('专项'))
const map = {
  1: '专项1-数据链审查.md', 2: '专项2-生命周期审查.md', 3: '专项3-TS类型审查.md',
  4: '专项4-WebGIS审查.md', 5: '专项5-工程化审查.md', 6: '专项6-架构耦合审查.md',
  7: '专项7-设计Token与样式一致性审查.md', 8: '专项8-算法与结果正确性审查.md',
}
const CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' }

console.log('=== C2. 跨专项引用 专项N X.Y 目标章节存在性 ===')
let total = 0
let bad = 0
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8')
  for (const m of t.matchAll(/专项(\d)[^\n]{0,20}?(\d+)\.(\d+)/g)) {
    const n = Number(m[1])
    if (!map[n]) continue
    const target = fs.readFileSync(path.join(dir, map[n]), 'utf8')
    const exists =
      target.includes(`### 指标 ${m[2]}.${m[3]}`) ||
      target.includes(`## 第${CN[Number(m[2])]}部分`)
    total++
    if (!exists) {
      bad++
      console.log(`❌ ${f.slice(0, 7)} 引用 专项${n} ${m[2]}.${m[3]} 目标不存在`)
    }
  }
}
console.log(`引用总数=${total}, 失效=${bad}${bad ? '' : ' ✅ 全部指向真实章节'}`)

console.log('\n=== G. 各专项 0.6 契约与部分数 ===')
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8')
  const parts = [...t.matchAll(/^## 第[一二三四五六七八]+部分/gm)].length
  const sec6 = t.match(/### 0\.6[\s\S]{0,700}?/)?.[0] ?? ''
  const agentHint = sec6.match(/(\d+)\s*个?\s*子\s*agent|子\s*agent\s*(?:数|数量)[^0-9]{0,6}(\d+)/)
  console.log(`${f.slice(0, 7)}: 部分数=${parts}${agentHint ? ` | 0.6提及: ${agentHint[1] || agentHint[2]} 子agent` : ' | 0.6未显式给数'}`)
}

console.log('\n=== H. 0.6 契约关键规则关键词(部分原子/合并/上限) ===')
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8')
  const sec6 = t.match(/### 0\.6[\s\S]{0,900}?/)?.[0] ?? ''
  const hasPart = sec6.includes('部分')
  const hasMerge = /合并|重叠/.test(sec6)
  const hasCap = /上限|最多/.test(sec6)
  const hasSplit = /拆分/.test(sec6)
  console.log(`${f.slice(0, 7)}: 部分原子=${hasPart} 合并规则=${hasMerge} 上限=${hasCap} 拆分约束=${hasSplit}`)
}
