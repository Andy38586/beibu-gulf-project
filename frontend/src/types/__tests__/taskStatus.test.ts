import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { isActiveStatus, isTerminalStatus, TASK_STATUSES } from '../task'

/**
 * 任务状态判据单源守卫（必要性审判波次二·单元 H）
 *
 * 治的失效：同一「活跃 / 终态」判定在两侧手抄 5 处——后端 `task.service.ts` 的私有
 * `isActive`、`task-registry.ts` 的 `activeCount` 内联与 `TERMINAL_STATUSES` 集合，
 * 前端三个 core 组件（TaskDock / TaskPanelSlot / TaskProgressRing）。改一处漏四处。
 *
 * 判据域：`frontend/src` + `backend/src` 的 .ts/.vue，排除两个权威源文件
 * （`frontend/src/types/task.ts`、`backend/src/modules/task/types/task.ts`）。
 * 只咬「集合恰为活跃/终态」的状态字面量比较，不咬单个字面量（大量无关同名 pending）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_SRC = path.resolve(HERE, '..', '..')
const BACKEND_SRC = path.resolve(HERE, '..', '..', '..', '..', 'backend', 'src')
const AUTHORITY = new Set([
  'frontend/src/types/task.ts',
  'backend/src/modules/task/types/task.ts',
  // 判据自身必须声明活跃/终态两个集合，否则无法判「恰为集合」——登记为豁免面
  'frontend/src/types/__tests__/taskStatus.test.ts',
])
const SKIP_DIR = new Set(['node_modules', '.local', 'dist', '.pytest_cache', '.git'])

const ACTIVE = ['pending', 'running', 'retrying']
const TERMINAL = ['done', 'failed', 'cancelled']
const STATUS_SET = new Set([...ACTIVE, ...TERMINAL])

interface Offender {
  rule: 'A' | 'B' | 'C'
  file: string
  line: number
  detail: string
}

function listSources(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue
      listSources(path.join(dir, entry.name), acc)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      acc.push(path.join(dir, entry.name))
    }
  }
  return acc
}

function eqString(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function sameSet(values: string[], expected: string[]): boolean {
  return (
    values.length === expected.length &&
    new Set(values).size === values.length &&
    expected.every((v) => values.includes(v))
  )
}

/** 扫描一批源码，返回违反「状态判据单源」的站点 */
function scanStatusLiterals(sources: { name: string; text: string }[]): Offender[] {
  const offenders: Offender[] = []
  for (const { name, text } of sources) {
    if (AUTHORITY.has(name)) continue
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
    const at = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
    const isChain = (n: ts.Node): boolean => {
      const p = n.parent
      return (
        !!p &&
        ts.isBinaryExpression(p) &&
        (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          p.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
        (p.left === n || p.right === n)
      )
    }
    const walk = (node: ts.Node): void => {
      // 规则 A：最外层 &&/|| 链内、同一接收者、≥2 个不同状态字面量比较
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
        !isChain(node)
      ) {
        const cmps: { lit: string; recv: string }[] = []
        const collect = (m: ts.Node): void => {
          if (ts.isBinaryExpression(m)) {
            const k = m.operatorToken.kind
            if (
              k === ts.SyntaxKind.EqualsEqualsToken ||
              k === ts.SyntaxKind.ExclamationEqualsToken ||
              k === ts.SyntaxKind.EqualsEqualsEqualsToken ||
              k === ts.SyntaxKind.ExclamationEqualsEqualsToken
            ) {
              const left = eqString(m.left)
              const right = eqString(m.right)
              if (left !== null && STATUS_SET.has(left))
                cmps.push({ lit: left, recv: m.right.getText() })
              else if (right !== null && STATUS_SET.has(right))
                cmps.push({ lit: right, recv: m.left.getText() })
            }
            collect(m.left)
            collect(m.right)
          }
        }
        collect(node)
        const lits = [...new Set(cmps.map((c) => c.lit))]
        const recvs = [...new Set(cmps.map((c) => c.recv))]
        if (lits.length >= 2 && recvs.length === 1) {
          const recv = recvs[0]
          if (
            /^(status|.*\.status)$/.test(recv) ||
            sameSet(lits, ACTIVE) ||
            sameSet(lits, TERMINAL)
          ) {
            offenders.push({
              rule: 'A',
              file: name,
              line: at(node.getStart(sf)),
              detail: `recv=${recv} lits=${lits.join(',')}`,
            })
          }
        }
      }
      // 规则 B：数组 / new Set(数组) 元素集恰为活跃或终态
      // new Set([...]) 里的数组字面量只按 Set 记一次（否则同一站点命中两条）
      const inSetArgument =
        ts.isNewExpression(node.parent) &&
        node.parent.expression.getText() === 'Set' &&
        node.parent.arguments?.[0] === node
      if (ts.isArrayLiteralExpression(node) && !inSetArgument) {
        const els = node.elements.map(eqString)
        if (
          els.length > 0 &&
          els.every((x): x is string => x !== null && STATUS_SET.has(x)) &&
          (sameSet(els, ACTIVE) || sameSet(els, TERMINAL))
        ) {
          offenders.push({
            rule: 'B',
            file: name,
            line: at(node.getStart(sf)),
            detail: `array ${els.join(',')}`,
          })
        }
      }
      if (
        ts.isNewExpression(node) &&
        node.expression.getText() === 'Set' &&
        node.arguments?.length === 1 &&
        ts.isArrayLiteralExpression(node.arguments[0])
      ) {
        const els = node.arguments[0].elements.map(eqString)
        if (
          els.length > 0 &&
          els.every((x): x is string => x !== null && STATUS_SET.has(x)) &&
          (sameSet(els, ACTIVE) || sameSet(els, TERMINAL))
        ) {
          offenders.push({
            rule: 'B',
            file: name,
            line: at(node.getStart(sf)),
            detail: `Set ${els.join(',')}`,
          })
        }
      }
      // 规则 C：成员全是状态字面量的联合类型
      if (ts.isUnionTypeNode(node)) {
        const members = node.types.map((t) =>
          ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null
        )
        const good = members.filter((x): x is string => x !== null && STATUS_SET.has(x))
        if (good.length >= 2 && good.length === members.length) {
          offenders.push({
            rule: 'C',
            file: name,
            line: at(node.getStart(sf)),
            detail: `union ${[...new Set(good)].join(',')}`,
          })
        }
      }
      ts.forEachChild(node, walk)
    }
    ts.forEachChild(sf, walk)
  }
  return offenders
}

const REAL_SOURCES = [...listSources(FRONTEND_SRC), ...listSources(BACKEND_SRC)].map((abs) => ({
  name: path.relative(path.resolve(HERE, '..', '..', '..', '..'), abs).replace(/\\/g, '/'),
  text: fs.readFileSync(abs, 'utf8'),
}))

/** 阳性对照：三处手抄各一条（链 / 集合 / 联合） */
const HAND_WRITTEN_SAMPLE = [
  {
    name: 'sample.ts',
    text: `const ok = (s: string) => s === 'pending' || s === 'running' || s === 'retrying'
const terminal = new Set(['done', 'failed', 'cancelled'])
type Card = { status: 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'cancelled' }
`,
  },
]

/** 近失对照：接收者分裂 / 单字面量 / 同形异族 / 无关同名 —— 一条都不许咬 */
const NEAR_MISS_SAMPLE = [
  {
    name: 'near.ts',
    text: `// 接收者分裂 + 去重后只剩一个状态 ⇒ 不是「活跃/终态」集合判据
const once = view.status === 'retrying' && existing.status !== 'retrying'
// 单个状态字面量（终态分派、去重让位）合法
const a = status === 'cancelled' || status === undefined
const b = record.status !== 'pending'
// 同形异族：面板拖拽相位也叫 pending，但不是任务状态
const phase = p === 'pending' || p === 'dragging'
// 无关同名：数组里混了非状态字面量
const colors = ['pending', 'running', 'idle']
`,
  },
]

describe('任务状态判据单源守卫', () => {
  it('🔴 @guard-red-sample 全仓无第二份「活跃/终态」手抄（阳性对照必须命中）', () => {
    const offenders = scanStatusLiterals(REAL_SOURCES)
    expect(offenders).toEqual([])
    expect(REAL_SOURCES.length).toBeGreaterThan(300)
    // 权威源自身必须仍导出两条谓词（防止把判据删空后守卫变空转）
    expect(isActiveStatus('running')).toBe(true)
    expect(isTerminalStatus('done')).toBe(true)
  })

  it('扫描器阳性对照：三处手抄各命中一条', () => {
    const offenders = scanStatusLiterals(HAND_WRITTEN_SAMPLE)
    expect(offenders.map((o) => o.rule).sort()).toEqual(['A', 'B', 'C'])
  })

  it('扫描器近失对照：接收者分裂 / 单字面量 / 异族一律不咬', () => {
    expect(scanStatusLiterals(NEAR_MISS_SAMPLE)).toEqual([])
  })

  it('豁免面不得过期（三个权威/判据文件必须真实存在）', () => {
    const root = path.resolve(HERE, '..', '..', '..', '..')
    for (const rel of AUTHORITY) {
      expect(fs.existsSync(path.join(root, rel)), `${rel} 不存在：豁免过期`).toBe(true)
    }
  })

  it('两条谓词把六态恰好切成两半（互斥且完备）', () => {
    for (const status of TASK_STATUSES) {
      expect(isActiveStatus(status)).toBe(!isTerminalStatus(status))
    }
  })

  it('后端两处消费点已改用权威谓词（不再手抄）', () => {
    const service = fs.readFileSync(
      path.join(BACKEND_SRC, 'modules/task/services/task.service.ts'),
      'utf8'
    )
    const registry = fs.readFileSync(
      path.join(BACKEND_SRC, 'modules/task/services/task-registry.ts'),
      'utf8'
    )
    expect(service).toContain('isActiveStatus')
    expect(service).not.toMatch(/function isActive\b/)
    expect(registry).toContain('isActiveStatus')
    expect(registry).toContain('isTerminalStatus')
    expect(registry).not.toContain('TERMINAL_STATUSES')
  })

  it('跨端状态集合一致 + 后端两数组恰好切分（删一个字面量必红）', () => {
    const backend = fs.readFileSync(path.join(BACKEND_SRC, 'modules/task/types/task.ts'), 'utf8')
    const sf = ts.createSourceFile('backend-task.ts', backend, ts.ScriptTarget.Latest, true)
    const found: { members: string[] | null; arrays: Record<string, string[]> } = {
      members: null,
      arrays: {},
    }
    const walk = (node: ts.Node): void => {
      // TASK_STATUSES 以 `as const` 断言包裹数组字面量 ⇒ initializer 是 AsExpression。
      const arrLit =
        ts.isAsExpression(node) && ts.isArrayLiteralExpression(node.expression)
          ? node.expression
          : ts.isArrayLiteralExpression(node)
            ? node
            : undefined
      if (arrLit) {
        const parentVar = node.parent
        if (
          ts.isVariableDeclaration(parentVar) &&
          ts.isIdentifier(parentVar.name) &&
          parentVar.name.text === 'TASK_STATUSES'
        ) {
          found.members = arrLit.elements
            .map((e) => (ts.isStringLiteral(e) ? e.text : null))
            .filter((x): x is string => x !== null)
        }
      }
      // 后端权威枚举的载体是模块私有数组 ⇒ 联合与数组任一侧漏改都要红。
      // ACTIVE/TERMINAL_STATUSES 可能是字面量数组，也可能是 TASK_STATUSES.filter(...) 派生——
      // filter 形参箭头函数体里的字面量比较仍是载体。
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined
      ) {
        if (node.name.text === 'ACTIVE_STATUSES' || node.name.text === 'TERMINAL_STATUSES') {
          const lits: string[] = []
          const collectLits = (n: ts.Node): void => {
            if (ts.isStringLiteral(n)) lits.push(n.text)
            ts.forEachChild(n, collectLits)
          }
          collectLits(node.initializer)
          found.arrays[node.name.text] = lits
        }
      }
      ts.forEachChild(node, walk)
    }
    ts.forEachChild(sf, walk)
    expect(found.members, '后端 TASK_STATUSES 数组未找到').not.toBeNull()
    expect([...(found.members ?? [])].sort()).toEqual([...TASK_STATUSES].sort())
    expect(found.arrays.ACTIVE_STATUSES, '后端 ACTIVE_STATUSES 未找到').toBeDefined()
    expect(found.arrays.TERMINAL_STATUSES, '后端 TERMINAL_STATUSES 未找到').toBeDefined()
    const union = [...found.arrays.ACTIVE_STATUSES, ...found.arrays.TERMINAL_STATUSES]
    expect(new Set(union).size, '活跃/终态数组必须互斥').toBe(union.length)
    expect([...union].sort(), '两数组必须恰好覆盖 TASK_STATUSES 全集').toEqual(
      [...(found.members ?? [])].sort()
    )
  })
})
