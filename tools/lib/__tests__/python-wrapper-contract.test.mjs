/**
 * Python 包装器契约（AST 版，2026-10-26 P1-2）：pytest 包装器**不得**把判据静默跳过。
 *
 * ## 为什么从文本正则改成 AST
 * 旧判据 `/\.skipIf\s*\(|\bit\.skip\s*\(/` 直接匹配源码文本，实测两向都错：
 *   · 假红：注释里写「不要用 it.skip(」即命中（cb-p12-red.txt 样本 A）；
 *   · 假绿：`describe.skip(` / `test.skip(` 不在正则内；文件名不含 `python` 的包装器
 *     根本不在扫描面（样本 C/D）。
 * AST 解析天然不看注释与字符串；扫描面改由**内容**（import py-runner 或调
 * definePytestCase）派生，不再依赖文件名。
 *
 * ## 覆盖
 * 根：`it` / `test` / `describe` / `suite`，含 vitest 别名（`it as t`）与命名空间
 * （`import * as v` → `v.it.skip`、`v['it'].skip`）。
 * 成员：`skipIf` / `skip` / `todo` / `only` / `fails`（后两者同属「静默少跑」）。
 *
 * ## 未覆盖（明示，不假装覆盖）
 * · 动态取值（`obj[name](...)`、`const m = 'skip'; it[m](...)`）——静态 AST 无法判定，
 *   属刻意接受的残余；出现即由人审。
 * · 非 vitest 全局（如自建 wrapper 里的 `ctx.skip()`）—— 只认 vitest 命名，避免误伤。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const TOOLS = path.join(ROOT, 'tools')
const SELF = path.basename(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')

const SKIP_MEMBERS = new Set(['skipIf', 'skip', 'todo', 'only', 'fails'])
const DEFAULT_ROOTS = new Set(['it', 'test', 'describe', 'suite'])
/** 标记「该用例是红样」，与 tools/v3-guard/guard-red-sample.mjs 同一约定 */
const RED = '@guard-red-sample'

/** tools 下**所有** *.test.mjs（不含本文件）——先收全，再按内容过滤 */
function collectTestFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectTestFiles(p, out)
    else if (p.endsWith('.test.mjs') && !p.endsWith(SELF)) out.push(p)
  }
  return out
}

const isWrapper = (text) => text.includes('py-runner') || text.includes('definePytestCase(')

/** 扫描集由内容派生：不看文件名 */
function collectWrappers() {
  return collectTestFiles(TOOLS)
    .map((p) => ({ file: p, text: fs.readFileSync(p, 'utf8') }))
    .filter(({ text }) => isWrapper(text))
}

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
}

/** vitest import 的本地名 → 逻辑根（it/test/describe/suite） */
function vitestRoots(sf) {
  const aliases = new Map()
  const namespaces = new Set()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== 'vitest') continue
    const bindings = st.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text)
      continue
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text
        if (DEFAULT_ROOTS.has(imported)) aliases.set(el.name.text, imported)
      }
    }
  }
  return { aliases, namespaces }
}

/** `x.skip(` / `x['skip'](` 的成员名；不是该形状则 null */
function memberOf(expr) {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
    return expr.argumentExpression.text
  }
  return null
}

/** 被调用者是否「vitest 根」：it / 别名 t / 命名空间 v.it 或 v['it'] */
function isVitestRoot(node, { aliases, namespaces }) {
  if (ts.isIdentifier(node)) return DEFAULT_ROOTS.has(node.text) || aliases.has(node.text)
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return namespaces.has(node.expression.text) && DEFAULT_ROOTS.has(node.name.text)
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return namespaces.has(node.expression.text) && DEFAULT_ROOTS.has(node.argumentExpression.text)
  }
  return false
}

/**
 * 返回违规位置 [{line, text}]。
 *
 * `it.skipIf(cond)('title', fn)` 的形状是外层 CallExpression(内层 CallExpression(it.skipIf, cond), title)，
 * 内层调用本身就是一个 CallExpression 且成员是 skipIf ⇒ 在那个节点上记一次，外层不重复记。
 */
export function findSkipCalls(fileName, text) {
  const sf = parse(fileName, text)
  const ctx = vitestRoots(sf)
  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const member = memberOf(node.expression)
      if (member && SKIP_MEMBERS.has(member) && isVitestRoot(node.expression.expression, ctx)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        hits.push({ line: line + 1, text: node.getText(sf).slice(0, 60) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** definePytestCase 调用次数（正样本计数，防「扫到空即绿」） */
function countDefinePytestCase(text) {
  const sf = parse('count.mjs', text)
  let n = 0
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'definePytestCase'
    ) {
      n++
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

/** tools 下所有 `test_*.py` 的绝对路径 */
function collectPyTests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectPyTests(p, out)
    else if (/^test_.*\.py$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 从 AST 取 `definePytestCase(title, files, …)` **第二个参数**里的字符串字面量。
 * 不靠文件名猜测、不靠正则扫文本：数组元素逐个取字面量，单字符串形态也接受。
 */
function referencedPyFiles(text) {
  const sf = parse('files.mjs', text)
  const out = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'definePytestCase'
    ) {
      const arg = node.arguments[1]
      const push = (n) => {
        if (ts.isStringLiteralLike(n)) out.push(n.text)
      }
      if (arg && ts.isArrayLiteralExpression(arg)) arg.elements.forEach(push)
      else if (arg) push(arg)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 标题字符串：definePytestCase 第一参 / it|test|describe|suite 第一参（含别名与命名空间） */
function titleLiterals(text) {
  const sf = parse('titles.mjs', text)
  const ctx = vitestRoots(sf)
  const out = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isTitleCall =
        (ts.isIdentifier(callee) &&
          (callee.text === 'definePytestCase' || isVitestRoot(callee, ctx))) ||
        ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
          isVitestRoot(callee.expression, ctx))
      const arg = node.arguments[0]
      if (isTitleCall && arg && ts.isStringLiteralLike(arg)) out.push(arg.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('Python pytest 包装器契约（AST）', () => {
  it('扫描面由内容派生且非空：≥11 个包装器，每个至少 1 次 definePytestCase', () => {
    const wrappers = collectWrappers()
    expect(wrappers.length).toBeGreaterThanOrEqual(11)
    for (const { file, text } of wrappers) {
      expect(
        countDefinePytestCase(text),
        `${path.relative(ROOT, file)} 缺 definePytestCase`
      ).toBeGreaterThan(0)
    }
  })

  it(`🔴 ${RED} 每个 tools/**/test_*.py 都必须被某个包装器引用（AST 取第二参）`, () => {
    const onDisk = collectPyTests(TOOLS)
      .map((p) => path.basename(p))
      .sort()
    const referenced = [
      ...new Set(
        collectWrappers().flatMap(({ text }) =>
          referencedPyFiles(text).map((f) => path.basename(f))
        )
      ),
    ].sort()
    // 反例形态：从某包装器的 files 数组里删掉一个文件名 ⇒ 集合差 1 ⇒ 本断言红
    expect(
      referenced,
      `磁盘有 ${onDisk.length} 个 py 测试，被引用 ${referenced.length} 个：` +
        `未被引用 = ${onDisk.filter((f) => !referenced.includes(f)).join(', ') || '无'}`
    ).toEqual(onDisk)
  })

  it(`🔴 ${RED} 标题不得写死「pytest N 例」（数字会随用例增删漂移）`, () => {
    const bad = collectWrappers().flatMap(({ file, text }) =>
      titleLiterals(text)
        .filter((t) => /pytest\s*\d+\s*例/.test(t))
        .map((t) => `${path.relative(ROOT, file)}: ${t}`)
    )
    expect(bad).toEqual([])
  })

  it(`🔴 ${RED} 真实包装器零 skip：命中即红（describe.skip 也算）`, () => {
    const offenders = collectWrappers().flatMap(({ file, text }) =>
      findSkipCalls(file, text).map((h) => `${path.relative(ROOT, file)}:${h.line} ${h.text}`)
    )
    expect(offenders).toEqual([])
  })

  it(`🔴 ${RED} 入库夹具：describe.skip 包住 definePytestCase ⇒ 必命中`, () => {
    const file = path.join(FIXTURES, 'skip-wrapper.fixture.txt')
    const hits = findSkipCalls(file, fs.readFileSync(file, 'utf8'))
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].text).toContain('describe.skip')
  })

  it('阴性对照：仅注释里出现 it.skip( ⇒ 命中 0（旧文本判据在此假红）', () => {
    const sample = [
      '// 说明：不要用 it.skip( 或 it.skipIf( 把判据变成静默跳过',
      'import { describe, it } from "vitest"',
      'describe("ok", () => { it("passes", () => {}) })',
    ].join('\n')
    expect(findSkipCalls('comment-only.mjs', sample)).toEqual([])
  })

  it(`🔴 ${RED} 别名（it as t）+ 命名空间（import * as v）覆盖`, () => {
    const aliasSample = ['import { it as t } from "vitest"', 't.skipIf(true)("x", () => {})'].join(
      '\n'
    )
    expect(findSkipCalls('alias.mjs', aliasSample)).toHaveLength(1)

    const nsSample = [
      'import * as v from "vitest"',
      'v.it.skip("x", () => {})',
      'v["describe"].skipIf(true)("y", () => {})',
      "v['it'].skip('z', () => {})",
    ].join('\n')
    expect(findSkipCalls('ns.mjs', nsSample)).toHaveLength(3)
  })

  it(`🔴 ${RED} 成员面：only / todo / fails / describe.only 全部命中（缺一项即红）`, () => {
    const sample = [
      'import { describe, it } from "vitest"',
      'it.only("a", () => {})',
      'it.todo("b")',
      'it.fails("c", () => {})',
      'describe.only("d", () => {})',
    ].join('\n')
    expect(findSkipCalls('members.mjs', sample)).toHaveLength(4)
  })

  it('阴性对照：字符串字面量里的 it.skip( 不算（非调用节点）', () => {
    const sample = ['const s = "it.skip(1)"', 'const t = `describe.skip(`'].join('\n')
    expect(findSkipCalls('strings.mjs', sample)).toEqual([])
  })
})
