import { describe, expect, it } from 'vitest'

import {
  ANCHOR_TOLERANCE_KM,
  collectIndicatorAnchors,
  evaluateAnchors,
  readIndicators,
} from '../anchor-check.mjs'

// 权威港口 fixture（与 frontend/public/data/ports.json 同源的三港真实坐标）
const PORTS = [
  { name: '北海国际客运港', lng: 109.130658, lat: 21.418792 },
  { name: '钦州港口岸', lng: 108.590379, lat: 21.726917 },
  { name: '防城港', lng: 108.340973, lat: 21.617689 },
]

describe('evaluateAnchors — 锚点容差判定', () => {
  it('真实港口坐标（逐位一致）→ 通过', () => {
    const anchors = PORTS.map((p) => ({ label: p.name, lng: p.lng, lat: p.lat }))
    expect(evaluateAnchors(PORTS, anchors)).toEqual([])
  })

  it('钦州市区 mock 坐标（北偏约 25km）→ 报告违规，且就近匹配到钦州港口岸', () => {
    const problems = evaluateAnchors(PORTS, [{ label: 'cargo.qinzhou', lng: 108.62, lat: 21.95 }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('cargo.qinzhou')
    expect(problems[0]).toContain('钦州港口岸')
    expect(problems[0]).toMatch(/2[0-9]\.\d+km/) // 25km 量级
  })

  it('容差内偏移（约 1km）→ 通过；超容差（约 3km）→ 违规', () => {
    const near = evaluateAnchors(PORTS, [{ label: 'near', lng: 108.6, lat: 21.736 }])
    expect(near).toEqual([])
    const far = evaluateAnchors(PORTS, [{ label: 'far', lng: 108.618, lat: 21.745 }])
    expect(far).toHaveLength(1)
  })

  it('GCJ 偏移量级（东南约 500m，若真发生 GCJ 误用）在 2km 容差内不误报，但 25km 粗化必报', () => {
    expect(ANCHOR_TOLERANCE_KM).toBe(2)
    const gcj = [{ label: 'gcj', lng: 108.590379 + 0.003666, lat: 21.726917 - 0.002826 }]
    expect(evaluateAnchors(PORTS, gcj)).toEqual([])
  })

  it('坐标缺失/非数值 → 违规', () => {
    const problems = evaluateAnchors(PORTS, [{ label: 'bad', lng: NaN, lat: 21.7 }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('坐标缺失')
  })

  it('权威港口清单为空 → 直接报错（防守卫空转假绿）', () => {
    expect(evaluateAnchors([], [{ label: 'x', lng: 1, lat: 1 }])).toHaveLength(1)
  })
})

describe('readIndicators — 从前端源码解析消费清单', () => {
  it('标准写法解析为指标数组', () => {
    const src = "const INDICATORS = ['cargo', 'container', 'activity'] as const"
    expect(readIndicators(src)).toEqual(['cargo', 'container', 'activity'])
  })

  it('源码结构变更（无 INDICATORS 声明）→ 返回 null（守卫须报错而非放行）', () => {
    expect(readIndicators('const X = 1')).toBeNull()
  })
})

describe('collectIndicatorAnchors — 指标文件锚点收集', () => {
  it('从 spatial.features[0].geometry.coordinates 收集并标注 indicator.port', () => {
    const data = {
      data: {
        qinzhou: {
          spatial: { features: [{ geometry: { coordinates: [108.590379, 21.726917] } }] },
        },
        beihai: { spatial: { features: [{ geometry: { coordinates: [109.130658, 21.418792] } }] } },
      },
    }
    const { anchors, problems } = collectIndicatorAnchors('cargo', data)
    expect(problems).toEqual([])
    expect(anchors).toEqual([
      { label: 'cargo.qinzhou', lng: 108.590379, lat: 21.726917 },
      { label: 'cargo.beihai', lng: 109.130658, lat: 21.418792 },
    ])
  })

  it('缺少 spatial 锚点 → 报告结构问题', () => {
    const { anchors, problems } = collectIndicatorAnchors('cargo', { data: { qinzhou: {} } })
    expect(anchors).toEqual([])
    expect(problems[0]).toContain('cargo.qinzhou')
  })
})
