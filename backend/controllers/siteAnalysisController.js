import { runSiteAnalysis } from '../services/siteAnalysisService.js'
import * as facilitiesRepo from '../repositories/facilitiesRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { sendSuccess } from '../utils/response.js'

export async function analyze(req, res, next) {
  try {
    const { selectedKeys, typeSettings, weights } = req.body

    if (!selectedKeys || !typeSettings) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要参数: selectedKeys, typeSettings')
    }

    // 校验权重范围（1-5）
    if (typeSettings) {
      for (const [key, setting] of Object.entries(typeSettings)) {
        if (setting.importance !== undefined) {
          const importance = Number(setting.importance)
          if (isNaN(importance) || importance < 1 || importance > 5) {
            throw new BusinessError(
              ErrorCode.INVALID_PARAMS,
              `设施类型 ${key} 的权重值无效，应在 1-5 之间`
            )
          }
        }
      }
    }

    const facilityData = {}
    const validTypes = facilitiesRepo.getAvailableTypes()
    for (const key of selectedKeys) {
      if (!validTypes.includes(key)) {
        throw new BusinessError(
          ErrorCode.INVALID_PARAMS,
          `未知设施类型: ${key}，可用类型: ${validTypes.join(', ')}`
        )
      }
      facilityData[key] = await facilitiesRepo.findByType(key)
    }

    // 半径校验（typeSettings 各项 radius 若提供必须为正数）
    for (const [key, setting] of Object.entries(typeSettings)) {
      if (setting.radius !== undefined) {
        const radius = Number(setting.radius)
        if (isNaN(radius) || radius <= 0) {
          throw new BusinessError(ErrorCode.INVALID_PARAMS, `设施类型 ${key} 的半径无效，应为正数`)
        }
      }
    }

    // 权重校验（若提供，逐项为 0~10 的有限数）
    if (weights !== undefined) {
      if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, 'weights 应为对象')
      }
      for (const [key, w] of Object.entries(weights)) {
        const weight = Number(w)
        if (isNaN(weight) || !isFinite(weight) || weight < 0 || weight > 10) {
          throw new BusinessError(
            ErrorCode.INVALID_PARAMS,
            `权重 ${key} 无效，应为 0-10 之间的数字`
          )
        }
      }
    }

    const xiaoquData = await facilitiesRepo.findXiaoqu()

    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData,
      xiaoquData,
      weights,
    })
    // 业务失败以 422 返回，不再用 200 携带错误体
    if (result && result.error) {
      throw new BusinessError(ErrorCode.ANALYSIS_FAILED, result.error)
    }
    sendSuccess(res, result)
  } catch (error) {
    next(error)
  }
}
