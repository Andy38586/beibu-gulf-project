import { Router } from 'express'
import * as floodAnalysisController from '../controllers/floodAnalysisController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

/**
 * 洪水分析系统API路由
 * 路由路径风格约定（P3 收口）：
 * - 资源型端点：kebab-case 名词复数（/water-levels, /flood-areas, /terrain-profiles）
 * - 操作型端点：/analysis/<action>（/analysis/disaster）—— 表示“分析计算”而非 CRUD
 * - 此约定同样适用于其他路由文件（forecast/site-analysis/plans 等）
 * 数据接口（免鉴权，d036：与前端 mock 模式一致，未登录也能查看）：
 * - GET /flood-areas       获取淹没范围（支持waterLevel参数）
 * - GET /flood-statistics  获取统计数据（支持waterLevel参数）
 * - GET /terrain-profiles  获取剖面数据
 * 分析接口（需登录）：
 * - POST /analysis/disaster 灾害评估
 */

// ==================== 数据接口（免鉴权） ====================

/**
 * 获取基准水位数据
/**
 * 获取淹没范围数据
 * GET /api/flood/flood-areas?waterLevel=2.5
 */
router.get('/flood-areas', floodAnalysisController.getFloodAreas)

/**
 * 获取统计数据
 * GET /api/flood/flood-statistics?waterLevel=2.5
 */
router.get('/flood-statistics', floodAnalysisController.getFloodStatistics)

/**
 * 获取剖面数据
 * GET /api/flood/terrain-profiles
 */
router.get('/terrain-profiles', floodAnalysisController.getTerrainProfiles)

/**
 * 获取设施点数据
/**
 * 获取水域坐标数据
 * GET /api/flood/water-area
 */
router.get('/water-area', floodAnalysisController.getWaterArea)

// ==================== 分析接口（需登录） ====================
router.use(authenticate)

/**
 * 灾害评估
 * POST /api/flood/analysis/disaster
 * Body: { waterLevel: number }
 */
router.post('/analysis/disaster', floodAnalysisController.analyzeDisaster)

export default router
