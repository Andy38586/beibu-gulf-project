#!/usr/bin/env node
/**
 * constants-audit.mjs — 跨进程共享常量一致性守卫。
 *
 * 前后端各自维护的"同一权威值"（水位上限、登录业务码）是双轨排查方案定义的
 * 跨进程副本——类型系统够不着、改一侧不报错。本守卫把双侧值解析出来做一致性
 * 断言，漂移在 guard:v3 拦下而非线上静默失效。
 *
 * 用法：node tools/v3-guard/constants-audit.mjs   # 不一致 exit 1
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const BACKEND_FLOOD_CONSTANTS = 'backend/src/common/constants/flood.constants.ts'
const FRONTEND_FLOOD_CONSTANTS = 'frontend/src/shared/constants/flood.ts'
const BACKEND_BUSINESS_ERROR = 'backend/src/common/errors/business-error.ts'
const FRONTEND_BIZ_CODES = 'frontend/src/shared/constants/bizCodes.ts'

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
  if (/^(Number\.)?POSITIVE_INFINITY$/.test(compact) || compact === 'Infinity') return 'Infinity'
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

/**
 * 一致性审计：水位上限双侧同值；风险分档表逐档同源；前端消费的业务码必须是
 * 后端 ErrorCode 的子集（前端允许只消费子集，不允许出现后端已重编/删除的码）。
 */
export function auditSharedConstants(files) {
  const problems = []
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
  return problems
}

function main() {
  const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
  const problems = auditSharedConstants({
    backendFlood: read(BACKEND_FLOOD_CONSTANTS),
    frontendFlood: read(FRONTEND_FLOOD_CONSTANTS),
    backendBiz: read(BACKEND_BUSINESS_ERROR),
    frontendBiz: read(FRONTEND_BIZ_CODES),
  })
  if (problems.length === 0) {
    console.log('[constants-audit] OK：水位上限双侧一致，前端业务码 ⊆ 后端 ErrorCode')
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
