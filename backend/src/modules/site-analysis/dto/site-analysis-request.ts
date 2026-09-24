import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import type { TypeSetting } from './site-analysis.dto'

/** POST /site-analysis 的请求体（两个通道共用同一形状） */
export interface SiteAnalysisRequestBody {
  selectedKeys?: unknown
  typeSettings?: unknown
  weights?: unknown
  city?: unknown
}

/** 校验后的 analyze() 入参 */
export interface SiteAnalysisAnalyzeInput {
  selectedKeys: string[]
  typeSettings: Record<string, TypeSetting>
  weights?: Record<string, number>
  city?: unknown
}

/**
 * POST /site-analysis 请求体校验（**单一事实源**）。
 *
 * 🔴 为什么必须提出来（d061）：HTTP 通道与 task 异步通道原先各写一套——HTTP 在 controller
 * 里逐项校验，task 的 handler 却 `params.selectedKeys as string[]` / `as never` 直灌
 * `analyze()`。同一非法入参于是分叉成两种终态：同步通道 422/422001，任务通道
 * `status:'done'` 且结果体里塞着 error（队列 onSuccess 照写 done）。
 * 校验只此一份，两通道同码同文案。
 *
 * 校验项与顺序逐字保留原 controller 版本（不新增口径）：必填 → importance 1-5 →
 * radius 正数 → weights 0-10 有限数。
 */
export function parseSiteAnalysisBody(
  body: SiteAnalysisRequestBody | undefined
): SiteAnalysisAnalyzeInput {
  const { selectedKeys, typeSettings, weights, city } = body ?? {}

  if (!selectedKeys || !typeSettings) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要参数: selectedKeys, typeSettings')
  }

  // 校验权重范围（1-5）
  for (const [key, setting] of Object.entries(typeSettings as Record<string, TypeSetting>)) {
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
  for (const [key, setting] of Object.entries(typeSettings as Record<string, TypeSetting>)) {
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
        throw new BusinessError(ErrorCode.INVALID_PARAMS, `权重 ${key} 无效，应为 0-10 之间的数字`)
      }
    }
  }

  return {
    selectedKeys: selectedKeys as string[],
    typeSettings: typeSettings as Record<string, TypeSetting>,
    weights: weights as Record<string, number> | undefined,
    city,
  }
}
