// 0.6 段「子 agent 拆分」长行拆行(P3-2 修复): 3 个统一替换点, 8 文件
import fs from 'node:fs'
import path from 'node:path'
const dir = 'docs/根基文档/审查体系专项'
const files = fs.readdirSync(dir).filter((f) => f.startsWith('专项')).sort()

const subs = [
  // 1) 拆分规则加编号, 保持原意
  ['：1 部分=1 子 agent，相邻部分证据重叠>50% 可合并，单专项上限 6，禁止二次拆分）',
   '：① 1 部分=1 子 agent；② 相邻部分证据重叠>50% 可合并；③ 单专项上限 6；④ 禁止二次拆分）'],
  // 2) 建议方案换行成子 bullet
  ['）。本专项', '）。\n  - 本专项'],
  // 3) 执行方式换行成子 bullet
  ['）。每个子 agent 领', '）。\n  - 每个子 agent 领'],
]
let touched = 0
for (const f of files) {
  const p = path.join(dir, f)
  let t = fs.readFileSync(p, 'utf8')
  const orig = t
  for (const [a, b] of subs) {
    if (!t.includes(a)) { console.log(`⚠️ ${f}: 未找到替换点「${a.slice(0, 20)}…」`); continue }
    t = t.split(a).join(b)
  }
  if (t !== orig) { fs.writeFileSync(p, t, 'utf8'); touched++; console.log(`✅ ${f}: 已拆行`) }
}
console.log(`\n共处理 ${touched}/8 个文件`)
