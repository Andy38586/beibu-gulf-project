#!/usr/bin/env node
/**
 * flyto-single-entry.mjs — 飞行单入口守卫：消费侧不得裸用渲染器 / 相机 flyTo。
 *
 * ## 治什么
 *
 * 用户 2026-10-05 定：整个项目的 flyTo 必须整合到**一个入口**（`useMapControls().flyTo`），
 * 不允许各页面自己拿 renderer / Cesium camera 飞行——“不能各自用自己的飞行代码”。
 * 现状反例：RouteControlPanel 曾直接 `mapStore.currentRenderer?.flyTo(...)`；这类写法
 * 绕过 2D/3D 双引擎适配与测试桩，后续换渲染器/加飞行策略（时长、高度、取消）时必然漏改。
 *
 * ## 判据域
 *
 * 扫描 `frontend/src` 的 .ts/.vue，**排除**：
 *   - `frontend/src/core/map/**`（渲染器实现与统一入口本体所在层，飞行实现细节留这里）；
 *   - 测试文件（__tests__ / *.test.* / *.spec.*）；
 *   - 注释行（否则文件头自述会被自己判违规）。
 *
 * 违规模式（消费侧）：
 *   ① 裸渲染器飞行：`renderer?.flyTo(` / `currentRenderer?.flyTo(` / `getRenderer()?.flyTo(`；
 *   ② 直接相机飞行：`xxx.camera.flyTo(`（Cesium 实现细节，只允许出现在 core/map/renderers）。
 *
 * 通过口径：`const { flyTo } = useMapControls()` 后调用 `flyTo(...)`。
 *
 * 用法：node tools/v3-guard/flyto-single-entry.mjs   （违例 exit 1）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC_ROOT = path.join(ROOT, 'frontend/src')

/** 实现层（渲染器 + 统一入口）：飞行实现细节允许且只允许在这里 */
export const ALLOWED_PREFIX = 'frontend/src/core/map/'

/** 注释行（含 .vue 模板注释）：放过 —— 否则本文件头自述会被自己判违规 */
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/

export const FORBIDDEN = [
  {
    name: '裸渲染器 flyTo',
    re: /(?:\brenderer\b|currentRenderer|getRenderer\s*\(\s*\))\s*\??\.\s*flyTo\s*\(/,
  },
  { name: '直接相机 flyTo', re: /\.camera\s*\.\s*flyTo\s*\(/ },
]

/**
 * 审计：返回问题列表（空 = 通过）。纯函数，便于单测。
 * @param {Array<{relPath: string, text: string}>} files
 * @param {{allowedPrefix?: string}} [opts]
 */
export function auditFlyTo(files, { allowedPrefix = ALLOWED_PREFIX } = {}) {
  const problems = []
  for (const { relPath, text } of files) {
    if (relPath.startsWith(allowedPrefix)) continue
    if (/__tests__|\.test\.|\.spec\./.test(relPath)) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (COMMENT.test(line)) continue
      for (const f of FORBIDDEN) {
        const hit = line.match(f.re)
        if (hit) {
          problems.push(
            `${relPath}:${i + 1} ${f.name}（${hit[0].trim()}） —— 统一走 useMapControls().flyTo` +
              '（core/map 单入口；Cesium 相机细节只留在 core/map/renderers）'
          )
        }
      }
    }
  }
  return problems
}

/** 收集扫描源文件（frontend/src 的 .ts/.vue） */
export function collectSources(dir = SRC_ROOT) {
  const out = []
  const walk = (abs) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(abs, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p)
      } else if (/\.(ts|vue)$/.test(e.name)) {
        out.push({
          relPath: path.relative(ROOT, p).replace(/\\/g, '/'),
          text: fs.readFileSync(p, 'utf8'),
        })
      }
    }
  }
  walk(dir)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function main() {
  const files = collectSources()
  const problems = auditFlyTo(files)
  console.log(
    `[flyto-single-entry] 扫描 ${files.length} 个源文件（实现层豁免：${ALLOWED_PREFIX}**）`
  )
  if (problems.length === 0) {
    console.log('[flyto-single-entry] OK：消费侧无裸用渲染器/相机 flyTo')
    return
  }
  console.error(`[flyto-single-entry] FAIL：${problems.length} 处裸飞行`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
