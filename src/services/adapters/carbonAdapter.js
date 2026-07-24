/**
 * Carbon Emission Data Adapter
 *
 * 架构验证阶段：使用 Mock 数据（src/mock/carbon/）
 * 生产阶段：floodAdapter.setDataSource('api')，对接真实碳排放监测 API
 *
 * 业务层和渲染层无需修改。
 */

import carbonMockData from '@/mock/carbon/carbonEmission.json'

let dataSource = 'mock'

export const carbonAdapter = {
  /**
   * 切换数据源
   * @param {'mock' | 'api'} mode
   */
  setDataSource(mode) {
    dataSource = mode
  },

  /**
   * 获取所有港口的碳排放数据
   * @returns {Promise<{ports: Array, unit: string, categories: Array}>}
   */
  async getEmissionData() {
    if (dataSource === 'mock') {
      return carbonMockData
    }
    // TODO: 接入真实碳排放 API
    // const res = await fetch('/api/carbon/emissions')
    // return res.json()
    throw new Error('Real API not implemented yet')
  },

  /**
   * 获取指定港口指定年份的排放量
   * @param {string} portId
   * @param {string} year
   * @returns {Promise<number>}
   */
  async getPortEmission(portId, year) {
    const data = await this.getEmissionData()
    const port = data.ports.find(p => p.id === portId)
    if (!port || port.emissions[year] === undefined) {
      throw new Error(`No emission data for ${portId} in ${year}`)
    }
    return port.emissions[year]
  },

  /**
   * 获取可用港口列表
   * @returns {Promise<Array<{id: string, name: string, coordinates: number[]}>>}
   */
  async getPorts() {
    const data = await this.getEmissionData()
    return data.ports.map(p => ({ id: p.id, name: p.name, coordinates: p.coordinates }))
  },

  /**
   * 获取可用年份范围
   * @returns {Promise<{start: string, end: string}>}
   */
  async getYearRange() {
    const data = await this.getEmissionData()
    const years = Object.keys(data.ports[0].emissions).sort()
    return { start: years[0], end: years[years.length - 1] }
  },
}
