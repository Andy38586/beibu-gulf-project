import { Router } from 'express'
import * as floodAnalysisController from '../controllers/floodAnalysisController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// BUGFIX-P2-11: 与其他业务路由对齐，全部端点需登录
router.use(authenticate)

/**
 * GCS三维港口分析系统API路由
 *
 * 数据接口：
 * - GET /water-levels      获取基准水位数据
 * - GET /flood-areas       获取淹没范围（支持waterLevel参数）
 * - GET /flood-statistics  获取统计数据（支持waterLevel参数）
 * - GET /terrain-profiles  获取剖面数据
 * - GET /facilities        获取设施点数据
 *
 * 分析接口：
 * - POST /analysis/disaster 灾害评估
 */

// ==================== 数据接口 ====================

/**
 * 获取基准水位数据
 * GET /api/gcs/water-levels
 */
router.get('/water-levels', floodAnalysisController.getWaterLevels)

/**
 * 获取淹没范围数据
 * GET /api/gcs/flood-areas?waterLevel=2.5
 */
router.get('/flood-areas', floodAnalysisController.getFloodAreas)

/**
 * 获取统计数据
 * GET /api/gcs/flood-statistics?waterLevel=2.5
 */
router.get('/flood-statistics', floodAnalysisController.getFloodStatistics)

/**
 * 获取剖面数据
 * GET /api/gcs/terrain-profiles
 */
router.get('/terrain-profiles', floodAnalysisController.getTerrainProfiles)

/**
 * 获取设施点数据
 * GET /api/gcs/facilities
 */
router.get('/facilities', floodAnalysisController.getFacilities)

// ==================== 分析接口 ====================

/**
 * 灾害评估
 * POST /api/gcs/analysis/disaster
 * Body: { waterLevel: number }
 */
router.post('/analysis/disaster', floodAnalysisController.analyzeDisaster)

export default router
