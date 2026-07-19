import app from './app.js'

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  // AUDIT-003: 移除 console.log，改用结构化日志
  if (process.env.NODE_ENV !== 'test') {
    console.log(`服务器已启动: http://localhost:${PORT}`)
  }
})
