#!/usr/bin/env node
/**
 * routes-audit.mjs — Nest 对外路由契约守卫。
 *
 * 从 controller 装饰器提取实际路由（含 nest-api 全局前缀），与
 * backend/src/routes.manifest.ts 契约清单双向比对：路由增删未同步清单即失败。
 * 同时审计前端路由契约消费副本：useApiRequest 功能域清单与部署侧
 * VITE_USE_NEST_MODULES 必须与 manifest 域集一致（历史教训：route 域漏配致
 * dev 航线查询 404，靠 nginx 旧前缀 rewrite 侥幸在役）。
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

// 前端路由契约联动：功能域单一事实源是 routes.manifest，前端 useApiRequest 的
// MODULE_BY_PATH_PREFIX 与部署侧 VITE_USE_NEST_MODULES 都是它的消费副本。历史教训：
// route 域下沉 Nest 时漏改前端清单，dev 航线查询 404、生产靠 nginx 旧前缀 rewrite
// 侥幸在役——路由漂移的下游副本必须纳入本守卫，不能靠联调发现。
const FRONTEND_API_REQUEST = path.join(ROOT, 'frontend/src/shared/composables/useApiRequest.ts')
// 基础设施探针域：前端无 apiRequest 调用，不要求出现在前端清单
// csp-report = CSP 违规上报接收端点（z153），由浏览器直发、前端代码不调用
const NON_BIZ_DOMAINS = new Set(['health', 'csp-report'])
// env 注入副本（部分域回退 Express 是文档化的回滚开关，故只查未知/过期域名，不强制全覆盖）
const ENV_COPIES = [
  path.join(ROOT, 'docker-compose.yml'),
  path.join(ROOT, '.github/workflows/ci.yml'),
]

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

/** 提取前端 useApiRequest.ts 的 MODULE_BY_PATH_PREFIX 键集（功能域清单消费副本） */
export function extractFrontendDomains(content) {
  const m = content.match(/MODULE_BY_PATH_PREFIX[^{]*\{([^}]*)\}/)
  if (!m) throw new Error('useApiRequest.ts 未找到 MODULE_BY_PATH_PREFIX（清单被改名/删除？）')
  // 键可能带引号（'site-analysis' 这类含连字符域必须引号），两侧均可选
  return [...m[1].matchAll(/'?([a-z][a-z-]*)'?\s*:/g)].map((k) => k[1])
}

/** 提取 env 副本中 VITE_USE_NEST_MODULES 的域清单（兼容 compose 默认值与 CI 明值两种写法） */
export function extractEnvDomainLists(content) {
  const lists = []
  for (const m of content.matchAll(
    /VITE_USE_NEST_MODULES\s*:\s*\$\{VITE_USE_NEST_MODULES:-([^}]*)\}/g
  ))
    lists.push(m[1])
  for (const m of content.matchAll(/VITE_USE_NEST_MODULES=([^\s"'#]+)/g)) lists.push(m[1])
  return lists.map((s) =>
    s
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  )
}

/**
 * 前端契约联动审计：
 * ① 后端业务域（manifest 顶层段，剔除基础设施探针）必须收录进前端功能域清单；
 * ② 前端清单不得出现 manifest 已无路由的过期域名；
 * ③ env 副本不得出现未知/过期域名（不强制全覆盖——部分回退是文档化的回滚开关）。
 */
export function auditFrontendContract(frontendContent, envCopies, manifestDomains) {
  const problems = []
  const frontendDomains = new Set(extractFrontendDomains(frontendContent))
  const bizDomains = manifestDomains.filter((d) => !NON_BIZ_DOMAINS.has(d))
  for (const d of bizDomains) {
    if (!frontendDomains.has(d))
      problems.push(
        `后端业务域 '${d}' 未收录进前端 MODULE_BY_PATH_PREFIX（该域请求将误回退 Express 前缀）`
      )
  }
  for (const stale of frontendDomains) {
    if (!manifestDomains.includes(stale))
      problems.push(`前端功能域 '${stale}' 在 routes.manifest 中已无对应路由（过期域名）`)
  }
  for (const { file, content } of envCopies) {
    for (const list of extractEnvDomainLists(content)) {
      for (const d of list) {
        if (!manifestDomains.includes(d))
          problems.push(
            `${path.relative(ROOT, file)} 的 VITE_USE_NEST_MODULES 含未知/过期域 '${d}'`
          )
      }
    }
  }
  return problems
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

  // manifest 顶层段 = 功能域全集（nest-api/<域>/...，剔除全局前缀与空段）
  const manifestDomains = [...new Set(declared.map((r) => r.path.split('/')[1]).filter(Boolean))]
  const envCopies = ENV_COPIES.map((file) => ({ file, content: readFileSync(file, 'utf8') }))
  const contractProblems = auditFrontendContract(
    readFileSync(FRONTEND_API_REQUEST, 'utf8'),
    envCopies,
    manifestDomains
  )

  if (missing.length === 0 && extra.length === 0 && contractProblems.length === 0) {
    console.log(
      `[routes-audit] OK：${actual.length} 条实际路由与契约清单一致（${controllers.length} 个 controller），前端功能域清单同步（${manifestDomains.length} 域）`
    )
    return
  }

  console.error(
    `[routes-audit] FAIL：路由契约或前端清单不一致（清单 ${declared.length} / 实际 ${actual.length}）`
  )
  for (const r of missing) console.error(`  清单有但代码无：${routeKey(r)}`)
  for (const r of extra) console.error(`  代码有但清单无：${routeKey(r)}`)
  for (const p of contractProblems) console.error(`  ${p}`)
  console.error(
    '  修复：路由增删后运行 node tools/v3-guard/routes-audit.mjs --gen 并提交新清单；前端功能域清单与 env 副本同步更新'
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
