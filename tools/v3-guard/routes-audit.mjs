#!/usr/bin/env node
/**
 * routes-audit.mjs — Nest 对外路由契约守卫。
 *
 * 从 controller 装饰器提取实际路由（含 nest-api 全局前缀），与
 * backend/src/routes.manifest.ts 契约清单双向比对：路由增删未同步清单即失败。
 * 2026-10-12（D1a 收口）：原「前端功能域清单 + 部署侧 VITE_USE_NEST_MODULES」三处一致性审计
 * 已随双前缀收口**整体退役**——收口后前端只有一个前缀，不存在"漏配某个域"这回事，
 * 该组断言的不变量变为空真。判断对象消失 ⇒ 断言随之删除，不是放宽判据域。
 * 本条守卫的主体（controller 装饰器 ↔ routes.manifest 双向比对）不受影响。
 *
 * 用法：
 *  node tools/v3-guard/routes-audit.mjs        # 比对（默认；不一致 exit 1）
 *  node tools/v3-guard/routes-audit.mjs --gen  # 改路由后重新生成契约清单（随改动一起提交）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { walkFiles } from './lib/walk.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NEST_SRC = path.join(ROOT, 'backend/src')
const MANIFEST = path.join(NEST_SRC, 'routes.manifest.ts')
const GLOBAL_PREFIX = 'nest-api'

// 方法装饰器：@Get('sub') / @Post() / @Delete(':id')；路径参数 (:id 等) 原样保留。
// 捕获组 1 = 方法名，组 3 = 括号内原文（用于区分「无参」与「有参但无法解析」）。
// 修复（P1-11，2026-09-15）：原正则只认单引号 → `@Get("x")` / `@Get(\`x\`)` 时整个可选括号组
// 匹配失败但 `@Get` 仍命中，子路径被 `?? ''` 静默置空 ⇒ 生成清单与检查结果「一致地错」= 永久假绿。
const METHOD_DECORATOR_RE = /^\s*@(Get|Post|Put|Delete|Patch|All)\b(\s*\(([\s\S]*?)\))?/
// 控制器前缀同样放宽到三种引号
const CONTROLLER_DECORATOR_RE = /@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/
const MANIFEST_ENTRY_RE = /\{\s*method:\s*'([A-Z]+)'\s*,\s*path:\s*'([^']+)'\s*,?\s*\}/g

function walkControllers(dir) {
  return walkFiles(dir, { match: (name) => name.endsWith('.controller.ts'), output: 'abs' })
}

/**
 * 纯函数：从控制器源码行解析路由清单（供守卫与单测共用，不碰文件系统）。
 * 路径字面量支持 '..' / ".." / `..`；括号内出现非空参数却解析不出路径字面量时**抛错**，
 * 不再静默置空（静默置空会让「--gen 生成」与「检查」一致地错 → 检查模式永久假绿）。
 * @param {string[]} lines
 * @param {string} prefix @Controller 前缀
 * @param {string} rel 文件相对路径（仅用于报错定位）
 */
export function parseRoutesFromLines(lines, prefix = '', rel = '<source>') {
  const routes = []
  for (const line of lines) {
    const m = line.match(METHOD_DECORATOR_RE)
    if (!m) continue
    const rawArg = (m[3] ?? '').trim()
    let sub = ''
    if (rawArg !== '') {
      const q = rawArg.match(/^['"`]([^'"`]*)['"`]$/)
      if (!q) {
        throw new Error(
          `${rel}: 「${line.trim()}」装饰器参数无法解析为路径字面量（支持 '..' / ".." / \`..\`）` +
            '——禁止静默置空路径'
        )
      }
      sub = q[1]
    }
    const segments = [GLOBAL_PREFIX, prefix, sub].filter((s) => s !== '')
    routes.push({ method: m[1].toUpperCase(), path: segments.join('/') })
  }
  return routes
}

// 单文件提取：@Controller 前缀 × 方法装饰器 → [{ method, path }]
function extractRoutes(file) {
  const rel = path.relative(NEST_SRC, file).replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split('\n')
  const prefix = lines.map((l) => l.match(CONTROLLER_DECORATOR_RE)).find(Boolean)?.[1] ?? ''
  const routes = parseRoutesFromLines(lines, prefix, rel)
  if (routes.length === 0) {
    throw new Error(`未从 ${rel} 提取到任何路由（装饰器解析失效？）`)
  }
  return { rel, routes }
}

function parseManifest() {
  const content = readFileSync(MANIFEST, 'utf8')
  const entries = [...content.matchAll(MANIFEST_ENTRY_RE)].map((m) => ({
    method: m[1],
    path: m[2],
  }))
  if (entries.length === 0) {
    throw new Error('routes.manifest.ts 解析为空（格式被手改？）——重跑 --gen 重建')
  }
  return entries
}

function routeKey(r) {
  return `${r.method} ${r.path}`
}

/**
 * 契约双向差集：清单有而代码无（missing）/ 代码有而清单无（extra）。
 *
 * 单独导出**是为了让红样直接打在本守卫的核心判据上**：D1a 退役了此前承载
 * `@guard-red-sample` 的前端清单断言后，本条成为唯一判据，必须自带可红证明
 * （`guard-red-sample` 元守卫当场红过一次：删掉承载红样的函数 ⇒ 「未交付红样」）。
 * 只把红样留在解析函数上是不够的——解析正确 ≠ 差集判得对。
 */
export function diffRoutes(declared, actual) {
  const actualKeys = new Set(actual.map(routeKey))
  const declaredKeys = new Set(declared.map(routeKey))
  return {
    missing: declared.filter((r) => !actualKeys.has(routeKey(r))),
    extra: actual.filter((r) => !declaredKeys.has(routeKey(r))),
  }
}

function generateManifest(routes) {
  const sorted = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
  )
  const body = sorted.map((r) => `  { method: '${r.method}', path: '${r.path}' },`).join('\n')
  writeFileSync(
    MANIFEST,
    `// 对外路由契约清单：Nest 全部业务路由（含 ${GLOBAL_PREFIX} 全局前缀）的单一事实源。\n` +
      `// 由 tools/v3-guard/routes-audit.mjs --gen 从 controller 装饰器提取生成，勿手改；\n` +
      `// 路由增删必须重跑 --gen 并随本次改动一起提交，否则 guard:v3 红灯拦截（防契约漂移）。\n` +
      `export const ROUTES_MANIFEST = [\n${body}\n] as const\n`,
    'utf8'
  )
  return sorted.length
}

function main() {
  const controllers = walkControllers(NEST_SRC)
  if (controllers.length === 0) throw new Error('未找到任何 controller 文件')

  const actual = []
  for (const file of controllers) {
    for (const r of extractRoutes(file).routes) actual.push(r)
  }

  if (process.argv.includes('--gen')) {
    const count = generateManifest(actual)
    console.log(
      `[routes-audit] 契约清单已重生成：${count} 条路由 → ${path.relative(ROOT, MANIFEST)}`
    )
    return
  }

  const declared = parseManifest()
  const { missing, extra } = diffRoutes(declared, actual)

  if (missing.length === 0 && extra.length === 0) {
    console.log(
      `[routes-audit] OK：${actual.length} 条实际路由与契约清单一致（${controllers.length} 个 controller）。` +
        '前端域清单/部署侧副本审计已随 D1a 收口退役（判据对象消失，见文件头）'
    )
    return
  }

  console.error(
    `[routes-audit] FAIL：路由契约或前端清单不一致（清单 ${declared.length} / 实际 ${actual.length}）`
  )
  for (const r of missing) console.error(`  清单有但代码无：${routeKey(r)}`)
  for (const r of extra) console.error(`  代码有但清单无：${routeKey(r)}`)
  console.error(
    '  修复：路由增删后运行 node tools/v3-guard/routes-audit.mjs --gen 并提交新清单；前端 ENDPOINTS 增删后运行 npm run contract:check 对账 Swagger'
  )
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (err) {
    console.error(`[routes-audit] FAIL：${err.message}`)
    process.exit(1)
  }
}
