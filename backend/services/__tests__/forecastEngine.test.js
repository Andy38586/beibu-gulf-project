// forecastEngine 回归测试（R-13 确定性）
import { describe, it, expect } from 'vitest'
import { computeForecast, generateSpatialValues } from '../forecastEngine.js'

// 生成 n 个月线性递增的历史数据，从 startYear-startMonth 开始
function generateHistorical(n, baseValue = 1000, step = 10, startYear = 2020, startMonth = 1) {
  const data = []
  for (let i = 0; i < n; i++) {
    const total = (startYear - 2000) * 12 + startMonth + i
    const year = 2000 + Math.floor((total - 1) / 12)
    const month = ((total - 1) % 12) + 1
    data.push({
      time: `${year}-${String(month).padStart(2, '0')}`,
      value: baseValue + i * step,
    })
  }
  return data
}

// 生成 n 个月恒定值的历史数据
function generateFlat(n, value = 1000, startYear = 2020, startMonth = 1) {
  const data = []
  for (let i = 0; i < n; i++) {
    const total = (startYear - 2000) * 12 + startMonth + i
    const year = 2000 + Math.floor((total - 1) / 12)
    const month = ((total - 1) % 12) + 1
    data.push({
      time: `${year}-${String(month).padStart(2, '0')}`,
      value,
    })
  }
  return data
}

// 给定 'YYYY-MM'，返回下一个 'YYYY-MM'
function nextMonth(time) {
  const [y, m] = time.split('-').map(Number)
  const total = (y - 2000) * 12 + m + 1
  const ny = 2000 + Math.floor((total - 1) / 12)
  const nm = ((total - 1) % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

describe('Forecast Engine', () => {
  describe('computeForecast - 边界情况', () => {
    it('历史数据为 null 时返回空预测和错误信息', () => {
      const result = computeForecast(null)
      expect(result.forecast).toEqual([])
      expect(result.metadata.error).toBeTruthy()
    })

    it('历史数据为 undefined 时返回空预测和错误信息', () => {
      const result = computeForecast(undefined)
      expect(result.forecast).toEqual([])
      expect(result.metadata.error).toBeTruthy()
    })

    it('历史数据为空数组时返回空预测和错误信息', () => {
      const result = computeForecast([])
      expect(result.forecast).toEqual([])
      expect(result.metadata.error).toBeTruthy()
    })

    it('历史数据少于 12 个月时返回空预测和错误信息', () => {
      const result = computeForecast(generateHistorical(11))
      expect(result.forecast).toEqual([])
      expect(result.metadata.error).toContain('12')
    })

    it('历史数据恰好 12 个月时能生成预测', () => {
      const data = generateHistorical(12)
      const result = computeForecast(data)
      expect(result.forecast.length).toBeGreaterThan(0)
      expect(result.metadata.baseTime).toBe(data[11].time)
      expect(result.metadata.baseValue).toBe(data[11].value)
    })
  })

  describe('computeForecast - 趋势外推', () => {
    it('默认生成 120 个月（10 年）的预测', () => {
      const result = computeForecast(generateHistorical(24))
      expect(result.forecast).toHaveLength(120)
    })

    it('第一条预测时间为基值时间的下一个月', () => {
      const data = generateHistorical(24)
      const result = computeForecast(data)
      expect(result.forecast[0].time).toBe(nextMonth(data[23].time))
    })

    it('预测点包含 time/value/type/reliability 四个字段', () => {
      const result = computeForecast(generateHistorical(24))
      const point = result.forecast[0]
      expect(point).toHaveProperty('time')
      expect(point).toHaveProperty('value')
      expect(point).toHaveProperty('type', 'forecast')
      expect(point).toHaveProperty('reliability')
    })

    it('情景系数越大，远期预测值越大', () => {
      const data = generateHistorical(24)
      const low = computeForecast(data, 0.8)
      const mid = computeForecast(data, 1.0)
      const high = computeForecast(data, 1.2)
      // 取第 60 个月（5 年后）比较，趋势差异已显著
      expect(high.forecast[59].value).toBeGreaterThan(mid.forecast[59].value)
      expect(mid.forecast[59].value).toBeGreaterThan(low.forecast[59].value)
    })

    it('scenarioLevel 写入 metadata', () => {
      const data = generateHistorical(24)
      expect(computeForecast(data, 1.1).metadata.scenarioLevel).toBe(1.1)
      expect(computeForecast(data, 0.9).metadata.scenarioLevel).toBe(0.9)
    })

    it('forecastMonths 参数控制预测长度', () => {
      const result = computeForecast(generateHistorical(24), 1.0, 24)
      expect(result.forecast).toHaveLength(24)
    })

    it('所有同比计算点不可用时使用默认增长率 0.05', () => {
      // 所有值为 0：yearAgo.value > 0 与 curr.value > 0 均不成立
      const result = computeForecast(generateFlat(24, 0))
      // 0.05 * 10000 / 100 = 5
      expect(result.metadata.avgGrowthRate).toBe(5)
      expect(result.forecast).toHaveLength(120)
    })

    it('历史数据含零值或负值时仍能完成计算', () => {
      const data = generateHistorical(24)
      data[5].value = 0
      data[10].value = -100
      const result = computeForecast(data)
      expect(result.forecast).toHaveLength(120)
      expect(result.metadata.baseValue).toBe(data[23].value)
    })

    it('历史数据未按时间排序时也能正确计算', () => {
      const data = generateHistorical(24)
      const shuffled = [...data].reverse()
      const result = computeForecast(shuffled)
      expect(result.metadata.baseTime).toBe(data[23].time)
      expect(result.forecast[0].time).toBe(nextMonth(data[23].time))
    })

    it('不修改输入的历史数据', () => {
      const data = generateHistorical(24)
      const snapshot = JSON.parse(JSON.stringify(data))
      computeForecast(data)
      expect(data).toEqual(snapshot)
    })
  })

  describe('computeForecast - 季节性调整', () => {
    it('高峰月份预测值高于平季月份', () => {
      // 构造 24 个月数据：12 月值 2000，其他月值 1000
      const data = []
      for (let i = 0; i < 24; i++) {
        const year = 2020 + Math.floor(i / 12)
        const month = (i % 12) + 1
        data.push({
          time: `${year}-${String(month).padStart(2, '0')}`,
          value: month === 12 ? 2000 : 1000,
        })
      }
      const result = computeForecast(data, 1.0, 12)
      const decemberIdx = result.forecast.findIndex((p) => p.time.endsWith('-12'))
      const juneIdx = result.forecast.findIndex((p) => p.time.endsWith('-06'))
      expect(decemberIdx).toBeGreaterThanOrEqual(0)
      expect(juneIdx).toBeGreaterThanOrEqual(0)
      expect(result.forecast[decemberIdx].value).toBeGreaterThan(result.forecast[juneIdx].value)
    })
  })

  describe('computeForecast - 置信度计算', () => {
    it('可靠度随预测年限衰减', () => {
      const result = computeForecast(generateHistorical(24))
      const first = result.forecast[0].reliability
      const later = result.forecast[119].reliability
      expect(first).toBeGreaterThanOrEqual(later)
    })

    it('可靠度不低于下限 0.25', () => {
      // 200 个月 ≈ 16.67 年，理论值 1 - 16.67*0.06 ≈ 0，应被截断到 0.25
      const result = computeForecast(generateHistorical(24), 1.0, 200)
      for (const p of result.forecast) {
        expect(p.reliability).toBeGreaterThanOrEqual(0.25)
      }
      expect(result.forecast[199].reliability).toBe(0.25)
    })
  })

  describe('computeForecast - 数值精度', () => {
    it('可靠度保留两位小数', () => {
      const result = computeForecast(generateHistorical(24))
      for (const p of result.forecast) {
        expect(p.reliability).toBe(Number(p.reliability.toFixed(2)))
      }
    })

    it('预测 value 为整数', () => {
      const result = computeForecast(generateHistorical(24))
      for (const p of result.forecast) {
        expect(Number.isInteger(p.value)).toBe(true)
      }
    })

    it('metadata.avgGrowthRate 为百分比保留两位小数', () => {
      const result = computeForecast(generateHistorical(36))
      const rate = result.metadata.avgGrowthRate
      expect(rate).toBe(Number(rate.toFixed(2)))
    })
  })

  describe('computeForecast - metadata 完整性', () => {
    it('metadata 包含完整字段', () => {
      const result = computeForecast(generateHistorical(24))
      expect(result.metadata).toHaveProperty('baseValue')
      expect(result.metadata).toHaveProperty('baseTime')
      expect(result.metadata).toHaveProperty('avgGrowthRate')
      expect(result.metadata).toHaveProperty('scenarioLevel')
      expect(result.metadata).toHaveProperty('dataPoints')
      expect(result.metadata).toHaveProperty('forecastRange')
    })

    it('metadata.dataPoints 反映历史数据条数', () => {
      const data = generateHistorical(36)
      const result = computeForecast(data)
      expect(result.metadata.dataPoints).toBe(36)
    })

    it('metadata.forecastRange 反映首末预测时间', () => {
      const data = generateHistorical(24)
      const result = computeForecast(data)
      const first = result.forecast[0].time
      const last = result.forecast[119].time
      expect(result.metadata.forecastRange).toBe(`${first} ~ ${last}`)
    })
  })

  describe('generateSpatialValues', () => {
    function makeFeature(portId, portName, lng = 108.4, lat = 22.9) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { portId, portName },
      }
    }

    it('时间点不存在时返回空数组', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const result = generateSpatialValues(historical, [], '2099-01', [makeFeature('p1', '港口A')])
      expect(result).toEqual([])
    })

    it('每个空间要素生成 40 个散射点', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const features = [makeFeature('p1', '港口A'), makeFeature('p2', '港口B')]
      const result = generateSpatialValues(historical, [], '2024-01', features)
      expect(result).toHaveLength(80)
    })

    it('散射点坐标在中心 0.06 度范围内', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const center = [108.4, 22.9]
      const result = generateSpatialValues(historical, [], '2024-01', [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: center },
          properties: { portId: 'p1', portName: '港口A' },
        },
      ])
      for (const f of result) {
        const [lng, lat] = f.geometry.coordinates
        expect(lng).toBeGreaterThanOrEqual(center[0] - 0.06)
        expect(lng).toBeLessThanOrEqual(center[0] + 0.06)
        expect(lat).toBeGreaterThanOrEqual(center[1] - 0.06)
        expect(lat).toBeLessThanOrEqual(center[1] + 0.06)
      }
    })

    it('散射点 value 至少为 1', () => {
      const historical = [{ time: '2024-01', value: 1, reliability: 1 }]
      const result = generateSpatialValues(historical, [], '2024-01', [makeFeature('p1', '港口A')])
      for (const f of result) {
        expect(f.properties.value).toBeGreaterThanOrEqual(1)
      }
    })

    it('properties 透传 portId 与 portName', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const result = generateSpatialValues(historical, [], '2024-01', [makeFeature('p1', '港口A')])
      for (const f of result) {
        expect(f.properties.portId).toBe('p1')
        expect(f.properties.portName).toBe('港口A')
      }
    })

    it('使用历史时间点时 reliability 缺省为 1', () => {
      const historical = [{ time: '2024-01', value: 1000 }] // 无 reliability
      const result = generateSpatialValues(historical, [], '2024-01', [makeFeature('p1', '港口A')])
      for (const f of result) {
        expect(f.properties.reliability).toBe(1)
      }
    })

    it('使用预测时间点时 reliability 沿用预测点', () => {
      const forecast = [{ time: '2024-02', value: 1100, reliability: 0.75 }]
      const result = generateSpatialValues([], forecast, '2024-02', [makeFeature('p1', '港口A')])
      for (const f of result) {
        expect(f.properties.reliability).toBe(0.75)
      }
    })

    it('geometry 为 Point 类型', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const result = generateSpatialValues(historical, [], '2024-01', [makeFeature('p1', '港口A')])
      for (const f of result) {
        expect(f.type).toBe('Feature')
        expect(f.geometry.type).toBe('Point')
        expect(f.geometry.coordinates).toHaveLength(2)
      }
    })
  })

  describe('computeForecast - scenarioLevel 防御 (REQ-4)', () => {
    it('Infinity 回落 1.0 且不产出 Infinity', () => {
      const result = computeForecast(generateHistorical(24), Infinity)
      expect(result.metadata.scenarioLevel).toBe(1.0)
      for (const p of result.forecast) {
        expect(Number.isFinite(p.value)).toBe(true)
      }
    })

    it('NaN 回落 1.0', () => {
      const result = computeForecast(generateHistorical(24), NaN)
      expect(result.metadata.scenarioLevel).toBe(1.0)
    })

    it('负数回落 1.0', () => {
      const result = computeForecast(generateHistorical(24), -5)
      expect(result.metadata.scenarioLevel).toBe(1.0)
    })

    it('0 回落 1.0', () => {
      const result = computeForecast(generateHistorical(24), 0)
      expect(result.metadata.scenarioLevel).toBe(1.0)
    })
  })

  describe('generateSpatialValues - 确定性 (REQ-5)', () => {
    function makeFeature(portId, portName, lng = 108.4, lat = 22.9) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { portId, portName },
      }
    }

    it('同参数两次调用输出完全一致', () => {
      const historical = [{ time: '2024-01', value: 1000, reliability: 1 }]
      const features = [makeFeature('p1', '港口A'), makeFeature('p2', '港口B')]
      const a = generateSpatialValues(historical, [], '2024-01', features)
      const b = generateSpatialValues(historical, [], '2024-01', features)
      expect(a).toEqual(b)
    })

    it('不同 timePoint 输出不同', () => {
      const features = [makeFeature('p1', '港口A')]
      const a = generateSpatialValues(
        [{ time: '2024-01', value: 1000, reliability: 1 }],
        [],
        '2024-01',
        features
      )
      const b = generateSpatialValues(
        [{ time: '2024-02', value: 1000, reliability: 1 }],
        [],
        '2024-02',
        features
      )
      expect(a).not.toEqual(b)
    })

    it('同 timePoint 不同港口索引输出不同', () => {
      const features = [makeFeature('p1', '港口A'), makeFeature('p2', '港口B')]
      const a = generateSpatialValues(
        [{ time: '2024-01', value: 1000, reliability: 1 }],
        [],
        '2024-01',
        [features[0]]
      )
      const b = generateSpatialValues(
        [{ time: '2024-01', value: 1000, reliability: 1 }],
        [],
        '2024-01',
        [features[1]]
      )
      expect(a).not.toEqual(b)
    })
  })
})
