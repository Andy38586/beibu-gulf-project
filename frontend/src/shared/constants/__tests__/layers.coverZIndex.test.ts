/**
 * 判据：覆盖类图层的叠放层级判定必须按**图层 key** 走 `isCoverLayerKey()`，不得按
 * `options.featureType` 或裸写字面量判定。
 *
 * 治的失效（W50 / RC1）：`OLRenderer._resolveLayerZIndex` 原实现用
 * `options.featureType` 比对 `'flood-area' | 'flood-facilities' | 'forecast-'*`——
 * 但 `'flood-facilities'` 是 **LAYER_KEYS 的值**（真实 featureType 是
 * `'flood-facility-point'`），`'forecast-'` 是**图层 key 前缀**（预测图层不传 featureType）。
 * 三条判据里两条恒假，只有 `'flood-area'` 因两个命名空间恰好同名而“生效”。
 * 后果：受影响设施图层与三张预测图层全部落在普通业务层 10 档，覆盖层 15 档只剩淹没范围。
 *
 * 判据两条腿：
 *   ① 行为断言：`isCoverLayerKey` 对真实生产者集合的判定必须与层档语义一致；
 *   ② 变异能红：删掉任一 key 分支（把 `LAYER_KEYS.floodFacilities` 换成字面量以外的东西）
 *      或改判 `featureType` ⇒ 用例必须红。
 */
import { describe, expect, it } from 'vitest'

import { forecastLayerId, isCoverLayerKey, LAYER_KEYS } from '../layers'

describe('isCoverLayerKey — 覆盖层 key 判据（W50 修复的判据面）', () => {
  it('三个真实覆盖类生产者全部判为覆盖层', () => {
    // 淹没范围：FloodAnalysisPage 注册时 key 用 LAYER_KEYS.floodArea
    expect(isCoverLayerKey(LAYER_KEYS.floodArea)).toBe(true)
    // 受影响设施：key 用 LAYER_KEYS.floodFacilities（注意不是 featureType 'flood-facility-point'）
    expect(isCoverLayerKey(LAYER_KEYS.floodFacilities)).toBe(true)
    // 预测图层：key 由构造器派生，前缀 'forecast-'
    expect(isCoverLayerKey(forecastLayerId('cargo'))).toBe(true)
    expect(isCoverLayerKey(forecastLayerId('activity'))).toBe(true)
    expect(isCoverLayerKey(forecastLayerId('container'))).toBe(true)
  })

  it('普通业务层与非业务 key 一律不判为覆盖层（阴性对照）', () => {
    for (const key of [
      LAYER_KEYS.baseImage,
      LAYER_KEYS.baseVector,
      LAYER_KEYS.boundary,
      LAYER_KEYS.ports,
      LAYER_KEYS.terrain,
      LAYER_KEYS.routePath,
      LAYER_KEYS.routeEndpoint,
      LAYER_KEYS.diversionCanal,
      LAYER_KEYS.floodWaterSurface,
      '',
    ]) {
      expect(isCoverLayerKey(key), `key=${key} 不应判为覆盖层`).toBe(false)
    }
  })

  it('featureType 命名空间的值不得被判为覆盖层（治 RC1 命名空间混用）', () => {
    // 这两个是 featureType，不是 layer key —— 旧实现正是拿它们去比 key，导致判据恒假
    expect(isCoverLayerKey('flood-facility-point')).toBe(false)
    // 'flood-area' 两个命名空间恰好同名，只能作为「不得因此把 featureType 当 key」的反例说明：
    // 该值同时是 LAYER_KEYS.floodArea 的值，故这里只断言 featureType 侧的 */
    expect(isCoverLayerKey('boundary')).toBe(false)
  })

  it('变异能红（第 1 式·删字面分支）：floodFacilities 分支被摘掉时本组必红', async () => {
    // 动态 import 无法在运行时摘分支，故用「同义改写」构造等价判据：
    // 若实现退化为只认 floodArea，则下面两行必红。
    expect(isCoverLayerKey(LAYER_KEYS.floodFacilities)).toBe(true)
    expect(isCoverLayerKey(forecastLayerId('cargo'))).toBe(true)
  })
})
