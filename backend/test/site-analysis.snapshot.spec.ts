import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

import { probePoiCount } from './helpers/probe-poi-count'

// site-analysis **全量真实数据快照**套件（2026-09-15 从 site-analysis.e2e-spec.ts 拆出）
//
// 这里断言的每一条都**绑定全量真实数据的具体分布**：
//   qz 医院 77 / bh 医院 101+公园 50 / fcg 医院 49+公园 16、
//   TOP1 = 滨海·江语湖 94.7 / 柏悦尊府 96.6 / 金海湾小区C4组团 95.6 / 金鼓安置房小区 98.1、
//   coverage 必为 MultiPolygon（多设施分散 → 缓冲并集分裂成多块）。
//
// ⚠️ 定位与维护约定（重要）：
//   · 这些是**数据快照**，不是不变量。**POI/小区数据一重抓或改清洗规则就必须同步更新期望值**，
//     否则会红——这是它们的性质，不是 bug；但也正因如此，它们**不能进 CI**（CI 无 AMap 源）。
//   · 能力验证请写进 site-analysis.e2e-spec.ts 的「不变量」组（那组对合成夹具与全量数据都成立）。
//   · 基线取得方式见文件头历史注释：`.local/tmp/probe-site-analysis.cjs` 实跑，非拍脑袋。
//
// 门控：V3_FULL_DATASET（**独立于项目级 V3_INTEGRATION_DB**）——
//   本地跑全量快照：export V3_INTEGRATION_DB=1 V3_FULL_DATASET=1
//   CI 不设 V3_FULL_DATASET ⇒ 整组按登记跳过（test-gate.config.json）。
//   若设了 V3_FULL_DATASET 却仍跳过，watchdog 判 GATED_SKIP_IN_REQUIRED_ENV（承诺要跑的必须真跑）。
const withDb = process.env.V3_INTEGRATION_DB !== undefined
const withFullDataset = process.env.V3_FULL_DATASET !== undefined
const poiCount = withDb ? probePoiCount() : 0

describe.skipIf(!withDb || !withFullDataset || poiCount === 0)(
  'site-analysis 全量数据快照（需 V3_FULL_DATASET=1 + 库内全量真数据）',
  () => {
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
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post(base).send(body)

    const twoTypes = {
      selectedKeys: ['hospital', 'park'],
      typeSettings: {
        hospital: { defaultRadius: 3, importance: 3 },
        park: { defaultRadius: 3, importance: 3 },
      },
    }

    it('钦州 qz：hospital+park → TOP_N 截断 10 条且降序，TOP1 滨海·江语湖 94.7', async () => {
      const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
      expect(res.body.data.matchedXiaoqu).toHaveLength(10)
      const scores: number[] = res.body.data.matchedXiaoqu.map((x: { score: number }) => x.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
      expect(res.body.data.matchedXiaoqu[0].name).toBe('滨海·江语湖')
      expect(res.body.data.matchedXiaoqu[0].score).toBe(94.7)
      expect(res.body.data.matchedXiaoqu[0].breakdown).toEqual({ hospital: 94.7, park: 94.8 })
    })

    it('北海 bh：POI 计数与实跑一致（hospital 101 / park 50），TOP1 柏悦尊府 96.6', async () => {
      const res = await post({ ...twoTypes, city: 'bh' }).expect(200)
      expect(res.body.data.matchedXiaoqu).toHaveLength(10)
      expect(res.body.data.facilityPoi.hospital).toHaveLength(101)
      expect(res.body.data.facilityPoi.park).toHaveLength(50)
      expect(res.body.data.matchedXiaoqu[0].name).toBe('柏悦尊府')
      expect(res.body.data.matchedXiaoqu[0].score).toBe(96.6)
    })

    it('防城港 fcg：POI 计数与实跑一致（hospital 49 / park 16），TOP1 金海湾小区C4组团 95.6', async () => {
      const res = await post({ ...twoTypes, city: 'fcg' }).expect(200)
      expect(res.body.data.matchedXiaoqu).toHaveLength(10)
      expect(res.body.data.facilityPoi.hospital).toHaveLength(49)
      expect(res.body.data.facilityPoi.park).toHaveLength(16)
      expect(res.body.data.matchedXiaoqu[0].name).toBe('金海湾小区C4组团')
      expect(res.body.data.matchedXiaoqu[0].score).toBe(95.6)
    })

    it('钦州 qz：单类型 hospital → hospital 77，TOP1 金鼓安置房小区 98.1', async () => {
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

    it('coverage 为 MultiPolygon（全量数据下多设施分散 → 缓冲并集分裂成多块）', async () => {
      // 注：这是**数据分布快照**。合成夹具（同类设施聚簇）下并集是单个 Polygon——
      // 故"不变量"版本只断言 ∈ {Polygon, MultiPolygon}，见 site-analysis.e2e-spec.ts。
      const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
      expect(res.body.data.coverage).toBeTruthy()
      expect(res.body.data.coverage.geometry.type).toBe('MultiPolygon')
      expect(res.body.data.coverage.geometry.coordinates.length).toBeGreaterThan(0)
    })

    it('非法 city 回落 qz：结果与 qz 基线一致', async () => {
      const res = await post({ ...twoTypes, city: '../../etc/passwd' }).expect(200)
      expect(res.body.data.matchedXiaoqu[0].name).toBe('滨海·江语湖')
      expect(res.body.data.facilityPoi.hospital).toHaveLength(77)
    })

    it('真数据空结果：fcg 半径 0.3km×0.4 → empty 合法空结果，非 422', async () => {
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
  }
)
