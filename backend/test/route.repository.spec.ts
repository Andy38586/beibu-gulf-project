import { describe, expect, it, vi } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import {
  isRouteMode,
  PID_FROM,
  PID_TO,
  RouteRepository,
  type RouteSegment,
  ROUTING_TABLE,
  type SnapRow,
} from '../src/modules/route/repositories/route.repository'

// route 域数据访问层单测（2026-09-10 新增）
//
// 为什么需要这个文件：repository 的语义几乎全写在 SQL 文本里，真正的行为要连真库才验得了
// （pgr_withPoints / pgr_createTopology 属集成范畴）。但其中几处**字符串级**硬约束，
// 一旦被改坏就是线上事故，而真库 e2e 又被 `V3_INTEGRATION_DB` 门控跳过（CI 不跑、本地也不跑）
// → 用 mock 捕获实际下发的 SQL 做回归护栏：
//
//   ① `pgr_withPoints` 的 points_sql 必须用 `$$` 美元引用包裹。
//      依据：ccabbd09——内层含 `'b'::char` 单引号字面量，用 `'...'` 包裹会提前终止字符串，
//      实测首次上线 5/5 请求全 500。
//   ② **虚拟点编号的符号**：points_sql 的 pid 必须是**正数**，函数入参必须是**负数**。
//      依据：2026-09-10 实测——两者都传负数时 pgRouting 不报错、静默返回 0 行，
//      表现为"任何起终点都 unreachable"，白排查 4 轮。这是本文件最重要的一条护栏。
//   ③ 吸附与寻路都必须限定主干分量 `main_comp IS TRUE`。
//      依据：0a1a7b0f——OSM 原始数据天生 62% 主干 + 38% 碎片（三方互证）。
//   ④ 里程/时长必须按**分段实际费用**汇总，不能用整条边的费用。
//      依据：2026-09-10 实测——部分边（首尾）按整条边算会高估约 10.6%，顶穿 B-5 的 <1% 判据。

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
  { pid: PID_FROM, edge_id: '1001', fraction: 0.25, snap_m: 654.84 },
  { pid: PID_TO, edge_id: '2002', fraction: 0.75, snap_m: 629.13 },
]

const SEGMENTS: RouteSegment[] = [
  { edgeId: 1001, lo: 0.25, hi: 1, reverse: false, cost: 50 },
  { edgeId: 2002, lo: 0, hi: 0.75, reverse: false, cost: 50 },
]

/** 数 `$$` 出现次数：edges_sql 与 points_sql 各需一对（= 4 个） */
const countDollarQuotes = (sql: string) => sql.split('$$').length - 1

describe('虚拟点编号符号（2026-09-10 线上故障的护栏，勿删）', () => {
  it('snapPoints 用**正数** pid（不能传负数，否则点对不上号）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).snapPoints(108.6, 21.7, 108.7, 21.75, 2000)

    const params = calls[0].params as number[]
    expect(params).toContain(PID_FROM)
    expect(params).toContain(PID_TO)
    // 曾经的写法就是负的：-1 / -2 → 直接导致全量 unreachable
    expect(params).not.toContain(-PID_FROM)
    expect(params).not.toContain(-PID_TO)
  })

  it('shortestPathByPoints：points_sql 内是正 pid，函数入参是负 pid（两者方向相反）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')

    const sql = calls[0].sql
    expect(sql).toContain(`${PID_FROM}::int AS pid`)
    expect(sql).toContain(`${PID_TO}::int AS pid`)
    // 入参才是负值（pgRouting：Negative value is for point's identifier）
    expect(calls[0].params).toEqual([-PID_FROM, -PID_TO])
  })
})

describe('RouteRepository.snapPoints - SQL 契约', () => {
  it('吸附查询限定可通行边 + 主干分量（cost_m > 0 AND main_comp IS TRUE）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).snapPoints(108.6, 21.7, 108.7, 21.75, 2000)

    const sql = calls[0].sql
    expect(sql).toContain('main_comp IS TRUE')
    expect(sql).toContain('cost_m > 0')
    expect(sql).toContain('geom IS NOT NULL')
    // KNN 取最近边 + 沿边投影：对齐 graph.py 的 _snap_query / _attach
    expect(sql).toContain('<->')
    expect(sql).toContain('ST_LineLocatePoint')
    // 吸附半径以参数注入（写死 2000 会让 SNAP_RADIUS_M 失效）
    expect(calls[0].params).toContain(2000)
  })

  it('吸附 fraction 夹到 (0,1) 开区间（fraction=1 会让 pgr_withPoints 静默返回 0 行）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).snapPoints(108.6, 21.7, 108.7, 21.75, 2000)

    const sql = calls[0].sql
    // 2026-09-12 事故：港口/设施点多贴着路段末端 → ST_LineLocatePoint 返回恰 1.0 →
    // pgr_withPoints **不报错、返回 0 行** → 上游判成 unreachable（表现为"任何路都走不通"）
    expect(sql).toContain('LEAST(')
    expect(sql).toContain('GREATEST(')
    expect(sql).toContain('1 - 1e-6')
    expect(sql).toContain('1e-6')
  })
})

describe('RouteRepository.shortestPathByPoints - SQL 契约', () => {
  it('吸附标识超 2^53（Number 归一会静默失真）→ fail-loud 拒绝寻路（审查 L-5）', async () => {
    const { db } = makeDbMock()
    const unsafeSnaps: SnapRow[] = [
      { pid: PID_FROM, edge_id: '9007199254740993', fraction: 0.25, snap_m: 1 }, // 2^53+1
      { pid: PID_TO, edge_id: '2002', fraction: 0.75, snap_m: 1 },
    ]
    await expect(
      new RouteRepository(db).shortestPathByPoints(unsafeSnaps, 'distance')
    ).rejects.toThrow(/超安全范围/)
  })

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

  it('回带该边的 source/target，供上层判定行进方向（部分边截取必需）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')
    const sql = calls[0].sql
    expect(sql).toContain('edge_source')
    expect(sql).toContain('edge_target')
    expect(sql).toContain(`LEFT JOIN ${ROUTING_TABLE}`)
  })

  it('有向图语义：directed := true + cost/reverse_cost 分列（v2 路网，单向边 reverse=-1 表达不可行方向）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).shortestPathByPoints(SNAPS, 'distance')
    // 旧网 oneway 全 NULL、pgr 以 directed := false 跑 → 单行道可逆行（高速逆行事故根源）。
    // v2 顶点=OSM node id，oneway 真值 11 万条；directed 与反向列必须成对出现。
    expect(calls[0].sql).toContain('directed := true')
    expect(calls[0].sql).toContain('reverse_cost_m AS reverse_cost')
    expect(calls[0].sql).not.toContain('directed := false')
  })

  it('mode 决定权重列：distance→cost_m，time→route_cost_min（等级偏好只影响选路）', async () => {
    const a = makeDbMock()
    await new RouteRepository(a.db).shortestPathByPoints(SNAPS, 'distance')
    expect(a.calls[0].sql).toContain('cost_m AS cost')
    expect(a.calls[0].sql).not.toContain('cost_min')

    const b = makeDbMock()
    await new RouteRepository(b.db).shortestPathByPoints(SNAPS, 'time')
    // v2：time 口径给 pgr 的是加权代价 route_cost_min（物理时间 × 等级偏好），
    // 对外报告的分钟数仍取物理 cost_min（见 sumSegmentCosts 契约）
    expect(b.calls[0].sql).toContain('route_cost_min AS cost')
    expect(b.calls[0].sql).toContain('route_reverse_cost_min AS reverse_cost')
  })
})

describe('路由表选择（2026-09-10：必须走切分表）', () => {
  it('所有查询都指向 ROUTING_TABLE，不得回落到未切分的原始 roads', async () => {
    const { db, calls } = makeDbMock()
    const repo = new RouteRepository(db)
    await repo.snapPoints(108.6, 21.7, 108.7, 21.75, 2000)
    await repo.shortestPathByPoints(SNAPS, 'distance')
    await repo.sumSegmentCosts(SEGMENTS, 'distance')
    await repo.segmentGeometry(SEGMENTS)

    for (const { sql } of calls) {
      // 原始 roads 只形成 56,418 个连通分量（最大覆盖 30.3%），回落即服务范围腰斩
      expect(sql).not.toMatch(/\bFROM roads\b/)
      expect(sql).not.toMatch(/\bJOIN roads\b/)
    }
    expect(calls[0].sql).toContain(`FROM ${ROUTING_TABLE}`)
    expect(calls[1].sql).toContain(`FROM ${ROUTING_TABLE}`)
    expect(calls[1].sql).toContain(`LEFT JOIN ${ROUTING_TABLE}`)
    expect(calls[2].sql).toContain(`JOIN ${ROUTING_TABLE} r`)
    expect(calls[3].sql).toContain(`JOIN ${ROUTING_TABLE} r`)
  })
})

describe('RouteRepository.sumSegmentCosts - 分段费用折算', () => {
  it('两口径均按分段几何区间 (hi-lo) × 边全长折算（与选路权重解耦，time 面板数字不被偏好放大）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).sumSegmentCosts(SEGMENTS, 'distance')

    const sql = calls[0].sql
    // v2：三个数组参数（edge_id/lo/hi）。旧形态 `t.cost ÷ 该边全长` 在 time 口径下
    // 会被 pgr 返回的加权代价污染（偏好乘数混进里程/时长报告），已废
    expect(sql).toContain(
      'ROWS FROM (unnest($1::bigint[]), unnest($2::float8[]), unnest($3::float8[]))'
    )
    expect(sql).toContain('(t.hi - t.lo) * r.cost_m')
    expect(sql).toContain('(t.hi - t.lo) * r.cost_min')
    expect(calls[0].params).toEqual([
      [1001, 2002],
      [0.25, 0],
      [1, 0.75],
    ])
  })

  it('time 口径：mode_metric 取物理 cost_min（选路用 route_cost_min，报告不放大）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).sumSegmentCosts(SEGMENTS, 'time')
    expect(calls[0].sql).toContain('(t.hi - t.lo) * r.cost_min')
    expect(calls[0].sql).not.toContain('route_cost_min')
  })

  it('空分段不应发起 SQL', async () => {
    const { db, calls } = makeDbMock()
    expect(await new RouteRepository(db).sumSegmentCosts([], 'distance')).toEqual({
      distanceM: 0,
      durationMin: 0,
    })
    expect(calls).toHaveLength(0)
  })
})

describe('RouteRepository.segmentGeometry - 分段几何', () => {
  it('按 lo~hi 截取（ST_LineSubstring），并带 WITH ORDINALITY 保序', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).segmentGeometry(SEGMENTS)

    const sql = calls[0].sql
    expect(sql).toContain('ST_LineSubstring(r.geom, t.lo, t.hi)')
    expect(sql).toContain('WITH ORDINALITY')
    expect(calls[0].params).toEqual([
      [1001, 2002],
      [0.25, 0],
      [1, 0.75],
    ])
  })

  it('ST_DumpPoints 的别名必须给全三个并把几何绑到 geom 上（2026-09-10 500 的回归护栏）', async () => {
    const { db, calls } = makeDbMock()
    await new RouteRepository(db).segmentGeometry(SEGMENTS)
    const sql = calls[0].sql

    // ST_DumpPoints 返回 geometry_dump(path, geom) + WITH ORDINALITY 的序号 = 3 列。
    // 曾写成 `AS dp(g, g_ord)`：g 被绑到 path（integer[]）上 → ST_X(integer[]) → 类型错 → 线上 500。
    expect(sql).toContain('AS dp(path, geom, ord)')
    expect(sql).toContain('ST_X(dp.geom)')
    expect(sql).toContain('ORDER BY dp.ord')
    expect(sql).not.toContain('ST_X(g)')
    expect(sql).not.toContain('AS dp(g, g_ord)')
  })

  it('空分段不应发起 SQL', async () => {
    const { db, calls } = makeDbMock()
    expect(await new RouteRepository(db).segmentGeometry([])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('RouteRepository - mode 白名单', () => {
  it('isRouteMode：仅 distance / time 通过（防注入的守门函数）', () => {
    expect(isRouteMode('distance')).toBe(true)
    expect(isRouteMode('time')).toBe(true)
    expect(isRouteMode('fastest')).toBe(false)
    expect(isRouteMode('cost_m; DROP TABLE roads')).toBe(false)
    expect(isRouteMode(undefined)).toBe(false)
    expect(isRouteMode(1)).toBe(false)
  })
})
