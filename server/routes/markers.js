import { Router } from 'express'
import * as markersController from '../controllers/markersController.js'

const router = Router()

router.get('/', markersController.getAll) // R - 读取列表
router.get('/:id', markersController.getOne) // R - 读取单个
router.post('/', markersController.createOne) // C - 创建
router.put('/:id', markersController.updateOne) // U - 更新
router.delete('/:id', markersController.deleteOne) // D - 删除

export default router
