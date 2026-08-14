// dump 8 专项 0.6 段「子 agent 拆分」行完整文本(供拆行替换)
import fs from 'node:fs'
import path from 'node:path'
const dir = 'docs/根基文档/审查体系专项'
const files = fs.readdirSync(dir).filter((f) => f.startsWith('专项')).sort()
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
  const i = lines.findIndex((l) => l.includes('**子 agent 拆分**'))
  console.log(`\n### ${f}`)
  console.log(i === -1 ? 'NOT FOUND' : lines[i])
}
