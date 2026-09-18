import { Module } from '@nestjs/common'

import { SiteAnalysisController } from './controllers/site-analysis.controller'
import { SiteAnalysisRepository } from './repositories/site-analysis.repository'
import { SiteAnalysisService } from './services/site-analysis.service'

// 选址分析模块：公开纯计算（免鉴权），POI/小区读 backend/data/site-selection/ 三城 JSON；
// 空间计算 turf 7.3.5 + rbush 3.0.1 与 Express 同版钉死（防空间计算双端漂移）；
// DataFilesService 为 @Global 共享单例（infra/files），此处不再重复声明
//
// ⚠️ exports SiteAnalysisService 仅用于 v4 异步任务域按域委托执行。
// 🔴 **不动选址业务口径**（铁律 L2）：本模块只增一行 exports，未改任何计算逻辑。
@Module({
  controllers: [SiteAnalysisController],
  providers: [SiteAnalysisRepository, SiteAnalysisService],
  exports: [SiteAnalysisService],
})
export class SiteAnalysisModule {}
