// db-import v2 硬化的核心语义测试（手册 T2.2）：三城映射、孤儿/缺坐标过滤、
// 运行时文件缺失容错、对账恒等式、幂等（两次构建语句一致）。fixture 注入临时目录。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildImport, renderReport } from '../../../tools/db-import.mjs'

let dataDir

function write(rel, content) {
  const full = path.join(dataDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbimport-'))
  // 最小三城 fixture
  write('users.json', JSON.stringify([{ id: 'u1', username: 'andy', tokenVersion: 0 }]))
  write('ports.json', '[]')
  for (const city of ['qz', 'bh', 'fcg']) {
    for (const k of [
      'hospital',
      'primary_school',
      'middle_school',
      'park',
      'bus_station',
      'mall',
    ]) {
      write(`site-selection/${city}_${k}.json`, '[]')
    }
    write(
      `site-selection/${city}_xiaoqu.json`,
      JSON.stringify([{ id: `${city}_x1`, name: 'x', lng: 108.5, lat: 21.7, district: 'd' }])
    )
  }
  write('flood/facilityPoints.json', JSON.stringify({ metadata: {}, facilities: [] }))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('buildImport 对账恒等式', () => {
  it('每表 source = written + filtered', () => {
    const { tables } = buildImport(dataDir)
    for (const t of Object.values(tables)) {
      expect(t.source).toBe(t.written + t.filtered)
    }
  })

  it('三城 POI/xiaoqui 入库且 city 列值正确', () => {
    for (const city of ['qz', 'bh', 'fcg']) {
      write(
        `site-selection/${city}_hospital.json`,
        JSON.stringify([{ id: `${city}_h1`, name: 'h', lng: 108.6, lat: 21.8, district: 'd' }])
      )
    }
    const { statements } = buildImport(dataDir)
    const poiInserts = statements.filter((s) => s.includes('INSERT INTO poi_facilities'))
    expect(poiInserts).toHaveLength(3)
    for (const [i, city] of ['qz', 'bh', 'fcg'].entries()) {
      expect(poiInserts[i]).toContain(`'${city}'`)
      expect(poiInserts[i]).toContain('ST_SetSRID(ST_MakePoint(108.6, 21.8), 4490)')
    }
  })

  it('缺坐标 POI 被过滤并计入 filtered + 警告', () => {
    write(
      'site-selection/qz_hospital.json',
      JSON.stringify([
        { id: 'ok1', name: 'a', lng: 108.6, lat: 21.8, district: 'd' },
        { id: 'bad1', name: 'b', district: 'd' },
      ])
    )
    const report = { warnings: [] }
    const { tables } = buildImport(dataDir, report)
    expect(tables.poi_facilities).toEqual({ source: 2, written: 1, filtered: 1 })
    expect(report.warnings.some((w) => w.includes('bad1'))).toBe(true)
  })

  it('孤儿方案被过滤（userId 不在 users）', () => {
    write(
      'plans.json',
      JSON.stringify([
        { id: 'p1', userId: 'u1', name: 'mine' },
        { id: 'p2', userId: 'ghost', name: 'orphan' },
      ])
    )
    const report = { warnings: [] }
    const { tables } = buildImport(dataDir, report)
    expect(tables.plans).toEqual({ source: 2, written: 1, filtered: 1 })
    expect(report.warnings.some((w) => w.includes('p2'))).toBe(true)
  })

  it('plans/favorites 运行时文件缺失按空集处理并警告（不崩）', () => {
    const report = { warnings: [] }
    const { tables } = buildImport(dataDir, report)
    expect(tables.plans).toEqual({ source: 0, written: 0, filtered: 0 })
    expect(tables.favorites).toEqual({ source: 0, written: 0, filtered: 0 })
    expect(report.warnings.filter((w) => w.includes('按空集处理'))).toHaveLength(2)
  })

  it('幂等：同输入两次构建语句完全一致（TRUNCATE 重灌语义）', () => {
    const a = buildImport(dataDir)
    const b = buildImport(dataDir)
    expect(a.statements).toEqual(b.statements)
    expect(a.statements[1]).toContain('TRUNCATE')
  })
})

describe('renderReport', () => {
  it('全表对账恒等 → 总体 PASS；破坏恒等 → FAIL', () => {
    const pass = renderReport({ users: { source: 2, written: 2, filtered: 0 } }, [])
    expect(pass).toContain('**总体：PASS**')
    const fail = renderReport({ users: { source: 2, written: 1, filtered: 0 } }, [])
    expect(fail).toContain('**总体：FAIL**')
  })
})
