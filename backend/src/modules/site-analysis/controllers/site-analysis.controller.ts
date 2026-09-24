import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { parseSiteAnalysisBody, type SiteAnalysisRequestBody } from '../dto/site-analysis-request'
import { SiteAnalysisService } from '../services/site-analysis.service'

/**
 * 选址分析。POST /nest-api/site-analysis，免鉴权纯计算。
 * 数据获取与计算编排都在 SiteAnalysisService（analyze）；
 * 请求形状校验在 dto/site-analysis-request.ts（**与 task 通道共用同一份**，见 d061）。
 * @SkipThrottle 必需：免鉴权纯计算最易被脚本刷，更不能反被 login 桶（50/15min）误伤
 */
@SkipThrottle({ login: true, register: true })
@Controller('site-analysis')
@ApiTags('site-analysis')
export class SiteAnalysisController {
  constructor(private readonly siteAnalysisService: SiteAnalysisService) {}

  // @HttpCode(200)：非"资源创建"端点，显式对齐 Nest POST 默认 201 之外的语义
  @Post()
  @HttpCode(200)
  async analyze(@Body() body?: SiteAnalysisRequestBody): Promise<unknown> {
    const input = parseSiteAnalysisBody(body)
    const result = await this.siteAnalysisService.analyze(input)
    // 业务失败以 422 返回，不再用 200 携带错误体
    if (result && result.error) {
      throw new BusinessError(ErrorCode.ANALYSIS_FAILED, result.error)
    }
    return result
  }

  /**
   * 名称关键词搜索（航线分析选点）。GET /nest-api/site-analysis/pois?keyword=&limit=
   * keyword 为空返回兜底列表；limit 钳制在 repository（1..200）。
   * 数据源为**多源点集合并**（港口/淹没设施点/小区/设施 POI，见 repository MULTI_SOURCE_SEARCH_SQL）。
   */
  @Get('pois')
  async searchPois(
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string
  ): Promise<unknown> {
    const parsedLimit = Number(limit)
    return this.siteAnalysisService.searchPois(
      keyword ?? '',
      Number.isFinite(parsedLimit) ? parsedLimit : 50
    )
  }
}
