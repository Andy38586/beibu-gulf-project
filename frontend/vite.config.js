import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import cesium from 'vite-plugin-cesium'
import vueDevTools from 'vite-plugin-vue-devtools'

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
    },
  }
}

export default defineConfig(({ mode, command }) => {
  // 本地 dev 下，Vite 把 /api、/nest-api、/flood-online 转发到本机回环后端。
  // 若系统开着 Clash/V2Ray 并设置了 HTTP(S)_PROXY/ALL_PROXY（且 NO_PROXY 未覆盖回环），
  // http-proxy 会把「到 127.0.0.1 后端」的请求也发给代理，代理无法回源回环 → 固定 ~2s 后 502，
  // 而直连后端正常，极易误判成「后端挂了/服务器无响应」。dev 的上游全是本机，直接移除上游
  // 代理变量，与系统代理是否开启彻底解耦；仅 serve 生效，build（CI/打包）不受影响。
  if (command === 'serve') {
    for (const k of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete process.env[k]
    }
  }
  return {
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
        cesiumBuildRootPath: fileURLToPath(
          new URL('../node_modules/cesium/Build', import.meta.url)
        ),
        cesiumBuildPath: fileURLToPath(
          new URL('../node_modules/cesium/Build/Cesium/', import.meta.url)
        ),
      }),
      removeCesiumHtmlTags(),
      // 打包分析：仅在 --mode analyze 时生成 dist/stats.html 并自动打开浏览器
      // 避免每次 build 无条件产出 ~1.3MB 分析文件随产物部署
      // （旧实现读 process.env.ANALYZE，需 Windows-only 的 set/cross-env；mode 方案全平台一致）
      ...(mode === 'analyze'
        ? [
            visualizer({
              open: true,
              gzipSize: true,
              brotliSize: true,
              filename: 'dist/stats.html',
            }),
          ]
        : []),
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
      // 构建前清空输出目录，避免历史 chunk 堆积（816-M7：恢复 emptyOutDir:true，与 z021 决案一致）。
      // 注：本地 Windows 上 WorkBuddy safe-delete 可能拦截批量 trash，属本地工具行为；
      // 部署一律以 CI（Linux）fresh 构建产物为准，本地构建前可手动清理 dist。
      emptyOutDir: true,
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
              // c011 已知权衡：110KB gzip 为按需打包真实代价（ElSelect/ElSlider/ElMessage 依赖树），
              // 非全量引入。若后续压首屏，可细分 ui-vendor 或换轻量组件。
              if (id.includes('/element-plus/') || id.includes('/@element-plus/'))
                return 'ui-vendor'
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
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        // Nest 业务层（后端本体，Express 退役后端口回切 3000，T6.3）；全局前缀 nest-api 与 /api 平行，
        // 逐模块切换后前端请求经此转发到 Nest（无 rewrite，nest 自身路由就是 /nest-api/*）
        '/nest-api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        // DEM 派生产物（hillshade COG / terrain 瓦片）由后端 static 托管
        '/static': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        // target 用 127.0.0.1 显式 IPv4 回环，避免 localhost 解析到 ::1 的歧义（3000 同理）。
        // 502 主因（系统代理劫持回环转发）已在本文件顶部 command==='serve' 时移除 *_PROXY 解决。
        // 2026-09-11：删除 /flood-online 代理——algorithm-service 已退役（2026-09-10 阶段 4），
        // 前端 ENDPOINTS 零调用（flood/route 域均切 Nest），此前 nginx 两处已删、仅剩此处。
      },
    },
  }
})
