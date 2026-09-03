import { Router } from 'express'

import * as siteAnalysisController from '../controllers/siteAnalysisController.js'

const router = Router()

// 选址分析为纯计算（不读用户数据、不落库），免登录——
// 02 §4.5 已拍板：仅收藏需登录，分析不要求登录态（2026-08-29 收口实现）
router.post('/', siteAnalysisController.analyze)

export default router
