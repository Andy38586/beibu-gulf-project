import * as plansRepo from '../repositories/plansRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

export async function getAll(req, res, next) {
  try {
    const plans = await plansRepo.findAllByUserId(req.user.id)
    sendSuccess(res, plans)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取方案列表失败:', error)
    }
    next(error)
  }
}

export async function getOne(req, res, next) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权访问该方案')
    }
    sendSuccess(res, plan)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取方案失败:', error)
    }
    next(error)
  }
}

export async function createOne(req, res, next) {
  try {
    const { name, selectedKeys, typeSettings, weights } = req.body

    if (!name || !selectedKeys) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要字段: name, selectedKeys')
    }

    // @arch-note SEC-004: 方案名称正则校验（仅允许中文、字母、数字、下划线、连字符、空格，长度 1-50）
    const nameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]{1,50}$/
    if (!nameRegex.test(name)) {
      throw new BusinessError(
        ErrorCode.INVALID_PARAMS,
        '方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符'
      )
    }

    const existing = await plansRepo.findAllByUserId(req.user.id)
    if (existing.some((p) => p.name === name)) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '方案名称已存在')
    }
    const newPlan = await plansRepo.create({
      userId: req.user.id,
      name,
      selectedKeys,
      typeSettings: typeSettings || {},
      weights: weights || null,
    })
    sendSuccess(res, newPlan, 201)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('创建方案失败:', error)
    }
    next(error)
  }
}

export async function updateOne(req, res, next) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }
    const { name, selectedKeys, typeSettings, weights } = req.body
    if (name !== undefined) {
      const all = await plansRepo.findAllByUserId(req.user.id)
      if (all.some((p) => p.name === name && p.id !== req.params.id)) {
        throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '方案名称已存在')
      }
    }
    const updates = {}
    if (name !== undefined) updates.name = name
    if (selectedKeys !== undefined) updates.selectedKeys = selectedKeys
    if (typeSettings !== undefined) updates.typeSettings = typeSettings
    if (weights !== undefined) updates.weights = weights

    const updated = await plansRepo.update(req.params.id, updates)
    sendSuccess(res, updated)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('更新方案失败:', error)
    }
    next(error)
  }
}

export async function deleteOne(req, res, next) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权删除该方案')
    }
    const success = await plansRepo.remove(req.params.id)
    if (!success) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    res.status(204).send()
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('删除方案失败:', error)
    }
    next(error)
  }
}

/**
 * 保存小区到方案
 * POST /plans/:id/xiaoqu
 * Body: { xiaoqu: { id, name, score, breakdown, selectionCriteria, ... } }
 */
export async function saveXiaoquToOne(req, res, next) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }

    const { xiaoqu } = req.body
    if (!xiaoqu || !xiaoqu.id) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少小区信息')
    }

    const updated = await plansRepo.saveXiaoqu(req.params.id, xiaoqu)
    sendSuccess(res, updated)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('保存小区失败:', error)
    }
    next(error)
  }
}

/**
 * 从方案中移除小区
 * DELETE /plans/:id/xiaoqu/:xiaoquId
 */
export async function removeXiaoquFromOne(req, res, next) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }

    const updated = await plansRepo.removeXiaoqu(req.params.id, req.params.xiaoquId)
    sendSuccess(res, updated)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('移除小区失败:', error)
    }
    next(error)
  }
}
