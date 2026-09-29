import { Module } from '@nestjs/common'

import { SiteSuitabilityController } from './controllers/site-suitability.controller'
import { SiteSuitabilityRepository } from './repositories/site-suitability.repository'
import { SiteSuitabilityService } from './services/site-suitability.service'

// 新选址适宜性模块（工单 §四单元四）：加权叠加端点。因子面来自 suitability_cells
// 预物化表（tools/site-suitability/），端点只做归一化+加权和（勘误#5 口径）。
// DbService 为 infra/db 全局连接池；SQL 收口 repository 层（cruise 规则）。
// AHP 权重默认值出自 common/constants/site-ahp.constants.ts 草案矩阵（定稿闸见其头部）。
@Module({
  controllers: [SiteSuitabilityController],
  providers: [SiteSuitabilityRepository, SiteSuitabilityService],
})
export class SiteSuitabilityModule {}
