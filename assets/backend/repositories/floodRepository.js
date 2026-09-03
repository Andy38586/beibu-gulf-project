/**
 * floodRepository — 洪涝数据访问层（6-05 六层契约收口）：
 * controller 不再直接 readStaticJson 读文件，数据访问统一经 repository；
 * 迁移 v3 时对应 Nest 的 @Injectable() repository。
 */
import { readStaticJson } from '../utils/readStaticJson.js'

/** 淹没范围 6 档表（floodArea.json） */
export const readFloodArea = () => readStaticJson('flood/floodArea.json')

/** 水位统计数据（floodStatistics.json） */
export const readFloodStatistics = () => readStaticJson('flood/floodStatistics.json')

/** 港口设施点（facilityPoints.json，含 elevation/value/damageRate） */
export const readFacilityPoints = () => readStaticJson('flood/facilityPoints.json')

/** 水域坐标（water-area.json） */
export const readWaterArea = () => readStaticJson('flood/water-area.json')

/** 地形剖面线（terrainProfile.json） */
export const readTerrainProfile = () => readStaticJson('flood/terrainProfile.json')
