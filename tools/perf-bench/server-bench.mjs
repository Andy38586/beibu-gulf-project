/**
 * 服务端性能基准脚本（可重复）
 *
 * 用途：实测 backend/data 各数据文件的体积(gzip/raw)、读盘耗时、JSON.parse 耗时、
 *       进程内存占用，以及选址分析核心计算耗时。结果供独立性能文档引用。
 *
 * 运行：node tools/perf-bench/server-bench.mjs
 * 环境：Windows 本机，Node 版本见 backend/package.json engines（^22.18.0 || >=24.12.0）
 *
 * 注意：本脚本只读文件 + 调用纯函数，不启动 HTTP 服务，不写任何数据文件。
 */
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', '..', 'backend', 'data')

// 需要统计的 JSON 文件（相对 backend/data）
const TARGET_FILES = [
  'flood/floodArea.json',
  'flood/facilityPoints.json',
  'flood/floodStatistics.json',
  'flood/terrainProfile.json',
  'flood/waterLevel.json',
  'flood/water-area.json',
  'site-selection/xiaoqu.json',
  'site-selection/qz_bus_station.json',
  'site-selection/qz_primary_school.json',
  'site-selection/qz_middle_school.json',
  'site-selection/qz_hospital.json',
  'site-selection/qz_mall_and_supermarket.json',
  'site-selection/qz_park.json',
  'forecast/throughput.json',
  'forecast/traffic.json',
  'forecast/berth.json',
  'forecast/cargo.json',
  'forecast/container.json',
  'forecast/throughput_model.json',
  'forecast/index.json',
  'ports.json',
]

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

function measureParse(jsonStr) {
  // 预热一次（JIT 编译），再测 3 次取中位数，减少噪声
  JSON.parse(jsonStr)
  const times = []
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint()
    JSON.parse(jsonStr)
    const t1 = process.hrtime.bigint()
    times.push(Number(t1 - t0) / 1e6)
  }
  times.sort((a, b) => a - b)
  return times[1]
}

function countFeatures(data) {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === 'object') {
    if (data.type === 'FeatureCollection' && Array.isArray(data.features))
      return data.features.length
    if (Array.isArray(data.features)) return data.features.length
    // 统计各顶层 key 的元素数
    const counts = {}
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) counts[k] = v.length
    }
    return counts
  }
  return null
}

function main() {
  const rows = []
  let totalRaw = 0
  let totalGzip = 0

  for (const rel of TARGET_FILES) {
    const abs = join(DATA_DIR, rel)
    let stat, buf
    try {
      stat = statSync(abs)
      buf = readFileSync(abs)
    } catch (e) {
      rows.push({ file: rel, err: e.code })
      continue
    }
    const rawBytes = buf.length
    const gzBytes = gzipSync(buf).length
    totalRaw += rawBytes
    totalGzip += gzBytes
    const text = buf.toString('utf8')
    const parseMs = measureParse(text)
    let features = null
    try {
      features = countFeatures(JSON.parse(text))
    } catch {
      features = null
    }
    rows.push({
      file: rel,
      rawKB: rawBytes / 1024,
      gzipKB: gzBytes / 1024,
      parseMs: +parseMs.toFixed(2),
      features,
    })
  }

  console.log('=== backend/data 文件体积与解析耗时 ===')
  console.log('file | raw | gzip | parse(ms) | features')
  for (const r of rows) {
    if (r.err) {
      console.log(`${r.file} | ERROR ${r.err}`)
      continue
    }
    const feat = r.features === null ? '-' : JSON.stringify(r.features)
    console.log(
      `${r.file} | ${fmtBytes(r.rawKB * 1024)} | ${fmtBytes(r.gzipKB * 1024)} | ${r.parseMs} | ${feat}`
    )
  }
  console.log(
    `\n合计 raw=${fmtBytes(totalRaw)} gzip=${fmtBytes(totalGzip)}` +
      ` 压缩率=${((totalGzip / totalRaw) * 100).toFixed(1)}%`
  )

  // 内存：加载全部目标文件后的堆内存
  global.gc && global.gc()
  const before = process.memoryUsage()
  // 重新读一遍全部文件到内存，模拟服务端常驻
  for (const rel of TARGET_FILES) {
    try {
      readFileSync(join(DATA_DIR, rel))
    } catch {
      /* ignore */
    }
  }
  const after = process.memoryUsage()
  console.log('\n=== 进程内存(加载全部目标文件后) ===')
  console.log(
    `heapUsed: ${fmtBytes(after.heapUsed)} | before=${fmtBytes(before.heapUsed)} | ` +
      `外部(含 WASM/缓冲): ${fmtBytes(after.external)} | rss: ${fmtBytes(after.rss)}`
  )
}

main()
