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

  it('单向边：正向可达；反向 unreachable（v2 有向图，旧网 directed:=false 会反向畅通）', async () => {
    // 夹具 edge C（node3→node4，oneway=1，reverse_cost_m=-1）。
    // 旧实现（无反向代价 + directed := false）下，node4→node3 会照常"畅通"——
    // 这正是生产上"高速可逆行"的形态；本用例把它钉死。
    const base = '/nest-api/route/path'
    const fwd = await request(app.getHttpServer())
      .get(`${base}?fromLng=108.81&fromLat=21.81&toLng=108.9&toLat=21.9&mode=distance`)
      .expect(200)
    expect(fwd.body.data).toMatchObject({ found: true })

    const rev = await request(app.getHttpServer())
      .get(`${base}?fromLng=108.9&fromLat=21.9&toLng=108.795&toLat=21.795&mode=distance`)
      .expect(200)
    // node4 只有这一条单向边，反向无路可走 → 合法空结果（不是 500、也不是 found:true）
    expect(rev.body.data).toMatchObject({ found: false, reason: 'unreachable' })
  })

  it('time 口径：上报时长取自物理 cost_min（等级偏好只影响选路，不放大面板数字）', async () => {
    // v2 的 time 口径给 pgr 的是加权代价 route_cost_min（含等级偏好），
    // 若汇总时误用 pgr 的 cost，面板时长会被偏好乘数放大。夹具 secondary 偏好 1.02、
    // 50km/h → A 段 7.826km ≈ 9.4 分钟。断言落在 [9.0, 10.5]，容忍吸附折算。
    const res = await request(app.getHttpServer())
      .get('/nest-api/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=time')
      .expect(200)
    expect(res.body.data.found).toBe(true)
    const duration = Number(res.body.data.durationMin)
    expect(duration).toBeGreaterThan(9.0)
    expect(duration).toBeLessThan(10.5)
  })
})
