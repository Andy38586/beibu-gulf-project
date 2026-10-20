/**
 * 契约字段比对的判据测试（专项3 指标 7.6「DTO ↔ 前端 zod 契约双源漂移」）。
 *
 * 为什么不放在 frontend/：被测对象是 `scripts/lib/contract-fields.cjs`——仓库根脚本，
 * 不属于前端应用。`tools/*.test.mjs` 已有先例（`tools/test-watchdog.test.mjs`、
 * `tools/data-sync-inputs.test.mjs` 都在这个位置测 scripts/ 下的 CJS），故跟随既有落点。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {
  tsTypeFields,
  compareFields,
  backendContractOf,
  annotationProblems,
} = require('../scripts/lib/contract-fields.cjs')

/** 造一份「注解 + schema 声明」的合成片段 */
function annotate(commentLines) {
  const src = `${commentLines.join('\n')}\nexport const xSchema = z.object({})\n`
  return { src, declIndex: src.indexOf('export const xSchema') }
}

describe('tsTypeFields：后端类型字段与可选性', () => {
  it('抽出顶层字段与可选性（`?` 与 `| undefined` 两种记法都算选填）', () => {
    const src = `export interface Foo {
  a: string
  b?: number
  c: string | undefined
}`
    expect(tsTypeFields(src, 'Foo')).toEqual({
      a: { optional: false },
      b: { optional: true },
      c: { optional: true },
    })
  })

  it('type 别名与 interface 同待，嵌套对象里的字段不混进本层', () => {
    const src = `export type Bar = {
  id: number
  nested: { inner: string; other: boolean }
  list: Array<{ inArray: number }>
}`
    expect(Object.keys(tsTypeFields(src, 'Bar'))).toEqual(['id', 'nested', 'list'])
  })

  it('同文件 extends 合并父字段（DiversionYearResult extends DiversionBreakdown 的形状）', () => {
    const src = `interface Base { x: number; y?: string }
interface Child extends Base { z: boolean }`
    expect(tsTypeFields(src, 'Child')).toEqual({
      x: { optional: false },
      y: { optional: true },
      z: { optional: false },
    })
  })

  it('🟥 红样：extends 的父类型在别的文件时，父字段缺失必须被 compareFields 看见', () => {
    // W44 实测：DiversionYearResult 的父 DiversionBreakdown 在 common/diversion.ts，
    // 只能解析到子自己的字段。这不是缺陷而是边界——compareFields 必须如实报差异，
    // 不得因为「少解析到字段」就静默认为一致。
    const childOnly = tsTypeFields('interface Child extends Elsewhere { z: boolean }', 'Child')
    expect(childOnly).toEqual({ z: { optional: false } })
    const drift = compareFields({ z: { optional: false }, missing: { optional: false } }, childOnly)
    expect(drift).toEqual([{ field: 'missing', issue: 'zod-only' }])
  })

  it('解析不到类型名返回 null（不是空对象——空对象会被当成「字段全删了」）', () => {
    expect(tsTypeFields('interface Foo { a: string }', 'Nope')).toBeNull()
  })

  it('循环 extends 不死循环', () => {
    const src = `interface A extends B { a: number }
interface B extends A { b: number }`
    expect(() => tsTypeFields(src, 'A')).not.toThrow()
  })
})

describe('compareFields：双向报漂移', () => {
  it('一致时返回空数组', () => {
    const f = { a: { optional: false } }
    expect(compareFields(f, { a: { optional: false } })).toEqual([])
  })

  it('🟥 红样：字段名一字未改、只把必填改成选填，也必须报（指标 7.6 此前完全没判据的那一半）', () => {
    // 断 issue 与两侧可选标志，不断文案：文案是等价可改的，钉措辞会让同义改写误红
    // （AGENTS §5.3 第三式）。
    expect(compareFields({ a: { optional: true } }, { a: { optional: false } })).toEqual([
      { field: 'a', issue: 'optionality', zodOptional: true, tsOptional: false },
    ])
  })

  it('两个方向都报：zod 多字段、后端多字段各一条，issue 可区分', () => {
    const drift = compareFields({ zodOnly: { optional: false } }, { tsOnly: { optional: false } })
    expect(drift).toEqual([
      { field: 'zodOnly', issue: 'zod-only' },
      { field: 'tsOnly', issue: 'ts-only' },
    ])
  })

  it('两侧同名字段且可选性一致 ⇒ 不报（避免把「都对」当成漂移）', () => {
    expect(
      compareFields(
        { a: { optional: true }, b: { optional: false } },
        {
          a: { optional: true },
          b: { optional: false },
        }
      )
    ).toEqual([])
  })
})

describe('backendContractOf：注解解析', () => {
  it('取路径 + 可选类型名', () => {
    const { src, declIndex } = annotate(['// @backend-contract backend/x.ts Foo'])
    expect(backendContractOf(src, declIndex)).toEqual({
      file: 'backend/x.ts',
      type: 'Foo',
      noType: null,
    })
  })

  it('允许穿过注释块里的空行', () => {
    const { src, declIndex } = annotate(['// 说明一', '// @backend-contract backend/x.ts'])
    expect(backendContractOf(src, declIndex).file).toBe('backend/x.ts')
  })

  it('遇到代码即停：注解必须紧贴声明注释块，隔一段代码的注解不算', () => {
    const src = `// @backend-contract backend/x.ts
const other = 1
export const xSchema = z.object({})
`
    expect(backendContractOf(src, src.indexOf('export const xSchema'))).toBeNull()
  })

  it('无注解返回 null（不是空对象）', () => {
    const src = `// 普通注释\nexport const xSchema = z.object({})\n`
    expect(backendContractOf(src, src.indexOf('export const xSchema'))).toBeNull()
  })

  it('@backend-contract-no-type 的理由被取出（只打标记不写理由 = 没声明）', () => {
    const { src, declIndex } = annotate([
      '// @backend-contract backend/x.ts',
      '// @backend-contract-no-type 返回 Promise<unknown>',
    ])
    expect(backendContractOf(src, declIndex).noType).toBe('返回 Promise<unknown>')
  })
})

describe('annotationProblems：缺类型名不得静默降级', () => {
  it('有类型名 ⇒ 无问题', () => {
    const { src, declIndex } = annotate(['// @backend-contract backend/x.ts Foo'])
    expect(annotationProblems('x', backendContractOf(src, declIndex))).toEqual([])
  })

  it('有理由声明 ⇒ 无问题', () => {
    const { src, declIndex } = annotate([
      '// @backend-contract backend/x.ts',
      '// @backend-contract-no-type 返回 Promise<unknown>',
    ])
    expect(annotationProblems('x', backendContractOf(src, declIndex))).toEqual([])
  })

  it('🟥 红样：只有路径没类型名 ⇒ 报错并点名该 schema', () => {
    const { src, declIndex } = annotate(['// @backend-contract backend/x.ts'])
    const problems = annotationProblems('x', backendContractOf(src, declIndex))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('x')
    expect(problems[0]).toContain('@backend-contract-no-type')
  })

  it('🟥 红样：只打 @backend-contract-no-type 却不写理由 ⇒ 仍报错（空声明等于没声明）', () => {
    const { src, declIndex } = annotate([
      '// @backend-contract backend/x.ts',
      '// @backend-contract-no-type',
    ])
    expect(annotationProblems('x', backendContractOf(src, declIndex))).toHaveLength(1)
  })

  it('无注解 ⇒ 不参与核对，不报问题', () => {
    expect(annotationProblems('x', null)).toEqual([])
  })
})

describe('真实 schemas.ts：注解面必须是可解释的两种状态之一', () => {
  const schemasText = fs.readFileSync(path.join(ROOT, 'frontend/src/types/schemas.ts'), 'utf8')

  it('每条 @backend-contract 要么带后端类型名、要么带无类型声明（不允许降级沉默）', () => {
    const problems = []
    for (const m of schemasText.matchAll(/export const (\w+Schema) = /g)) {
      const ann = backendContractOf(schemasText, m.index)
      if (!ann) continue
      problems.push(...annotationProblems(m[1], ann))
    }
    expect(problems).toEqual([])
  })

  it('🟥 红样：至少有一条真做了类型级配对（不是全写「无可配对类型」蒙过去）', () => {
    // 反面对照：若所有注解都写 @backend-contract-no-type，上一条用例照样全绿，
    // 而字段集合/可选性仍然零判据。这条钉住「必须真有人被逐字段核对」。
    const paired = [...schemasText.matchAll(/^\/\/ @backend-contract \S+ (\w+)\s*$/gm)].map(
      (m) => m[1]
    )
    expect(paired.length).toBeGreaterThan(0)
  })
})

/**
 * 端到端：在临时仓库里真跑 `scripts/gen-api-contract.cjs`。
 *
 * 为什么必须有这一段：上面所有用例都直接嗂 lib 函数，于是「函数没问题、但 gen 里
 * 根本没调它」这种缺口完全测不到——W44 首轮变异四式里 M2/M2b/M4d 三条
 * （停用 gen 的类型级比对 / 停用 annotationProblems 调用 / 键位正则丢 `?`）
 * 全是 green，产出的是一份「判据函数很齐全、接线一根未接」的假绿。
 * 端到端跑真实脚本才能把接线钉住。
 */
describe('端到端：gen-api-contract.cjs 的接线', () => {
  const TMP_ROOTS = []

  /** 造最小仓库：schemas.ts + 一个被注解指向的后端文件 + 空测试文件 */
  function makeRepo({ schemas, backend }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w44-e2e-'))
    TMP_ROOTS.push(root)
    // gen 脚本用 __dirname/.. 反推仓库根，所以脚本也必须抄进临时根才能换根
    for (const rel of ['scripts/gen-api-contract.cjs', 'scripts/lib/contract-fields.cjs']) {
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(ROOT, rel), dest)
    }
    fs.mkdirSync(path.join(root, 'frontend/src/types/__tests__'), { recursive: true })
    fs.writeFileSync(path.join(root, 'frontend/src/types/schemas.ts'), schemas)
    fs.writeFileSync(
      path.join(root, 'frontend/src/types/__tests__/schemas.test.ts'),
      '// 夹具：引用了下面所有 schema\n' + schemas.match(/\w+Schema/g).join(' ')
    )
    for (const [rel, text] of Object.entries(backend)) {
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, text)
    }
    return root
  }

  function runGen(root) {
    try {
      const out = execFileSync(
        process.execPath,
        [path.join(root, 'scripts/gen-api-contract.cjs')],
        {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        }
      )
      return { code: 0, output: out }
    } catch (e) {
      return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  afterAll(() => {
    for (const root of TMP_ROOTS) fs.rmSync(root, { recursive: true, force: true })
  })

  const BACKEND_OK = `export interface Foo {
  name: string
  count?: number
}
`
  const SCHEMA_PAIR_OK = `import { z } from 'zod'
// @backend-contract backend/x.ts Foo
export const fooSchema = z.object({ name: z.string(), count: z.number().optional() })
export type FooParsed = z.infer<typeof fooSchema>
`

  it('接线正路：注解带类型名且两侧一致 ⇒ exit 0 且快照里有 optionality', () => {
    const root = makeRepo({ schemas: SCHEMA_PAIR_OK, backend: { 'backend/x.ts': BACKEND_OK } })
    const r = runGen(root)
    expect(r.code).toBe(0)
    const snap = JSON.parse(
      fs.readFileSync(path.join(root, 'frontend/src/types/generated/api-contract.json'), 'utf8')
    )
    expect(snap.backendContracts.fooSchema.optionality).toEqual({ type: 'Foo', drift: [] })
  })

  it('🟥 端到端红样：zod 比后端多一个字段 ⇒ exit 1 且点名该字段', () => {
    const root = makeRepo({
      schemas: SCHEMA_PAIR_OK.replace(
        'count: z.number().optional()',
        'count: z.number().optional(), extra: z.string()'
      ),
      backend: { 'backend/x.ts': BACKEND_OK },
    })
    const r = runGen(root)
    expect(r.code).toBe(1)
    expect(r.output).toContain('extra')
    expect(r.output).toContain('7.6')
  })

  it('🟥 端到端红样：字段名全对但可选性不同（必需 — MUST）⇒ exit 1', () => {
    const root = makeRepo({
      schemas: SCHEMA_PAIR_OK.replace('count: z.number().optional()', 'count: z.number()'),
      backend: { 'backend/x.ts': BACKEND_OK },
    })
    const r = runGen(root)
    expect(r.code).toBe(1)
    expect(r.output).toContain('count')
  })

  it('🟥 端到端红样：注解只有路径没类型名 ⇒ exit 1（不允许降级静默）', () => {
    const root = makeRepo({
      schemas: SCHEMA_PAIR_OK.replace(
        '// @backend-contract backend/x.ts Foo',
        '// @backend-contract backend/x.ts'
      ),
      backend: { 'backend/x.ts': BACKEND_OK },
    })
    const r = runGen(root)
    expect(r.code).toBe(1)
    expect(r.output).toContain('@backend-contract-no-type')
  })

  it('🟥 端到端红样：注解声明的类型在后端文件里不存在 ⇒ exit 1', () => {
    const root = makeRepo({
      schemas: SCHEMA_PAIR_OK.replace('backend/x.ts Foo', 'backend/x.ts NoSuchType'),
      backend: { 'backend/x.ts': BACKEND_OK },
    })
    const r = runGen(root)
    expect(r.code).toBe(1)
    expect(r.output).toContain('NoSuchType')
  })

  it('🟥 端到端红样：后端只剩可选字段、`?` 标记不被认 ⇒ 误报 0 次键位', () => {
    // 这条钉住键位正则必须带 `\??`：不认可选标记时 `count?: number` 一律 0 次，
    // 真实的「可选字段」会被误报成「后端删了字段」。
    const root = makeRepo({
      schemas: SCHEMA_PAIR_OK,
      backend: { 'backend/x.ts': `export interface Foo {\n  name: string\n  count?: number\n}\n` },
    })
    const r = runGen(root)
    expect(r.code).toBe(0)
  })
})
