/**
 * 判据：图表主题色只经 chartColor（CHART_COLORS 的二选一入口）取。
 * 治的失效：U2 收口前「按主题二选一」这条不变式被手抄 18 份——
 * `dark ? CHART_COLORS.x.dark : CHART_COLORS.x.light` 遍布两个 composable 与一个面板，
 * 亮/暗值改一处漏十七处，且新增图表不会记得写全两边。
 * 用 AST 判形态，不用文本子串：注释、字符串、改名后的近字形都不该被判成命中。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { CHART_COLORS, chartColor } from '../colors'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 判据域 = frontend/src（后端无 ECharts；与 tools/dup 的 SCAN_DIRS 对齐） */
const SRC = path.resolve(HERE, '..', '..', '..')
/** 唯一允许出现「按主题二选一」形态的权威源 */
const AUTHORITY = 'shared/constants/colors.ts'
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/

/**
 * 已判定「不许收口」的近失站点：收到 CHART_COLORS 会改变外观，属视觉变更需产品定。
 * 按「文件 → 被豁免的字面量对」登记（不是整文件豁免）⇒ 同文件里新增别的色值仍会红。
 * 各条豁免必须仍在使用（见下「豁免不得过期」用例），删了色值就要删豁免。
 */
const ALLOWED_LITERALS: Record<string, string[]> = {
  // 雷达网格线用半透明黑白叠层，CHART_COLORS 无对应语义键
  'business/site-suitability/components/SuitabilityRadarPanel.vue': [
    'rgba(255,255,255,.18)|rgba(0,0,0,.12)',
  ],
}

type HitKind = 'palette' | 'literal' | 'keyPick'

interface ScanHit {
  kind: HitKind
  line: number
  /** palette：色键名；literal：`亮值|暗值`；keyPick：`键名或 <computed>` */
  detail: string
}

function peel(node: ts.Node): ts.Node {
  let cur = node
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression
  return cur
}

/** 判定条件表达式是否为「当前是否暗色」（dark / isDark / isDark.value） */
function isDarkCond(node: ts.Node): boolean {
  const cond = peel(node)
  if (ts.isIdentifier(cond)) return cond.text === 'dark' || cond.text === 'isDark'
  if (ts.isPropertyAccessExpression(cond) && cond.name.text === 'value') {
    const base = peel(cond.expression)
    return ts.isIdentifier(base) && base.text === 'isDark'
  }
  return false
}

/** 色值字面量（#hex / rgb / rgba / hsl / hsla） */
function isColorLiteral(node: ts.Node): boolean {
  const target = peel(node)
  return ts.isStringLiteralLike(target) && /^(#|rgba?\(|hsla?\()/.test(target.text)
}

/** 解析 `CHART_COLORS.<key>.<mode>` / `CHART_COLORS['<key>']['<mode>']` 形态 */
function chartColorsRef(node: ts.Node): { key: string | null; mode: string } | null {
  const target = peel(node)
  const base = peel(
    ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
      ? target.expression
      : target
  )
  let mode: string | null = null
  let key: string | null = null
  if (ts.isPropertyAccessExpression(target)) {
    mode = target.name.text
    if (ts.isPropertyAccessExpression(base)) key = base.name.text
    else if (
      ts.isElementAccessExpression(base) &&
      ts.isStringLiteralLike(base.argumentExpression)
    ) {
      key = base.argumentExpression.text
    }
  } else if (ts.isElementAccessExpression(target)) {
    if (ts.isStringLiteralLike(target.argumentExpression)) mode = target.argumentExpression.text
    if (ts.isPropertyAccessExpression(base)) key = base.name.text
    else if (
      ts.isElementAccessExpression(base) &&
      ts.isStringLiteralLike(base.argumentExpression)
    ) {
      key = base.argumentExpression.text
    }
  }
  if (mode !== 'dark' && mode !== 'light') return null
  const root = peel(
    ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)
      ? base.expression
      : base
  )
  if (!ts.isIdentifier(root) || root.text !== 'CHART_COLORS') return null
  return { key, mode }
}

/** 标量双值色键（值都是字符串）；seriesPalette / radarSplitArea 是数组，不走 chartColor */
function scalarColorKeys(): string[] {
  return Object.keys(CHART_COLORS).filter((key) => {
    const entry = (CHART_COLORS as Record<string, { light?: unknown; dark?: unknown }>)[key]
    return typeof entry.light === 'string' && typeof entry.dark === 'string'
  })
}

/** 三类违规形态扫描 */
function scan(sourceText: string, fileName = 'x.ts'): ScanHit[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const scalar = new Set(scalarColorKeys())
  const hits: ScanHit[] = []
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  const visit = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node) && isDarkCond(node.condition)) {
      // ① 手抄二选一：dark ? CHART_COLORS.k.dark : CHART_COLORS.k.light
      const whenTrue = chartColorsRef(node.whenTrue)
      const whenFalse = chartColorsRef(node.whenFalse)
      if (
        whenTrue?.key &&
        whenFalse?.key === whenTrue.key &&
        whenTrue.mode === 'dark' &&
        whenFalse.mode === 'light' &&
        scalar.has(whenTrue.key)
      ) {
        hits.push({ kind: 'palette', line: lineOf(node), detail: whenTrue.key })
      } else if (isColorLiteral(node.whenTrue) && isColorLiteral(node.whenFalse)) {
        // ② 手抄色值：dark ? '#111' : '#222'（权威源里没有这个色，双主题各抄一份）
        const lit = (n: ts.Node): string => (peel(n) as ts.StringLiteralLike).text
        hits.push({
          kind: 'literal',
          line: lineOf(node),
          detail: `${lit(node.whenTrue)}|${lit(node.whenFalse)}`,
        })
      }
    }
    // ③ 同义改写：CHART_COLORS[.<标量键>|computed][dark ? 'dark' : 'light']（自己再写一个 chartColor）
    if (ts.isElementAccessExpression(node)) {
      const index = peel(node.argumentExpression)
      if (ts.isConditionalExpression(index) && isDarkCond(index.condition)) {
        const modes = [peel(index.whenTrue), peel(index.whenFalse)].map((n) =>
          ts.isStringLiteralLike(n) ? n.text : null
        )
        if (modes[0] === 'dark' && modes[1] === 'light') {
          const container = peel(node.expression)
          let keyName: string | null = null
          if (ts.isPropertyAccessExpression(container)) keyName = container.name.text
          else if (
            ts.isElementAccessExpression(container) &&
            ts.isStringLiteralLike(container.argumentExpression)
          ) {
            keyName = container.argumentExpression.text
          }
          // 数组键（seriesPalette / radarSplitArea）本来就无法走 chartColor，不算改写
          if (keyName === null || scalar.has(keyName)) {
            hits.push({ kind: 'keyPick', line: lineOf(node), detail: keyName ?? '<computed>' })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

interface SourceFile {
  rel: string
  text: string
  parseErrors: number
}

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g

/**
 * 取 .vue 的 script 块（其余内容换成等量换行，保留行号）。
 * 不用 @vue/compiler-sfc：它不是直接依赖，且这里只需脚本区间；抽错会被 parseErrors 兜住。
 */
function scriptOnly(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(SCRIPT_RE)) {
    const at = match.index ?? 0
    out += text.slice(last, at).replace(/[^\n]/g, '')
    out += match[1]
    last = at + match[0].length
  }
  return out + text.slice(last).replace(/[^\n]/g, '')
}

function listSources(dir: string): SourceFile[] {
  const files: SourceFile[] = []
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      const abs = path.join(current, entry.name)
      const raw = fs.readFileSync(abs, 'utf8')
      const text = abs.endsWith('.vue') ? scriptOnly(raw) : raw
      const probe = ts.createSourceFile(entry.name, text, ts.ScriptTarget.Latest, true)
      files.push({
        rel: path.relative(SRC, abs).split(path.sep).join('/'),
        text,
        // ts.SourceFile.parseDiagnostics 未进公开类型定义（运行时存在）
        parseErrors:
          (probe as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0,
      })
    }
  }
  walk(dir)
  return files
}

describe('chartColor — CHART_COLORS 的按主题二选一唯一入口', () => {
  it('标量色键：亮/暗取值逐键等于 CHART_COLORS（从权威源派生，不手抄色板）', () => {
    const keys = scalarColorKeys()
    // 阳性对照：权威源若被改成空壳，下面逐键断言会因空转全绿
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain('textPrimary')
    expect(keys).not.toContain('seriesPalette')
    expect(keys).not.toContain('radarSplitArea')
    for (const key of keys) {
      const entry = (CHART_COLORS as unknown as Record<string, { light: string; dark: string }>)[
        key
      ]
      expect(chartColor(key as Parameters<typeof chartColor>[0], false), `${key}.light`).toBe(
        entry.light
      )
      expect(chartColor(key as Parameters<typeof chartColor>[0], true), `${key}.dark`).toBe(
        entry.dark
      )
    }
  })

  it('扫描器阳性对照：三种违规形态都能被扫到（含色键名与色值）', () => {
    const palette = scan(
      'const a = dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textPrimary.light'
    )
    expect(palette).toEqual([{ kind: 'palette', line: 1, detail: 'textPrimary' }])

    const bracketForm = scan(
      "const a = isDark.value ? CHART_COLORS['axisLine']['dark'] : CHART_COLORS['axisLine']['light']"
    )
    expect(bracketForm.map((hit) => hit.kind)).toEqual(['palette'])
    expect(bracketForm[0].detail).toBe('axisLine')

    const literal = scan("const a = dark ? '#303133' : '#e8edf4'")
    expect(literal).toEqual([{ kind: 'literal', line: 1, detail: '#303133|#e8edf4' }])

    const rewrite = scan("const a = CHART_COLORS.textMuted[dark ? 'dark' : 'light']")
    expect(rewrite).toEqual([{ kind: 'keyPick', line: 1, detail: 'textMuted' }])
  })

  it('扫描器近失对照：键选择、数组键、注释、字符串、非色值一律不咬', () => {
    const nearMiss = [
      // 亮/暗只是一个键名，不是色值
      "const mode = dark ? 'dark' : 'light'",
      // 数组色板本来就走不了 chartColor，允许就地取
      "const p = CHART_COLORS.seriesPalette[dark ? 'dark' : 'light']",
      "const p = CHART_COLORS.radarSplitArea[dark ? 'dark' : 'light']",
      // 非色值三元
      'const c = dark ? byType.a : byType.b',
      // 注释与字符串不是 AST 形态
      '// const a = dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textPrimary.light',
      `const s = "dark ? '#111' : '#222'"`,
      // 条件不是主题
      "const c = light ? '#111' : '#222'",
      // 两个分支不同色键（不是同一个不变式）
      'const c = dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textMuted.light',
    ].join('\n')
    expect(scan(nearMiss)).toEqual([])
  })

  it('🔴 @guard-red-sample 全仓无手抄二选一/手抄色值，且 chartColor 仍是唯一取色入口', () => {
    const sources = listSources(SRC)
    expect(sources.length, '扫描面为空 ⇒ 判据空转').toBeGreaterThan(100)
    const unparsable = sources.filter((file) => file.parseErrors > 0).map((file) => file.rel)
    expect(unparsable, '脚本块抽取/语法异常 ⇒ 扫描结果不可信').toEqual([])

    const found = sources.flatMap((file) => scan(file.text, file.rel).map((hit) => ({ file, hit })))
    /** 豁免：登记过的近失色值 + 权威源自身的 chartColor 实现（它就是那条不变式本体） */
    const allowed = ({ file, hit }: { file: SourceFile; hit: ScanHit }): boolean =>
      (hit.kind === 'literal' && (ALLOWED_LITERALS[file.rel] ?? []).includes(hit.detail)) ||
      (hit.kind === 'keyPick' && file.rel === AUTHORITY)
    const violations = found
      .filter((item) => !allowed(item))
      .map(({ file, hit }) => `${file.rel}:${hit.line} [${hit.kind}] ${hit.detail}`)
    expect(violations, '图表主题色必须经 chartColor / CHART_COLORS 取，不得手抄').toEqual([])
  })

  it('豁免不得过期：登记为「不改」的近失色值仍在，删了色值必须同笔删豁免', () => {
    const sources = new Map(listSources(SRC).map((file) => [file.rel, file]))
    for (const [rel, allowed] of Object.entries(ALLOWED_LITERALS)) {
      const source = sources.get(rel)
      expect(source, `豁免指向的文件不存在：${rel}`).toBeDefined()
      const literals = scan(source!.text, rel)
        .filter((hit) => hit.kind === 'literal')
        .map((hit) => hit.detail)
      for (const literal of allowed) {
        expect(literals, `${rel} 已无被豁免的色值 ${literal} ⇒ 同笔删除该豁免`).toContain(literal)
      }
    }
  })
})
