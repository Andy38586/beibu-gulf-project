/**
 * 吞吐量预测模型脚本（基线：季节分解+线性回归；候选：春节修正+阻尼 Holt-Winters；闸门选优）
 *
 * 用途：生成模型产物（cargo / container 双指标，2026-08-29 起；2026-09-26 起带模型竞选）
 *   - 输入：backend/data/forecast/cargo.json、container.json（官方真数据 2021-01 ~ 2026-06，
 *           来源：广西产业园区改革发展办公室 yqb.gxzf.gov.cn，经处理后数据清洗管线灌入）
 *   - 输出：backend/data/forecast/throughput_model.json（cargo，万吨）
 *           backend/data/forecast/container_model.json（container，TEU）
 *   - 基线方法：12 月中心移动平均提取趋势，季节指数分解，线性回归外推，
 *           验证期误差比率校正，滚动原点回测产出分步长误差曲线
 *   - 候选方法：春节移动假期修正（节前日数法简化，k=0）→ 阻尼 Holt-Winters
 *           （加性/乘性季节 AICc 自动选择，lib/hw.cjs）
 *   - 闸门：三模型（线性 / ETS / 季节朴素基准）同协议滚动回测（同 origin 同 horizon），
 *           ETS 须在全步长平均 MAPE 上同时严格优于线性与朴素基准才替换，否则保留线性
 *           （lib/backtest.cjs selectModel——诚实降级写死在实现里）
 *   - 单位：模型只做数值运算，产物值与各自输入文件同单位（万吨 / TEU），
 *           服务层 unit 取自指标数据文件，不在产物内混装
 *
 * 运行：npm run forecast:model
 *
 * 口径说明（诚实标注）：
 *   - 训练期：2021-01 ~ 2024-12（48 个月，真数据）
 *   - 验证期：2025-01 ~ 2026-06（18 个月，真数据）
 *   - 预测期：2026-07 ~ 2035-12（2026 余下月份逐月 + 2027 起半年点）
 *   - 回测：滚动原点（rolling-origin），origin 2024-01 ~ 2026-06，
 *           每个 origin 用其之前数据训练、预测未来 12 个月、与真数据重叠段计误差；
 *           回测内不做误差比率校正（correction=1，避免信息泄漏）；
 *           春节修正的 h̄ 基准同样只用训练段重建（同协议防泄漏）。
 *   - ⚠️ 平陆运河（2026-09-16 已通航）未建模：预测=无运河反事实基线；
 *     情景层（可分流基数 × 分流率 10/20/30%）待 intervention 层落地（工单 F3）。
 */
const fs = require('fs')
const path = require('path')

const { fitHoltWinters, forecastFromFit } = require('./lib/hw.cjs')
const { buildCnyContext } = require('./lib/cny.cjs')
const {
  runRollingBacktest,
  seasonalNaiveModel,
  seasonalNaiveForecast,
  selectModel,
  monthIndex,
} = require('./lib/backtest.cjs')

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
  return path.join(__dirname, '..', '..', 'backend', 'data', 'forecast')
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

/** ETS 候选拟合：春节修正（h̄ 只用训练段重建，防泄漏）→ 阻尼 Holt-Winters。门槛与线性一致（≥24 个月）。 */
function fitEtsCandidate(train) {
  if (train.length < 24) return null
  const ctx = buildCnyContext(train.map((d) => d.time))
  const adjusted = train.map((d) => ctx.adjustValue(d.time, d.value))
  const fit = fitHoltWinters(adjusted, { m: 12 })
  if (!fit) return null
  return { ctx, fit, lastTime: train[train.length - 1].time }
}

/** ETS 候选预测：修正空间出值 → 春节逆变换回原空间（日历确定性） */
function forecastEtsCandidate(model, timeStr) {
  const h = monthIndex(timeStr) - monthIndex(model.lastTime)
  if (h < 1) return null
  const raw = forecastFromFit(model.fit, h)[h - 1]
  return model.ctx.invertValue(timeStr, raw)
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

  // 线性基线滚动回测（原实现保留——基线数字不得因升级漂移）
  const rolling = rollingBacktest(historical)

  // —— 候选模型同协议回测（线性 / ETS+春节修正 / 季节朴素基准）——
  const linH = runRollingBacktest({
    historical,
    fitFn: (train) => {
      const model = buildModel(train)
      if (!model) return null
      return { model, lastTime: train[train.length - 1].time }
    },
    forecastFn: ({ model, lastTime }, t) => {
      // lastTime = train 末条（= origin 上个月）⇒ t 的 0-based 外推索引 = 月差 − 1
      const idx0 = monthIndex(t) - monthIndex(lastTime) - 1
      return (
        (model.intercept + model.slope * (model.n + idx0)) * model.seasonalIndices[extractMonth(t)]
      )
    },
  })
  const etsH = runRollingBacktest({
    historical,
    fitFn: fitEtsCandidate,
    forecastFn: forecastEtsCandidate,
  })
  const snH = runRollingBacktest({
    historical,
    fitFn: seasonalNaiveModel,
    forecastFn: seasonalNaiveForecast,
  })

  // 同协议自检：harness 跑出的线性 MAPE 必须与原实现一致（防两套回测实现漂移）
  const linHarnessOverall = linH.overallMape
  const linLegacyOverall =
    Object.values(rolling.mapeByStep)
      .filter((v) => v !== null)
      .reduce((a, b) => a + b, 0) /
    Object.values(rolling.mapeByStep).filter((v) => v !== null).length
  if (Math.abs(linHarnessOverall - linLegacyOverall) > 0.05) {
    console.warn(
      `  ⚠️ 线性回测两实现不一致：harness=${linHarnessOverall}% legacy=${linLegacyOverall}%——查 backtest.cjs`
    )
  }

  // 全量数据 ETS 拟合（无论是否胜出都算——对比表需报告其参数，B10 可复算）
  const fullEts = fitEtsCandidate(historical)
  const etsFitInfo = fullEts
    ? {
        params: fullEts.fit.params,
        seasonal_type: fullEts.fit.seasonalType,
        aicc: Math.round(fullEts.fit.aicc * 100) / 100,
      }
    : null

  const selected = selectModel({
    linear: linH.overallMape,
    ets: etsH.overallMape,
    seasonal_naive: snH.overallMape,
  })

  const lastTime = historical[historical.length - 1].time
  let predictions
  let backtest

  if (selected === 'ets' && fullEts) {
    // 胜者 ETS：修正空间全量拟合 → 预测 → 春节逆变换；区间宽度沿用线性版的
    // 「步长 MAPE + sqrt 年外推」构造（步长误差换 winner 自己的，口径同源）
    const targets = []
    let cursor = nextMonth(lastTime)
    while (cursor <= '2026-12') {
      targets.push(cursor)
      cursor = nextMonth(cursor)
    }
    for (let year = 2027; year <= 2035; year++) {
      targets.push(`${year}-06`)
      targets.push(`${year}-12`)
    }
    predictions = targets.map((t) => {
      const value = forecastEtsCandidate(fullEts, t)
      const relIdx = monthIndex(t) - monthIndex(lastTime)
      const stepMape = etsH.mapeByStep[Math.min(relIdx, ROLLING_HORIZON)] ?? etsH.overallMape
      const yearsOut = 1 + Math.floor(relIdx / 12)
      const width = (stepMape / 100) * (relIdx <= ROLLING_HORIZON ? 1 : Math.sqrt(yearsOut))
      return {
        time: t,
        value: Math.round(value),
        lower: Math.round(value * (1 - width)),
        upper: Math.round(value * (1 + width)),
      }
    })
    backtest = {
      selected_model: 'ets',
      rolling_mape_by_step: etsH.mapeByStep,
      rolling_samples_by_step: etsH.samplesByStep,
      // 线性专有口径（一次切分验证 / 偏差校正）不适用于 ETS 路径——置 null 不伪造（04-B7）
      validation_overall_mape: null,
      bias: null,
      correction_factor: null,
    }
  } else {
    // 保留线性基线：以下为原实现，逐字不动
    const allModel = buildModel(historical)
    if (!allModel) return null

    predictions = []
    const forecastStartIdx = allModel.n
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

    backtest = {
      selected_model: 'linear',
      validation_overall_mape: Math.round(overallMAPE * 100) / 100,
      validation_months: testPreds.length,
      rolling_mape_by_step: rolling.mapeByStep,
      rolling_samples_by_step: rolling.cntByStep,
      bias,
      correction_factor: Math.round(correctionFactor * 10000) / 10000,
    }
  }

  const modelComparison = {
    protocol: `滚动原点 origin ${ROLLING_START}~${ROLLING_END}，horizon ${ROLLING_HORIZON}，训练<origin，无校正防泄漏`,
    linear: {
      overall_mape: linH.overallMape,
      overall_mase: linH.overallMase,
      mape_by_step: linH.mapeByStep,
      mase_by_step: linH.maseByStep,
    },
    ets_damped: {
      overall_mape: etsH.overallMape,
      overall_mase: etsH.overallMase,
      mape_by_step: etsH.mapeByStep,
      mase_by_step: etsH.maseByStep,
      params: etsFitInfo ? etsFitInfo.params : null,
      seasonal_type: etsFitInfo ? etsFitInfo.seasonal_type : null,
    },
    seasonal_naive: {
      overall_mape: snH.overallMape,
      overall_mase: snH.overallMase,
      mape_by_step: snH.mapeByStep,
      mase_by_step: snH.maseByStep,
    },
    selected,
    gate: 'ETS 须同时严格优于线性基线与季节朴素基准（全步长平均 MAPE），否则保留线性',
  }

  return {
    backtest,
    modelComparison,
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
        method: 'baseline_linear_vs_cny_adjusted_damped_holt_winters_with_gate',
        indicator: ind.id,
        data_source: ind.source,
        training_period: '2021-01 ~ 2024-12',
        validation_period: '2025-01 ~ 2026-06',
        rolling_backtest: `origin ${ROLLING_START} ~ ${ROLLING_END}，horizon ${ROLLING_HORIZON} 个月`,
        forecast_period: '2026-07 ~ 2035-12',
        model_selection: {
          judge_metric: '滚动回测全步长（h1-12）平均 MAPE',
          rule: 'ETS 须同时严格优于线性基线与季节朴素基准，否则保留线性（诚实降级）',
          per_port_winner: '见 ports.*.backtest.selected_model 与 ports.*.model_comparison',
        },
        canal_assumption:
          '未建模平陆运河（2026-09-16 已通航，预测=无运河反事实基线；情景层待工单 F3 落地）',
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
          model_comparison: result.modelComparison,
          predictions: result.predictions,
        }
        const bt = result.backtest
        const mc = result.modelComparison
        console.log(`${PORT_NAMES[portId]} (${portId}):`)
        console.log(`  闸门胜者: ${bt.selected_model}`)
        if (bt.selected_model === 'linear') {
          console.log(
            `  验证期(2025-01~2026-06) MAPE: ${bt.validation_overall_mape}%  bias=${bt.bias}`
          )
        }
        console.log(
          `  同协议对比（全步长平均 MAPE / MASE）: ` +
            `linear=${mc.linear.overall_mape}%/${mc.linear.overall_mase}  ` +
            `ets=${mc.ets_damped.overall_mape}%/${mc.ets_damped.overall_mase}  ` +
            `seasonal_naive=${mc.seasonal_naive.overall_mape}%/${mc.seasonal_naive.overall_mase}`
        )
        console.log(
          `  所选模型分步长 MAPE: ` +
            Object.entries(bt.rolling_mape_by_step)
              .map(([s, v]) => `s${s}=${v === null ? 'n/a' : v + '%'}`)
              .join(' ')
        )
        if (bt.selected_model === 'linear') {
          console.log(`  Correction factor: ${bt.correction_factor}`)
        }
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
