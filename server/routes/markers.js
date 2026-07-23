import { Router } from 'express'
import * as markersController from '../controllers/markersController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// BUGFIX-P0-02: 标记为个人数据，全部接口需登录
router.use(authenticate)

router.get('/', markersController.getAll) // R - 读取列表（按用户过滤）
router.get('/:id', markersController.getOne) // R - 读取单个
router.post('/', markersController.createOne) // C - 创建
router.put('/:id', markersController.updateOne) // U - 更新
router.delete('/:id', markersController.deleteOne) // D - 删除

export default router
