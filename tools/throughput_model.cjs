/**
 * 吞吐量预测模型脚本（季节分解 + 线性回归 + 滚动原点回测）
 *
 * 用途：生成模型产物（cargo / container 双指标，2026-08-29 起）
 *   - 输入：backend/data/forecast/cargo.json、container.json（官方真数据 2021-01 ~ 2026-06，
 *           来源：广西产业园区改革发展办公室 yqb.gxzf.gov.cn，经处理后数据清洗管线灌入）
 *   - 输出：backend/data/forecast/throughput_model.json（cargo，万吨）
 *           backend/data/forecast/container_model.json（container，TEU）
 *   - 方法：12 月中心移动平均提取趋势，季节指数分解，线性回归外推，
 *           验证期误差比率校正，滚动原点回测产出分步长误差曲线
 *   - 单位：模型只做数值运算，产物值与各自输入文件同单位（万吨 / TEU），
 *           服务层 unit 取自指标数据文件，不在产物内混装
 *
 * 运行：npm run forecast:model
 *
 * 口径说明（诚实标注）：
 *   - 训练期：2021-01 ~ 2024-12（48 个月，真数据）
 *   - 验证期：2025-01 ~ 2026-06（18 个月，真数据）
 *   - 预测期：2026-07 ~ 2035-12（2026 余下月份逐月 + 2027 起半年点）
 *   - 回测：滚动原点（rolling-origin），origin 2024-01 ~ 2025-06 共 18 个，
 *           每个 origin 用其之前数据训练、预测未来 12 个月、与真数据重叠段计误差；
 *           回测内不做误差比率校正（correction=1，避免信息泄漏）。
 *   - ⚠️ 平陆运河（计划 2026 底通航）未建模：2027 起的预测隐含"运河影响为零"假设，
 *     届时钦州港实际值大概率高于预测——情景区间见后续 intervention 层（未落地）。
 */
const fs = require('fs')
const path = require('path')

// 双指标配置（2026-08-29：container 接入模型链路，与 cargo 同方法同口径）
const INDICATORS = [
  {
    id: 'cargo',
    title: 'Throughput Forecasting Model（货物，万吨）',
    file: 'cargo.json',
    out: 'throughput_model.json',
    source: 'cargo.json（官方真数据 2021-01~2026-06，yqb.gxzf.gov.cn）',
  },
  {
    id: 'container',
    title: 'Throughput Forecasting Model（集装箱，TEU）',
    file: 'container.json',
    out: 'container_model.json',
    source: 'container.json（官方真数据 2021-01~2026-06，yqb.gxzf.gov.cn）',
  },
]

function forecastDir() {
  return path.join(__dirname, '..', 'backend', 'data', 'forecast')
}

const PORT_NAMES = {
  qinzhou: '钦州港',
  beihai: '北海港',
  fangchenggang: '防城港',
}

// 训练/验证切分（真数据 2021-01 ~ 2026-06）
const TRAIN_END = '2024-12'
const VALID_START = '2025-01'
// 滚动回测 origin 范围：首个 origin 需 ≥24 个月训练数据（buildModel 门槛）
const ROLLING_START = '2024-01'
const ROLLING_END = '2026-06' // 真数据终点
const ROLLING_HORIZON = 12

function loadData(file) {
  const raw = fs.readFileSync(path.join(forecastDir(), file), 'utf-8')
  return JSON.parse(raw)
}

function extractMonth(timeStr) {
  return parseInt(timeStr.split('-')[1], 10)
}

function nextMonth(timeStr) {
  const [y, m] = timeStr.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function centeredMovingAverage(values, window) {
  const n = values.length
  if (n < window) return []
  const ma = []
  for (let i = 0; i <= n - window; i++) {
    let sum = 0
    for (let j = 0; j < window; j++) sum += values[i + j]
    ma.push(sum / window)
  }
  const cma = []
  for (let i = 0; i < ma.length - 1; i++) cma.push((ma[i] + ma[i + 1]) / 2)
  return cma
}

function linearRegression(x, y) {
  const n = x.length
  if (n < 2) return { slope: 0, intercept: y.length > 0 ? y[0] : 0 }
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX += x[i]
    sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
  }
  const denom = n * sumX2 - sumX * sumX
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

function mape(actual, predicted) {
  if (actual.length === 0) return 0
  let sum = 0
  let count = 0
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== 0) {
      sum += Math.abs((actual[i] - predicted[i]) / actual[i])
      count++
    }
  }
  return count > 0 ? (sum / count) * 100 : 0
}

function buildModel(data) {
  const values = data.map((d) => d.value)
  const n = values.length
  if (n < 24) return null

  const cma = centeredMovingAverage(values, 12)
  const cmaStart = 6

  const ratiosByMonth = {}
  for (let m = 1; m <= 12; m++) ratiosByMonth[m] = []

  for (let i = 0; i < cma.length; i++) {
    const dataIdx = cmaStart + i
    const month = extractMonth(data[dataIdx].time)
    ratiosByMonth[month].push(data[dataIdx].value / cma[i])
  }

  const seasonalIndices = {}
  for (let m = 1; m <= 12; m++) {
    const r = ratiosByMonth[m]
    seasonalIndices[m] = r.length > 0 ? r.reduce((a, b) => a + b, 0) / r.length : 1.0
  }

  const sumIndices = Object.values(seasonalIndices).reduce((a, b) => a + b, 0)
  for (let m = 1; m <= 12; m++) {
    seasonalIndices[m] = (seasonalIndices[m] / sumIndices) * 12
  }

  const deseasonalized = values.map((v, i) => v / seasonalIndices[extractMonth(data[i].time)])
  const x = deseasonalized.map((_, i) => i)
  const reg = linearRegression(x, deseasonalized)

  return { seasonalIndices, slope: reg.slope, intercept: reg.intercept, n }
}

function predictTrend(model, timeIndex) {
  return model.intercept + model.slope * timeIndex
}

/** 滚动原点回测：返回 { mapeByStep: {1..12}, samples: {1..12} } */
function rollingBacktest(historical) {
  const sorted = [...historical].sort((a, b) => a.time.localeCompare(b.time))
  const byTime = new Map(sorted.map((d) => [d.time, d.value]))

  const errByStep = {}
  const cntByStep = {}
  for (let s = 1; s <= ROLLING_HORIZON; s++) {
    errByStep[s] = 0
    cntByStep[s] = 0
  }

  let origin = ROLLING_START
  while (origin <= ROLLING_END) {
    const trainData = sorted.filter((d) => d.time < origin)
    const model = buildModel(trainData)
    if (model) {
      for (let step = 1; step <= ROLLING_HORIZON; step++) {
        // 推算第 step 个月的 time
        let t = origin
        for (let k = 1; k < step; k++) t = nextMonth(t)
        const actual = byTime.get(t)
        if (actual === undefined) continue // 超出真数据范围（后半 origin 的远步长）
        const predicted =
          (model.intercept + model.slope * (model.n + step - 1)) *
          model.seasonalIndices[extractMonth(t)]
        if (actual > 0) {
          errByStep[step] += Math.abs((actual - predicted) / actual)
          cntByStep[step]++
        }
      }
    }
    origin = nextMonth(origin)
  }

  const mapeByStep = {}
  for (let s = 1; s <= ROLLING_HORIZON; s++) {
    mapeByStep[s] =
      cntByStep[s] > 0 ? Math.round((errByStep[s] / cntByStep[s]) * 10000) / 100 : null
  }
  return { mapeByStep, cntByStep }
}

function processPort(portId, historical) {
  historical.sort((a, b) => a.time.localeCompare(b.time))

  const trainData = historical.filter((d) => d.time <= TRAIN_END)
  const testData = historical.filter((d) => d.time >= VALID_START)

  const trainModel = buildModel(trainData)
  if (!trainModel) return null

  // 验证期（一次切分，兼容旧口径对比）
  const testPreds = testData.map((d, i) => ({
    time: d.time,
    actual: d.value,
    predicted:
      (trainModel.intercept + trainModel.slope * (trainModel.n + i)) *
      trainModel.seasonalIndices[extractMonth(d.time)],
  }))
  const overallMAPE = mape(
    testPreds.map((p) => p.actual),
    testPreds.map((p) => p.predicted)
  )

  const errorRatios = testPreds.map((p) => p.actual / p.predicted)
  const correctionFactor = errorRatios.reduce((a, b) => a + b, 0) / errorRatios.length

  let bias
  if (correctionFactor > 1.02) bias = 'underpredict'
  else if (correctionFactor < 0.98) bias = 'overpredict'
  else bias = 'balanced'

  // 滚动原点回测（无校正，防泄漏）
  const rolling = rollingBacktest(historical)

  // 最终模型：全量真数据训练
  const allModel = buildModel(historical)
  if (!allModel) return null

  const predictions = []
  const forecastStartIdx = allModel.n
  // 真数据终点 = 2026-06，预测从下一个月开始
  const lastTime = historical[historical.length - 1].time
  let cursor = nextMonth(lastTime)

  function addPrediction(timeStr) {
    const month = extractMonth(timeStr)
    const timeIndex = forecastStartIdx + (predictions.length + 0) // 顺序生成，relIdx 递增
    const trendVal = predictTrend(allModel, timeIndex)
    const correctedTrend = trendVal * correctionFactor
    const value = correctedTrend * allModel.seasonalIndices[month]

    // 区间宽度：来自滚动回测的分步长真实误差；超出回测步长后按 sqrt 外推放大
    const relIdx = timeIndex - forecastStartIdx + 1
    const stepMape = rolling.mapeByStep[Math.min(relIdx, ROLLING_HORIZON)] ?? overallMAPE
    const yearsOut = 1 + Math.floor(relIdx / 12)
    const width = (stepMape / 100) * (relIdx <= ROLLING_HORIZON ? 1 : Math.sqrt(yearsOut))

    predictions.push({
      time: timeStr,
      value: Math.round(value),
      lower: Math.round(value * (1 - width)),
      upper: Math.round(value * (1 + width)),
    })
  }

  // 2026-07 ~ 2026-12 逐月
  while (cursor <= '2026-12') {
    addPrediction(cursor)
    cursor = nextMonth(cursor)
  }
  // 2027-2035 半年点（06/12）
  for (let year = 2027; year <= 2035; year++) {
    addPrediction(`${year}-06`)
    addPrediction(`${year}-12`)
  }

  return {
    backtest: {
      validation_overall_mape: Math.round(overallMAPE * 100) / 100,
      validation_months: testPreds.length,
      rolling_mape_by_step: rolling.mapeByStep,
      rolling_samples_by_step: rolling.cntByStep,
      bias,
      correction_factor: Math.round(correctionFactor * 10000) / 10000,
    },
    predictions,
  }
}

function main() {
  for (const ind of INDICATORS) {
    const json = loadData(ind.file)
    const inputData = json.data
    const output = {
      ports: {},
      model_info: {
        method: 'seasonal_decomposition_with_correction',
        indicator: ind.id,
        data_source: ind.source,
        training_period: '2021-01 ~ 2024-12',
        validation_period: '2025-01 ~ 2026-06',
        rolling_backtest: `origin ${ROLLING_START} ~ ${ROLLING_END}，horizon ${ROLLING_HORIZON} 个月`,
        forecast_period: '2026-07 ~ 2035-12',
        canal_assumption: '未建模平陆运河（2027 起隐含影响为零假设，情景区间待 intervention 层）',
      },
    }

    console.log(`=== ${ind.title}（真数据版） ===\n`)

    for (const portId of Object.keys(inputData)) {
      const portData = inputData[portId]
      const historical = portData.historical
      const result = processPort(portId, historical)

      if (result) {
        output.ports[portId] = {
          name: PORT_NAMES[portId],
          backtest: result.backtest,
          predictions: result.predictions,
        }
        const bt = result.backtest
        console.log(`${PORT_NAMES[portId]} (${portId}):`)
        console.log(
          `  验证期(2025-01~2026-06) MAPE: ${bt.validation_overall_mape}%  bias=${bt.bias}`
        )
        console.log(
          `  滚动回测分步长 MAPE: ` +
            Object.entries(bt.rolling_mape_by_step)
              .map(([s, v]) => `s${s}=${v === null ? 'n/a' : v + '%'}`)
              .join(' ')
        )
        console.log(`  Correction factor: ${bt.correction_factor}`)
        console.log(`  Forecasts generated: ${result.predictions.length} time points`)
        console.log('')
      }
    }

    const outputPath = path.join(forecastDir(), ind.out)
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
    console.log(`Results saved to: ${outputPath}\n`)
  }
}

main()
