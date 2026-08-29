/**
 * 选址分析核心计算性能基准（可重复）
 *
 * 用途：用真实 backend/data 数据调用 runSiteAnalysis，分阶段计时
 *       （buildTypeCoverage union / intersect / 小区评分 / 设施筛选），
 *       复现第六部分基线里"选址核心 1.55s"的口径。
 *
 * 运行：node tools/perf-bench/site-analysis-bench.mjs（在仓库根或任意 cwd 均可，路径基于 __dirname 解析）
 * 注意：本文件在 tools/perf-bench/ 下，跨两级才是仓库根的 backend/——816 自 backend/ 根迁移时
 *       相对导入误留为 ../backend（会解析成 tools/backend 而 ERR_MODULE_NOT_FOUND），2026-08-29 修正。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { runSiteAnalysis } from '../../backend/services/siteAnalysisService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../../backend/data')

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

// ⚠️ 口径警示（2026-08-29）：上面这组参数**不等于前端默认值**，只是历史基线的复现口径。
// 前端 facilityConfig.ts 的默认半径是 医院3 / 小学1 / 初中2 / 公园1.5 / 公交0.5 / 商场2，
// importance 默认 3（系数 1.0）。本脚本的公交 1.5km×0.7 实际约 1.05km，是前端 0.5km 的 2 倍——
// 而 union 耗时随覆盖面积超线性增长（公交 0.5→3km，面积 36× 时耗时 13×），
// 故本脚本测出的数**明显高于用户实际体验**。要评估真实交互耗时，请改用前端默认半径。
// 改参数会让历史基线不可复现，因此保持原值 + 本注释，不做对齐。

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
