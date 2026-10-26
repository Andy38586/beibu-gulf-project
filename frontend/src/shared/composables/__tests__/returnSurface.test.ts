// @vitest-environment node
/**
 * composable 返回面单源判据（必要性审判波二·单元 Q）。
 *
 * 治的失效：composable 的 `return { … }` 是**对外 API**，但它的成员常常是先写出来、
 * 后来消费点被删掉而没人回收。这类成员既不是死文件（文件还活着），也不是死导出
 * （`export` 面看起来正常），只有把「返回面成员 × 全仓生产消费点」两两对上才看得见。
 * 本单元实测出三条：`useMapControls` 的 `mapInstance` / `startFacilityBreathing` /
 * `stopFacilityBreathing`、`useFavorites` 的 `isLoggedIn`、`usePlans` 的 `updating`
 * —— 前三者的名字在渲染器里另有同名方法（所以按名字 grep 全仓会假绿），只能按
 * 「返回面 + 定义文件之外是否有人用」判。
 *
 * 判据口径：
 * ① 只认 `export function useXxx` 的**顶层 return 对象字面量**（不追 spread、不追嵌套）；
 * ② 消费点 = 定义文件之外、非 `__tests__`/`__mocks__`、**剥掉注释后**出现该标识符；
 *    注释里提到不算消费（本仓有大量「计划用 X」的注释，不剥即假绿）；
 * ③ 白名单四项均带理由，且每条必须仍真实存在于返回面 —— 白名单不得过期；
 * ④ GONE 表钉住本单元删掉的三条通道，防止以任何写法加回。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 判据域：整个前端源码（composable 分布在 core / shared / business / visualization） */
const SRC = path.resolve(HERE, '..', '..', '..')
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|dist|\.local)$/

/** 白名单：零生产消费但必须保留的返回面成员（每条都有实测理由，不是「先留着」） */
const ALLOWED: Record<string, string[]> = {
  'business/diversion/composables/useDiversionLayer.ts': ['clearDiversionLayers'],
  'core/map/composables/useOwnedLayers.ts': ['releaseAll'],
  'shared/composables/useLatestRequest.ts': ['getCurrentSignal'],
}

/** 本单元删掉的返回面成员：不得以任何写法加回 */
const GONE: Record<string, string[]> = {
  'core/map/composables/useMapControls.ts': [
    'mapInstance',
    'startFacilityBreathing',
    'stopFacilityBreathing',
  ],
  'shared/composables/useFavorites.ts': ['isLoggedIn'],
  'shared/composables/usePlans.ts': ['updating'],
}

export interface Surface {
  file: string
  fn: string
  members: string[]
}

function listSources(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.test(entry.name)) continue
      listSources(path.join(dir, entry.name), acc)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      acc.push(path.join(dir, entry.name))
    }
  }
  return acc
}

function normalize(p: string): string {
  return p.split(path.sep).join('/')
}

/** 剥注释但保留换行与字面量内容（避免把 `// 计划用 x` 当成消费点） */
export function stripComments(text: string): string {
  const out: string[] = []
  let i = 0
  let quote: string | null = null
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (quote) {
      out.push(c)
      if (c === '\\') {
        out.push(next)
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out.push(c)
      i += 1
      continue
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

/** .vue 只取 <script> 段（模板与样式里的同名文字不算消费） */
export function scriptOf(text: string): string {
  const match = text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)
  return match ? match[1] : text
}

/** 键归一化：`{ x }` / `{ x: 1 }` / `{ 'x': 1 }` / `{ ['x']: 1 }` 都读作 x（同义改写不得绕过） */
export function propertyKey(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text
  if (ts.isComputedPropertyName(name)) {
    const inner = name.expression
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text
    return `<${inner.getText()}>`
  }
  return `<${name.getText()}>`
}

/**
 * 抽 `export function useXxx(…): T` 的顶层 return 对象字面量成员。
 * 纯函数、无 IO，红样可直接喂字符串。
 */
export function returnSurface(text: string, file = 'probe.ts'): Surface[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const out: Surface[] = []
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) continue
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported || !stmt.name || !/^use[A-Z]/.test(stmt.name.text)) continue
    const returns = stmt.body.statements.filter(
      (s): s is ts.ReturnStatement => ts.isReturnStatement(s) && !!s.expression
    )
    const last = returns[returns.length - 1]
    if (!last || !last.expression || !ts.isObjectLiteralExpression(last.expression)) continue
    const members: string[] = []
    for (const prop of last.expression.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) members.push(prop.name.text)
      else if (ts.isPropertyAssignment(prop)) members.push(propertyKey(prop.name))
      else if (ts.isSpreadAssignment(prop)) {
        members.push('<spread>')
      }
    }
    out.push({ file: normalize(file), fn: stmt.name.text, members })
  }
  return out
}

interface SourceFile {
  rel: string
  code: string
}

function productionSources(): SourceFile[] {
  return listSources(SRC)
    .filter((f) => !/\.test\.ts$/.test(f) && !/\/__tests__\/|\/__mocks__\//.test(normalize(f)))
    .map((f) => {
      const raw = fs.readFileSync(f, 'utf8')
      return {
        rel: normalize(path.relative(SRC, f)),
        code: stripComments(/\.vue$/.test(f) ? scriptOf(raw) : raw),
      }
    })
}

function consumersOf(member: string, self: string, sources: SourceFile[]): string[] {
  const pattern = new RegExp(`\\b${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  return sources.filter((s) => s.rel !== self && pattern.test(s.code)).map((s) => s.rel)
}

/** 扫描面上的「返回面成员 × 消费点」不合规项 */
function offenders(surfaces: Surface[], sources: SourceFile[]): string[] {
  const problems: string[] = []
  for (const surface of surfaces) {
    const allowed = ALLOWED[surface.file] ?? []
    for (const member of surface.members) {
      if (member.startsWith('<')) continue
      if (allowed.includes(member)) continue
      if (consumersOf(member, surface.file, sources).length === 0) {
        problems.push(`${surface.file} :: ${surface.fn} -> ${member}`)
      }
    }
  }
  return problems
}

const HAND_WRITTEN_SAMPLE = [
  'export function useDemo(): { kept: () => void; orphan: () => void } {',
  '  function kept(): void {}',
  '  function orphan(): void {}',
  '  return { kept, orphan }',
  '}',
].join('\n')

const NEAR_MISS_SAMPLE = [
  '// export function useCommented(): { orphan: () => void } {',
  '//   return { orphan: () => {} }',
  '// }',
  'function useNotExported(): { orphan: () => void } {',
  '  return { orphan: () => {} }',
  '}',
  'export function useSpreadOnly(): { a: () => void } {',
  '  return { ...base }',
  '}',
].join('\n')

describe('composable 返回面单源（必要性审判波二·单元 Q）', () => {
  const sources = productionSources()
  const surfaces = listSources(SRC)
    .filter(
      (f) => /\/composables\/[^/]+\.ts$/.test(normalize(f)) && !/\/__tests__\//.test(normalize(f))
    )
    .flatMap((f) => returnSurface(fs.readFileSync(f, 'utf8'), normalize(path.relative(SRC, f))))

  it('返回面上没有零生产消费的成员（白名单外）', () => {
    expect(offenders(surfaces, sources)).toEqual([])
    // 兜空：扫不到源码或抽不到返回面时，本判据不得静默通过
    expect(sources.length).toBeGreaterThan(150)
    expect(surfaces.length).toBeGreaterThan(20)
  })

  it('白名单不得过期：每条登记的成员仍真实存在于返回面', () => {
    const stale: string[] = []
    for (const [file, members] of Object.entries(ALLOWED)) {
      const surface = surfaces.find((s) => s.file === file)
      for (const member of members) {
        if (!surface || !surface.members.includes(member)) stale.push(`${file} -> ${member}`)
      }
    }
    expect(stale).toEqual([])
  })

  it('本单元删掉的返回面成员没有被加回', () => {
    const back: string[] = []
    for (const [file, members] of Object.entries(GONE)) {
      const surface = surfaces.find((s) => s.file === file)
      if (!surface) {
        back.push(`${file} -> 返回面整块消失（应改成对象字面量以外的写法？请复核）`)
        continue
      }
      for (const member of members) {
        if (surface.members.includes(member)) back.push(`${file} -> ${member}`)
      }
    }
    expect(back).toEqual([])
  })

  it('🔴 @guard-red-sample 同形态样本：返回面上零消费的成员必报', () => {
    const sample = returnSurface(HAND_WRITTEN_SAMPLE, 'sample.ts')
    expect(sample).toHaveLength(1)
    expect(sample[0].members).toEqual(['kept', 'orphan'])
    const problems = offenders(sample, [
      { rel: 'consumer.ts', code: 'const api = useDemo()\napi.kept()' },
    ])
    expect(problems).toEqual(['sample.ts :: useDemo -> orphan'])
    // 阴性对照：给 orphan 补一个消费点 ⇒ 不再报
    expect(
      offenders(sample, [
        { rel: 'consumer.ts', code: 'const api = useDemo()\napi.kept()\napi.orphan()' },
      ])
    ).toEqual([])
    // 同义改写：{ ['orphan']: … } 与 { orphan: … } 同义，键归一化后仍须报
    const computed = [
      'export function useComputed(): Record<string, () => void> {',
      "  return { ['orphan']: () => {} }",
      '}',
    ].join('\n')
    expect(returnSurface(computed, 'computed.ts')[0].members).toEqual(['orphan'])
    expect(offenders(returnSurface(computed, 'computed.ts'), [])).toEqual([
      'computed.ts :: useComputed -> orphan',
    ])
    // 近失：注释掉的声明、非 export 的声明都不该被抽成返回面
    expect(returnSurface(NEAR_MISS_SAMPLE, 'near.ts')).toEqual([
      // 已知边界：`return { ...base }` 的成员静态不可见，只能记作 <spread>，
      // 判据不据此报红（报了也无从修）——但也不能静默当作「有消费」。
      { file: 'near.ts', fn: 'useSpreadOnly', members: ['<spread>'] },
    ])
  })
})
