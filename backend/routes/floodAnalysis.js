import { Router } from 'express'

import * as floodAnalysisController from '../controllers/floodAnalysisController.js'

const router = Router()

/**
 * 洪水分析路由。路径约定：资源型端点用 kebab-case 名词复数，操作型端点用 /analysis/<action>
 * （同样适用于 forecast/site-analysis/plans 等路由）。
 * 全部免鉴权（2026-08-29 收口 02 §4.5：仅收藏需登录，浸没分析不要求登录态；
 * disaster 评估为纯计算，不读用户数据）。
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

/**
 * POST /api/flood/analysis/disaster — 灾害评估，Body: { waterLevel: number }（免鉴权，纯计算）
 */
router.post('/analysis/disaster', floodAnalysisController.analyzeDisaster)

export default router
