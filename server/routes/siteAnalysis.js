import { Router } from 'express'
import * as siteAnalysisController from '../controllers/siteAnalysisController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// FIX:SEC-006: 选址分析接口需要登录认证
router.post('/', authenticate, siteAnalysisController.analyze)

export default router
