/**
 * Forecast Data Adapter
 *
 * 职责：隔离预测分析业务层与数据源。
 * 业务层（useForecastRequest、ForecastPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API。
 */

const MOCK_BASE = '/data/forecast'

let _dataSource: 'mock' | 'api' = 'mock'

async function _fetchMock(indicator: string): Promise<unknown> {
  const url = `${MOCK_BASE}/${indicator}.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 数据加载失败: ${indicator} (HTTP ${res.status})`)
  }
  return res.json()
}

async function _fetchMockIndex(): Promise<unknown> {
  const url = `${MOCK_BASE}/index.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 指标索引加载失败 (HTTP ${res.status})`)
  }
  return res.json()
}

export const forecastAdapter = {
  get dataSource(): string {
    return _dataSource
  },

  setDataSource(mode: 'mock' | 'api'): void {
    if (mode !== 'mock' && mode !== 'api') {
      throw new Error(`[ForecastAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    if (import.meta.env.DEV) {
      console.info(`[ForecastAdapter] 数据源切换为: ${mode}`)
    }
  },

  async getIndicatorData(indicator: string): Promise<unknown> {
    if (_dataSource === 'mock') {
      return _fetchMock(indicator)
    }
    throw new Error('[ForecastAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  async getAvailableIndicators(): Promise<unknown> {
    if (_dataSource === 'mock') {
      return _fetchMockIndex()
    }
    throw new Error('[ForecastAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },
}
