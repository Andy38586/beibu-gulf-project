const fs = require('fs')
const path = require('path')

const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'forecast', 'throughput.json')
const OUTPUT_PATH = path.join(
  __dirname,
  '..',
  'public',
  'data',
  'forecast',
  'throughput_model.json'
)

const PORT_NAMES = {
  qinzhou: '钦州港',
  beihai: '北海港',
  fangchenggang: '防城港',
}

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8')
  return JSON.parse(raw)
}

function extractMonth(timeStr) {
  return parseInt(timeStr.split('-')[1], 10)
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
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== 0) sum += Math.abs((actual[i] - predicted[i]) / actual[i])
  }
  return (sum / actual.length) * 100
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

function processPort(portId, historical) {
  historical.sort((a, b) => a.time.localeCompare(b.time))

  const trainData = historical.filter((d) => d.time <= '2022-12')
  const testData = historical.filter((d) => d.time >= '2023-01' && d.time <= '2025-12')

  const trainModel = buildModel(trainData)
  if (!trainModel) return null

  const testPreds = testData.map((d, i) => ({
    actual: d.value,
    predicted:
      (trainModel.intercept + trainModel.slope * (trainModel.n + i)) *
      trainModel.seasonalIndices[extractMonth(d.time)],
  }))

  const testByYear = {}
  for (let i = 0; i < testPreds.length; i++) {
    const year = testData[i].time.substring(0, 4)
    if (!testByYear[year]) testByYear[year] = { actual: [], predicted: [] }
    testByYear[year].actual.push(testPreds[i].actual)
    testByYear[year].predicted.push(testPreds[i].predicted)
  }

  const mape2023 = mape(testByYear['2023']?.actual || [], testByYear['2023']?.predicted || [])
  const mape2024 = mape(testByYear['2024']?.actual || [], testByYear['2024']?.predicted || [])
  const mape2025 = mape(testByYear['2025']?.actual || [], testByYear['2025']?.predicted || [])
  const overallMAPE = mape(
    testPreds.map((p) => p.actual),
    testPreds.map((p) => p.predicted)
  )

  const allActual = testPreds.map((p) => p.actual)
  const allPredicted = testPreds.map((p) => p.predicted)
  const errorRatios = allActual.map((a, i) => a / allPredicted[i])
  const correctionFactor = errorRatios.reduce((a, b) => a + b, 0) / errorRatios.length

  let bias
  if (correctionFactor > 1.02) bias = 'underpredict'
  else if (correctionFactor < 0.98) bias = 'overpredict'
  else bias = 'balanced'

  const allModel = buildModel(historical)
  if (!allModel) return null

  const predictions = []
  const forecastStartIdx = allModel.n

  function addPrediction(relIdx, timeStr) {
    const month = extractMonth(timeStr)
    const timeIndex = forecastStartIdx + relIdx
    const trendVal = predictTrend(allModel, timeIndex)
    const correctedTrend = trendVal * correctionFactor
    const seasonalVal = allModel.seasonalIndices[month]
    const value = correctedTrend * seasonalVal

    const yearsFromNow = parseInt(timeStr.substring(0, 4)) - 2026
    const width = (overallMAPE / 100) * Math.sqrt(yearsFromNow + 1)
    const lower = value * (1 - width)
    const upper = value * (1 + width)

    predictions.push({
      time: timeStr,
      value: Math.round(value),
      lower: Math.round(lower),
      upper: Math.round(upper),
    })
  }

  for (let m = 1; m <= 12; m++) {
    addPrediction(m - 1, `2026-${String(m).padStart(2, '0')}`)
  }

  let relIdx = 12
  for (let year = 2027; year <= 2035; year++) {
    addPrediction(relIdx, `${year}-06`)
    relIdx += 6
    addPrediction(relIdx, `${year}-12`)
    relIdx += 6
  }

  return {
    backtest: {
      mape_2023: Math.round(mape2023 * 100) / 100,
      mape_2024: Math.round(mape2024 * 100) / 100,
      mape_2025: Math.round(mape2025 * 100) / 100,
      overall_mape: Math.round(overallMAPE * 100) / 100,
      bias,
      correction_factor: Math.round(correctionFactor * 10000) / 10000,
    },
    predictions,
  }
}

function main() {
  const json = loadData()
  const inputData = json.data
  const output = {
    ports: {},
    model_info: {
      method: 'seasonal_decomposition_with_correction',
      training_period: '2018-2022',
      validation_period: '2023-2025',
      forecast_period: '2026-2035',
    },
  }

  console.log('=== Throughput Forecasting Model ===\n')

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
      console.log(`  MAPE: 2023=${bt.mape_2023}%  2024=${bt.mape_2024}%  2025=${bt.mape_2025}%`)
      console.log(`  Overall MAPE: ${bt.overall_mape}%`)
      console.log(`  Bias: ${bt.bias}`)
      console.log(`  Correction factor: ${bt.correction_factor}`)
      if (bt.bias !== 'balanced') {
        const dir = bt.bias === 'underpredict' ? 'Underprediction' : 'Overprediction'
        console.log(`  Correction: ${dir} corrected by factor ${bt.correction_factor}`)
      }
      console.log(`  Forecasts generated: ${result.predictions.length} time points`)
      console.log('')
    }
  }

  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`Results saved to: ${OUTPUT_PATH}`)
}

main()
