// P2-2 口径反腐守卫：README 中可派生的数字必须与产物逐格一致——手抄死数回潮即红。
// 覆盖面：①「实测精度」表 10 格/行（4 cargo + 4 container + 双胜者）× 3 港；
// ② P0-3 覆盖率 PICP min~max 与「低于目标带」计数。其余正文数字（如 h12 宽度
// 「4/6 席 ≤1.2×」需旧宽度基线、方案目标带 0.70~0.90 为方案常量）不在此判据域。
import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const README_URL = new URL('../README.md', import.meta.url)
const PRODUCTS = { cargo: 'throughput_model.json', container: 'container_model.json' }
const PORT_LABELS = { qinzhou: '钦州', beihai: '北海', fangchenggang: '防城' }
const WINNER_LABELS = {
  linear: '线性',
  ets: 'ETS',
  seasonal_naive: '季节朴素',
  combination: '组合',
}
const MODELS = ['linear', 'ets_damped', 'seasonal_naive', 'combination']

function loadArtifacts() {
  const out = {}
  for (const [ind, file] of Object.entries(PRODUCTS)) {
    const url = new URL(`../../../backend/data/forecast/${file}`, import.meta.url)
    out[ind] = JSON.parse(fs.readFileSync(url, 'utf8'))
  }
  return out
}

/** 解析实测精度表数据行：| 钦州 | … | → { 钦州: [10 格] }；表头/分隔行天然不匹配 */
function parsePrecisionTable(text) {
  const rows = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(钦州|北海|防城)\s*\|(.+)\|\s*$/)
    if (!m) continue
    rows[m[1]] = m[2].split('|').map((c) => c.trim().replace(/\*\*/g, ''))
  }
  return rows
}

const artifacts = loadArtifacts()
const table = parsePrecisionTable(fs.readFileSync(README_URL, 'utf8'))

describe('README 实测精度表 × 产物对账（P2-2：手抄死数守卫）', () => {
  it('三港入表且每行 10 格（4 cargo 模型 + 4 container 模型 + 双胜者）', () => {
    expect(Object.keys(table).sort()).toEqual(['北海', '防城', '钦州'].sort())
    for (const [port, cells] of Object.entries(table)) {
      expect(cells, port).toHaveLength(10)
    }
  })

  for (const [ind, artifact] of Object.entries(artifacts)) {
    for (const [port, p] of Object.entries(artifact.ports)) {
      const label = PORT_LABELS[port]
      it(`${label}/${ind}：MAPE/MASE 四模型 + 胜者与产物一致`, () => {
        const cells = table[label]
        expect(cells, `${label} 行存在于表内`).toBeTruthy()
        MODELS.forEach((model, i) => {
          const m = p.model_comparison[model]
          const col = (ind === 'cargo' ? 0 : 4) + i
          // 按数值比对：0.7 与 0.70 这类等价记法不误红；值漂移（6.26 vs 6.25）必红
          const parsed = cells[col].match(/^([\d.]+)%\/([\d.]+)$/)
          expect(parsed, `${label}/${ind}/${model} 格式须为 MAPE%/MASE`).toBeTruthy()
          expect(Number(parsed[1]), `${label}/${ind}/${model} MAPE`).toBe(m.overall_mape)
          expect(Number(parsed[2]), `${label}/${ind}/${model} MASE`).toBe(m.overall_mase)
        })
        const winnerCol = ind === 'cargo' ? 8 : 9
        expect(cells[winnerCol], `${label}/${ind}/胜者`).toBe(
          WINNER_LABELS[p.backtest.selected_model]
        )
      })
    }
  }

  it('P0-3：README 的 PICP min~max 与「低于目标带」计数由产物派生一致', () => {
    const values = Object.values(artifacts).flatMap((a) =>
      Object.values(a.ports).map((p) => p.backtest.overall_picp)
    )
    const min = Math.min(...values).toFixed(2)
    const max = Math.max(...values).toFixed(2)
    // 目标带下限 0.70 是方案 P0-3 的验收常量（非产物派生），此处只用它计数
    const below = values.filter((v) => v < 0.7).length
    const text = fs.readFileSync(README_URL, 'utf8')
    expect(text).toContain(`PICP ${min}~${max}`)
    expect(text).toContain(`${below}/6 低于目标带`)
  })
})
