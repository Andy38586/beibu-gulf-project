import { Module } from '@nestjs/common'

import { SiteAnalysisController } from './controllers/site-analysis.controller'
import { SiteAnalysisRepository } from './repositories/site-analysis.repository'
import { SiteAnalysisService } from './services/site-analysis.service'

// 选址分析模块：公开纯计算（免鉴权），POI/小区读 backend/data/site-selection/ 三城 JSON；
// 空间计算 turf 7.3.5 + rbush 3.0.1 与 Express 同版钉死（防空间计算双端漂移）；
// DataFilesService 为 @Global 共享单例（infra/files），此处不再重复声明
@Module({
  controllers: [SiteAnalysisController],
  providers: [SiteAnalysisRepository, SiteAnalysisService],
})
export class SiteAnalysisModule {}
