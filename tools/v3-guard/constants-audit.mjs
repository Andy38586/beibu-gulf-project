#!/usr/bin/env node
/**
 * constants-audit.mjs — 跨进程共享常量一致性守卫。
 *
 * 前后端各自维护的"同一权威值"（水位上限、登录业务码、请求头名）是双轨排查方案定义的
 * 跨进程副本——类型系统够不着、改一侧不报错。本守卫把双侧值解析出来做一致性
 * 断言，漂移在 guard:v3 拦下而非线上静默失效。
 *
 * 用法：node tools/v3-guard/constants-audit.mjs   # 不一致 exit 1
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { walkFiles } from './lib/walk.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const BACKEND_FLOOD_CONSTANTS = 'backend/src/common/constants/flood.constants.ts'
const FRONTEND_FLOOD_CONSTANTS = 'frontend/src/shared/constants/flood.ts'
const BACKEND_BUSINESS_ERROR = 'backend/src/common/errors/business-error.ts'
const FRONTEND_BIZ_CODES = 'frontend/src/shared/constants/bizCodes.ts'
const BACKEND_GIS_CONSTANTS = 'backend/src/common/constants/gis.constants.ts'
const FRONTEND_CRS = 'frontend/src/shared/utils/crs.ts'
// D29/A1：flood 风险分段跨语言。后端 TS `RISK_LEVEL_BANDS` 为权威，Python
// `tools/flood/flood_realify.py` 的 `RISK_BANDS`/`RISK_CODE` 是手抄副本（生成侧离线跑、不在 CI），
// 此前只靠注释挂接 —— 改 TS 一侧 PY 不报错，须逐档对账。
const FLOOD_PY_REALIFY = 'tools/flood/flood_realify.py'
// D29：tools 侧业务边界的**唯一来源**（工具脚本统一从这里取；权威仍是 backend GULF_BOUNDS）。
const TOOLS_GULF_BOUNDS = 'tools/lib/gulf-bounds.mjs'
// D4②：寻路权重口径。后端 MODE_WEIGHT 的键为权威；前端 types/route.ts 里 mode 的
// 字面量联合是手抄（当前两处：RoutePathParams.mode 与 RoutePathResult.mode）。
const BACKEND_ROUTE_MODES = 'backend/src/modules/route/repositories/route.repository.ts'
const FRONTEND_ROUTE_TYPES = 'frontend/src/types/route.ts'
// B1：跨端请求头名。前后端不共享模块，同一头名各写一份，改一侧另一侧不报错——
// 后果是日志里搜不到对方写的头（rid 跨端断链 / 任务属主识别失效）。
// 只断言两侧字面量相等，不选哪侧是权威源（选边属 §四-9）。
const FRONTEND_API_REQUEST = 'frontend/src/shared/composables/useApiRequest.ts'
const BACKEND_ERROR_FILTER = 'backend/src/common/filters/business-error.filter.ts'
const FRONTEND_TASK_API = 'frontend/src/shared/composables/useTaskApi.ts'
const BACKEND_REQUEST_OWNER = 'backend/src/modules/task/utils/request-owner.ts'
// PC-2（W72）：浮点容差跨端同族。后端 numeric-tolerance.ts 持有三档全集，
// 前端 tolerance.ts 只持有前端用到的几何档——前端是后端的**子集**，同名档必须同值。
const BACKEND_TOLERANCE = 'backend/src/common/numeric-tolerance.ts'
const FRONTEND_TOLERANCE = 'frontend/src/shared/constants/tolerance.ts'
// PC-3（W53）：端口 3000/5432 跨进程手抄族。backend/.env.example 是**声明权威**
// （其注释自述「与 docker-compose.yml / vite proxy 一致」——注释不是判据，本族把它变成判据）：
// 运行时兜底字面量、compose 容器 env、compose 健康探针、vite 代理目标、生产初始化脚本
// 各持一份副本，改一处漏一处不会报错。权威值不写死在本守卫里，逐站点解析对等。
const PORT_AUTHORITY_FILE = 'backend/.env.example'
const BACKEND_CONFIG_SERVICE = 'backend/src/infra/config/config.service.ts'
const BACKEND_DB_CONFIG = 'backend/src/infra/db/db.config.ts'
const COMPOSE_MAIN = 'docker-compose.yml'
const COMPOSE_V3 = 'docker-compose.v3.yml'
const FRONTEND_VITE_CONFIG = 'frontend/vite.config.js'
const SERVER_SETUP_SH = 'scripts/server-setup.sh'
// PC-4（W43）：路径别名对账。`@ → ./src` 在 tsconfig（类型侧）、vite（dev/build 侧）、
// vitest（测试侧）各写一份，三套解析器互不隶属——改一处漏两处时 typecheck 与
// 运行时/测试的解析分叉（测试绿但跑的是另一份代码）。以 tsconfig 为参照，
// 另两处必须同键同目标。
const FRONTEND_TSCONFIG_APP = 'frontend/tsconfig.app.json'
const FRONTEND_VITEST_CONFIG = 'frontend/vitest.config.js'
// PC-5（W63）：本地存储键唯一来源。权威源持有全部键定义；消费侧 import，
// 第二份手抄即红。键清单由守卫从权威源解析派生（不写死在守卫里）。
const FRONTEND_STORAGE_KEYS = 'frontend/src/shared/constants/storageKeys.ts'

/** 单值端口副本站点表：re 的第 1 捕获组 = 端口数字。key 对应 auditSharedConstants 输入键 */
const PORT_SITES = [
  {
    label: '运行时兜底 backend/src/infra/config/config.service.ts',
    key: 'backendConfigService',
    re: /Number\(env\.PORT\)\s*\|\|\s*(\d+)/,
  },
  {
    label: 'compose 容器 env docker-compose.yml',
    key: 'composeMain',
    re: /(?<![A-Za-z_])PORT:\s*'(\d+)'/,
  },
  {
    label: 'compose 健康探针 docker-compose.yml',
    key: 'composeMain',
    re: /http:\/\/127\.0\.0\.1:(\d+)\/nest-api\/health/,
  },
  {
    label: '生产初始化 scripts/server-setup.sh',
    key: 'serverSetup',
    re: /^PORT=(\d+)\s*$/m,
  },
]
const PG_PORT_SITES = [
  {
    label: '运行时兜底 db.config.ts 读侧',
    key: 'backendDbConfig',
    re: /env\.PG_PORT\s*\?\?\s*(\d+)/,
  },
  {
    label: '运行时兜底 db.config.ts 非法值回落',
    key: 'backendDbConfig',
    re: /\?\s*port\s*:\s*(\d+)/,
  },
  {
    label: 'compose 容器 env docker-compose.yml',
    key: 'composeMain',
    re: /(?<![A-Za-z_])PG_PORT:\s*'(\d+)'/,
  },
]

/** 从文件文本解析 `export const NAME = <数字>`（宽松空白匹配） */
export function parseNumericConst(content, name) {
  const m = content.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`))
  return m ? Number(m[1]) : null
}

/** 从后端 business-error.ts 提取全部业务码（`code: <数字>`） */
export function parseBackendBizCodes(content) {
  return [...content.matchAll(/code:\s*(\d{6})/g)].map((m) => Number(m[1]))
}

/** 从前端 bizCodes.ts 提取全部业务码（`KEY: <数字>` 形式的 6 位数字字面量） */
export function parseFrontendBizCodes(content) {
  return [...content.matchAll(/:\s*(\d{6})/g)].map((m) => Number(m[1]))
}

/**
 * 阈值归一：把语义等价的写法解析成同一串。
 * `Infinity` / `Number.POSITIVE_INFINITY` / `0.0` 都是同一个类的等价重构，
 * 若判据认死其中一种写法，就会诱导作者用另一种来满足它（§5.3 式 4 的反面）。
 */
function normalizeMaxLevel(raw) {
  const compact = raw.replace(/\s+/g, '')
  if (
    /^(Number\.)?POSITIVE_INFINITY$/.test(compact) ||
    compact === 'Infinity' ||
    /^float\(["']inf["']\)$/.test(compact)
  )
    return 'Infinity'
  const n = Number(compact)
  return Number.isFinite(n) ? String(n) : compact
}

/**
 * 从 `export const NAME = [ { maxLevel, label } … ] as const` 解析风险分档表。
 * 分档表是前后端各自手写的同源副本：类型系统够不着、改一侧不报错，
 * 而档位数或阈值错一处就会让展示域整段低报/高报一级，故必须逐档对账。
 */
export function parseRiskBands(content, name) {
  const block = content.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`)
  )
  if (!block) return null
  const items = [...block[1].matchAll(/\{\s*maxLevel:\s*([^,]+?)\s*,\s*label:\s*'([^']*)'\s*\}/g)]
  return items.map((m) => ({ maxLevel: normalizeMaxLevel(m[1]), label: m[2] }))
}

/** 从 Python `RISK_BANDS = [ (0, "无风险"), … ]` 解析分档（跨语言手抄副本） */
export function parsePyRiskBands(content) {
  const block = content.match(/^RISK_BANDS\s*=\s*\[([\s\S]*?)\n\]/m)
  if (!block) return null
  const items = [...block[1].matchAll(/\(\s*([^,]+?)\s*,\s*"([^"]*)"\s*\)/g)]
  return items.map((m) => ({ maxLevel: normalizeMaxLevel(m[1]), label: m[2] }))
}

/** 从 Python `RISK_CODE = { "无风险": 0, … }` 解析「标签 → 码」 */
export function parsePyRiskCode(content) {
  const block = content.match(/^RISK_CODE\s*=\s*\{([\s\S]*?)\}/m)
  if (!block) return null
  const out = {}
  for (const m of block[1].matchAll(/"([^"]+)"\s*:\s*(\d+)/g)) out[m[1]] = Number(m[2])
  return out
}

/**
 * 一致性审计：水位上限双侧同值；风险分档表逐档同源；前端消费的业务码必须是
 * 后端 ErrorCode 的子集（前端允许只消费子集，不允许出现后端已重编/删除的码）。
 */
/**
 * 从 `export const NAME = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }` 解析边界框。
 * d036 收口：后端 `GULF_BOUNDS`（权威）与前端 `BEIBU_GULF_BBOX` 是两份手抄副本，
 * 前端注释写着"与后端同源"——注释不是判据，本函数把它变成逐字段对账。
 */
export function parseBounds(content, name) {
  // `.mjs` 侧无 `as const`、且工具脚本未必 `export` ⇒ 两处放宽（对既有 TS 侧无影响）
  const block = content.match(
    new RegExp(`(?:export\\s+)?const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as const)?`)
  )
  if (!block) return null
  const out = {}
  for (const key of ['minLng', 'maxLng', 'minLat', 'maxLat']) {
    const m = block[1].match(new RegExp(`${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))
    if (!m) return null
    out[key] = Number(m[1])
  }
  return out
}

/** 后端寻路权重口径键集（MODE_WEIGHT 的键 = RouteMode 联合，权威源） */
export function parseBackendModeKeys(content) {
  const block = content.match(/const MODE_WEIGHT = \{([\s\S]*?)\n\} as const/)
  if (!block) return null
  return [...block[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1])
}

/**
 * 前端 mode 字面量联合的全部出现处（可能多处手抄）。
 * 按「引号锚定的字面量联合」提取，注释里的 mode 不含引号字面量，故不会误命中。
 */
export function parseFrontendModeLiterals(content) {
  const out = []
  for (const m of content.matchAll(/\bmode\??\s*:\s*((?:'[^']+'\s*\|\s*)*'[^']+')/g)) {
    out.push([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  }
  return out
}

/**
 * 字符串常量（`[export] const NAME = 'value'`）。
 * 跨端头名这类副本常有一侧不 export（只在本文件内用），故 export 可省。
 */
export function parseStringConst(content, name) {
  const m = content.match(new RegExp(`(?:export\\s+)?const ${name}\\s*=\\s*['"]([^'"]+)['"]`))
  return m ? m[1] : null
}

/**
 * 解析文件里全部数值常量（`[export] const NAME = <字面量>`），按 **数值** 归一：
 * `1e-9` 与 `0.000000001` 是等价写法，必须比成同值（§5.3 式 3：等价重构不许红）；
 * 故解析阶段就转 Number，比较阶段用全等。容差类字面量（1e-6/1e-9/1e-12）是主消费者。
 */
export function parseNumericLiterals(content) {
  const out = {}
  for (const m of content.matchAll(
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)/g
  )) {
    out[m[1]] = Number(m[2])
  }
  return out
}

/** `.env`/`.sh` 的 `KEY=<数字>`（行首锚定：`^PORT=` 不会撞 `PG_PORT=`） */
export function parseEnvPort(content, key) {
  const m = content.match(new RegExp(`^${key}=(\\d+)\\s*$`, 'm'))
  return m ? Number(m[1]) : null
}

/** vite.config 代理目标里的全部 `127.0.0.1:<port>`（多点站点：删光 = 判据输入空） */
export function parseViteProxyPorts(content) {
  return [...content.matchAll(/127\.0\.0\.1:(\d+)/g)].map((m) => Number(m[1]))
}

/** compose `ports:` 暴露映射 host:container 列表 */
export function parsePortMaps(content) {
  return [...content.matchAll(/-\s*'(\d+):(\d+)'/g)].map((m) => [Number(m[1]), Number(m[2])])
}

/** 别名目标归一：`./src/*` 与 `./src` 是同一事实的两种记法（tsconfig 带 glob 后缀） */
function normalizeAliasTarget(raw) {
  return raw.replace(/^\.\//, '').replace(/\/\*$/, '')
}

/** tsconfig `paths` 首条：`"@/*": ["./src/*"]` → { key: '@', target: 'src' } */
export function parseTsconfigAlias(content) {
  const m = content.match(/"([^"/]+)\/\*"\s*:\s*\[\s*"([^"]+?)\/\*"\s*\]/)
  if (!m) return null
  return { key: m[1], target: normalizeAliasTarget(m[2]) }
}

/**
 * vite/vitest 配置里 key 对应的别名目标（找不到返回 null）。
 * 两种形状：vite 数组项 `find: '<key>', replacement: fileURLToPath(new URL('…'))`、
 * vitest 对象 `'<key>': fileURLToPath(new URL('…'))`。按 key 精确锚定——
 * vite 的 alias 数组里并存 `find: /^cesium$/`（正则形状），按 key 锚定才不会误咬。
 */
export function parseAliasTarget(content, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m =
    content.match(
      new RegExp(
        `find:\\s*['"]${esc}['"]\\s*,\\s*replacement:\\s*fileURLToPath\\(new URL\\('([^']+)'`
      )
    ) || content.match(new RegExp(`['"]${esc}['"]\\s*:\\s*fileURLToPath\\(new URL\\('([^']+)'`))
  return m ? normalizeAliasTarget(m[1]) : null
}

/** 业务边界框的四个字段（两侧逐字段对账，键序即报错序） */
const BBOX_KEYS = ['minLng', 'maxLng', 'minLat', 'maxLat']

/** 解析失效判据：null/undefined，或空数组/空对象。**0 与 '' 不是空**（它们是合法取值） */
function isEmptyParsed(v) {
  if (v === null || v === undefined) return true
  return typeof v === 'object' && Object.keys(v).length === 0
}

/**
 * 「两侧（或三侧）副本对账」的统一骨架：**解析 → 任一失效即报解析失败 → 否则逐项比**。
 *
 * 本守卫有 8 组同形对账（水位上限 / 风险分档 TS↔TS / 业务码子集 / 业务边界框 ×2 /
 * 寻路口径 / flood 分段 TS↔PY），四步骨架相同，差异只有三件事：
 * - `read`：取出待比的副本（2 侧或 3 侧）；
 * - `valid`：**失效判据**（默认 null 或空集）—— W58：解析失败必须报红，不许当「无违例」；
 * - `compare`：逐项比规则（同值 / 档位数 / 子集 / 集合差），漂移文案由它逐条给出。
 *
 * 段序即报错序（同一条输入可能有多组问题，测试对 `problems[0]` 有断言）。
 */
const PAIR_AUDITS = [
  {
    // 251 档 0-25m 口径以 backend 为权威，前端须同步
    read: (f) => [
      parseNumericConst(f.backendFlood, 'MAX_WATER_LEVEL'),
      parseNumericConst(f.frontendFlood, 'MAX_WATER_LEVEL'),
    ],
    fail: ([b, f]) => `水位上限常量解析失败：backend=${b} frontend=${f}（常量被改名/删除？）`,
    compare: ([b, f], bad) => {
      if (b !== f) {
        bad(
          `MAX_WATER_LEVEL 前后端漂移：backend=${b} frontend=${f}` +
            '（251 档 0-25m 口径以 backend 为权威，前端须同步）'
        )
      }
    },
  },
  {
    // 档位数不同是历史高发形态：前端曾少末档 ⇒ (最高档阈值, ∞] 段整段回落成上一档，
    // 把最高一档低报一级，而类型系统与两侧各自单测都发现不了。
    read: (f) => [
      parseRiskBands(f.backendFlood, 'RISK_LEVEL_BANDS'),
      parseRiskBands(f.frontendFlood, 'RISK_LEVEL_THRESHOLDS'),
    ],
    valid: ([b, f]) => !!b?.length && !!f?.length,
    fail: ([b, f]) =>
      `风险分档解析失败：backend=${b?.length ?? 'null'} 档 ` +
      `frontend=${f?.length ?? 'null'} 档（常量被改名/删除？）`,
    compare: ([b, f], bad) => {
      if (b.length !== f.length) {
        bad(`风险分档档位数漂移：backend=${b.length} 档 frontend=${f.length} 档`)
        return
      }
      b.forEach((x, i) => {
        if (x.maxLevel !== f[i].maxLevel || x.label !== f[i].label) {
          bad(
            `风险分档第 ${i + 1} 档漂移：backend=${x.maxLevel}/${x.label} ` +
              `frontend=${f[i].maxLevel}/${f[i].label}`
          )
        }
      })
    },
  },
  {
    // 前端允许只消费后端业务码的子集；出现后端已重编/删除的码即漂移
    read: (f) => [parseBackendBizCodes(f.backendBiz), parseFrontendBizCodes(f.frontendBiz)],
    valid: ([b, f]) => b.length > 0 && f.length > 0,
    fail: ([b, f]) => `业务码解析失败：backend=${b.length} 条 frontend=${f.length} 条`,
    compare: ([b, f], bad) => {
      for (const code of f) {
        if (!b.includes(code)) {
          bad(`前端消费的业务码 ${code} 在后端 ErrorCode 中不存在（曾手抄 401002 同款漂移）`)
        }
      }
    },
  },
  {
    // d036：后端 GULF_BOUNDS 为权威，前端 BEIBU_GULF_BBOX 逐字段对账
    read: (f) => [
      parseBounds(f.backendGis ?? '', 'GULF_BOUNDS'),
      parseBounds(f.frontendCrs ?? '', 'BEIBU_GULF_BBOX'),
    ],
    fail: ([b, f]) =>
      `业务边界框解析失败：backend=${JSON.stringify(b)} ` +
      `frontend=${JSON.stringify(f)}（常量被改名/删除？）`,
    compare: ([b, f], bad) => {
      for (const key of BBOX_KEYS) {
        if (b[key] !== f[key]) {
          bad(
            `业务边界框 ${key} 前后端漂移：backend=${b[key]} frontend=${f[key]}` +
              '（后端 GULF_BOUNDS 为权威，前端 BEIBU_GULF_BBOX 须同步）'
          )
        }
      }
    },
  },
  {
    // D29 tools 侧唯一来源：与后端逐字段一致（此前 derive-activity / restore-poi-xiaoqu 各自手抄）
    read: (f) => [
      parseBounds(f.backendGis ?? '', 'GULF_BOUNDS'),
      parseBounds(f.toolsGulfBounds ?? '', 'GULF_BOUNDS'),
    ],
    // 后端侧解析失败已由上一组报出，此处只判 tools 侧（不重复刷屏）
    valid: ([, t]) => !!t,
    fail: () => '业务边界框 tools 侧来源解析失败：tools/lib/gulf-bounds.mjs（常量被改名/删除？）',
    compare: ([b, t], bad) => {
      if (!b) return
      for (const key of BBOX_KEYS) {
        if (b[key] !== t[key]) {
          bad(
            `业务边界框 ${key} tools 侧漂移：tools/lib/gulf-bounds.mjs=${t[key]} ` +
              `backend(权威)=${b[key]}`
          )
        }
      }
    },
  },
  {
    // D4②：后端 MODE_WEIGHT 键为权威，前端 mode 字面量联合逐处一致。
    // 此前前端两处、后端一处，三处无守卫——后端加 mode 前端不报错，前端加后端只会 400。
    read: (f) => [
      parseBackendModeKeys(f.backendRoute ?? ''),
      parseFrontendModeLiterals(f.frontendRoute ?? ''),
    ],
    valid: ([b, f]) => !!b?.length && f.length > 0,
    fail: ([b, f]) =>
      `寻路口径解析失败：backend=${b === null ? 'null' : b.length} 个键 ` +
      `frontend=${f.length} 处（常量被改名/删除？）`,
    compare: ([b, f], bad) => {
      const backendSet = new Set(b)
      f.forEach((literals, i) => {
        const front = new Set(literals)
        const missing = [...backendSet].filter((m) => !front.has(m))
        const extra = [...front].filter((m) => !backendSet.has(m))
        if (missing.length || extra.length) {
          bad(
            `寻路 mode 第 ${i + 1} 处与后端 MODE_WEIGHT 漂移：缺 [${missing.join(',')}] ` +
              `多 [${extra.join(',')}]（backend route.repository 的 MODE_WEIGHT 键为权威）`
          )
        }
      })
    },
  },
  {
    // D29/A1 flood 风险分段跨语言：TS RISK_LEVEL_BANDS 为权威；PY 的 RISK_BANDS 逐档手抄，
    // RISK_CODE 须等于档序。生成侧离线跑、不在 CI，改 TS 一侧 PY 不报错。
    read: (f) => [
      parseRiskBands(f.backendFlood, 'RISK_LEVEL_BANDS'),
      parsePyRiskBands(f.floodPy ?? ''),
      parsePyRiskCode(f.floodPy ?? ''),
    ],
    valid: ([b, p, c]) => !!b && !!p?.length && !!c,
    fail: ([, p, c]) =>
      `flood 风险分段 Python 副本解析失败：bands=${p?.length ?? 'null'} 档 ` +
      `code=${c ? Object.keys(c).length : 'null'} 条（常量被改名/删除？）`,
    compare: ([b, p, c], bad) => {
      if (b.length !== p.length) {
        bad(`flood 风险分段跨语言档位数漂移：TS=${b.length} 档 PY=${p.length} 档`)
        return
      }
      b.forEach((x, i) => {
        if (x.maxLevel !== p[i].maxLevel || x.label !== p[i].label) {
          bad(
            `flood 风险分段第 ${i + 1} 档 TS↔PY 漂移：TS=${x.maxLevel}/${x.label} ` +
              `PY=${p[i].maxLevel}/${p[i].label}（backend flood.constants 为权威）`
          )
        }
        if (c[x.label] !== i) {
          bad(`flood 风险码表 PY 漂移：${x.label} → ${c[x.label]}（应为档序 ${i}）`)
        }
      })
    },
  },
]

/** 依次跑 PAIR_AUDITS：失效即报解析失败，否则逐项对账（漂移文案由条目自己给） */
function runPairAudits(files, problems) {
  for (const a of PAIR_AUDITS) {
    const sides = a.read(files)
    if (a.valid ? !a.valid(sides) : sides.some(isEmptyParsed)) {
      problems.push(a.fail(sides))
      continue
    }
    a.compare(sides, (msg) => problems.push(msg))
  }
}

export function auditSharedConstants(files) {
  const problems = []
  // 业务边界「唯一来源」不得被绕开（2026-10-19）：上方 toolsBbox 一致性只证明
  // `tools/lib/gulf-bounds.mjs` 与后端同值，证明不了「没有第二份手抄」——
  // `tools/db/db-import.mjs` 就这么绕过了一整年（自身注释写「等值副本」却不在任何判据域内）。
  // files.localBoundDefs 由调用方扫全仓得到；空集合必须报红（W58 同族：判据输入为空不许静默通过）。
  // 空集防护的正确形态不是「0 命中即红」（同值手抄全部清掉后就是 0，那时它是绿），
  // 而是**阳性对照**：扫描器必须能在夹具文件里命中一次。见 scanLocalGulfBoundsDefs 的自检。
  const localDefs = files.localBoundDefs
  if (!Array.isArray(localDefs)) {
    problems.push('业务边界唯一来源判据输入缺失：localBoundDefs 未提供（判据失效，不是无违例）')
  } else {
    for (const d of localDefs) {
      problems.push(
        `业务边界出现第二份手抄副本：${d.file}:${d.line} 自定义 GULF_BOUNDS` +
          '（tools 侧唯一取处是 tools/lib/gulf-bounds.mjs，import 它而不是复制它的值）'
      )
    }
  }

  runPairAudits(files, problems)

  // 跨端请求头名（B1）：x-request-id / x-task-client 各有一份前后端副本。
  // 缺失即解析失败（不许静默当通过）；不相等即漂移。
  const headerPairs = [
    ['REQUEST_ID_HEADER', files.frontendApiRequest, files.backendErrorFilter],
    ['TASK_CLIENT_HEADER', files.frontendTaskApi, files.backendRequestOwner],
  ]
  for (const [constName, frontendSrc, backendSrc] of headerPairs) {
    const fe = parseStringConst(frontendSrc ?? '', constName)
    const be = parseStringConst(backendSrc ?? '', constName)
    if (fe === null || be === null) {
      problems.push(
        `请求头名解析失败：${constName} frontend=${fe} backend=${be}（常量被改名/删除？）`
      )
    } else if (fe !== be) {
      problems.push(
        `请求头名漂移：${constName} frontend='${fe}' backend='${be}'` +
          '（同一头名跨端两份副本，须逐字相等，否则日志/属主识别静默断链）'
      )
    }
  }
  // 浮点容差跨端同族（PC-2/W72）：前端 tolerance.ts 的文件头自述「跨端一致性没有守卫」——
  // 本块就是那个守卫。前端是后端三档全集的子集：前端出现的每个档名，后端必须同名且同值。
  // 判据输入为空（文件被清空/改名）不许静默当通过（W58 同族语义）。
  const feTolerance = parseNumericLiterals(files.frontendTolerance ?? '')
  const beTolerance = parseNumericLiterals(files.backendTolerance ?? '')
  const feTolNames = Object.keys(feTolerance)
  if (feTolNames.length === 0 || Object.keys(beTolerance).length === 0) {
    problems.push(
      `浮点容差解析失败：frontend=${feTolNames.length} 档 backend=${Object.keys(beTolerance).length} 档` +
        '（容差常量文件被清空/整体改名？）'
    )
  } else {
    for (const name of feTolNames) {
      if (!(name in beTolerance)) {
        problems.push(
          `浮点容差档位在后端同族文件不存在：${name}` +
            '（backend/src/common/numeric-tolerance.ts 为三档全集权威，前端不得自立档名）'
        )
      } else if (feTolerance[name] !== beTolerance[name]) {
        problems.push(
          `浮点容差跨端漂移：${name} frontend=${feTolerance[name]} backend=${beTolerance[name]}` +
            '（同族两份须同值，改一侧另一侧不会报错，必须同步）'
        )
      }
    }
  }
  // 端口对账（PC-3/W53）：`.env.example` 为声明权威；运行时兜底/compose/vite/生产脚本
  // 各持副本。副本缺失 = 解析失败红（不许静默当通过）；漂移逐一指认站点。
  const authPort = parseEnvPort(files.backendEnvExample ?? '', 'PORT')
  if (authPort === null) {
    problems.push('端口权威解析失败：backend/.env.example 缺 PORT= 行（声明权威被删/改名？）')
  } else {
    for (const site of PORT_SITES) {
      const m = (files[site.key] ?? '').match(site.re)
      const v = m ? Number(m[1]) : null
      if (v === null) {
        problems.push(`端口副本解析失败：${site.label}（3000 族副本被改名/删除？）`)
      } else if (v !== authPort) {
        problems.push(`端口漂移：${site.label}=${v}，backend/.env.example PORT=${authPort}（权威）`)
      }
    }
    const vitePorts = parseViteProxyPorts(files.viteConfig ?? '')
    if (vitePorts.length === 0) {
      problems.push(
        '端口副本解析失败：frontend/vite.config.js 无 127.0.0.1 代理目标（判据输入为空）'
      )
    }
    for (const p of new Set(vitePorts)) {
      if (p !== authPort) {
        problems.push(
          `端口漂移：frontend/vite.config.js 代理目标 :${p}，backend/.env.example PORT=${authPort}（权威）`
        )
      }
    }
  }
  const authPgPort = parseEnvPort(files.backendEnvExample ?? '', 'PG_PORT')
  if (authPgPort === null) {
    problems.push('端口权威解析失败：backend/.env.example 缺 PG_PORT= 行（声明权威被删/改名？）')
  } else {
    for (const site of PG_PORT_SITES) {
      const m = (files[site.key] ?? '').match(site.re)
      const v = m ? Number(m[1]) : null
      if (v === null) {
        problems.push(`端口副本解析失败：${site.label}（5432 族副本被改名/删除？）`)
      } else if (v !== authPgPort) {
        problems.push(
          `端口漂移：${site.label}=${v}，backend/.env.example PG_PORT=${authPgPort}（权威）`
        )
      }
    }
    const v3Maps = parsePortMaps(files.composeV3 ?? '')
    if (v3Maps.length === 0) {
      problems.push('端口副本解析失败：docker-compose.v3.yml 无端口暴露映射（判据输入为空）')
    }
    for (const [host, container] of v3Maps) {
      if (host !== authPgPort || container !== authPgPort) {
        problems.push(
          `端口漂移：docker-compose.v3.yml postgres 暴露 ${host}:${container}，` +
            `backend/.env.example PG_PORT=${authPgPort}（权威，host 侧漂移会让本机直连落空）`
        )
      }
    }
  }
  // 路径别名对账（PC-4/W43）：tsconfig 为参照，vite/vitest 必须同键同目标；
  // 任一处解析失败（被删/改名）即红，不许静默当通过。
  const tsAlias = parseTsconfigAlias(files.frontendTsconfigApp ?? '')
  if (!tsAlias) {
    problems.push('路径别名解析失败：frontend/tsconfig.app.json 无 paths 别名（被删/改名？）')
  } else {
    const aliasSites = [
      ['frontend/vite.config.js', parseAliasTarget(files.viteConfig ?? '', tsAlias.key)],
      [
        'frontend/vitest.config.js',
        parseAliasTarget(files.frontendVitestConfig ?? '', tsAlias.key),
      ],
    ]
    for (const [file, target] of aliasSites) {
      if (target === null) {
        problems.push(`路径别名解析失败：${file} 缺 '${tsAlias.key}' 的定义（被改名/删除？）`)
      } else if (target !== tsAlias.target) {
        problems.push(
          `路径别名漂移：${file} 的 '${tsAlias.key}'→'${target}' 与 tsconfig 的 ` +
            `'${tsAlias.key}'→'${tsAlias.target}' 不一致（三套解析器须同键同目标）`
        )
      }
    }
  }
  // 存储键唯一来源（PC-5/W63）：五个键此前以裸字面量散在消费文件里；立
  // `frontend/src/shared/constants/storageKeys.ts` 为权威后，第二份手抄即红。
  // 键清单从权威源**解析派生**（根因 C：判据不许写死字符串）；判据输入缺失必须报红
  // 而不是当无违例（W58 同族）。
  const storageKeyDefs = parseStorageKeys(files.storageKeys ?? '')
  if (Object.keys(storageKeyDefs).length === 0) {
    problems.push(
      '存储键权威解析失败：frontend/src/shared/constants/storageKeys.ts 无键定义（被删/改名？）'
    )
  } else {
    const strays = files.strayStorageKeys
    if (!Array.isArray(strays)) {
      problems.push('存储键唯一来源判据输入缺失：strayStorageKeys 未提供（判据失效，不是无违例）')
    } else {
      for (const s of strays) {
        problems.push(
          `存储键第二份手抄：${s.file}:${s.line} '${s.key}'` +
            '（唯一取处是 frontend/src/shared/constants/storageKeys.ts，import STORAGE_KEYS 而不是复制它的值）'
        )
      }
    }
  }
  return problems
}

/**
 * 仓库文件遍历（两个「唯一来源」扫描器共用）。
 * 跳过集统一在 lib/walk：本守卫此前独有 `algorithm-service`（退役目录的遗留产物），
 * 已并入默认集 —— 于是「为什么这个守卫少扫这类目录」在默认集里只有一处出处。
 */
function walkRepoFiles(rootDir, extensions, visit) {
  const extRe = new RegExp(`\\.(${extensions})$`)
  for (const f of walkFiles(rootDir, {
    match: (name) => extRe.test(name),
    relBase: rootDir,
    output: 'sources',
  })) {
    visit(f.path, f.text)
  }
}

/**
 * 扫全仓「自定义 GULF_BOUNDS」的位置（唯一来源判据的输入集合）。
 * 排除：tools/lib/gulf-bounds.mjs 本体（唯一合法定义）、测试夹具（构造红样用）。
 * 返回 { file, line }[]，file 为仓库相对路径（/ 分隔），便于判据文案指路。
 */
export function scanLocalGulfBoundsDefs(rootDir) {
  const out = []
  walkRepoFiles(rootDir, 'mjs|js|cjs|ts|py', (rel, text) => {
    if (rel === 'tools/lib/gulf-bounds.mjs') return
    if (rel.includes('__tests__') || rel.endsWith('.test.mjs') || rel.endsWith('.test.js')) return
    if (rel === 'backend/src/common/constants/gis.constants.ts') return
    if (rel === 'frontend/src/shared/utils/crs.ts') return
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = /(?:const|let|var)\s+GULF_BOUNDS\s*=\s*(.*)$/.exec(lines[i])
      if (!m) continue
      // 只咬「自己写死数值」的形态。以下两种是合法的权威派生，必须放行：
      //   ① import { GULF_BOUNDS } from '…/gulf-bounds.mjs'（tools 侧唯一取处）
      //   ② = parseGulfBounds(readFileSync(…)) 这类从后端权威源**解析**（tools/gis-import/verify.mjs
      //      即此形态，解析失败会 throw，比 import 更严）
      // 判据咬的是「复制了值」，不是「提到了这个名字」——后者判红会逼人改成更难读的形态。
      const rhs = m[1].trim()
      const isLiteral = /^\{/.test(rhs) || /^-?\d/.test(rhs) || /^['"]/.test(rhs)
      if (isLiteral) out.push({ file: rel, line: i + 1 })
    }
  })
  return out
}

/** 从权威源 `storageKeys.ts` 解析键清单：`authUser: 'beibu-gulf-user'` → { authUser: '…' }。
 *  守卫不手抄键值——键清单从这里派生（根因 C：判据不许写死字符串）。 */
export function parseStorageKeys(content) {
  const out = {}
  for (const m of content.matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*'([^']+)'/gm)) {
    out[m[1]] = m[2]
  }
  return out
}

/**
 * 扫 frontend/src 内「存储键第二份手抄」（PC-5/W63 唯一来源判据的输入集合）。
 * 键值以**引号锚定**匹配——注释里不带引号地提到键名不误伤（useTheme 的说明注释即此形态）。
 * 排除：权威源本体、测试夹具（构造红样用）。返回 { file, line, key }[]。
 */
export function scanStrayStorageKeys(frontendSrcDir, authorityRel, keys) {
  const out = []
  if (!Array.isArray(keys) || keys.length === 0) return out
  walkRepoFiles(frontendSrcDir, 'ts|vue|js|mjs', (rel, text) => {
    if (`frontend/src/${rel}` === authorityRel) return
    if (
      rel.includes('__tests__') ||
      /\.test\.(ts|js|mjs)$/.test(rel) ||
      /\.spec\.(ts|js)$/.test(rel)
    )
      return
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (const key of keys) {
        if (
          new RegExp(`['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(lines[i])
        ) {
          out.push({ file: `frontend/src/${rel}`, line: i + 1, key })
        }
      }
    }
  })
  return out
}

function main() {
  const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
  const problems = auditSharedConstants({
    backendFlood: read(BACKEND_FLOOD_CONSTANTS),
    frontendFlood: read(FRONTEND_FLOOD_CONSTANTS),
    backendBiz: read(BACKEND_BUSINESS_ERROR),
    frontendBiz: read(FRONTEND_BIZ_CODES),
    backendGis: read(BACKEND_GIS_CONSTANTS),
    frontendCrs: read(FRONTEND_CRS),
    backendRoute: read(BACKEND_ROUTE_MODES),
    frontendRoute: read(FRONTEND_ROUTE_TYPES),
    floodPy: read(FLOOD_PY_REALIFY),
    toolsGulfBounds: read(TOOLS_GULF_BOUNDS),
    localBoundDefs: scanLocalGulfBoundsDefs(ROOT),
    frontendApiRequest: read(FRONTEND_API_REQUEST),
    backendErrorFilter: read(BACKEND_ERROR_FILTER),
    frontendTaskApi: read(FRONTEND_TASK_API),
    backendRequestOwner: read(BACKEND_REQUEST_OWNER),
    frontendTolerance: read(FRONTEND_TOLERANCE),
    backendTolerance: read(BACKEND_TOLERANCE),
    backendEnvExample: read(PORT_AUTHORITY_FILE),
    backendConfigService: read(BACKEND_CONFIG_SERVICE),
    backendDbConfig: read(BACKEND_DB_CONFIG),
    composeMain: read(COMPOSE_MAIN),
    composeV3: read(COMPOSE_V3),
    viteConfig: read(FRONTEND_VITE_CONFIG),
    serverSetup: read(SERVER_SETUP_SH),
    frontendTsconfigApp: read(FRONTEND_TSCONFIG_APP),
    frontendVitestConfig: read(FRONTEND_VITEST_CONFIG),
    storageKeys: read(FRONTEND_STORAGE_KEYS),
    strayStorageKeys: scanStrayStorageKeys(
      path.join(ROOT, 'frontend/src'),
      FRONTEND_STORAGE_KEYS,
      Object.values(parseStorageKeys(read(FRONTEND_STORAGE_KEYS)))
    ),
  })
  if (problems.length === 0) {
    console.log(
      '[constants-audit] OK：水位上限/业务边界框（含 tools 侧）/寻路 mode 双侧一致、' +
        'flood 分段 TS↔PY 一致、跨端请求头名逐字相等、浮点容差前端子集同值、' +
        '端口 3000/5432 全部副本对等、路径别名三侧同键同目标、存储键单源无手抄，' +
        '前端业务码 ⊆ 后端 ErrorCode'
    )
    return
  }
  console.error(`[constants-audit] FAIL：跨进程共享常量漂移 ${problems.length} 处`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (err) {
    console.error(`[constants-audit] FAIL：${err.message}`)
    process.exit(1)
  }
}
