// 待解决问题.md: 移除 5 条已闭环(b027/z076/z103/z105/d080)并更新统计
import fs from 'node:fs'
const P = 'docs/待解决问题.md'
let lines = fs.readFileSync(P, 'utf8').split('\n')

const targets = ['b027-', 'z076-', 'z103-', 'z105-', 'd080-']
const out = []
let removed = 0
for (const l of lines) {
  const isRow = /^\|\s*p[0-3]\s*\|/.test(l)
  if (isRow && targets.some((t) => l.includes(t))) {
    removed++
    continue
  }
  out.push(l)
}
lines = out

// 更新统计节
const t = lines.join('\n')
const updated = t
  .replace(/真实 open：28 项/g, '真实 open：23 项')
  .replace(/p1 × 5：b034\/b040\/b044\/z071\/z072/g, 'p1 × 5：b034/b040/b044/z071/z072')
  .replace(/业务层 6（b027\/b034\/b040\/b044\/b045\/b065）/g, '业务层 5（b034/b040/b044/b045/b065）')
  .replace(/暂未归类 12（z038\/z040\/z042\/z064\/z071\/z072\/z076\/z077\/z102-z105）/g, '暂未归类 10（z038/z040/z042/z064/z071/z072/z077/z102/z104）')
  .replace(/后端层 5（d051\/d054\/d080-d082）/g, '后端层 4（d051/d054/d082）')
  .replace(/p2 × 16/g, 'p2 × 13')
  .replace(/p3 × 7/g, 'p3 × 5')
  .replace(/- b027-waterLevel传参姿势分裂[^\n]*\n/g, '')
  .replace(/- z076-引擎切换pitch硬编码[^\n]*\n/g, '')
  .replace(/- z103-覆盖率阈值形同虚设[^\n]*\n/g, '')
  .replace(/- z105-setTerrainEnabled无调用方[^\n]*\n/g, '')
  .replace(/- d080-plansController直连仓库无service层[^\n]*\n/g, '')

fs.writeFileSync(P, updated, 'utf8')
console.log(`删除行: ${removed}; 统计已更新`)
