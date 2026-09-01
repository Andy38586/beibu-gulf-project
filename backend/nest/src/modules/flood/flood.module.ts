import { Module } from '@nestjs/common'

import { DataFilesService } from '../../infra/files/data-files.service'

import { FloodController } from './flood.controller'
import { FloodRepository } from './flood.repository'
import { FloodService } from './flood.service'

// 洪涝读模块（T3.5）：公开只读 + 纯计算评估，迁移期读 backend/data/flood/*.json，
// 空间计算 turf 7.3.5 与 Express 同版钉死（防空间计算双端漂移）
@Module({
  controllers: [FloodController],
  providers: [FloodRepository, FloodService, DataFilesService],
})
export class FloodModule {}
