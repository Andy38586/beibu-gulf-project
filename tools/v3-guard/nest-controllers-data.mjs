#!/usr/bin/env node
/**
 * nest-controllers-data.mjs — controller 不直读数据文件守卫（z055 承接体）。
 *
 * 原 cruise 规则 `nest-controllers-not-read-data-files` 守的是静态 import 边
 * （to: ^backend/data/）——controller 从不 import 数据文件，真实违例面是
 * **运行时会话**：注入 DataFilesService、readFileSync('backend/data/...')。
 * 静态 import 分析够不着运行时路径 ⇒ 该规则名实不副、恒 0 条边、永不红（04-F1）。
 * 本守卫把判据搬到真正的违例面上（grep 级），可红、有阳性对照。
 *
 * 判据：modules 下各域 controllers 目录的 .ts 内出现以下任一形态即失败——
 *   ① `backend/data` 路径字面量；② DataFilesService / dataFiles 引用；
 *   ③ node:fs / fs 导入或 readFileSync 调用。
 * 数据访问一律经 service → repository（db.config 禁默认口令同款分层铁律）。
 *
 * 第二条判据（d025 收口，2026-10-06）：**@Body 参数校验收口**——
 *   controller 的 `@Body()` 必须经 `DtoPipe(<DTO>.parse)`（auth/favorites/plans/forecast/task 同口径），
 *   或在 `BODY_VALIDATION_EXEMPTIONS` 逐条登记（豁免必须写明校验落点）。
 *   为什么：d025 的老形态就是 controller 里 `typeof` + 手写枚举校验，与 DTO 的校验两处维护 ⇒
 *   `HTTP_TASK_DOMAINS` 与 `TaskDomain` 漂移过一次（forecast-map 恒 400）。裸 body 只在
 *   "校验单点在 service 且能指出行号"时才算合法豁免；新写一处裸 body = 新长一处第二校验口。
 *
 * 用法：node tools/v3-guard/nest-controllers-data.mjs   # 有违例 exit 1
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const FORBIDDEN = [
  { re: /backend\/data/, why: 'backend/data 路径字面量（数据访问须经 service → repository）' },
  { re: /\bDataFilesService\b/, why: '注入 DataFilesService（controller 不得直读数据文件）' },
  { re: /\bdataFiles\b/, why: 'dataFiles 引用（DataFilesService 实例）' },
  { re: /from 'node:fs'|from "node:fs"|require\('node:fs'\)/, why: 'controller 导入 node:fs' },
  { re: /\breadFileSync\b|\bfs\.read\b/, why: '文件读取 API（数据文件读取收口在 infra/files）' },
]

/**
 * @Body 校验豁免清单（d025）：每条必须给「为什么可以不经 DtoPipe」+「校验落点」。
 * 不在本表的裸 `@Body(` ⇒ 红。新增豁免属改判据域（AGENTS §四-10），须用户批准。
 */
export const BODY_VALIDATION_EXEMPTIONS = [
  {
    file: 'backend/src/modules/flood/controllers/flood.controller.ts',
    why: 'body 只有一个可选 waterLevel，校验单点在 service 的 validateWaterLevel（域解析函数，与会话口径同源），加 DtoPipe 会造第二份水位解析',
    anchor: 'backend/src/modules/flood/services/flood.service.ts:118 validateWaterLevel',
  },
]

/** 列出全部 controller 文件（modules 各域 controllers 目录） */
export function listControllers(root = ROOT) {
  const modulesDir = path.join(root, 'backend/src/modules')
  const files = []
  for (const mod of readdirSync(modulesDir)) {
    const ctrlDir = path.join(modulesDir, mod, 'controllers')
    try {
      for (const f of readdirSync(ctrlDir)) {
        if (f.endsWith('.controller.ts')) files.push(path.join(ctrlDir, f))
      }
    } catch {
      // 该模块无 controllers 目录（如 infra）——跳过
    }
  }
  return files.sort()
}

/**
 * 审计 controller 数据访问面。
 * @returns {{ violations: Array<{file: string, line: number, text: string, why: string}> }}
 */
export function auditControllers(files) {
  const violations = []
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(text)) {
          violations.push({
            file: rel,
            line: i + 1,
            text: text.trim().slice(0, 100),
            why,
          })
        }
      }
      // @Body 校验收口（d025）：裸 @Body( 且未登记豁免 ⇒ 违例
      if (/@Body\(/.test(text) && !/@Body\(new DtoPipe\(/.test(text)) {
        if (!BODY_VALIDATION_EXEMPTIONS.some((e) => e.file === rel)) {
          violations.push({
            file: rel,
            line: i + 1,
            text: text.trim().slice(0, 100),
            why: '@Body 未经 DtoPipe(<DTO>.parse) 收口，且不在 BODY_VALIDATION_EXEMPTIONS（d025）',
          })
        }
      }
    })
  }
  return { violations }
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const files = listControllers()
  const { violations } = auditControllers(files)
  console.log(`[nest-controllers-data] 扫描 ${files.length} 个 controller`)
  if (violations.length) {
    for (const v of violations) {
      console.error(`✗ ${v.file}:${v.line} ${v.why}\n    ${v.text}`)
    }
    console.error(`\n[nest-controllers-data] ${violations.length} 处违例`)
    process.exit(1)
  }
  console.log('[nest-controllers-data] controller 无直读数据文件 ✓')
}
