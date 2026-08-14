// C-1/3/7 类型债修复: renderer: any → CesiumRenderer + viewer 非空断言(文件版, 无 shell 转义问题)
import fs from 'node:fs'
const p = 'frontend/src/core/map/renderers/CesiumRenderer.ts'
const lines = fs.readFileSync(p, 'utf8').split('\n')

let typed = 0
let asserted = 0
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  // 1) 导出辅助函数参数类型化(仅函数签名行, 806 行后; 避免误改类内方法)
  if (i >= 805 && /renderer: any,/.test(line) && /export function|renderer: any,/.test(line)) {
    const before = line
    lines[i] = line.replace(/renderer: any,/, 'renderer: CesiumRenderer,')
    if (lines[i] !== before) typed++
    continue
  }
  // 2) viewer 非空断言: renderer.viewer 后跟 . ; , ) 且未被断言过
  if (i >= 805 && /renderer\.viewer(?!\!)/.test(line)) {
    const before = line
    lines[i] = line.replace(/renderer\.viewer(?!\!)([.;,\)])/g, 'renderer.viewer!$1')
    if (lines[i] !== before) asserted++
  }
}
fs.writeFileSync(p, lines.join('\n'), 'utf8')
console.log(`类型化 ${typed} 处 renderer: any → CesiumRenderer; viewer 断言 ${asserted} 处`)
