/**
 * 判据：设施渲染色只经 facilityColor（FACILITY_COLORS_MAP + 兜底的唯一入口）取。
 * 治的失效：收口前「映射查表 + 兜底」这条同构实现在图表侧手抄两份
 * （RadarScoreTooltip.vue 与 useRadarChart.ts），兜底色改一处漏一处。
 * 用 AST 判形态，不用文本子串：注释、字符串、改名后的近字形都不该被判成命中。
 *
 * 判据边界（如实声明）：AST 扫描只覆盖 .vue 的 <script> 段；模板段不是 TS，不进 AST。
 * 模板段若手抄同形态，其所属 .vue 必先 import 两常量，因此会被本文件第 5 例
 * （两消费点文本面钉死）之外的「导入面」察觉——当前全仓模板段唯一消费点即那两文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { FACILITY_COLORS_MAP, FACILITY_FALLBACK_COLOR, facilityColor } from '../colors'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 判据域 = frontend/src（与 tools/dup 的 SCAN_DIRS 对齐） */
const SRC = path.resolve(HERE, '..', '..', '..')
/** 唯一允许出现「映射 + 兜底」形态的权威源 */
const AUTHORITY = 'shared/constants/colors.ts'
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g

/** 取 .vue 的 script 块（其余内容换成等量换行，保留行号） */
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

function peel(node: ts.Node): ts.Node {
  let cur = node
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression
  return cur
}

/** 判定 FACILITY_COLORS_MAP[...] || FACILITY_FALLBACK_COLOR 形态 */
function isMapWithFallback(node: ts.Node): boolean {
  const target = peel(node)
  if (!ts.isBinaryExpression(target)) return false
  const op = target.operatorToken.kind
  // `||` 与 `??` 是同一违约的两种记法（同义改写也必须红）
  if (op !== ts.SyntaxKind.BarBarToken && op !== ts.SyntaxKind.QuestionQuestionToken) return false
  const left = peel(target.left)
  const right = peel(target.right)
  if (!ts.isElementAccessExpression(left)) return false
  const container = peel(left.expression)
  if (!ts.isIdentifier(container) || container.text !== 'FACILITY_COLORS_MAP') return false
  return ts.isIdentifier(right) && right.text === 'FACILITY_FALLBACK_COLOR'
}

/** 扫描：返回违规站点（排除权威源本身） */
function scan(sources: { rel: string; text: string }[]): { rel: string; line: number }[] {
  const hits: { rel: string; line: number }[] = []
  for (const { rel, text } of sources) {
    if (rel === AUTHORITY) continue
    const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
    const lineOf = (node: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    const visit = (node: ts.Node): void => {
      if (isMapWithFallback(node)) hits.push({ rel, line: lineOf(node) })
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return hits
}

function listSources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = []
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      const abs = path.join(current, entry.name)
      const raw = fs.readFileSync(abs, 'utf8')
      out.push({
        rel: path.relative(SRC, abs).split(path.sep).join('/'),
        text: abs.endsWith('.vue') ? scriptOnly(raw) : raw,
      })
    }
  }
  walk(SRC)
  return out
}

describe('facilityColor — 设施渲染色映射+兜底的唯一入口', () => {
  it('逐键取值等于权威源（从 FACILITY_COLORS_MAP 派生，不手抄色板）', () => {
    const keys = Object.keys(FACILITY_COLORS_MAP)
    // 阳性对照：权威源若被改成空壳，下面逐键断言会因空转全绿
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain('hospital')
    for (const key of keys) {
      expect(facilityColor(key), key).toBe(FACILITY_COLORS_MAP[key])
    }
  })

  it('未知 key 落兜底色，且兜底色不等于任何已知设施色（近失对照）', () => {
    expect(facilityColor('__no_such_facility__')).toBe(FACILITY_FALLBACK_COLOR)
    expect(Object.values(FACILITY_COLORS_MAP)).not.toContain(FACILITY_FALLBACK_COLOR)
  })

  it('扫描器阳性对照：手抄形态能被扫到，近失形态不误红', () => {
    const hit = scan([
      { rel: 'a.ts', text: 'const c = FACILITY_COLORS_MAP[key] || FACILITY_FALLBACK_COLOR' },
    ])
    expect(hit).toEqual([{ rel: 'a.ts', line: 1 }])
    expect(scan([{ rel: 'a.ts', text: 'const c = FACILITY_COLORS_MAP[key]' }])).toEqual([])
    expect(
      scan([{ rel: 'a.ts', text: 'const c = FACILITY_COLORS_MAP[key] || COLOR_PRIMARY' }])
    ).toEqual([])
    expect(
      scan([
        { rel: AUTHORITY, text: 'const c = FACILITY_COLORS_MAP[k] || FACILITY_FALLBACK_COLOR' },
      ])
    ).toEqual([])
  })

  it('全仓无第二份手抄（权威源除外）', () => {
    const sources = listSources()
    // 兜空路径：扫描面失效（目录挪走/过滤器写错）时本用例会静默全绿
    expect(sources.length).toBeGreaterThan(100)
    expect(scan(sources)).toEqual([])
  })

  it('两个图表消费点改走权威入口（旧本地实现与旧具名导入都已摘除）', () => {
    for (const rel of [
      'visualization/charts/components/RadarScoreTooltip.vue',
      'visualization/charts/composables/useRadarChart.ts',
    ]) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(text, rel).toMatch(/facilityColor\(/)
      expect(text, rel).not.toMatch(/getFacilityColor/)
      expect(text, rel).not.toMatch(/FACILITY_COLORS_MAP/)
    }
  })
})
