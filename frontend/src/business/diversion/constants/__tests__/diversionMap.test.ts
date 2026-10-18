import { describe, expect, it } from 'vitest'

import type { Port } from '@/types'

import { arcWidthFor, buildPortArc, resolvePortEndpoints } from '../diversionMap'

// 分流弧线几何/宽度判据（Cesium ③）：端点保持、确定性、南向鼓出、宽度相对编码。

const START = { lng: 108.62, lat: 21.87 } // 示意线末点（茅尾海口）
const END = { lng: 109.130658, lat: 21.418792 } // 北海（ports.json 原值）

describe('buildPortArc', () => {
  it('端点保持：t=0/1 必为原值（删端点写入即红）', () => {
    const pts = buildPortArc(START, END)
    expect(pts[0]).toEqual([START.lng, START.lat])
    expect(pts[pts.length - 1]).toEqual([END.lng, END.lat])
  })

  it('确定性：同输入两次运行逐点全等（等价重构不得引入随机性）', () => {
    expect(buildPortArc(START, END)).toEqual(buildPortArc(START, END))
  })

  it('默认 64 段（65 点，字面锚定），且弧顶在弦中点以南（南向离岸鼓出）', () => {
    const pts = buildPortArc(START, END)
    expect(pts).toHaveLength(65)
    const mid = pts[Math.floor(pts.length / 2)]
    const chordMidLat = (START.lat + END.lat) / 2
    expect(mid[1]).toBeLessThan(chordMidLat)
  })
})

describe('arcWidthFor（弧宽 ∝ 万吨，同批相对编码）', () => {
  it('0 → 最小宽；基准值 → 最大宽；超基准 clamp 不越界', () => {
    expect(arcWidthFor(0, 1000)).toBe(2)
    expect(arcWidthFor(1000, 1000)).toBe(14)
    expect(arcWidthFor(9999, 1000)).toBe(14)
  })

  it('比例中点落在宽度区间内（线性映射未退化成常数——删比例项即红）', () => {
    const w = arcWidthFor(500, 1000)
    expect(w).toBeGreaterThan(2)
    expect(w).toBeLessThan(14)
  })

  it('基准非正（无数据/全零）退最小宽，不产生 NaN/Infinity', () => {
    expect(arcWidthFor(500, 0)).toBe(2)
    expect(Number.isFinite(arcWidthFor(500, -3))).toBe(true)
  })
})

describe('resolvePortEndpoints（ports.json 名称匹配，缺条目跳过不抛）', () => {
  const PORT = (name: string, lng: number, lat: number): Port =>
    ({ id: 'x', name, address: '', lng, lat, type: '' }) as unknown as Port

  it('三条目全命中三键', () => {
    const r = resolvePortEndpoints([
      PORT('钦州港口岸', 108.590379, 21.726917),
      PORT('防城港', 108.340973, 21.617689),
      PORT('北海国际客运港', 109.130658, 21.418792),
    ])
    expect(Object.keys(r).sort()).toEqual(['beihai', 'fangchenggang', 'qinzhou'])
    expect(r.qinzhou).toEqual({ lng: 108.590379, lat: 21.726917 })
  })

  it('缺任一条目 → 对应键缺席（返回 2 键而非抛错）', () => {
    const r = resolvePortEndpoints([
      PORT('钦州港口岸', 108.590379, 21.726917),
      PORT('防城港', 108.340973, 21.617689),
    ])
    expect(Object.keys(r)).toEqual(['qinzhou', 'fangchenggang'])
  })
})
// D3 去 export：ARC_SEGMENTS / ARC_WIDTH_MIN / ARC_WIDTH_MAX 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — 三个内部常量不得再导出', () => {
  const INTERNAL = ['ARC_SEGMENTS', 'ARC_WIDTH_MIN', 'ARC_WIDTH_MAX']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../diversionMap')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.buildPortArc).toBe('function')
  })
})
