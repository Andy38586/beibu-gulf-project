import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import { combinationWeights } from '../lib/combination.cjs'

// P0-1 接线断言（2026-10-04）：产物里的组合条目必须真实、自洽、可复核——
// 只验结构/自洽（数据无关），验收判据（6 席组合 ≤ 现役）见方案 §八 一次性记录。
// 变异四式（删 final_weights 红 / 权重与 member_mape 脱钩红 / 胜者双写不一致红 /
// 换记法（JSON 重排）不红）见提交正文。

const PRODUCTS = ['throughput_model.json', 'container_model.json']
const SINGLES = ['linear', 'ets_damped', 'seasonal_naive']
const MEMBERS = ['linear', 'ets', 'seasonal_naive']

function loadProduct(name) {
  const url = new URL(`../../../backend/data/forecast/${name}`, import.meta.url)
  return JSON.parse(fs.readFileSync(url, 'utf8'))
}

describe('产物组合条目（P0-1 接线）', () => {
  for (const name of PRODUCTS) {
    const product = loadProduct(name)
    for (const [port, p] of Object.entries(product.ports)) {
      const mc = p.model_comparison
      const com = mc.combination

      it(`${name}/${port}：combination 条目齐备且 final_weights 与 member_mape 严格同源`, () => {
        expect(Number.isFinite(com.overall_mape)).toBe(true)
        expect(Number.isFinite(com.overall_mase)).toBe(true)
        expect(Object.keys(com.member_mape).sort()).toEqual([...MEMBERS].sort())
        for (const k of MEMBERS) expect(Number.isFinite(com.member_mape[k])).toBe(true)
        // final_weights 必须等于 combinationWeights(member_mape) 逐位复算值（禁手改/脱钩）
        const recomputed = combinationWeights(com.member_mape)
        for (const k of Object.keys(recomputed)) {
          expect(com.final_weights[k]).toBeCloseTo(recomputed[k], 12)
        }
        const sum = Object.values(com.final_weights).reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(1, 12)
      })

      it(`${name}/${port}：胜者双写一致；选中组合时分步长误差同源`, () => {
        expect(mc.selected).toBe(p.backtest.selected_model)
        if (p.backtest.selected_model === 'combination') {
          expect(com.overall_mape).toBeLessThan(Math.min(...SINGLES.map((k) => mc[k].overall_mape)))
          expect(mc.linear.overall_mape - com.overall_mape).toBeGreaterThanOrEqual(0.5)
          expect(p.backtest.rolling_mape_by_step).toEqual(com.mape_by_step)
        } else {
          // 未选中组合 ⇒ 组合未达"严格优于最好单模型 + 0.5pp 门槛"（记录而非静默）
          const bestSingle = Math.min(...SINGLES.map((k) => mc[k].overall_mape))
          const eligible =
            com.overall_mape < bestSingle && mc.linear.overall_mape - com.overall_mape >= 0.5
          expect(eligible).toBe(false)
        }
      })
    }
  }
})
