// @vitest-environment node
/**
 * guard-red-sample 的自测（元守卫的自证）。
 *
 * 为什么必须有：本守卫只看「测试文件里有没有 @guard-red-sample 标记」，**查不出
 * "标记在、断言只覆盖正常路径"这种假红样**（它自己文件头就承认了这一点）。
 * 更严重的是刚被实核出来的一个回归洞 ——
 *   BASELINE 里残留 8 项时，摘掉其中任一项的红样标记，守卫只被告警、不判红：
 *   18 个守卫里有 8 个的红样可以静默消失，而 S1 的全部意义就是堵这个。
 *   （2026-09-25 用注入临时 testDir 的变异探针实测坐实。）
 *
 * 所以这组用例钉两件事：
 *   1) 标记存在性与 no-test 判定本身正确；
 *   2) **空基线下，红样一旦消失必须红** —— 这就是那条回归洞的看门狗。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BASELINE, auditRedSamples, redSampleState } from '../guard-red-sample.mjs'

/** 造一对临时 guardDir/testDir；withMarker 控制测试文件里有没有红样标记 */
function fixture(withMarker) {
  const guardDir = mkdtempSync(join(tmpdir(), 'grs-g-'))
  const testDir = mkdtempSync(join(tmpdir(), 'grs-t-'))
  writeFileSync(join(guardDir, 'g1.mjs'), '// guard stub\n')
  writeFileSync(
    join(testDir, 'g1.test.mjs'),
    withMarker ? "it('@guard-red-sample 违例必报', () => {})\n" : "it('只测正常路径', () => {})\n"
  )
  return { guardDir, testDir }
}

describe('guard-red-sample — 缺红样即红', () => {
  it('标记存在 → ok', () => {
    expect(redSampleState('g1', fixture(true))).toBe('ok')
  })

  it('@guard-red-sample 标记被摘掉 → 判缺红样，且在空基线下真报红', () => {
    const f = fixture(false)
    expect(redSampleState('g1', f)).toBe('no-red-sample')
    const problems = auditRedSamples(['g1'], { ...f, baseline: [] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('未交付红样')
  })

  it('@guard-red-sample 回归洞看门狗：BASELINE 必须是空的（留后备豁免 = 红样可静默消失）', () => {
    expect(BASELINE).toEqual([])
  })

  it('没有 test 文件 → 判 no-test，同样是未交付', () => {
    const guardDir = mkdtempSync(join(tmpdir(), 'grs-g-'))
    const testDir = mkdtempSync(join(tmpdir(), 'grs-t-'))
    writeFileSync(join(guardDir, 'g2.mjs'), '// guard stub\n')
    expect(redSampleState('g2', { guardDir, testDir })).toBe('no-test')
    expect(auditRedSamples(['g2'], { guardDir, testDir, baseline: [] })).toHaveLength(1)
  })
})
