#!/usr/bin/env node
/**
 * routes-audit.mjs — Nest 对外路由契约守卫。
 *
 * 从 controller 装饰器提取实际路由（含 nest-api 全局前缀），与
 * backend/src/routes.manifest.ts 契约清单双向比对：路由增删未同步清单即失败。
 * 目的：前端 adapter、Vite proxy/nginx 反代、契约比对脚本都依赖稳定的路由面，
 * 路由漂移必须在守卫层被拦下，而不是等联调才发现。
 *
 * 用法：
 *  node tools/v3-guard/routes-audit.mjs        # 比对（默认；不一致 exit 1）
 *  node tools/v3-guard/routes-audit.mjs --gen  # 改路由后重新生成契约清单（随改动一起提交）
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NEST_SRC = path.join(ROOT, 'backend/src')
const MANIFEST = path.join(NEST_SRC, 'routes.manifest.ts')
const GLOBAL_PREFIX = 'nest-api'

// 方法装饰器：@Get('sub') / @Post() / @Delete(':id')；路径参数 (:id 等) 原样保留
const METHOD_DECORATOR_RE = /^\s*@(Get|Post|Put|Delete|Patch|All)(?:\(\s*(?:'([^']*)')?\s*\))?/
const CONTROLLER_DECORATOR_RE = /@Controller(?:\(\s*(?:'([^']*)')?\s*\))?/
const MANIFEST_ENTRY_RE = /\{\s*method:\s*'([A-Z]+)'\s*,\s*path:\s*'([^']+)'\s*,?\s*\}/g

function walkControllers(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue
      out.push(...walkControllers(full))
    } else if (entry.name.endsWith('.controller.ts')) {
      out.push(full)
    }
  }
  return out
}

// 单文件提取：@Controller 前缀 × 方法装饰器 → [{ method, path }]
function extractRoutes(file) {
  const rel = path.relative(NEST_SRC, file).replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split('\n')
  const prefix = lines.map((l) => l.match(CONTROLLER_DECORATOR_RE)).find(Boolean)?.[1] ?? ''
  const routes = []
  for (const line of lines) {
    const m = line.match(METHOD_DECORATOR_RE)
    if (!m) continue
    const sub = m[2] ?? ''
    const segments = [GLOBAL_PREFIX, prefix, sub].filter((s) => s !== '')
    routes.push({ method: m[1].toUpperCase(), path: segments.join('/') })
  }
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
  const actualKeys = new Set(actual.map(routeKey))

  if (process.argv.includes('--gen')) {
    const count = generateManifest(actual)
    console.log(
      `[routes-audit] 契约清单已重生成：${count} 条路由 → ${path.relative(ROOT, MANIFEST)}`
    )
    return
  }

  const declared = parseManifest()
  const declaredKeys = new Set(declared.map(routeKey))

  const missing = declared.filter((r) => !actualKeys.has(routeKey(r)))
  const extra = actual.filter((r) => !declaredKeys.has(routeKey(r)))

  if (missing.length === 0 && extra.length === 0) {
    console.log(
      `[routes-audit] OK：${actual.length} 条实际路由与契约清单一致（${controllers.length} 个 controller）`
    )
    return
  }

  console.error(
    `[routes-audit] FAIL：实际路由与契约清单不一致（清单 ${declared.length} / 实际 ${actual.length}）`
  )
  for (const r of missing) console.error(`  清单有但代码无：${routeKey(r)}`)
  for (const r of extra) console.error(`  代码有但清单无：${routeKey(r)}`)
  console.error('  修复：路由增删后运行 node tools/v3-guard/routes-audit.mjs --gen 并提交新清单')
  process.exit(1)
}

try {
  main()
} catch (err) {
  console.error(`[routes-audit] FAIL：${err.message}`)
  process.exit(1)
}
