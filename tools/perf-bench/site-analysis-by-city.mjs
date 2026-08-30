// 选址分析性能剖析：定位 runSiteAnalysis 各阶段耗时。
// 用法：node tools/bench-site-analysis.mjs [qz|bh|fcg]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  buildTypeCoverage,
  intersectCoverages,
  filterMatchedXiaoqu,
  rankXiaoqu,
} from '../../backend/services/siteAnalysisService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', '..', 'backend', 'data', 'site-selection')

const TYPES = ['hospital', 'primary_school', 'middle_school', 'park', 'bus_station', 'mall']
const DEFAULT_RADIUS = {
  hospital: 3,
  primary_school: 1,
  middle_school: 2,
  park: 1.5,
  bus_station: 0.5,
  mall: 2,
}

const CITY = process.argv[2] || 'qz'
const CITY_LABEL = {
  qz: '钦州（钦南+钦北）',
  bh: '北海（海城+银海+铁山港）',
  fcg: '防城港（港口+防城）',
}

const load = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8'))
const facilityData = Object.fromEntries(TYPES.map((t) => [t, load(`${CITY}_${t}.json`)]))
const xiaoquData = load(`${CITY}_xiaoqu.json`)

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000

function runScenario(label, selectedKeys) {
  const radiusSettings = Object.fromEntries(
    selectedKeys.map((k) => [k, { selected: true, radius: DEFAULT_RADIUS[k] }])
  )
  const timings = {}
  let t = now()
  const coverages = selectedKeys.map((k) => {
    const t0 = now()
    const c = buildTypeCoverage(facilityData[k], DEFAULT_RADIUS[k])
    timings[k] = now() - t0
    return c
  })
  const tCoverage = now() - t

  t = now()
  const { area } = intersectCoverages(coverages, selectedKeys)
  const tIntersect = now() - t

  let matched = []
  let tMatch = 0
  if (area) {
    t = now()
    matched = filterMatchedXiaoqu(xiaoquData, area)
    tMatch = now() - t
  }

  t = now()
  rankXiaoqu(matched, facilityData, radiusSettings, undefined)
  const tRank = now() - t

  const total = tCoverage + tIntersect + tMatch + tRank
  console.log(`\n  ${label}`)
  console.log(`    总耗时 ${total.toFixed(0)} ms | 命中小区 ${matched.length}/${xiaoquData.length}`)
  console.log(
    `    ① 缓冲区+union  ${tCoverage.toFixed(0).padStart(5)} ms (${((tCoverage / total) * 100).toFixed(0)}%)  ← 瓶颈`
  )
  console.log(`    ② 多边形交集    ${tIntersect.toFixed(0).padStart(5)} ms`)
  console.log(`    ③ 点在多边形内  ${tMatch.toFixed(0).padStart(5)} ms`)
  console.log(`    ④ 评分排序      ${tRank.toFixed(0).padStart(5)} ms`)
  return total
}

const poiTotal = TYPES.reduce((s, t) => s + facilityData[t].length, 0)
console.log('='.repeat(64))
console.log(`选址性能剖析 —— ${CITY_LABEL[CITY] || CITY}`)
console.log('='.repeat(64))
console.log(
  '设施点：',
  TYPES.map((t) => `${t}=${facilityData[t].length}`).join(' '),
  `| 合计 ${poiTotal}`
)
console.log('小区数：', xiaoquData.length)

const a = runScenario('场景 A：3 类（医院+小学+公交站）', [
  'hospital',
  'primary_school',
  'bus_station',
])
const b = runScenario('场景 B：全 6 类', TYPES)
console.log(`\n  [${CITY}] A=${a.toFixed(0)}ms  B=${b.toFixed(0)}ms`)
