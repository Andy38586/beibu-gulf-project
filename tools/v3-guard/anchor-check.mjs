#!/usr/bin/env node
/**
 * anchor-check — 热力锚点与参考基准守卫（v3 第 6 守卫）。
 *
 * 动因（2026-09-11）：cargo/container 两个**在用**指标的热力锚点是手写市区 mock 坐标
 *（钦州北偏约 25km），在生产存活数月才因性能测评被顺带发现。文件里的坐标「看着是数字」，
 * 没有任何门禁问过「它到底在不在港口上」——本守卫把该断言固化为 CI 不变量。
 *
 * 守卫的不变量：
 *   1. 前端实际消费的指标清单（useForecastLayer.ts 的 INDICATORS，权威源）中，
 *      每个指标文件、每个港口的 spatial 锚点，距最近权威港口 ≤ 2km；
 *   2. index.json 的 metadata.ports（锚点原始来源，曾被下游复制）同样在容差内；
 *   3. 已下架指标（berth/traffic）未被前端重新消费，且文件保留「未对齐/已废弃」
 *      来源标注——防止废弃坐标被当成真值再次复制（同根因二次污染）。
 *
 * 权威坐标：frontend/public/data/ports.json（与库内 ports 表、热力锚点同源）。
 *
 * 用法：node tools/v3-guard/anchor-check.mjs [--json]
 * 返回码：0 = 锚点全部合法；1 = 锚点漂移 / 标注缺失 / 消费面变化。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ANCHOR_TOLERANCE_KM = 2
export const EARTH_RADIUS_KM = 6371.0088

/** 已下架指标（源文件保留、坐标有意不对齐）——不得被前端重新消费 */
export const RETIRED_INDICATORS = ['berth', 'traffic']
/** 下架文件必须保留的来源标注关键词（任一命中即可） */
export const RETIRED_MARKERS = ['已废弃', '未对齐']

const PORTS_FILE = 'frontend/public/data/ports.json'
const FORECAST_DIR = 'backend/data/forecast'
const INDICATOR_SOURCE = 'frontend/src/business/forecast/composables/useForecastLayer.ts'

/** Haversine 距离（km）——与项目 turf/geography 口径同源（平均地球半径） */
export function distanceKm(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** 最近权威港口与距离 */
export function nearestPort(anchor, ports) {
  let best = null
  for (const p of ports) {
    const d = distanceKm(anchor, p)
    if (!best || d < best.distanceKm) best = { port: p, distanceKm: d }
  }
  return best
}

/**
 * 锚点集合评估（纯函数，供守卫与单测共用）。
 * @param {Array<{name: string, lng: number, lat: number}>} ports 权威港口坐标
 * @param {Array<{label: string, lng: number, lat: number}>} anchors 待检锚点
 * @param {number} toleranceKm 容差（km）
 * @returns {string[]} 违规描述（空数组 = 全部合法）
 */
export function evaluateAnchors(ports, anchors, toleranceKm = ANCHOR_TOLERANCE_KM) {
  const problems = []
  if (!Array.isArray(ports) || ports.length === 0) {
    return ['权威港口坐标（frontend/public/data/ports.json）为空，无法校验锚点']
  }
  for (const a of anchors) {
    if (!Number.isFinite(a.lng) || !Number.isFinite(a.lat)) {
      problems.push(`${a.label}：坐标缺失或非有限数值`)
      continue
    }
    const best = nearestPort(a, ports)
    if (best.distanceKm > toleranceKm) {
      problems.push(
        `${a.label}：距最近权威港口「${best.port.name}」${best.distanceKm.toFixed(2)}km（容差 ${toleranceKm}km）`
      )
    }
  }
  return problems
}

/** 从 useForecastLayer.ts 源码解析前端消费的指标清单（源码结构变更时返回 null 让守卫报错） */
export function readIndicators(sourceText) {
  const m = sourceText.match(/const INDICATORS\s*=\s*\[([^\]]*)\]/)
  if (!m) return null
  return [...m[1].matchAll(/'([a-zA-Z0-9_-]+)'/g)].map((x) => x[1])
}

/** 从单个指标文件收集锚点（spatial.features[0].geometry.coordinates） */
export function collectIndicatorAnchors(indicator, data) {
  const anchors = []
  const problems = []
  const ports = data?.data ?? {}
  const keys = Object.keys(ports)
  if (keys.length === 0) problems.push(`${indicator}：data 下无港口条目，结构可能已变更`)
  for (const key of keys) {
    const coords = ports[key]?.spatial?.features?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) {
      problems.push(`${indicator}.${key}：缺少 spatial 锚点坐标`)
      continue
    }
    anchors.push({ label: `${indicator}.${key}`, lng: Number(coords[0]), lat: Number(coords[1]) })
  }
  return { anchors, problems }
}

/** 主检查：返回 { problems, checked }（problems 非空 = 守卫失败） */
export function runAnchorCheck(root) {
  const problems = []
  const checked = []

  const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'))

  // 1) 权威港口坐标
  const rawPorts = readJson(PORTS_FILE)
  const ports = (Array.isArray(rawPorts) ? rawPorts : (rawPorts.ports ?? [])).map((p) => ({
    name: String(p.name),
    lng: Number(p.lng),
    lat: Number(p.lat),
  }))

  // 2) 前端消费清单（权威源）
  const indicators = readIndicators(readFileSync(path.join(root, INDICATOR_SOURCE), 'utf8'))
  if (indicators === null) {
    problems.push(
      `${INDICATOR_SOURCE}：未解析到 INDICATORS 清单（源码结构变更，守卫须同步后再放行）`
    )
  }

  // 3) 在用指标锚点
  for (const indicator of indicators ?? []) {
    let data
    try {
      data = readJson(path.join(FORECAST_DIR, `${indicator}.json`))
    } catch {
      problems.push(`${FORECAST_DIR}/${indicator}.json：前端在消费但文件缺失/不可解析`)
      continue
    }
    const { anchors, problems: structProblems } = collectIndicatorAnchors(indicator, data)
    problems.push(...structProblems)
    problems.push(...evaluateAnchors(ports, anchors))
    checked.push(...anchors.map((a) => a.label))
  }

  // 4) index.json 的锚点原始来源
  let index
  try {
    index = readJson(path.join(FORECAST_DIR, 'index.json'))
  } catch {
    problems.push(`${FORECAST_DIR}/index.json：缺失/不可解析`)
    index = null
  }
  const indexPorts = index?.metadata?.ports
  if (Array.isArray(indexPorts) && indexPorts.length) {
    const anchors = indexPorts.map((p) => ({
      label: `index.metadata.ports.${p.id ?? p.name}`,
      lng: Number(p.lng),
      lat: Number(p.lat),
    }))
    problems.push(...evaluateAnchors(ports, anchors))
    checked.push(...anchors.map((a) => a.label))
  } else {
    problems.push(`${FORECAST_DIR}/index.json：metadata.ports 缺失（锚点原始来源须在册）`)
  }

  // 5) 已下架指标：不得被重新消费，且须保留来源标注
  for (const retired of RETIRED_INDICATORS) {
    if ((indicators ?? []).includes(retired)) {
      problems.push(`${retired}：已下架指标重新进入前端消费清单（INDICATORS）`)
    }
    let data
    try {
      data = readJson(path.join(FORECAST_DIR, `${retired}.json`))
    } catch {
      continue // 源文件已删除属正常演进，不报
    }
    const marker = String(data?._coordinateProvenance ?? '')
    if (!RETIRED_MARKERS.some((k) => marker.includes(k))) {
      problems.push(`${retired}：源文件缺少「已废弃/未对齐」来源标注（防止废弃坐标被当成真值复制）`)
    }
  }

  return { problems, checked }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const { problems, checked } = runAnchorCheck(ROOT)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checked, problems }, null, 2))
    process.exit(problems.length ? 1 : 0)
  }
  if (problems.length) {
    console.log(`[anchor-check] ${problems.length} 处锚点/基准违规：`)
    for (const p of problems) console.log('  - ' + p)
    process.exit(1)
  }
  console.log(
    `[anchor-check] OK：${checked.length} 个锚点均在权威港口 ${ANCHOR_TOLERANCE_KM}km 容差内（在用指标 ${checked.length ? [...new Set(checked.map((c) => c.split('.')[0]))].join('/') : '无'}）`
  )
}
