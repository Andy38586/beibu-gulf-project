import { describe, expect, it } from 'vitest'

import { SEMANTIC_COLORS } from '@/shared'

import { FLOOD_RISK_COLORS, FLOOD_RISK_DEFAULT } from '../constants/colors'

describe('洪涝风险色表走语义色 map 变体', () => {
  it('低/中/高风险 stroke 直接取单源表 map（不再手抄字面量）', () => {
    expect(FLOOD_RISK_COLORS['低风险'].stroke).toBe(SEMANTIC_COLORS.success.map)
    expect(FLOOD_RISK_COLORS['中风险'].stroke).toBe(SEMANTIC_COLORS.warning.map)
    expect(FLOOD_RISK_COLORS['高风险'].stroke).toBe(SEMANTIC_COLORS.danger.map)
  })

  it('fill 由同一 stroke 派生，极高/灾难级只改 alpha', () => {
    expect(FLOOD_RISK_COLORS['低风险'].fill).toBe('rgba(18, 82, 35, 0.3)')
    expect(FLOOD_RISK_COLORS['极高风险'].fill).toBe('rgba(138, 34, 48, 0.4)')
    expect(FLOOD_RISK_COLORS['灾难级'].fill).toBe('rgba(138, 34, 48, 0.5)')
  })

  it('未知等级回落到无风险档（中性灰，不是成功绿）', () => {
    expect(FLOOD_RISK_DEFAULT.stroke).toBe('#44474c')
    expect(FLOOD_RISK_DEFAULT).toBe(FLOOD_RISK_COLORS['无风险'])
  })
})
