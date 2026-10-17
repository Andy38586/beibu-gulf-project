import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { PlansRepository } from '../src/modules/plans/repositories/plans.repository'

// U7：plans 的「先读后写」公共前缀（事务 + FOR UPDATE 行锁 + 行不存在短路）
// 在 update / saveXiaoqu / removeXiaoqu 三处共用同一实现。
// 失效面：任一处退回自写事务或漏加 FOR UPDATE，就重新引入「基于旧快照写回」的丢更新窗口
// （并发同方案保存互相覆盖）；漏短路则会在 row=undefined 上继续写。

// backend 测试统一走 CommonJS（tsconfig module: commonjs），故用 __dirname 取本文件目录
const HERE = __dirname
const AUTHORITY = path.resolve(
  HERE,
  '..',
  'src',
  'modules',
  'plans',
  'repositories',
  'plans.repository.ts'
)

const ROW = {
  id: 'p1',
  user_id: 'u1',
  name: '方案',
  payload: { savedXiaoqu: [{ id: 'x1', name: '小区A' }] },
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
}

interface QueryCall {
  text: string
  values?: unknown[]
}

function harness(rows: unknown[]) {
  const calls: QueryCall[] = []
  let transactions = 0
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      return { rows }
    },
  }
  const db = {
    withTransaction: async (runner: (c: unknown) => Promise<unknown>) => {
      transactions += 1
      return runner(client)
    },
  }
  return {
    repo: new PlansRepository(db as unknown as DbService),
    calls,
    transactions: () => transactions,
  }
}

const SELECT_FOR_UPDATE = /FOR UPDATE/
const UPDATE = /^\s*UPDATE/i

describe('plansRepository 先读后写前缀（无库）', () => {
  it('🔴 @guard-red-sample update / saveXiaoqu / removeXiaoqu 都先开事务并 SELECT ... FOR UPDATE，且只开一次', async () => {
    for (const invoke of [
      (repo: PlansRepository) => repo.update('p1', { name: '新名' }),
      (repo: PlansRepository) => repo.saveXiaoqu('p1', { id: 'x1', name: '小区A' }),
      (repo: PlansRepository) => repo.removeXiaoqu('p1', 'x1'),
    ]) {
      const h = harness([ROW])
      await invoke(h.repo)
      expect(h.transactions()).toBe(1)
      const first = h.calls[0]
      expect(first).toBeDefined()
      expect(first.text).toMatch(SELECT_FOR_UPDATE)
      // 先读后写的顺序：SELECT 必须在 UPDATE 之前（不许把读丢出事务）
      expect(h.calls.findIndex((c) => UPDATE.test(c.text))).toBeGreaterThan(0)
    }
  })

  it('行不存在时三个入口都短路为 null，且不发出任何 UPDATE', async () => {
    for (const invoke of [
      (repo: PlansRepository) => repo.update('missing', { name: '新名' }),
      (repo: PlansRepository) => repo.saveXiaoqu('missing', { id: 'x1', name: '小区A' }),
      (repo: PlansRepository) => repo.removeXiaoqu('missing', 'x1'),
    ]) {
      const h = harness([])
      const out = await invoke(h.repo)
      expect(out).toBeNull()
      expect(h.calls.filter((c) => UPDATE.test(c.text))).toHaveLength(0)
    }
  })
})

// —— 结构判据：三处调用点必须共用同一份前缀实现，不许再手抄事务骨架 ——

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 统计「属性访问链 X.<name>(...)」调用行号 */
function propertyCalls(sf: ts.SourceFile, name: string): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === name) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/** 统计「裸标识符调用 name(...)」行号 */
function plainCalls(sf: ts.SourceFile, name: string): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

const AUTHORITY_SRC = fs.readFileSync(AUTHORITY, 'utf8')
const AUTHORITY_SF = parse(AUTHORITY_SRC)

// 阳性对照：手抄骨架两份（各自 db.withTransaction + SELECT ... FOR UPDATE）
const HAND_WRITTEN_SAMPLE = [
  'async update(id) {',
  '  return this.db.withTransaction(async (client) => {',
  '    const res = await client.query("SELECT c FROM plans WHERE id = $1 FOR UPDATE", [id])',
  '    const row = res.rows[0]',
  '    if (!row) return null',
  '  })',
  '}',
  'async saveXiaoqu(id) {',
  '  return this.db.withTransaction(async (client) => {',
  '    const res = await client.query("SELECT c FROM plans WHERE id = $1 FOR UPDATE", [id])',
  '    const row = res.rows[0]',
  '    if (!row) return null',
  '  })',
  '}',
].join('\n')

// 近失对照：注释、字符串、改名调用、同名局部变量一律不计数
const NEAR_MISS_SAMPLE = [
  '// this.db.withTransaction(async (client) => {',
  'const s = "this.db.withTransaction(async () => {})"',
  'const s2 = "x this.db.withTransaction y"',
  'return this.db.runInTransaction(async (client) => {})',
  'const withTransaction = 1',
].join('\n')

describe('plansRepository 先读后写前缀唯一性（结构）', () => {
  it('🔴 @guard-red-sample 事务骨架只许一份：withTransaction 恰 1 处、withPlanRow 恰 3 个调用点、FOR UPDATE 恰 1 处', () => {
    expect(propertyCalls(AUTHORITY_SF, 'withTransaction')).toHaveLength(1)
    expect(propertyCalls(AUTHORITY_SF, 'withPlanRow')).toHaveLength(3)
    expect(propertyCalls(AUTHORITY_SF, 'savedXiaoquOf')).toHaveLength(2)
    const forUpdateHits = AUTHORITY_SRC.split('\n').filter(
      (l) => /FOR UPDATE/.test(l) && !/^\s*\/\//.test(l)
    )
    expect(forUpdateHits).toHaveLength(1)
  })

  it('扫描器阳性对照：手抄两份骨架能被数出 withTransaction 2 处', () => {
    const sf = parse(HAND_WRITTEN_SAMPLE)
    expect(propertyCalls(sf, 'withTransaction')).toEqual([2, 9])
  })

  it('扫描器近失对照：注释/字符串/改名调用一律不计数', () => {
    const sf = parse(NEAR_MISS_SAMPLE)
    expect(propertyCalls(sf, 'withTransaction')).toEqual([])
    expect(propertyCalls(sf, 'withPlanRow')).toEqual([])
    expect(plainCalls(sf, 'withPlanRow')).toEqual([])
  })
})
