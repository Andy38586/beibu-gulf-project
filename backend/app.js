import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import markersRouter from './routes/markers.js'
import facilitiesRouter from './routes/facilities.js'
import siteAnalysisRouter from './routes/siteAnalysis.js'
import authRouter from './routes/auth.js'
import plansRouter from './routes/plans.js'
import forecastRouter from './routes/forecast.js'
import floodRouter from './routes/floodAnalysis.js'
import portsRouter from './routes/ports.js'
import { BusinessError } from './utils/BusinessError.js'
import { logger } from './utils/logger.js'
import { sendSuccess } from './utils/response.js'

const app = express()

// 安全中间件：设置 HTTP 安全头
app.use(helmet())

// 健康检查端点（置于限流器之前，避免探针触发限流）
app.get('/api/health', (req, res) => {
  sendSuccess(res, { status: 'ok' })
})

// 限流中间件：防止暴力破解和 DDoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 每个 IP 最多 100 次请求
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api/', limiter)

// 登录接口更严格的限流
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 5, // 每个 IP 最多 5 次登录尝试
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
})
app.use('/api/auth/login', authLimiter)

// 注册接口专属限流（d037：防批量注册）
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '注册尝试过于频繁，请 15 分钟后再试' },
})
app.use('/api/auth/register', registerLimiter)

// @arch-note P1-004: CORS origin 从环境变量读取，支持生产部署
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use('/api/markers', markersRouter)
app.use('/api/facilities', facilitiesRouter)
app.use('/api/site-analysis', siteAnalysisRouter)
app.use('/api/auth', authRouter)
app.use('/api/plans', plansRouter)
app.use('/api/forecast', forecastRouter)
app.use('/api/flood', floodRouter)
app.use('/api/ports', portsRouter)

// [FIXED 009] 404错误处理中间件
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// @arch-note P1-003: 全局错误处理中间件，防止未捕获异常泄露堆栈信息
app.use((err, req, res, _next) => {
  // BusinessError 统一携带 code + status，按码返回对应 HTTP 状态码
  if (err instanceof BusinessError) {
    return res.status(err.status).json({ code: err.code, error: err.message })
  }
  // [FIXED 016] 仅在开发环境输出详细错误
  logger.error('未捕获的服务器错误:', err.message)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  })
})

export default app
