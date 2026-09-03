import * as favoritesRepository from '../repositories/favoritesRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

// 收藏对象类型白名单：选址小区 / 浸没设施
const ITEM_TYPES = ['xiaoqu', 'facility']

/** 校验并规范化收藏项入参（非法即抛 BusinessError） */
function validateItem(body) {
  const { itemType, itemId, name, lng, lat, snapshot } = body || {}
  if (!ITEM_TYPES.includes(itemType)) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemType 无效（xiaoqu | facility）')
  }
  if (!itemId || typeof itemId !== 'string') {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemId 必填且为字符串')
  }
  if (!name || typeof name !== 'string') {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'name 必填且为字符串')
  }
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'lng/lat 必须为有限数值')
  }
  return {
    itemType,
    itemId,
    name,
    lng: Number(lng),
    lat: Number(lat),
    snapshot: snapshot ?? null,
  }
}

/**
 * GET /api/favorites — 当前用户全部收藏（最新在前）
 */
export async function list(req, res, next) {
  try {
    const items = await favoritesRepository.findAllByUserId(req.user.id)
    sendSuccess(res, items)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取收藏列表失败:', error)
    }
    next(error)
  }
}

/**
 * POST /api/favorites — 添加收藏（幂等：同键已存在返回既有项，不重复写入）
 */
export async function add(req, res, next) {
  try {
    const item = validateItem(req.body)
    const { favorite, existed } = await favoritesRepository.add(req.user.id, item)
    sendSuccess(res, { favorite, existed })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('添加收藏失败:', error)
    }
    next(error)
  }
}

/**
 * DELETE /api/favorites/:itemType/:itemId — 取消收藏
 */
export async function remove(req, res, next) {
  try {
    const { itemType, itemId } = req.params
    if (!ITEM_TYPES.includes(itemType)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemType 无效（xiaoqu | facility）')
    }
    const removed = await favoritesRepository.remove(req.user.id, itemType, itemId)
    sendSuccess(res, { removed })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('取消收藏失败:', error)
    }
    next(error)
  }
}
