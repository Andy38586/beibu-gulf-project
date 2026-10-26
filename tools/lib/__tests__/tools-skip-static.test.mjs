/**
 * tools/scripts 全量测试的静态跳过判据：`it.only` 与动态 `it[m]`。
 *
 * 为什么需要（台账 §149 自陈的盲区）：`check-tools-skips.mjs` 只看 vitest JSON 的
 * pending/todo；`it.only` 会让同文件其余用例**静默不跑**但不一定计入 pending，
 * `it[m](...)` 又把成员名藏进变量 ⇒ 运行时门禁都看不见。这里用 AST 补静态面。
 *
 * 只判两类（不重复运行时 skip 门禁）：
 *   · vitest 根（it/test/describe/suite + 别名/namespace）上的 `only`，含
 *     `it.only` / `it['only']` / `v.it.only` / 解构 `{ only }` / 别名 `const f = it.only`；
 *   · vitest 根/namespace 上的**动态**计算访问 `it[m]` / `v[n]`（非字符串字面量）。
 * 注释、字符串字面量、非 vitest 对象（foo.only）由 AST 天然排除。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const SELF = path.basename(fileURLToPath(import.meta.url))
const RED = '@guard-red-sample'
const ROOT_NAMES = new Set(['it', 'test', 'describe', 'suite'])
const FIXTURE = path.join(HERE, 'fixtures', 'skip-static.fixture.txt')

function collectTests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.local' || e.name === '__pycache__') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectTests(p, out)
    else if (e.name.endsWith('.test.mjs') && e.name !== SELF) out.push(p)
  }
  return out
}

const TEST_FILES = [path.join(ROOT, 'tools'), path.join(ROOT, 'scripts')].flatMap((d) =>
  collectTests(d)
)

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
}

function vitestContext(sf) {
  const aliases = new Map()
  const namespaces = new Set()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== 'vitest') continue
    const bindings = st.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text)
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text
        if (ROOT_NAMES.has(imported)) aliases.set(el.name.text, imported)
      }
    }
  }
  return { aliases, namespaces }
}

/** 表达式若指向 vitest 根（it/test/describe/suite），返回其逻辑名 */
function resolveRoot(node, ctx) {
  if (!node) return null
  if (ts.isIdentifier(node)) {
    if (ROOT_NAMES.has(node.text)) return node.text
    return ctx.aliases.get(node.text) ?? null
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ctx.namespaces.has(node.expression.text) &&
    ROOT_NAMES.has(node.name.text)
  ) {
    return node.name.text
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ctx.namespaces.has(node.expression.text) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    ROOT_NAMES.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text
  }
  return null
}

function isVitestContainer(node, ctx) {
  if (!node) return false
  return Boolean(resolveRoot(node, ctx)) || (ts.isIdentifier(node) && ctx.namespaces.has(node.text))
}

/** 成员访问：返回 { root, member, dynamic }；不是 vitest 容器则 null */
function memberInfo(expr, ctx) {
  if (ts.isPropertyAccessExpression(expr)) {
    const root = resolveRoot(expr.expression, ctx)
    return root ? { root, member: expr.name.text, dynamic: false } : null
  }
  if (ts.isElementAccessExpression(expr)) {
    const root = resolveRoot(expr.expression, ctx)
    if (root) {
      if (ts.isStringLiteralLike(expr.argumentExpression)) {
        return { root, member: expr.argumentExpression.text, dynamic: false }
      }
      return { root, member: null, dynamic: true }
    }
    if (isVitestContainer(expr.expression, ctx)) {
      // v['it'] / v['describe'] 是「命名空间取根」，不是被禁成员；只有非字面量才无法判定
      if (ts.isStringLiteralLike(expr.argumentExpression)) return null
      return { root: null, member: null, dynamic: true }
    }
  }
  return null
}

function findBlindSpots(fileName, text) {
  const sf = parse(fileName, text)
  const ctx = vitestContext(sf)
  const hits = []
  const add = (node, kind) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    hits.push({ line: line + 1, kind, text: node.getText(sf).slice(0, 80) })
  }
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const info = memberInfo(node, ctx)
      if (info && (info.dynamic || info.member === 'only'))
        add(node, info.dynamic ? 'dynamic' : 'only')
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      if (isVitestContainer(node.initializer, ctx)) {
        for (const el of node.name.elements) {
          if (el.dotDotDotToken) continue
          const prop = el.propertyName ?? el.name
          if (ts.isComputedPropertyName(prop)) {
            const expr = prop.expression
            if (!ts.isStringLiteralLike(expr)) add(el, 'dynamic')
            else if (expr.text === 'only') add(el, 'only')
          } else if (ts.isIdentifier(prop) && prop.text === 'only') {
            add(el, 'only')
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('tools/scripts 静态跳过判据（only / 动态成员）', () => {
  it(`🔴 ${RED} 入库夹具：only / 动态成员 / 解构 / 别名全部命中`, () => {
    const hits = findBlindSpots(FIXTURE, fs.readFileSync(FIXTURE, 'utf8'))
    expect(hits.filter((h) => h.kind === 'only')).toHaveLength(6)
    expect(hits.filter((h) => h.kind === 'dynamic')).toHaveLength(2)
  })

  it(`🔴 ${RED} 真实 tools/scripts 测试零 only、零动态成员`, () => {
    expect(TEST_FILES.length, '扫描面为空 ⇒ 根路径写错').toBeGreaterThan(50)
    const offenders = TEST_FILES.flatMap((file) =>
      findBlindSpots(file, fs.readFileSync(file, 'utf8')).map(
        (h) =>
          `${path.relative(ROOT, file).split(path.sep).join('/')}:${h.line} [${h.kind}] ${h.text}`
      )
    )
    expect(offenders).toEqual([])
  })

  it('阴性对照：注释 / 字符串 / 非 vitest 对象 / it.each / skipIf 不误红', () => {
    const sample = [
      '// 说明：不要写 it.only( 或 it[m]( 把用例藏起来',
      'const s = "it.only("',
      'const t = `it[m](`',
      'foo.only("x", () => {})',
      'it.each([1, 2])("x", () => {})',
      "it['each']([3])('y', () => {})",
      'it.skipIf(true)("z", () => {})',
    ].join('\n')
    expect(findBlindSpots('negative.mjs', sample)).toEqual([])
  })
})
