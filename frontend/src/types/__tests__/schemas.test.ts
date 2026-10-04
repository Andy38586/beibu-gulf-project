import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  authResponseSchema,
  boundaryCacheSchema,
  favoriteAddResponseSchema,
  favoriteItemSchema,
  favoriteRemoveResponseSchema,
  favoritesArraySchema,
  floodAreasResponseSchema,
  floodDisasterResponseSchema,
  floodStatisticsResponseSchema,
  taskSubmitResponseSchema,
  taskViewResponseSchema,
  forecastIndicatorIndexSchema,
  forecastMapDataSchema,
  indicatorComparisonResponseSchema,
  planSchema,
  poiSearchResponseSchema,
  portSchema,
  portsArraySchema,
  routePathResponseSchema,
  siteSuitabilityDefaultsSchema,
  siteSuitabilityResponseSchema,
  canalLineResponseSchema,
  diversionBreakdownResponseSchema,
  terrainProfileSchema,
  timeSeriesResponseSchema,
  waterAreaSchema,
} from '../schemas'

/**
 * schemas 运行时校验测试：用真实数据 + 构造样本双向验证——
 * 真实数据必须通过（否则线上断链）、畸形数据必须被拒绝。
 */
const DATA_DIR = join(__dirname, '../../../../backend/data')

/**
 * 存量 plan 记录形态回归（fixture 化）：
 * 原用例读 backend/data/plans.json（运行时用户数据、不入库），该文件本地与 CI 均不存在
 * → skipIf 恒跳过、从未真跑（z150-⑥ 实锤）。此处固化存量记录的三种关键形态，
 * 恢复「旧记录不得被 schema 拒绝」的回归语义，且环境无关恒运行。
 */
const legacyPlanFixtures = [
  // 旧形态 A：最早一批记录——无 savedXiaoqu、weights=null、无浸没字段
  {
    id: 'legacy-1',
    userId: 'u1',
    name: '旧方案A',
    selectedKeys: ['hospital'],
    typeSettings: {},
    weights: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  // 旧形态 B：weights 键从未写入（undefined，而非 null）
  {
    id: 'legacy-2',
    userId: 'u1',
    name: '旧方案B',
    selectedKeys: [],
    typeSettings: { hospital: true },
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  // 新形态 C：含 savedXiaoqu 与浸没载荷（M-1 回归字段）+ 可选业务字段
  {
    id: 'new-1',
    userId: 'u2',
    name: '新方案',
    selectedKeys: ['port'],
    typeSettings: {},
    savedXiaoqu: [{ id: 'xq-1', name: '小区' }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    businessType: 'flood',
    waterLevel: 2.5,
    totalLoss: 1200,
    floodRiskLevel: '中风险',
  },
]

describe('planSchema（存量记录形态回归：fixture 固化，环境无关）', () => {
  it('存量旧记录与新记录全部通过（含无 savedXiaoqu / weights=null 的旧记录）', () => {
    for (const plan of legacyPlanFixtures) {
      const result = planSchema.safeParse(plan)
      expect(
        result.success,
        `plan ${plan.id} 校验失败: ${JSON.stringify(result.error?.issues)}`
      ).toBe(true)
    }
  })

  it('缺 id 的畸形对象被拒绝', () => {
    const result = planSchema.safeParse({ name: 'no-id' })
    expect(result.success).toBe(false)
  })

  it('浸没方案载荷（审查 M-1 回归）：合法 floodFeatures/floodStatistics 通过', () => {
    const plan = {
      id: 'p1',
      userId: 'u1',
      name: '浸没方案',
      selectedKeys: ['hospital'],
      typeSettings: {},
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      waterLevel: 5,
      floodRiskLevel: '高风险',
      totalLoss: 1200,
      floodFeatures: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
          properties: { riskLevel: '高风险' },
        },
      ],
      floodStatistics: { riskLevel: '高风险', waterLevel: 5 },
      affectedFacilities: [
        { id: 'f1', name: '港', type: 'port', lng: 1, lat: 2, loss: 0, damageRate: 0 },
      ],
    }
    const result = planSchema.safeParse(plan)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('浸没方案载荷：features 缺 geometry 被拒绝（不再静默透传/清空）', () => {
    const plan = {
      id: 'p2',
      userId: 'u1',
      name: '畸形方案',
      selectedKeys: ['hospital'],
      typeSettings: {},
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      floodFeatures: [{ type: 'Feature', properties: {} }],
    }
    const result = planSchema.safeParse(plan)
    expect(result.success).toBe(false)
  })

  it('浸没方案载荷：floodStatistics 缺 riskLevel 被拒绝', () => {
    const plan = {
      id: 'p3',
      userId: 'u1',
      name: '缺风险等级',
      selectedKeys: [],
      typeSettings: {},
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      floodStatistics: { waterLevel: 5 },
    }
    expect(planSchema.safeParse(plan).success).toBe(false)
  })
})

describe('task 通道响应契约（useTaskApi 三点运行期校验共用同一份 schema）', () => {
  const view = {
    taskId: 't1',
    domain: 'flood-areas',
    route: '/flood-analysis',
    status: 'running',
    progress: 0.1,
    retryCount: 0,
    createdAt: 1,
  }

  it('合法 TaskView / 提交响应通过（可选字段可缺可多）', () => {
    expect(taskViewResponseSchema.safeParse(view).success).toBe(true)
    expect(
      taskViewResponseSchema.safeParse({
        ...view,
        status: 'done',
        result: { ok: 1 },
        queuePosition: undefined,
        finishedAt: 2,
        // looseObject：后端加字段不算违约
        extraFromBackend: 'x',
      }).success
    ).toBe(true)
    expect(
      taskSubmitResponseSchema.safeParse({
        taskId: 't1',
        status: 'pending',
        queuePosition: 1,
        createdAt: 1,
      }).success
    ).toBe(true)
  })

  it('🔴 后端删/改名必填字段 ⇒ 运行期校验失败（旧形态只有 TS 泛型，形状对不上无人知）', () => {
    for (const key of ['status', 'progress', 'retryCount', 'createdAt'] as const) {
      const broken: Record<string, unknown> = { ...view }
      delete broken[key]
      expect(taskViewResponseSchema.safeParse(broken).success, `缺 ${key} 应被拒`).toBe(false)
    }
    // 提交响应的 queuePosition 也是必填（提交当下就要告诉用户排第几位）
    expect(
      taskSubmitResponseSchema.safeParse({ taskId: 't1', status: 'pending', createdAt: 1 }).success
    ).toBe(false)
  })

  it('域/状态枚举越界被拒（枚举由运行期数组派生，不是 z.string()）', () => {
    expect(taskViewResponseSchema.safeParse({ ...view, domain: 'unknown-domain' }).success).toBe(
      false
    )
    expect(taskViewResponseSchema.safeParse({ ...view, status: 'finished' }).success).toBe(false)
    expect(taskViewResponseSchema.safeParse({ ...view, domain: 'forecast-map' }).success).toBe(true)
  })
})

describe('floodStatisticsResponseSchema（契约字段集合与后端产出对齐）', () => {
  it('🔴 不得声明后端不产出的字段：affectedCount 已删（它由 adapter 旧占位遗留，前后端均无人写读）', () => {
    const shape = floodStatisticsResponseSchema.shape as Record<string, unknown>
    // 后端 flood.service 产出的是 affectedFacilityCount（计数语义改名后的字段）
    expect('affectedFacilityCount' in shape).toBe(true)
    // 保留这个字段会让 types:check 以为存在一份并不存在的契约（正向字段集比对会漏）
    expect('affectedCount' in shape).toBe(false)
  })
})

describe('terrainProfileSchema（真实 terrainProfile.json 校验）', () => {
  it('真实 profiles 数组全部通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/terrainProfile.json'), 'utf8'))
    const result = terrainProfileSchema.safeParse(data.profiles)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('缺 points 的畸形 profile 被拒绝', () => {
    const result = terrainProfileSchema.safeParse([{ id: 'x', name: 'y', points: 'bad' }])
    expect(result.success).toBe(false)
  })
})

describe('waterAreaSchema（真实 water-area.json 校验）', () => {
  it('真实 coordinates 全部通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/water-area.json'), 'utf8'))
    const result = waterAreaSchema.safeParse(data.coordinates)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('畸形坐标被拒绝', () => {
    const result = waterAreaSchema.safeParse([
      [108, 21],
      ['bad', 21],
    ])
    expect(result.success).toBe(false)
  })
})

describe('authResponseSchema', () => {
  it('login/me 响应通过（token 可选）', () => {
    const withToken = authResponseSchema.safeParse({
      user: { id: '1', username: 'u', createdAt: '2026-01-01' },
      token: 'abc',
    })
    const withoutToken = authResponseSchema.safeParse({
      user: { id: '1', username: 'u', createdAt: '2026-01-01' },
    })
    expect(withToken.success).toBe(true)
    expect(withoutToken.success).toBe(true)
  })

  it('缺 user 被拒绝', () => {
    const result = authResponseSchema.safeParse({ token: 'abc' })
    expect(result.success).toBe(false)
  })
})

describe('forecast schemas（构造样本）', () => {
  const point = { time: '2018-01', value: 100, type: 'historical' as const }

  it('timeSeriesResponseSchema 通过/拒绝', () => {
    const ok = timeSeriesResponseSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      granularity: 'monthly',
      canalScenario: 'baseline',
      series: [{ portId: 'qinzhou', portName: '钦州', data: [point] }],
    })
    expect(ok.success).toBe(true)
    // canalScenario 缺失必须拒（F5 起后端恒产出；前端凭它核对回包情景）
    expect(
      timeSeriesResponseSchema.safeParse({
        indicator: 'cargo',
        unit: '万吨',
        granularity: 'monthly',
        series: [],
      }).success
    ).toBe(false)
    const bad = timeSeriesResponseSchema.safeParse({ indicator: 'cargo' })
    expect(bad.success).toBe(false)
  })

  it('indicatorComparisonResponseSchema 通过/拒绝', () => {
    const ok = indicatorComparisonResponseSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      canalScenario: 'design',
      ports: { qinzhou: { portName: '钦州', value: 100, historical: [point], forecast: [] } },
    })
    expect(ok.success).toBe(true)
    expect(
      indicatorComparisonResponseSchema.safeParse({ indicator: 'cargo', ports: {} }).success
    ).toBe(false)
  })

  it('forecastMapDataSchema 通过/拒绝（GeoJSON 结构）', () => {
    const ok = forecastMapDataSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      time: '2026-06',
      canalScenario: 'baseline',
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108, 21] },
          properties: { portId: 'qinzhou', portName: '钦州', value: 100 },
        },
      ],
    })
    expect(ok.success).toBe(true)
    expect(
      forecastMapDataSchema.safeParse({ type: 'FeatureCollection', features: [] }).success
    ).toBe(false)
  })

  it('forecastIndicatorIndexSchema 通过/拒绝', () => {
    const ok = forecastIndicatorIndexSchema.safeParse({
      metadata: {
        version: '1',
        lastUpdated: '2026-01-01',
        ports: [{ id: 'qinzhou', name: '钦州', lat: 21, lng: 108 }],
        indicators: ['cargo'],
      },
      historical: { start: '2018-01', end: '2025-12' },
      forecast: { start: '2026-01', end: '2035-12' },
    })
    expect(ok.success).toBe(true)
    expect(forecastIndicatorIndexSchema.safeParse({}).success).toBe(false)
  })
})

describe('flood schemas（真实数据 + 构造样本）', () => {
  it('floodStatisticsResponseSchema 用真实 floodStatistics.json 元素通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/floodStatistics.json'), 'utf8'))
    const result = floodStatisticsResponseSchema.safeParse(data.statistics[0])
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('floodAreasResponseSchema 通过/拒绝', () => {
    const ok = floodAreasResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中风险',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [108, 21],
                [109, 21],
                [109, 22],
                [108, 21],
              ],
            ],
          },
          properties: { riskLevel: '中风险' },
        },
      ],
    })
    const bad = floodAreasResponseSchema.safeParse({ features: [] }) // 缺 waterLevel/riskLevel
    // D1：元素级深校验——geometry 缺失/坐标畸形均拒绝（原 z.array(z.unknown()) 放行）
    const badGeom = floodAreasResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中风险',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: 'oops' } }],
    })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
    expect(badGeom.success).toBe(false)
  })

  it('floodDisasterResponseSchema 通过/拒绝', () => {
    const ok = floodDisasterResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中',
      affectedFacilities: [
        {
          id: 'f1',
          name: '油库',
          type: 'oil',
          lng: 108.5,
          lat: 21.5,
          loss: 100,
          damageRate: 0.9,
        },
      ],
      totalLoss: 100,
    })
    const bad = floodDisasterResponseSchema.safeParse({ riskLevel: '中' }) // 缺 totalLoss
    // D1：元素级深校验——缺 loss 的畸形设施拒绝
    const badFac = floodDisasterResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中',
      affectedFacilities: [{ id: 'f1', name: '油库' }],
      totalLoss: 100,
    })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
    expect(badFac.success).toBe(false)
  })

  it('floodDisasterResponseSchema 容忍无淹没档位缺 waterLevel（零影响契约）', () => {
    // 后端 assessDisaster 在无多边形档返回 waterLevel: undefined → JSON 丢弃该键
    //（flood.e2e-spec.ts 断言）。schema 若必填会导致校验失败、影响评估被丢弃，
    // 面板残留上一档设施/损失（2026-09-12 实测缺陷的回归锁定）。
    const zeroImpact = floodDisasterResponseSchema.safeParse({
      requestedWaterLevel: 0,
      riskLevel: '无风险',
      affectedFacilities: [],
      totalLoss: 0,
    })
    expect(zeroImpact.success).toBe(true)
    expect(zeroImpact.success && zeroImpact.data.waterLevel).toBeUndefined()
  })
})

describe('poiSearch schemas（构造样本双向验证）', () => {
  it('poiSearchResponseSchema 合法 POI 数组通过', () => {
    const ok = poiSearchResponseSchema.safeParse([
      {
        id: 'poi-1',
        name: '北海港码头',
        type: 'port',
        source: 'port', // 多源点集来源标签（港口/设施点/小区/POI）
        city: '北海市',
        district: '海城区',
        lng: 109.1,
        lat: 21.5,
      },
    ])
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true)
  })

  it('poiSearchResponseSchema 缺字段的畸形元素被拒绝（元素级深校验）', () => {
    const bad = poiSearchResponseSchema.safeParse([
      { id: 'poi-1', name: '缺 city/lng/lat' }, // 其余必填字段缺失
    ])
    expect(bad.success).toBe(false)
  })

  it('poiSearchResponseSchema 非数组载体被拒绝', () => {
    const bad = poiSearchResponseSchema.safeParse({ id: 'poi-1' })
    expect(bad.success).toBe(false)
  })
})

// 契约覆盖补齐：以下 8 个 schema 曾被生成器判「schemas.test.ts 未引用」——
// 旧生成器 nestedRefs 用 slice-to-EOF 使该检查恒不报告（告警恒 0），修复后首次转红。
// 这里补真实双向验证（合法样本通过 / 畸形样本被拒），把覆盖缺口真正闭合。
describe('契约覆盖补齐的 schema（生成器门禁转红后补）', () => {
  const portSample = {
    id: 'port-1',
    name: '钦州港',
    address: '广西钦州',
    lng: 108.6,
    lat: 21.8,
  }
  const favoriteSample = {
    id: 'fav-1',
    userId: 'u-1',
    itemType: 'xiaoqu' as const,
    itemId: 'xq-1',
    name: '腾龙阁小区',
    lng: 108.61,
    lat: 21.94,
    snapshot: { score: 85.2 },
    savedAt: '2026-09-22T00:00:00.000Z',
  }

  it('boundaryCacheSchema：合法缓存通过；type 非 FeatureCollection 拒绝', () => {
    const ok = boundaryCacheSchema.safeParse({
      data: { type: 'FeatureCollection', features: [] },
      timestamp: 1757000000000,
    })
    const bad = boundaryCacheSchema.safeParse({
      data: { type: 'Feature', features: [] },
      timestamp: 1,
    })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
  })

  it('diversionBreakdownResponseSchema：转移/分摊/桑基流三段齐全', () => {
    const ok = diversionBreakdownResponseSchema.safeParse({
      year: 2035,
      transfer: { year: 2035, coal: 428.68, grain: 837.555, ironOre: 313.64, sandCement: 0 },
      byPort: { qinzhou: { coal: 201.48, grain: 393.65, ironOre: 147.41, total: 742.54 } },
      sankeyFlows: [
        { from: '西江上行货', to: '平陆运河', value: 742.54 },
        { from: '平陆运河', to: '钦州港', value: 742.54 },
      ],
    })
    expect(ok.success).toBe(true)
    // sandCement 缺失拒绝（恒 0 负结果锚点必须显式在场）
    expect(
      diversionBreakdownResponseSchema.safeParse({
        year: 2035,
        transfer: { year: 2035, coal: 1, grain: 1, ironOre: 1 },
        byPort: {},
        sankeyFlows: [],
      }).success
    ).toBe(false)
  })

  it('canalLineResponseSchema：裸经纬度对线位（示意线真实形状）通过；单点线/非数对拒绝', () => {
    const ok = canalLineResponseSchema.safeParse({
      lines: [
        {
          name: '平陆运河（示意线）',
          section: '起点-平塘江口',
          coordinates: [
            [109.29, 22.7],
            [108.95, 22.05],
            [108.62, 21.87],
          ],
        },
      ],
    })
    expect(ok.success).toBe(true)
    // 单点线拒绝（线至少 2 点——防后端几何退化静默放行）
    expect(
      canalLineResponseSchema.safeParse({
        lines: [{ name: null, section: null, coordinates: [[108.62, 21.87]] }],
      }).success
    ).toBe(false)
    // 三元组（混入高程）拒绝——契约钉死 [lng,lat] 二元对
    expect(
      canalLineResponseSchema.safeParse({
        lines: [
          {
            name: null,
            section: null,
            coordinates: [
              [1, 2, 3],
              [4, 5, 6],
            ],
          },
        ],
      }).success
    ).toBe(false)
  })

  it('siteSuitabilityResponseSchema：格网 GeoJSON + metadata 权重口径', () => {
    const ok = siteSuitabilityResponseSchema.safeParse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108.6, 21.9] },
          properties: { id: 1, score: 0.7234, land: 0.5 },
        },
      ],
      metadata: {
        count: 1,
        weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
        weightsSource: 'ahp-default',
        kdeP99: 0.00004,
        minLandFrac: 0.5,
      },
    })
    expect(ok.success).toBe(true)
    // score 缺失拒绝（端点恒产出）；metadata 缺失拒绝
    expect(
      siteSuitabilityResponseSchema.safeParse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 1 },
          },
        ],
        metadata: { count: 0, weights: {}, weightsSource: 'query', kdeP99: 0, minLandFrac: 0.5 },
      }).success
    ).toBe(false)
    expect(
      siteSuitabilityResponseSchema.safeParse({ type: 'FeatureCollection', features: [] }).success
    ).toBe(false)
  })

  it('siteSuitabilityDefaultsSchema:后端 getDefaults 形状直收;缺字段拒绝', () => {
    const ok = siteSuitabilityDefaultsSchema.safeParse({
      weights: {
        inundation: 0.4299,
        terrain: 0.0845,
        land: 0.2059,
        access: 0.1097,
        demand: 0.1699,
      },
      thresholds: {
        inundLowM: 1,
        inundHighM: 6,
        slopeBestDeg: 5,
        slopeWorstDeg: 20,
        portScaleM: 8000,
        roadScaleM: 2000,
      },
      minLandFrac: 0.5,
      resolution: 0,
      source: 'SITE_AHP_MATRIX@2026-09-30',
    })
    expect(ok.success).toBe(true)
    expect(
      siteSuitabilityDefaultsSchema.safeParse({
        weights: { inundation: 0.4 },
        minLandFrac: 0.5,
        resolution: 0,
        source: 'x',
      }).success
    ).toBe(false)
  })

  it('portsArraySchema：前端托管 ports.json 通过；元素缺字段拒绝', () => {
    // ports.json 2026-08-29 自后端回迁为前端静态资产（public/data），不再走 backend/data
    const data = JSON.parse(
      readFileSync(join(__dirname, '../../../public/data/ports.json'), 'utf8')
    )
    expect(portsArraySchema.safeParse(data).success).toBe(true)
    expect(portsArraySchema.safeParse([{ id: 'p1', name: '缺坐标' }]).success).toBe(false)
    expect(portSchema.safeParse(portSample).success).toBe(true)
  })

  it('favoritesArraySchema：合法数组通过；itemType 越界元素拒绝', () => {
    expect(favoritesArraySchema.safeParse([favoriteSample]).success).toBe(true)
    expect(
      favoritesArraySchema.safeParse([{ ...favoriteSample, itemType: 'planet' }]).success
    ).toBe(false)
    expect(favoriteItemSchema.safeParse(favoriteSample).success).toBe(true)
  })

  it('favoriteAddResponseSchema / favoriteRemoveResponseSchema 通过/拒绝', () => {
    expect(
      favoriteAddResponseSchema.safeParse({ favorite: favoriteSample, existed: false }).success
    ).toBe(true)
    expect(favoriteAddResponseSchema.safeParse({ favorite: {}, existed: false }).success).toBe(
      false
    )
    expect(favoriteRemoveResponseSchema.safeParse({ removed: true }).success).toBe(true)
    expect(favoriteRemoveResponseSchema.safeParse({}).success).toBe(false)
  })

  it('routePathResponseSchema：成功/合法空两形态通过；判别键分派', () => {
    const found = routePathResponseSchema.safeParse({
      found: true,
      mode: 'distance',
      distanceM: 1200,
      durationMin: 3.5,
      snapDistanceM: { from: 12, to: 8 },
      edgeCount: 3,
      coordinates: [
        [108.6, 21.8],
        [108.61, 21.81],
      ],
    })
    const empty = routePathResponseSchema.safeParse({ found: false, reason: 'unreachable' })
    expect(found.success).toBe(true)
    expect(empty.success).toBe(true)
    // 判别联合按 found 分派：成功形态缺 distanceM 被拒；reason 越界被拒
    expect(
      routePathResponseSchema.safeParse({
        found: true,
        mode: 'distance',
        durationMin: 3.5,
        snapDistanceM: { from: 12, to: 8 },
        edgeCount: 3,
        coordinates: [],
      }).success
    ).toBe(false)
    expect(routePathResponseSchema.safeParse({ found: false, reason: 'lost' }).success).toBe(false)
    // z.object 默认剥离去弃键：空结果上夹带的 distanceM 被剥掉（不进 data），
    // 消费方拿到的仍是干净的 {found,reason}（schemas.ts:357-371 契约）
    const stripped = routePathResponseSchema.safeParse({
      found: false,
      reason: 'unreachable',
      distanceM: 1,
    })
    expect(stripped.success).toBe(true)
    expect(stripped.success && 'distanceM' in stripped.data).toBe(false)
  })
})
