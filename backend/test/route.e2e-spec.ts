import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// route e2e（审查 M-3 回归 + 审查报告"未能确认项#4"补口）。
// route 域此前未挂 @SkipThrottle：@nestjs/throttler 命名桶默认套用**所有**路由，
// 公开只读的 /route/path 被 login 桶（50/15min）误伤，15 分钟 51 次即全线 429
//（重演 flood 域事故，见 flood.controller 注释自证）。
// 限流归属断言不依赖真库：无库时请求以 5xx 收场但计数照常，429 与否足以判定桶归属；
// 寻路契约冒烟属真库范畴，V3_INTEGRATION_DB 门控（site-analysis e2e 同款）。
//
// ⚠️ 夹具依赖的用例不在此文件（2026-09-15 拆分原因）：
// 原文件里有两条用例断言的是**合成夹具图**（backend/test/seed/roads-graph-fixture.sql：3 条合成边
// A/B/C，坐标 108.6/21.6 等假点，其中 edge C 是 oneway=1 的单向边）。该夹具经 ci-seed.sh 第 ④ 步
// 灌入 CI 临时库，而 seed 注释明令「**严禁灌 beibu-gulf-data/生产库**」——所以在任何"有真实路网"的机器上，
// 这两条的期望拓扑根本不存在，必然失败（实测：本地真库 2 failed → watchdog RESULT_FAILED_TESTS → 退出 1，push 被拦）。
//
// 根因是**门控条件与实际依赖不匹配**：文件只按"有没有库"门控，却混了"库里是不是夹具图"的断言。
// 修法＝按依赖拆文件：夹具用例移入 `route.fixture.e2e-spec.ts`（V3_ROADS_FIXTURE 门控），
// 本文件只留"有真库即可"的契约冒烟。一个文件对应一个门控条件，watchdog 才能精确执法。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

describe('route e2e — 限流桶归属（无库可跑）', () => {
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

  it('公开高频只读接口 60 连发无一 429（不落入 login/register 50 桶）', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer()).get(
        '/nest-api/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=distance'
      )
      // 第 51 发起命中即 login 桶误伤（global 桶 1000/15min 远未触顶）
      expect(res.status).not.toBe(429)
    }
  })
})

describe.skipIf(!withDb)('route e2e（连真库 PostGIS）', () => {
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

  it('GET /route/path 正常寻路 → found:true 契约', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=distance'
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code: 200 })
    expect(res.body.data).toMatchObject({ found: expect.any(Boolean) })
  })

  it('参数越界 → 400001 业务错误信封', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/route/path?fromLng=999&fromLat=21.6&toLng=108.7&toLat=21.7'
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 400001 })
  })

  it('起终点落在边的端点顶点（吸附 fraction=1）仍可寻路（2026-09-12 生产事故回归）', async () => {
    // 复现：点正落在边的**终点顶点**时 ST_LineLocatePoint 返回恰 1.0，pgr_withPoints 不报错、
    // 直接返回 0 行 → 上游判成 unreachable。生产实测坐标（北海国际客运港 → 三墩一带，114.8km）
    // 在修复前即此形态；夹具上取边 B 的终点顶点 (108.8,21.8)（f=1.0000）为该形态的确定性样本。
    const res = await request(app.getHttpServer())
      .get('/nest-api/route/path?fromLng=108.8&fromLat=21.8&toLng=108.75&toLat=21.75&mode=distance')
      .expect(200)
    expect(res.body.data).toMatchObject({ found: true })
    expect(res.body.data.edgeCount).toBeGreaterThan(0)
  })

  // 注：本文件**只保留不依赖夹具图**的用例。
  // 断言合成夹具图拓扑的两条（单向边反向 unreachable / time 口径 9.0~10.5 分钟）
  // 已移入 `route.fixture.e2e-spec.ts`，由 V3_ROADS_FIXTURE 单独门控——
  // 一个文件只对应一个门控条件，watchdog 的逐文件登记才能精确执法（2026-09-15）。
})
