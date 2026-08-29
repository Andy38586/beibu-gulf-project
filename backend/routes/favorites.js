import { Router } from 'express'

import * as favoritesController from '../controllers/favoritesController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// 收藏属于用户数据，全部需登录（02 §4.5：仅收藏需登录的核心场景）
router.use(authenticate)

/**
 * GET /api/favorites — 当前用户全部收藏（最新在前）
 */
router.get('/', favoritesController.list)

/**
 * POST /api/favorites — 添加收藏（幂等：itemType + itemId 全局唯一，重复添加返回既有项）
 * Body: { itemType: 'xiaoqu'|'facility', itemId, name, lng, lat, snapshot? }
 */
router.post('/', favoritesController.add)

/**
 * DELETE /api/favorites/:itemType/:itemId — 取消收藏
 */
router.delete('/:itemType/:itemId', favoritesController.remove)

export default router
