/* repro-audit-kit.mjs — 只读：复现「audit-kit 在无 sh 环境下降级」的 summarize 输出（见台账 1004 批续3）。
 * 用法：node tools/diag/repro-audit-kit.mjs
 */
import { verifyWindow, summarize } from '../audit-kit/verify-window.mjs'

const md = [
  '## §0 核对',
  '',
  '```bash',
  'echo hello',
  '# 期望: hello',
  'echo world',
  '# 期望: world',
  '```',
].join('\n')
const r = verifyWindow(md, { cwd: process.cwd() })
console.log('summarize =', JSON.stringify(summarize(r.results)))
for (const x of r.results)
  console.log('  -', x.cmd, '|', x.status ?? x.pass, '|', String(x.reason ?? '').slice(0, 100))
