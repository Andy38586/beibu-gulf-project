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
/** 直接注销：`.remove(` */
const DIRECT_REMOVE = /\.remove\s*\(/
/**
 * 间接注销：清理图层的封装函数调用。
 * `clearTimeout` / `clearTimer` 这类**不含 Layers** 的不匹配 —— 它们不是图层操作。
 */
const INDIRECT_REMOVE = /\b(?:clear|remove|release)\w*(?:Layers?|LayerIds?)\s*\(|\breleaseAll\s*\(/
/** 注册调用：捕获接收者名（第 2 组） */
const REGISTER_CALL = /(^|[^.\w])([A-Za-z_$][\w$]*)\.register\s*\(/
/** owner 册变量名（经 useOwnedLayers 得到的那些） */
const OWNED_RECEIVER = /^(owned|ownedLayers)$/i
/** 图层管理器接收者：名字含 manager */
const MANAGER_RECEIVER = /manager/i

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
 * `owned` 标记 = 接收者经 owner 册。
 */
export function layerRegisterSites(sources) {
  const sites = []
  for (const { relPath, text } of sources) {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = REGISTER_CALL.exec(lines[i])
      if (!m) continue
      sites.push({ relPath, line: i + 1, receiver: m[2], owned: OWNED_RECEIVER.test(m[2]) })
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
    // 判据 A / B：卸载钩子块内不得注销（直接或间接）
    for (const block of unmountBlocks(text)) {
      for (const { line, text: t } of block) {
        if (COMMENT.test(t)) continue
        if (DIRECT_REMOVE.test(t)) {
          mark(
            'unmount-remove',
            relPath,
            line,
            '在卸载钩子里直接手写图层注销 —— 应经 useOwnedLayers，由作用域销毁统一清'
          )
        } else if (INDIRECT_REMOVE.test(t)) {
          mark(
            'unmount-indirect',
            relPath,
            line,
            '在卸载钩子里间接注销图层（调用清理封装）—— 与手写注销等价，同样应交给作用域销毁'
          )
        }
      }
    }

    // 判据 C：图层注册必须经 owner 册
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT.test(lines[i])) continue
      const m = REGISTER_CALL.exec(lines[i])
      if (!m) continue
      const receiver = m[2]
      if (!MANAGER_RECEIVER.test(receiver) || OWNED_RECEIVER.test(receiver)) continue
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

function main() {
  const sources = collectSources()
  const sites = layerRegisterSites(sources)
  const ownedCount = sites.filter((s) => s.owned).length
  const problems = auditSources(sources)

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
