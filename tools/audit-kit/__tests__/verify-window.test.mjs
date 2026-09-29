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

describe('verify-window — 缺期望不得等于通过（926q W1-06 实测的洞）', () => {
  const NOEXP = '## §0 核对\n\n```bash\nnode -e "console.log(1)"\necho ok\n```\n'

  it('零条 `# 期望:` ⇒ 全部 FAIL、rc 口径为不通过（阳性对照前这里是 pass=2 fail=0）', () => {
    const r = verifyWindow(NOEXP, { cwd: process.cwd() })
    const s = summarize(r.results)
    expect(s).toEqual({ total: 2, pass: 0, fail: 2, skip: 0 })
    expect(r.results[0].reason).toContain('未带 `# 期望:`')
  })

  it('同形态补齐期望 ⇒ 不误红（等价改写那一格）', () => {
    const md =
      '## §0 核对\n\n```bash\nnode -e "console.log(1)"\n# 期望: 1\necho ok\n# 期望: ok\n```\n'
    expect(summarize(verifyWindow(md, { cwd: process.cwd() }).results)).toEqual({
      total: 2,
      pass: 2,
      fail: 0,
      skip: 0,
    })
  })

  it('命令自身 exit 1 但 stdout 对上期望 ⇒ 仍 PASS（口径是 stdout，不是退出码）', () => {
    const md =
      '## §0 核对\n\n```bash\nnode -e "console.log(boom);process.exit(1)"\n# 期望: boom\n```\n'
    const r = verifyWindow(md, { cwd: process.cwd() })
    expect(summarize(r.results).pass).toBe(1)
    expect(r.results[0].reason).toContain('退出码 1')
  })

  it('--lenient ⇒ 缺期望记 SKIP 不判 FAIL，且报告里说清是豁免（不得当交件门槛）', () => {
    const s = summarize(verifyWindow(NOEXP, { cwd: process.cwd(), lenient: true }).results)
    expect(s.fail).toBe(0)
    expect(s.skip).toBe(2)
  })
})
