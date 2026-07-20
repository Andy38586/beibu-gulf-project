import { Router } from 'express'
import * as markersController from '../controllers/markersController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// GET 接口允许匿名访问（只读数据）
router.get('/', markersController.getAll) // R - 读取列表
router.get('/:id', markersController.getOne) // R - 读取单个

// 写操作需要认证（AUDIT-SEC-005 修复）
router.post('/', authenticate, markersController.createOne) // C - 创建
router.put('/:id', authenticate, markersController.updateOne) // U - 更新
router.delete('/:id', authenticate, markersController.deleteOne) // D - 删除

export default router
