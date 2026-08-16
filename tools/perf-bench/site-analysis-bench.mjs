/**
 * 选址分析核心计算性能基准（可重复）
 *
 * 用途：用真实 backend/data 数据调用 runSiteAnalysis，分阶段计时
 *       （buildTypeCoverage union / intersect / 小区评分 / 设施筛选），
 *       复现第六部分基线里"选址核心 1.55s"的口径。
 *
 * 运行：node tools/perf-bench/site-analysis-bench.mjs（816：自 backend/ 根迁移，相对导入已指向 ../backend）
 * 注意：依赖 backend 的 ESM 相对导入，须在 backend 目录下运行。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

import { runSiteAnalysis } from '../backend/services/siteAnalysisService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../backend/data')

function loadJson(rel) {
  return JSON.parse(readFileSync(join(DATA_DIR, rel), 'utf8'))
}

// 6 类设施全选（复现基线：983 POI + 557 小区，前端默认参数）
const selectedKeys = ['hospital', 'primary_school', 'middle_school', 'park', 'bus_station', 'mall']
const typeSettings = {
  hospital: { defaultRadius: 3, importance: 3 },
  primary_school: { defaultRadius: 2, importance: 3 },
  middle_school: { defaultRadius: 2, importance: 3 },
  park: { defaultRadius: 2, importance: 2 },
  bus_station: { defaultRadius: 1.5, importance: 2 },
  mall: { defaultRadius: 1.5, importance: 2 },
}

function main() {
  const facilityData = {
    hospital: loadJson('site-selection/qz_hospital.json'),
    primary_school: loadJson('site-selection/qz_primary_school.json'),
    middle_school: loadJson('site-selection/qz_middle_school.json'),
    park: loadJson('site-selection/qz_park.json'),
    bus_station: loadJson('site-selection/qz_bus_station.json'),
    mall: loadJson('site-selection/qz_mall_and_supermarket.json'),
  }
  const xiaoquData = loadJson('site-selection/xiaoqu.json')

  const totalPoi = selectedKeys.reduce((s, k) => s + (facilityData[k]?.length || 0), 0)
  console.log(
    `设施 POI 合计=${totalPoi}，小区=${xiaoquData.length}` +
      `，各类型=${selectedKeys.map((k) => `${k}:${facilityData[k]?.length}`).join(' ')}`
  )

  // warmup 一次（JIT + RBush 类加载）
  runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })

  const rounds = 3
  const samples = []
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now()
    const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })
    const dt = performance.now() - t0
    samples.push(dt)
    if (result.error) {
      console.log(`round ${i + 1}: ERROR ${result.error}`)
    }
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  console.log('\n=== 选址核心计算耗时(3 次，取中位数) ===')
  console.log(`每次: ${samples.map((s) => s.toFixed(0) + 'ms').join(' / ')}`)
  console.log(`中位数: ${median.toFixed(0)}ms`)
  console.log(`等价: ${(median / 1000).toFixed(2)}s`)
}

main()