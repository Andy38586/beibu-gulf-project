// @vitest-environment node
/**
 * F60：tileset 包围盒 padding 单源。
 *
 * 实测证据见 tools/3dtiles-build/tileset-bounds.mjs 头注：padding 0/现值/2×
 * 的 Cesium statistics.visited 完全一致且均 >0，故各 builder 统一取 BOX_PADDING_M。
 */
import { describe, expect, it } from 'vitest'

import { BOX_PADDING_M, boxFromCenterHalf, mergeBoxes, paddedHalf } from '../tileset-bounds.mjs'

describe('tileset-bounds — 包围盒单源', () => {
  it('padding 常量 = 5（用户裁定 C 的保守统一值）', () => {
    expect(BOX_PADDING_M).toBe(5)
    expect(paddedHalf([1, 2, 3])).toEqual([6, 7, 8])
    expect(paddedHalf([1, 2, 3], 0)).toEqual([1, 2, 3])
  })

  it('mergeBoxes：两个轴对齐子盒 → 外包中心/半轴，且完整包含子盒', () => {
    const a = boxFromCenterHalf([0, 0, 0], [1, 2, 3])
    const b = boxFromCenterHalf([10, 20, 30], [2, 1, 5])
    const merged = mergeBoxes([a, b])
    expect(merged.center).toEqual([5.5, 9.5, 16])
    expect(merged.half).toEqual([6.5, 11.5, 19])
    for (const box of [a, b]) {
      for (let k = 0; k < 3; k++) {
        expect(box[k] - box[3 + k * 4]).toBeGreaterThanOrEqual(merged.center[k] - merged.half[k])
        expect(box[k] + box[3 + k * 4]).toBeLessThanOrEqual(merged.center[k] + merged.half[k])
      }
    }
  })

  it('boxFromCenterHalf：非对角半轴位为 0（轴对齐契约）', () => {
    expect(boxFromCenterHalf([1, 2, 3], [4, 5, 6])).toEqual([1, 2, 3, 4, 0, 0, 0, 5, 0, 0, 0, 6])
  })

  it('空输入 ⇒ 抛错（不许静默返回空盒子）', () => {
    expect(() => mergeBoxes([])).toThrow(/至少需要一个 box/)
  })
})
