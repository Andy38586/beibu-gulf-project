#!/usr/bin/env node
/**
 * layer-keys.mjs — 图层 key 字面量守卫：图层 key 必须经权威表引用，不得裸写。
 *
 * ## 治什么
 *
 * `shared/constants/layers.ts` 是图层 key 的唯一权威表（a028，2026-09-25 立表）。
 * 表立了不等于没人再裸写：`UnifiedMap.vue` 注册、`mapStore.ts` 白名单、各业务页
 * `layer-order` 数组曾经各写各的，改一个 id 要人肉扫 6+ 处，漏一处即「图层面板按钮
 * 静默消失」。本守卫把「新裸写」在 `guard:v3` 拦下，而不是等下一次改名时被发现。
 *
 * ## 词表**派生**自权威表，不手抄
 *
 * `LAYER_KEYS`（词表）从 `layers.ts` 的 `export const LAYER_KEYS = { … } as const`
 * 解析对象值得到；派生为空即 `throw`（判据空转会报「全部通过」，比判红更危险）。
 * 新增图层 key 只改 `layers.ts`，本守卫无需回来维护。
 *
 * ## 判据域（**刻意收窄**，2026-09-26 用户裁定）
 *
 * 只检查「图层 key 的**使用位置**」，共三类：
 *   (a) `layer-order` / `layerOrder` 的数组字面量内；
 *   (b) 图层注册/注销类调用的实参：`register(` / `has(` / `remove(` / `setVisible(` /
 *       `registerBaseLayer(` / `setBaseLayer(` / `applyOrUpdate(`；
 *   (c) 名字含 `layerId` / `layerKey`（含 `LAYER_ID` / `LAYER_KEY`）的 `const/let/var`
 *       初始化值。
 *
 * 为什么**不**做 blanket「字面量一律判红」：实测有一批**同名不同义**的位置会被误伤 ——
 * `featureType: 'boundary'`（useBoundaryLayer / FloodAnalysisPage / OLRenderer）、
 * `domain: 'route-path'`（RouteControlPanel / types/task.ts）、`Pick<…, 'ports'>`
 * （forecastAdapter）。用户已裁定 **`featureType` 保持直接用字面量**（不做编号表间接化），
 * 故这些位置**不在判据域内**，也**不进 BASELINE 豁免**（给它们开豁免是 blanket 路线的
 * 做法，已否）。本守卫输出的「豁免项」只列 `site-selection`（见下）。
 *
 * 排除口径（逐行判定）：注释行、测试文件、`constants/layers.ts` 自身，以及出现于
 * `featureType` / `domain:` / `TASK_DOMAINS` / `Pick<` 语境的**整行**。
 *
 * ## 残余逃逸面（如实声明，未收口）
 *
 *   1. **换语法位置即漏**：判据只覆盖上面 (a)(b)(c) 三类。把 key 挪到别的语法位置
 *      （对象属性值、模板串、数组元素、`switch` 分支、`Map` 初始化……）本守卫看不到。
 *   2. **同义改写可绕**：(b) 的方法名单是**手写**的六个名字，不是派生 —— 换成
 *      `upsert(` / `show(` / 自建封装函数即可逃逸（这与 owned-layers 判据 C 用
 *      **派生**注册语义集的路线相反，是本判据已知的退化点）。
 *   3. **行长豁免过宽**：整行命中 `featureType:` 等语境即整行放过 —— 把
 *      `manager.register('boundary', { featureType: 'boundary' })` 写在一行里，
 *      那个**真·图层 key** 会被一起放过。
 *   4. **彻底解法**：先解耦 featureType / domain 与图层 key 的「三处同源」同名关系，
 *      再上绝对判据（不再需要语境豁免）。用户已知悉本条，并选择本轮的收窄路线。
 *
 * ## 豁免口
 *
 * `BASELINE` = 路径前缀表，只放 `frontend/src/business/site-selection/**` —— 该模块
 * 待整体移除（2026-09-25 裁定），其 `layer-order` 数组仍裸写 4 个公共 key
 * （`SiteSelectionPage.vue:491-494`）。豁免口由人定、不由修的人定（AGENTS §四-10）。
 * 运行时**显式列出**豁免项，不静默吞掉。
 *
 * 用法：node tools/v3-guard/layer-keys.mjs   （违例 exit 1，且列出豁免项）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC_ROOT = path.join(ROOT, 'frontend/src')
const LAYERS_TABLE_REL = 'frontend/src/shared/constants/layers.ts'
const LAYERS_TABLE = path.join(ROOT, LAYERS_TABLE_REL)

/** 豁免基线：路径前缀（只放待移除的 site-selection；见文件头「豁免口」）。 */
export const BASELINE = ['frontend/src/business/site-selection/']

/**
 * 从权威表源码解析 `LAYER_KEYS` 的对象值（**词表的唯一出处**，不手抄）。
 * @param {string} source layers.ts 文本
 * @returns {string[]}
 */
export function deriveLayerKeys(source) {
  const block = source.match(/export const LAYER_KEYS\s*=\s*\{([\s\S]*?)\}\s*as const/)
  if (!block) return []
  return [...block[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1])
}

/** 运行时读一次。派生为空即抛 —— 词表静默归零等于判据空转 */
export const LAYER_KEYS = (() => {
  const keys = deriveLayerKeys(fs.readFileSync(LAYERS_TABLE, 'utf8'))
  if (keys.length === 0) {
    throw new Error(
      `[layer-keys] 词表派生为空（读不到 ${LAYERS_TABLE_REL} 的 LAYER_KEYS）—— 拒绝继续`
    )
  }
  return keys
})()

const LAYER_KEY_SET = new Set(LAYER_KEYS)

/** 注释行（含 .vue 模板注释）：放过 —— 否则文件头自述会被自己判违规 */
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/

/**
 * 语境豁免（**整行**）：同名不同义的使用位置。见文件头「判据域」与「残余逃逸面 3」。
 * `featureType` 用 `:`/`===`/`==` 判定；`domain:` 只认冒号形态，避免误咬普通词。
 */
const EXCLUDE_CONTEXT = /featureType\s*(?::|={2,3})|\bdomain\s*:|TASK_DOMAINS|Pick\s*</

/** 判定 (a)：layer-order / layerOrder 数组 */
const LAYER_ORDER_HEAD = /layer-?order/

/** 判定 (b)：图层注册/注销类调用（**手写名单**，见文件头逃逸面 2） */
const LAYER_CALL = new RegExp(
  '(?<![\\w$.])(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?' +
    '(register|has|remove|setVisible|registerBaseLayer|setBaseLayer|applyOrUpdate)\\s*\\('
)

/** 判定 (c)：声明名含 layerId / layerKey（大小写与下划线不敏感） */
const DECL_HEAD = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/
const KEY_NAME = /layer_?(id|key)/i

/** 字符串字面量（单/双引号，以及不含插值的模板串） */
const STRING_LITERAL = /'([^'\n]*)'|"([^"\n]*)"|`([^`$\n]*)`/g

/**
 * 从 (startLine, startCol) 的 open 字符起，按配平返回覆盖的行号集合（0-based）。
 * 单行闭合时只返回该行。
 */
function bracketRegionLines(lines, startLine, startCol, open, close) {
  const set = new Set()
  let depth = 0
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    for (let c = i === startLine ? startCol : 0; c < line.length; c++) {
      if (line[c] === open) depth++
      else if (line[c] === close) depth--
    }
    set.add(i)
    if (depth <= 0) break
  }
  return set
}

/** 计算一个文件里「属判据域」的行号集合（0-based）。纯函数，便于单测 */
export function inDomainLines(text) {
  const lines = text.split(/\r?\n/)
  const domain = new Set()

  // (a) layer-order 数组区域
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LAYER_ORDER_HEAD)
    if (!m) continue
    const bracket = lines[i].indexOf('[', m.index)
    if (bracket === -1) continue
    for (const ln of bracketRegionLines(lines, i, bracket, '[', ']')) domain.add(ln)
  }

  // (b) 注册/注销类调用区域 + (c) key 命名声明行
  for (let i = 0; i < lines.length; i++) {
    const call = lines[i].match(LAYER_CALL)
    if (call) {
      const paren = lines[i].indexOf('(', call.index)
      if (paren !== -1)
        for (const ln of bracketRegionLines(lines, i, paren, '(', ')')) domain.add(ln)
    }
    const decl = lines[i].match(DECL_HEAD)
    if (decl && KEY_NAME.test(decl[1])) domain.add(i)
  }
  return domain
}

/** 从一行里抽出落在词表内的字符串字面量 */
function offendingKeys(line) {
  const hits = []
  for (const m of line.matchAll(STRING_LITERAL)) {
    const value = m[1] ?? m[2] ?? m[3]
    if (value !== undefined && LAYER_KEY_SET.has(value)) hits.push(value)
  }
  return hits
}

/** 审计：返回问题列表（空 = 通过）。`baseline` 为路径前缀表 */
export function auditLayerKeys(files, { baseline = BASELINE } = {}) {
  const problems = []
  const exempted = []
  for (const { relPath, text } of files) {
    if (relPath === LAYERS_TABLE_REL) continue
    if (/__tests__|\.test\.ts$/.test(relPath)) continue
    const lines = text.split(/\r?\n/)
    const domain = inDomainLines(text)
    for (let i = 0; i < lines.length; i++) {
      if (!domain.has(i)) continue
      if (COMMENT.test(lines[i])) continue
      if (EXCLUDE_CONTEXT.test(lines[i])) continue
      const hits = offendingKeys(lines[i])
      if (hits.length === 0) continue
      const where = `${relPath}:${i + 1}`
      const msg = `${where} 裸写图层 key ${hits.map((h) => `'${h}'`).join('、')} —— 改用 shared/constants/layers 的 LAYER_KEYS / forecastLayerId()`
      if (baseline.some((p) => relPath.startsWith(p))) exempted.push(msg)
      else problems.push(msg)
    }
  }
  return { problems, exempted }
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
  const { problems, exempted } = auditLayerKeys(files)
  console.log(
    `[layer-keys] 词表 ${LAYER_KEYS.length} 项（派生自 ${LAYERS_TABLE_REL}），扫描 ${files.length} 个源文件`
  )
  if (exempted.length > 0) {
    console.log(`[layer-keys] 基线豁免 ${exempted.length} 处（前缀：${BASELINE.join(', ')}）：`)
    for (const e of exempted) console.log(`  ~ ${e}`)
  } else {
    console.log('[layer-keys] 基线豁免 0 处')
  }
  if (problems.length === 0) {
    console.log('[layer-keys] OK：判据域内无裸写图层 key')
    return
  }
  console.error(`[layer-keys] FAIL：${problems.length} 处裸写图层 key`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
