// 洪涝预计算档位表加载器：读取 flood_levels.json.gz（251 档 0~25m/0.1m 步长，
// 与 FastAPI flood-service 共用同表）。进程内只读一次 + gzip 解压缓存；
// 文件缺失/损坏降级空表（调用方回退 6 档）。
// 不走 readStaticJson/createReadCache：其缓存链面向 .json 文本，无法处理 .gz 二进制
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

/** 懒加载预计算档位表（进程内只读一次） */
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
