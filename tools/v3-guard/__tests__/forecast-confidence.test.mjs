import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { auditForecastConfidence, BE_FILE, FE_FILE } from '../forecast-confidence.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// 「默认置信度」不得同名异值（审查 923 X7）：两侧各自的名字与值都被本守卫钉住，
// 任一侧改名/改值、或后端冒出同名常量即红。
describe('forecast-confidence 守卫', () => {
  const fe = readFileSync(path.join(ROOT, FE_FILE), 'utf8')
  const be = readFileSync(path.join(ROOT, BE_FILE), 'utf8')

  it('当前仓内两侧通过（前端 0.8 / 后端 FALLBACK 1.0）', () => {
    expect(auditForecastConfidence(fe, be)).toEqual([])
  })

  it('🔴 前端改值 ⇒ 报差异', () => {
    const problems = auditForecastConfidence(fe.replace('= 0.8', '= 0.9'), be)
    expect(problems.join()).toContain('DEFAULT_CONFIDENCE 不再是 0.8')
  })

  it('🔴 后端改值 ⇒ 报差异', () => {
    const problems = auditForecastConfidence(fe, be.replace('= 1.0', '= 0.8'))
    expect(problems.join()).toContain('FALLBACK_CONFIDENCE 不再是 1.0')
  })

  it('🔴 后端冒出同名 DEFAULT_CONFIDENCE（同名异值回流）⇒ 报差异', () => {
    const problems = auditForecastConfidence(fe, `${be}\nexport const DEFAULT_CONFIDENCE = 1.0\n`)
    expect(problems.join()).toContain('同名异值回流')
  })
})
