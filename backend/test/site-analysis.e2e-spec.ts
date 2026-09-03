import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// site-analysis e2e：连真实 backend/data/site-selection 三城 JSON（公开只读 + 纯计算，免登录）。
// 真数据规模（2026-08-29 全量重抓，口径=市辖区）：
//   qz  医院77/公园42/小区543 · bh 医院101/公园50/小区1247 · fcg 医院49/公园16/小区666
// 基线数值由 .tmp-pip/probe-site-analysis.cjs 实跑取得（T3.6 验收），非拍脑袋。
// 覆盖：三城正常选址 / TOP_N 截断 / facilityPoi 计数 / 单类型 / 真数据空结果 /
// 参数校验四态 / 422 转译 / @HttpCode(200)。
describe('site-analysis e2e（读真数据文件）', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const base = '/nest-api/site-analysis'

  const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post(base).send(body)

  const twoTypes = {
    selectedKeys: ['hospital', 'park'],
    typeSettings: {
      hospital: { defaultRadius: 3, importance: 3 },
      park: { defaultRadius: 3, importance: 3 },
    },
  }

  it('钦州 qz：hospital+park → 200，TOP_N 截断 10 条且降序', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    expect(res.body.code).toBe(200)
    // 成功信封只有 { code, data }（EnvelopeInterceptor），error 键由异常过滤器在失败时才注入
    expect(res.body).not.toHaveProperty('error')
    expect(res.body.data.error).toBeNull()
    expect(res.body.data.matchedXiaoqu).toHaveLength(10)
    const scores: number[] = res.body.data.matchedXiaoqu.map((x: { score: number }) => x.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    // 真数据实跑基线：TOP1 滨海·江语湖 94.7（hospital 94.7 / park 94.8）
    expect(res.body.data.matchedXiaoqu[0].name).toBe('滨海·江语湖')
    expect(res.body.data.matchedXiaoqu[0].score).toBe(94.7)
    expect(res.body.data.matchedXiaoqu[0].breakdown).toEqual({ hospital: 94.7, park: 94.8 })
  })

  it('北海 bh：hospital+park → 200，POI 计数与实跑一致（hospital 101 / park 50）', async () => {
    const res = await post({ ...twoTypes, city: 'bh' }).expect(200)
    expect(res.body.data.matchedXiaoqu).toHaveLength(10)
    expect(res.body.data.facilityPoi.hospital).toHaveLength(101)
    expect(res.body.data.facilityPoi.park).toHaveLength(50)
    expect(res.body.data.matchedXiaoqu[0].name).toBe('柏悦尊府')
    expect(res.body.data.matchedXiaoqu[0].score).toBe(96.6)
  })

  it('防城港 fcg：hospital+park → 200，POI 计数与实跑一致（hospital 49 / park 16）', async () => {
    const res = await post({ ...twoTypes, city: 'fcg' }).expect(200)
    expect(res.body.data.matchedXiaoqu).toHaveLength(10)
    expect(res.body.data.facilityPoi.hospital).toHaveLength(49)
    expect(res.body.data.facilityPoi.park).toHaveLength(16)
    expect(res.body.data.matchedXiaoqu[0].name).toBe('金海湾小区C4组团')
    expect(res.body.data.matchedXiaoqu[0].score).toBe(95.6)
  })

  it('钦州 qz：单类型 hospital → 200（求交退化：单覆盖直接作为最终覆盖区）', async () => {
    const res = await post({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
      city: 'qz',
    }).expect(200)
    expect(res.body.data.matchedXiaoqu).toHaveLength(10)
    expect(res.body.data.facilityPoi.hospital).toHaveLength(77)
    expect(res.body.data.matchedXiaoqu[0].name).toBe('金鼓安置房小区')
    expect(res.body.data.matchedXiaoqu[0].score).toBe(98.1)
    expect(res.body.data.matchedXiaoqu[0].breakdown).toEqual({ hospital: 98.1 })
  })

  it('coverage 为 MultiPolygon（多设施缓冲区分治 union 的真实产物）', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    expect(res.body.data.coverage).toBeTruthy()
    expect(res.body.data.coverage.geometry.type).toBe('MultiPolygon')
    expect(res.body.data.coverage.geometry.coordinates.length).toBeGreaterThan(0)
  })

  it('非法 city（路径穿越串）回落默认城市 qz，不 4xx（选址是纯计算接口）', async () => {
    const res = await post({ ...twoTypes, city: '../../etc/passwd' }).expect(200)
    // 回落 qz → 与 qz 基线一致
    expect(res.body.data.matchedXiaoqu[0].name).toBe('滨海·江语湖')
    expect(res.body.data.facilityPoi.hospital).toHaveLength(77)
  })

  it('真数据空结果：fcg hospital+park 半径 0.3km×0.4 → empty 合法空结果，非 422', async () => {
    // 实跑基线（probe-site-analysis-empty.cjs）：100m 缓冲下两类覆盖无交集
    const res = await post({
      selectedKeys: ['hospital', 'park'],
      typeSettings: {
        hospital: { defaultRadius: 0.3, importance: 1 },
        park: { defaultRadius: 0.3, importance: 1 },
      },
      city: 'fcg',
    }).expect(200)
    expect(res.body.data.error).toBeNull()
    expect(res.body.data.empty).toBe(true)
    expect(res.body.data.emptyReason).toBe('park 的覆盖范围与其他类型无重叠区域')
    expect(res.body.data.coverage).toBeNull()
    expect(res.body.data.matchedXiaoqu).toEqual([])
    expect(res.body.data.facilityPoi).toEqual({})
  })

  it('缺 selectedKeys → 400 文案逐字节', async () => {
    const res = await post({ typeSettings: {} }).expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: '缺少必要参数: selectedKeys, typeSettings',
      data: null,
    })
  })

  it('缺 typeSettings → 400', async () => {
    const res = await post({ selectedKeys: ['hospital'] }).expect(400)
    expect(res.body.code).toBe(400001)
    expect(res.body.error).toBe('缺少必要参数: selectedKeys, typeSettings')
  })

  it('importance 越界（9）→ 400，且校验顺序早于未知类型检查', async () => {
    const res = await post({
      selectedKeys: ['airport'],
      typeSettings: { airport: { importance: 9 } },
    }).expect(400)
    expect(res.body.error).toContain('应在 1-5 之间')
  })

  it('未知设施类型 → 400，文案带可用类型清单', async () => {
    const res = await post({
      selectedKeys: ['airport'],
      typeSettings: { airport: { defaultRadius: 3, importance: 3 } },
    }).expect(400)
    expect(res.body.error).toBe(
      '未知设施类型: airport，可用类型: hospital, primary_school, middle_school, park, bus_station, mall'
    )
  })

  it('radius 为负 → 400', async () => {
    const res = await post({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3, radius: -5 } },
    }).expect(400)
    expect(res.body.error).toBe('设施类型 hospital 的半径无效，应为正数')
  })

  it('weights 越界（99）→ 400', async () => {
    const res = await post({ ...twoTypes, weights: { hospital: 99 } }).expect(400)
    expect(res.body.error).toBe('权重 hospital 无效，应为 0-10 之间的数字')
  })

  it('weights 非对象 → 400', async () => {
    const res = await post({ ...twoTypes, weights: [1, 2] }).expect(400)
    expect(res.body.error).toBe('weights 应为对象')
  })

  it('selectedKeys 为空数组 → 422（ANALYSIS_FAILED，validateSelection 文案转译）', async () => {
    const res = await post({ selectedKeys: [], typeSettings: {} }).expect(422)
    expect(res.body).toEqual({
      code: 422001,
      error: '请至少选择一种设施类型',
      data: null,
    })
  })

  it('自定义 weights 生效：仅给 park 权重 → 排序结果按 park 主导（TOP1 与等权基线不同）', async () => {
    const res = await post({
      ...twoTypes,
      city: 'qz',
      weights: { hospital: 0, park: 10 },
    }).expect(200)
    expect(res.body.data.matchedXiaoqu).toHaveLength(10)
    const scores: number[] = res.body.data.matchedXiaoqu.map((x: { score: number }) => x.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    // park 权重独大 → TOP1 应与默认权重下的滨海·江语湖不同（等权时 hospital 1.2 > park 0.8）
    expect(res.body.data.matchedXiaoqu[0].name).not.toBe('滨海·江语湖')
    // breakdown 仍是各类型独立得分（权重只作用于总分加权，不改各因子）
    expect(res.body.data.matchedXiaoqu[0].breakdown).toHaveProperty('hospital')
    expect(res.body.data.matchedXiaoqu[0].breakdown).toHaveProperty('park')
  })
})
