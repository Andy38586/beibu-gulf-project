# WebGIS 开发全栈学习路线图

> **目标岗位**: WebGIS 开发工程师（第一志愿）→ 前端开发（第二志愿）→ 全栈偏前端（第三志愿）
> **基准项目**: 北部湾港 WebGIS 智慧分析平台（双引擎 OL+Cesium）
> **学习理念**: 每一章结束你都能回头审视北部湾项目，理解当初为什么那么写、现在可以怎么改
> **四级制**: 第一级 = 前端工程基础 → 第二级 = WebGIS 核心技术 → 第三级 = 全栈工程能力 → 第四级 = GIS 数据工程

---

## 第一级：前端工程基础

> 目标：能独立用 Vue 3 + TypeScript + Vite 搭建一���前端项目，理解浏览器渲染原理

---

### 第一章 HTML5 & CSS3

**学习目标**: 掌握语义化 HTML 结构、CSS 布局体系（Flexbox / Grid / 定位）、CSS 自定义属性

**核心知识点**:

- HTML5 语义化标签（`<article>` `<section>` `<nav>` `<aside>`）
- CSS 盒模型（content-box vs border-box）
- Flexbox 完整属性集（justify-content / align-items / flex / gap）
- CSS Grid（grid-template-columns / grid-area / fr 单位）
- 定位体系（relative / absolute / fixed / sticky）、层叠上下文（z-index）
- CSS 自定义属性（`:root` + `var()`）——你在北部湾项目中刚做完这个
- 响应式设计（@media 断点、clamp() / min() / max()）
- `backdrop-filter` / `pointer-events: none` —— GCS 面板系统的核心 CSS
- 选择器特异性（specificity）计算

**与项目关联**:

- 打开 `src/style.css` 看 `:root` 中的 `--gcs-*` 变量，这就是本章的核心产出
- 打开 `GcsPanel.vue` 的 `<style scoped>`，理解为什么 `pointer-events: auto`
- 打开 `AppLayout.vue` 看 Flexbox slot 布局

**实践项目**: 手写一个响应式 Dashboard 布局（不依赖任何 UI 库），包含顶栏、侧栏、主内容区

**验收标准 ✅**:

- [ ] 能用 Flexbox 实现水平/垂直居中、等分布局、圣杯布局
- [ ] 能用 CSS Grid 实现 12 列网格系统
- [ ] 能写 5 个以上 `var(--xxx)` 的 CSS 变量并跨组件复用
- [ ] 能解释 `z-index` 的层叠上下文规则
- [ ] 能解释北部湾项目中 `pointer-events: none` + `:deep(.gcs-panel) { pointer-events: auto }` 为什么这样写

**预估学时**: 20h（已有基础 8h）

---

### 第二章 JavaScript (ES6+)

**学习目标**: 掌握现代 JS 核心语法、异步编程、模块化、闭包与作用域

**核心知识点**:

- let / const vs var（块级作用域、暂时性死区）
- 箭头函数、解构赋值、展开运算符、模板字符串
- Promise / async-await / try-catch
- `AbortController` —— `useApiRequest.ts` 里的超时机制
- Map / Set / WeakMap —— `forecastState.ts` 用 Map 做数据缓存
- 可选链 `?.` 和空值合并 `??` —— 项目中大量 `item.lng ?? item.lon ?? 0`
- 模块系统（ESM import/export）
- 闭包、执行上下文、事件循环（Event Loop）
- `typeof` / `instanceof` / 类型判断
- `EventTarget` / `CustomEvent` —— `MapRenderer.js` 的事件总线

**实践项目**: 用纯 JS 实现一个带超时取消的请求管理器（参考 `<AbortController>` 模式）

**验收标准 ✅**:

- [ ] 能手写 3 种异步模式：callback → Promise → async-await（都能正确错误处理）
- [ ] 能解释 `??` vs `||` 的区别（项目中有 `item.lng ?? item.lon ?? 0` 为什么不用 `||`）
- [ ] 能解释 Event Loop 的执行顺序（微任务 vs 宏任务）
- [ ] 能写一个 EventTarget 的事件总线

**预估学时**: 30h（已有基础 15h）

---

### 第三章 TypeScript

**学习目标**: 能用 TS 写出类型安全的代码，定义接口、泛型、类型守卫

**核心知识点**:

- 基础类型注解（`string` / `number` / `boolean` / `Array<T>` / `Record<K,V>`）
- interface vs type 的区别和使用场景
- 泛型（`<T>`���—— `usePageStateStore<T>` 的泛型模式
- 联合类型 `|` 和交叉类型 `&`
- 类型守卫（`typeof` / `instanceof` / `in` / 自定义 type predicate）
- `Pick` / `Omit` / `Partial` / `Required` 工具类型
- `unknown` vs `any` —— 项目规范禁止 `any`，为什么
- `as const` / `satisfies` 操作符
- 声明文件 `.d.ts` —— `renderers.d.ts` 的写法
- `import type` vs 普通 `import`

**与项目关联**:

- 打开 `src/types/` 目录 —— 7 个类型文件是你写的第一个数据契约
- 打开 `src/types/renderer.ts` 看 `MapRenderer` 接口的完整定义
- 打开 `src/stores/map.ts` 看 `Ref<MapType>` / `ShallowRef<MapRenderer | null>` 的类型用法

**实践项目**: 给北部湾项目新增一个类型文件 `src/types/business/route.ts`（航线分析），定义航线相关的 3 个 interface，零 `any`

**验收标准 ✅**:

- [ ] 能定义带泛型的 interface（如 `GcsFeature<T>`）
- [ ] 能把项目中任意一个 `any` 改成具体类型并解释替换逻辑
- [ ] 能写一个 `.d.ts` 文件给现有的 `.js` 模块声明类型
- [ ] 能解释 `unknown` 比 `any` 安全在哪里（至少举出 2 个场景）
- [ ] 能用工具类型从已有 interface 派生出新类型（`Pick`/`Omit`/`Partial`）

**预估学时**: 25h（已有基础 12h）

---

### 第四章 Vue 3 生态

**学习目标**: 掌握 Vue 3 Composition API、Pinia 状态管理、Vue Router、组件通信模式

**核心知识点**:

_Composition API:_

- `ref` / `reactive` / `shallowRef` —— 项目 stores 用 `shallowRef` 存 `MapRenderer`
- `computed` / `watch` / `watchEffect`
- `onMounted` / `onUnmounted` / `onBeforeRouteLeave`
- `provide` / `inject` —— 项目中 App.vue → useLayerManager 的依赖注入
- `<script setup lang="ts">` 语法
- `defineProps` / `defineEmits` / `defineExpose`

_Pinia:_

- Setup Store 语法（你的项目 9 个 Store 全部用的这种）
- Store 之间的相互引用（`gcsStore` 引用 4 个子 Store）
- 持久化策略（你的 `map.ts` 用 localStorage + sessionStorage 手动管理）

_Vue Router:_

- 路由配置 `meta.engine` —— 你的项目 2D/3D 引擎切换
- 导航守卫 `onBeforeRouteLeave`
- 动态路由、命名路由

_组件模式:_

- Slot 插槽（`<template #left>` / `<template #right>`）
- `:deep()` / `:slotted()` —— scoped style 穿透
- `v-bind()` in `<style>` —— GCS 的动态 Cell 尺寸
- Transition / TransitionGroup

**与项目关联**:

- 打开 `src/stores/map.ts` 通读一遍，你现在能完整理解每一行的类型、为什么用 `shallowRef`
- 打开 `App.vue` 看 `provide/inject` 的完整链路
- 打开 `AppLayout.vue` 看 `<slot>` 的用法

**实践项目**: 新建一个 Vue 3 项目，实现：列表页 + 详情页 + Pinia Store + 搜索过滤 + 路由切换

**验收���准 ✅**:

- [ ] 能解释 `ref` vs `reactive` vs `shallowRef` 的使用场景和原理
- [ ] 能写一个 Setup Store 并正确导出所有 state + getter + action
- [ ] 能用 `provide/inject` 实现跨层级组件通信（非父子）
- [ ] 能解释 `v-bind()` in `<style>` 的工作原理（GCS 就是用这个做动态尺寸）
- [ ] 能用 `:deep()` 穿透 scoped style

**预估学时**: 40h（已有基础 20h）

---

### 第五章 Vite 工程化

**学习目标**: 理解 Vite 的构建流程、环境变量、路径别名、代码分割

**核心知识点**:

- Vite 的 ESM 开发服务器 vs Rollup 生产构建
- `vite.config.js` 的配置（`resolve.alias` / `server.proxy` / `build.rollupOptions`）
- 环境变量 `VITE_*` 前缀 —— `VITE_API_BASE` 的用法
- 动态 import 代码分割 —— `const Cesium = await import('cesium')`
- `@/` 别名 vs 相对路径 —— 项目规范禁止 `../../../`
- 打包分析（`rollup-plugin-visualizer`）
- Tree-shaking 原理和限制（Cesium 不支持，你知道为什么吗）
- HMR 热更新原理

**与项目关联**:

- 打开 `vite.config.js` 看 `resolve.alias` 设置
- 打开 `package.json` 看 `scripts` 和 `dependencies` 分组
- 跑一次 `npm run build`，看 dist/ 的结构

**实践项目**: 给北部湾项目加一个 `rollup-plugin-visualizer`，分析打包体积

**验收标准 ✅**:

- [ ] 能解释 Vite 开发模式的 ESM 策略和 HMR 原理
- [ ] 能配置路径别名 `@/` 指向 `src/`
- [ ] 能解释动态 import 产生的 chunk 命名规则
- [ ] 能看懂 `dist/` 打包输出，指出最大的 3 个 chunk 是什么
- [ ] 能解释为什么 `echarts` 和 `openlayers` 的打包体积那么大

**预估学时**: 15h

---

### 第六章 浏览器原理与调试

**学习目标**: 理解浏览器渲染管线、DevTools 全套使用、性能分析

**核心知识点**:

- HTML → DOM Tree / CSS → CSSOM → Render Tree → Layout → Paint → Composite
- 重排（reflow）和重绘（repaint）的触发条件
- `transform` / `opacity` 为什么在 composite 层 —— GCS Panel 动画
- Chrome DevTools: Elements / Console / Sources / Network / Performance / Memory
- Network 面板看请求时序、瀑布图
- Performance 面板录帧分析 —— 可以分析 Cesium 的帧率
- `pointer-events: none` 在 GPU 合成层的意义
- 内存泄漏排查（Detached DOM tree）
- 跨域（CORS）和 `credentials: 'include'`

**实践项目**: 用 Performance 面板录制北部湾项目的 2D→3D 引擎切换全过程，找出耗时瓶颈

**验收标准 ✅**:

- [ ] 能用 DevTools Network 面板完整还原一次页面从请求到渲染的全过程
- [ ] 能用 Performance 面板找到页面最慢的渲染帧
- [ ] 能解释 WebGL canvas 的 `pointer-events: none` 为什么对地图交互至关重要
- [ ] 能排查一个内存泄漏场景（在 Memory 面板看 heap snapshot）

**预估学时**: 12h

---

### 🎯 第一级总验收：前端工程基础

在北部湾项目中完成以下 3 件事：

1. **阅读并画图**: 画出 `App.vue → AppLayout → GcsPanel → 业务组件` 的完整组件树，标注每个组件的 props/emits/provide/inject
2. **改动验证**: 新增一个 `<script setup lang="ts">` 的测试组件，用 GcsPanel 包装，挂到 HomePage 的某个 slot 里，正常显示且不破坏其他 Panel 的布局
3. **性能分析**: 用 Performance 面板录制首页加载，标注 Top 3 慢任务

---

## 第二级：WebGIS 开发核心

> 目标：能独立在 OpenLayers 和 Cesium 上开发业务图层，理解空间数据全生命周期

---

### 第七章 GIS 理论基础

**学习目标**: 理解 GIS 核心概念（矢量/栅格/坐标系/投影），能看懂 GeoJSON 和 Shapefile

**核心知识点**:

- 矢量数据模型：Point / LineString / Polygon / Multi-\*
- 栅格数据模型：GeoTIFF / DEM / 遥感影像
- 坐标系：地理坐标系（GCS）vs 投影坐标系（PCS）
- EPSG 编码体系：4326 (WGS84) / 3857 (Web Mercator) / 4490 (CGCS2000)
- 七参数 vs 四参数坐标系转换（北部湾区域用什么参数）
- GeoJSON 规范：Feature / FeatureCollection / Geometry
- WKT / WKB 格式
- 天地图瓦片服务（WMTS）URL 结构
- OGC 标准概览：WMS / WMTS / WFS / WCS

**与项目关联**:

- 打开 `public/data/` 看项目的 GeoJSON 数据文件
- 打开 `src/core/config/map.js` 看天地图的 WMTS URL
- 打开 `src/types/renderer.ts` 看 `PointFeature` / `PolygonFeature` —— 为什么只定义了这两种？

**实践项目**:

1. 用 QGIS 打开一个 GeoJSON 文件，查看坐标系，手动重投影到 3857，对比坐标变化
2. 手写一个 GeoJSON FeatureCollection，包含 Point + Polygon 两种要素

**验收标准 ✅**:

- [ ] 能说出 WGS84 / Web Mercator / CGCS2000 三个坐标系的区别和应用场景
- [ ] 能解释七参数转换和四参数转换分别解决什么问题
- [ ] 能手写一个合法的 GeoJSON FeatureCollection
- [ ] 能解释天地图 WMTS 的 URL 中 `TILEMATRIX` / `TILEROW` / `TILECOL` 的含义
- [ ] 能区分矢量数据和栅格数据在 WebGIS 中的不同渲染方式

**预估学时**: 20h

---

### 第八章 OpenLayers 深度掌握

**学习目标**: 能基于 OpenLayers 搭建 2D 地图引擎，实现瓦片底图、矢量图层、交互控制

**核心知识点**:

_基础:_

- Map / View / Layer / Source 四层架构
- TileLayer + XYZ 瓦片源（接天地图）
- VectorLayer + VectorSource（GeoJSON / 手动构造）
- `ol/proj` 的 `fromLonLat` / `toLonLat` —— 项目中大量使用

_样式:_

- Style / Fill / Stroke / Circle / Text
- StyleFunction（根据 feature 属性动态样式）

_交互:_

- `ol/interaction`：拖拽 / 缩放 / 旋转 / 选择
- 自定义 Interaction

_进阶:_

- 热力图图层（HeatmapLayer）—— 项目预测分析的前置需求
- 聚合图层（Cluster）
- 矢量瓦片（VectorTile）
- 图层组管理和 z-index 控制

**与项目关联**:

- 打开 `src/core/map/renderers/OLRenderer.js` 从头到尾读一遍
- 找到 `addPointLayer` 的实现，理解 Style 是怎么构造的
- 找到 `flyTo` 的实现，理解 `fromLonLat` 转坐标 + `view.animate`

**实践项目**:

1. 独立写一个极简 OL 地图：天地图底图 + 一个 GeoJSON 点图层 + 点击弹 Popup
2. 给北部湾项目的 OLRenderer 新增 `addClusterLayer` 方法

**验收标准 ✅**:

- [ ] 能用 OL 手写一个完整的地图页面（底图 + 业务图层 + 点击交互）
- [ ] 能解释 OL 的 Layer/Source 分离设计的好处
- [ ] 能写一个 `StyleFunction` 根据数据属性动态改变样式
- [ ] 能解释项目中 `OLRenderer.addPointLayer` 的完整链路（从 JS 调用到 Canvas 渲染）
- [ ] 能独立给 OLRenderer 加一个新图层方法（如聚合图层）

**预估学时**: 35h

---

### 第九章 Cesium 3D 引擎

**学习目标**: 掌握 Cesium 的核心概念（Viewer / Entity / Primitive / 3D Tiles），能实现 3D 场景

**核心知识点**:

_基础:_

- Viewer / Scene / Camera —— Cesium 的三层架构
- `Cartesian3` / `Cartographic` —— 笛卡尔坐标与地理坐标互转
- Entity API（点/线/面/模型）- 高层封装
- Primitive API —— 底层高性能渲染
- `Cesium.CallbackProperty` 动态更新

_地形与影像:_

- TerrainProvider（Cesium World Terrain / 自定义 DEM）
- ImageryProvider（天地图影像 / 自定义瓦片）

_3D 特效（项目使用）:_

- 水面效果（Water surface）—— `CesiumRenderer.addWaterSurface`
- 呼吸灯效果（Pulse animation）—— `CesiumRenderer.startBreathing`
- 相机飞行（Camera flyTo）—— 项目中的 `flyTo({ lng, lat }, { height })`

_进阶:_

- 3D Tiles（倾斜摄影 / BIM / 点云）
- Cesium ion 服务
- `postProcessStage` 后处理
- Cesium 的 `requestRenderMode` 按需渲染

**与项目关联**:

- 打开 `src/core/map/renderers/CesiumRenderer.js` 通读
- 找到 `addWaterSurface` 的实现，理解水面是怎么画出来的
- 找到 `startBreathing` 的实现，理解呼吸灯的原理

**实践项目**:

1. 独立写一个 Cesium 页面：加载 3D 地形 + 放置 5 栋 3D 建筑 + 相机飞行
2. 给 CesiumRenderer 新增 `add3DModel` 方法（加载 glTF 模型到指定坐标）

**验收标准 ✅**:

- [ ] 能解释 Cesium 中 Entity 和 Primitive 的区别及各自适用场景
- [ ] 能解释 `Cartesian3.fromDegrees(lng, lat, height)` 三参数的含义
- [ ] 能实现从 A 点飞到 B 点的相机动画并控制 duration
- [ ] 能解释项目中 `CesiumRenderer` 为什么在 `destroy()` 时要保存 `camera.changed` 的引用
- [ ] 能解释为什么 Cesium 不支持 tree-shaking（源码依赖问题）

**预估学时**: 40h

---

### 第十章 Turf.js 空间分析

**学习目标**: 掌握 Turf.js 的核心空间运算（缓冲/相交/合并/距离），能在前端做空间分析

**核心知识点**:

- `turf.buffer` — 缓冲分析（选址分析的覆盖范围）
- `turf.union` / `turf.intersect` — 合并与相交（多选设施的交并集）
- `turf.bbox` / `turf.bboxPolygon` — 包围盒
- `turf.distance` / `turf.bearing` — 距离和方位角
- `turf.pointOnFeature` / `turf.center` — 中心点计算
- `turf.area` — 面积计算
- `turf.booleanPointInPolygon` — 点在多边形内判断
- `turf.booleanValid` / `turf.cleanCoords` — GeoJSON 验证
- `turf.helpers` — feature / featureCollection 工厂函数

**与项目关联**:

- 选址分析页面 `SiteSelectionPage.vue` 的分析流程：多设施缓冲 → union 合并面 → 与小区相交 → 评分
- 这也是 Turf.js 在 WebGIS 中最典型的应用场景

**实践项目**: 用 Turf.js 独立实现一个选址分析 Demo：

- 选 3 个 POI 类型 → 分别缓冲 → turf.union 合并 → turf.intersect 与候选区域相交 → 输出重叠面积排序

**验收标准 ✅**:

- [ ] 能用 Turf.js 实现 buffer → union → intersect 完整链
- [ ] 能解释 `turf.union` 为什么有时返回 Polygon 有时返回 MultiPolygon（项目 `types/analysis.ts` 有备注）
- [ ] 能解释 `turf.booleanValid` 检查什么
- [ ] 能对 GeoJSON 做一次完整的空间分析验证
- [ ] 能把北部湾项目的选址分析链路画出流程图

**预估学时**: 15h

---

### 第十一章 ECharts 地理可视化

**学习目标**: 掌握 ECharts 的非地图图表（折线/柱状/雷达），以及地理坐标系图表

**核心知识点**:

- ECharts 基础配置（option / series / xAxis / yAxis / tooltip / legend）
- 折线图（LineChart）—— 水位趋势 / 吞吐量预测
- 柱状图（BarChart）—— 设施评分对比
- 雷达图（RadarChart）—— 小区多维评分
- 地图坐标系（geo / map series）—— 需要注册 GeoJSON
- 散点图叠加地图
- `useECharts` composable —— 项目中封装的模式
- 响应式 resize（`echarts.resize`）
- 暗色主题适配

**与项目关联**:

- 打开 `src/visualization/charts/` 下三个图表组件
- 打开 `src/visualization/charts/composables/useRadarChart.js`
- 理解 `useECharts` 的 init → setOption → dispose 生命周期

**实践项目**: 在北部湾项目中新增一个"港口吞吐量对比"柱状图 Panel，数据来自 JSON mock

**验收标准 ✅**:

- [ ] 能独立创建一个 ECharts 实例并完成 init → setOption → resize → dispose
- [ ] 能解释 `useECharts.js` 的生命周期管理设计
- [ ] 能用 `dataset` + `encode` 方式配置图表（替代传统 series.data）
- [ ] 能给雷达图的各轴设置不同的 max 值

**预估学时**: 12h

---

### 第十二章 项目实战：彻底掌控北部湾项目

**学习目标**: 能独立读懂北部湾项目的每一行代码，能基于需求新增业务模块

**核心任务**:

_第一遍：逐文件阅读（按分层顺序）_

1. `src/types/`（7 文件）→ 理解数据契约
2. `src/stores/`（9 文件）→ 理解状态流转
3. `src/core/map/`（渲染器 + composables）→ 理解地图引擎
4. `src/core/layout/`（GCS 面板系统）→ 理解布局
5. `src/business/`（3 个业务模块）→ 理解业务代码模式
6. `src/shared/`（通用组件 + composables）→ 理解复用设计
7. `src/router/` + `src/views/` → 理解路由和页面

_第二遍：画架构图_

- 数据流图：API → Adapter → Store → Component → Renderer
- 依赖图：core ← business / core → business 的边界验证
- 事件流图：provide/inject → Pinia → watch → renderer

_第三遍：动手改_

- 任务 A：新增一个"航线分析"模块（空壳页面 + 路由 + Navigation 入口）
- 任务 B：给现有选址分析加一个新的筛选条件
- 任务 C：修复 P0-02（标记接口越权）

**验收标准 ✅**:

- [ ] 能用一张 A4 纸画出北部湾项目的完整架构图
- [ ] 能从零新增一个业务模块（页面 + 路由 + Store + 图层注册），不需要参考现有代码
- [ ] 能解释 `registerToggleable` 的渲染器参数处理逻辑（函数 vs 对象判断）
- [ ] 能解释 2D→3D 引擎切换的完整流程（从 `route.meta.engine` 到 `v-show` 切换）
- [ ] 能修复 P0 级 bug 中的一个（自选），并写测试验证

**预估学时**: 50h（把项目吃透需要时间，不要急）

---

### 🎯 第二级总验收：WebGIS 核心

完成以下 3 件事：

1. **独立搭建**：从 npm init 开始，手写一个极简 WebGIS 项目（OL + Cesium 双引擎 + 2 个业务图层 + 一个 ECharts 图表），不参考北部湾代码
2. **项目增强**：给北部湾项目新增一个真实的功能（不是模板，是上线能用的功能）
3. **Code Review**：给北部湾项目写一份技术改进 PR，包含至少 3 个具体的修改建议和代码 diff

---

## 第三级：全栈工程能力

> 目标：能独立开发后端 API、管理数据库、搭建 CI/CD、写测试

---

### 第十三章 Node.js & Express

**学习目标**: 掌握 Node.js 核心概念和 Express 后端开发

**核心知识点**:

- Node.js 事件循环、Stream、Buffer
- Express 路由（Router）/ 中间件（Middleware）/ 错误处理
- RESTful API 设计（GET / POST / PUT / DELETE）
- 请求参数校验（`express-validator`）
- JWT 认证（jsonwebtoken + HttpOnly Cookie）
- `CORS` 配置
- `helmet` 安全头
- 日志（`morgan` / `winston`）
- Docker 化部署

**与项目关联**:

- 打开 `server/` 目录，对照 MVC 分层（routes → controllers → services → repositories）
- 阅读 `server/routes/*` 理解 API 路由注册
- 阅读 `server/middleware/` 理解认证中间件

**实践项目**: 给北部湾项目的 server 新增一个 `/api/v1/route-analysis` 端点（航线分析 API）

**验收标准 ✅**:

- [ ] 能手写 Express RESTful API（路由 + 中间件 + 错误处理）
- [ ] 能解释 JWT 的签发和验证流程
- [ ] 能解释 `HttpOnly Cookie` 比 `localStorage` 存 token 安全在哪里
- [ ] 能用 Docker 跑起北部湾项目的 server

**预估学时**: 25h

---

### 第十四章 NestJS 企业级后端

**学习目标**: 掌握 NestJS 的模块化架构，能用它替代 Express 重构后端

**核心知识点**:

- Module / Controller / Provider / Service 分层
- 依赖注入（DI）—— NestJS 的核心设计
- 管道（Pipe）—— 请求参数校验和转换
- 守卫（Guard）—— 认证和授权
- 拦截器（Interceptor）—— 响应包装和日志
- 异常过滤器（ExceptionFilter）
- TypeORM / Prisma 数据库 ORM
- `@nestjs/swagger` OpenAPI 文档自动生成
- `@nestjs/config` 环境配置管理

**与项目关联**: 北部湾的 Express server 可以逐步迁移到 NestJS

**实践项目**: 用 NestJS 重写北部湾项目的 `auth` 模块（登录/注册/登出）

**验收标准 ✅**:

- [ ] 能解释 NestJS 的 Module/Controller/Provider 三层和 Express 的 Router/Controller/Middleware 的对应关系
- [ ] 能用 NestJS CLI 创建一个完整模块（Module + Controller + Service + DTO）
- [ ] 能用 Guard 实现 JWT 认证
- [ ] 能用 Pipe 实现请求参数校验

**预估学时**: 35h

---

### 第十五章 PostgreSQL & PostGIS

**学习目标**: 掌握 SQL 和空间 SQL，能设计 GIS 数据库

**核心知识点**:

_PostgreSQL 基础:_

- 表设计、主键外键、索引
- JOIN（INNER / LEFT / RIGHT）
- GROUP BY + 聚合函数
- 子查询和 CTE（WITH）
- 事务（BEGIN / COMMIT / ROLLBACK）

_PostGIS 空间扩展:_

- `geometry` / `geography` 数据类型
- `ST_Buffer` / `ST_Union` / `ST_Intersection` / `ST_Distance`
- `ST_Within` / `ST_Contains` / `ST_Intersects` 空间关系判断
- `ST_AsGeoJSON` / `ST_GeomFromGeoJSON`
- 空间索引（GIST index）
- 坐标系转换 `ST_Transform`
- 空间连接（Spatial JOIN）
- `ST_DWithin` 高效距离查询

_与项目对比:_

- 北部湾现在用 JSON 文件当数据库 → 如果用 PostGIS，选址分析的 `turf.union` 部分可以直接在数据库用 `ST_Union` 算完再返回
- `ST_DWithin` 比 JS 里的 `turf.distance` 遍历快 10-100 倍

**实践项目**:

1. 建一个 PostGIS 数据库，导入北部湾的 `xiaoqu.json` 和 `ports.json` 作为表
2. 用一条 SQL 查出离"钦州港"50km 内、面积大于 10 平方公里的所有小区

**验收标准 ✅**:

- [ ] 能写 CRUD + JOIN + GROUP BY 的 SQL
- [ ] 能用 `ST_DWithin` 代替 `turf.distance` 做空间查询
- [ ] 能解释 `geometry` 和 `geography` 类型的区别
- [ ] 能解释 GIST 索引为什么能加速空间查询
- [ ] 能把北部湾的选址分析核心逻辑从 JS 迁移到 SQL

**预估学时**: 30h

---

### 第十六章 测试与 CI/CD

**学习目标**: 能给项目写测试，搭建 CI 流水线

**核心知识点**:

_测试:_

- 单元测试：Vitest（项目用的是 vitest）
- Vue 组件测试：`@vue/test-utils` + `mount` / `shallowMount`
- Pinia Store 测试：独立实例化 Store
- API 测试：用 `msw` mock 请求
- E2E 测试：Playwright（可选，WebGIS E2E 比较复杂）

_CI/CD:_

- GitHub Actions 配置
- Lint + Test + Build 流水线
- Docker 构建和推送

**与项目关联**:

- 打开 `vitest.config.js` 和 `UnifiedMap.test.js` 理解现有测试框架
- 跑 `npm run test` 看是否还通过

**实践项目**: 给北部湾项目写 3 个测试：

1. `stores/map.test.ts` — 测 map store 的 registerLayer + toggleLayer
2. `useApiRequest.test.ts` — 测 401 拦截和超时
3. `.github/workflows/ci.yml` — 一键跑 Lint + Test + Build

**验收标准 ✅**:

- [ ] 能手写一个 Store 的单元测试（init → action → assert state change）
- [ ] 能手写一个 API 请求的 mock 测试（用 msw 拦截 fetch）
- [ ] 能配置 GitHub Actions 跑 CI
- [ ] CI 失败时能根据日志定位问题

**预估学时**: 15h

---

### 第十七章 系统架构设计

**学习目标**: 能从架构层面设计一个 WebGIS 系统，理解设计模式

**核心知识点**:

- MVC / MVVM / 分层架构
- Adapter 模式 —— 北部湾项目的 Data Adapter
- 策略模式 —— Mock vs API 数据源切换
- 观察者模式 —— Pinia Store + watch
- 门面模式 —— `gcsStore` 聚合 4 个子 Store
- 依赖倒置原则（DIP）—— core 不依赖 business
- 单一职责原则（SRP）—— UnifiedMap 现在违规了（550 行）
- 开闭原则（OCP）—— 新增业务不该改 core
- C4 模型画架构图

**实践项目**: 画北部湾项目的 C4 架构图（Context → Container → Component → Code 四层）

**验收标准 ✅**:

- [ ] 能解释项目中用到的 4 种设计模式
- [ ] 能画出项目的 C4 架构图
- [ ] 能分析 UnifiedMap 的职责并提供拆分方案
- [ ] 能设计一个新业务模块的架构（类图 + 时序图）

**预估学时**: 15h

---

### 🎯 第三级总验收：全栈工程能力

1. **后端迁移**：用 NestJS 写一个最小可用后端，连接到 PostgreSQL+PostGIS 数据库
2. **CI/CD**：给北部湾项目配好 GitHub Actions，push 自动跑 lint + test + build
3. **架构 Review**：出一份项目架构改进方案（500 字以上），引用至少 3 个设计模式

---

## 第四级：GIS 数据工程

> 目标：能用 Python 自动化处理地理空间数据，理解 DEM、水文分析、坐标系统

---

### 第十八章 Python GIS 编程

**学习目标**: 用 Python 读写、处理、分析地理空间数据

**核心知识点**:

- Python 基础快速过（会 JS 的人学 Python 很快）
- NumPy 基础（数组操作）
- `fiona` — 读写 Shapefile / GeoJSON
- `shapely` — 几何对象操作（Point / Polygon / buffer / union / intersection）
- `pyproj` — 坐标系转换
- `geopandas` — 地理 DataFrame（GIS 界的 pandas）
- `rasterio` — 栅格数据读写
- `xarray` — 多维栅格数据（NetCDF / GRIB）

**实践项目**: 用 Python 写一个脚本：读取北部湾的 `xiaoqu.json` → 转换为 GeoDataFrame → 按面积筛选 → 坐标系重投影 → 导出为 Shapefile

**验收标准 ✅**:

- [ ] 能用 `shapely` 构造和操作几何对象（Point / Polygon / Buffer）
- [ ] 能用 `geopandas` 读 Shapefile → 过滤 → 空间 join → 导出
- [ ] 能用 `pyproj` 做 WGS84 ↔ CGCS2000 转换
- [ ] 能用 `rasterio` 读取 DEM 文件并提取指定坐标的高程值

**预估学时**: 30h（有 JS 基础 Python 学很快）

---

### 第十九章 GeoPandas & 空间数据自动化

**学习目标**: 能用 Python 自动化处理大规模地理数据管道

**核心知识点**:

- GeoDataFrame 的 CRUD 操作
- 空间 join（`gpd.sjoin`）— 类似 SQL 的空间 JOIN
- 分组聚合（`dissolve`）
- 批量坐标系转换
- 与 PostGIS 交互（`GeoDataFrame.to_postgis`）
- 自动化脚本设计：读取 → 清洗 → 分析 → 入库 → 报告

**实践项目**: 写一个完整的自动化管道：

1. 读取 `server/data/` 下所有 JSON 文件
2. 统一坐标系为 EPSG:4326
3. 做一次空间覆盖分析（港口 50km 缓冲区内的设施统计）
4. 结果入库到 PostGIS `analysis_results` 表
5. 输出 CSV 报告

**验收标准 ✅**:

- [ ] 能写出完整的数据处理管道（读 → 处理 → 入库 → 输出）
- [ ] 能用 `gpd.sjoin` 代替手写 for 循环遍历做空间匹配
- [ ] 能处理 10000+ 条记录的批量操作而不 OOM
- [ ] 能解释 `geopandas` 背后依赖的 C 库（GEOS / GDAL / PROJ）

**预估学时**: 25h

---

### 第二十章 坐标系与投影深度专题

**学习目标**: 彻底搞懂坐标系，能独立选投影、做转换、处理各种坐标问题

**核心知识点**:

- 地球椭球体模型（WGS84 / CGCS2000 / 北京54 / 西安80）
- 大地水准面 vs 参考椭球
- 高斯-克吕格投影（中国常用的 3 度 / 6 度分带）
- UTM 投影分带
- 七参数转换（Bursa-Wolf 模型）
- 四参数转换（平面坐标）
- `proj4` / PROJ 字符串
- 海上 vs 陆地的投影选择（北部湾是海陆交界）
- Cesium 的 WGS84 地球椭球体假设

**与项目关联**: 北部湾港口数据横跨 108°E 左右，处于 UTM 49N 和 50N 的交界带，高斯投影应该用哪个中央经线？

**实践项目**:

1. 用一个 CGCS2000 坐标的港口气象站数据 → 转 WGS84 → 加载到北部湾地图
2. 对比七参数转换和直接当成 WGS84 用的误差（在北部湾区域大概差多少米）

**验收标准 ✅**:

- [ ] 能解释为什么 CGCS2000 和 WGS84 在北部湾区域相差约 0.2-0.5 米（不需要精确数字，知道有差且知道怎么查）
- [ ] 能根据项目需求选择合适的投影方式并说出理由
- [ ] 能用 `pyproj` 或 `proj4` 完成坐标系转换
- [ ] 能解释 Cesium 为什么默认用 WGS84 椭球体

**预估学时**: 20h

---

### 第二十一章 DEM 与水文分析

**学习目标**: 理解数字高程模型，能用 hydrology 工具做淹没分析

**核心知识点**:

- DEM（数字高程模型）分辨率概念（30m SRTM / 12.5m ALOS / 5m 国产 DEM）
- 洼地填充（Fill Sinks）
- 流向计算（Flow Direction - D8 算法）
- 汇流累积（Flow Accumulation）
- 河网提取（Stream Network）
- 无源淹没 vs 有源淹没
- 水位抬升淹没模拟 —— 你的北部湾项目的核心算法
- `rasterio` + `richdem` / `pysheds` / `whitebox` 的水文分析库

**与项目关联**: 你的浸没分析现在用的是后端 mock DEM 模拟数据，理解真正的 DEM 处理后你就能替换 mock

**实践项目**:

1. 下载北部湾区域的 SRTM 30m DEM
2. 用 `pysheds` 提取主要水系
3. 给定一个水位值（如 3m），计算淹没范围
4. 对比你的项目后端返回的 mock 淹没面，看差多少

**验收标准 ✅**:

- [ ] 能用 Python 读取 DEM 并可视化高程分布
- [ ] 能解释 D8 流向算法的基本原理
- [ ] 能用水位抬升法计算给定水位的淹没范围
- [ ] 能理解 mock 淹没数据和真实 DEM 淹没数据的差异

**预估学时**: 30h

---

### 第二十二章 QGIS / ArcGIS Pro 脚本化

**学习目标**: 能用 GUI 工具快速验证空间分析，并把操作写成 Python 脚本

**核心知识点**:

- QGIS 基础操作（加载图层、坐标系设置、属性表）
- QGIS Processing Toolbox（缓冲区 / 相交 / 合并 / 裁剪）
- QGIS Python Console → 录制操作 → 导出为 `.py` 脚本
- QGIS Plugin 开发基础
- ArcGIS Pro 的 `arcpy` 库（如果你有授权）
- ModelBuilder（ArcGIS）/ Graphical Modeler（QGIS）— 可视化流程建模

**实践项目**: 在 QGIS 中完成一次完整选址分析 → 导出 Python 脚本 → 改写成可复用的 `.py` 文件

**验收标准 ✅**:

- [ ] 能在 QGIS 中完成：加载数据 → 缓冲区 → 相交 → 属性筛选 → 导出
- [ ] 能把上述操作的过程导出为 Python 脚���
- [ ] 能解释 QGIS 的 Processing Toolbox 和 `geopandas` 做同样操作的效率差异

**预估学时**: 20h

---

### 🎯 第四级总验收：GIS 数据工程

1. **数据管道**: 写一个完整的 Python 数据处理管道（读原始数据 → 清��� → 空间分析 → 入 PostGIS）
2. **DEM 处理**: 用真实的 DEM 数据替代北部湾项目的 mock 淹没数据
3. **坐标系专项**: 写一份 300 字的文档，说明北部湾项目应该用什么坐标系方案（数据入库用什么 CRS、前端显示用什么 CRS、CGCS2000 数据如何接入）

---

## 附录：学习路线概览

|   级别   |   章   | 内容                                    |   学时    |
| :------: | :----: | --------------------------------------- | :-------: |
|    一    |  1-6   | HTML/CSS/JS/TS/Vue/Vite/Browser         |   142h    |
|    二    |  7-12  | GIS基础/OL/Cesium/Turf/ECharts/项目实战 |   172h    |
|    三    | 13-17  | Node/Express/NestJS/PostGIS/测试/架构   |   120h    |
|    四    | 18-22  | Python/GeoPandas/坐标系/DEM/QGIS        |   125h    |
| **合计** | **22** |                                         | **~560h** |

按每天 3 小时、每周 5 天计算：**约 9 个月**（接近中级 WebGIS 水平）。

如果已经有部分基础（如 JS 基础好可跳过第二章节大部分），约 **6-7 个月**。

---

> **写入日期**: 2026-07-27
> **版本**: 1.0
> **关联**: 北部湾港 WebGIS 智慧分析平台
