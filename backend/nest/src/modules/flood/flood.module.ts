import { Module } from '@nestjs/common'

import { FloodController } from './controllers/flood.controller'
import { FloodRepository } from './repositories/flood.repository'
import { FloodService } from './services/flood.service'

// 洪涝读模块：公开只读 + 纯计算评估，迁移期读 backend/data/flood/*.json，
// 空间计算 turf 7.3.5 与 Express 同版钉死（防空间计算双端漂移）；
// DataFilesService 为 @Global 共享单例（infra/files），此处不再重复声明
@Module({
  controllers: [FloodController],
  providers: [FloodRepository, FloodService],
})
export class FloodModule {}
