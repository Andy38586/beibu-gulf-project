import { MAP_CONFIG } from '@/config/map'

const cache = new Map()

async function fetchData(url) {
  if (cache.has(url)) {
    return cache.get(url)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`请求失败: ${url}, HTTP ${response.status}`)
  }

  const data = await response.json()
  cache.set(url, data)
  return data
}

export const mapDataService = {
  async getPorts() {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.ports)
      if (!Array.isArray(data)) {
        throw new Error('港口数据格式异常，期望数组')
      }
      return data
    } catch (error) {
      console.error('加载港口数据失败:', error)
      throw error
    }
  },

  async getBoundary() {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.boundary)
      if (!data || !data.features || !Array.isArray(data.features)) {
        throw new Error('边界数据格式异常，期望GeoJSON格式')
      }
      return data
    } catch (error) {
      console.error('加载边界数据失败:', error)
      throw error
    }
  },

  clearCache() {
    cache.clear()
  },

  getCacheStatus() {
    return {
      ports: cache.has(MAP_CONFIG.DATA_PATHS.ports),
      boundary: cache.has(MAP_CONFIG.DATA_PATHS.boundary),
    }
  },
}
