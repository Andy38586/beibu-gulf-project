// @vitest-environment node
// 必要性审判波二·单元 N：Pinia store 的 return 面只能暴露「有外部消费」的成员。
//
// 三个 store 各有一份只为内部调用而生的成员（floodStore 的 resetWaterLevel /
// resetPortImpact、forecastStore 的 clearChart、siteSuitabilityStore 的
// applyDefaults）——它们只被同文件的另一个 action 调用，却被放进 defineStore 的
// return 对象，成了对外公开的 store API。消费点内联回调用方后，本判据保证
// 「内部辅助函数不得再被暴露」：扫 5 个 store 的 return 对象字面量，任何成员名
// 在 frontend/src 的其它生产件里 0 命中即报红。
//
// 判据域：frontend/src 的全部 .ts/.vue（排除 __tests__ 与 SKIP 目录）。
// 只认「成员名在 store 之外被引用」，不区分「只被测试引用」——那类成员
// （waterLevelActive / defaultsSource / findLayerEntryIndex 等）有显式豁免表。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|dist|\.local)$/

const STORES = ['floodStore', 'forecastStore', 'mapStore', 'siteSuitabilityStore', 'taskStore']

/** 仅测试引用的成员：判据不咬（每条都要说得出为什么它必须对外可见） */
const TEST_ONLY_ALLOWED: Record<string, string[]> = {
  floodStore: ['waterLevelActive', 'portImpactActive', 'hasAnalysisData'],
  forecastStore: [],
  mapStore: ['findLayerEntryIndex'],
  siteSuitabilityStore: ['defaultsSource'],
  taskStore: [],
}

interface SourceFile {
  rel: string
  abs: string
  text: string
}

function listSources(dir: string, root: string, acc: SourceFile[] = []): SourceFile[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.test(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listSources(abs, root, acc)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      acc.push({
        rel: path.relative(root, abs).split(path.sep).join('/'),
        abs,
        text: fs.readFileSync(abs, 'utf8'),
      })
    }
  }
  return acc
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 属性键归一化：`{ x: 1 }` / `{ ['x']: 1 }` / `{ 'x': 1 }` 都还原成 x */
export function propertyKey(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
    return expr.getText()
  }
  return name.getText()
}

/** defineStore 的 setup 函数里，最后一个 return 语句的对象字面量成员名 */
export function returnedMembers(text: string): string[] {
  const sf = parse(text)
  const found: string[][] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineStore'
    ) {
      const setup = node.arguments[1]
      if (setup && (ts.isArrowFunction(setup) || ts.isFunctionExpression(setup))) {
        const names: string[] = []
        const collect = (n: ts.Node): void => {
          if (
            ts.isReturnStatement(n) &&
            n.expression &&
            ts.isObjectLiteralExpression(n.expression)
          ) {
            for (const prop of n.expression.properties) {
              if (ts.isShorthandPropertyAssignment(prop)) names.push(prop.name.text)
              else if (ts.isPropertyAssignment(prop)) names.push(propertyKey(prop.name))
            }
          }
          ts.forEachChild(n, collect)
        }
        collect(setup.body)
        if (names.length > 0) found.push(names)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found.length > 0 ? found[found.length - 1] : []
}

const SOURCES = listSources(SRC, SRC)
const STORE_SOURCES = new Map(
  STORES.map((name) => {
    const rel = 'stores/' + name + '.ts'
    const hit = SOURCES.find((s) => s.rel === rel || s.rel.endsWith('/' + rel))
    if (!hit) throw new Error('store 源件缺失：' + rel)
    return [name, hit]
  })
)

function externalUsers(member: string, selfRel: string): string[] {
  const word = new RegExp('\\b' + member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
  return SOURCES.filter((s) => s.rel !== selfRel && word.test(s.text)).map((s) => s.rel)
}

describe('store return 面（必要性审判波二·单元 N）', () => {
  it('🔴 @guard-red-sample 内部辅助函数被 expose ⇒ 必报', () => {
    // 阳性对照：一个只被内部调用却出现在 return 里的成员，必须被判出来
    const sample = `import { defineStore } from 'pinia'
const useDemo = defineStore('demo', () => {
  const count = ref(0)
  function bumpInternal(): void { count.value += 1 }
  function bump(): void { bumpInternal() }
  return { count, bump, bumpInternal }
})`
    expect(returnedMembers(sample)).toContain('bumpInternal')
    const users = externalUsers('bumpInternal', 'stores/demo.ts')
    expect(users).toEqual([])
  })

  it('5 个 store 的 return 面：每个成员都有 store 之外的生产消费（或豁免）', () => {
    const offenders: string[] = []
    let scannedMembers = 0
    let scannedFiles = 0
    for (const name of STORES) {
      const source = STORE_SOURCES.get(name)!
      const members = returnedMembers(source.text)
      expect(members.length).toBeGreaterThan(5)
      scannedMembers += members.length
      const allowed = TEST_ONLY_ALLOWED[name] ?? []
      for (const member of members) {
        if (allowed.includes(member)) continue
        const users = externalUsers(member, source.rel)
        if (users.length === 0) offenders.push(name + '.' + member)
        scannedFiles += users.length
      }
    }
    expect(offenders).toEqual([])
    // 兜空：分母必须实打实扫过（5 store / 数十个成员 / 数百个消费点）
    expect(STORES).toHaveLength(5)
    expect(scannedMembers).toBeGreaterThan(60)
    expect(scannedFiles).toBeGreaterThan(100)
  })

  it('豁免表不得过期：登记为「仅测试引用」的成员必须真的只被测试引用', () => {
    const stale: string[] = []
    for (const [name, allowed] of Object.entries(TEST_ONLY_ALLOWED)) {
      const source = STORE_SOURCES.get(name)!
      for (const member of allowed) {
        const users = externalUsers(member, source.rel)
        const prod = users.filter((rel) => !rel.includes('__tests__'))
        if (prod.length > 0) stale.push(name + '.' + member + ' → ' + prod.join(','))
      }
    }
    expect(stale).toEqual([])
  })

  it('已内联的四名内部辅助函数不得重新出现在 return 面', () => {
    const GONE = ['resetWaterLevel', 'resetPortImpact', 'clearChart', 'applyDefaults']
    const present: string[] = []
    for (const name of STORES) {
      const members = returnedMembers(STORE_SOURCES.get(name)!.text)
      for (const member of GONE) if (members.includes(member)) present.push(name + '.' + member)
    }
    expect(present).toEqual([])
  })

  /**
   * 上面第四条只管「内联后不得复活」；本条的族不同：成员是**零消费的对外动作**，
   * 结局是删，而且删了之后不会有任何消费点报错——不钉住就会在下次重构里被顺手写回。
   * taskStore.dismiss 2026-10-20 删（D31）：TaskDock 只 emit open、无关闭按钮，
   * 全仓唯一调用在它自己的测试里，属「自证式导出」。
   */
  it('已删的零消费对外动作不得重回 return 面', () => {
    // 阳性对照：探针形态必须先被认出来，否则下面的空集可能只是「扫不到」
    const sample = `import { defineStore } from 'pinia'
const useDemo = defineStore('demo', () => {
  return { dismiss: () => {} }
})`
    expect(returnedMembers(sample)).toContain('dismiss')

    const DELETED = ['dismiss']
    const present: string[] = []
    for (const name of STORES) {
      const members = returnedMembers(STORE_SOURCES.get(name)!.text)
      for (const member of DELETED) if (members.includes(member)) present.push(name + '.' + member)
    }
    expect(present).toEqual([])
  })
})
