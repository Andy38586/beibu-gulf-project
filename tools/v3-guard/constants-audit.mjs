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
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

  const backendMax = parseNumericConst(files.backendFlood, 'MAX_WATER_LEVEL')
  const frontendMax = parseNumericConst(files.frontendFlood, 'MAX_WATER_LEVEL')
  if (backendMax === null || frontendMax === null) {
    problems.push(
      `水位上限常量解析失败：backend=${backendMax} frontend=${frontendMax}（常量被改名/删除？）`
    )
  } else if (backendMax !== frontendMax) {
    problems.push(
      `MAX_WATER_LEVEL 前后端漂移：backend=${backendMax} frontend=${frontendMax}` +
        '（251 档 0-25m 口径以 backend 为权威，前端须同步）'
    )
  }

  const backendBands = parseRiskBands(files.backendFlood, 'RISK_LEVEL_BANDS')
  const frontendBands = parseRiskBands(files.frontendFlood, 'RISK_LEVEL_THRESHOLDS')
  if (!backendBands || !frontendBands || backendBands.length === 0 || frontendBands.length === 0) {
    problems.push(
      `风险分档解析失败：backend=${backendBands?.length ?? 'null'} 档 ` +
        `frontend=${frontendBands?.length ?? 'null'} 档（常量被改名/删除？）`
    )
  } else if (backendBands.length !== frontendBands.length) {
    // 档位数不同是历史高发形态：前端曾少末档 ⇒ (最高档阈值, ∞] 段整段回落成上一档，
    // 把最高一档低报一级，而类型系统与两侧各自单测都发现不了。
    problems.push(
      `风险分档档位数漂移：backend=${backendBands.length} 档 frontend=${frontendBands.length} 档`
    )
  } else {
    backendBands.forEach((b, i) => {
      const f = frontendBands[i]
      if (b.maxLevel !== f.maxLevel || b.label !== f.label) {
        problems.push(
          `风险分档第 ${i + 1} 档漂移：backend=${b.maxLevel}/${b.label} ` +
            `frontend=${f.maxLevel}/${f.label}`
        )
      }
    })
  }

  const backendCodes = parseBackendBizCodes(files.backendBiz)
  const frontendCodes = parseFrontendBizCodes(files.frontendBiz)
  if (backendCodes.length === 0 || frontendCodes.length === 0) {
    problems.push(
      `业务码解析失败：backend=${backendCodes.length} 条 frontend=${frontendCodes.length} 条`
    )
  } else {
    for (const code of frontendCodes) {
      if (!backendCodes.includes(code)) {
        problems.push(
          `前端消费的业务码 ${code} 在后端 ErrorCode 中不存在（曾手抄 401002 同款漂移）`
        )
      }
    }
  }

  // 业务边界框（d036）：后端 GULF_BOUNDS 为权威，前端 BEIBU_GULF_BBOX 逐字段对账
  const backendBbox = parseBounds(files.backendGis ?? '', 'GULF_BOUNDS')
  const frontendBbox = parseBounds(files.frontendCrs ?? '', 'BEIBU_GULF_BBOX')
  if (!backendBbox || !frontendBbox) {
    problems.push(
      `业务边界框解析失败：backend=${JSON.stringify(backendBbox)} ` +
        `frontend=${JSON.stringify(frontendBbox)}（常量被改名/删除？）`
    )
  } else {
    for (const key of ['minLng', 'maxLng', 'minLat', 'maxLat']) {
      if (backendBbox[key] !== frontendBbox[key]) {
        problems.push(
          `业务边界框 ${key} 前后端漂移：backend=${backendBbox[key]} frontend=${frontendBbox[key]}` +
            '（后端 GULF_BOUNDS 为权威，前端 BEIBU_GULF_BBOX 须同步）'
        )
      }
    }
  }
  // tools 侧业务边界单一来源（D29）：`tools/lib/gulf-bounds.mjs` 是工具脚本的唯一取处，
  // 须与后端 GULF_BOUNDS 逐字段一致（此前 derive-activity / restore-poi-xiaoqu 各自手抄）。
  const toolsBbox = parseBounds(files.toolsGulfBounds ?? '', 'GULF_BOUNDS')
  if (!toolsBbox) {
    problems.push('业务边界框 tools 侧来源解析失败：tools/lib/gulf-bounds.mjs（常量被改名/删除？）')
  } else if (backendBbox) {
    for (const key of ['minLng', 'maxLng', 'minLat', 'maxLat']) {
      if (backendBbox[key] !== toolsBbox[key]) {
        problems.push(
          `业务边界框 ${key} tools 侧漂移：tools/lib/gulf-bounds.mjs=${toolsBbox[key]} ` +
            `backend(权威)=${backendBbox[key]}`
        )
      }
    }
  }
  // 寻路权重口径（D4②）：后端 MODE_WEIGHT 键为权威，前端 mode 字面量联合须逐处一致。
  // 此前前端 'distance'|'time' 手抄两处、后端第三处，三处无守卫——
  // 后端加一个 mode 前端不会报错（只是不提供该选项），前端加一个后端只会 400。
  const backendModes = parseBackendModeKeys(files.backendRoute ?? '')
  const frontendModes = parseFrontendModeLiterals(files.frontendRoute ?? '')
  if (!backendModes || backendModes.length === 0 || frontendModes.length === 0) {
    problems.push(
      `寻路口径解析失败：backend=${backendModes === null ? 'null' : backendModes.length} 个键 ` +
        `frontend=${frontendModes.length} 处（常量被改名/删除？）`
    )
  } else {
    const backendSet = new Set(backendModes)
    frontendModes.forEach((literals, i) => {
      const front = new Set(literals)
      const missing = [...backendSet].filter((m) => !front.has(m))
      const extra = [...front].filter((m) => !backendSet.has(m))
      if (missing.length || extra.length) {
        problems.push(
          `寻路 mode 第 ${i + 1} 处与后端 MODE_WEIGHT 漂移：缺 [${missing.join(',')}] ` +
            `多 [${extra.join(',')}]（backend route.repository 的 MODE_WEIGHT 键为权威）`
        )
      }
    })
  }
  // flood 风险分段跨语言（D29/A1）：TS RISK_LEVEL_BANDS 为权威，Python flood_realify.py 的
  // RISK_BANDS（逐档 maxLevel/label）与 RISK_CODE（标签→码，须等于档序）是手抄副本。
  const pyBands = parsePyRiskBands(files.floodPy ?? '')
  const pyCode = parsePyRiskCode(files.floodPy ?? '')
  if (!backendBands || !pyBands || pyBands.length === 0 || !pyCode) {
    problems.push(
      `flood 风险分段 Python 副本解析失败：bands=${pyBands?.length ?? 'null'} 档 ` +
        `code=${pyCode ? Object.keys(pyCode).length : 'null'} 条（常量被改名/删除？）`
    )
  } else if (backendBands.length !== pyBands.length) {
    problems.push(
      `flood 风险分段跨语言档位数漂移：TS=${backendBands.length} 档 PY=${pyBands.length} 档`
    )
  } else {
    backendBands.forEach((b, i) => {
      const p = pyBands[i]
      if (b.maxLevel !== p.maxLevel || b.label !== p.label) {
        problems.push(
          `flood 风险分段第 ${i + 1} 档 TS↔PY 漂移：TS=${b.maxLevel}/${b.label} ` +
            `PY=${p.maxLevel}/${p.label}（backend flood.constants 为权威）`
        )
      }
      if (pyCode[b.label] !== i) {
        problems.push(`flood 风险码表 PY 漂移：${b.label} → ${pyCode[b.label]}（应为档序 ${i}）`)
      }
    })
  }
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
  return problems
}

/**
 * 扫全仓「自定义 GULF_BOUNDS」的位置（唯一来源判据的输入集合）。
 * 排除：tools/lib/gulf-bounds.mjs 本体（唯一合法定义）、测试夹具（构造红样用）。
 * 返回 { file, line }[]，file 为仓库相对路径（/ 分隔），便于判据文案指路。
 */
export function scanLocalGulfBoundsDefs(rootDir) {
  const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'coverage',
    '.git',
    '.local',
    '__pycache__',
    '.pytest_cache',
    '.venv',
    'algorithm-service', // 退役：目录已不在版本控制内，保留此名只为跳过其遗留产物
    '.trae',
    '_traetmp',
  ])
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p)
        continue
      }
      if (!/\.(mjs|js|cjs|ts|py)$/.test(e.name)) continue
      const rel = path.relative(rootDir, p).split(path.sep).join('/')
      if (rel === 'tools/lib/gulf-bounds.mjs') continue
      if (rel.includes('__tests__') || rel.endsWith('.test.mjs') || rel.endsWith('.test.js'))
        continue
      if (rel === 'backend/src/common/constants/gis.constants.ts') continue
      if (rel === 'frontend/src/shared/utils/crs.ts') continue
      let text
      try {
        text = readFileSync(p, 'utf8')
      } catch {
        continue
      }
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
    }
  }
  walk(rootDir)
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
  })
  if (problems.length === 0) {
    console.log(
      '[constants-audit] OK：水位上限/业务边界框（含 tools 侧）/寻路 mode 双侧一致、' +
        'flood 分段 TS↔PY 一致、跨端请求头名逐字相等、浮点容差前端子集同值，前端业务码 ⊆ 后端 ErrorCode'
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
