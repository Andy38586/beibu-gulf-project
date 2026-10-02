import { describe, expect, it } from 'vitest'

import { PORT_PORTS } from '../../frontend/src/shared/constants/forecast'
import {
  CHANGZHOU_LOCK_SERIES,
  diversionBreakdown,
  PORT_DISPLAY_NAMES,
  WEST_RIVER_TRANSFER_ANCHORS,
  westRiverTransferAt,
} from '../src/common/diversion'
import { CANAL_PORT_SHARES } from '../src/modules/forecast/constants/scenario.constants'

// 分流框架单测（W10-11）。oracle 全部锚点手工复算（罗淳 2024 §5.3.4/附录 A-6），
// 不从实现反推——对齐 scenario.service.spec / ahp.spec 纪律。

describe('长洲基线序列（对照组）', () => {
  it('首尾锚点与文献一致：2007=2518 / 2022=15528.41（同比+1.97%）', () => {
    expect(CHANGZHOU_LOCK_SERIES[0]).toEqual({ year: 2007, through: 2518 })
    const last = CHANGZHOU_LOCK_SERIES[CHANGZHOU_LOCK_SERIES.length - 1]
    expect(last.year).toBe(2022)
    expect(last.through).toBe(15528.41)
    // 文档口径同比核验：15528.41/15227.38 − 1 ≈ 1.977%
    const prev = CHANGZHOU_LOCK_SERIES[CHANGZHOU_LOCK_SERIES.length - 2]
    expect((last.through / prev.through - 1) * 100).toBeCloseTo(1.97, 1)
  })
})

describe('westRiverTransferAt 插值', () => {
  it('锚点年原值透传（2030/2040/2050）', () => {
    expect(westRiverTransferAt(2030)).toEqual(WEST_RIVER_TRANSFER_ANCHORS[0])
    expect(westRiverTransferAt(2050)).toEqual(WEST_RIVER_TRANSFER_ANCHORS[2])
  })
  it('2035 中点：煤 (386.89+470.47)/2=428.68，粮食 (783.47+891.64)/2=837.555', () => {
    const r = westRiverTransferAt(2035)
    expect(r.coal).toBeCloseTo(428.68, 9)
    expect(r.grain).toBeCloseTo(837.555, 9)
    expect(r.ironOre).toBeCloseTo((294.06 + 333.22) / 2, 9)
  })
  it('域外 clamp 不外推：2027=2030 值、2055=2050 值（罗淳未给锚点外依据）', () => {
    expect(westRiverTransferAt(2027)).toEqual(WEST_RIVER_TRANSFER_ANCHORS[0])
    expect(westRiverTransferAt(2055)).toEqual(WEST_RIVER_TRANSFER_ANCHORS[2])
  })
  it('砂石水泥恒 0（罗淳 §5.3.4：下行砂石水泥不可能转移——负结果锚点）', () => {
    for (const y of [2027, 2030, 2035, 2040, 2045, 2050, 2060]) {
      expect(westRiverTransferAt(y).sandCement).toBe(0)
    }
  })
})

describe('diversionBreakdown 分解', () => {
  it('分港分摊：份额×货类，total=三货类和（2030 钦州 0.47）', () => {
    const r = diversionBreakdown(2030, CANAL_PORT_SHARES)
    const qz = r.byPort.qinzhou
    expect(qz.coal).toBeCloseTo(386.89 * 0.47, 9)
    expect(qz.grain).toBeCloseTo(783.47 * 0.47, 9)
    expect(qz.total).toBeCloseTo(qz.coal + qz.grain + qz.ironOre, 9)
    // 全港合计 = 转移总量（1464.42 手工核）
    const sum = Object.values(r.byPort).reduce((a, b) => a + b.total, 0)
    expect(sum).toBeCloseTo(386.89 + 783.47 + 294.06, 9)
  })
  it('份额和≠1 拒收（显示名映射不改变既有入参校验）', () => {
    expect(() => diversionBreakdown(2030, { qinzhou: 0.5, beihai: 0.4 })).toThrow(/份额和/)
  })
  it('桑基三段结构：1 条西江上行货→平陆运河 + 三港各 1 条（港集合由 CANAL_PORT_SHARES 派生）', () => {
    const r = diversionBreakdown(2030, CANAL_PORT_SHARES)
    const expectedPorts = PORT_PORTS.filter((p) => p.key in CANAL_PORT_SHARES)
    expect(expectedPorts).toHaveLength(3)
    expect(r.sankeyFlows).toHaveLength(1 + expectedPorts.length)
    const [trunk, ...legs] = r.sankeyFlows
    expect(trunk).toMatchObject({ from: '西江上行货', to: '平陆运河' })
    expect(legs.map((f) => f.from)).toEqual(expectedPorts.map(() => '平陆运河'))
    expect(new Set(legs.map((f) => f.to))).toEqual(new Set(expectedPorts.map((p) => p.name)))
    for (const leg of legs) {
      // 三港分支标签为纯中文港名，不得回退成 id/拼音
      expect(leg.to).toMatch(/^[\u4e00-\u9fff]+$/)
      expect(leg.to).not.toMatch(/[a-z]{3,}/)
    }
  })
  it('桑基守恒：入边 == 3 出边之和 == 西江三货类之和；出边逐港 == byPort.total', () => {
    const r = diversionBreakdown(2030, CANAL_PORT_SHARES)
    const [trunk, ...legs] = r.sankeyFlows
    const transferSum = r.transfer.coal + r.transfer.grain + r.transfer.ironOre
    const legsSum = legs.reduce((a, b) => a + b.value, 0)
    expect(trunk.value).toBeCloseTo(transferSum, 9)
    expect(trunk.value).toBeCloseTo(legsSum, 9)
    const nameToKey: Record<string, string> = {}
    for (const p of PORT_PORTS) {
      nameToKey[p.name] = p.key
    }
    for (const leg of legs) {
      expect(leg.value).toBeCloseTo(r.byPort[nameToKey[leg.to]].total, 9)
    }
  })
  it('拼音不得回流：每条桑基边 from/to 均不含 [a-z]{3,}；byPort 键仍是数据 id', () => {
    const r = diversionBreakdown(2035, CANAL_PORT_SHARES)
    for (const flow of r.sankeyFlows) {
      expect(flow.from).not.toMatch(/[a-z]{3,}/)
      expect(flow.to).not.toMatch(/[a-z]{3,}/)
    }
    expect(Object.keys(r.byPort).sort()).toEqual(Object.keys(CANAL_PORT_SHARES).sort())
  })
  it('未知港口 id 无中文显示名 → 显式抛错，不允许 id 冒充节点文本', () => {
    expect(() => diversionBreakdown(2030, { qinzhou: 0.5, beihai: 0.5, nansha: 0 })).toThrow(
      /未知港口 id/
    )
  })
})

describe('港口中文显示名权威源（跨边界契约）', () => {
  it('PORT_DISPLAY_NAMES 与 frontend PORT_PORTS 逐键一致——改任一侧即红', () => {
    const authoritative = Object.fromEntries(PORT_PORTS.map((p) => [p.key, p.name]))
    expect(PORT_DISPLAY_NAMES).toEqual(authoritative)
  })
})
