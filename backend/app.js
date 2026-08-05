import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import { readdir } from 'fs/promises'
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
const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

// trust proxy — 生产部署经 nginx 反代，若未信任代理，
// rateLimit 按 127.0.0.1 统一计数 → 登录/全局限流形同虚设（所有人共享同一 IP 配额）。
// 数字 1 = 信任最近 1 跳代理（nginx）。直接反代部署（无 nginx）时不受影响（req.ip=直连 IP）。
// 原 `Number(...) || 1` 对 "0" 失效（Number("0")=0 为 falsy → 回落 1），
// 无法表达"不信任代理"。改为显式判断：非负有限值原样生效，否则默认 1。
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS)
app.set('trust proxy', Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1)

// 安全中间件：设置 HTTP 安全头
app.use(helmet())

// 健康检查端点（置于限流器之前，避免探针触发限流）
app.get('/api/health', (req, res) => {
  sendSuccess(res, { status: 'ok' })
})

// liveness（/api/health）保持极简（进程活）；
// readiness（/api/health/ready）查关键依赖（数据目录可读性），供编排器/HEALTHCHECK 探就绪。
export async function checkDataDirReadable() {
  try {
    await readdir(join(__dirname, 'data'))
    return true
  } catch {
    return false
  }
}

export async function readinessHandler(req, res, next) {
  try {
    const checks = { dataDir: await checkDataDirReadable() }
    const ready = Object.values(checks).every(Boolean)
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      checks,
    })
  } catch (e) {
    next(e)
  }
}

app.get('/api/health/ready', readinessHandler)

// 限流中间件：防止暴力破解和 DDoS
// 预测分析接口（/api/forecast/*）为合法高频交互（时间轴播放月粒度一轮 ~400+ 请求，
// 拖动滑块/置信度反复触发），豁免全局限流，由下方 forecastLimiter 专属宽松限流管理。
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 每个 IP 最多 100 次请求
  message: { error: '请求过于频繁，请稍后再试' },
  // 注意：app.use('/api/', ...) 内 req.path 已去掉 /api/ 前缀，须用 originalUrl 判断
  skip: (req) => req.originalUrl.startsWith('/api/forecast'),
})
app.use('/api/', limiter)

// 预测分析接口专属宽松限流：一轮月粒度播放 ~216 时间点 × 2 接口 ≈ 432 请求，
// 全局限流 100/15min 必触发；分析接口只读、无认证爆破风险，500/15min 足够单用户正常使用
// （前端另有 LRU 缓存：重放/往返命中缓存零请求，实际播放轮次远低于上限）。
const forecastLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api/forecast', forecastLimiter)

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

// CORS origin 从环境变量读取，支持生产部署
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// 请求日志中间件（仅打日志、不修改请求）。
// dev 下输出 方法/路径/状态码/耗时，请求体经 sanitize 脱敏（password/token/secret 打码）。
// 生产环境 debug 静默，不输出请求日志。
import { sanitize } from './middleware/logSanitizer.js'
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    if (isDev) {
      logger.debug(
        `[req] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`,
        sanitize(req.body)
      )
    }
  })
  next()
})

// 静态资源托管：DEM 派生产物（hillshade COG、terrain 瓦片），供前端 /static/dem/* 访问
// 真数据统一放后端，便于未来移交 PostGIS/PgSQL
app.use('/static', express.static(join(__dirname, 'static')))

app.use('/api/site-analysis', siteAnalysisRouter)
app.use('/api/auth', authRouter)
app.use('/api/plans', plansRouter)
app.use('/api/forecast', forecastRouter)
app.use('/api/flood', floodRouter)
app.use('/api/ports', portsRouter)

// 404错误处理中间件
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// 全局错误处理中间件，防止未捕获异常泄露堆栈信息
app.use((err, req, res, _next) => {
  // BusinessError 统一携带 code + status，按码返回对应 HTTP 状态码
  if (err instanceof BusinessError) {
    // z072: 业务错误也落 warn 日志（生产可观测——此前业务错误不落日志,线上排查无据）
    // 仅记 code/status/message,不记堆栈(预期错误,避免噪音)
    logger.warn(`[BusinessError] ${err.status} ${err.code}: ${err.message}`)
    return res.status(err.status).json({ code: err.code, error: err.message })
  }
  // 仅在开发环境输出详细错误
  logger.error('未捕获的服务器错误:', err.message)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  })
})

export default app
