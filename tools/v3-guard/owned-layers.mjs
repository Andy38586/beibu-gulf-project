#!/usr/bin/env node
/**
 * owned-layers.mjs — 图层归属结构约束的执行体（三条判据 + 注册点分母）。
 *
 * 为什么：图层的「注册必注销」曾经靠每个页面自己写 onUnmounted + 手写 remove 维持，
 * 921→924 四轮都在同一个点复发（漏一个就跨路由残留）。改用 useOwnedLayers 之后，
 * 注销由作用域销毁统一负责。本守卫钉三件事：
 *
 *   判据 A/B（unmount-call） 卸载钩子块内**默认拒绝**任何未登记调用 ⇒ 红
 *                             （白名单见 `UNMOUNT_ALLOWED`，表内每条须写明"为什么它不是图层操作"）。
 *                             演进史：① 只认 `.remove(` 字面量 → 包进封装函数即可过；
 *                             ② 改按命名形态（以 `layer(s)` 结尾 / 注销动词开头）→
 *                             `wipe()` / `purgeEverything()` 仍过，且会误咬 `clearCache`；
 *                             ③ 改成**白名单（默认拒绝）** —— 不问"叫什么"，只问"登记过吗"，
 *                             换名字这一整类逃逸面一次性消掉。
 *   判据 C（bare-register）  `business/**` 下的图层注册必须经 useOwnedLayers ⇒ 裸
 *                             `manager.register(...)` 判红。这条把「注册点分母」变成
 *                             机器可算：分母 = 全部图层注册点，已接 = 经 owner 册的那些。
 *                             **「注册语义」是派生出来的**（`REGISTER_METHODS`，含
 *                             `register` 与 `applyOrUpdate`），不是手抄的单个方法名 ——
 *                             手抄版本漏掉一半注册动作，而 S2 的「结构收敛」量的正是分母。
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
  'unmount-call@frontend/src/business/site-selection/SiteSelectionPage.vue',
]

const COMMENT = /^\s*(\/\/|\*|\/\*)/
const UNMOUNT_HEAD = /onUnmounted\s*\(|onBeforeUnmount\s*\(/
/** 任何函数调用：捕获被调名 */
const CALL = /\b([A-Za-z_$][\w$]*)\s*\(/g
/** useOwnedLayers 的调用（用于派生 owner 变量名） */
const OWNED_FACTORY = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useOwnedLayers\s*\(/g

/** owner 册实现源 —— 「注册语义」这份清单的**唯一权威源** */
const OWNED_LAYERS_SRC = path.join(ROOT, 'frontend/src/core/map/composables/useOwnedLayers.ts')

/**
 * 注册语义方法集：**从实现派生，不手抄名单**。
 *
 * ## 为什么必须派生
 *
 * `register` 与 `applyOrUpdate` 都是「把图层注册上去」的动作，判据 C 的注册点分母
 * 两个都得算。第一版把手抄正则写成 `\.register\(`，于是 `applyOrUpdate`（由
 * `useOwnedLayers` 提供、实现体里就是 `return register(...)`）**整类不计入分母**。
 *
 * 代价不是少两行统计，而是 S2 转向后**「结构收敛」这条判据量的正是分母**：
 * 漏计之后 `FloodAnalysisPage` / `useRouteLayer` 的 4 处注册动作凭空消失，分母
 * 12 → 8 —— 于是「样板收口让分母下降」成了幻象（实测新口径下是 12 → 12，一处没减）。
 * 一个漏计的分母会让后面每一轮的"下降"都不可信。
 *
 * ## 派生规则（两步，都不看方法名）
 *
 * ① 只取 `UseOwnedLayersReturn` 接口声明、且本文件有实现的那些方法（对外能力清单）；
 * ② 实现体**直接触达 `manager.register(`** 的为种子；再传播 —— 体里调用了已判定为
 *    注册侧方法的，同为注册侧（`applyOrUpdate` → `register` 这一跳由此覆盖）。
 *
 * ⇒ 新增一个 upsert 方法只要进接口，分母自动跟上，不必回来改本文件（手抄名单的老病）。
 */
export function deriveRegisterMethods(source) {
  const iface = source.match(/export interface UseOwnedLayersReturn\s*\{([\s\S]*?)\n\}/)
  if (!iface) {
    throw new Error('[owned-layers] 找不到 UseOwnedLayersReturn 接口 —— 注册语义无处派生')
  }
  const declared = [...iface[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[:(]/gm)].map((m) => m[1])

  // 每个 `function <name>(...) { ... }` 的实现体（大括号配平）
  const bodies = new Map()
  for (const m of source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]+)?\{/g)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) {
        if (!bodies.has(m[1])) bodies.set(m[1], source.slice(open + 1, i))
        break
      }
    }
  }

  // 接口里有声明 + 本文件有实现 = 对外能力；`owned` 这类值成员因无实现被自然排除
  const impl = declared.filter((n) => bodies.has(n))
  const reg = new Set(impl.filter((n) => /\bmanager\.register\s*\(/.test(bodies.get(n))))
  for (let changed = reg.size > 0; changed; ) {
    changed = false
    for (const n of impl) {
      if (reg.has(n)) continue
      if ([...reg].some((k) => new RegExp(`\\b${k}\\s*\\(`).test(bodies.get(n)))) {
        reg.add(n)
        changed = true
      }
    }
  }
  return impl.filter((n) => reg.has(n))
}

/** 运行时读一次。派生为空即抛 —— 分母静默归零比判红更危险 */
export const REGISTER_METHODS = (() => {
  const methods = deriveRegisterMethods(fs.readFileSync(OWNED_LAYERS_SRC, 'utf8'))
  if (methods.length === 0) {
    throw new Error(
      '[owned-layers] 注册语义集合派生为空（实现里找不到 manager.register 调用）—— 拒绝继续'
    )
  }
  return methods
})()

/** 注册调用：捕获接收者名（第 2 组）与被调方法名（第 3 组）。方法名来自派生集，不在这里手写 */
export function registerCallRegex(methods = REGISTER_METHODS) {
  return new RegExp(`(^|[^.\\w])([A-Za-z_$][\\w$]*)\\.(${methods.join('|')})\\s*\\(`)
}

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
 * 卸载钩子块内**允许**出现的调用（白名单）。
 *
 * ## 为什么反过来：白名单（默认拒绝）而不是识别注销（默认放行）
 *
 * 识别注销是黑名单 —— 必须**预知**"注销长什么样"。于是 `cleanupLayers()` / `detachLayers()` /
 * `wipe()` / 任何没见过的写法都能逃逸（2026-09-25 复核 agent 实测三条 0 命中）。把判据从
 * 「命名形态」再往「AST 语义」推一档，仍然是在跟**写法**赛跑，只是把赛跑线往后挪一格；
 * 而 JS 是动态的（`manager` 来自 inject，`wipe()` 内部改了什么静态看不出来）。
 *
 * 白名单换个问法：**不看它叫什么，只看它登记过没有**。卸载块内除本表外一律判红 ——
 * `wipe()` 明天出现也照样红，因为"没登记"这件事不需要预知名字。
 *
 * ## 登记纪律
 *
 * 新增条目必须写明**为什么它不是图层操作**（下面的分组注释就是凭据）。这是本判据唯一的
 * 退化路径：**白名单膨胀成筛子** —— 想让红变绿，改这里比改代码容易，所以每条都要有理由。
 *
 * ## 为什么容器方法（`forEach` / `keys`）入表不构成逃逸面
 *
 * 扫描是**逐行**的：`Object.keys(x).forEach(v => manager.remove(v))` 里的 `manager.remove`
 * 会被单独抓出来。入表的只是那个容器方法名本身。
 */
export const UNMOUNT_ALLOWED = new Set([
  // 定时器
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  // 事件监听
  'removeEventListener',
  'addEventListener',
  'off',
  // 在途请求取消
  'abort',
  'abortInflight',
  'cancel',
  'cancelAll',
  'cancelFloodSignal',
  // watch / 动效 / 播放 停止
  'stopImageryWatch',
  'stopRendererWatch',
  'stopTilesLayerWatch',
  'stopBeibuWatch',
  'stopPlayback',
  'stopBreathing',
  'stopFacilityBreathing',
  // 非图层的实例销毁（ECharts 等，实测 WaterLevelProfilePanel 的 chartInstance.dispose）
  'dispose',
  // 非图层的状态复位（store / 业务态 / 缓存）
  'reset',
  'resetFloodAnalysis',
  'resetSubStates',
  'clearState',
  'clearCache',
  // UI 收尾
  'endSliderFocus',
  // 钩子自身与取值辅助（其内部语句仍被逐行扫描）
  'onUnmounted',
  'onBeforeUnmount',
  'getRenderer',
  'forEach',
  'keys',
  'values',
  // 语言关键字（正则按"标识符+左括号"抓取，会把 if / for 也抓进来）
  'if',
  'for',
  'while',
  'switch',
  'catch',
])

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
 * 分母 = 所有**注册语义**调用点（`REGISTER_METHODS`，派生见 `deriveRegisterMethods`）；
 * `owned` 标记 = 接收者是 `useOwnedLayers(...)` **派生出来的变量**（按数据流，不按变量名）。
 *
 * 含已接的那些 —— 否则算不出「已接 / 该接」这个比值。
 */
export function layerRegisterSites(sources, { methods = REGISTER_METHODS } = {}) {
  const re = registerCallRegex(methods)
  const sites = []
  for (const { relPath, text } of sources) {
    const owners = ownedReceivers(text)
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = re.exec(lines[i])
      if (!m) continue
      sites.push({ relPath, line: i + 1, receiver: m[2], owned: owners.has(m[2]) })
    }
  }
  return sites
}

/**
 * 注册点分母的三态读数（单一出处，供首行输出与测试共同消费）。
 *
 * 为什么单独成函数：三态里「裸」此前只出现在第 3 行的豁免清单里，首行只有
 * 「分母 / 已接」两个数 —— 于是"分母下降"到底是**真收敛**还是**改了记法不再被计数**
 * （`applyOrUpdate` 那类漏计）看不出来。首行三个数并列之后，`已接 + 裸 == 分母`
 * 这一眼就能对上，任何一侧漏计都会立刻显形。
 */
export function registerSiteTally(sites) {
  const bare = sites.filter((s) => !s.owned)
  const owned = sites.filter((s) => s.owned)
  return {
    files: new Set(sites.map((s) => s.relPath)).size,
    total: sites.length,
    ownedFiles: new Set(owned.map((s) => s.relPath)).size,
    owned: owned.length,
    bareFiles: new Set(bare.map((s) => s.relPath)).size,
    bare: bare.length,
  }
}

/** 审计：返回问题列表（空 = 通过） */
export function auditSources(sources, { baseline = BASELINE, methods = REGISTER_METHODS } = {}) {
  const re = registerCallRegex(methods)
  const problems = []
  const mark = (kind, relPath, line, msg) => {
    if (baseline.includes(`${kind}@${relPath}`)) return
    problems.push(`${relPath}:${line} [${kind}] ${msg}`)
  }

  for (const { relPath, text } of sources) {
    // 判据 A/B：卸载钩子块内**默认拒绝**任何未登记调用（白名单见 UNMOUNT_ALLOWED）
    for (const block of unmountBlocks(text)) {
      for (const { line, text: t } of block) {
        if (COMMENT.test(t)) continue
        for (const m of t.matchAll(CALL)) {
          const name = m[1]
          if (UNMOUNT_ALLOWED.has(name)) continue
          mark(
            'unmount-call',
            relPath,
            line,
            `卸载钩子里调 ${name}()：` +
              (looksLikeLayerTeardown(name)
                ? '名字像图层注销 —— 应经 useOwnedLayers，由作用域销毁统一清'
                : '不在卸载白名单内 —— 若确属非图层收尾，登记进 UNMOUNT_ALLOWED 并写明理由')
          )
        }
      }
    }

    // 判据 C：图层注册必须经 owner 册（按 `useOwnedLayers` 派生的变量判定，不按变量名）
    const owners = ownedReceivers(text)
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = re.exec(lines[i])
      if (!m) continue
      const receiver = m[2]
      if (owners.has(receiver)) continue
      mark(
        'bare-register',
        relPath,
        i + 1,
        `图层注册未经 useOwnedLayers（${receiver}.${m[3]}）—— 注册不登记归属，卸载时没人替它清`
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
  const problems = [...auditSources(sources), ...ownerScopeViolations(sources)]

  const t = registerSiteTally(sites)
  console.log(
    `[owned-layers] 注册点分母：${t.files} 个文件 / ${t.total} 处调用；` +
      `其中经 owner 册 ${t.ownedFiles} 个文件 / ${t.owned} 处；裸 ${t.bareFiles} 个文件 / ${t.bare} 处`
  )

  if (problems.length === 0) {
    const pages = sources.filter((s) => s.relPath.endsWith('.vue')).length
    console.log(
      `[owned-layers] OK：${pages} 个业务页面 + ${sources.length - pages} 个 .ts 源文件中，` +
        `卸载钩子内的调用全部在白名单（${UNMOUNT_ALLOWED.size} 项）`
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
