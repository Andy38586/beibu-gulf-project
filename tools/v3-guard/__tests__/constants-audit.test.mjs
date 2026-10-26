import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  auditSharedConstants,
  parseBackendBizCodes,
  parseEnvPort,
  parseFrontendBizCodes,
  parseNumericConst,
  parseNumericLiterals,
  parseAliasTarget,
  parsePyRiskBands,
  parseRiskBands,
  parsePortMaps,
  parseStorageKeys,
  parseTsconfigAlias,
  parseViteProxyPorts,
  scanLocalGulfBoundsDefs,
  scanStrayStorageKeys,
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
// B1 跨端请求头名：前后端各一份副本；前端 x-task-client 刻意不 export（只在本文件用）。
const FE_API_REQUEST = `export const REQUEST_ID_HEADER = 'x-request-id'
`
const BE_ERROR_FILTER = `export const REQUEST_ID_HEADER = 'x-request-id'
`
const FE_TASK_API = `const TASK_CLIENT_HEADER = 'x-task-client'
`
const BE_REQUEST_OWNER = `export const TASK_CLIENT_HEADER = 'x-task-client'
`
// PC-2 浮点容差：后端三档全集（求和 1e-6 / 几何 1e-9 / 迭代 1e-12），前端只持几何档。
const BACKEND_TOL = `export const SUM_TOLERANCE = 1e-6
export const COMPARE_TOLERANCE = 1e-9
export const ITERATION_TOLERANCE = 1e-12
`
const FRONTEND_TOL = `export const COMPARE_TOLERANCE = 1e-9
`
// TASK_DOMAINS 跨端同值数组：前后端各写一份，值必须逐字一致。
const BACKEND_TASK_DOMAINS = `export const TASK_DOMAINS = ['flood-areas', 'route-path', 'site-suitability-map'] as const
`
const FRONTEND_TASK_DOMAINS = `export const TASK_DOMAINS = ['flood-areas', 'route-path', 'site-suitability-map'] as const
`
// PC-3 端口族：.env.example 为声明权威，五个副本站点按真实文件形状缩样。
const ENV_EXAMPLE = `# 监听端口（统一 3000）
PORT=3000
PG_PORT=5432
`
const CONFIG_SERVICE = `this.port = Number(env.PORT) || 3000
`
const DB_CONFIG = `const port = Number(env.PG_PORT ?? 5432)
  port: Number.isInteger(port) && port > 0 ? port : 5432,
`
const COMPOSE_MAIN = `      PORT: '3000'
      PG_PORT: '5432'
      test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3000/nest-api/health/ready || exit 1']
`
const COMPOSE_V3 = `    ports:
      - '5432:5432'
`
const VITE_CONFIG = `          target: 'http://127.0.0.1:3000',
          target: 'http://127.0.0.1:3000',
          target: 'http://127.0.0.1:3000',
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
`
const SERVER_SETUP = `PORT=3000
`
// PC-4 路径别名族：tsconfig 为参照（类型侧），vite/vitest 须同键同目标。
const TSCONFIG_APP = `"compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    },
`
const VITEST_CONFIG = `  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
`
// PC-5 存储键族：权威源（缩样）与消费侧手抄夹具。
const STORAGE_KEYS_AUTH = `export const STORAGE_KEYS = {
  authUser: 'beibu-gulf-user',
  theme: 'gcs-theme',
} as const
`

// 全量基座：所有族的输入齐全（唯一来源扫描正常返回空）。各 describe 在此之上做覆盖/删键变异；
// 想做「只看本族」的断言时按问题文本过滤，不要裁剪基座——auditSharedConstants 是全族审计。
const base = {
  backendFlood: BACKEND_FLOOD,
  frontendFlood: FRONTEND_FLOOD,
  backendBiz: BACKEND_BIZ,
  frontendBiz: FRONTEND_BIZ,
  backendGis: BACKEND_GIS,
  frontendCrs: FRONTEND_CRS,
  backendRoute: BACKEND_ROUTE,
  frontendRoute: FRONTEND_ROUTE,
  backendTaskDomains: BACKEND_TASK_DOMAINS,
  frontendTaskDomains: FRONTEND_TASK_DOMAINS,
  floodPy: FLOOD_PY,
  toolsGulfBounds: TOOLS_GULF,
  // 唯一来源判据的输入集合：正常仓库 = 无第二份手抄（扫到的都是合法派生）
  localBoundDefs: [],
  frontendApiRequest: FE_API_REQUEST,
  backendErrorFilter: BE_ERROR_FILTER,
  frontendTaskApi: FE_TASK_API,
  backendRequestOwner: BE_REQUEST_OWNER,
  frontendTolerance: FRONTEND_TOL,
  backendTolerance: BACKEND_TOL,
  backendEnvExample: ENV_EXAMPLE,
  backendConfigService: CONFIG_SERVICE,
  backendDbConfig: DB_CONFIG,
  composeMain: COMPOSE_MAIN,
  composeV3: COMPOSE_V3,
  viteConfig: VITE_CONFIG,
  serverSetup: SERVER_SETUP,
  frontendTsconfigApp: TSCONFIG_APP,
  frontendVitestConfig: VITEST_CONFIG,
  storageKeys: STORAGE_KEYS_AUTH,
  strayStorageKeys: [],
}

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
  it('双侧一致 → 无问题', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('@guard-red-sample 前端改 x-request-id ⇒ 必红（B1）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendApiRequest: FE_API_REQUEST.replace("'x-request-id'", "'x-trace-id'"),
    })
    expect(
      problems.some((p) => p.includes('请求头名漂移') && p.includes('REQUEST_ID_HEADER'))
    ).toBe(true)
  })

  it('@guard-red-sample 后端改 x-task-client ⇒ 必红（B1，反向也咬）', () => {
    const problems = auditSharedConstants({
      ...base,
      backendRequestOwner: BE_REQUEST_OWNER.replace("'x-task-client'", "'x-task-id'"),
    })
    expect(
      problems.some((p) => p.includes('请求头名漂移') && p.includes('TASK_CLIENT_HEADER'))
    ).toBe(true)
  })

  it('@guard-red-sample 头名常量被改名/删除 ⇒ 解析失败必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({
      ...base,
      backendErrorFilter: BE_ERROR_FILTER.replace('REQUEST_ID_HEADER', 'RID_HEADER'),
    })
    expect(
      problems.some((p) => p.includes('请求头名解析失败') && p.includes('REQUEST_ID_HEADER'))
    ).toBe(true)
  })

  it('等价重构（给前端常量补 export、换声明位置）⇒ 不误红（变异四式第 3 式）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTaskApi: `// 头名在这里声明\nexport const TASK_CLIENT_HEADER = 'x-task-client'\n`,
    })
    expect(problems).toEqual([])
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

  it('@guard-red-sample 后端 TASK_DOMAINS 新增域而前端未同步 ⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      backendTaskDomains: BACKEND_TASK_DOMAINS.replace(
        "'site-suitability-map'",
        "'site-suitability-map', 'forecast-map'"
      ),
    })
    expect(problems.some((p) => p.includes('TASK_DOMAINS') && p.includes('forecast-map'))).toBe(
      true
    )
  })

  it('@guard-red-sample 前端 TASK_DOMAINS 顺序不同 ⇒ 必红（顺序敏感）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTaskDomains: FRONTEND_TASK_DOMAINS.replace(
        "['flood-areas', 'route-path', 'site-suitability-map']",
        "['route-path', 'flood-areas', 'site-suitability-map']"
      ),
    })
    expect(problems.some((p) => p.includes('TASK_DOMAINS'))).toBe(true)
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

describe('浮点容差跨端同族对账（PC-2/W72）', () => {
  it('parseNumericLiterals：指数/小数形式按数值归一', () => {
    expect(parseNumericLiterals(BACKEND_TOL)).toEqual({
      SUM_TOLERANCE: 1e-6,
      COMPARE_TOLERANCE: 1e-9,
      ITERATION_TOLERANCE: 1e-12,
    })
  })

  it('前端子集同值 → 容差族无问题（全量基座下其余族也绿）', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('等价重构：1e-9 写成 0.000000001 ⇒ 不误红（变异四式第 3 式）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTolerance: 'export const COMPARE_TOLERANCE = 0.000000001\n',
    })
    expect(problems).toEqual([])
  })

  it('等价重构：注释/声明位置变化 ⇒ 不误红', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTolerance: '// 几何档在前\nconst COMPARE_TOLERANCE = 1e-9\n',
    })
    expect(problems).toEqual([])
  })

  it('@guard-red-sample 前端档值漂移（1e-9 → 1e-12）⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTolerance: 'export const COMPARE_TOLERANCE = 1e-12\n',
    })
    expect(
      problems.some((p) => p.includes('浮点容差跨端漂移') && p.includes('COMPARE_TOLERANCE'))
    ).toBe(true)
  })

  it('@guard-red-sample 后端档值漂移（1e-9 → 1e-6）⇒ 必红（反向也咬）', () => {
    const problems = auditSharedConstants({
      ...base,
      backendTolerance: BACKEND_TOL.replace('COMPARE_TOLERANCE = 1e-9', 'COMPARE_TOLERANCE = 1e-6'),
    })
    expect(
      problems.some((p) => p.includes('浮点容差跨端漂移') && p.includes('COMPARE_TOLERANCE'))
    ).toBe(true)
  })

  it('@guard-red-sample 前端自立后端不存在的档名 ⇒ 必红（后端为全集权威）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendTolerance: 'export const COMPARE_TOLERANCE = 1e-9\nexport const MY_EPS = 1e-3\n',
    })
    expect(
      problems.some((p) => p.includes('档位在后端同族文件不存在') && p.includes('MY_EPS'))
    ).toBe(true)
  })

  it('@guard-red-sample 前端容差文件被清空 ⇒ 必红（判据输入不许为空，W58 同族）', () => {
    const problems = auditSharedConstants({ ...base, frontendTolerance: 'export const X = "s"\n' })
    expect(problems.some((p) => p.includes('浮点容差解析失败'))).toBe(true)
  })

  it('@guard-red-sample 后端容差文件被改名/清空 ⇒ 必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({ ...base, backendTolerance: '// 只剩注释\n' })
    expect(problems.some((p) => p.includes('浮点容差解析失败'))).toBe(true)
  })
})

describe('端口跨进程副本对账（PC-3/W53）', () => {
  it('parseEnvPort：行首锚定，PG_PORT 不撞 PORT', () => {
    expect(parseEnvPort(ENV_EXAMPLE, 'PORT')).toBe(3000)
    expect(parseEnvPort(ENV_EXAMPLE, 'PG_PORT')).toBe(5432)
  })

  it('parseViteProxyPorts / parsePortMaps：多点站点全收集', () => {
    expect(parseViteProxyPorts(VITE_CONFIG)).toEqual([3000, 3000, 3000])
    expect(parsePortMaps(COMPOSE_V3)).toEqual([[5432, 5432]])
  })

  it('全副本对等 → 无问题', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('等价重构：compose 冒号后加空格、兜底表达式去空格 ⇒ 不误红', () => {
    const problems = auditSharedConstants({
      ...base,
      composeMain: COMPOSE_MAIN.replace("PORT: '3000'", "PORT:   '3000'"),
      backendConfigService: 'this.port = Number(env.PORT)||3000\n',
    })
    expect(problems).toEqual([])
  })

  it('@guard-red-sample 权威改口（PORT=3001）⇒ 全部副本站点必红', () => {
    const problems = auditSharedConstants({
      ...base,
      backendEnvExample: ENV_EXAMPLE.replace('PORT=3000', 'PORT=3001'),
    })
    expect(problems.filter((p) => p.includes('端口漂移')).length).toBeGreaterThanOrEqual(4)
    expect(problems.some((p) => p.includes('config.service.ts') && p.includes('=3001'))).toBe(true)
    expect(problems.some((p) => p.includes('vite.config.js') && p.includes(':3000'))).toBe(true)
  })

  it('@guard-red-sample vite 一处代理目标漂移（3000→3001）⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      viteConfig: VITE_CONFIG.replace('3000', '3001'),
    })
    expect(
      problems.some(
        (p) => p.includes('端口漂移') && p.includes('vite.config.js') && p.includes(':3001')
      )
    ).toBe(true)
  })

  it('@guard-red-sample db.config 非法值回落漂移（5432→15432）⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      backendDbConfig: DB_CONFIG.replace('? port : 5432', '? port : 15432'),
    })
    expect(
      problems.some(
        (p) => p.includes('端口漂移') && p.includes('非法值回落') && p.includes('=15432')
      )
    ).toBe(true)
  })

  it('@guard-red-sample v3 compose postgres 暴露漂移（host 侧 15432）⇒ 必红', () => {
    const problems = auditSharedConstants({
      ...base,
      composeV3: "    ports:\n      - '15432:5432'\n",
    })
    expect(problems.some((p) => p.includes('docker-compose.v3.yml') && p.includes('15432'))).toBe(
      true
    )
  })

  it('@guard-red-sample .env.example 删掉 PG_PORT ⇒ 权威解析失败必红', () => {
    const problems = auditSharedConstants({
      ...base,
      backendEnvExample: 'PORT=3000\n',
    })
    expect(problems.some((p) => p.includes('缺 PG_PORT= 行'))).toBe(true)
  })

  it('@guard-red-sample compose 健康探针被删 ⇒ 副本解析失败必红（不许静默当通过）', () => {
    const problems = auditSharedConstants({
      ...base,
      composeMain: "      PORT: '3000'\n      PG_PORT: '5432'\n",
    })
    expect(problems.some((p) => p.includes('端口副本解析失败') && p.includes('健康探针'))).toBe(
      true
    )
  })
})

describe('路径别名三侧对账（PC-4/W43）', () => {
  it('parseTsconfigAlias：剥离 glob 后缀与 ./ 前缀', () => {
    expect(parseTsconfigAlias(TSCONFIG_APP)).toEqual({ key: '@', target: 'src' })
  })

  it('parseAliasTarget：按 key 锚定，不误咬同数组的正则 find 项', () => {
    expect(parseAliasTarget(VITE_CONFIG, '@')).toBe('src')
    expect(parseAliasTarget(VITE_CONFIG + '        { find: /^cesium$/ },', '@')).toBe('src')
    expect(parseAliasTarget(VITEST_CONFIG, '@')).toBe('src')
    expect(parseAliasTarget(VITE_CONFIG, '~')).toBeNull()
  })

  it('三侧同键同目标 → 无问题', () => {
    expect(auditSharedConstants(base)).toEqual([])
  })

  it('等价重构：vitest 键改双引号、tsconfig 缩进变化 ⇒ 不误红', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendVitestConfig: VITEST_CONFIG.replace("'@'", '"@"'),
      frontendTsconfigApp: TSCONFIG_APP.replace('    "paths"', '  "paths"'),
    })
    expect(problems).toEqual([])
  })

  it('@guard-red-sample vitest 目标漂移（./src → ./test）⇒ 必红（测试侧解析分叉）', () => {
    const problems = auditSharedConstants({
      ...base,
      frontendVitestConfig: VITEST_CONFIG.replace('./src', './test'),
    })
    expect(problems.some((p) => p.includes('路径别名漂移') && p.includes('vitest.config.js'))).toBe(
      true
    )
  })

  it('@guard-red-sample tsconfig paths 被删 ⇒ 参照解析失败必红', () => {
    const problems = auditSharedConstants({ ...base, frontendTsconfigApp: '{}' })
    expect(problems.some((p) => p.includes('路径别名解析失败') && p.includes('tsconfig'))).toBe(
      true
    )
  })

  it('@guard-red-sample vite 别名键改名（@ → ~）⇒ 缺定义必红', () => {
    const problems = auditSharedConstants({
      ...base,
      viteConfig: VITE_CONFIG.replace("find: '@'", "find: '~'"),
    })
    expect(problems.some((p) => p.includes("缺 '@' 的定义") && p.includes('vite.config.js'))).toBe(
      true
    )
  })
})

describe('存储键唯一来源（PC-5/W63）', () => {
  it('parseStorageKeys：从权威源解析键清单（守卫不手抄键值）', () => {
    expect(parseStorageKeys(STORAGE_KEYS_AUTH)).toEqual({
      authUser: 'beibu-gulf-user',
      theme: 'gcs-theme',
    })
  })

  it('scanStrayStorageKeys：手抄命中 / 权威与测试豁免 / 注释裸提不误伤', () => {
    const mk = (files) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-keys-'))
      for (const [rel, content] of Object.entries(files)) {
        const p = path.join(dir, rel)
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, content, 'utf8')
      }
      return dir
    }
    const dir = mk({
      // 权威本体：豁免
      'shared/constants/storageKeys.ts': "export const STORAGE_KEYS = { theme: 'gcs-theme' }\n",
      // 第二份手抄：命中
      'composables/useX.ts': "const K = 'gcs-theme'\n",
      // 注释里裸提键名：不命中（引号锚定）
      'layout/y.ts': '// 主题存于 gcs-theme 键\n',
      // 测试夹具：豁免
      'composables/__tests__/x.test.ts': "const K = 'gcs-theme'\n",
    })
    const hits = scanStrayStorageKeys(dir, 'frontend/src/shared/constants/storageKeys.ts', [
      'gcs-theme',
    ])
    expect(hits).toEqual([{ file: 'frontend/src/composables/useX.ts', line: 1, key: 'gcs-theme' }])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('scanStrayStorageKeys：键清单为空 ⇒ 返回空（由权威解析失败判据兜底）', () => {
    expect(scanStrayStorageKeys('nonexistent-dir', 'frontend/src/x', [])).toEqual([])
  })

  it('全绿基座：无第二份手抄 → 存储键族无问题', () => {
    const problems = auditSharedConstants(base).filter((p) => p.includes('存储键'))
    expect(problems).toEqual([])
  })

  it('@guard-red-sample 出现第二份手抄 ⇒ 必红（§七-7）', () => {
    const problems = auditSharedConstants({
      ...base,
      strayStorageKeys: [{ file: 'frontend/src/composables/useX.ts', line: 9, key: 'gcs-theme' }],
    })
    expect(problems.some((p) => p.includes('存储键第二份手抄') && p.includes('useX.ts:9'))).toBe(
      true
    )
  })

  it('@guard-red-sample 判据输入缺失（strayStorageKeys 未提供）⇒ 必红', () => {
    const { strayStorageKeys: _omit, ...withoutInput } = base
    const problems = auditSharedConstants(withoutInput)
    expect(problems.some((p) => p.includes('存储键唯一来源判据输入缺失'))).toBe(true)
  })

  it('@guard-red-sample 权威源被清空 ⇒ 解析失败必红', () => {
    const problems = auditSharedConstants({ ...base, storageKeys: '// 只剩注释\n' })
    expect(problems.some((p) => p.includes('存储键权威解析失败'))).toBe(true)
  })
})

describe('F70 风险带解析单骨架', () => {
  it('TS 与 PY 同档位/同标签 ⇒ 同一解析结果', () => {
    const ts = parseRiskBands(
      "export const RISK_LEVEL_BANDS = [\n  { maxLevel: 2, label: '低风险' },\n] as const",
      'RISK_LEVEL_BANDS'
    )
    const py = parsePyRiskBands('RISK_BANDS = [\n  (2, "低风险"),\n]')
    expect(ts).toEqual(py)
    expect(ts).toEqual([{ maxLevel: '2', label: '低风险' }])
  })
})
