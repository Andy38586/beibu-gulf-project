import { Router } from 'express'
import * as floodAnalysisController from '../controllers/floodAnalysisController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

/**
 * 洪水分析路由。路径约定：资源型端点用 kebab-case 名词复数，操作型端点用 /analysis/<action>
 * （同样适用于 forecast/site-analysis/plans 等路由）。
 * 数据接口免鉴权（与前端 mock 模式一致，未登录可查看）；分析接口需登录。
 */

// ==================== 数据接口（免鉴权） ====================

/**
 * GET /api/flood/flood-areas?waterLevel=2.5 — 淹没范围数据（免鉴权）
 */
router.get('/flood-areas', floodAnalysisController.getFloodAreas)

/**
 * GET /api/flood/flood-statistics?waterLevel=2.5 — 统计数据（免鉴权）
 */
router.get('/flood-statistics', floodAnalysisController.getFloodStatistics)

/**
 * GET /api/flood/terrain-profiles — 地形剖面数据（免鉴权）
 */
router.get('/terrain-profiles', floodAnalysisController.getTerrainProfiles)

/**
 * GET /api/flood/water-area — 水域边界坐标（免鉴权）
 */
router.get('/water-area', floodAnalysisController.getWaterArea)

// ==================== 分析接口（需登录） ====================
router.use(authenticate)

/**
 * POST /api/flood/analysis/disaster — 灾害评估，Body: { waterLevel: number }（需登录）
 */
router.post('/analysis/disaster', floodAnalysisController.analyzeDisaster)

export default router
