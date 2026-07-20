import { Router } from 'express'
import * as facilitiesController from '../controllers/facilitiesController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// AUDIT-SEC-006 修复：设施接口挂载 authenticate 中间件
router.get('/xiaoqu', authenticate, facilitiesController.getXiaoqu)
router.get('/:type', authenticate, facilitiesController.getByType)

export default router
