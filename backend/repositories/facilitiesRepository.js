// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
// 2026-08-08：readJsonFile 与 utils/readStaticJson 逐字重复 → 收敛复用统一入口
// （数据流收口②，TTL + LRU 缓存同源）
import { readStaticJson } from '../utils/readStaticJson.js'

const FILE_MAP = {
  hospital: 'site-selection/qz_hospital.json',
  primary_school: 'site-selection/qz_primary_school.json',
  middle_school: 'site-selection/qz_middle_school.json',
  park: 'site-selection/qz_park.json',
  bus_station: 'site-selection/qz_bus_station.json',
  mall: 'site-selection/qz_mall_and_supermarket.json',
  xiaoqu: 'site-selection/xiaoqu.json',
}

export async function findByType(type) {
  const filename = FILE_MAP[type]
  if (!filename) return null
  return readStaticJson(filename)
}
export async function findXiaoqu() {
  return readStaticJson(FILE_MAP.xiaoqu)
}
export function getAvailableTypes() {
  return Object.keys(FILE_MAP).filter((k) => k !== 'xiaoqu')
}
