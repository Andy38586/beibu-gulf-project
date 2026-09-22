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
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(text)) {
          violations.push({
            file: path.relative(ROOT, file).replace(/\\/g, '/'),
            line: i + 1,
            text: text.trim().slice(0, 100),
            why,
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
