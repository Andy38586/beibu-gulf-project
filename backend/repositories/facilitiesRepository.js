// 设施类型 → backend/data/ 相对路径映射（勿移动此文件）；读取统一走 readStaticJson（TTL + LRU 缓存）
// 三城 POI（2026-08-29 全量重抓，口径=市辖区）：qz 钦南+钦北 / bh 海城+银海+铁山港 / fcg 港口+防城
// 文件名统一为 {city}_{type}.json，由 tools/fetch-amap-poi-city.py 产出，三城同口径可比
import { readStaticJson } from '../utils/readStaticJson.js'

// 城市白名单：city 来自外部请求体，必须白名单校验后才能拼接路径，防路径穿越
const CITIES = ['qz', 'bh', 'fcg']
export const DEFAULT_CITY = 'qz'

const FILE_MAP = {
  hospital: 'hospital',
  primary_school: 'primary_school',
  middle_school: 'middle_school',
  park: 'park',
  bus_station: 'bus_station',
  mall: 'mall',
  xiaoqu: 'xiaoqu',
}

export function isSupportedCity(city) {
  return CITIES.includes(city)
}

export function getAvailableCities() {
  return [...CITIES]
}

// 归一化：非法/缺失一律回落默认城市，不抛错（选址是纯计算接口，不应因 city 参数 4xx）
function resolveCity(city) {
  return isSupportedCity(city) ? city : DEFAULT_CITY
}

export async function findByType(type, city) {
  const name = FILE_MAP[type]
  if (!name) return null
  return readStaticJson(`site-selection/${resolveCity(city)}_${name}.json`)
}
export async function findXiaoqu(city) {
  return readStaticJson(`site-selection/${resolveCity(city)}_xiaoqu.json`)
}
export function getAvailableTypes() {
  return Object.keys(FILE_MAP).filter((k) => k !== 'xiaoqu')
}
