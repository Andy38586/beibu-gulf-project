import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../common/errors/business-error'

import { FacilityPoint, TypeSetting } from './scoring'
import { SiteAnalysisRepository } from './site-analysis.repository'
import { SiteAnalysisService } from './site-analysis.service'

interface SiteAnalysisBody {
  selectedKeys?: string[]
  typeSettings?: Record<string, TypeSetting>
  weights?: unknown
  city?: unknown
}

/**
 * 选址分析。POST /nest-api/site-analysis，免鉴权纯计算
 * （Express routes/siteAnalysis.js：router.post('/')，单路由）。
 * 九步计算逐行等价移植 backend/services/siteAnalysisService.js；POI/小区读
 * backend/data/site-selection/ 三城 JSON；空结果（无重叠区域）是合法 data 不是 422。
 */
@Controller('site-analysis')
@ApiTags('site-analysis')
export class SiteAnalysisController {
  constructor(
    private readonly siteAnalysisRepository: SiteAnalysisRepository,
    private readonly siteAnalysisService: SiteAnalysisService
  ) {}

  // @HttpCode(200)：Express sendSuccess 默认 200（POST 201 默认值坑，收藏/洪涝同款）
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

    const facilityData: Record<string, FacilityPoint[] | null> = {}
    const validTypes = this.siteAnalysisRepository.getAvailableTypes()
    for (const key of selectedKeys) {
      if (!validTypes.includes(key)) {
        throw new BusinessError(
          ErrorCode.INVALID_PARAMS,
          `未知设施类型: ${key}，可用类型: ${validTypes.join(', ')}`
        )
      }
      facilityData[key] = await this.siteAnalysisRepository.findByType(key, city)
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

    const xiaoquData = await this.siteAnalysisRepository.findXiaoqu(city)

    const result = this.siteAnalysisService.runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData,
      xiaoquData,
      weights: weights as Record<string, number> | undefined,
    })
    // 业务失败以 422 返回，不再用 200 携带错误体
    if (result && result.error) {
      throw new BusinessError(ErrorCode.ANALYSIS_FAILED, result.error)
    }
    return result
  }
}
