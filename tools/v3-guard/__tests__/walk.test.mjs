/**
 * walk.mjs 契约：守卫族**唯一**目录遍历实现的扫描面。
 *
 * 为什么要有这份测试：9 处本地 walker 收进 lib/walk.mjs 之后，重复没了，但
 * **扫描面本身没有承重测试**——只有各守卫自己的用例间接走到。于是一旦默认跳过集
 * 多一项（例如有人顺手把 `__tests__` 加进去），受影响的 10 个调用点会一起少扫，
 * 而每个守卫的用例都只断言「命中样例」，少扫的目录恰好不在样例里 ⇒ 全绿。
 *
 * 本文件钉三件事：
 *   ① 默认跳过集只跳「不可能有受判目标」的目录，**不替调用点做业务裁决**；
 *   ② 调用点的 `skip` / `skipEntry` / `maxDepth` 真的生效（每处原过滤条件的落点）；
 *   ③ 正样本计数（不是「没报错就算过」）——空集必须是可被调用方识别的空集，
 *      而不是「扫了个空目录也报 OK」。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'

import { DEFAULT_SKIP_DIRS, walkFiles } from '../lib/walk.mjs'

/** 红样标记（与 tools/v3-guard/guard-red-sample.mjs 同一约定） */
const RED_MARK = '@guard-red-sample'

const TMP_ROOTS = []
afterAll(() => {
  for (const root of TMP_ROOTS) fs.rmSync(root, { recursive: true, force: true })
})

/** 造一棵固定夹具树；返回根。`null` 值表示建目录（无文件）。 */
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-contract-'))
  TMP_ROOTS.push(root)
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, rel)
    if (content === null) {
      fs.mkdirSync(abs, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return root
}

const isTs = (name) => name.endsWith('.ts')
const rel = (root, o = {}) => walkFiles(root, { match: isTs, ...o }).sort()

/**
 * 标准夹具：
 *   a.ts / nested/b.ts / nested/deep/c.ts      —— 应被扫到的正样本
 *   __tests__/h.ts                             —— 默认**不跳**（由调用点决定）
 *   node_modules/dep/index.ts / dist/e.ts
 *   coverage/g.ts / .local/f.ts                —— 默认跳过
 *   only.txt                                   —— 不匹配扩展名
 */
const FIXTURE = {
  'a.ts': 'export const a = 1\n',
  'nested/b.ts': 'export const b = 2\n',
  'nested/deep/c.ts': 'export const c = 3\n',
  '__tests__/h.ts': 'export const h = 4\n',
  'node_modules/dep/index.ts': 'export const dep = 0\n',
  'dist/e.ts': 'export const e = 0\n',
  'coverage/g.ts': 'export const g = 0\n',
  '.local/f.ts': 'export const f = 0\n',
  'only.txt': 'not typescript\n',
}

describe('walkFiles：扫描面', () => {
  it('正样本逐条命中，默认集跳过依赖/产物/本机工作区', () => {
    const files = rel(fixture(FIXTURE))
    // 计数先钉住：若哪天 walker 退化成「返回空数组」，这条立刻红（不是循环体零次执行）
    expect(files).toHaveLength(4)
    expect(files).toEqual(['__tests__/h.ts', 'a.ts', 'nested/b.ts', 'nested/deep/c.ts'])
  })

  it('默认集不含 __tests__：跳不跳由调用点声明（同一名字在不同守卫里口径不同）', () => {
    expect(DEFAULT_SKIP_DIRS.has('__tests__')).toBe(false)
    expect(DEFAULT_SKIP_DIRS.has('node_modules')).toBe(true)
  })

  it('默认集是可读的 Set（单源常量的形态约束，防止退回数组字面量造成 includes 语义漂移）', () => {
    expect(DEFAULT_SKIP_DIRS).toBeInstanceOf(Set)
    for (const name of ['.git', 'node_modules', 'dist', 'coverage', '.local']) {
      expect(DEFAULT_SKIP_DIRS.has(name)).toBe(true)
    }
  })

  it('调用点 skip 追加生效（compat-endpoints 的口径：产品代码不含测试夹具）', () => {
    expect(rel(fixture(FIXTURE), { skip: ['__tests__'] })).toEqual([
      'a.ts',
      'nested/b.ts',
      'nested/deep/c.ts',
    ])
  })

  it('skipEntry + maxDepth：只压深、不误伤浅层（protocol-single-source 的口径）', () => {
    const root = fixture({ ...FIXTURE, '.hidden/x.ts': 'export const x = 0\n' })
    const files = rel(root, {
      skipEntry: (name, depth) => name.startsWith('.') && depth === 0,
      maxDepth: 1,
    })
    // depth 0 的根文件 + depth 1 的 nested/b.ts；deep/c.ts 被 maxDepth 截断
    expect(files).toEqual(['__tests__/h.ts', 'a.ts', 'nested/b.ts'])
  })

  it('output=abs 返回绝对路径（routes-audit / no-ephemeral 的口径）', () => {
    const root = fixture(FIXTURE)
    const files = walkFiles(root, { match: isTs, output: 'abs' })
    expect(files).toHaveLength(4)
    for (const f of files) expect(path.isAbsolute(f)).toBe(true)
  })

  it('output=sources 随路径带文本，relBase 决定相对基准（constants-audit / pg 的口径）', () => {
    const root = fixture(FIXTURE)
    const sources = walkFiles(root, { match: isTs, output: 'sources', relBase: root })
    expect(sources).toContainEqual({ path: 'nested/b.ts', text: 'export const b = 2\n' })
  })

  it('根不存在 ⇒ 空数组（不抛）：空集必须由调用方的空分母判据接住', () => {
    expect(
      walkFiles(path.join(os.tmpdir(), 'walk-contract-missing-root'), { match: isTs })
    ).toEqual([])
  })
})

// ── F72 残余：新守卫不得自建递归文件遍历（AST 窄判据）────────────────────────────
//
// 背景（§136）：生产侧 9 处 walker 已收进 lib/walk.mjs，但**没有判据阻止新守卫再写一套**；
// walk.test.mjs 此前只钉 walk.mjs 自身契约，对「另一个文件里又长出 walker」无感。
//
// 判据形状（窄）：函数体（不跨嵌套函数）内同时出现
//   (a) 调用 readdirSync / opendir / opendirSync / globSync 之一；
//   (b) 对**自身函数名**的调用（递归）；
//   (c) 收集信号 `.push(`（把结果攒进数组）。
// (c) 是本轮实测后**额外收窄**的一条：`guard-red-mutation.mjs` 的 `removeTreeNoFollow`
// 满足 (a)+(b) 但它只做 `unlinkSync/rmdirSync`（无 push）——递归**删除**遍历不是文件
// 收集器，收进判据会把「防御性清理」误报成「第二套 walker」。实证见本文件「现有站点」用例。
//
// 白名单只有 lib/walk.mjs；判据**主动**验证它能命中它（阳性对照），生产扫描跳过它。
const GUARD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WALK_FS_CALLS = new Set(['readdirSync', 'opendir', 'opendirSync', 'globSync'])
const WALK_WHITELIST = new Map([
  ['lib/walk.mjs', '守卫族唯一的递归文件遍历实现（F72 收口点，本判据的阳性对照）'],
])

/** tools/v3-guard 下所有 .mjs（跳过 __tests__ 与白名单） */
function collectGuardFiles(dir = GUARD_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__') continue
    const p = path.join(dir, e.name)
    const rel = path.relative(GUARD_DIR, p).split(path.sep).join('/')
    if (e.isDirectory()) collectGuardFiles(p, out)
    else if (e.name.endsWith('.mjs') && !WALK_WHITELIST.has(rel)) out.push(p)
  }
  return out
}

/** 取被调用者的名字：readdirSync / fs.readdirSync / fs['readdirSync'] 都归一 */
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
    return expr.argumentExpression.text
  }
  return null
}

/** 函数名：声明名 / 变量名 / 对象属性名 */
function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  const p = node.parent
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text
  return null
}

/**
 * 返回命中 [{line, name}]。
 * AST 不看注释/字符串；不跨嵌套函数（内层 helper 的 push/readdir 不算外层）。
 */
function findRecursiveWalkers(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const hits = []
  const visit = (node) => {
    const isFn =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    if (isFn) {
      const name = functionName(node)
      if (name) {
        let readsDir = false
        let selfCall = false
        let collects = false
        const inside = (n) => {
          if (
            n !== node &&
            (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))
          ) {
            return
          }
          if (ts.isCallExpression(n)) {
            const callee = n.expression
            const cname = calleeName(callee)
            if (cname && WALK_FS_CALLS.has(cname)) readsDir = true
            if (ts.isIdentifier(callee) && callee.text === name) selfCall = true
            if (cname === 'push') collects = true
          }
          ts.forEachChild(n, inside)
        }
        inside(node.body ?? node)
        if (readsDir && selfCall && collects) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          hits.push({ line: line + 1, name })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('F72 残余：新守卫不得自建递归文件遍历（AST 窄判据）', () => {
  it(`🔴 ${RED_MARK} 合成递归 walker ⇒ 命中（阳性）`, () => {
    const sample = [
      'import fs from "node:fs"',
      'import path from "node:path"',
      'function walk(dir) {',
      '  const out = []',
      '  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {',
      '    const p = path.join(dir, e.name)',
      '    if (e.isDirectory()) out.push(...walk(p))',
      '    else if (e.isFile()) out.push(p)',
      '  }',
      '  return out',
      '}',
    ].join('\n')
    const hits = findRecursiveWalkers('synthetic.mjs', sample)
    expect(hits).toHaveLength(1)
    expect(hits[0].name).toBe('walk')
  })

  it('非递归 readdirSync（含 fs. / 裸调用 / 链式 filter）⇒ 命中 0（阴性）', () => {
    const sample = [
      'import fs from "node:fs"',
      'export function list(dir) {',
      '  return fs.readdirSync(dir, { withFileTypes: true })',
      '    .filter((e) => e.isFile())',
      '    .map((e) => e.name)',
      '}',
      'const names = readdirSync(".")',
    ].join('\n')
    expect(findRecursiveWalkers('flat.mjs', sample)).toEqual([])
  })

  it('递归删除遍历（readdir + 自调用但只 rm）⇒ 命中 0（本轮实测后收窄的边界）', () => {
    const sample = [
      'function removeTree(dir) {',
      '  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {',
      '    const p = path.join(dir, e.name)',
      '    if (e.isDirectory()) removeTree(p)',
      '    else fs.unlinkSync(p)',
      '  }',
      '  fs.rmdirSync(dir)',
      '}',
    ].join('\n')
    expect(findRecursiveWalkers('rm.mjs', sample)).toEqual([])
  })

  it(`🔴 ${RED_MARK} 当前真实 v3-guard 目录 ⇒ 命中 0（白名单外没有第二套 walker）`, () => {
    const files = collectGuardFiles()
    expect(files.length, '扫描面为空 ⇒ 根路径写错，先红').toBeGreaterThan(30)
    const offenders = files.flatMap((file) =>
      findRecursiveWalkers(file, fs.readFileSync(file, 'utf8')).map(
        (h) => `${path.relative(GUARD_DIR, file).split(path.sep).join('/')}:${h.line} ${h.name}`
      )
    )
    expect(offenders).toEqual([])
  })

  it(`🔴 ${RED_MARK} 阳性对照：白名单里的 lib/walk.mjs 必须能被同一判据命中`, () => {
    const file = path.join(GUARD_DIR, 'lib/walk.mjs')
    const hits = findRecursiveWalkers(file, fs.readFileSync(file, 'utf8'))
    expect(
      hits.some((h) => h.name === 'walk'),
      '判据认不出真实 walker = 判据本身空转'
    ).toBe(true)
    expect(WALK_WHITELIST.get('lib/walk.mjs'), '白名单必须写理由').toBeTruthy()
  })
})
