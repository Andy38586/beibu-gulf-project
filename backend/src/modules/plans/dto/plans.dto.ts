import { ApiProperty } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

// 方案名称正则（对齐 Express plansController：中文/字母/数字/下划线/连字符/空格，1-50）
export const PLAN_NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]{1,50}$/

const PLAN_NAME_MESSAGE =
  '方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符'

export class PlanCreateBody {
  @ApiProperty({ description: '方案名（1-50，中文/字母/数字/下划线/连字符/空格）' })
  name!: string

  @ApiProperty({ description: '选中的设施类型键列表' })
  selectedKeys!: unknown

  typeSettings!: unknown
  weights!: unknown

  // 校验顺序与文案逐字节对齐 Express createOne
  static parse(raw: unknown): PlanCreateBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const { name, selectedKeys, typeSettings, weights } = body
    if (!name || !selectedKeys) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要字段: name, selectedKeys')
    }
    if (typeof name !== 'string' || !PLAN_NAME_REGEX.test(name)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, PLAN_NAME_MESSAGE)
    }
    const dto = new PlanCreateBody()
    dto.name = name
    dto.selectedKeys = selectedKeys
    dto.typeSettings = typeSettings || {}
    dto.weights = weights || null
    return dto
  }
}

export class PlanUpdateBody {
  name?: unknown
  selectedKeys?: unknown
  typeSettings?: unknown
  weights?: unknown

  // 对齐 Express updateOne：部分更新，只挑四字段透传；
  // 注意名称正则仅在 create 校验（Express 现行为如此），update 只做重名检查（controller 层）。
  // 返回普通对象而非类实例：ES2022 define-fields 下类声明字段会以 undefined 进入
  // 自有属性集，repo 的 `key in updates` 判定会把未传字段当"显式传 undefined"覆盖掉
  static parse(raw: unknown): Record<string, unknown> {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = body.name
    if (body.selectedKeys !== undefined) updates.selectedKeys = body.selectedKeys
    if (body.typeSettings !== undefined) updates.typeSettings = body.typeSettings
    if (body.weights !== undefined) updates.weights = body.weights
    return updates
  }
}

export class PlanXiaoquBody {
  xiaoqu!: Record<string, unknown>

  // 对齐 Express saveXiaoquToOne：xiaoqu 对象整体透传（含 id 必填）
  static parse(raw: unknown): PlanXiaoquBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const xiaoqu = body.xiaoqu
    if (!xiaoqu || typeof xiaoqu !== 'object' || !(xiaoqu as Record<string, unknown>).id) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少小区信息')
    }
    const dto = new PlanXiaoquBody()
    dto.xiaoqu = xiaoqu as Record<string, unknown>
    return dto
  }
}
