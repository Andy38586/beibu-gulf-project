import { Module } from '@nestjs/common'

import { DataFilesService } from '../../infra/files/data-files.service'

import { ForecastController } from './forecast.controller'
import { ForecastService } from './forecast.service'

// 预测读模块（T3.4）：公开只读，迁移期读 backend/data/forecast/*.json
//（合成示意数据不入库原则；真模型 ARIMA 是 v3 阶段 4 议题）
@Module({
  controllers: [ForecastController],
  providers: [ForecastService, DataFilesService],
})
export class ForecastModule {}
