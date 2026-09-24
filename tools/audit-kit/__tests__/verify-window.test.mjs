// @vitest-environment node
/**
 * audit-kit 的自测。
 *
 * 这里钉的是「窗口交付能不能被机器复算」这件事本身：
 * 抽块、取节、解析「命令 + 期望」、整体判定（无块即未交付）。
 * 判据全用合成样本，不依赖仓库现状；需要真跑命令的用例只用 echo / true。
 */
import { describe, expect, it } from 'vitest'

import { extractBashBlocks, isMachineRunnable } from '../extract-window.mjs'
import { parseCases, sectionOf, summarize, verifyWindow } from '../verify-window.mjs'

const MD = [
  '# 窗口件样例',
  '',
  '## §0 五分钟核对',
  '',
  '```bash',
  'echo hello-a',
  '# 期望: hello-a',
  'echo hello-b',
  '# 期望: hello-b',
  '```',
  '',
  '## §1 明细',
  '',
  '```bash',
  'echo 这段不该进 §0',
  '```',
  '',
  '文本块：',
  '',
  '```',
  'echo 这不是 bash 围栏',
  '```',
].join('\n')

describe('extractBashBlocks — 只认可执行围栏', () => {
  it('抽出 bash 块，不把无语言围栏当可执行', () => {
    expect(extractBashBlocks(MD)).toHaveLength(2)
  })
  it('无块 ⇒ 机器可复算判定为 false（该件未交付）', () => {
    expect(isMachineRunnable('# 只有正文，没有判据')).toBe(false)
    expect(isMachineRunnable(MD)).toBe(true)
  })
})

describe('sectionOf — 按 §N 切区段', () => {
  it('§0 只取到下一个二级标题', () => {
    const s0 = sectionOf(MD, 0)
    expect(s0).toContain('hello-a')
    expect(s0).not.toContain('这段不该进 §0')
  })
  it('找不到该节 ⇒ 退回全文（避免静默取空）', () => {
    expect(sectionOf(MD, 9)).toBe(MD)
  })
})

describe('parseCases — 命令 + 紧随的期望', () => {
  it('一条命令挂一条期望', () => {
    const cases = parseCases('echo a\n# 期望: a\necho b\n# 期望: b\n')
    expect(cases.map((c) => c.cmd)).toEqual(['echo a', 'echo b'])
    expect(cases[0].expect).toEqual(['a'])
  })
  it('注释与空行不构成用例', () => {
    const cases = parseCases('# 只是注释\n\necho a\n')
    expect(cases).toHaveLength(1)
  })
  it('一条命令可挂多条期望', () => {
    const cases = parseCases('ls\n# 期望: a\n# 期望: b\n')
    expect(cases[0].expect).toEqual(['a', 'b'])
  })
})

describe('verifyWindow — 交付判定与整体口径', () => {
  it('§0 无块 ⇒ delivered=false（不是「部分通过」）', () => {
    const r = verifyWindow('## §0 核对\n\n正文里说跑过了\n', { cwd: process.cwd() })
    expect(r.delivered).toBe(false)
    expect(r.reason).toContain('没有 bash 块')
  })

  it('期望与实际一致 ⇒ 全部 PASS', () => {
    const r = verifyWindow(MD, { cwd: process.cwd() })
    expect(r.delivered).toBe(true)
    expect(summarize(r.results)).toEqual({ total: 2, pass: 2, fail: 0, skip: 0 })
  })

  it('期望对不上 ⇒ FAIL（这条就是「窗口自述」与「复算」的差）', () => {
    const md = ['## §0 核对', '', '```bash', 'echo actual', '# 期望: 我声称的输出', '```'].join(
      '\n'
    )
    const r = verifyWindow(md, { cwd: process.cwd() })
    expect(summarize(r.results).fail).toBe(1)
    expect(r.results[0].reason).toContain('期望未出现')
  })
})
