/**
 * 必要性审判波次二·单元 I：provideKeys 死通道收口判据。
 *
 * 背景：RESTORE_PLAN_DATA_KEY / EDITING_PLAN_KEY 两条 provide 通道全仓零 inject，
 * 值自 provide 后从未被写或读（2026-10-19 实测，分叉点 5b5f14cb 起即如此），
 * 按必要性审判三问第 1 问「谁消费」= 0 ⇒ 删。
 *
 * 判据两条：
 * 1. 行为面（公开面收窄）：两个键不得再从 `provideKeys.ts` 导出；
 * 2. 全称面（不许再长出死通道）：以 Symbol 承载的 provide 键必须至少有一个 inject 消费点。
 *    只咬「Symbol 键」——字符串键（如 FORECAST_ORCHESTRATOR_KEY）不在本判据域内。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import * as provideKeys from '../provideKeys'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|dist|\.local)$/

interface ScanResult {
  symbolKeys: string[]
  provided: string[]
  injected: string[]
  offenders: string[]
  files: number
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.test(entry.name)) continue
      walk(path.join(dir, entry.name), out)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 剥离括号 / as / satisfies 包装，取回被包裹的标识符（同义改写不得绕过判据） */
function identOf(node: ts.Node): string | null {
  let current: ts.Node = node
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression
    } else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression
    } else {
      break
    }
  }
  return ts.isIdentifier(current) ? current.text : null
}

/** 扫源码文本：Symbol 键声明 / provide 调用 / inject 调用 */
export function scanProvides(files: Array<{ rel: string; text: string }>): ScanResult {
  const symbolKeys = new Set<string>()
  const provided = new Set<string>()
  const injected = new Set<string>()

  for (const { rel, text } of files) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true)

    const visit = (node: ts.Node): void => {
      // 声明：const X = Symbol('...')（含 export const，含类型注解）
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer !== undefined &&
            ts.isCallExpression(decl.initializer) &&
            decl.initializer.expression.getText(sf) === 'Symbol'
          ) {
            symbolKeys.add(decl.name.text)
          }
        }
      }
      // provide(X, ...)
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'provide' &&
        node.arguments.length > 0
      ) {
        const key = identOf(node.arguments[0])
        if (key !== null) provided.add(key)
      }
      // inject(X / inject<T>(X
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'inject' &&
        node.arguments.length > 0
      ) {
        const key = identOf(node.arguments[0])
        if (key !== null) injected.add(key)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  const offenders = [...provided].filter((key) => symbolKeys.has(key) && !injected.has(key)).sort()
  return {
    symbolKeys: [...symbolKeys].sort(),
    provided: [...provided].sort(),
    injected: [...injected].sort(),
    offenders,
    files: files.length,
  }
}

const REPO_FILES = walk(SRC).map((abs) => ({
  rel: path.relative(SRC, abs).replace(/\\/g, '/'),
  text: fs.readFileSync(abs, 'utf8'),
}))

describe('必要性审判波次二·单元 I：provideKeys 死通道', () => {
  it('公开面收窄 — RESTORE_PLAN_DATA_KEY / EDITING_PLAN_KEY 不得再导出', () => {
    const mod = provideKeys as unknown as Record<string, unknown>
    expect(mod.RESTORE_PLAN_DATA_KEY).toBeUndefined()
    expect(mod.EDITING_PLAN_KEY).toBeUndefined()
    // 阳性对照：活通道仍在，证明判据不是恒绿
    expect(mod.UNIFIED_MAP_KEY).toBeDefined()
  })

  it('以 Symbol 承载的 provide 键必须至少有一个 inject 消费点', () => {
    const result = scanProvides(REPO_FILES)
    expect(result.files).toBeGreaterThan(50)
    // 阳性对照：本仓确有 Symbol 键，判据域非空
    expect(result.symbolKeys.length).toBeGreaterThan(0)
    expect(result.provided.length).toBeGreaterThan(0)
    expect(result.offenders).toEqual([])
  })

  it('阳性对照 — 喂只 provide 不 inject 的 Symbol 键样本，必须报出', () => {
    const result = scanProvides([
      {
        rel: 'sample-provide.ts',
        text: "const DEAD_KEY = Symbol('dead')\nprovide(DEAD_KEY, ref(null))\n",
      },
    ])
    expect(result.offenders).toEqual(['DEAD_KEY'])
  })

  it('同义改写 — provide(KEY as symbol, ...) 不得绕过判据', () => {
    const result = scanProvides([
      {
        rel: 'sample-as-expression.ts',
        text: "const DEAD_KEY = Symbol('dead')\nprovide(DEAD_KEY as symbol, ref(null))\n",
      },
    ])
    expect(result.offenders).toEqual(['DEAD_KEY'])
  })

  it('近失 — 字符串键（FORECAST_ORCHESTRATOR_KEY 形态）不在判据域内', () => {
    const result = scanProvides([
      {
        rel: 'sample-string-key.ts',
        text: "const STR_KEY = 'forecast-orchestrator'\nprovide(STR_KEY, orchestrator)\n",
      },
      { rel: 'sample-inject.ts', text: 'const x = inject(STR_KEY, null)\n' },
    ])
    expect(result.offenders).toEqual([])
  })
})
