import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import cesium from 'vite-plugin-cesium'
import { visualizer } from 'rollup-plugin-visualizer'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/**
 * 移除 vite-plugin-cesium 自动注入的 Cesium script/css 标签
 *
 * vite-plugin-cesium 负责两件事：
 * 1. 复制 Cesium 静态文件到 dist/cesium/         ← 保留
 * 2. 将 cesium ESM import 转为 window.Cesium 引用  ← 保留
 * 3. 注入 <script src="/cesium/Cesium.js"> 到 HTML ← 移除
 *
 * 移除原因：5.7MB 同步加载阻塞首帧，改为运行时在切 3D 时才动态加载。
 */
function removeCesiumHtmlTags() {
  return {
    name: 'remove-cesium-html-tags',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<link rel="stylesheet" href="\/cesium\/Widgets\/widgets\.css">\s*/g, '')
        .replace(/<script src="\/cesium\/Cesium\.js"><\/script>\s*/g, '')
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    // node_modules 实际位于项目根（frontend/ 的上一级）。本配置随 vite 以 cwd=frontend 运行，
    // 插件默认按 cwd 拼接 node_modules/cesium，会导致 dev/构建都找不到 Cesium 静态资源。
    // 故显式用绝对路径指向真实位置。
    cesium({
      cesiumBuildRootPath: fileURLToPath(new URL('../node_modules/cesium/Build', import.meta.url)),
      cesiumBuildPath: fileURLToPath(new URL('../node_modules/cesium/Build/Cesium/', import.meta.url)),
    }),
    removeCesiumHtmlTags(),
    // 打包分析：生成 dist/stats.html，ANALYZE=true 时自动打开浏览器
    visualizer({
      open: process.env.ANALYZE === 'true',
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 构建目标：现代浏览器，支持动态导入
    // 升级到 es2020：项目大量使用可选链 ?. / 空值合并 ??，无需降级语法，产物更小、性能更好
    target: 'es2020',
    // 输出目录
    outDir: 'dist',
    // 不自动清空输出目录（sandbox 安全机制冲突，由外部手动清理）
    emptyOutDir: false,
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
            // Element Plus UI 组件库
            if (id.includes('/element-plus/') || id.includes('/@element-plus/')) return 'ui-vendor'
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
