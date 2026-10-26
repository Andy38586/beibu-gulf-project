import { Module } from '@nestjs/common'

import { ForecastController } from './controllers/forecast.controller'
import { ForecastService } from './services/forecast.service'

// 预测读模块：公开只读，迁移期读 backend/data/forecast/*.json
//（合成示意数据不入库原则；真模型 ARIMA 是 v3 阶段 4 议题）；
// DataFilesService 为 @Global 共享单例（infra/files），此处不再重复声明
//
// 2026-10-26：task 预测域已下线（B），ForecastService 不再跨模块注入；仅同模块 controller 消费。
@Module({
  controllers: [ForecastController],
  providers: [ForecastService],
})
export class ForecastModule {}
