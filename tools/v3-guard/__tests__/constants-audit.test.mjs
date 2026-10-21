import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  auditSharedConstants,
  parseBackendBizCodes,
  parseFrontendBizCodes,
  parseNumericConst,
  scanLocalGulfBoundsDefs,
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
const BACKEND_GIS = `export const GULF_BOUNDS = {
  minLng: 105,
  maxLng: 115,
  minLat: 18,
  maxLat: 25,
} as const
`
const FRONTEND_CRS = `export const BEIBU_GULF_BBOX = {
  minLng: 105.0,
  maxLng: 115.0,
  minLat: 18.0,
  maxLat: 25.0,
} as const
`
// D29 tools 侧唯一来源：`.mjs` 无 `as const` 也要能解析。
const TOOLS_GULF = `export const GULF_BOUNDS = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }
`
// D4② 寻路权重口径：后端 MODE_WEIGHT 键为权威；前端两处手抄 mode 联合。
const BACKEND_ROUTE = `const MODE_WEIGHT = {
  distance: { cost: 'cost_m', reverseCost: 'reverse_cost_m' },
  time: { cost: 'route_cost_min', reverseCost: 'route_reverse_cost_min' },
} as const
`
const FRONTEND_ROUTE = `export interface RoutePathParams {
  fromLng: number
  /** 权重口径：distance=距离（米）/ time=时长（分） */
  mode?: 'distance' | 'time'
}
export interface RoutePathResult {
  found: true
  mode: 'distance' | 'time'
  distanceM: number
}
`
// D29/A1 flood 分段跨语言：Python flood_realify.py 的 RISK_BANDS/RISK_CODE 手抄 TS 权威。
const FLOOD_PY = `RISK_CODE = {"无风险": 0, "低风险": 1, "中风险": 2, "高风险": 3, "极高风险": 4, "灾难级": 5}

RISK_BANDS = [
    (0, "无风险"),
    (2, "低风险"),
    (4.3, "中风险"),
    (6, "高风险"),
    (8, "极高风险"),
    (float("inf"), "灾难级"),
]
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
    backendGis: BACKEND_GIS,
    frontendCrs: FRONTEND_CRS,
    backendRoute: BACKEND_ROUTE,
    frontendRoute: FRONTEND_ROUTE,
    floodPy: FLOOD_PY,
    toolsGulfBounds: TOOLS_GULF,
    // 唯一来源判据的输入集合：正常仓库 = 无第二份手抄（扫到的都是合法派生）
    localBoundDefs: [],
  }

  it('双侧一致 → 无问题', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('@guard-red-sample 后端 MODE_WEIGHT 新增 mode 而前端未同步 ⇒ 必红（D4②）', () => {
    const problems = auditSharedConstants({
      ...base,
      backendRoute: BACKEND_ROUTE.replace(
        '  time: {',
        "  scenic: { cost: 'cost_m', reverseCost: 'reverse_cost_m' },\n  time: {"
      ),
    })
    expect(problems.some((p) => p.includes('寻路 mode') && p.includes('缺 [scenic]'))).toBe(true)
  })

  it('@guard-red-sample 前端多出一个后端不存在的 mode ⇒ 必红（D4②）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendRoute: FRONTEND_ROUTE.replace(
        /mode\??: 'distance' \| 'time'/g,
        "mode?: 'distance' | 'time' | 'walk'"
      ),
    })
    expect(problems.some((p) => p.includes('寻路 mode') && p.includes('多 [walk]'))).toBe(true)
  })

  it('@guard-red-sample 前端第二处手抄漏同步 ⇒ 必红（两处都要对账）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendRoute: FRONTEND_ROUTE.replace(
        "  mode: 'distance' | 'time'\n",
        "  mode: 'distance'\n"
      ),
    })
    expect(problems.some((p) => p.includes('寻路 mode 第 2 处') && p.includes('缺 [time]'))).toBe(
      true
    )
  })

  it('寻路口径常量被改名/删除 ⇒ 解析失败必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({ ...base, backendRoute: 'export const X = 1' })
    expect(problems.some((p) => p.includes('寻路口径解析失败'))).toBe(true)
  })

  it('@guard-red-sample 业务边界框漂移（前端 maxLng 收紧到 112）⇒ 必红（d036）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendCrs: FRONTEND_CRS.replace('maxLng: 115.0', 'maxLng: 112.0'),
    })
    expect(problems.some((p) => p.includes('业务边界框 maxLng 前后端漂移'))).toBe(true)
  })

  it('@guard-red-sample 边界框常量被改名 ⇒ 解析失败必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({ ...base, backendGis: 'export const X = 1' })
    expect(problems.some((p) => p.includes('业务边界框解析失败'))).toBe(true)
  })

  it('@guard-red-sample tools 侧业务边界漂移（maxLng 115→112）⇒ 必红（D29 唯一来源）', () => {
    const problems = auditSharedConstants({
      ...base,
      toolsGulfBounds:
        'export const GULF_BOUNDS = { minLng: 105, maxLng: 112, minLat: 18, maxLat: 25 }',
    })
    expect(problems.some((p) => p.includes('tools 侧漂移') && p.includes('maxLng'))).toBe(true)
  })

  it('@guard-red-sample MAX_WATER_LEVEL 前端漂移（曾写死 15）→ 报问题', () => {
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

  // 2026-10-19：业务边界「唯一来源」不得被绕开。上方 toolsGulfBounds 一致性只证明
  // tools/lib/gulf-bounds.mjs 与后端同值，证明不了「没有第二份手抄」——
  // tools/db/db-import.mjs 与 tools/gis-import/verify.mjs 都曾各自定义过。
  it('@guard-red-sample 出现第二份手抄 GULF_BOUNDS ⇒ 必红（§七-7 无权威源的多份副本）', () => {
    const problems = auditSharedConstants({
      ...base,
      localBoundDefs: [{ file: 'tools/db/db-import.mjs', line: 18 }],
    })
    expect(
      problems.some((p) => p.includes('第二份手抄副本') && p.includes('db-import.mjs:18'))
    ).toBe(true)
  })

  it('唯一来源判据输入缺失（未提供 localBoundDefs）⇒ 必红，不许静默放行', () => {
    const { localBoundDefs: _omit, ...withoutInput } = base
    const problems = auditSharedConstants(withoutInput)
    expect(problems.some((p) => p.includes('判据输入缺失'))).toBe(true)
  })
})

describe('scanLocalGulfBoundsDefs — 只咬「复制了值」，不咬「提到了名字」', () => {
  // 判据咬的是「复制了值」。以下几种形态都必须区分开，否则判据会逼作者把
  // 合法派生改成更难读的写法（§5.3 式 3 等价重构必须绿的反面）。
  const mkFixture = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-scan-'))
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content, 'utf8')
    }
    return dir
  }

  it('写死数值的副本 ⇒ 命中（真违约）', () => {
    const dir = mkFixture({
      'tools/db/copy.mjs': 'const GULF_BOUNDS = { minLng: 105, maxLng: 115 }\n',
    })
    const hits = scanLocalGulfBoundsDefs(dir)
    expect(hits).toHaveLength(1)
    expect(hits[0].file).toBe('tools/db/copy.mjs')
    expect(hits[0].line).toBe(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('从权威源解析（parseGulfBounds(readFileSync(...))）⇒ 不命中（合法派生）', () => {
    const dir = mkFixture({
      'tools/gis-import/verify.mjs':
        "const GULF_BOUNDS = parseGulfBounds(readFileSync(GULF_BOUNDS_FILE, 'utf8'))\n",
    })
    expect(scanLocalGulfBoundsDefs(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('import 取值得来的 ⇒ 不命中（合法）', () => {
    const dir = mkFixture({
      'tools/x/use.mjs': "import { GULF_BOUNDS } from '../lib/gulf-bounds.mjs'\n",
    })
    expect(scanLocalGulfBoundsDefs(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('唯一来源本体与测试夹具 ⇒ 豁免（它们本来就是定义处 / 红样）', () => {
    const dir = mkFixture({
      'tools/lib/gulf-bounds.mjs': 'export const GULF_BOUNDS = { minLng: 105 }\n',
      'tools/x/__tests__/y.test.mjs': 'const GULF_BOUNDS = { minLng: 105 }\n',
    })
    expect(scanLocalGulfBoundsDefs(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('阳性对照：扫描器必须在含违约的夹具上非空（治「0 命中 = 扫描器没跑」的假绿）', () => {
    const dir = mkFixture({
      'tools/db/copy.mjs': 'const GULF_BOUNDS = { minLng: 105 }\n',
      'tools/gis-import/verify.mjs': 'const GULF_BOUNDS = parseGulfBounds(x)\n',
    })
    const hits = scanLocalGulfBoundsDefs(dir)
    expect(hits.length).toBeGreaterThan(0)
    fs.rmSync(dir, { recursive: true, force: true })
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

describe('flood 风险分段跨语言（TS ↔ PY · D29/A1）', () => {
  const base = {
    backendFlood: BACKEND_FLOOD,
    frontendFlood: FRONTEND_FLOOD,
    backendBiz: BACKEND_BIZ,
    frontendBiz: FRONTEND_BIZ,
    floodPy: FLOOD_PY,
  }

  it('@guard-red-sample PY 某档阈值漂移（4.3 → 5）⇒ 必红（指出第 3 档）', () => {
    const problems = auditSharedConstants({
      ...base,
      floodPy: FLOOD_PY.replace('(4.3, "中风险")', '(5, "中风险")'),
    })
    expect(problems.some((p) => p.includes('第 3 档 TS↔PY 漂移'))).toBe(true)
  })

  it('@guard-red-sample PY 风险码表漂移（灾难级→2）⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      floodPy: FLOOD_PY.replace('"灾难级": 5', '"灾难级": 2'),
    })
    expect(problems.some((p) => p.includes('风险码表 PY 漂移'))).toBe(true)
  })

  it('@guard-red-sample PY 分档被删 ⇒ 解析失败必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({ ...base, floodPy: 'X = 1' })
    expect(problems.some((p) => p.includes('Python 副本解析失败'))).toBe(true)
  })
})
