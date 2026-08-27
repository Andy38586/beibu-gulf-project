import { Router } from 'express'

import * as portsController from '../controllers/portsController.js'

const router = Router()

// 港口为地图参考要素，公开可读（无需登录，与 boundary 同源）
router.get('/', portsController.getAll)

export default router
