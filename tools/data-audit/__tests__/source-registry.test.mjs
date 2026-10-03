// W9 数据来源登记的判据（纯函数层 + 真实仓库集成）。
//
// 核心性质：**覆盖判定必须由扫描派生**，不得写成手写清单——
// 测试用"删掉一组 ⇒ 该组文件立刻变成未登记"来钉这一点（阴性对照的另一半是"存在即覆盖"）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeCoverage,
  groupCovers,
  matchesGlob,
  SCAN_ROOTS,
  validateRegistry,
} from '../source-registry.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = path.join(HERE, '..', 'source-registry.json')

describe('matchesGlob：极简 glob（** 与 *）', () => {
  it('** 覆盖任意深度', () => {
    expect(matchesGlob('backend/static/dem/a/b.b3dm', 'backend/static/dem/**')).toBe(true)
    expect(matchesGlob('backend/static/pinglu/x.json', 'backend/static/dem/**')).toBe(false)
  })

  it('无 * 的模式按精确相等处理', () => {
    expect(matchesGlob('backend/data/README.md', 'backend/data/README.md')).toBe(true)
    expect(matchesGlob('backend/data/README.md', 'backend/data/other.md')).toBe(false)
  })

  it('* 不跨目录', () => {
    expect(matchesGlob('a/b.json', 'a/*.json')).toBe(true)
    expect(matchesGlob('a/b/c.json', 'a/*.json')).toBe(false)
  })
})

describe('groupCovers：paths 精确 vs globs 前缀', () => {
  const g = {
    id: 'g',
    paths: ['exact.json'],
    globs: ['sub/**'],
    source: 's',
    license: 'l',
    fetchedAt: 'f',
    coverage: 'c',
    quality: 'q',
  }

  it('精确路径与 glob 各认各的，互不越界', () => {
    expect(groupCovers(g, 'exact.json')).toBe(true)
    expect(groupCovers(g, 'exact.json.bak')).toBe(false)
    expect(groupCovers(g, 'sub/deep/x.json')).toBe(true)
    expect(groupCovers(g, 'subx/x.json')).toBe(false)
  })
})

describe('computeCoverage：覆盖由扫描派生', () => {
  const groups = [
    {
      id: 'g1',
      paths: ['a.json'],
      source: 's',
      license: 'l',
      fetchedAt: 'f',
      coverage: 'c',
      quality: 'q',
    },
    {
      id: 'g2',
      globs: ['sub/**'],
      source: 's',
      license: 'l',
      fetchedAt: 'f',
      coverage: 'c',
      quality: 'q',
    },
  ]

  it('全覆盖 ⇒ 无缺口，且计数正确', () => {
    const r = computeCoverage(['a.json', 'sub/x.json', 'sub/y.json'], groups)
    expect(r.gaps).toEqual([])
    expect(r.counts.g1).toBe(1)
    expect(r.counts.g2).toBe(2)
  })

  it('未登记文件进 gaps（新增资产忘登记即红）', () => {
    const r = computeCoverage(['a.json', 'b.json'], groups)
    expect(r.gaps).toEqual(['b.json'])
  })

  it('删掉一组 ⇒ 该组文件立刻变缺口（证明不是手写清单）', () => {
    const r = computeCoverage(['a.json', 'sub/x.json'], [groups[1]])
    expect(r.gaps).toEqual(['a.json'])
  })
})

describe('validateRegistry：登记表自检', () => {
  it('真实登记表无问题', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    expect(validateRegistry(reg)).toEqual([])
  })

  it('缺字段 / id 重复 / 空组都要报（阴性对照）', () => {
    const bad = {
      groups: [
        { id: 'x', paths: ['a'], source: 's', license: 'l', fetchedAt: 'f', coverage: 'c' }, // 缺 quality
        {
          id: 'x',
          paths: ['b'],
          source: 's',
          license: 'l',
          fetchedAt: 'f',
          coverage: 'c',
          quality: 'q',
        }, // id 重复
        { id: 'y', source: 's', license: 'l', fetchedAt: 'f', coverage: 'c', quality: 'q' }, // 无 paths/globs
      ],
    }
    const problems = validateRegistry(bad)
    expect(problems.some((p) => p.includes('缺字段 quality'))).toBe(true)
    expect(problems.some((p) => p.includes('id 重复'))).toBe(true)
    expect(problems.some((p) => p.includes('既无 paths 也无 globs'))).toBe(true)
  })

  it('每组必须显式声明 provenanceStatus 之外的必填项 + pending 是要还的债', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    for (const g of reg.groups) {
      expect(['confirmed', 'pending']).toContain(g.provenanceStatus)
    }
  })
})

describe('真实仓库：数据资产零缺口', () => {
  it('git ls-files 出的每一件都被登记（集成断言）', () => {
    const r = spawnSync('git', ['ls-files', ...SCAN_ROOTS], {
      cwd: path.join(HERE, '..', '..', '..'),
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    const files = r.stdout.split('\n').filter(Boolean)
    expect(files.length).toBeGreaterThan(0)
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    expect(computeCoverage(files, reg.groups).gaps).toEqual([])
  })
})
