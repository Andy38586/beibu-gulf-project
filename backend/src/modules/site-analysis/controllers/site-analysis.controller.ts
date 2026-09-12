import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import type { TypeSetting } from '../dto/site-analysis.dto'
import { SiteAnalysisService } from '../services/site-analysis.service'

interface SiteAnalysisBody {
  selectedKeys?: string[]
  typeSettings?: Record<string, TypeSetting>
  weights?: unknown
  city?: unknown
}

/**
 * 选址分析。POST /nest-api/site-analysis，免鉴权纯计算。
 * 数据获取与计算编排都在 SiteAnalysisService（analyze）；
 * 此处只做 HTTP 请求形状校验（必填/权重/半径/weights 范围）。
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
  async analyze(@Body() body?: SiteAnalysisBody): Promise<unknown> {
    const { selectedKeys, typeSettings, weights, city } = body ?? {}

    if (!selectedKeys || !typeSettings) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要参数: selectedKeys, typeSettings')
    }

    // 校验权重范围（1-5）
    for (const [key, setting] of Object.entries(typeSettings)) {
      if (setting.importance !== undefined) {
        const importance = Number(setting.importance)
        if (Number.isNaN(importance) || importance < 1 || importance > 5) {
          throw new BusinessError(
            ErrorCode.INVALID_PARAMS,
            `设施类型 ${key} 的权重值无效，应在 1-5 之间`
          )
        }
      }
    }

    // 半径校验（typeSettings 各项 radius 若提供必须为正数）
    for (const [key, setting] of Object.entries(typeSettings)) {
      if (setting.radius !== undefined) {
        const radius = Number(setting.radius)
        if (Number.isNaN(radius) || radius <= 0) {
          throw new BusinessError(ErrorCode.INVALID_PARAMS, `设施类型 ${key} 的半径无效，应为正数`)
        }
      }
    }

    // 权重校验（若提供，逐项为 0~10 的有限数）
    if (weights !== undefined) {
      if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, 'weights 应为对象')
      }
      for (const [key, w] of Object.entries(weights as Record<string, unknown>)) {
        const weight = Number(w)
        if (Number.isNaN(weight) || !Number.isFinite(weight) || weight < 0 || weight > 10) {
          throw new BusinessError(
            ErrorCode.INVALID_PARAMS,
            `权重 ${key} 无效，应为 0-10 之间的数字`
          )
        }
      }
    }

    const result = await this.siteAnalysisService.analyze({
      selectedKeys,
      typeSettings,
      weights: weights as Record<string, number> | undefined,
      city,
    })
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
