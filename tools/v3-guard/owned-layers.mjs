#!/usr/bin/env node
/**
 * owned-layers.mjs — 图层归属结构约束的执行体（三条判据 + 注册点分母）。
 *
 * 为什么：图层的「注册必注销」曾经靠每个页面自己写 onUnmounted + 手写 remove 维持，
 * 921→924 四轮都在同一个点复发（漏一个就跨路由残留）。改用 useOwnedLayers 之后，
 * 注销由作用域销毁统一负责。本守卫钉三件事：
 *
 *   判据 A（unmount-remove）  卸载钩子块内**直接** `.remove(` ⇒ 红
 *   判据 B（unmount-indirect）卸载钩子块内**间接**注销 —— 调用 `clear*Layers` /
 *                             `remove*Layers` / `releaseAll` ⇒ 红。
 *                             为什么补这条：只认 `.remove(` 字面量时，把注销包进一个
 *                             封装函数、再在卸载时调它，是**等价违约**却能过。
 *                             2026-09-25 实测就有一处这么漏过去（面板 onUnmounted 里
 *                             调 clearRouteLayers，守卫报绿）—— 只认一种记法的判据，
 *                             等于在诱导用另一种记法满足它（AGENTS §5.3 变异四式第 4 格）。
 *   判据 C（bare-register）  `business/**` 下的图层注册必须经 useOwnedLayers ⇒ 裸
 *                             `manager.register(...)` 判红。这条把「注册点分母」变成
 *                             机器可算：分母 = 全部图层注册点，已接 = 经 owner 册的那些。
 *
 * 口径（刻意收窄，避免误伤）：
 *   · 只扫 `frontend/src/business/**`（`core/` 是约束的实现体，不在管辖内）；
 *   · 扫 `.vue` 与 `.ts`（composable 里也可能有卸载钩子/注册点，只扫 .vue 会留盲区）；
 *   · A/B 只看 `onUnmounted` / `onBeforeUnmount` 的**块内**；
 *   · **主动清**不算违规 —— 例如渲染器切回 2D 时摘掉 3D 独占图层
 *     （`removeCesiumOnlyLayers`），写在自己的函数里、带注释说明，那是「现在就清」，
 *     不是「卸载时清」。判据只认「出现在卸载钩子块内」这个位置。
 *   · 注释行放过（否则文件头那句「页面不需要自己调 manager.remove」会被自己判违规）。
 *
 * 用法：node tools/v3-guard/owned-layers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUSINESS = path.join(ROOT, 'frontend/src/business')

/**
 * 棘轮基线：当前已知、待处理的例外（每清一处就删一项）。新增页面不得进本表。
 * 每条格式 `kind@<相对路径>`。
 *
 * site-selection 三条 = 用户 2026-09-25 裁定豁免（「选址分析不用管」）：该模块待迁出，
 * 给要拆的房子装扶手性价比低。**豁免口由人定、不由修的人定**（AGENTS §四-10）。
 */
export const BASELINE = [
  'bare-register@frontend/src/business/site-selection/composables/useAnalysisLayer.ts',
  'bare-register@frontend/src/business/site-selection/SiteSelectionPage.vue',
  'unmount-indirect@frontend/src/business/site-selection/SiteSelectionPage.vue',
]

const COMMENT = /^\s*(\/\/|\*|\/\*)/
const UNMOUNT_HEAD = /onUnmounted\s*\(|onBeforeUnmount\s*\(/
/** 任何函数调用：捕获被调名 */
const CALL = /\b([A-Za-z_$][\w$]*)\s*\(/g
/** 注册调用：捕获接收者名（第 2 组） */
const REGISTER_CALL = /(^|[^.\w])([A-Za-z_$][\w$]*)\.register\s*\(/
/** useOwnedLayers 的调用（用于派生 owner 变量名） */
const OWNED_FACTORY = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useOwnedLayers\s*\(/g

/** 卸载块里**不是**图层注销的调用 —— 卸载时它们完全正常，不能误伤 */
const NON_LAYER_CALLS = new Set([
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'removeEventListener',
  'addEventListener',
  'setTimeout',
  'setInterval',
])

/**
 * 注销动词前缀。**不含 `dispose` / `teardown`** —— 它们更常出现在非图层资源上
 * （实测 `WaterLevelProfilePanel.vue:553` 的 `chartInstance.dispose()` 是 ECharts 实例销毁，
 * 纳入会立刻误伤）。图层清理若用这两个词，通常带 `Layer(s)` 后缀，仍由上面的形态判据覆盖。
 */
const TEARDOWN_VERB = /^(remove|release|clear|detach|purge|unregister)/i

/**
 * 这个调用名算不算「注销图层」。
 *
 * **刻意不写死函数名** —— 写死就是「只认一种记法」：把 `clearRouteLayers()` 改名成
 * `cleanupLayers()` / `detachLayers()`，或用 BLM 自己的 `removeAll()`，都能绕过一条
 * 按固定前缀匹配的判据（AGENTS §5.3 变异四式第 4 格）。2026-09-25 复核实测：
 * `cleanupLayers()` / `detachLayers()` / `businessLayerManager.removeAll()` 三者
 * 在旧判据下**全部 0 命中**。
 *
 * 改按语义形态识别：
 *   · 名字以 `layer` / `layers` 结尾（cleanupLayers / detachLayers / clearXxxLayers / removeLayer）
 *   · 或名字以注销动词开头（remove / release / clear / detach / dispose / teardown / purge / unregister）
 * `stopTilesLayerWatch`（以 Watch 结尾）、`cancelAll`、`stopBreathing`、`reset` 既不
 * 以 layer(s) 结尾也不在动词表里，天然不匹配 —— 无需为它们开豁免口。
 */
export function looksLikeLayerTeardown(name) {
  if (NON_LAYER_CALLS.has(name)) return false
  if (/layers?$/i.test(name)) return true
  return TEARDOWN_VERB.test(name)
}

/**
 * 文件内由 `useOwnedLayers(...)` 派生的 owner 变量名。
 *
 * 用它判「注册是否经归属约束」，而不是靠变量叫不叫 `owned` ——
 * `const panelOwned = useOwnedLayers('x')` 这种重命名在旧判据下**既不判违规、也不计入
 * 已接**，让注册点分母静默失真（2026-09-25 复核实测）。
 */
export function ownedReceivers(source) {
  const names = new Set()
  for (const m of source.matchAll(OWNED_FACTORY)) names.add(m[1])
  return names
}

/** 收集业务源文件（.vue + .ts，排除测试） */
export function collectSources(dir = BUSINESS) {
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
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p)
      } else if (/\.(vue|ts)$/.test(e.name)) {
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

/** 取每个卸载钩子的块（大括号配平），返回 [{ line, text }...] 的行数组 */
export function unmountBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (!UNMOUNT_HEAD.test(lines[i])) continue
    let depth = 0
    let started = false
    const buf = []
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') depth--
      }
      buf.push({ line: j + 1, text: lines[j] })
      if (started && depth <= 0) break
    }
    blocks.push(buf)
  }
  return blocks
}

/**
 * 图层注册点清单（分母）。
 * 分母 = 所有 `.register(` 调用点（**含已接的**，否则算不出「已接/该接」）；
 * `owned` 标记 = 接收者是 `useOwnedLayers(...)` **派生出来的变量**（按数据流，不按变量名）。
 */
export function layerRegisterSites(sources) {
  const sites = []
  for (const { relPath, text } of sources) {
    const owners = ownedReceivers(text)
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = REGISTER_CALL.exec(lines[i])
      if (!m) continue
      sites.push({ relPath, line: i + 1, receiver: m[2], owned: owners.has(m[2]) })
    }
  }
  return sites
}

/** 审计：返回问题列表（空 = 通过） */
export function auditSources(sources, { baseline = BASELINE } = {}) {
  const problems = []
  const mark = (kind, relPath, line, msg) => {
    if (baseline.includes(`${kind}@${relPath}`)) return
    problems.push(`${relPath}:${line} [${kind}] ${msg}`)
  }

  for (const { relPath, text } of sources) {
    // 判据 A / B：卸载钩子块内不得注销图层（直接 `.remove(` 或经封装函数）
    for (const block of unmountBlocks(text)) {
      for (const { line, text: t } of block) {
        if (COMMENT.test(t)) continue
        for (const m of t.matchAll(CALL)) {
          const name = m[1]
          if (!looksLikeLayerTeardown(name)) continue
          const kind = name === 'remove' ? 'unmount-remove' : 'unmount-indirect'
          mark(
            kind,
            relPath,
            line,
            kind === 'unmount-remove'
              ? '在卸载钩子里直接手写图层注销 —— 应经 useOwnedLayers，由作用域销毁统一清'
              : `在卸载钩子里调 ${name}() 注销图层 —— 与手写注销等价，同样应交给作用域销毁`
          )
        }
      }
    }

    // 判据 C：图层注册必须经 owner 册（按 `useOwnedLayers` 派生的变量判定，不按变量名）
    const owners = ownedReceivers(text)
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = REGISTER_CALL.exec(lines[i])
      if (!m) continue
      const receiver = m[2]
      if (owners.has(receiver)) continue
      mark(
        'bare-register',
        relPath,
        i + 1,
        `图层注册未经 useOwnedLayers（${receiver}.register）—— 注册不登记归属，卸载时没人替它清`
      )
    }
  }
  return problems
}

/**
 * 判据 D（owner-scope）—— `useOwnedLayers` 的作用域必须 ≥ 业务生命周期。
 *
 * 为什么单列一条：判据 A/B/C 量的都是「注册有没有过 owner 册」，**一点量不到注销挂在谁的
 * 生命周期上**。owner 建在会被条件渲染卸载的子组件里时（典型：移动端抽屉
 * `MobileDrawer` 的 `v-if="open"`），图层会在页面还活着时被摘掉 —— 登记在册、卸载块里
 * 也没有字面注销，前三条判据全绿，用户却看到「查询在跑、图上没有线」（N-08，2026-09-25
 * 由复核 agents 在现 HEAD 上核对链路后提出）。
 *
 * 查法（轻量调用图）：含 `useOwnedLayers(` 的文件必须是页面（`*Page.vue`），或是**被页面
 * 直接调用**的 composable；只被 `components/` 下的子组件调用 ⇒ 违规。
 * 已知盲区：页面→A→B 的间接调用链会误报（宁可误报，不放过）；跨文件传递 owner 也覆盖不到。
 */
export function ownerScopeViolations(sources) {
  const isPage = (rel) => /\/[A-Za-z][\w]*Page\.vue$/.test(rel)
  const problems = []
  for (const { relPath, text } of sources) {
    if (!/useOwnedLayers\s*\(/.test(text)) continue
    if (isPage(relPath)) continue
    const names = [...text.matchAll(/export function (use[A-Z]\w*)\s*\(/g)].map((m) => m[1])
    if (names.length === 0) {
      problems.push(
        `${relPath} [owner-scope] 非页面文件里创建 owner 册，且没有可追踪的 \`export function useXxx\` —— 无法证明它活在页面作用域`
      )
      continue
    }
    for (const fn of names) {
      const re = new RegExp(`\\b${fn}\\s*\\(`)
      const callers = sources.filter((s) => s.relPath !== relPath && re.test(s.text))
      if (callers.some((c) => isPage(c.relPath))) continue
      problems.push(
        `${relPath}:${fn} [owner-scope] 建 owner 册的 composable 未被**页面**调用` +
          `（调用点：${callers.map((c) => c.relPath).join('、') || '无'}）—— ` +
          '归属会随子组件（如移动端抽屉）卸载而消失，而页面还在'
      )
    }
  }
  return problems
}

function main() {
  const sources = collectSources()
  const sites = layerRegisterSites(sources)
  const ownedCount = sites.filter((s) => s.owned).length
  const problems = [...auditSources(sources), ...ownerScopeViolations(sources)]

  const files = new Set(sites.map((s) => s.relPath))
  const ownedFiles = new Set(sites.filter((s) => s.owned).map((s) => s.relPath))
  console.log(
    `[owned-layers] 注册点分母：${files.size} 个文件 / ${sites.length} 处调用；` +
      `经 useOwnedLayers 已接 ${ownedFiles.size} 个文件 / ${ownedCount} 处`
  )

  if (problems.length === 0) {
    const pages = sources.filter((s) => s.relPath.endsWith('.vue')).length
    console.log(
      `[owned-layers] OK：${pages} 个业务页面 + ${sources.length - pages} 个 .ts 源文件中，` +
        `卸载钩子内 0 处注销（直接/间接）`
    )
    const unowned = sites.filter((s) => !s.owned)
    const unownedFiles = [...new Set(unowned.map((s) => s.relPath))]
    console.log(
      unownedFiles.length === 0
        ? '[owned-layers] 图层注册全部经 useOwnedLayers（无豁免）'
        : `[owned-layers] 基线豁免 ${unownedFiles.length} 个文件 / ${unowned.length} 处裸注册：` +
            unownedFiles.join(', ')
    )
    return
  }
  console.error(`[owned-layers] FAIL：${problems.length} 处`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
