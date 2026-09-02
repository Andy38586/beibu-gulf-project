import { Module } from '@nestjs/common'

import { DataFilesService } from '../../infra/files/data-files.service'

import { SiteAnalysisController } from './site-analysis.controller'
import { SiteAnalysisRepository } from './site-analysis.repository'
import { SiteAnalysisService } from './site-analysis.service'

// 选址分析模块：公开纯计算（免鉴权），POI/小区读 backend/data/site-selection/ 三城 JSON；
// 空间计算 turf 7.3.5 + rbush 3.0.1 与 Express 同版钉死（防空间计算双端漂移）
@Module({
  controllers: [SiteAnalysisController],
  providers: [SiteAnalysisRepository, SiteAnalysisService, DataFilesService],
})
export class SiteAnalysisModule {}
