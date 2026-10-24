/**
 * cesium-import-allowlist —— 「2D eager 图禁止 import cesium」静态判据（§四-10，用户 2026-10-24 裁定落闸）。
 *
 * 治的失效：dev 首屏挂载竞速崩（b5260498）——OLRenderer→cameraPerf 的 eager 链把
 * cesium 拉进 2D 首屏，cesium-global shim 在 window.Cesium 未注入时模块求值即抛。
 * 当时修复只摘了症状（常量迁 perf/cameraTiming），同形再犯只能靠运行时抛错发现
 * （慢一步、且只在 dev 炸）。本判据把「谁可以静态 import cesium」钉死为白名单三文件。
 *
 * 为什么不用 dependency-cruiser：曾尝试在 .dependency-cruiser.cjs 加
 * cesium-static-import-allowlist（from.pathNot + to node_modules/cesium），
 * 变异验证发现 dependency-cruiser 17.4.3 在本仓对**裸包名一概不解析**
 * （'vue'/'pg'/'cesium' 的边全部不存在——含既有 nest-db 规则，同样哑火，
 * 另案在册）。永不红的门禁按 §5.4 不算存在，故改为自研扫描器：
 * 文本级 import 语句匹配，输入受版本控制，不需要模块解析器。
 *
 * 白名单（每条都必须说清为什么它不算 2D eager 面）：
 *   · renderers/CesiumRenderer.ts —— 3D 渲染器本体，唯一合法消费面（经 ensureCesiumLoaded 动态链加载）
 *   · perf/cameraPerf.ts —— 仅被 CesiumRenderer 及其测试消费（随 3D 动态 chunk 加载）
 *   · cesium-global.ts —— shim 自身（type-only import，编译期擦除）
 *
 * 已知边界：import 动态表达式（await import('cesium')）不在本判据拦截面——
 * 动态 import 本就是惰性求值，不构成 eager 风险；传递拉入（经 cameraPerf）
 * 的防线仍是 cesium-global shim 的运行时抛错——两层防线各守一段。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FRONTEND_SRC = path.join(ROOT, 'frontend/src')

/** 白名单：相对 frontend/src 的路径（正整数条，新增须附理由，§四-10 由用户裁定） */
export const CESIUM_IMPORT_ALLOWLIST = new Set([
  'core/map/renderers/CesiumRenderer.ts',
  'core/map/perf/cameraPerf.ts',
  'core/map/cesium-global.ts',
])

/** 静态 import 'cesium' 的形态：import/from/require 三种（type-only 也算——tsPreCompilationDeps 语义） */
const CESIUM_IMPORT_RE =
  /^\s*import\s+(?:type\s+)?[^'"]*?from\s+['"]cesium['"]|^\s*import\s+['"]cesium['"]|^\s*const[^=]*=\s*require\(\s*['"]cesium['"]\s*\)/m

/** 扫描：返回违规列表（空 = 通过）。每条 = 相对路径:行号 */
export function scanCesiumImports(sources) {
  const bad = []
  for (const { relPath, text } of sources) {
    if (CESIUM_IMPORT_ALLOWLIST.has(relPath)) continue
    const lines = text.split('\n')
    let inBlockComment = false
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      // 剥注释再扫：cameraTiming/barrel 的头注释里有「import … from 'cesium'」示例文本，
      // 不剥则判据出生即假红（剥法与 owned-layers 的 COMMENT 判定同思路）
      if (inBlockComment) {
        if (line.includes('*/')) {
          line = line.slice(line.indexOf('*/') + 2)
          inBlockComment = false
        } else continue
      }
      if (line.includes('/*')) {
        const before = line.slice(0, line.indexOf('/*'))
        if (!line.includes('*/')) inBlockComment = true
        line = before + (line.includes('*/') ? line.slice(line.indexOf('*/') + 2) : '')
      }
      line = line.split('//')[0]
      if (
        /from\s+['"]cesium['"]|^\s*import\s+['"]cesium['"]|require\(\s*['"]cesium['"]\s*\)/.test(
          line
        )
      ) {
        bad.push(`${relPath}:${i + 1}`)
        break // 每文件只报第一处，避免同一文件刷屏
      }
    }
  }
  return bad
}

function main() {
  const files = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue
        walk(full)
      } else if (/\.(ts|tsx|vue|js|jsx|mjs)$/.test(name)) {
        const relPath = path.relative(FRONTEND_SRC, full).split(path.sep).join('/')
        files.push({ relPath, text: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  walk(FRONTEND_SRC)

  const bad = scanCesiumImports(files)
  if (bad.length > 0) {
    console.error(`[cesium-import-allowlist] FAIL：${bad.length} 处非白名单静态 import cesium`)
    for (const b of bad) {
      console.error(`  - frontend/src/${b}（2D eager 链禁入 cesium；白名单三文件见判据头注释）`)
    }
    process.exit(1)
  }
  console.log(
    `[cesium-import-allowlist] OK：${files.length} 个源文件无越界 cesium import（白名单 ${CESIUM_IMPORT_ALLOWLIST.size} 文件豁免）`
  )
}

// 被 run-all 以外的直接执行时才跑 main（与 constants-audit 同款 import.meta.url 判定）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
