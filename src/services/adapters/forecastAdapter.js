/**
 * Forecast Data Adapter
 *
 * 职责：隔离预测分析业务层与数据源。
 * 业务层（useForecastRequest、ForecastPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API。
 *
 * 架构验证阶段：dataSource = 'mock'，读取 public/data/forecast/
 * 生产阶段：dataSource = 'api'，调用后端预测服务
 *
 * 替换方式：只需修改 dataSource 或替换 getIndicatorData 实现，
 * 业务层和渲染层无需任何改动。
 */

const MOCK_BASE = '/data/forecast'

// ==================== 数据源配置 ====================
let _dataSource = 'mock'

// ==================== 内部 Mock 实现 ====================
async function _fetchMock(indicator) {
  const url = `${MOCK_BASE}/${indicator}.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 数据加载失败: ${indicator} (HTTP ${res.status})`)
  }
  return res.json()
}

async function _fetchMockIndex() {
  const url = `${MOCK_BASE}/index.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 指标索引加载失败 (HTTP ${res.status})`)
  }
  return res.json()
}

// ==================== 公开接口 ====================
export const forecastAdapter = {
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
      throw new Error(`[ForecastAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    if (import.meta.env.DEV) {
      console.info(`[ForecastAdapter] 数据源切换为: ${mode}`)
    }
  },

  /**
   * 获取预测指标时序数据
   * @param {string} indicator - 指标名称 (throughput | berth | traffic | pressure | development)
   * @returns {Promise<Array>} 时序数据数组 [{ time, value, ... }]
   */
  async getIndicatorData(indicator) {
    if (_dataSource === 'mock') {
      return _fetchMock(indicator)
    }
    // TODO: 生产阶段接入真实预测 API
    // return axios.get(`/api/v2/forecast/${indicator}`)
    throw new Error('[ForecastAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  /**
   * 获取可用预测指标列表
   * @returns {Promise<Array>} [{ key, label, unit, ... }]
   */
  async getAvailableIndicators() {
    if (_dataSource === 'mock') {
      return _fetchMockIndex()
    }
    // TODO: 生产阶段接入真实指标 API
    // return axios.get('/api/v2/forecast/indicators')
    throw new Error('[ForecastAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },
}
