import { Injectable } from '@nestjs/common'

import { DataFilesService } from '../../infra/files/data-files.service'

import { FacilityPoint } from './scoring'

// 逐行等价移植 backend/repositories/facilitiesRepository.js。
// 设施类型 → backend/data/ 相对路径映射；读取统一走 DataFilesService（TTL + LRU 缓存）。
// 三城 POI（2026-08-29 全量重抓，口径=市辖区）：qz 钦南+钦北 / bh 海城+银海+铁山港 / fcg 港口+防城
// 文件名统一为 {city}_{type}.json，由 tools/fetch-amap-poi-city.py 产出，三城同口径可比

// 城市白名单：city 来自外部请求体，必须白名单校验后才能拼接路径，防路径穿越
const CITIES = ['qz', 'bh', 'fcg'] as const
export const DEFAULT_CITY = 'qz'

const FILE_MAP: Record<string, string> = {
  hospital: 'hospital',
  primary_school: 'primary_school',
  middle_school: 'middle_school',
  park: 'park',
  bus_station: 'bus_station',
  mall: 'mall',
  xiaoqu: 'xiaoqu',
}

export function isSupportedCity(city: unknown): boolean {
  return (CITIES as readonly string[]).includes(city as string)
}

export function getAvailableCities(): string[] {
  return [...CITIES]
}

// 归一化：非法/缺失一律回落默认城市，不抛错（选址是纯计算接口，不应因 city 参数 4xx）
function resolveCity(city: unknown): string {
  return isSupportedCity(city) ? (city as string) : DEFAULT_CITY
}

@Injectable()
export class SiteAnalysisRepository {
  constructor(private readonly dataFiles: DataFilesService) {}

  async findByType(type: string, city: unknown): Promise<FacilityPoint[] | null> {
    const name = FILE_MAP[type]
    if (!name) return null
    return (await this.dataFiles.read(`site-selection/${resolveCity(city)}_${name}.json`)) as
      | FacilityPoint[]
      | null
  }

  async findXiaoqu(city: unknown): Promise<FacilityPoint[]> {
    return (await this.dataFiles.read(
      `site-selection/${resolveCity(city)}_xiaoqu.json`
    )) as FacilityPoint[]
  }

  getAvailableTypes(): string[] {
    return Object.keys(FILE_MAP).filter((k) => k !== 'xiaoqu')
  }
}
