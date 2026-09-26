/**
 * dispatch 的自测（真红样 + 活文档回归）。
 *
 * 两条底线：
 *  1) 切分账必须**可复算**：闭集不相交、并集=全集、窗数变化不丢指标；
 *  2) 生成的 brief 必须**过 audit-kit 的复算契约**（§0 抽得出块、每条命令带期望），
 *     否则派单器自己就在生产「交个空壳也算交过」的件。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  buildSlices,
  overlapProposals,
  parseRequiredReading,
  partition,
  renderBrief,
} from '../dispatch.mjs'
import { extractBashBlocks } from '../extract-window.mjs'
import { parseSpec } from '../metrics-index.mjs'
import { CONVENTION, ROOT } from '../paths.mjs'

const m = (专项, 部分, id, 成本 = 10, paths = []) => ({
  id: `${专项}-${id}`,
  专项,
  部分,
  部分标题: `第${部分}部分`,
  专项文件: `docs/根基文档/审查体系专项/${专项}-x.md`,
  文内编号: id,
  名称: `指标${id}`,
  风险等级: 'P1',
  可执行性: 'manual',
  缺失字段: [],
  面: { paths, patterns: [], missing: [] },
  行号: 10,
})

const fakeEntries = [
  ...[1, 2, 3].map((p) => m('专项1', p, `1.${p}`, 20, ['tools/audit-kit'])),
  ...[1, 2].map((p) => m('专项2', p, `2.${p}`, 30, ['tools/v3-guard'])),
  m('专项1', 0, '0.1', 5),
]

describe('dispatch — 必读表从 约定.md 现读（单一口径，防两处定义）', () => {
  it('约定.md §4 的表能解出 8 个专项的必读章节', () => {
    const map = parseRequiredReading()
    expect([...map.keys()].sort()).toEqual([
      '专项1',
      '专项2',
      '专项3',
      '专项4',
      '专项5',
      '专项6',
      '专项7',
      '专项8',
    ])
    expect(map.get('专项1')).toContain('02')
  })

  it('删掉表行 ⇒ 解不出该行（第一式：删字面必红）', () => {
    const md = readFileSync(CONVENTION, 'utf8')
    const cut = md.replace(/^\|\s*专项1[^\n]*\n/m, '')
    expect(parseRequiredReading(cut).has('专项1')).toBe(false)
    expect(parseRequiredReading(cut).size).toBe(parseRequiredReading(md).size - 1)
  })

  it('把表头改成别的写法（同义改写）不许悄悄变绿：解出数必须仍等于 8', () => {
    expect(parseRequiredReading().size).toBe(8)
  })
})

describe('dispatch — 切片与装箱', () => {
  const { slices, unassigned } = buildSlices(fakeEntries)

  it('切片单位是「专项 × 部分」，未归部的单列不静默丢弃', () => {
    expect(slices.map((s) => s.key)).toEqual([
      '专项1-1',
      '专项1-2',
      '专项1-3',
      '专项2-1',
      '专项2-2',
    ])
    expect(unassigned.map((e) => e.id)).toEqual(['专项1-0.1'])
  })

  it('成本随指标数单调上涨（同一切片加一条指标，成本必须变高）', () => {
    const one = buildSlices([m('专项1', 1, '1.1', 20, ['tools/audit-kit'])]).slices[0]
    const two = buildSlices([m('专项1', 1, '1.1'), m('专项1', 1, '1.2')]).slices[0]
    expect(two.指标.length).toBe(2)
    expect(two.成本).toBeGreaterThan(0)
    expect(one.成本).toBeGreaterThan(0)
    expect(two.可机判数).toBe(0)
  })

  it('窗数 = 专项数 ⇒ 一窗一专项（约定.md §4 声明的并行模型）', () => {
    const bins = partition(slices, 2)
    expect(bins.map((b) => [...b.专项].join('+'))).toEqual(['专项1', '专项2'])
  })

  it('窗数 < 专项数 ⇒ 不劈专项（宁可失衡也不把同专项散到两窗）', () => {
    const many = [
      ...[1, 2].map((p) => m('专项1', p, `1.${p}`, 20)),
      ...[1, 2].map((p) => m('专项2', p, `2.${p}`, 20)),
      ...[1, 2].map((p) => m('专项3', p, `3.${p}`, 20)),
    ]
    const bins = partition(buildSlices(many).slices, 2)
    const 分布 = new Map()
    for (const b of bins)
      for (const s of b.slices) 分布.set(s.专项, (分布.get(s.专项) || new Set()).add(b.id))
    expect([...分布.values()].every((set) => set.size === 1)).toBe(true)
    expect(bins.reduce((n, b) => n + b.slices.length, 0)).toBe(6)
  })

  it('窗数 > 专项数 ⇒ 劈最重窗，失衡比收敛到 ≤1.6 且指标不丢', () => {
    const bins = partition(slices, 5)
    const costs = bins.map((b) => b.成本)
    expect(bins.reduce((n, b) => n + b.slices.reduce((k, s) => k + s.指标.length, 0), 0)).toBe(5)
    expect(Math.max(...costs) / Math.min(...costs.filter((c) => c > 0))).toBeLessThanOrEqual(1.6)
  })

  it('重叠候选：两面相同 ⇒ 报；无面 ⇒ 不报（不假装算得出）', () => {
    const pair = buildSlices([
      m('专项1', 1, '1.1', 9, ['tools/audit-kit']),
      m('专项1', 2, '2.1', 9, ['tools/audit-kit']),
    ]).slices
    expect(overlapProposals(pair)[0].对).toBe('专项1-1 + 专项1-2')
    const bare = fakeEntries.map((e) => ({ ...e, 面: { paths: [], patterns: [], missing: [] } }))
    expect(overlapProposals(buildSlices(bare).slices)).toEqual([])
  })
})

describe('dispatch — brief 必须过 audit-kit 自己的复算契约', () => {
  const bins = partition(buildSlices(fakeEntries).slices, 2)
  const ctx = {
    batch: 'T1',
    head: 'abc1234',
    windows: 2,
    必读: parseRequiredReading(),
    统计: {},
    未归部: 1,
    重叠: [],
  }
  const md = renderBrief(bins[0], ctx)

  it('§0 抽得出 bash 块（抽不出 = 派单器在造空壳件）', () => {
    const blocks = extractBashBlocks(md)
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('块内每条命令紧跟一行 `# 期望:`，且不留尖括号占位', () => {
    for (const b of extractBashBlocks(md)) {
      const lines = b.split('\n').filter((l) => l.trim())
      lines.forEach((l, i) => {
        if (/^# 期望:/.test(l)) return
        expect(lines[i + 1] || '').toMatch(/^# 期望: /)
      })
      expect(b).not.toMatch(/# 期望:\s*</)
    }
  })

  it('闭集表行数 = 本窗指标数，发现前缀带窗号，路径写的是 约定.md 而不是抄一份', () => {
    const 表行 = md.split('\n').filter((l) => /^\| 专/.test(l)).length
    expect(表行).toBe(bins[0].slices.reduce((n, s) => n + s.指标.length, 0))
    expect(md).toContain(`发现编号前缀固定 \`${bins[0].id}-\``)
    expect(md).toContain('审查体系约定.md')
    expect(md).toContain('专项1：')
  })
})

describe('dispatch — 真实 396 指标回归', () => {
  const { slices } = buildSlices(parseSpec())

  it('切片覆盖正文全量且两两不相交（切窗不重不漏）', () => {
    const ids = slices.flatMap((s) => s.指标.map((e) => e.id))
    const 全集 = parseSpec()
    expect(ids.length).toBe(全集.length)
    expect(new Set(ids).size).toBe(全集.length)
  })

  it('切片数 = 专项×部分 的实际组合数（改层级须同步 约定.md §4）', () => {
    const 组合 = new Set(parseSpec().map((e) => `${e.专项}-${e.部分}`)).size
    expect(slices.length).toBe(组合)
    expect(slices.filter((s) => s.专项 === '专项1').length).toBe(9)
  })

  it('每个切片的出处必须指向真实存在的专项文件（判据不得读脏件/假路径）', () => {
    for (const s of slices) {
      expect(s.专项文件).toMatch(/^docs\/根基文档\/审查体系专项\/专项[1-8]-.*\.md$/)
      expect(existsSync(path.join(ROOT, s.专项文件))).toBe(true)
    }
  })
})
