// floodLevelsStore - 洪涝预计算档位表加载器（Express 侧）
// 数据源：backend/data/flood/flood_levels.json.gz（251 档 0~25m / 0.1m 步长，
// flood-service/precompute_levels.py 离线多进程预计算产出，与 FastAPI 共用同一份表）
// 定位：静态只读资产（数据文件化）。与 FastAPI flood-service/main.py:_load_levels 同源同构：
// 进程内只读一次 + gzip 解压缓存；文件缺失/损坏降级为空表（调用方走 6 档 fallback）。
// ⚠️ R8 例外说明：不走 readStaticJson/createReadCache——其缓存链面向 .json 文本读盘，
// 无法处理 .gz 二进制解压；本模块等价 FastAPI 的模块级单例，无 TTL/LRU 需求（只读一次）。
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { gunzip } from 'zlib'
import { promisify } from 'util'

const gunzipAsync = promisify(gunzip)

const LEVELS_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../data/flood/flood_levels.json.gz'
)

/** null = 未加载；加载失败置 {}（与 FastAPI 降级语义一致） */
let tableCache = null

/**
 * 懒加载预计算档位表（进程内只读一次）
 * @returns {Promise<Record<string, { featureCount: number, floodedKm2: number, features: object[] }>>}
 */
export async function loadFloodLevels() {
  if (tableCache) return tableCache
  try {
    const buf = await readFile(LEVELS_FILE)
    tableCache = JSON.parse((await gunzipAsync(buf)).toString('utf-8'))
  } catch {
    tableCache = {}
  }
  return tableCache
}

/** 测试钩子：清空缓存（下个请求重新读盘） */
export function _clearFloodLevelsCacheForTest() {
  tableCache = null
}
