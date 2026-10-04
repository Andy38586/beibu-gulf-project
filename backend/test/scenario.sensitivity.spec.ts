import { describe, expect, it } from 'vitest'

import {
  CANAL_INTERVAL_ANCHORS,
  CANAL_PORT_SHARES,
  CANAL_SCENARIOS,
} from '../src/modules/forecast/constants/scenario.constants'
import { applyCanalScenario } from '../src/modules/forecast/services/scenario.service'

// 运河情景敏感性对照（只读报告，不改任何默认值；供论文"分摊/占比敏感性"一节）
// 语义依据 constants 头注：月度增量 = 年运量(锚点插值) × 江海联运占比 × 港域分摊 ÷ 12
// ⇒ 对「锚点总量 / 江海联运占比」严格线性，对「港域分摊」按份额线性。
// 本件做两件事：① 用 service 的零基序列产出各情景各港年增量（万吨/年）；
// ② 用锚点手工复算交叉校验三类敏感轴：总量口径 ±10%、江海联运口径 ±20%、
//    港域分摊倾斜（钦州 +5pp/+10pp，其余按比例再归一）。

type PortId = 'qinzhou' | 'fangchenggang' | 'beihai'
const PORTS: PortId[] = ['qinzhou', 'fangchenggang', 'beihai']
const SCENARIOS = ['design', 'median', 'induced'] as const

/** 测试口径锚点插值（与 constants 定义同式：段内线性、首前取 0、末后持平） */
function interp(anchors: Array<[number, number]>, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [x1, v1] = anchors[i]
    const [x0, v0] = anchors[i - 1]
    if (x <= x1) return v0 + ((x - x0) / (x1 - x0)) * (v1 - v0)
  }
  return last[1]
}

function monthList(y0: number, y1: number): string[] {
  const out: string[] = []
  for (let y = y0; y <= y1; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return out
}

const MONTHS = monthList(2027, 2035)

/** service 零基序列 → 每港每年增量（万吨/年；输出即增量的各月取整值之和） */
function yearUplift(port: PortId, scenario: (typeof SCENARIOS)[number], year: number): number {
  const zero = MONTHS.map((time) => ({ time, value: 0 }))
  const out = applyCanalScenario(port, zero, scenario)
  const i = (year - 2027) * 12
  return out.slice(i, i + 12).reduce((s, p) => s + p.value, 0)
}

interface SensOpts {
  shares?: Record<string, number>
  /** 总量口径缩放（总量锚点与区间锚点同乘，占比不变 ⇒ 增量按同比例） */
  anchorScale?: number
  /** 江海联运口径缩放（只缩放"总量−区间"段 ⇒ 占比含义 ±比例） */
  ratioScale?: number
}

/** 手工复算：按锚点公式直接算某港某情景某年增量（独立于 service 的加量路径） */
function yearUpliftByAnchors(
  port: PortId,
  scenario: (typeof SCENARIOS)[number],
  year: number,
  opts: SensOpts = {}
): number {
  const shares = opts.shares ?? CANAL_PORT_SHARES
  const aScale = opts.anchorScale ?? 1
  const rScale = opts.ratioScale ?? 1
  const def = CANAL_SCENARIOS.find((s) => s.id === scenario)!
  let sum = 0
  for (let m = 1; m <= 12; m++) {
    const t = year + (m - 0.5) / 12
    const total = interp(def.anchors, t) * aScale
    if (!(total > 0)) continue
    const interval = interp(CANAL_INTERVAL_ANCHORS, t) * aScale
    const ratio = Math.min(1, Math.max(0, ((total - interval) * rScale) / total))
    sum += Math.round((total * ratio * shares[port]) / 12)
  }
  return sum
}

/** 倾斜口径：钦州 = q+Δ；防/北 按原相对结构等比再归一（份额和恒 = 1） */
function tiltedShares(delta: number): Record<string, number> {
  const q = CANAL_PORT_SHARES.qinzhou
  const scale = (1 - (q + delta)) / (1 - q)
  return {
    qinzhou: q + delta,
    fangchenggang: CANAL_PORT_SHARES.fangchenggang * scale,
    beihai: CANAL_PORT_SHARES.beihai * scale,
  }
}

describe('运河情景敏感性对照（只读报告）', () => {
  it('基线零增量（阳性对照）+ 三档单调（design ≤ median ≤ induced）', () => {
    const zero = MONTHS.map((time) => ({ time, value: 0 }))
    expect(applyCanalScenario('qinzhou', zero, 'baseline').every((p) => p.value === 0)).toBe(true)

    for (const port of PORTS) {
      const d = yearUplift(port, 'design', 2035)
      const m = yearUplift(port, 'median', 2035)
      const i = yearUplift(port, 'induced', 2035)
      expect(d, port).toBeLessThanOrEqual(m)
      expect(m, port).toBeLessThanOrEqual(i)
      expect(d, port).toBeGreaterThan(0)
    }
  })

  it('service 零基加量 == 锚点手工复算（2030/2035，三港×三档，逐格）', () => {
    for (const port of PORTS) {
      for (const scenario of SCENARIOS) {
        for (const year of [2030, 2035]) {
          expect(yearUplift(port, scenario, year), `${port}/${scenario}/${year}`).toBe(
            yearUpliftByAnchors(port, scenario, year)
          )
        }
      }
    }
  })

  it('线性因子：总量口径 ×0.9/×1.1、江海联运口径 ×0.8/×1.2 对 2035 增量按同比例缩放（±12 万吨/年舍入带）', () => {
    const tol = 12 // 逐月取整 ⇒ 年合计误差 ≤12
    for (const port of PORTS) {
      for (const scenario of SCENARIOS) {
        const base = yearUplift(port, scenario, 2035)
        for (const [mul, label, opts] of [
          [0.9, '总量-10%', { anchorScale: 0.9 }],
          [1.1, '总量+10%', { anchorScale: 1.1 }],
          [0.8, '江海联运-20%', { ratioScale: 0.8 }],
          [1.2, '江海联运+20%', { ratioScale: 1.2 }],
        ] as Array<[number, string, SensOpts]>) {
          const byAnchors = yearUpliftByAnchors(port, scenario, 2035, opts)
          expect(
            Math.abs(byAnchors - base * mul),
            `${port}/${scenario}/${label}`
          ).toBeLessThanOrEqual(tol)
        }
      }
    }
  })

  it('钦州倾斜 +5pp/+10pp：份额和恒 1；钦州增、防/北按比例降；service 路径 == 锚点复算', () => {
    for (const delta of [0.05, 0.1]) {
      const shares = tiltedShares(delta)
      const sum = PORTS.reduce((s, p) => s + shares[p], 0)
      expect(sum, `Δ=${delta} 份额和`).toBeCloseTo(1, 12)
      expect(shares.qinzhou).toBeCloseTo(CANAL_PORT_SHARES.qinzhou + delta, 12)
      for (const p of ['fangchenggang', 'beihai'] as PortId[]) {
        expect(shares[p], `Δ=${delta}/${p}`).toBeLessThan(CANAL_PORT_SHARES[p])
      }
      for (const scenario of SCENARIOS) {
        const qzBase = yearUplift('qinzhou', scenario, 2035)
        const qzTilt = yearUpliftByAnchors('qinzhou', scenario, 2035, { shares })
        expect(qzTilt, `${scenario}/钦州Δ=${delta}`).toBeGreaterThan(qzBase)
        for (const p of ['fangchenggang', 'beihai'] as PortId[]) {
          const base = yearUplift(p, scenario, 2035)
          const tilt = yearUpliftByAnchors(p, scenario, 2035, { shares })
          expect(tilt, `${scenario}/${p}Δ=${delta}`).toBeLessThan(base)
        }
      }
    }
  })

  it('打印对照表（2029/2030/2035 年增量；2035 倾斜对照）', () => {
    const rows: string[] = []
    rows.push('| 情景 | 港口 | 2029 | 2030 | 2035 | 钦州+5pp(2035) | 钦州+10pp(2035) |')
    rows.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const scenario of SCENARIOS) {
      for (const port of PORTS) {
        const t5 = yearUpliftByAnchors(port, scenario, 2035, { shares: tiltedShares(0.05) })
        const t10 = yearUpliftByAnchors(port, scenario, 2035, { shares: tiltedShares(0.1) })
        rows.push(
          `| ${scenario} | ${port} | ${yearUplift(port, scenario, 2029)} | ` +
            `${yearUplift(port, scenario, 2030)} | ${yearUplift(port, scenario, 2035)} | ` +
            `${t5} | ${t10} |`
        )
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n' + rows.join('\n'))
    expect(rows.length).toBe(2 + SCENARIOS.length * PORTS.length)
  })
})
