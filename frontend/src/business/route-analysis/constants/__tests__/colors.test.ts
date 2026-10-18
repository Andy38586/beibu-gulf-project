/**
 * 判据：航线分析模块不留「模块色值别名层」——模块渲染色直接取 shared 权威源。
 * 治的失效：G3 收口后仍留 `frontend/src/business/route-analysis/constants/colors.ts`
 * （10 行纯别名 `ROUTE_COLOR = RENDER_BLUE`），且它是全仓唯一的
 * `@/shared/constants/colors` 深路径穿透点——barrel `frontend/src/shared/index.ts`
 * 头注明令「消费方一律走 @/shared，禁止深路径穿透」。
 * 2026-10-18 必要性审判波次二·单元 D：别名层内联回唯一消费点 useRouteLayer.ts，
 * 模块内不留任何 hex 字面量。用 AST 判形态：注释、字符串、改名后的近字形都不该被判成命中。
 *
 * 判据边界（如实声明）：本判据的**全仓断言只覆盖 `@/shared/constants/colors` 一族**——
 * 该族本笔前恰 1 处（被删的别名层），本笔后 0 处。全仓另有 5 处 `@/shared/…` 深路径
 * 不属本族、也不属本单元处置面（`business/diversion/panels.ts` 与
 * `business/site-suitability/panels.ts` 的 `constants/panels` 是 barrel 缺项，
 * `shared/components/GCSModal.vue` 两处与 `ErrorBoundary.vue` 一处）；按 §四-5/§四-7
 * 不顺手跨模块改，已登记台账待裁。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 判据域 = frontend/src（与 tools/dup 的 SCAN_DIRS 对齐） */
const SRC = path.resolve(HERE, '..', '..', '..', '..')
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/
/** 已内联删除的别名层（不得复活） */
const RETIRED_ALIAS = 'business/route-analysis/constants/colors.ts'
/** 模块目录（渲染色不得再落 hex 字面量） */
const MODULE_DIR = 'business/route-analysis'

/** 深路径穿透形态：`@/shared/constants/<x>`（barrel 已收口，禁穿透） */
function deepImportHits(sourceText: string): { line: number; detail: string }[] {
  const sf = ts.createSourceFile('x.ts', sourceText, ts.ScriptTarget.Latest, true)
  const hits: { line: number; detail: string }[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('@/shared/constants/')
    ) {
      hits.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        detail: node.moduleSpecifier.text,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** 取模块全部 import 源（供「消费点不得挂退休别名层/深路径」断言用） */
function importSources(sourceText: string): string[] {
  const sf = ts.createSourceFile('x.ts', sourceText, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 渲染色字面量形态：字符串节点整串是 hex（注释/标识符/其它字符串不咬） */
function hexLiteralHits(sourceText: string): number[] {
  const sf = ts.createSourceFile('x.ts', sourceText, ts.ScriptTarget.Latest, true)
  const hits: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /^#[0-9a-fA-F]{3,8}$/.test(node.text)) {
      hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g

/** 取 .vue 的 script 块（其余内容换成等量换行，保留行号）；模板/CSS 段不是 TS，不进 AST */
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

interface SourceFile {
  rel: string
  text: string
}

function listSources(): SourceFile[] {
  const out: SourceFile[] = []
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

describe('route-analysis 色值别名层 — 已内联，不得复活', () => {
  it('别名层文件已删除；唯一消费点直接从 barrel 取权威色', () => {
    expect(
      fs.existsSync(path.join(SRC, RETIRED_ALIAS)),
      `${RETIRED_ALIAS} 已按必要性审判内联删除，不得复活`
    ).toBe(false)

    const consumer = fs.readFileSync(
      path.join(SRC, 'business/route-analysis/composables/useRouteLayer.ts'),
      'utf8'
    )
    // 阳性对照：内联后仍从权威源取值（不是把色值写死）
    expect(consumer).toContain('RENDER_BLUE')
    // 消费点只从 barrel 取，不得再挂上退休别名层或深路径（AST 判 import 源，不判名字）
    const sources = importSources(consumer)
    expect(sources).toContain('@/shared')
    expect(sources).not.toContain('../constants/colors')
    expect(sources).not.toContain('@/shared/constants/colors')
  })

  it('扫描器阳性对照：深路径穿透与 hex 字面量都能被扫到，近失不误红', () => {
    expect(deepImportHits("import { RENDER_BLUE } from '@/shared/constants/colors'")).toEqual([
      { line: 1, detail: '@/shared/constants/colors' },
    ])
    // 近失：走 barrel（合法）、无 @ 前缀、子目录名相近
    expect(deepImportHits("import { RENDER_BLUE } from '@/shared'")).toEqual([])
    expect(deepImportHits("import { X } from 'shared/constants/colors'")).toEqual([])
    // 近失：同族前缀 `constants/colors…` 的变体仍咬（后缀型深路径）
    expect(deepImportHits("import { X } from '@/shared/constants/colors.ts'")).toEqual([
      { line: 1, detail: '@/shared/constants/colors.ts' },
    ])
    // 近失（判据边界）：不属本族的深路径不咬 —— 全仓断言已按族收窄，见头注
    expect(deepImportHits("import { X } from '@/shared/constants/ui'")).toEqual([
      { line: 1, detail: '@/shared/constants/ui' },
    ])

    expect(hexLiteralHits("const c = '#3b82f6'")).toEqual([1])
    expect(hexLiteralHits("// const c = '#3b82f6'")).toEqual([])
    expect(hexLiteralHits("const c = 'RENDER_BLUE'")).toEqual([])
    expect(hexLiteralHits('const c = 0x3b82f6')).toEqual([])
  })

  it('🔴 @guard-red-sample 全仓无深路径穿透，航线模块无 hex 渲染色', () => {
    const sources = listSources()
    // 兜空路径：扫描面失效（目录挪走/过滤器写错）时本用例会静默全绿
    expect(sources.length, '扫描面为空 ⇒ 判据空转').toBeGreaterThan(100)

    // 全仓断言只覆盖本笔退休的那一族（见头注「判据边界」）；其它 `@/shared/…` 深路径不属本单元处置面
    const deep = sources.flatMap((file) =>
      deepImportHits(file.text)
        .filter((hit) => hit.detail.startsWith('@/shared/constants/colors'))
        .map((hit) => `${file.rel}:${hit.line} ${hit.detail}`)
    )
    expect(deep, 'shared/constants/colors 经 barrel 取，不得深路径穿透').toEqual([])

    const hex = sources
      .filter((file) => file.rel.startsWith(MODULE_DIR + '/'))
      .flatMap((file) => hexLiteralHits(file.text).map((line) => `${file.rel}:${line}`))
    expect(hex, '航线模块渲染色必须取自权威源，不得写 hex').toEqual([])
  })
})
