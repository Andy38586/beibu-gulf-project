// ForecastEngine 逐行等价移植（backend/services/forecastEngine.js，算法不改写——
// 改写属算法审查域须另行立项）。确定性：固定种子 LCG（Park-Miller），
// 种子由 timePoint + 港口索引哈希得到，禁止 Math.random 参与业务数值（02 §5.6.1）

export interface HistoricalPoint {
  time: string
  value: number
  type?: string
}

export interface ForecastPoint {
  time: string
  value: number
  type: string
  reliability: number
}

export interface EngineMetadata {
  baseValue?: number
  baseTime?: string
  avgGrowthRate?: number
  scenarioLevel?: number
  dataPoints?: number
  forecastRange?: string
  error?: string
}

export function computeForecast(
  historicalData: HistoricalPoint[] | null,
  scenarioLevel = 1.0,
  forecastMonths = 120
): { forecast: ForecastPoint[]; metadata: EngineMetadata } {
  // 输入边界防御：防止异常值经 Math.pow 产出非有限值（controller 已收口，此处双保险）
  if (!Number.isFinite(scenarioLevel) || scenarioLevel <= 0) {
    scenarioLevel = 1.0
  }
  if (!historicalData || historicalData.length < 12) {
    return { forecast: [], metadata: { error: '历史数据不足（至少需要 12 个月）' } }
  }

  // 1. 按时间排序历史数据
  const sorted = [...historicalData].sort((a, b) => a.time.localeCompare(b.time))

  // 2. 计算近 5 年平均月增长率
  const recentCount = Math.min(60, sorted.length) // 最多取 5 年
  const recent = sorted.slice(-recentCount)
  const growthRates: number[] = []
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

  const forecast: ForecastPoint[] = []
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

function getSeasonalFactor(historical: HistoricalPoint[], targetMonth: number): number {
  const monthlyData: Record<number, { sum: number; count: number }> = {}
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

// 固定种子 LCG（Park-Miller）
function seededRandom(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 生成空间热力数据（单个时间点）。散射点为示意性合成数据（非实测空间分布），
// 固定种子确定性生成（可 HTTP 缓存），仅用于热力图可视化填充
export interface SpatialFeature {
  type: string
  geometry: { type: string; coordinates: number[] }
  properties: Record<string, unknown> & { portId?: string; portName?: string }
}

export function generateSpatialValues(
  historicalData: HistoricalPoint[],
  forecast: ForecastPoint[],
  timePoint: string,
  spatialFeatures: SpatialFeature[]
): SpatialFeature[] {
  const allValues: Array<HistoricalPoint | ForecastPoint> = [...historicalData, ...forecast]
  const timeEntry = allValues.find((d) => d.time === timePoint)
  if (!timeEntry) return []

  const result: SpatialFeature[] = []

  spatialFeatures.forEach((feature, featureIndex) => {
    const [lng, lat] = feature.geometry.coordinates
    const baseValue = timeEntry.value
    // 每港口独立种子：相同 timePoint + 港口索引 → 固定散射点序列
    const rng = seededRandom(hashSeed(`${timePoint}:${featureIndex}`))

    // 每个港口中心生成散射点，填补热力图（原始只有 3 个点，热力层不可见）
    const scatterPoints = 40
    for (let i = 0; i < scatterPoints; i++) {
      // 在港口中心 ~5km 半径内随机散射（确定性）
      const angle = rng() * Math.PI * 2
      const dist = rng() * 0.05 * (0.5 + rng() * 0.5) // 0.025~0.05°
      const scatterLng = lng + Math.cos(angle) * dist
      const scatterLat = lat + Math.sin(angle) * dist

      // 中心高、边缘低的权重衰减
      const weight = 0.5 + 0.5 * (1 - dist / 0.05) + rng() * 0.1
      // ×5 为热力图视觉放大系数（非物理量）——40 散射点总和 ≈ base×4，
      // 仅为让热力层在默认透明度下肉眼可见；值仍为确定性合成示意数据
      const scatterValue = Math.round((baseValue / scatterPoints) * weight * 5)

      result.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [scatterLng, scatterLat] },
        properties: {
          ...feature.properties,
          portId: feature.properties.portId,
          portName: feature.properties.portName,
          value: Math.max(1, scatterValue),
          reliability: (timeEntry as { reliability?: number }).reliability || 1,
        },
      })
    }
  })

  return result
}
