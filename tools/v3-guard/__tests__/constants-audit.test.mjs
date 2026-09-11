import { describe, expect, it } from 'vitest'

import {
  auditSharedConstants,
  parseBackendBizCodes,
  parseFrontendBizCodes,
  parseNumericConst,
} from '../constants-audit.mjs'

const BACKEND_FLOOD = `// 水位上限（米）：251 档 0-25m
export const MAX_WATER_LEVEL = 25
export const RISK_LEVEL_BANDS = [] as const
`
const FRONTEND_FLOOD = `// 水位上限（米）：与 backend 同源
export const MAX_WATER_LEVEL = 25
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
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('MAX_WATER_LEVEL')
    expect(problems[0]).toContain('backend=25 frontend=15')
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
