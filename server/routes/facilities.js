import { Router } from 'express'
import * as facilitiesController from '../controllers/facilitiesController.js'

const router = Router()

router.get('/xiaoqu', facilitiesController.getXiaoqu)
router.get('/:type', facilitiesController.getByType)

export default router
