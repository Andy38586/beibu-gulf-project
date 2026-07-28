# 构建体积与性能分析

> 最后更新：2026-07-27 | 构建工具：Vite 8 + Rolldown

---

## 一、构建产物概览

### Vite 分包 Chunks

| Chunk | 大小（未压缩） | Gzip | 说明 |
|-------|--------------|------|------|
| `ui-vendor` | 999 KB | 320 KB | Element Plus UI 组件库 |
| `echarts` | 551 KB | 185 KB | ECharts 图表库（动态导入） |
| `openlayers` | 426 KB | 121 KB | OpenLayers 2D 地图引擎 |
| `index` | 40 KB | 14 KB | 入口 + 业务代码 |
| `vue-vendor` | 29 KB | 12 KB | Vue 3 + Router + Pinia |
| `AppLayout` | 24 KB | 9 KB | 布局组件 |
| 其他路由页面 | ~60 KB | ~22 KB | 3 个业务模块 + Profile |
| `ui-vendor` CSS | 366 KB | 48 KB | Element Plus 样式 |

### Cesium 静态资源（非 Vite 打包）

| 文件 | 大小 | 说明 |
|------|------|------|
| `Cesium.js` | 5.7 MB | 主库（非压缩版） |
| Workers/ | ~1.1 MB | Web Workers |
| Assets/ | ~4.8 MB | 纹理、地形数据 |
| Widgets/ | ~0.4 MB | UI 控件样式和图片 |
| ThirdParty/ | ~0.3 MB | 第三方依赖 |
| **合计** | **~14 MB** | 整个 `dist/cesium/` 目录 |

---

## 二、首屏加载分析

### 加载链路（优化后）

```
index.html
├── <link rel="modulepreload" href="openlayers">  ← 426KB，预加载
├── <link rel="modulepreload" href="ui-vendor">    ← 999KB，预加载
├── <link rel="modulepreload" href="vue-vendor">   ← 29KB，预加载
├── <link rel="modulepreload" href="logger">       ← 1KB
├── <link rel="stylesheet" href="ui-vendor.css">   ← 366KB
├── <link rel="stylesheet" href="index.css">       ← 3KB
└── <script type="module" src="index.js">          ← 41KB，入口
```

**首屏总加载量：~1.9MB（gzip ~523KB）**

> 3D 视图切换时，`renderers/index.js` 中的 `ensureCesiumLoaded()` 动态注入 `<script src="/cesium/Cesium.js">`（5.7MB），仅首次切换 3D 时加载。

### 优化措施

1. **Cesium 懒加载**（✅ 已解决，2026-07-27）
   - 方案：`vite.config.js` 中 `removeCesiumHtmlTags()` post-plugin 移除 vite-plugin-cesium 注入的 HTML 标签
   - 运行时：`renderers/index.js` 中 `ensureCesiumLoaded()` 在切 3D 时动态注入 `<script>` 标签
   - 效果：首屏减少 5.7MB，从 7.5MB → 1.9MB（↓75%）

2. **OpenLayers 预加载**（P1）
   - OL 代码（426KB）被标记为 `modulepreload`
   - 首屏大概率需要 OL，预加载合理
   - 但如果首屏不是地图页面，这里就浪费了

3. **Element Plus 样式体积大**（P2）
   - `ui-vendor` CSS 366KB，gzip 后 48KB
   - 如果按需引入 Element Plus 组件可以减小

### 构建时间

- 总构建时间：3.56s（2532 模块）
- **82%** 时间消耗在 `rollup-plugin-external-globals`（vite-plugin-cesium 的依赖）
  - 该插件将 Cesium 的 ESM import 转换为全局变量引用
  - 每次构建都要处理 Cesium 的数千个模块

---

## 三、分包策略

### 当前配置（vite.config.js）

```js
manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/pinia/'))
      return 'vue-vendor'
    if (id.includes('/element-plus/') || id.includes('/@element-plus/'))
      return 'ui-vendor'
    if (id.includes('/ol/'))     return 'openlayers'
    if (id.includes('/cesium/')) return 'cesium'        // ⚠️ 实际上不生效
    if (id.includes('/echarts/')) return 'echarts'
    if (id.includes('/@turf/'))  return 'turf'
  }
}
```

### Cesium 分包的特殊情况

`vite-plugin-cesium` 通过 `rollup-plugin-external-globals` 将 Cesium 标记为 external，不会打入 Vite chunk。`manualChunks` 中的 `cesium` 规则是冗余的（无实际效果），但保留作为文档意图。

实际的 Cesium 加载策略：
- 构建时：`vite-plugin-cesium` 复制 `node_modules/cesium/Build/Cesium/` → `dist/cesium/`
- 构建时：`removeCesiumHtmlTags()` post-plugin 移除 vite-plugin-cesium 注入的 HTML 标签
- 运行时：`renderers/index.js` 中的 `ensureCesiumLoaded()` 在首次切 3D 时动态注入 `<script src="/cesium/Cesium.js">`
- CesiumRenderer 本身（13KB）仍然通过动态导入按需加载

---

## 四、动态导入状态

| 模块 | 导入方式 | 实际效果 |
|------|----------|----------|
| CesiumRenderer | `await import('./CesiumRenderer')` | ✅ 13KB 渲染器按需加载 |
| Cesium 库 | `renderers/index.js` 动态注入 script | ✅ 5.7MB 仅切 3D 时加载 |
| ECharts | 通过 ForecastPage 动态导入 | ✅ 仅预测页面加载 |
| OpenLayers | 首屏静态导入 | ⚠️ 426KB 预加载 |
| Turf.js | 按需 | ✅ 分析功能触发时才加载 |

---

## 五、优化建议

### P0：Cesium 懒加载 ✅ 已完成（2026-07-27）

通过 `vite.config.js` 中 `removeCesiumHtmlTags()` post-plugin + `renderers/index.js` 中 `ensureCesiumLoaded()` 实现。首屏减少 5.7MB（7.5MB → 1.9MB），10Mbps 网络下首帧约 1.5s。

### P1：Element Plus 按需引入

当前 `ui-vendor` 999KB（gzip 320KB），如果改为按需引入可减半。

方案：使用 `unplugin-vue-components` + `unplugin-element-plus`。

### P2：Cesium 使用压缩版

当前 `dist/cesium/Cesium.js` 是 5.7MB 非压缩版。可以使用 `CesiumUnminified` → `Cesium` 切换，或配置 CDN 加载 gzip/brotli 版本。

---

## 六、分析工具

```bash
# 生成 stats.html（构建体积可视化）
npm run build:analyze

# 文件位置
dist/stats.html
```

---

## 七、面试话术

> "项目的构建体积优化做了以下工作：
>
> 1. **分包策略**：通过 Vite 的 `manualChunks` 将 Vue 运行时、Element Plus、OpenLayers、ECharts 分别拆成独立 chunk，利用浏览器缓存；业务代码只有 40KB
> 2. **动态导入**：Cesium 3D 渲染器通过 `await import()` 按需加载，ECharts 只在预测分析页面加载
> 3. **打包分析**：集成 `rollup-plugin-visualizer`，每次 `npm run build:analyze` 生成可视化报告，持续监控体积变化
> 4. **已知改进点**：当前 `vite-plugin-cesium` 在 head 中静态注入 Cesium 脚本，计划改为运行时动态加载，进一步将首屏体积从 7MB 降至 1.5MB"
