#!/usr/bin/env node
// derive-activity.mjs — 「港口吞吐活跃度」派生脚本（真数据衍生，2026-09-08 数据平面大换代）
// 口径：activity(port, month) = cargo(port, month) / baseMean(port) × 100
//   baseMean(port) = cargo 官方真吞吐量在基期 [2021-01, 2024-12] 的月均值（基期归一 100，无物理量纲）
// 输入：cargo.json（官方真吞吐量 2021-01~2026-06）+ throughput_model.json（模型预测 2026-07~2035-12）
// 输出：backend/data/forecast/activity.json（结构同 cargo.json，另含溯源元数据）
// 用法：node tools/derive-activity.mjs
// 测试：tools/__tests__/derive-activity.test.mjs（vitest，纯函数注入 fixture）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'backend', 'data', 'forecast')

// ===== 派生口径常量 =====
export const BASE_PERIOD = { start: '2021-01', end: '2024-12' }
export const INDICATOR = 'activity'
export const UNIT = '指数'

// 港口真坐标（单一事实源：库内 ports 表 SRID 4490→4326，与 frontend/public/data/ports.json 同源；
// 脚本离线运行不查 DB，坐标以 ports.json 为准——两源已对账一致，漂移由 audit-coords.mjs 兜底）
export const PORT_COORDS = {
  qinzhou: { name: '钦州港', lng: 108.590379, lat: 21.726917 },
  beihai: { name: '北海港', lng: 109.130658, lat: 21.418792 },
  fangchenggang: { name: '防城港', lng: 108.340973, lat: 21.617689 },
}

export const GULF_BOUNDS = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }

// ===== 时间工具（与服务层 model-loader 同算法） =====
export function monthOffset(time) {
  const [y, m] = time.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function timeFromOffset(off) {
  const y = Math.floor(off / 12)
  const m = (off % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

// 模型点 → 月度序列：丢弃 ≤ afterTime 的重叠点，半年节点间线性插值（与服务层 interpolateMonthly 同形）；
// 可信度复刻 model-loader.getModelForecast：滚动回测分步长 MAPE 折算（无 rolling 数据时 reliability=1）
export function interpolateMonthly(points, afterTime, backtest) {
  const afterOff = afterTime ? monthOffset(afterTime) : -Infinity
  const rolling = backtest?.rolling_mape_by_step ?? null
  const step12 = rolling?.[12] ?? null
  const reliabilityFor = (relStep) => {
    if (!rolling || relStep <= 0) return 1
    let mape = rolling[Math.min(relStep, 12)] ?? step12
    if (mape == null) return 1
    if (relStep > 12) mape = mape * Math.sqrt(1 + Math.floor(relStep / 12))
    return Math.max(0.25, Math.round((1 - mape / 100) * 100) / 100)
  }

  const kept = [...points]
    .filter((p) => monthOffset(p.time) > afterOff)
    .sort((a, b) => a.time.localeCompare(b.time))

  const out = []
  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i]
    out.push({
      time: cur.time,
      value: cur.value,
      type: 'forecast',
      reliability: reliabilityFor(monthOffset(cur.time) - afterOff),
    })
    const next = kept[i + 1]
    if (!next) continue
    const gap = monthOffset(next.time) - monthOffset(cur.time)
    for (let g = 1; g < gap; g++) {
      const off = monthOffset(cur.time) + g
      const t = g / gap
      out.push({
        time: timeFromOffset(off),
        value: Math.round(cur.value + (next.value - cur.value) * t),
        type: 'forecast',
        reliability: reliabilityFor(off - afterOff),
      })
    }
  }
  return out
}

// ===== 派生核心（纯函数，可测） =====
export function baseMean(historical, start = BASE_PERIOD.start, end = BASE_PERIOD.end) {
  const inBase = historical.filter((d) => d.time >= start && d.time <= end)
  if (inBase.length === 0) return null
  const sum = inBase.reduce((s, d) => s + d.value, 0)
  return sum / inBase.length
}

const round1 = (x) => Math.round(x * 10) / 10

/**
 * 由 cargo 真数据 + 模型产物派生活跃度指标。
 * @param {{data: Record<string, {historical: {time:string,value:number}[]}>}} cargo
 * @param {{ports: Record<string, {predictions?: {time:string,value:number}[], backtest?: {rolling_mape_by_step?: Record<string,number>}}>, model_info?: Record<string, unknown>}} model
 * @returns 完整 activity 指标对象（含溯源元数据）
 */
export function deriveActivity(cargo, model) {
  const ports = {}
  const baseMeans = {}

  for (const portId of Object.keys(PORT_COORDS)) {
    const cargoPort = cargo.data?.[portId]
    const modelPort = model.ports?.[portId]
    const historical = cargoPort?.historical ?? []
    const mean = baseMean(historical)

    // baseMean 防御：基期无数据或均值非正 → 该港全部指数置空（不产假值）
    if (mean == null || mean <= 0) {
      baseMeans[portId] = null
      ports[portId] = {
        historical: [],
        forecast: [],
        spatial: null,
        error: 'baseMean 缺失或非正，派生跳过',
      }
      continue
    }
    baseMeans[portId] = round1(mean)

    const histIndex = historical.map((d) => ({
      time: d.time,
      value: round1((d.value / mean) * 100),
      type: 'historical',
    }))

    // forecast 段：模型预测（吞吐量）指数化 + 同服务层月化插值；模型段缺失则 forecast 为空（历史仍真）
    let forecast = []
    if (modelPort && Array.isArray(modelPort.predictions)) {
      const lastHist = historical[historical.length - 1]
      forecast = interpolateMonthly(modelPort.predictions, lastHist?.time, modelPort.backtest).map(
        (p) => ({
          ...p,
          value: round1((p.value / mean) * 100),
        })
      )
    }

    const values = {}
    for (const d of [...histIndex, ...forecast]) values[d.time] = d.value

    ports[portId] = {
      historical: histIndex,
      forecast,
      spatial: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [PORT_COORDS[portId].lng, PORT_COORDS[portId].lat],
            },
            properties: { portId, portName: PORT_COORDS[portId].name, values },
          },
        ],
      },
    }
  }

  return {
    indicator: INDICATOR,
    unit: UNIT,
    data: ports,
    _source: 'derived',
    _derivedFrom:
      'cargo.json（官方真吞吐量 2021-01~2026-06，yqb.gxzf.gov.cn）+ throughput_model.json（模型预测 2026-07~2035-12）',
    _basePeriod: { ...BASE_PERIOD },
    _coordinateProvenance:
      '空间锚点取库内 ports 表真坐标（4490→4326，与 frontend/public/data/ports.json 同源）：钦州港 108.590379,21.726917；北海港 109.130658,21.418792；防城港 108.340973,21.617689。替代早期 mock 市区坐标（见 cargo.json _coordinateProvenance）。',
    model_info: model.model_info ?? {},
    _baseMeans: baseMeans,
  }
}

// ===== 主流程 =====
async function main() {
  const cargoPath = path.join(DATA_DIR, 'cargo.json')
  const modelPath = path.join(DATA_DIR, 'throughput_model.json')
  const outPath = path.join(DATA_DIR, 'activity.json')

  const cargo = JSON.parse(fs.readFileSync(cargoPath, 'utf8'))
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'))
  const activity = deriveActivity(cargo, model)

  // 坐标越界自检：真锚点必须落在北部湾 bbox（audit-coords.mjs 兜底的最后一环）
  for (const portId of Object.keys(PORT_COORDS)) {
    const { lng, lat } = PORT_COORDS[portId]
    const oob =
      lng < GULF_BOUNDS.minLng ||
      lng > GULF_BOUNDS.maxLng ||
      lat < GULF_BOUNDS.minLat ||
      lat > GULF_BOUNDS.maxLat
    if (oob) {
      console.error(`[derive-activity] 坐标越界拒绝写入: ${portId} (${lng},${lat})`)
      process.exit(1)
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(activity, null, 2) + '\n')
  console.log(`[derive-activity] 已生成 ${outPath}`)
  for (const portId of Object.keys(PORT_COORDS)) {
    const base = activity._baseMeans[portId]
    const h = activity.data[portId].historical.length
    const f = activity.data[portId].forecast.length
    console.log(
      `  ${portId.padEnd(12)} baseMean=${String(base).padEnd(8)} 历史 ${String(h).padEnd(3)} 点 / 预测 ${String(f).padEnd(3)} 点`
    )
  }
}

// 直接执行（node tools/derive-activity.mjs）时跑主流程；被测试 import 时跳过
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[derive-activity] 派生失败:', err)
    process.exit(1)
  })
}
