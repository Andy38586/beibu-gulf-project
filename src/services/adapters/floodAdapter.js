/**
 * Flood Data Adapter
 *
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API/数据库。
 *
 * 架构验证阶段：dataSource = 'mock'，使用示意性数据
 * 生产阶段：dataSource = 'api'，调用后端水文/地形服务
 *
 * 替换方式：只需修改 dataSource 或替换各方法实现，
 * 业务层和渲染层无需任何改动。
 */

import { useApiRequest } from '@/shared/composables/useApiRequest'

const { apiRequest } = useApiRequest()

// ==================== 数据源配置 ====================
let _dataSource = 'mock'

// ==================== Fallback 数据 ====================
const FALLBACK_WATER_AREA_COORDINATES = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

// ==================== 内部 Mock 实现 ====================
let _cachedWaterAreaCoords = null

async function _fetchMockWaterArea() {
  if (_cachedWaterAreaCoords) return _cachedWaterAreaCoords
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch('/data/water-area.json', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    _cachedWaterAreaCoords = data.coordinates
    return _cachedWaterAreaCoords
  } catch {
    if (import.meta.env.DEV) {
      console.warn('[FloodAdapter] water-area.json 加载失败，使用兜底坐标')
    }
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

// ==================== 公开接口 ====================
export const floodAdapter = {
  /**
   * 获取当前数据源模式
   */
  get dataSource() {
    return _dataSource
  },

  /**
   * 切换数据源
   * @param {'mock' | 'api'} mode
   */
  setDataSource(mode) {
    if (mode !== 'mock' && mode !== 'api') {
      throw new Error(`[FloodAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    if (import.meta.env.DEV) {
      console.info(`[FloodAdapter] 数据源切换为: ${mode}`)
    }
  },

  /**
   * 获取水域边界坐标
   * @returns {Promise<Array<[number, number]>>} 多边形坐标数组
   */
  async getWaterArea() {
    if (_dataSource === 'mock') {
      return _fetchMockWaterArea()
    }
    // TODO: 生产阶段接入真实水域 API
    // return axios.get('/api/v2/hydrology/water-bodies', { params: { region: 'qinzhou' } })
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  /**
   * 获取淹没分析结果
   * @param {number} waterLevel - 水位（米）
   * @param {Object} [options] - 请求选项
   * @param {AbortSignal} [options.signal] - 取消信号
   * @returns {Promise<{features: Array, statistics: Object, riskLevel: string}>}
   */
  async getFloodAnalysis(waterLevel, { signal } = {}) {
    if (_dataSource === 'mock') {
      // Mock 模式：直接调用后端 API（后端使用模拟 DEM 数据）
      const [floodAreasData, statisticsData] = await Promise.all([
        apiRequest(`/gcs/flood-areas?waterLevel=${waterLevel}`, { signal }),
        apiRequest(`/gcs/flood-statistics?waterLevel=${waterLevel}`, { signal }),
      ])

      if (floodAreasData.code !== 200 || statisticsData.code !== 200) {
        throw new Error('[FloodAdapter] 淹没分析响应异常')
      }

      return {
        features: floodAreasData.data.features || [],
        statistics: statisticsData.data,
        riskLevel: floodAreasData.data.riskLevel || '无风险',
        actualWaterLevel: floodAreasData.data.actualWaterLevel,
      }
    }
    // TODO: 生产阶段接入真实淹没分析 API
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  /**
   * 获取灾害影响评估结果
   * @param {number} waterLevel - 水位（米）
   * @param {Object} [options] - 请求选项
   * @param {AbortSignal} [options.signal] - 取消信号
   * @returns {Promise<{affectedFacilities: Array, totalLoss: number}>}
   */
  async getImpactAssessment(waterLevel, { signal } = {}) {
    if (_dataSource === 'mock') {
      const data = await apiRequest('/gcs/analysis/disaster', {
        method: 'POST',
        body: JSON.stringify({ waterLevel }),
        signal,
      })

      if (data.code !== 200) {
        throw new Error('[FloodAdapter] 影响评估响应异常')
      }

      const result = data.data
      return {
        affectedFacilities: result.affectedFacilities || [],
        totalLoss: result.totalLoss || 0,
      }
    }
    // TODO: 生产阶段接入真实灾害评估 API
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  /**
   * 获取高程模拟数据（示意性 DEM）
   * @param {Object} region - 区域边界
   * @returns {Promise<Object>} DEM 数据
   */
  async getDEM(region) {
    if (_dataSource === 'mock') {
      // 架构验证阶段：后端使用模拟 DEM，不需要额外获取
      // 淹没分析 API 内部已包含高程过滤逻辑
      return { source: 'mock', note: '后端已使用模拟 DEM 数据' }
    }
    // TODO: 生产阶段接入真实 DEM
    // return axios.get('/api/v2/terrain/dem', { params: { ...region, resolution: 30 } })
    throw new Error('[FloodAdapter] 真实 DEM 尚未接入，请先调用 setDataSource("mock")')
  },

  /**
   * 清除缓存（用于测试或数据更新后刷新）
   */
  clearCache() {
    _cachedWaterAreaCoords = null
  },
}
