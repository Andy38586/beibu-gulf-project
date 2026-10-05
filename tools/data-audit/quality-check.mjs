#!/usr/bin/env node
/**
 * quality-check.mjs — 数据资产的**质量判据**（W9 第二半）。
 *
 * ## 与 source-registry.mjs 的分工
 *
 * - `source-registry.mjs` 管「**有没有登记**」（来源/许可/取数时间）；
 * - 本件管「**登记了的东西本身干不干净**」：序列单调且无空洞、值有限、坐标落在项目域内、
 *   id 唯一、统计非负。
 *
 * ## 为什么值得有
 *
 * 这批 JSON 是页面的直接数据源。历史上真出过"点位坐标是 mock"「数值口径漂移」这类事故
 * （见各文件自带的 `_provenance`/`_coordinateProvenance` 段）——**没有判据时只能靠人记得去看**。
 *
 * ## 覆盖范围（诚实边界）
 *
 * 只覆盖**文件型资产**（backend/data、backend/static 里可解析的 JSON）。**库内表的质量判据
 * （3 张承重表的空值率/范围/几何有效性）尚未做**——它需要 DB 客户端路径与 CI 门控口径，
 * 属下一笔；本件不假装覆盖了库。
 *
 * 用法：
 *   node tools/data-audit/quality-check.mjs          # 人读表格；有 FAIL 即 exit 1
 *   node tools/data-audit/quality-check.mjs --json   # 机器可读
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { matchesGlob, SCAN_ROOTS } from './source-registry.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const REGISTRY_PATH = path.join(HERE, 'source-registry.json')

/** 项目空间域（北部湾三港及周边）——坐标越界即判红 */
export const PROJECT_BBOX = { minLon: 107, maxLon: 111, minLat: 20, maxLat: 23 }

const MONTH_RE = /^\d{4}-\d{2}$/

export function inBbox(lon, lat, bbox = PROJECT_BBOX) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  )
}

/** 序列元素质量：time 形状 + 值有限 + 月份严格递增且不重复 */
export function checkSeriesElements(series, label) {
  const errors = []
  if (!Array.isArray(series) || series.length === 0) {
    errors.push(label + '：不是非空数组')
    return errors
  }
  let prev = ''
  for (let i = 0; i < series.length; i++) {
    const el = series[i]
    const time = el && typeof el === 'object' ? el.time : undefined
    if (typeof time !== 'string' || !MONTH_RE.test(time)) {
      errors.push(label + '[' + i + ']：time 形状非法（' + String(time) + '）')
      continue
    }
    if (prev && time <= prev)
      errors.push(label + '[' + i + ']：月份未严格递增（' + prev + ' → ' + time + '）')
    prev = time
    if (!Number.isFinite(el.value))
      errors.push(label + '[' + i + ']：value 非有限数（' + String(el.value) + '）')
  }
  return errors
}

/** id 唯一性 */
export function checkUniqueIds(items, label, key = 'id') {
  const errors = []
  const seen = new Set()
  for (const it of items ?? []) {
    const id = it?.[key]
    if (id === undefined) continue
    if (seen.has(id)) errors.push(label + '：id 重复 ' + String(id))
    seen.add(id)
  }
  return errors
}

/** 取 FeatureCollection 里的全部坐标对（支持 Point/Polygon/LineString） */
export function coordsOf(geometry) {
  if (!geometry) return []
  const out = []
  const walk = (c) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') out.push(c)
    else c.forEach(walk)
  }
  walk(geometry.coordinates)
  return out
}

/** 展开登记组覆盖的文件 */
export function filesOfGroup(files, group) {
  const exact = group.paths ?? []
  const globs = group.globs ?? []
  return files.filter((f) => exact.includes(f) || globs.some((g) => matchesGlob(f, g)))
}

function trackedFiles() {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', ...SCAN_ROOTS], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error('git ls-files 失败')
  return r.stdout.split('\n').filter(Boolean)
}

/** 对一个 JSON 资产跑全部适用判据（IO 在此收敛，便于测试只测纯函数） */
export function checkAsset(absPath, relPath, groupId) {
  const findings = []
  let json
  try {
    json = JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch (e) {
    return [
      { asset: relPath, check: 'json-parse', ok: false, detail: String(e.message).slice(0, 120) },
    ]
  }
  const add = (check, ok, detail = '') => findings.push({ asset: relPath, check, ok, detail })

  add('json-parse', json !== null, json === null ? '顶层为 null' : '')

  // 通用：序列类资产（data.<port>.{historical,forecast}）
  if (json.data && typeof json.data === 'object') {
    const ports = Object.keys(json.data)
    const lens = []
    for (const p of ports) {
      const hist = json.data[p]?.historical
      const errs = checkSeriesElements(hist, relPath + ' ' + p + '.historical')
      add('series-historical', errs.length === 0, errs.slice(0, 2).join('；'))
      if (Array.isArray(hist)) lens.push(hist.length)
      const fc = json.data[p]?.forecast
      if (fc) {
        const ferrs = checkSeriesElements(fc, relPath + ' ' + p + '.forecast')
        add('series-forecast', ferrs.length === 0, ferrs.slice(0, 2).join('；'))
      }
      const coords = (json.data[p]?.spatial?.features ?? []).flatMap((f) => coordsOf(f.geometry))
      const bad = coords.filter(([lon, lat]) => !inBbox(lon, lat))
      add(
        'spatial-bbox',
        bad.length === 0,
        bad.length ? bad.length + ' 个坐标越界，例 ' + JSON.stringify(bad[0]) : ''
      )
    }
    if (lens.length > 1 && new Set(lens).size > 1)
      add('ports-consistent', false, '各港历史点数不一致：' + lens.join('/'))
    else if (lens.length) add('ports-consistent', true, lens.length + ' 港 × ' + lens[0] + ' 点')
  }

  // flood 设施点
  if (Array.isArray(json.facilities)) {
    const bad = json.facilities.filter((f) => !inBbox(f?.lng, f?.lat))
    add(
      'facilities-bbox',
      bad.length === 0,
      bad.length ? bad.length + ' 个设施坐标越界，例 ' + JSON.stringify(bad[0]?.id) : ''
    )
    const dup = checkUniqueIds(json.facilities, relPath + ' facilities')
    add('facilities-unique-id', dup.length === 0, dup.slice(0, 2).join('；'))
    const missing = json.facilities.filter((f) => !Number.isFinite(f?.elevation))
    add(
      'facilities-elevation',
      missing.length === 0,
      missing.length ? missing.length + ' 条缺 elevation' : ''
    )
  }

  // 水域面
  if (Array.isArray(json.coordinates)) {
    const bad = json.coordinates.filter(([lon, lat]) => !inBbox(lon, lat))
    add('waterarea-bbox', bad.length === 0, bad.length ? bad.length + ' 个顶点越界' : '')
  }

  // 洪涝统计：非负
  if (Array.isArray(json.statistics)) {
    const neg = json.statistics.filter(
      (s) => s?.floodArea < 0 || s?.maxDepth < 0 || s?.averageDepth < 0
    )
    add('statistics-nonneg', neg.length === 0, neg.length ? neg.length + ' 条出现负值' : '')
    add('statistics-nonempty', json.statistics.length > 0, '共 ' + json.statistics.length + ' 档')
  }

  // 水位基准：模拟区间包含默认值（滑块可用性的前提）
  if (json.simulationRange && Number.isFinite(json.simulationRange.defaultHeight)) {
    const r = json.simulationRange
    add(
      'waterlevel-range',
      r.defaultHeight >= r.minHeight && r.defaultHeight <= r.maxHeight,
      JSON.stringify(r)
    )
  }

  // 元数据新鲜度：文件自带 updatedAt/createdAt 时，报告出来（不作为 FAIL——它是要人看的债）
  const stamp = json.metadata?.updatedAt ?? json.metadata?.createdAt
  if (stamp)
    findings.push({ asset: relPath, check: 'metadata-stamp', ok: true, detail: String(stamp) })

  void groupId
  return findings
}

function main() {
  const asJson = process.argv.includes('--json')
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
  const files = trackedFiles().filter((f) => f.endsWith('.json'))
  const findings = []
  let checked = 0
  for (const g of registry.groups) {
    for (const rel of filesOfGroup(files, g)) {
      if (!fs.existsSync(path.join(ROOT, rel))) continue
      findings.push(...checkAsset(path.join(ROOT, rel), rel, g.id))
      checked++
    }
  }
  const fails = findings.filter((f) => !f.ok)

  if (asJson) {
    console.log(JSON.stringify({ checked, fails }, null, 2))
  } else {
    console.log(
      '[quality-check] 检查 JSON 资产 ' + checked + ' 件 / 判据 ' + findings.length + ' 条'
    )
    for (const f of findings) {
      const mark = f.ok ? '  ✓' : '  ✗'
      console.log(
        mark + ' ' + f.check.padEnd(22) + ' ' + f.asset + (f.detail ? '  — ' + f.detail : '')
      )
    }
    console.log(
      '[quality-check] ' + (fails.length === 0 ? '✓ 全部通过' : '✗ ' + fails.length + ' 条失败')
    )
  }
  process.exit(fails.length === 0 ? 0 : 1)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
