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

import { afterAll, describe, expect, it } from 'vitest'

import { DEFAULT_SKIP_DIRS, walkFiles } from '../lib/walk.mjs'

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
