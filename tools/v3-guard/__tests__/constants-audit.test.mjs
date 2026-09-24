import { describe, expect, it } from 'vitest'

import {
  auditSharedConstants,
  parseBackendBizCodes,
  parseFrontendBizCodes,
  parseNumericConst,
} from '../constants-audit.mjs'

const BACKEND_FLOOD = `// 水位上限（米）：251 档 0-25m
export const MAX_WATER_LEVEL = 25
export const RISK_LEVEL_BANDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 4.3, label: '中风险' },
  { maxLevel: 6, label: '高风险' },
  { maxLevel: 8, label: '极高风险' },
  { maxLevel: Number.POSITIVE_INFINITY, label: '灾难级' },
] as const
`
// 前端刻意用 `Infinity`（后端用 `Number.POSITIVE_INFINITY`）：两者语义等价，
// 对账必须视为一致，否则就是逼作者保持特定字面量（§5.3 式 3 的反面）。
const FRONTEND_FLOOD = `// 水位上限（米）：与 backend 同源
export const MAX_WATER_LEVEL = 25
export const RISK_LEVEL_THRESHOLDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 4.3, label: '中风险' },
  { maxLevel: 6, label: '高风险' },
  { maxLevel: 8, label: '极高风险' },
  { maxLevel: Infinity, label: '灾难级' },
] as const
`
const BACKEND_BIZ = `export const ErrorCode = {
  INVALID_PARAMS: { code: 400001, status: 400 },
  USER_NOT_FOUND: { code: 401002, status: 401 },
  WRONG_PASSWORD: { code: 401003, status: 401 },
} satisfies Record<string, ErrorCodeEntry>
`
const FRONTEND_BIZ = `export const AUTH_BIZ_CODE = {
  USER_NOT_FOUND: 401002,
  WRONG_PASSWORD: 401003,
} as const
`

describe('parseNumericConst — 数值常量解析', () => {
  it('解析水位上限', () => {
    expect(parseNumericConst(BACKEND_FLOOD, 'MAX_WATER_LEVEL')).toBe(25)
  })
  it('常量缺失 → null（触发解析失败告警）', () => {
    expect(parseNumericConst('const X = 1', 'MAX_WATER_LEVEL')).toBeNull()
  })
})

describe('业务码提取', () => {
  it('后端 ErrorCode 与前端消费表各自解析', () => {
    expect(parseBackendBizCodes(BACKEND_BIZ)).toEqual([400001, 401002, 401003])
    expect(parseFrontendBizCodes(FRONTEND_BIZ)).toEqual([401002, 401003])
  })
})

describe('auditSharedConstants — 跨进程常量一致性', () => {
  const base = {
    backendFlood: BACKEND_FLOOD,
    frontendFlood: FRONTEND_FLOOD,
    backendBiz: BACKEND_BIZ,
    frontendBiz: FRONTEND_BIZ,
  }

  it('双侧一致 → 无问题', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('MAX_WATER_LEVEL 前端漂移（曾写死 15）→ 报问题', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendFlood: 'export const MAX_WATER_LEVEL = 15',
    })
    const drift = problems.find((p) => p.includes('MAX_WATER_LEVEL'))
    expect(drift).toBeDefined()
    expect(drift).toContain('backend=25 frontend=15')
  })

  it('前端消费后端已不存在的业务码 → 报问题', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendBiz: 'export const AUTH_BIZ_CODE = { STALE: 401009 } as const',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('401009')
  })

  it('常量被改名/删除 → 解析失败告警', () => {
    const problems = auditSharedConstants({ ...base, frontendFlood: 'export const X = 1' })
    expect(problems[0]).toContain('解析失败')
  })
})

describe('风险分档逐档对账', () => {
  const base = {
    backendFlood: BACKEND_FLOOD,
    frontendFlood: FRONTEND_FLOOD,
    backendBiz: BACKEND_BIZ,
    frontendBiz: FRONTEND_BIZ,
  }

  it('前端少末档（历史形态：5 档 vs 6 档）→ 报档位数漂移', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendFlood: FRONTEND_FLOOD.replace("  { maxLevel: Infinity, label: '灾难级' },\n", ''),
    })
    expect(problems.some((p) => p.includes('档位数漂移'))).toBe(true)
  })

  it('某档阈值被改（8 → 9）→ 指出第 5 档', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendFlood: FRONTEND_FLOOD.replace('{ maxLevel: 8, label', '{ maxLevel: 9, label'),
    })
    expect(problems.some((p) => p.includes('第 5 档漂移'))).toBe(true)
  })

  it('某档标签被改（灾难级 → 极高风险）→ 指出第 6 档', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendFlood: FRONTEND_FLOOD.replace("label: '灾难级'", "label: '极高风险'"),
    })
    expect(problems.some((p) => p.includes('第 6 档漂移'))).toBe(true)
  })
})
