import { describe, expect, it, vi } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import {
  isRouteMode,
  RouteRepository,
  type SnapRow,
} from '../src/modules/route/repositories/route.repository'

// route 域数据访问层单测（2026-09-10 新增）
//
// 为什么需要这个文件：repository 的语义几乎全写在 SQL 文本里，真正的行为要连真库才验得了
// （pgr_withPoints / pgr_createTopology 属集成范畴）。但其中有两处**字符串级**硬约束，
// 一旦被改坏就是线上事故，而真库 e2e 又被 `V3_INTEGRATION_DB` 门控跳过（CI 不跑、本地也不跑）
// → 用 mock 捕获实际下发的 SQL 做回归护栏：
//
//   ① `pgr_withPoints` 的 points_sql 必须用 `$$` 美元引用包裹。
//      依据：ccabbd09——内层含 `'b'::char` 单引号字面量，用 `'...'` 包裹会提前终止字符串，
//      实测首次上线 5/5 请求全 500。
//   ② 吸附（snapPoints）与寻路（shortestPathByPoints）都必须限定主干分量 `main_comp IS TRUE`。
//      依据：0a1a7b0f——OSM 原始数据天生 62% 主干 + 38% 碎片（三方互证），
//      不加过滤时点落在碎片分量上会"吸附成功却寻不到路"，与原系统有效服务范围不一致。

function makeDbMock() {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] })
    return { rows: [] }
  })
  // 只实现被测代码用到的 query 一面，避免为测试伪造整个 DbService
  return { db: { query } as unknown as DbService, calls }
}

const SNAPS: SnapRow[] = [
  { pid: -1, edge_id: '1001', fraction: 0.25, snap_m: 654.84 },
  { pid: -2, edge_id: '2002', fraction: 0.75, snap_m: 629.13 },
]

/** 数 `$$` 出现次数：edges_sql 与 points_sql 各需一对（= 4 个） */
const countDollarQuotes = (sql: string) => sql.split('$$').length - 1

describe('RouteRepository.snapPoints - SQL 契约', () => {
  it('吸附查询限定可通行边 + 主干分量（cost_m > 0 AND main_comp IS TRUE）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).snapPoints(108.6, 21.7, 108.7, 21.75, 2000)

    expect(calls).toHaveLength(1)
    const sql = calls[0].sql
    expect(sql).toContain('main_comp IS TRUE')
    expect(sql).toContain('cost_m > 0')
    expect(sql).toContain('geom IS NOT NULL')
    // KNN 取最近边 + 沿边投影：对齐 graph.py 的 _snap_query / _attach
    expect(sql).toContain('<->')
    expect(sql).toContain('ST_LineLocatePoint')
    // 吸附半径以参数注入（graveyard：写死 2000 会让 SNAP_RADIUS_M 失效）
    expect(calls[0].params).toContain(2000)
  })
})

describe('RouteRepository.shortestPathByPoints - SQL 契约', () => {
  it('points_sql 用 $$ 美元引用包裹，单引号字面量不再冲突（ccabbd09 回归护栏）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')

    const sql = calls[0].sql
    // edges_sql 一对 + points_sql 一对
    expect(countDollarQuotes(sql)).toBe(4)
    // 该字面量正是当年用单引号包裹时炸掉的元凶，必须留在内层
    expect(sql).toContain("'b'::char")
    expect(sql).toContain('pgr_withPoints')
  })

  it('寻路边集同样限定主干分量（main_comp IS TRUE）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')
    expect(calls[0].sql).toContain('main_comp IS TRUE')
  })

  it('无向图语义：directed := false（对齐 nx.Graph()，oneway 源数据全 NULL）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')
    expect(calls[0].sql).toContain('directed := false')
  })

  it('mode 决定权重列：distance→cost_m，time→cost_min（两口径各按自身权重寻路）', async () => {
    const a = makeDbMock()
    await new RouteRepository(a.db).shortestPathByPoints(SNAPS, 'distance')
    expect(a.calls[0].sql).toContain('cost_m AS cost')
    expect(a.calls[0].sql).not.toContain('cost_min')

    const b = makeDbMock()
    await new RouteRepository(b.db).shortestPathByPoints(SNAPS, 'time')
    expect(b.calls[0].sql).toContain('cost_min AS cost')
  })

  it('虚拟点 pid 与起终点常量一致（-1 起点 / -2 终点）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')
    expect(calls[0].params).toEqual([-1, -2])
  })
})

describe('RouteRepository - 空输入短路与 mode 白名单', () => {
  it('空边集不应发起 SQL（避免 IN () 语法错与无谓往返）', async () => {
    const { db, calls } = makeDbMock()
    const repo = new RouteRepository(db)
    expect(await repo.pathGeometry([], 0, 1)).toEqual([])
    expect(await repo.sumEdgeCosts([])).toEqual({ distanceM: 0, durationMin: 0 })
    expect(calls).toHaveLength(0)
  })

  it('isRouteMode 白名单：仅 distance / time 通过（防注入的守门函数）', () => {
    expect(isRouteMode('distance')).toBe(true)
    expect(isRouteMode('time')).toBe(true)
    expect(isRouteMode('fastest')).toBe(false)
    expect(isRouteMode('cost_m; DROP TABLE roads')).toBe(false)
    expect(isRouteMode(undefined)).toBe(false)
    expect(isRouteMode(1)).toBe(false)
  })
})
