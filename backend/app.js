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

// trust proxy：生产经 nginx 反代时不信任代理会让 rateLimit 按 127.0.0.1 统一计数（限流失效）。
// 显式判断非负有限值原样生效、否则默认 1——不能用 `Number(...) || 1`，它无法表达"不信任代理"（0 是 falsy）
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS)
app.set('trust proxy', Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1)

// 安全中间件：设置 HTTP 安全头
app.use(helmet())

// 健康检查端点（置于限流器之前，避免探针触发限流）
app.get('/api/health', (req, res) => {
  sendSuccess(res, { status: 'ok' })
})

// liveness 只探进程存活；readiness 查关键依赖（数据目录可读），供编排器/HEALTHCHECK 使用
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

// 限流：防暴力破解/DDoS。演示场景阈值放宽（1000/15min），真实多人上线再收紧。
// 预测分析接口为合法高频交互（时间轴播放一轮 ~400+ 请求），豁免全局限流
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 1000, // 每个 IP 最多 1000 次请求
  message: { error: '请求过于频繁，请稍后再试' },
  // 注意：app.use('/api/', ...) 内 req.path 已去掉 /api/ 前缀，须用 originalUrl 判断
  skip: (req) => req.originalUrl.startsWith('/api/forecast'),
})
app.use('/api/', limiter)

// 预测接口专属宽松限流：一轮播放 ~432 请求，只读无爆破风险；前端另有缓存，实际远低于上限
const forecastLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api/forecast', forecastLimiter)

// 登录接口限流（演示放宽，避免试错被锁 15 分钟）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 50, // 每个 IP 最多 50 次登录尝试
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
})
app.use('/api/auth/login', authLimiter)

// 注册接口专属限流（防批量注册；演示放宽）
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: '注册尝试过于频繁，请 15 分钟后再试' },
})
app.use('/api/auth/register', registerLimiter)

// CORS origin 从环境变量读取（逗号分隔多源）；生产禁止 localhost 回退（[1.6]）——
// 生产同域部署（nginx 反代 /api）本不需要 CORS，跨域来源必须显式配置，缺失即拒绝跨域
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : process.env.NODE_ENV === 'production'
    ? false
    : 'http://localhost:5173'
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// 请求日志：仅 dev 输出，请求体经 sanitize 脱敏（敏感字段打码）
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

// 静态资源托管（DEM 派生产物等）；.terrain 是 gzip 压缩流，须声明 Content-Encoding: gzip，
// 否则 CesiumTerrainProvider 解压失败（Invalid typed array length）
app.use(
  '/static',
  express.static(join(__dirname, 'static'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.terrain')) {
        res.setHeader('Content-Encoding', 'gzip')
      }
    },
  })
)

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

// 全局错误处理：未捕获异常不泄露堆栈信息
app.use((err, req, res, _next) => {
  // BusinessError（业务错误类，携带 code + status）按码返回对应 HTTP 状态码；
  // 预期错误落 warn 日志便于生产排查，不记堆栈避免噪音
  if (err instanceof BusinessError) {
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
