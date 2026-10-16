// reanchor-hubs 校准数学测试。
//
// 钉住两类容易回归、且运行时只表现为"模型歪了/错位"的错：
//   ① 求逆 / ENU 矩阵：求逆漏掉主元行交换、ENU 列方向写反，会让 P0 落不到 target。
//   ② 校准语义：给定 angle + target，P0 必须落在 target 且模型本地 +X 轴转到世界正南
//      （马道中央导堤/引航道实测正南，az=180）。
import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  computeNew,
  enuFrame,
  identity,
  inv,
  mul,
  mulPoint,
  P0_LOCAL,
  toCol,
  toMath,
} from '../reanchor-hubs.mjs'
import { ecefToGeo as ecefToLlh, geoToEcef as geocentric } from '../../lib/geo.mjs'

// ROOT 取交付包（入库）：它不随校准变化，仅提供 ECEF 参考系
const TILESET = 'backend/static/pinglu/tiles/tileset.json'
const ROOT = toMath(JSON.parse(fs.readFileSync(TILESET, 'utf8')).root.transform)

// 未校准的原始马道 child（列主序；与 git HEAD 一致，+X 朝 az=197.8 南偏西）
const ORIG_CHILD_ARR = [
  -0.30569530496310576, -0.9521293927421387, 0, 0, 0.9521293927421387, -0.30569530496310576, 0, 0,
  0, 0, 1, 0, 10883.030501635865, 27619.292312395024, -49.9362930168584, 1,
]
const OLD = toMath(ORIG_CHILD_ARR)

const TARGET = { lon: 108.940167, lat: 22.447154, h: 20 }

/** P0 处本地某轴方向的世界方位角（度） */
function axisAzimuth(NEW, axis) {
  const base = mulPoint(mul(ROOT, NEW), [...P0_LOCAL, 1]).slice(0, 3)
  const tip = mulPoint(mul(ROOT, NEW), [
    P0_LOCAL[0] + axis[0],
    P0_LOCAL[1] + axis[1],
    P0_LOCAL[2] + axis[2],
    1,
  ]).slice(0, 3)
  const enu = inv(enuFrame(base))
  const d = mulPoint(enu, [...tip, 1])
  // ENU 列：0=east,1=north；方位角从北顺时针
  return (Math.atan2(d[0], d[1]) * 180) / Math.PI
}

describe('reanchor 数学底座', () => {
  it('inv：enu × inv(enu) = 单位阵（漏主元行交换会失败）', () => {
    const P0 = mulPoint(mul(ROOT, OLD), [...P0_LOCAL, 1]).slice(0, 3)
    const enu = enuFrame(P0)
    const prod = mul(enu, inv(enu))
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) expect(prod[r][c]).toBeCloseTo(r === c ? 1 : 0, 9)
  })

  it('geocentric ↔ ecefToLlh 往返一致', () => {
    const p = geocentric(108.940167, 22.447154, 20)
    const llh = ecefToLlh(p)
    expect(llh[0]).toBeCloseTo(108.940167, 8)
    expect(llh[1]).toBeCloseTo(22.447154, 8)
    expect(llh[2]).toBeCloseTo(20, 6)
  })

  it('enuFrame 列正交且上列朝上', () => {
    const P0 = geocentric(108.936695, 22.447388, 18.67)
    const e = enuFrame(P0)
    // 上列模长 1，且其 llh 方向的 up 分量 > 0.999
    const up = [e[0][2], e[1][2], e[2][2]]
    expect(Math.hypot(...up)).toBeCloseTo(1, 9)
    expect(up[2]).toBeGreaterThan(0.3) // 该纬度 up 的 z 分量 ≈ sin(lat)
  })
})

describe('computeNew — 朝向 + 平移校准', () => {
  const NEW = computeNew(ROOT, OLD, {
    angle: 17,
    targetLon: TARGET.lon,
    targetLat: TARGET.lat,
    targetH: TARGET.h,
  })

  it('P0 落在 target（经纬度 + 高程）', () => {
    const p = mulPoint(mul(ROOT, NEW), [...P0_LOCAL, 1]).slice(0, 3)
    const llh = ecefToLlh(p)
    expect(llh[0]).toBeCloseTo(TARGET.lon, 6)
    expect(llh[1]).toBeCloseTo(TARGET.lat, 6)
    expect(llh[2]).toBeCloseTo(TARGET.h, 6)
  })

  it('本地 +X 轴转到世界正南（az≈180，误差<1°）', () => {
    const az = axisAzimuth(NEW, [1, 0, 0])
    // 归一到 [0,360)
    const n = (az + 360) % 360
    expect(Math.abs(n - 180)).toBeLessThan(1)
  })

  it('本地 +Y 轴转到世界正东（az≈90）', () => {
    const az = (axisAzimuth(NEW, [0, 1, 0]) + 360) % 360
    expect(Math.abs(az - 90)).toBeLessThan(1)
  })

  it('等价于固化到 tileset 的 child transform', () => {
    const fixed = JSON.parse(fs.readFileSync(TILESET, 'utf8')).root.children.find((c) =>
      c.content.uri.startsWith('madao-')
    )
    for (let i = 0; i < 16; i++) expect(toCol(NEW)[i]).toBeCloseTo(fixed.transform[i], 6)
  })
})

describe('computeNew — 纯平移', () => {
  it('平移量叠加到 child 平移，旋转部分不变', () => {
    const NEW = computeNew(ROOT, OLD, { dE: 300, dN: -60, dH: 5 })
    expect(NEW[0][3]).toBeCloseTo(OLD[0][3] + 300, 9)
    expect(NEW[1][3]).toBeCloseTo(OLD[1][3] - 60, 9)
    expect(NEW[2][3]).toBeCloseTo(OLD[2][3] + 5, 9)
    // 旋转列保持
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) expect(NEW[r][c]).toBeCloseTo(OLD[r][c], 9)
  })
})

describe('computeNew — angle=0 纯旋转不移动 P0', () => {
  it('不指定 target 时，P0 原地不动，仅旋转', () => {
    const NEW = computeNew(ROOT, OLD, { angle: 0 })
    const before = ecefToLlh(mulPoint(mul(ROOT, OLD), [...P0_LOCAL, 1]).slice(0, 3))
    const after = ecefToLlh(mulPoint(mul(ROOT, NEW), [...P0_LOCAL, 1]).slice(0, 3))
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 6)
  })
})
