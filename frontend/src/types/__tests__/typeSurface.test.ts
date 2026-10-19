import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 类型公开面收窄守卫（必要性审判波次二·单元 R）
 *
 * 治的失效：`interface` / `type` 在编译后**没有运行时表示**，所以
 * `expect(mod[k]).toBeUndefined()` 这类运行时断言对它们恒真 —— 变异四式里
 * 「恢复 export 必红」全部落空（本单元实测 4/4 假绿）。判据必须落在**源码 AST** 上。
 *
 * 判据域：三条只在本文件内部自用、全仓零外部导入的类型声明，不得再对外
 * （声明修饰符与尾部 `export { … }` 两种形态同咬）；另附阳性对照（同文件内确实
 * 对外的符号仍带 export），防止判据退化成「扫到 0 处就全绿」。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_SRC = path.resolve(HERE, '..', '..')

interface Case {
  /** 相对 frontend/src 的源文件 */
  file: string
  /** 必须已收为模块内部的类型名 */
  internal: string
  /** 同文件内仍须对外的符号（阳性对照） */
  publicAnchor: string
}

const CASES: Case[] = [
  { file: 'types/task.ts', internal: 'TaskError', publicAnchor: 'TaskView' },
  {
    file: 'shared/composables/useAuth.ts',
    internal: 'UseAuthReturn',
    publicAnchor: 'useAuth',
  },
  {
    file: 'business/route-analysis/constants/pingluTiles.ts',
    internal: 'PingluGroupId',
    publicAnchor: 'PINGLU_GROUPS',
  },
]

/**
 * 该名字的声明在模块公开面上吗？两种形态都算公开：
 *  ① 声明自身的 `export` 修饰符；
 *  ② 尾部 `export { Foo }` / `export type { Foo }`（同义改写，必须同样咬住）。
 * 无该声明返回 null。
 */
const DECL_KINDS = [
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
  ts.isClassDeclaration,
  ts.isFunctionDeclaration,
  ts.isVariableDeclaration,
]

/** 变量声明的修饰符在 VariableStatement（父节点）上，其余在自身 */
function hasExportModifier(node: ts.Node): boolean {
  const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node
  const mods = ts.canHaveModifiers(owner) ? ts.getModifiers(owner) : undefined
  return (mods ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function exportState(text: string, name: string): boolean | null {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  let declared = false
  let exported = false
  const visit = (node: ts.Node): void => {
    const named = node as ts.Node & { name?: ts.Node }
    if (
      DECL_KINDS.some((is) => is(node)) &&
      named.name !== undefined &&
      ts.isIdentifier(named.name) &&
      named.name.text === name
    ) {
      declared = true
      if (hasExportModifier(node)) exported = true
    }
    if (ts.isExportDeclaration(node) && node.exportClause !== undefined) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          if (el.name.text === name) exported = true
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return declared ? exported : null
}

/** 该名字是否在本文件有声明（不限形态） */
function declaresName(text: string, name: string): boolean {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  let hit = false
  const visit = (node: ts.Node): void => {
    if (hit) return
    const named = node as ts.Node & { name?: ts.Node }
    if (
      named.name !== undefined &&
      ts.isIdentifier(named.name) &&
      named.name.text === name &&
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node))
    ) {
      hit = true
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return hit
}

describe('公开面收窄 — 三个仅内部自用的类型声明不得再对外', () => {
  for (const c of CASES) {
    it(c.internal + ' 不在公开面；' + c.publicAnchor + ' 仍对外（阳性对照）', () => {
      const text = fs.readFileSync(path.join(FRONTEND_SRC, c.file), 'utf8')
      expect(exportState(text, c.internal), c.internal + ' 应已收为模块内部').toBe(false)
      expect(declaresName(text, c.publicAnchor), c.publicAnchor + ' 应在同文件声明').toBe(true)
      expect(exportState(text, c.publicAnchor), c.publicAnchor + ' 应仍对外').toBe(true)
    })
  }

  it('探针四形态：export 声明 / 内部声明 / 尾部 re-export / 无声明', () => {
    expect(exportState('export interface Foo { a: string }', 'Foo')).toBe(true)
    expect(exportState('interface Foo { a: string }', 'Foo')).toBe(false)
    // 同义改写：把 export 挪到尾部也算对外，不得漏咬
    expect(exportState('interface Foo { a: string }\nexport type { Foo }', 'Foo')).toBe(true)
    expect(exportState('interface Foo { a: string }\nexport { Foo }', 'Foo')).toBe(true)
    expect(exportState('declare const x: number', 'Foo')).toBeNull()
  })
})
