import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 样式单源守卫（必要性审判波二·单元 L）
 *
 * 头注里的「唯一副本」是**声称**，不是事实：`bubble.css` 被抽取时（D21 批 6，
 * e2e312fa）整块删除是对的，但设施气泡在 `89b82a8a` 又被回填了一份
 * `.bubble-tail` / `.bubble-tail::after` 逐字副本 —— 同一选择器在同一组件的
 * 两个 scoped 样式块里声明两次，后写覆盖前写，改一处漏一处即样式漂移。
 *
 * 判据口径：一个 .vue 若用 `<style scoped src="./x.css">` 引入外部样式表，
 * 它自己的 <style> 块就**不得再定义该表已定义的选择器**（覆盖关系里的重复定义）。
 * 只咬「同文件 + 被引样式表」这一确定的可判定面，不做跨组件样式去重（那需要
 * 设计决策，属 §四-10）。
 *
 * 分母：frontend/src 下 50 个 .vue / 3 个 .css；带 src 的 .vue 恰 2 个
 * （MapFacilityBubble.vue / MapFeatureBubble.vue，均引 ./bubble.css）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..', '..')
const SKIP_DIR = new Set(['__tests__', '__mocks__', 'node_modules', 'dist', '.local'])
const STYLE_RE = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
const SRC_ATTR_RE = /\bsrc\s*=\s*["']([^"']+)["']/

export interface StyleBlock {
  /** 外部样式表相对路径（未声明 src 时为 null） */
  src: string | null
  /** 内联样式内容（src 块为空串） */
  content: string
}

/** 拆出一个 .vue 的所有 <style> 块（正则即可：SFC 的 style 块不嵌套 <style>） */
export function styleBlocks(text: string): StyleBlock[] {
  const blocks: StyleBlock[] = []
  for (const match of text.matchAll(STYLE_RE)) {
    const attrs = match[1]
    const src = SRC_ATTR_RE.exec(attrs)?.[1] ?? null
    blocks.push({ src, content: match[2] })
  }
  return blocks
}

/** 把一段 CSS 展开成「选择器（空白归一）→ 声明体（空白归一）」的映射 */
export function selectorBodies(css: string): Map<string, string> {
  const out = new Map<string, string>()
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (selector === '' || selector.startsWith('@')) continue
    out.set(selector, match[2].replace(/\s+/g, ' ').trim())
  }
  return out
}

/** 覆盖关系下的重复定义：本文件内联块 ∩ 被引样式表 */
export function repeatedSelectors(
  blocks: StyleBlock[],
  readCss: (rel: string) => string
): string[] {
  const imported = new Set<string>()
  const local = new Map<string, string>()
  for (const block of blocks) {
    const map = selectorBodies(block.content)
    if (block.src === null) {
      for (const [selector, body] of map) local.set(selector, body)
    } else {
      for (const selector of selectorBodies(readCss(block.src)).keys()) imported.add(selector)
    }
  }
  return [...local.keys()].filter((selector) => imported.has(selector)).sort()
}

function listFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) listFiles(path.join(dir, entry.name), ext, out)
    } else if (entry.name.endsWith(ext)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

const readCssFrom = (vueFile: string) => (rel: string) =>
  fs.readFileSync(path.resolve(path.dirname(vueFile), rel), 'utf8')

/** 阳性对照：同时 src 引表又自写同名规则 —— 必须被抽到 */
const HAND_WRITTEN_SAMPLE = `<style scoped src="./bubble.css"></style>
<style scoped>
.bubble-actions { display: flex; }
.bubble-tail { position: absolute; }
</style>
`

describe('样式单源：src 引表后不得再定义同名选择器（必要性审判波二·单元 L）', () => {
  const vueFiles = listFiles(SRC, '.vue')
  const withSrc = vueFiles.filter((file) =>
    styleBlocks(fs.readFileSync(file, 'utf8')).some((block) => block.src !== null)
  )

  it('全仓无「src 引表 + 本文件重复定义」', () => {
    const offenders: string[] = []
    for (const file of withSrc) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      const repeated = repeatedSelectors(
        styleBlocks(fs.readFileSync(file, 'utf8')),
        readCssFrom(file)
      )
      if (repeated.length > 0) offenders.push(`${rel}: 重复定义 [${repeated.join(', ')}]`)
    }
    expect(offenders).toEqual([])
    // 兜空：扫描面必须真的扫到仓库
    expect(vueFiles.length).toBeGreaterThan(40)
    // 面本身必须存在（否则上面那条永远空转）
    expect(withSrc.length).toBeGreaterThanOrEqual(2)
  })

  it('带 src 的两个气泡组件仍从 bubble.css 取样式（防覆盖关系被摘掉）', () => {
    const rels = withSrc.map((file) => path.relative(SRC, file).split(path.sep).join('/')).sort()
    expect(rels).toEqual([
      'core/map/components/MapFacilityBubble.vue',
      'core/map/components/MapFeatureBubble.vue',
    ])
    for (const file of withSrc) {
      const srcs = styleBlocks(fs.readFileSync(file, 'utf8'))
        .filter((block) => block.src !== null)
        .map((block) => block.src)
      expect(srcs).toEqual(['./bubble.css'])
    }
  })

  it('🔴 @guard-red-sample 同形态样本（src 引表 + 自写同名规则）必须被抽到', () => {
    const repeated = repeatedSelectors(styleBlocks(HAND_WRITTEN_SAMPLE), () => {
      return '.bubble-tail { x: 1 }'
    })
    expect(repeated).toEqual(['.bubble-tail'])
    // 阴性对照：只写私有规则 ⇒ 不报
    expect(
      repeatedSelectors(
        styleBlocks(
          '<style scoped src="./bubble.css"></style>\n<style scoped>.bubble-actions { display: flex; }</style>'
        ),
        () => '.bubble-tail { x: 1 }'
      )
    ).toEqual([])
  })
})
