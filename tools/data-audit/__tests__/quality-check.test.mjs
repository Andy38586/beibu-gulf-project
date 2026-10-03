// W9 质量检查器的判据（纯函数 + 真实资产集成）。
//
// 每格都配阳性对照：合法输入必须过、违约输入必须红——否则"全部通过"可能只是判据没生效。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  checkAsset,
  checkSeriesElements,
  checkUniqueIds,
  coordsOf,
  filesOfGroup,
  inBbox,
  PROJECT_BBOX,
} from '../quality-check.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const REGISTRY = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'source-registry.json'), 'utf8'))

const ok = (time, value) => ({ time, value })

describe('checkSeriesElements：月份单调 + 值有限', () => {
  it('阳性对照：合法序列零错误', () => {
    expect(
      checkSeriesElements([ok('2021-01', 1), ok('2021-02', 2), ok('2021-03', 3)], 's')
    ).toEqual([])
  })

  it('月份不严格递增 ⇒ 报错（重复与回退各一）', () => {
    const dup = checkSeriesElements([ok('2021-01', 1), ok('2021-01', 2)], 's')
    expect(dup.some((e) => e.includes('未严格递增'))).toBe(true)
    const back = checkSeriesElements([ok('2021-02', 1), ok('2021-01', 2)], 's')
    expect(back.some((e) => e.includes('未严格递增'))).toBe(true)
  })

  it('时间形状非法 / 值非有限 / 空数组都要报', () => {
    expect(
      checkSeriesElements([{ time: '21-1', value: 1 }], 's').some((e) => e.includes('形状非法'))
    ).toBe(true)
    expect(checkSeriesElements([ok('2021-01', NaN)], 's').some((e) => e.includes('非有限数'))).toBe(
      true
    )
    expect(checkSeriesElements([], 's').some((e) => e.includes('不是非空数组'))).toBe(true)
    expect(checkSeriesElements(undefined, 's').length).toBe(1)
  })
})

describe('inBbox：项目空间域', () => {
  it('域内通过、域外拒绝、边界含端点', () => {
    expect(inBbox(108.6, 21.7)).toBe(true)
    expect(inBbox(100, 21.7)).toBe(false)
    expect(inBbox(108.6, 30)).toBe(false)
    expect(inBbox(PROJECT_BBOX.minLon, PROJECT_BBOX.minLat)).toBe(true)
    expect(inBbox(NaN, 21)).toBe(false)
  })
})

describe('checkUniqueIds / coordsOf', () => {
  it('id 重复必报', () => {
    expect(checkUniqueIds([{ id: 'a' }, { id: 'a' }], 'x')).toHaveLength(1)
    expect(checkUniqueIds([{ id: 'a' }, { id: 'b' }], 'x')).toHaveLength(0)
  })

  it('坐标提取支持 Point 与嵌套 Polygon', () => {
    expect(coordsOf({ type: 'Point', coordinates: [1, 2] })).toEqual([[1, 2]])
    expect(
      coordsOf({
        type: 'Polygon',
        coordinates: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      })
    ).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(coordsOf(null)).toEqual([])
  })
})

describe('filesOfGroup：登记组展开', () => {
  it('精确路径与 glob 各认各的', () => {
    const files = [
      'backend/data/a.json',
      'backend/static/dem/x.json',
      'backend/static/other/y.json',
    ]
    expect(filesOfGroup(files, { paths: ['backend/data/a.json'] })).toEqual(['backend/data/a.json'])
    expect(filesOfGroup(files, { globs: ['backend/static/dem/**'] })).toEqual([
      'backend/static/dem/x.json',
    ])
  })
})

describe('真实资产集成：登记表覆盖的 JSON 零失败', () => {
  it('git ls-files 出的 JSON 逐件检查，无 FAIL（且确实检查了东西）', () => {
    const r = spawnSync('git', ['ls-files', 'backend/data', 'backend/static'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    const files = r.stdout.split('\n').filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    let checked = 0
    const fails = []
    for (const g of REGISTRY.groups) {
      for (const rel of filesOfGroup(files, g)) {
        const abs = path.join(ROOT, rel)
        if (!fs.existsSync(abs)) continue
        checked++
        fails.push(...checkAsset(abs, rel, g.id).filter((f) => !f.ok))
      }
    }
    expect(checked).toBeGreaterThan(5)
    expect(fails).toEqual([])
  })
})
