import app from './app.js'
import { logger } from './utils/logger.js'

const PORT = process.env.PORT || 3000

// @arch-note 010: 添加未捕获的 Promise 拒绝处理
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('未处理的 Promise 拒绝:', reason)
})

// @arch-note 010: 添加未捕获的异常处理
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error)
  process.exit(1)
})

const server = app.listen(PORT, () => {
  logger.info(`服务器已启动，端口 ${PORT}`)
})

// === Graceful Shutdown：Docker stop 发 SIGTERM，确保进行中的请求完成后再退出 ===
function gracefulShutdown(signal) {
  logger.info(`收到 ${signal}，开始优雅关停...`)
  server.close(() => {
    logger.info('HTTP 服务器已关闭，所有连接已排干')
    process.exit(0)
  })
  // 强制超时：10s 后仍未关闭则强退
  setTimeout(() => {
    logger.error('优雅关停超时，强制退出')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
