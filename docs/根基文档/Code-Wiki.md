# 北部湾港智慧空间分析平台 · Code Wiki

> 面向**代码阅读与维护**的技术文档全集。与 `docs/根基文档/`（01 项目全景 / 02 数据流 / 03 开发指南）侧重"设计意图"不同，本文档侧重**代码事实**：模块在哪、关键类/函数做什么、依赖怎么走、如何运行。

---

## 目录

1. [项目架构概览](#01-项目架构概览)
2. [前端代码库（frontend/）](#02-前端代码库frontend)
3. [后端代码库（backend/）](#03-后端代码库backend)
4. [FastAPI 洪涝在线演算服务](#04-fastapi-洪涝在线演算服务backendflood-service)
5. [数据资产与依赖关系](#05-数据资产与依赖关系)
6. [运行与构建](#06-运行与构建)

---

# 01 · 项目架构概览

## 1. 项目定位

面向广西北部湾港（钦州）的 WebGIS 智慧空间分析平台。核心目标不是"地图 Demo"，而是验证一套**可扩展的 GIS 业务系统架构**，重点解决功能膨胀后地图渲染与业务逻辑耦合、重复图层管理、新增业务需改动核心代码等问题。

### 核心功能

| 业务 | 引擎 | 说明 |
| ---- | ---- | ---- |
| 选址分析 | 2D | 6 类设施多选 + 距离加权评分，后端 turf 缓冲区叠加 + RBush 面内点过滤，ECharts 雷达图 6 轴评分 + 方案收藏 |
| 预测分析 | 2D | 4 指标趋势可视化（时间轴播放 + 地图热力），吞吐量模型产物（cargo/container 真数据，berth/traffic 诚实标注合成示意） |
| 浸没分析 | 3D | 基于真 DEM 的连通性淹没演算（FastAPI scipy 8 连通 + 海面种子），251 档预计算表查表秒回，Cesium 3D 真地形渲染 |

附加能力：HttpOnly Cookie 会话认证（tokenVersion 吊销）、暗色主题切换、响应式三档布局（桌面/抽屉/紧凑）。

## 2. 技术栈

| 层 | 技术 |
| --- | ---- |
| 前端框架 | Vue 3（Composition API + `<script setup>`）、Vite（Rolldown）、Vue Router、Pinia |
| 语言/类型 | TypeScript 严格模式、zod 运行时校验（HTTP 边界） |
| GIS 引擎 | OpenLayers（2D）、Cesium（3D，懒加载 + 真地形瓦片） |
| 空间分析 | Turf.js、rbush 空间索引、scipy 连通性演算（FastAPI） |
| 可视化 | ECharts（异步化，不进首屏关键路径） |
| UI | Element Plus（按需引入）+ 自研 GCS 网格布局体系（暗色主题 token） |
| 后端 | Node.js、Express 5（ESM，三层架构）+ FastAPI（Python 洪涝演算，独立容器） |
| 数据 | GeoJSON、JSON（createReadCache 缓存）、251 档预计算表（gzip）、DEM 流水线脚本 |
| 工程化 | Vitest、ESLint、Prettier、Husky/commitlint、dependency-cruiser 架构守护、gitleaks 密钥扫描 |
| 部署 | Docker Compose 双容器、GitHub Actions CI 自动部署、Let's Encrypt HTTPS 自动续期 |

## 3. 分层架构

项目经历一次架构重构后采用**四层单向依赖**架构：

| 层级 | 职责 |
| ---- | ---- |
| Application Layer | 页面路由、视图装配（`views/`、`router/`、`main.ts`、`App.vue`） |
| Business Layer | 业务模块（`business/site-selection`、`business/forecast`、`business/flood-analysis`） |
| GIS Core Layer | 地图渲染抽象、图层管理（`core/map/`、`core/layout/`） |
| Component System | 通用组件与布局体系（`shared/` GCS） |

依赖方向单向自上而下：**业务层依赖 GIS 核心，核心层不反向依赖业务**。

### 前端完整分层（L0-L8）

```
L0  types          纯类型声明（零运行时依赖）
L1  shared         通用工具 / composable / 常量 / 基础组件
L2  stores         Pinia 全局状态
L3  services       数据访问（adapter / API 封装）
L4  visualization  通用图表资产
L5  core           地图核心 + 布局基座
L6  business       业务模块（互不依赖，manifest 注册）
L7  views          页面装配
L8  入口           main / router / App
```

铁律：低层不得依赖高层；`types/` 零运行时依赖；业务模块之间禁止互引。依赖方向由 `npm run cruise`（dependency-cruiser）强制守护。

### 后端分层

```
routes → controllers（sendSuccess 信封）→ services（createReadCache）→ repositories → data/*.json
                                    └── middleware（auth / logSanitizer）
```

## 4. 核心设计理念

### 4.1 GIS 渲染抽象（MapRenderer 策略模式）

地图能力抽象为一层渲染接口 `MapRenderer`（抽象基类），业务模块通过统一约定与地图交互，而非直接调用具体引擎 API。已接入 OpenLayers（2D）与 Cesium（3D）两套实现。业务高频操作（图层增删、点位绘制、视图控制）经接口完成。

单引擎专有能力（如水面 `Water3DCapability`、GeoTIFF `GeoTIFFCapability`、热力 `HeatmapCapability`）拆独立能力接口，调用方经类型守卫（`typeof` 检查）确认支持后调用，避免 2D/3D 互背契约。

### 4.2 业务模块化

业务功能按模块组织，每个模块自带状态（store）、视图（page + 面板）与服务调用（adapter）。新增业务只需在 `business/manifest.ts` 追加一条清单，无需改 router/App.vue。

### 4.3 GCS 组件布局体系

GIS 应用中浮动组件（工具栏、分析面板、图例、详情卡片）数量多，页面布局容易失控。GCS（Global Component Style）是一套组件布局约定：统一网格位置约定（面板尺寸 = 整数个 Cell + 锚点定位）+ 样式变量，集中管理浮动组件位置与层级。**布局是网格约定，不是组件库**。

## 5. 请求路径（数据流总览）

```
业务组件 → 取数入口（useApiRequest / loadStatic）
  ├─ 数据源 mock   → loadStatic（前端契约桩，已基本收归后端）
  ├─ 数据源 api    → fetch → Express /api/*
  └─ 数据源 online → fetch → FastAPI /flood-online（仅洪涝）
后端：routes → controllers（sendSuccess）→ services（createReadCache）→ data/*.json
```

- API 请求统一走 `useApiRequest`（超时、重试、zod 校验、信封解包、请求关联 ID）。
- 静态资源统一走 `loadStatic`（超时、TTL 缓存、in-flight 去重）。
- 响应信封统一 `{ code, data }`，解包统一 `unwrapEnvelope`。
- 数据源三态是演进路径：mock 契约桩 → api JSON 过渡 → online 真演算 → 最终 PostgreSQL + GeoServer。

## 6. 部署拓扑

```
                        ┌───────────────────────────────┐
  浏览器 ── HTTPS ──▶  nginx (80/443, 8443)
                        │   /            → 前端静态产物
                        │   /api/        → Express :3000（主容器）
                        │   /flood-online → flood-service :8000（FastAPI 内网，不暴露公网）
                        └───────────────────────────────┘
```

- Docker Compose 双容器：`app`（nginx + 前端 + Express 后端）+ `flood-service`（FastAPI）。
- 数据经 volume 挂载（`backend/data`、`backend/static/dem`、`backend/static/terrain`），不烘焙进镜像。
- CI 流水线 4 job：audit → lint-and-build → backend-tests → deploy（main 分支 SSH 自动部署）。
- HTTPS：Let's Encrypt + duckdns DNS-01，certbot.timer 自动续期。
- 生产数据源由 `VITE_DATA_SOURCE` 构建期注入（`online` = 洪涝走 FastAPI；`api` = Express 查表兜底）。

## 7. 工程红线（不变量）

- 架构契约 `npm run cruise` 0 violation（含 backend）。
- 前后端测试全绿（`npm test`）。
- HTTP 边界 100% zod 校验。
- 请求唯一入口：API 走 `useApiRequest`、静态走 `loadStatic`，禁止裸 fetch。
- 图层统一经 BLM 管理，禁止直接操作 renderer 图层。
- 后端读文件缓存统一 `createReadCache`，禁止自研 cache Map。
- 跨层 import 走 index 入口（`@/shared` / `@/core` / `@/stores` / `@/services` / `@/business` / `@/visualization`），禁止深路径穿透（Q4 816 拍板；懒加载 import() 属构建优化保留深路径）。

---

# 02 · 前端代码库（frontend/）

> 前端根目录 `frontend/`，入口 `frontend/src/`。技术栈：Vue 3 + Vite + Pinia + TypeScript + OpenLayers + Cesium + ECharts + Element Plus。

## 1. 目录结构（src/）

```
src/
├── main.ts              # 应用入口：环境校验、性能观察、数据源设定、Pinia/Router/主题挂载、全局错误处理
├── App.vue              # 根组件：注入全局服务、图层管理器、路由引擎切换、登出 store 重置
├── style.css            # 全局样式（GCS 变量）
├── router/              # 路由（index.ts），业务路由由 business/manifest 生成
├── types/               # L0 纯类型层（零运行时依赖）
├── shared/              # L1 通用工具/composable/常量/基础组件
├── stores/              # L2 Pinia 全局状态
├── services/            # L3 数据访问（adapter / API 封装）
├── visualization/       # L4 通用图表资产（ECharts 封装）
├── core/                # L5 地图核心 + 布局基座
├── business/            # L6 业务模块（site-selection / forecast / flood-analysis）
└── views/               # L7 页面装配（Home / Profile）
```

## 2. 入口层

### 2.1 main.ts
- `validateEnv()`：校验 `VITE_TIANDITU_KEY`（必需）、`VITE_API_BASE`（非必需，默认 `/api`）。
- `initPerfReporter()`：挂载性能观察者（dev-only）。
- `floodAdapter.setDataSource(dataSource)`：数据源由 `VITE_DATA_SOURCE` 驱动，默认 `api`。
- `useTheme().initTheme()`：mount 前应用主题，避免首帧闪白/闪黑。
- 全局错误处理：`app.config.errorHandler` + `window.onerror` + `window.onunhandledrejection`，统一走 logger + perfReporter。

### 2.2 App.vue
- provide 全局服务：`RESTORE_PLAN_DATA_KEY`、`EDITING_PLAN_KEY`、`UNIFIED_MAP_KEY`、`MAP_STORE_KEY`、`BUSINESS_LAYER_MANAGER_KEY`。
- 创建 `BusinessLayerManager`（App 级持久，因为 RouterView 下的业务组件是 UnifiedMap 的兄弟节点）。
- `registerNavItems()`：从 `business/manifest` 注入业务导航项（core 不引 business 的分层铁律）。
- 路由 watcher：检测 `route.meta.engine` 变化区分引擎切换，避免覆盖 importState 设置的相机位置。
- 登出/多标签页登出（`authUser` 变 null）时统一重置各业务 store。

## 3. 路由与业务注册（router/ + business/manifest.ts）

### 3.1 router/index.ts
- 路由：`/`(Home)、业务路由（由 `buildBusinessRoutes()` 生成）、`/profile`(Profile)。
- 每个路由带 `meta.engine`（'2d' | '3d'）驱动地图引擎切换。

### 3.2 business/manifest.ts（业务注册清单，新增业务核心入口）
- `BusinessModule` 接口：`name` / `path` / `engine` / `title` / `navLabel` / `navIcon` / `navDisabled?` / `component`。
- `businessModules`：已注册 SiteSelection（2d）、Forecast（2d）、FloodAnalysis（3d）、RouteAnalysis（占位未实现）。
- `buildBusinessRoutes()`：由清单生成路由（component 为 null 的占位模块跳过）。

## 4. 数据访问层（services/）

### 4.1 services/index.ts
导出 `floodAdapter`、`forecastAdapter`、`mapDataService`。

### 4.2 services/adapters/floodAdapter.ts（浸没分析数据适配器，双数据源）
- 模块级 `dataSource`（'api' | 'online'），`setDataSource()` 切换。
- `api` 模式：走 Express `/flood/*`（`/flood/flood-areas`、`/flood/flood-statistics`、`/flood/analysis/disaster`、`/flood/water-area`）。
- `online` 模式：走 FastAPI `/flood-online/api/flood/online`、`/flood-online/api/flood/impact`（envelope:false，裸 JSON）。
- 方法：
  - `getWaterArea(signal)`：水域坐标。
  - `getFloodAnalysis(waterLevel, {signal})`：淹没范围 + 统计 + 风险等级（online 有 64 档 FIFO 缓存）。
  - `getImpactAssessment(waterLevel, {signal})`：受影响设施 + 总损失。
  - `clearCache()`。
- `_riskLevelFromFlood()`：online 模式风险等级映射（与后端 `deriveRiskLevel` 同表）。

### 4.3 services/adapters/forecastAdapter.ts（预测数据适配器）
- `getOverview(signal)`：`/forecast/overview` 指标索引。
- `getTimeSeries(params, signal)`：`/forecast/timeseries` 趋势时序。
- `getIndicatorComparison(indicator, params, signal)`：`/forecast/indicator/:indicator` 港口对比。
- 全部经 `useApiRequest` + zod schema 校验。

### 4.4 services/mapDataService.ts
- `getPorts()`：`MAP_CONFIG.DATA_PATHS.ports` 读港口数据，过滤北部湾边界外坐标。
- `clearCache()`：委托 loadStatic 清统一缓存。

## 5. 共享层（shared/）

### 5.1 请求基础设施
- **useApiRequest.ts**：API 统一入口。
  - `apiRequest(path, options)`：GET 幂等请求超时/网络错误线性退避重试（POST 不重试）；10s 超时；`credentials:'include'`（Cookie 认证）；`cache:'no-store'`（防 ETag 304 误判登出）；zod schema 校验；信封解包（`envelope:false` 跳过）。
  - `ErrorCode`：TIMEOUT / NETWORK_ERROR / UNAUTHORIZED / SERVER_ERROR / REQUEST_FAILED。
  - 模块级 `token` ref、`isAuthenticated` computed。
- **loadStatic.ts**：静态资源加载器。统一超时（10s）+ 可选缓存（TTL 5min）+ in-flight 去重 + LRU 上限（100 条）。`clearStaticCache()` / `invalidateStatic()`。
- **responseEnvelope.ts**：`unwrapEnvelope()` 纯函数，解 `{code,data}` → data。

### 5.2 认证（useAuth.ts）
- 模块级 `user` ref（localStorage 持久化 + zod 校验）。
- `restoreAuth()`：启动时以 Cookie 为权威调 `/auth/me` 校验。
- `login/register/logout`：调后端接口，token 由 HttpOnly Cookie 携带，前端仅设占位符启用 `isAuthenticated`。
- 多标签页同步：`initAuthStorageListener()` / `removeAuthStorageListener()`（storage 事件）。

### 5.3 其他关键 composable / utils
- `useLatestRequest.ts`：竞态守卫（新请求 abort 旧请求 + 取消静默兜底）。
- `usePlans.ts`：方案收藏管理。
- `crs.ts`：`isInBeibuGulf()`（北部湾边界判定）、坐标工具。
- `spatialIndex.ts`：**前端版** rbush 矩形视口裁剪（与后端 `utils/spatialIndex.js` 不同）。
- `logger.ts`：分级日志 + `sampled` 采样 + 预留 `addLogTransport`。
- `perfReporter.ts`：性能埋点（`perfTimeFn`、`perfRecordApi`、`perfReportError`）。
- `gcsFeedback.ts`：`showWarning` / `showError`（toast）。
- `loadStatic` / `errorHandler` / `facilityLabels` / `responseEnvelope`。
- `layout/`：`useGCS`（网格坐标）、`useTheme`（暗色主题切换）、`config`（GCS 变量）。

### 5.4 shared/constants
- `colors.ts`、`ui.ts`（CELL_PIXEL 等）、`chart.ts`、`forecast.ts`（指标定义）。

## 6. 状态管理（stores/）

统一 Setup Store 语法（`useXxxStore`）。导出：`mapStore`、`floodStore`、`forecastStore`、`siteSelectionStore`、`createPersistedState`。

| Store | 职责 |
| ----- | ---- |
| mapStore | 地图类型（2d/3d）、当前渲染器、图层目录（layerCatalog）、选中港口、业务图层注册/显隐 |
| floodStore | 洪涝水位、淹没统计/特征、风险等级、受影响设施/损失、状态保存/恢复 |
| forecastStore | 预测数据缓存、指标、时序 |
| siteSelectionStore | 选址参数、方案、雷达图数据 |

`createPersistedState.ts`：状态持久化工厂（sessionStorage/localStorage）。

## 7. GIS 核心层（core/）

### 7.1 core/index.ts（公开 API 入口）
re-export：`config/map`、`layout/*`、`map/BusinessLayerManager`、`map/composables/*`、`map/layerAdapters`、`map/renderers/MapRenderer`、`provideKeys`。

### 7.2 渲染抽象
- **renderers/MapRenderer.ts**：抽象基类（策略模式）。核心方法：
  - 图层：`addPointLayer` / `addPolygonLayer` / `addGeoJsonLayer` / `setVisibility` / `removeLayer` / `hasLayer` / `isLayerVisible` / `_doSetVisibility` / `_doRemoveLayer`。
  - 视图：`flyTo` / `updateSize` / `getMap`（2D）/ `getViewer`（3D）。
  - 事件：`on` / `off` / `emit`（EventTarget 封装）。
  - 状态：`exportState` / `importState`（引擎切换时相机 + 图层可见性恢复）。
  - 能力：`startBreathing` / `stopBreathing` / `setBaseLayer`。
  - 待定可见性：`_pendingVisibility` 队列 + `_applyPendingVisibility` / `clearPendingVisibility`。
- **renderers/OLRenderer.ts**：OpenLayers 2D 实现。
- **renderers/CesiumRenderer.ts**：Cesium 3D 实现（懒加载，`cesiumViewerManager` 管理 viewer 生命周期，含闲置销毁）。
- **renderers/index.ts**：`createRenderer(type, container)` 工厂。

### 7.3 图层管理
- **BusinessLayerManager.ts**：业务图层生命周期管理器（BLM）。
  - `register(key, {label, layerType, data, options, visible})`：注册即占位（数据未就绪也注册）。
  - `updateData(key, {data, options})`：不改变 visible，可见时重建图层。
  - `setVisible(key, visible)` / `remove(key)` / `removeAll()` / `has(key)` / `getMeta(key)`。
  - `reapplyAll(renderer)`：引擎切换后将 registry 中已注册且可见的图层重绘到新渲染器（幂等）。
  - `removeAllFromRenderer(renderer)`：从指定渲染器移除视觉实例（保留 registry）。
  - `setErrorHandler()`：图层渲染失败上报（UI 层 toast）。
  - 状态权威源为自身 `_registry`，同步 mapStore.layerCatalog。
- **layerAdapters.ts**：LayerType → adapter 映射（create/update/remove/setVisibility）。
  - LayerType：`heatmap`（2D only）、`geojson`、`points`、`polygon`、`waterSurface`（3D only）、`geotiff`（Cesium only）。
  - 含数据形状守卫（`assertPointArray` / `assertFeatureCollection` / `assertPolygonArray`，上限 50 万要素）。
  - 能力检查：`isWater3DCapable` / `isGeoTIFFCapable` / `isHeatmapCapable`。

### 7.4 地图组件
- **UnifiedMap.vue**：统一地图容器。双引擎 v-show 切换、渲染器实例复用不销毁；`switchMapType()` 带重入保护与失败回滚；加载港口/边界数据；`setupLayers()` 注册底图 + boundary/ports 常驻层；ResizeObserver 观察容器尺寸。
- **components/LayerControlPanel.vue**：图层控制面板。
- **composables/**：`useBoundaryLayer`、`usePortLayer`、`useBusinessLayers`、`useMapControls`。

### 7.5 布局（core/layout/）
- **AppLayout.vue**：GCS V2 布局基座。PPS（面板定位系统）绝对定位 Panel；桌面（≥960px）显示 Panel，<960px 进入抽屉模式（MobileDrawer）；底部 nav 3 按钮。
- **components/**：`BottomNavBar`、`GCSPanel`、`MobileDrawer`、`NavButton`、`DebugToggle`、`GCSDebugOverlay`。
- **composables/**：`useScreenActions`（flyToCity）、`useMobileDrawer`、`useSliderFocus`。
- **navConfig.ts**：导航项（由 App.vue 注入业务项）。
- **useMobileDrawer.ts** / **useSliderFocus.ts**。

## 8. 业务模块（business/）

### 8.1 business/index.ts（公开 API 入口）
re-export：`manifest`、`forecast/composables/*`、`site-selection/composables/*`。

### 8.2 选址分析（business/site-selection/）
- **SiteSelectionPage.vue**：主页面。
- **composables/**：
  - `useSiteAnalysisApi.ts`：调 `/api/site-analysis` 分析接口。
  - `useAnalysisLayer.ts`：分析结果图层管理。
  - `facilityConfig.ts`：设施类型配置。
  - `radarSnapshot.ts`：雷达图快照。
- **components/SiteAnalysisControlPanel.vue**：控制面板。

### 8.3 预测分析（business/forecast/）
- **ForecastPage.vue**：主页面。
- **composables/**：`useForecastRequest`、`useForecastLayer`、`useForecastComparison`、`useForecastTimeseries`、`useOverviewCharts`。
- **components/ForecastControlPanel.vue**：控制面板。

### 8.4 浸没分析（business/flood-analysis/）——3D
- **FloodAnalysisPage.vue**：主页面。数据源经 floodAdapter 隔离；业务图层经 BLM 注册/销毁；水位滑块防抖（100ms）触发淹没分析 + 影响评估；请求序号 + useLatestRequest 竞态守卫；路由离开 /profile 保存状态，其他路径清空。
- **components/**：`FloodAnalysisReportPanel`、`AffectedFacilityListPanel`、`WaterLevelProfilePanel`。
- **constants/colors.ts**：`FLOOD_RISK_COLORS` / `FLOOD_RISK_DEFAULT`（风险等级配色）。
- 图层 ID：`flood-water-surface`、`flood-area`、`flood-facilities`、`dem-hillshade`（Cesium 独占，3D 注册 2D 移除）。

## 9. 可视化（visualization/）
- **charts/**：`BarChart.vue`、`LineChart.vue`、`RadarChart.vue`（6 轴评分雷达图）、`ChartLoading.vue`、`RadarScoreTooltip.vue`。
- **composables/**：`useECharts`、`useChartBase`、`useRadarChart`。
- **panels/PortInfoPanel.vue**：港口信息面板。

## 10. 类型（types/）
纯类型层，零运行时依赖。目录：`api/`、`business/`、`components/`、`core/`、`__tests__/` 及根文件（`api.ts`、`analysis.ts`、`crs.ts`、`facility.ts`、`map.ts`、`plan.ts`、`renderer.ts`、`schemas.ts`、`xiaoqu.ts`、`index.ts`）。

`types/schemas.ts`：zod schema 定义（HTTP 边界运行时校验），由适配器引用。

## 11. 视图（views/）
- `HomePage.vue`：首页。
- `ProfilePage.vue`：个人中心（含 `components/UserInfoCard.vue`、`components/PlansPanel.vue`）。
- `components/LoginPanel.vue`：登录面板。

---

# 03 · 后端代码库（backend/）

> 后端为 Node.js + Express 5（ESM），目录 `backend/`。分层：routes / controllers / services / repositories / middleware / utils / data。另有 Python FastAPI 洪涝服务见 [04](#04-fastapi-洪涝在线演算服务backendflood-service)。

## 1. 目录结构

```
backend/
├── app.js                  # Express 应用装配（中间件、路由挂载、错误处理）
├── index.js                # 服务入口（端口监听、优雅关停）
├── routes/                 # 路由定义（URL → controller）
├── controllers/            # 控制器（参数校验 + 响应格式化）
├── services/               # 业务逻辑（计算层）
├── repositories/           # 数据访问（读 data/*.json）
├── middleware/             # 中间件（auth / logSanitizer）
├── utils/                  # 通用工具（缓存、错误、日志、空间索引、读盘）
├── data/                   # 静态数据（JSON / GeoJSON / gzip 预计算表）
├── static/                 # 静态资源（DEM 派生产物、terrain 瓦片）
├── flood-service/          # Python FastAPI 洪涝演算服务（独立容器）
├── package.json            # 后端依赖与脚本
└── vitest.config.js        # 后端测试配置
```

## 2. 应用装配（app.js）

Express 应用装配顺序（中间件顺序敏感）：

1. `helmet()`：HTTP 安全头。
2. `GET /api/health`：健康检查（置于限流器前，避免探针触发限流）。
3. `GET /api/health/ready`：readiness（查 `data/` 目录可读）。
4. 限流器：
   - `/api/` 全局限流（1000 次/15min，`/api/forecast` 豁免）。
   - `/api/forecast` 专属宽松限流（1000 次/15min，时间轴播放高频）。
   - `/api/auth/login`（50 次/15min）、`/api/auth/register`（50 次/15min）。
5. CORS：`CORS_ORIGIN` 环境变量（逗号分隔多源）；生产禁止 localhost 回退。
6. `express.json({ limit: '1mb' })` + `cookieParser()`。
7. 请求日志（仅 dev，经 `logSanitizer` 脱敏）。
8. 静态托管 `/static`（`.terrain` 设置 `Content-Encoding: gzip`，否则 Cesium 解压失败）。
9. 路由挂载：`/api/site-analysis`、`/api/auth`、`/api/plans`、`/api/forecast`、`/api/flood`、`/api/ports`。
10. 404 处理 + 全局错误处理（BusinessError 按码返回，生产不泄露堆栈）。

导出 `app` 默认 + `checkDataDirReadable()` / `readinessHandler`（供测试）。

### index.js（入口）
- `app.listen(PORT)`（默认 3000）。
- `unhandledRejection` / `uncaughtException` 处理。
- 优雅关停（SIGTERM/SIGINT）：排干请求后退出，10s 超时强退。

## 3. 路由与控制器

### 3.1 路由挂载总览

| 路由前缀 | 文件 | 认证 |
| -------- | ---- | ---- |
| `/api/site-analysis` | routes/siteAnalysis.js | 需登录（POST /） |
| `/api/auth` | routes/auth.js | 混合（/me 需登录） |
| `/api/plans` | routes/plans.js | 全部需登录 |
| `/api/forecast` | routes/forecast.js | 免鉴权 |
| `/api/flood` | routes/floodAnalysis.js | 数据免鉴权，分析需登录 |
| `/api/ports` | routes/ports.js | 免鉴权 |

### 3.2 API 路由清单

**认证（/api/auth）**
| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | /register | 注册（用户名 2-20 字符，密码含大小写+数字，≥6 位） |
| POST | /login | 登录（双通道密码比对 + 静默迁移） |
| POST | /logout | 登出（吊销 tokenVersion） |
| GET | /me | 当前用户（需登录，Cache-Control: no-store） |

**选址分析（/api/site-analysis）**
| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | / | 分析（需登录；body: selectedKeys, typeSettings, weights） |

**方案（/api/plans）**（全部需登录）
| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | / | 当前用户方案列表 |
| GET | /:id | 方案详情（含用户归属校验） |
| POST | / | 创建方案（名称唯一 + 正则校验） |
| PUT | /:id | 更新方案（白名单字段） |
| DELETE | /:id | 删除方案 |
| POST | /:id/xiaoqu | 保存小区到方案 |
| DELETE | /:id/xiaoqu/:xiaoquId | 从方案移除小区 |

**预测（/api/forecast）**（免鉴权）
| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | / 或 /overview | 指标索引概览 |
| GET | /map | 地图热力数据（indicator, time, confidence） |
| GET | /timeseries | 趋势时序（indicator, portId, start, end, granularity, confidence） |
| GET | /indicator/:type | 港口对比（time, portId, confidence） |
| GET | /:portId | 孤儿路由（前端零消费，保留兼容） |

**洪涝（/api/flood）**
| 方法 | 路径 | 认证 | 说明 |
| ---- | ---- | ---- | ---- |
| GET | /flood-areas | 免 | 淹没范围（waterLevel 可选） |
| GET | /flood-statistics | 免 | 统计数据（waterLevel 可选） |
| GET | /terrain-profiles | 免 | 地形剖面 |
| GET | /water-area | 免 | 水域边界坐标 |
| POST | /analysis/disaster | 需登录 | 灾害评估（body: waterLevel） |

**港口（/api/ports）**
| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | / | 港口列表（公开只读） |

## 4. 控制器（controllers/）

| 文件 | 职责 |
| ---- | ---- |
| authController.js | 注册/登录/登出/当前用户；密码双通道比对 + 静默迁移；tokenVersion 吊销 |
| siteAnalysisController.js | 选址分析参数校验（权重 1-5、半径正数、weights 0-10、设施类型白名单） |
| forecastController.js | 预测各接口；`parseConfidence()` 情景系数收口（非有限/≤0 → 1.0，上限 2） |
| floodAnalysisController.js | 洪涝数据/分析接口；`deriveRiskLevel()`（6 档语义）、`lookupFloodZone()`（查 251 档表） |
| plansController.js | 方案 CRUD + 小区保存/移除；用户归属校验 + 名称唯一校验 |
| portsController.js | 港口列表（静态 JSON 直读） |

## 5. 服务层（services/）——业务计算

### 5.1 siteAnalysisService.js（选址分析）
- `runSiteAnalysis({selectedKeys, typeSettings, facilityData, xiaoquData, weights})`：主流程。
  - `validateSelection()`：至少选一种设施类型。
  - `resolveRadiusSettings()`：按 importance 放大默认半径。
  - `buildTypeCoverage()`：POI 去重 → 过滤异常/越界坐标 → turf.buffer 缓冲区 → turf.union 合并。
  - `intersectCoverages()`：多类型覆盖范围求交（无重叠返回 failKey）。
  - `filterMatchedXiaoqu()`：RBush BBox 粗筛 + `booleanPointInPolygon` 精确判定。
  - `rankXiaoqu()`：`scoreXiaoqu` 评分排序取 Top 10。
  - `filterFacilitiesInCoverage()`：筛选覆盖范围内设施 POI。

### 5.2 scoringService.js（选址评分核心）
- `linearDecay(distance, maxDistance)`：线性距离衰减（百分制）。
- `importanceToRadius(defaultRadius, importance)`：重要程度 → 半径放大（1-5 档系数）。
- `DEFAULT_WEIGHTS`：各设施类型默认权重。
- `scoreXiaoqu()`：加权距离评分，预构建 rbush 空间索引避免 O(n²)；返回 `{score, breakdown}`。
- `kmToDegreeOffset(km, lat)`：经纬度偏移估算（粗筛 bbox 保守化）。

### 5.3 forecastService.js（预测）
- 指标白名单：cargo / container / berth / traffic。
- `getOrComputeForecast(indicator, scenarioLevel)`：读数据文件 → 计算预测（引擎缓存 LRU 100）。
- `getMapData()`：地图热力 FeatureCollection。
- `getPortData()` / `getIndicatorData()` / `getTimeSeriesData()`：端口/指标/时序数据。
- cargo 走模型产物（modelLoader），berth/traffic 透传合成数据，container 走趋势外推引擎。

### 5.4 forecastEngine.js（预测引擎）
- `computeForecast(historicalData, scenarioLevel, forecastMonths=120)`：趋势外推 + 季节性调整 + 可信度衰减。
- `generateSpatialValues()`：生成空间热力散射点（固定种子 LCG 确定性生成，可 HTTP 缓存）。

### 5.5 modelLoader.js（吞吐量模型）
- `getModelForecast(portId, afterTime)`：读 `throughput_model.json` 产物，缺失返回 null（调用方降级 forecastEngine）。
- `interpolateMonthly()`：模型半年点 → 月度序列线性插值，丢弃重叠月。

### 5.6 floodService.js（洪涝灾害评估）
- `assessDisaster(facilities, level, floodZone)`：按水位筛选受影响设施（elevation ≤ level + 脏数据防御）→ 计算损失（value × damageRate）。

### 5.7 userService.js（用户）
- `findByUsername` / `createUser` / `userExists` / `findById` / `updateTokenVersion` / `updatePassword`。
- 基于 `createFileStore`（读缓存 + 写锁），UUID 用户 ID，锁内查重消除 TOCTOU 竞态。

## 6. 仓储层（repositories/）

### 6.1 plansRepository.js（方案）
- `findAllByUserId` / `findById` / `create` / `update` / `remove` / `saveXiaoqu` / `removeXiaoqu`。
- `PLAN_UPDATE_FIELDS` 白名单（防原型链污染）。
- 所有写操作走 `sequential`（写锁）+ 不可变更新（构造新数组/对象，写盘失败缓存不脏）。

### 6.2 facilitiesRepository.js（设施）
- `FILE_MAP`：设施类型 → data 路径映射。
- `findByType(type)` / `findXiaoqu()` / `getAvailableTypes()`。

## 7. 中间件（middleware/）

### 7.1 auth.js（JWT 认证）
- 启动强校验：`JWT_SECRET` 必须存在且 ≥32 字符，否则抛致命错误。
- `authenticate(req, res, next)`：优先 Cookie `auth_token`，兼容 `Bearer` header；`jwt.verify` + `tokenVersion` 吊销校验。
- `generateToken(user)`：签发 7 天 token（含 tokenVersion）。

### 7.2 logSanitizer.js
- `sanitize()`：请求日志脱敏（敏感字段打码）。

## 8. 工具层（utils/）

| 文件 | 职责 |
| ---- | ---- |
| BusinessError.js | 业务错误类 + `ErrorCode`（`<HTTP status><业务序号>`，如 400001=400） |
| response.js | `sendSuccess(res, data, statusCode=200)`：统一信封 `{code, data}` |
| createReadCache.js | 读文件缓存工厂（TTL 5min + LRU/FIFO 淘汰 + 容量上限） |
| readStaticJson.js | 读 `backend/data/` JSON 统一入口（带缓存）；测试钩子 `_clearCacheForTest` |
| fileStore.js | `createFileStore`：文件存储工厂（读缓存 + 写锁 + 原子写入 tmp+rename） |
| logger.js | 分级日志 + audit |
| spatialIndex.js | **后端版** RBush 多边形覆盖查询（`createSpatialIndex` + `queryByPolygon`，BBox 粗筛 + booleanPointInPolygon） |

> 816-专项6 12：`floodLevelsStore.js`（251 档 gz 加载器）已删除——Express 侧自 8-2/8-3 回退 6 档 floodArea.json 后无生产消费者（251 档表仅 FastAPI 消费）。

## 9. 依赖

运行时：`@turf/turf`（空间分析）、`bcryptjs`（密码哈希）、`cookie-parser`、`cors`、`express@5`、`express-rate-limit`（限流）、`helmet`（安全头）、`jsonwebtoken`（JWT）。
开发：`vitest`。
脚本：`dev`（node --watch）、`start`、`test`（vitest run）。

## 10. 测试
- `backend/controllers/__tests__/`：`app.test.js`、`auth.test.js`。
- `backend/services/` 与 `backend/utils/` 含 vitest 用例。
- 测试钩子：`_cache` / `_clearCacheForTest`（readStaticJson）。
- `vitest.config.js`：后端测试配置。

---

# 04 · FastAPI 洪涝在线演算服务（backend/flood-service/）

> 洪涝在线演算微服务（路线 B ④）。独立容器（`flood-service`），生产经 nginx 内网反代（`/flood-online` → `flood-service:8000`），不暴露公网。

## 1. 目录结构

```
backend/flood-service/
├── main.py                # FastAPI 应用：路由、档位缓存、预计算表加载
├── flood_engine.py        # 连通性淹没演算引擎
├── precompute_levels.py   # 预计算档位表生成（251 档，多进程）
├── tests/test_main.py     # 测试
├── requirements.txt       # 依赖（numpy/scipy/rasterio/fastapi/uvicorn）
├── Dockerfile
└── start.bat              # Windows 启动脚本
```

## 2. 核心算法（flood_engine.py）

**海平面抬升淹没模型**：水从海面（DEM NoData 区域）进入，只淹没与海面 8 连通的高程低于水位的区域。

```python
# 算法流程
mask = (DEM <= level)          # 低水位区
combined = mask | nodata_mask  # 淹没区 + 海域合并
labels = ndimage.label(combined, STRUCT8)  # 8 连通连通域标注
sea_labels = labels[nodata_mask]          # 海域分量
connected = labels ∈ sea_labels           # 保留与海连通的区域
result = connected & flooded              # 真正的淹没区
```

**关键函数**：

| 函数 | 职责 |
| ---- | ---- |
| `load_dem(downsample=4)` | 读取裁切 DEM（UTM48N，填洼版），模块级缓存（30m → 120m，约 425 万像素） |
| `compute_flood_mask(dem, nodata, level)` | 连通性淹没 mask（与海面 8 连通的低洼区） |
| `mask_to_geojson(mask, transform, crs, simplify_tol=180)` | mask → EPSG:4326 多边形；先 UTM 简化再转 4326；过滤 <0.25km² 碎片与小内环 |
| `compute_impact(level, features, facilities)` | 设施影响评估：淹没多边形 ∩ 设施点 → 受影响设施 + 总损失（loss = value × damageRate） |
| `run_online_flood(level, downsample=4, simplify_tol=180)` | 在线演算入口：返回 `{level, featureCount, floodedKm2, features}` |
| `_polygon_area_deg2(geom)` | 多边形面积近似（度²，鞋带公式） |

**常量**：`DEM_PATH`（`filled_utm48n_cut.tif`，gitignored 需本地生成）、`DOWNSAMPLE=4`、`STRUCT8`、`MIN_AREA_DEG2=0.0002`。

## 3. FastAPI 应用（main.py）

**启动**：`uvicorn main:app --port 8000`。

**lifespan**：启动时预热预计算档位表（gzip 解压 + JSON 解析 ~1.5s）。

**CORS**：开发期允许 Vite dev（5173）；生产由 nginx 同源反代，无需 CORS。

**缓存**：
- `_levels_cache`：预计算档位表（进程内只读一次，`flood_levels.json.gz`）。
- `_cached_level`：64 档 LRU 动态演算缓存（`OrderedDict`，查表 miss 时兜底）。
- `_facilities_cache`：设施清单懒加载。

**接口**：

| 方法 | 路径 | 参数 | 说明 |
| ---- | ---- | ---- | ---- |
| GET | /api/flood/online | level（0-25m） | 淹没 GeoJSON。先查预计算表（秒回），miss 走 LRU 动态演算 |
| GET | /api/flood/impact | level（0-25m） | 设施影响评估（共用档位表，空间筛选） |
| GET | /health | - | 健康检查 |

**前端调用**：经 Vite proxy `/flood-online` → 8000（rewrite 去掉前缀），`floodAdapter` 的 online 模式。

## 4. 预计算档位表

- 文件：`backend/data/flood/flood_levels.json.gz`（2.9MB，251 档，0~25m/0.1m 步长）。
- 由 `precompute_levels.py` 多进程生成。
- 与 Express 后端分工：Express 侧 6 档（0/2/5/8/10/15）走 `floodArea.json`（8-2/8-3 回退）；251 档预计算表仅 FastAPI 消费（816-专项6 12：floodLevelsStore.js 已删）。
- **查表命中秒回（<10ms）**，消灭滑块拖动延迟；查表 miss（表缺失/越界档）回退 LRU 动态演算兜底。

## 5. 前端数据源双模式对照

| 模式 | 淹没范围 | 影响评估 |
| ---- | -------- | -------- |
| api（Express） | `/api/flood/flood-areas`（251 档查表 + 6 档兜底） | `/api/flood/analysis/disaster` |
| online（FastAPI） | `/flood-online/api/flood/online` | `/flood-online/api/flood/impact` |

- 生产 `VITE_DATA_SOURCE=online` 走 FastAPI 真算法；缺省 `api` 走 Express 查表兜底。
- 两端风险等级映射保持同表（`deriveRiskLevel`，6 档：0 无风险 / 2 低 / 5 中 / 8 高 / 10 极高 / 15 灾难级；Q2 816 拍板：0 档统一「无风险」）。

## 6. 依赖与 Docker

`requirements.txt`：`numpy`、`scipy`（连通域标注）、`rasterio`（自带 GDAL）、`shapely`、`affine`、`fastapi`、`uvicorn`。

Dockerfile 构建 FastAPI 容器；docker-compose 中数据以 ro volume 共享 `backend/data`（预计算表只读）。

---

# 05 · 数据资产与依赖关系

## 1. 数据文件清单（backend/data/）

### 1.1 预测数据（backend/data/forecast/）
| 文件 | 说明 |
| ---- | ---- |
| index.json | 指标索引（前端 /forecast/overview 读取） |
| cargo.json | 吞吐量（真数据，走吞吐量模型产物） |
| container.json | 集装箱（真数据，走趋势外推引擎） |
| berth.json | 泊位（合成示意数据，文件自带 historical+forecast） |
| traffic.json | 交通（合成示意数据，同上） |
| throughput_model.json | 吞吐量模型产物（tools/throughput_model.cjs 生成，`npm run forecast:model`） |

### 1.2 选址数据（backend/data/site-selection/）
| 文件 | 说明 |
| ---- | ---- |
| qz_*.json | 钦州各类设施 POI（hospital/primary_school/middle_school/park/bus_station/mall） |
| xiaoqu.json | 小区数据（评分候选） |

### 1.3 洪涝数据（backend/data/flood/）
| 文件 | 说明 |
| ---- | ---- |
| facilityPoints.json | 设施点（83 设施，含 elevation/value/damageRate） |
| floodArea.json | 淹没范围（6 档 floodZones） |
| floodStatistics.json | 统计数据 |
| flood_levels.json.gz | **251 档预计算表**（0~25m/0.1m 步长，Express 与 FastAPI 共用） |
| terrainProfile.json | 地形剖面 |
| water-area.json | 水域边界坐标 |
| dem/filled_utm48n_cut.tif | **gitignored**，洪涝 online 演算输入（连通性演算） |

### 1.4 其他
| 文件 | 说明 |
| ---- | ---- |
| ports.json | 港口列表（公开） |
| plans.json | 用户方案（运行时读写） |
| users.json | 用户（运行时读写，bcrypt 哈希密码） |

### 1.5 静态资源（backend/static/）
| 文件 | 说明 |
| ---- | ---- |
| dem/dem_hillshade.tif | 2D 洪涝真实地形图层（COG） |
| dem/dem_hillshade.png | 3D 山体阴影叠加层 |
| dem/dem_elev.bin/.hdr | DEM 高程二进制 |
| terrain/ | CTB 瓦片 z0-12（Cesium 真 3D 地形，3848 文件） |

## 2. 工具脚本（tools/ 与 scripts/）

| 脚本 | 职责 |
| ---- | ---- |
| tools/dem-pipeline/01-mosaic.ps1 | DEM 拼接（QGIS GDAL） |
| tools/dem-pipeline/02-fill-sinks.ps1 | 填洼 |
| tools/dem-pipeline/03-reproject-4326.ps1 | 重投影 4326 |
| tools/dem-pipeline/04-generate-flood-data.py | 生成洪涝数据 |
| tools/dem-pipeline/05-fix-facility-elevation.py | 修正设施高程 |
| tools/throughput_model.cjs | 生成吞吐量模型产物（`npm run forecast:model`） |
| tools/run-flood.cjs | 跨平台启动 FastAPI（`npm run dev:flood`） |
| tools/perf-bench/server-bench.mjs | 服务器性能基准 |
| tools/git-clean-history.sh / git-health-check.sh | Git 清理/健康检查 |
| tools/prep-ids.cjs / rebase-ids.cjs / sync-refs.cjs / check-issue-ids.cjs | 问题编号管理 |
| scripts/rollback.sh | 部署回滚 |
| scripts/server-setup.sh | 服务器初始化 |
| scripts/measure-title.mjs | 标题测量 |

## 3. 依赖关系图

```
┌──────────────────────────────────────────────────────────────┐
│                        前端 (frontend/)                        │
│                                                              │
│  views / router / App / main        (L8/L7)                  │
│        │                              │                      │
│  business (site-selection/forecast/   │                      │
│            flood-analysis)      (L6)  │                      │
│        │                              │                      │
│  ┌─────┴──────────┬──────────┐        │                      │
│  │ services(L3)   │ stores(L2)│        │                      │
│  │  mapDataService│  flood   │        │                      │
│  │  floodAdapter  │  forecast│        │                      │
│  │  forecastAdapter│  map    │        │                      │
│  └─────┬──────────┴────┬─────┘        │                      │
│        │               │              │                      │
│  ┌─────▼───────────────▼─────┐        │                      │
│  │      core (L5) GIS核心      │        │                      │
│  │  MapRenderer / OLRenderer /│        │                      │
│  │  CesiumRenderer            │        │                      │
│  │  BusinessLayerManager      │        │                      │
│  │  layerAdapters / GCS布局    │        │                      │
│  └─────┬───────────────┬─────┘        │                      │
│        │               │              │                      │
│  ┌─────▼──────────┐ ┌───▼────────┐    │                      │
│  │ shared(L1)     │ │types(L0)   │    │                      │
│  │ useApiRequest  │ │纯类型契约    │    │                      │
│  │ loadStatic     │ └────────────┘    │                      │
│  │ useAuth/useGCS │                    │                      │
│  └───────────────┘                    │                      │
└───────────────┬──────────────────────┘
                │  HTTP (fetch / Cookie 认证)
                ▼
┌──────────────────────────────────────────────────────────────┐
│                     后端 (backend/)                            │
│                                                              │
│  routes → controllers → services → repositories → data/*.json │
│            │          │                │                      │
│            │          └── forecastEngine / modelLoader        │
│            └── middleware (auth / logSanitizer)              │
│            └── utils (BusinessError / createReadCache /       │
│                      readStaticJson / fileStore / spatialIndex)│
└───────────────┬──────────────────────────────────────────────┘
                │  /flood-online (Vite proxy / nginx)
                ▼
┌──────────────────────────────────────────────────────────────┐
│                  FastAPI 洪涝服务 (flood-service/)              │
│              main.py + flood_engine.py                         │
│         + 251 档预计算表 (flood_levels.json.gz)                 │
└──────────────────────────────────────────────────────────────┘
```

## 4. 架构守护规则（.dependency-cruiser.cjs）

前端依赖方向由 dependency-cruiser 强制（`npm run cruise`，CI -T err 强制拦截）：

| 规则 | 内容 |
| ---- | ---- |
| core-imports-business | core 不得依赖 business/views |
| services-imports-business | services 不得依赖 business/views |
| business-cross-import-* | 业务模块之间禁止互引（双向） |
| renderers-cross-reference | 渲染器之间禁止互相引用 |
| stores-imports-business | store 不得导入业务模块 |
| shared-imports-business | shared 不得反向依赖业务层 |
| shared-not-import-core / -stores | shared 不得依赖 core/stores |
| visualization-should-not-import-business | 可视化不得反向依赖业务 |
| types-not-import-shared | types 为纯类型层，禁止 import shared 运行时工具 |
| services-not-import-core | services 禁止 import core（唯一例外 `core/config/map`） |
| no-circular | 禁止循环依赖 |

**后端注意**：前端 `services/` 与后端 `utils/` 各有一份 `spatialIndex`，实现不同（前端=视口 rbush 矩形裁剪；后端=turf 多边形覆盖查询），勿混用。

## 5. 请求数据源三态演进

```
mock（前端契约桩，已基本收归后端）
  → api（Express 读 JSON/查 251 档表）
  → online（FastAPI 真演算）
  → PostgreSQL + GeoServer（规划必上路线）
```

生产由 `VITE_DATA_SOURCE` 构建期注入（`online` = 洪涝走 FastAPI；`api` = Express 兜底）。

---

# 06 · 运行与构建

## 1. 环境要求

- Node.js ≥ 22.18（见根 `package.json` engines：`^22.18.0 || >=24.12.0`）
- npm
- Docker（可选，仅容器部署用）
- Python（可选，仅洪涝 online 演算用）

## 2. 安装

```bash
git clone <repo-url>
cd beibu-gulf-project
npm install            # 根依赖（含前端）
cd backend && npm install   # 后端依赖
```

> 前端 `node_modules` 实际位于项目根（Vite 以 cwd=frontend 运行，Cesium 路径已在 vite.config.js 显式指向 `../node_modules/cesium`）。

## 3. 必需环境变量（两份 .env，均不入 git）

```bash
# 根目录 .env（前端构建注入）
VITE_TIANDITU_KEY=<天地图 key，申请：https://console.tianditu.gov.cn>

# backend/.env（后端运行时）
JWT_SECRET=<32+ 字符随机串，否则后端启动即抛错>
```

生产可选：`VITE_DATA_SOURCE=online`（洪涝走 FastAPI）、`CORS_ORIGIN`（逗号分隔多源）。

## 4. 本地启动

```bash
# 终端 1：前端
npm run dev            # Vite :5173

# 终端 2：后端（Express :3000）
npm run dev:server     # 同时启动 Express + FastAPI(洪涝)
```

或一键启动：

```bash
npm run dev:all        # 前端 + 后端 + 洪涝
```

- 前端默认 `http://localhost:5173`，后端默认 `http://localhost:3000`。
- Vite proxy：`/api`、`/static` → :3000；`/flood-online` → :8000。

### 洪涝 online 模式（连通性演算，可选）

```bash
# 1. 建 Python 环境（首次）
python -m venv backend/flood-service/.venv
backend/flood-service/.venv/Scripts/pip install -r backend/flood-service/requirements.txt

# 2. 起 FastAPI（另开终端）
npm run dev:flood      # uvicorn :8000

# 3. 前端切 online
#    frontend/.env.local 加 VITE_DATA_SOURCE=online
```

## 5. 构建与分析

```bash
npm run build           # typecheck + 前端生产构建（dist/）
npm run build:analyze   # 附带体积分析（dist/stats.html）
```

## 6. 测试

```bash
npm test                # 前端 Vitest（frontend/）
cd backend && npm test  # 后端 Vitest
```

- 前后端全量测试（用例数为动态状态，以 `npm test` 为准；816：README 与本文档均已去除硬编码数字）。
- 架构守护：`npm run cruise`（dependency-cruiser，0 violation 红线）。
- Lint：`npm run lint` / `npm run stylelint` / `npm run typecheck` / `npm run format`。

## 7. 部署

### 7.1 Docker Compose 双容器

```bash
docker compose up --build -d
```

- `app` 容器：nginx + 前端静态产物 + Express 后端（:80/:443/:8443）。
- `flood-service` 容器：FastAPI（内网 :8000，不暴露公网）。
- 数据 volume 挂载：`backend/data`、`backend/static/dem`、`backend/static/terrain`、`./certs`（TLS）。
- 生产环境变量经 `backend/.env` 注入 + `VITE_TIANDITU_KEY` / `VITE_DATA_SOURCE` 构建期 arg。

### 7.2 CI 流水线（GitHub Actions，.github/workflows/ci.yml）

4 job：`audit` → `lint-and-build`（format/lint/cruise/typecheck/gitleaks/测试/build）→ `backend-tests` → `deploy`（main 分支 SSH 自动部署）。

### 7.3 HTTPS

Let's Encrypt + duckdns DNS-01，自动续期（certbot.timer + deploy hook）。

### 7.4 回滚

`scripts/rollback.sh` 配合镜像 tag（docker-compose `IMAGE_TAG`）实现版本回滚。

## 8. 常用 npm 脚本速查

| 脚本 | 作用 |
| ---- | ---- |
| `npm run dev` | 前端开发服务器 |
| `npm run dev:server` | 后端 Express + FastAPI |
| `npm run dev:all` | 全栈开发 |
| `npm run dev:flood` | 洪涝 FastAPI |
| `npm run build` | 生产构建 |
| `npm run build:analyze` | 构建 + 体积分析 |
| `npm test` | 前端测试 |
| `npm run cruise` | 架构守护 |
| `npm run forecast:model` | 重新生成吞吐量模型产物 |
| `cd backend && npm run dev` | 后端开发（node --watch） |

## 9. 已知注意点（来自项目记忆）

- 后端服务必须 `node server/index.js`（实际是 `backend/index.js`）启动，才能经 `app.listen()` 初始化端口监听。
- 前端 Vite proxy 将 `/api` 转发到后端 3000 端口，后端必须运行在 3000。
- `filled_utm48n_cut.tif`（169MB）不入 git，仅影响查表 miss 的越界档位现场演算；0~25m 全部 251 档预计算表已入库，clone 即用。
