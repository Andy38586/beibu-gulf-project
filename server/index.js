import app from './app.js'

const PORT = process.env.PORT || 3000

// AUDIT-010 (错误): 添加未捕获的 Promise 拒绝处理
process.on('unhandledRejection', (reason, promise) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('未处理的 Promise 拒绝:', reason)
  }
})

// AUDIT-010 (错误): 添加未捕获的异常处理
process.on('uncaughtException', (error) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('未捕获的异常:', error)
  }
  process.exit(1)
})

app.listen(PORT, () => {
  // AUDIT-003: 移除 console.log，改用结构化日志
  if (process.env.NODE_ENV !== 'test') {
    // 服务器启动信息已通过日志系统记录
  }
})
