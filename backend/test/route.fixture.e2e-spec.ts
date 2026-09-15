import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// route 域 · **合成夹具图**专用套件（2026-09-15 从 route.e2e-spec.ts 拆出）
//
// 为什么单独成文件：本套件的期望拓扑来自 `backend/test/seed/roads-graph-fixture.sql`
//（3 条合成边 A/B/C，坐标 108.6/21.6 等测点，其中 edge C 是 oneway=1 的单向边），
// 而该夹具经 `ci-seed.sh` 第 ④ 步只灌 CI 的临时库，seed 注释明令「**严禁灌 beibu-gulf-data/生产库**」。
// ⇒ 在任何"有真实路网"的机器上，这里断言的拓扑根本不存在，跑必失败（实测 2 failed）。
//
// 故门控变量**独立**为 V3_ROADS_FIXTURE，而非项目级的 V3_INTEGRATION_DB：
//   · 本地（未设 V3_ROADS_FIXTURE）→ 整组跳过，登记在 scripts/test-gate.config.json；
//   · CI（ci-seed 灌了夹具 ⇒ 设 V3_ROADS_FIXTURE=1）→ 必须真跑，一条都不许跳。
// 一个文件一个门控条件，watchdog 的逐文件登记才能精确执法。
//
// ⚠️ 如果你在本机想让它真跑：**不要**把夹具灌进 beibu-gulf-data（seed 与红线均禁止）。
//    正确做法是另起一个专用库（如 v3_route_fixture），把 PG_* 指过去后再设 V3_ROADS_FIXTURE=1。
const withFixture = process.env.V3_ROADS_FIXTURE !== undefined

describe.skipIf(!withFixture)('route e2e — 合成夹具图（需 V3_ROADS_FIXTURE）', () => {
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
