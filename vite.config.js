import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [vue(), vueDevTools(), cesium()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 构建目标：现代浏览器，支持动态导入
    target: 'es2015',
    // 输出目录
    outDir: 'dist',
    // 启用源码映射（生产环境可关闭）
    sourcemap: false,
    // 压缩选项（Vite 8 默认使用 rolldown 内置压缩，无需单独指定 esbuild）
    minify: true,
    // Rollup 分包配置
    rollupOptions: {
      output: {
        // 手动分包：将大型依赖单独打包（Vite 8/rolldown 要求函数形式）
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Vue 核心库
            if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/pinia/')) {
              return 'vue-vendor'
            }
            // OpenLayers 地图库
            if (id.includes('/ol/')) return 'openlayers'
            // Cesium 3D 地图库
            if (id.includes('/cesium/')) return 'cesium'
            // ECharts 图表库
            if (id.includes('/echarts/')) return 'echarts'
            // Turf.js 地理空间分析
            if (id.includes('/@turf/')) return 'turf'
          }
        },
        // 资源文件命名
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // 代码分割阈值（超过 10KB 的 chunk 单独打包）
    chunkSizeWarningLimit: 1000,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
