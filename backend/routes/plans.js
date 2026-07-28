import { Router } from 'express'
import * as plansController from '../controllers/plansController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

router.use(authenticate)

router.get('/', plansController.getAll)
router.get('/:id', plansController.getOne)
router.post('/', plansController.createOne)
router.put('/:id', plansController.updateOne)
router.delete('/:id', plansController.deleteOne)

// 小区保存/移除接口
router.post('/:id/xiaoqu', plansController.saveXiaoquToOne)
router.delete('/:id/xiaoqu/:xiaoquId', plansController.removeXiaoquFromOne)

export default router
