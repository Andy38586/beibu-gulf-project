import { MAP_CONFIG } from '@/core/config/map'

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
        // AUDIT-013: 提供更具体的错误信息
        throw new Error(`港口数据格式异常：期望数组类型，实际收到 ${typeof data}`)
      }
      return data
    } catch (error) {
      // AUDIT-013: 区分不同类型的错误
      if (error.message.includes('格式异常')) {
        console.error('港口数据格式验证失败:', error)
        throw new Error('港口数据格式不正确，请联系管理员')
      }
      console.error('加载港口数据失败:', error)
      throw error
    }
  },

  async getBoundary() {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.boundary)
      // AUDIT-014: 更严格的GeoJSON格式验证
      if (!data || typeof data !== 'object') {
        throw new Error('边界数据为空或格式无效')
      }
      if (!data.features || !Array.isArray(data.features)) {
        throw new Error('边界数据缺少features数组或格式不正确')
      }
      // AUDIT-014: 验证每个feature的基本结构
      const validFeatures = data.features.filter((f, index) => {
        if (!f || !f.geometry || !f.geometry.coordinates) {
          if (import.meta.env.DEV) {
            console.warn(`边界数据第${index}个feature结构无效:`, f)
          }
          return false
        }
        return true
      })
      if (validFeatures.length === 0) {
        throw new Error('边界数据中无有效的feature')
      }
      return { ...data, features: validFeatures }
    } catch (error) {
      // AUDIT-014: 区分格式错误和加载错误
      if (error.message.includes('格式') || error.message.includes('feature')) {
        console.error('边界数据格式验证失败:', error)
        throw new Error('边界数据格式不正确，请联系管理员')
      }
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
