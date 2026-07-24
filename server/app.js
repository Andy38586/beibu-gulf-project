import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import markersRouter from './routes/markers.js'
import facilitiesRouter from './routes/facilities.js'
import siteAnalysisRouter from './routes/siteAnalysis.js'
import authRouter from './routes/auth.js'
import plansRouter from './routes/plans.js'
// TODO:1.2: 注册预测分析路由
import forecastRouter from './routes/forecast.js'
import gcsRouter from './routes/gcs.js'

const app = express()

// P1-004-FIX: CORS origin 从环境变量读取，支持生产部署
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())
app.use('/api/markers', markersRouter)
app.use('/api/facilities', facilitiesRouter)
app.use('/api/site-analysis', siteAnalysisRouter)
app.use('/api/auth', authRouter)
app.use('/api/plans', plansRouter)
// TODO:1.2: 注册预测分析路由
app.use('/api/forecast', forecastRouter)
app.use('/api/gcs', gcsRouter)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// FIX:009 (错误): 404错误处理中间件
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// P1-003-FIX: 全局错误处理中间件，防止未捕获异常泄露堆栈信息
app.use((err, req, res, next) => {
  // FIX:016: 仅在开发环境输出详细错误
  if (process.env.NODE_ENV !== 'test') {
    console.error('未捕获的服务器错误:', err.message)
  }
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  })
})

export default app
