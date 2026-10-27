import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BASELINE_PATH, compare, currentCounts, newItems } from '../ratchet.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const readBaseline = () => JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))

describe('深路径穿透棘轮判据（W59）', () => {
  it('基线真实：total 与按组明细自洽，且与真实扫描一致', () => {
    const baseline = readBaseline()
    const current = currentCounts()
    expect(current.total).toBe(baseline.total)
    const summed = Object.values(current.byGroup).reduce((a, b) => a + b, 0)
    expect(summed).toBe(baseline.total)
    expect(Object.entries(current.byGroup).every(([g, n]) => baseline.byGroup[g] === n)).toBe(true)
  })

  it('基线自相矛盾（total≠items.length）⇒ 红（Q26）', () => {
    const baseline = { ...readBaseline(), total: readBaseline().total + 1 }
    const bad = compare(currentCounts(), baseline)
    expect(bad.some((b) => b.includes('基线自相矛盾'))).toBe(true)
  })

  it('持平通过；总量上涨即红且点名涨幅', () => {
    const baseline = readBaseline()
    const current = currentCounts()
    expect(compare(current, baseline)).toEqual([])

    const up = { total: current.total + 1, byGroup: current.byGroup, items: current.items }
    const bad = compare(up, baseline)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain(`总量上涨：${baseline.total} → ${baseline.total + 1}`)
  })

  it('按模块组各自只许降：单组上涨即红，即使总量持平', () => {
    // 治「A 组收敛、B 组长回来、总量持平」的掩盖（与 tools/dup/ratchet.mjs 同一判据）
    const baseline = readBaseline()
    const current = currentCounts()
    const g = Object.keys(current.byGroup)[0]
    const swapped = {
      total: current.total,
      byGroup: {
        ...current.byGroup,
        [g]: current.byGroup[g] + 1,
        [Object.keys(current.byGroup)[1]]: current.byGroup[Object.keys(current.byGroup)[1]] - 1,
      },
      items: current.items,
    }
    const bad = compare(swapped, baseline)
    expect(bad.some((b) => b.startsWith(`${g} 上涨`))).toBe(true)
  })

  it('同数替换（一增一减）不判红，但点名新增项', () => {
    const baseline = readBaseline()
    const current = currentCounts()
    const added = {
      file: 'zzz-new/page.vue',
      target: 'shared/utils/newHelper',
      group: 'shared/utils',
    }
    const removed = current.items[0]
    const swapped = {
      total: current.total,
      byGroup: current.byGroup,
      items: [...current.items.slice(1), added],
    }
    expect(compare(swapped, baseline)).toEqual([])
    const names = newItems(swapped, baseline)
    // 只钉条数与身份（这条穿透确实被点出来了），不钉分隔符字面量——
    // 分隔符是等价可改的呈现层（AGENTS §5.3 第三式：等价重构不许红）。
    expect(names).toHaveLength(1)
    expect(names[0]).toEqual(added)
    expect(removed.file).not.toBe(added.file)
  })

  it('空集且基线非 0 ⇒ 红（W58 同族：判据的循环体一次都没执行不能报通过）', () => {
    const baseline = readBaseline()
    const bad = compare({ total: 0, byGroup: {}, items: [] }, baseline)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain('0 个深路径穿透')
    expect(bad[0]).toContain('frontend/src')
  })

  it('基线 total 为 0 时空集不红（该面确无债，不是判据失效）', () => {
    expect(compare({ total: 0, byGroup: {} }, { total: 0 })).toEqual([])
  })

  it('基线缺 byGroup 时跳过按组比较（否则首次接线把存量全判上涨）', () => {
    // 与 tools/dup/ratchet.mjs 的同一条边界
    expect(compare(currentCounts(), { total: currentCounts().total })).toEqual([])
  })
})

/** 下面两条是门禁自身的能红性（AGENTS §5.3：从未红过的门禁 = 不存在） */
describe('端到端：真实仓库上跑 ratchet 主流程', () => {
  it('当前树通过（exit 0 且打印条数）', () => {
    const out = spawnRatchet()
    expect(out.code).toBe(0)
    expect(out.output).toContain(`穿透 ${readBaseline().total} 条 ≤ 基线`)
  })

  it('🔴 红线样例：基线被人动过即红（治「基线由扫描结果现算」的假绿）', () => {
    // 判据必须读**版本控制里的基线文件**，不能拿扫描结果当基线——那样它永远绿，
    // 因为它量的是自己（M4c 变异四式）。这里只验「基线压低 ⇒ 当前值高于基线 ⇒ 报
    // 总量上涨」：这是唯一有语义的方向（基线抬高只会让判据更宽松，不该由它单独承担
    // 「必须红」的责任，否则等于要求一个比对函数对两个方向都报错，那是把断言写反）。
    const base = readBaseline()
    const down = spawnRatchetWithBaseline({ ...base, total: base.total - 1 })
    expect(down.code).toBe(1)
    expect(down.output).toContain('总量上涨')
    // 原样回写，确认本用例没有留下任何痕迹
    expect(readBaseline()).toEqual(base)
  })
})

import { execFileSync } from 'node:child_process'

/**
 * 用指定基线跑一次主流程。
 *
 * 走 `--baseline=<临时文件>` 注入，**不写仓库里的基线文件**：旧写法是「备份 → 覆写
 * BASELINE_PATH → 跑 → finally 还原」，写入或还原任一步失败（只读沙箱、进程被杀、
 * 超时）都会把仓库基线写成 `total` 与 `items` 自相矛盾的样子，而那个矛盾态**没有
 * 任何判据能发现**——2026-10-21 的工作树就是这样被留在 `total 79 / items 80` 的。
 */
function spawnRatchetWithBaseline(baselineObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-import-baseline-'))
  const tmp = path.join(dir, 'baseline.json')
  fs.writeFileSync(tmp, JSON.stringify(baselineObj, null, 2) + '\n')
  try {
    return spawnRatchet(['--baseline', tmp])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 跑一次棘轮主流程，取退出码与合并后的输出。
 *
 * 用**文件描述符**承接子进程输出，不用 `stdio: 'pipe'`：受限沙箱封的是「父进程拉管道」
 * （`spawnSync … EPERM`），而 `stdio: [fd, fd]` 走文件句柄不受限——两条 E2E 用例因此
 * 能在受限环境里取证，而不是长期挂着「环境限制」不跑（AGENTS §5.4：从未红过的门禁 =
 * 不存在）。
 */
function spawnRatchet(extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-import-run-'))
  const out = path.join(dir, 'out.txt')
  const fd = fs.openSync(out, 'w')
  try {
    try {
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'tools/deep-import/ratchet.mjs'), ...extraArgs],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', fd, fd] }
      )
      return { code: 0, output: fs.readFileSync(out, 'utf8') }
    } catch (e) {
      return { code: e.status ?? 1, output: fs.readFileSync(out, 'utf8') }
    }
  } finally {
    fs.closeSync(fd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
