import { describe, expect, it } from 'vitest'

import { scenarioParam } from '../scenario'

/**
 * 情景查询参数助手（D21-5 单源后的语义钉）：
 * 契约 =「未选情景（undefined/''）或 baseline ⇒ 缺省不发参数」，
 * 与后端 parseScenarioId 的缺省回落口径一致。
 * 原 business 版（!=='baseline' 判定）与 adapter 版（truthy 判定）双实现
 * 在 ''/undefined 边界行为不同，单源后统一为下述三格。
 */
describe('scenarioParam — 缺省不发 scenario 参数', () => {
  it('baseline ⇒ 不发（缺省回落语义）', () => {
    expect(scenarioParam('baseline')).toEqual({})
  })

  it('undefined / 空串 ⇒ 不发（adapter 可缺省调用兼容）', () => {
    expect(scenarioParam(undefined)).toEqual({})
    expect(scenarioParam('')).toEqual({})
  })

  it('非 baseline 情景 ⇒ 携带参数（design/median/induced）', () => {
    expect(scenarioParam('design')).toEqual({ scenario: 'design' })
    expect(scenarioParam('median')).toEqual({ scenario: 'median' })
    expect(scenarioParam('induced')).toEqual({ scenario: 'induced' })
  })
})
