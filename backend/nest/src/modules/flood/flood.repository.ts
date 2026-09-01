import { Injectable } from '@nestjs/common'

import { DataFilesService } from '../../infra/files/data-files.service'

// 洪涝数据访问（对齐 Express floodRepository 六层收口：数据访问统一经 repository，
// 读盘走 DataFilesService 统一只读缓存）。文件路径对齐 backend/data/flood/*
const FLOOD_FILES = {
  floodArea: 'flood/floodArea.json',
  floodStatistics: 'flood/floodStatistics.json',
  facilityPoints: 'flood/facilityPoints.json',
  waterArea: 'flood/water-area.json',
  terrainProfile: 'flood/terrainProfile.json',
} as const

@Injectable()
export class FloodRepository {
  constructor(private readonly dataFiles: DataFilesService) {}

  readFloodArea(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.floodArea)
  }

  readFloodStatistics(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.floodStatistics)
  }

  readFacilityPoints(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.facilityPoints)
  }

  readWaterArea(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.waterArea)
  }

  readTerrainProfile(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.terrainProfile)
  }
}
