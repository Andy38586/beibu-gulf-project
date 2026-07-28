/**
 * ForecastEngine — 港口吞吐量预测计算引擎
 *
 * 算法: 历史趋势模型 + 发展情景系数
 * 当前为模拟实现，架构预留后续接入 ARIMA/XGBoost 等专业模型
 *
 * 输入:
 *   historicalData: [{ time, value }]  历史月度数据
 *   scenarioLevel: 0.8~1.2            发展情景系数
 *   forecastMonths: number             预测月数 (默认 120 = 10 年)
 *
 * 输出:
 *   forecast: [{ time, value, reliability }]  预测序列
 *   metadata: { baseValue, baseTime, avgGrowthRate, scenarioLevel }
 */

export function computeForecast(historicalData, scenarioLevel = 1.0, forecastMonths = 120) {
  if (!historicalData || historicalData.length < 12) {
    return { forecast: [], metadata: { error: '历史数据不足（至少需要 12 个月）' } }
  }

  // 1. 按时间排序历史数据
  const sorted = [...historicalData].sort((a, b) => a.time.localeCompare(b.time))

  // 2. 计算近 5 年平均月增长率
  const recentCount = Math.min(60, sorted.length) // 最多取 5 年
  const recent = sorted.slice(-recentCount)
  const growthRates = []
  for (let i = 12; i < recent.length; i++) {
    const yearAgo = recent[i - 12]
    const curr = recent[i]
    if (yearAgo && yearAgo.value > 0 && curr.value > 0) {
      growthRates.push((curr.value - yearAgo.value) / yearAgo.value)
    }
  }
  const avgAnnualGrowth =
    growthRates.length > 0 ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length : 0.05

  // 3. 生成预测序列
  const lastHistorical = sorted[sorted.length - 1]
  const [baseYear, baseMonth] = lastHistorical.time.split('-').map(Number)

  const forecast = []
  for (let i = 1; i <= forecastMonths; i++) {
    const totalMonths = (baseYear - 2000) * 12 + baseMonth + i
    const year = 2000 + Math.floor((totalMonths - 1) / 12)
    const month = ((totalMonths - 1) % 12) + 1
    const time = `${year}-${String(month).padStart(2, '0')}`

    const yearsFromBase = i / 12
    // 趋势外推: 基值 × (1 + 年增长率 × 情景系数)^年数
    const trendValue =
      lastHistorical.value * Math.pow(1 + avgAnnualGrowth * scenarioLevel, yearsFromBase)

    // 季节性调整（简单月均比例）
    const seasonalFactor = getSeasonalFactor(sorted, month)
    const value = Math.round(trendValue * seasonalFactor)

    // 预测可信度随预测年限衰减（非统计学置信区间）
    const reliability = Math.max(0.25, 1 - yearsFromBase * 0.06)

    forecast.push({
      time,
      value,
      type: 'forecast',
      reliability: Math.round(reliability * 100) / 100,
    })
  }

  return {
    forecast,
    metadata: {
      baseValue: lastHistorical.value,
      baseTime: lastHistorical.time,
      avgGrowthRate: Math.round(avgAnnualGrowth * 10000) / 100, // 百分比，保留两位
      scenarioLevel,
      dataPoints: sorted.length,
      forecastRange: `${forecast[0]?.time || 'N/A'} ~ ${forecast[forecast.length - 1]?.time || 'N/A'}`,
    },
  }
}

function getSeasonalFactor(historical, targetMonth) {
  const monthlyData = {}
  historical.forEach((d) => {
    const m = parseInt(d.time.split('-')[1], 10)
    if (!monthlyData[m]) monthlyData[m] = { sum: 0, count: 0 }
    monthlyData[m].sum += d.value
    monthlyData[m].count++
  })
  const allAvg = historical.reduce((s, d) => s + d.value, 0) / historical.length
  if (!monthlyData[targetMonth] || allAvg === 0) return 1
  const monthAvg = monthlyData[targetMonth].sum / monthlyData[targetMonth].count
  return monthAvg / allAvg
}

/**
 * 生成空间热力数据（单个时间点）
 * 基于预测值按比例分配到各空间点位
 */
export function generateSpatialValues(historicalData, forecast, timePoint, spatialFeatures) {
  const allValues = [...historicalData, ...forecast]
  const timeEntry = allValues.find((d) => d.time === timePoint)
  if (!timeEntry) return []

  const result = []

  for (const feature of spatialFeatures) {
    const [lng, lat] = feature.geometry.coordinates
    const baseValue = timeEntry.value

    // 每个港口中心生成散射点，填补热力图（原始只有 3 个点，热力层不可见）
    const scatterPoints = 40
    for (let i = 0; i < scatterPoints; i++) {
      // 在港口中心 ~5km 半径内随机散射
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 0.05 * (0.5 + Math.random() * 0.5) // 0.025~0.05°
      const scatterLng = lng + Math.cos(angle) * dist
      const scatterLat = lat + Math.sin(angle) * dist

      // 中心高、边缘低的权重衰减
      const weight = 0.5 + 0.5 * (1 - dist / 0.05) + Math.random() * 0.1
      const scatterValue = Math.round((baseValue / scatterPoints) * weight * 5)

      result.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [scatterLng, scatterLat] },
        properties: {
          ...feature.properties,
          portId: feature.properties.portId,
          portName: feature.properties.portName,
          value: Math.max(1, scatterValue),
          reliability: timeEntry.reliability || 1,
        },
      })
    }
  }

  return result
}
