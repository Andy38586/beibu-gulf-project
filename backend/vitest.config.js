import { defineConfig } from 'vitest/config'

// 后端测试运行在 Node 环境（HTTP 路由 / 文件 IO mock），
// 与 frontend 的 jsdom 配置隔离，独立配置避免误解析 @ 别名。
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.js'],
  },
})
