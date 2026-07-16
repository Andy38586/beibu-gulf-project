# GCS V3 架构重构实施文档（第三版）

> **文档版本**：V3.4（第四轮修订 - 架构契约补充版）
>
> **修订日期**：2026-07-16
>
> **文档定位**：本文档基于当前 Git 版本真实代码核验编制，是最终施工蓝图。所有实施阶段必须建立在事实基线之上，禁止引用历史聊天记录、已删除版本、已回滚功能、未来规划功能、AI 推测内容。
>
> **核心原则**：【地图稳定】【业务稳定】【展示层重构】【布局层重构】【交互层重构】【业务驱动地图】【业务驱动可视化】【GCS 统一布局】【Cell 统一尺寸来源】【可视化与业务解耦】【首屏仅加载 OL】【3D 按业务动态加载】【Layout Base 布局基座】【路由继承】【平台资产统一】【组件复用优先】
>
> **禁止行为**：方向跑偏 / 重构地图 / 重写业务 / 重做 Renderer / 重建框架 / 引用不存在功能 / 引入第三方模板 / 重新定义布局体系

---

## 目录

- [第〇章 文档使用须知](#第〇章-文档使用须知)
- [第一章 当前代码事实核验（最高优先级）](#第一章-当前代码事实核验最高优先级)
- [第二章 GCS 设计哲学](#第二章-gcs-设计哲学)
- [第三章 Cell 尺寸验证实验](#第三章-cell-尺寸验证实验)
- [第四章 Navigation State 导航状态机](#第四章-navigation-state-导航状态机)
- [第五章 Zone1 业务控制区标准结构](#第五章-zone1-业务控制区标准结构)
- [第六章 Zone3 图层控制区标准结构](#第六章-zone3-图层控制区标准结构)
- [第七章 响应式设计原则](#第七章-响应式设计原则)
- [第八章 项目真正目标](#第八章-项目真正目标)
- [第九章 本次重构范围](#第九章-本次重构范围)
- [第十章 Panel 体系](#第十章-panel-体系)
- [第十一章 地图层要求（稳定基线）](#第十一章-地图层要求稳定基线)
- [第十二章 可视化架构重构](#第十二章-可视化架构重构)
- [第十三章 目录结构重构](#第十三章-目录结构重构)
- [第十四章 实施阶段（修订版）](#第十四章-实施阶段修订版)
- [第十五章 验收与回滚总则](#第十五章-验收与回滚总则)
- [第十六章 架构契约总则（最高优先级）](#第十六章-架构契约总则最高优先级)
- [第十七章 Layout Base（布局基座）原则](#第十七章-layout-base布局基座原则)
- [第十八章 路由布局继承原则](#第十八章-路由布局继承原则)
- [第十九章 首页布局稳定性原则](#第十九章-首页布局稳定性原则)
- [第二十章 首页最终职责定义](#第二十章-首页最终职责定义)
- [第二十一章 业务路由职责定义](#第二十一章-业务路由职责定义)
- [第二十二章 Profile 特殊规则](#第二十二章-profile-特殊规则)
- [第二十三章 UI 边界原则（强制）](#第二十三章-ui-边界原则强制)
- [第二十四章 组件复用优先原则](#第二十四章-组件复用优先原则)
- [第二十五章 平台资产原则](#第二十五章-平台资产原则)
- [第二十六章 未来扩展原则](#第二十六章-未来扩展原则)

---

## 第〇章 文档使用须知

### 0.1 文档读者

| 读者             | 用途                                                   |
| ---------------- | ------------------------------------------------------ |
| 架构师           | 全文审阅，把握全局方向                                 |
| 阶段施工开发人员 | 阅读自己负责阶段的章节 + 第一章事实基线 + 第十一章禁区 |
| 接手交接人       | 阅读每阶段"独立可交接"小节，了解上下文                 |
| 测试 / 验收人员  | 阅读每阶段"验收标准 + 截图验证要求"                    |

### 0.2 施工红线（任何阶段都必须遵守）

| 红线                             | 说明                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 🚫 禁止重构地图引擎              | OLRenderer / CesiumRenderer / MapRenderer 不得修改、不得重写、不得重新继承                                                 |
| 🚫 禁止重新引入新 MapContainer   | 当前 UnifiedMap.vue 已是地图容器，本次重构不替换它，只迁移到新目录                                                         |
| 🚫 禁止重写业务算法              | 后端 siteAnalysisService / scoringService / decayFunctions / importanceMapping 不得修改                                    |
| 🚫 禁止修改地图业务接口契约      | `addPointLayer / addPolygonLayer / addGeoJsonLayer / setVisibility / flyTo / startBreathing / setBaseLayer` 等方法签名不变 |
| 🚫 禁止修改后端 server/ 任何文件 | 后端独立工程                                                                                                               |
| 🚫 禁止硬编码 px                 | 所有布局尺寸必须来自 `CELL_PIXEL` 计算链                                                                                   |
| 🚫 禁止业务层直接操作图表组件    | 业务层只提供数据，不 import ECharts 组件                                                                                   |
| 🚫 **禁止引用不存在功能**        | 所有实施阶段必须建立在第一章事实基线之上                                                                                   |

### 0.3 每阶段交付物清单（强制）

每个阶段交付时必须包含：

1. 该阶段改动文件清单（新增 / 修改 / 删除）
2. `npm run build` 成功截图
3. `GetDiagnostics` 0 error 截图
4. 验收点截图（按各阶段"截图验证要求"）
5. Git 提交节点 hash
6. 回滚验证记录（已验证 `git revert` 可还原）

---

## 第一章 当前代码事实核验（最高优先级）

> **本章是所有后续实施阶段的基准。任何阶段动工前必须先核对本章。禁止将"不存在"的内容误认为"已实现"。**
>
> **核验时间**：2026-07-16（第三轮修订更新）
>
> **核验方式**：直接读取当前 Git 版本代码文件

### 1.1 当前目录树（真实，基于 Git 版本核验）

```
beibu-gulf-project/
├── public/                              # 静态数据
│   ├── data/
│   │   ├── ports.json                   # 港口点数据
│   │   ├── xiaoqu.json                  # 候选小区数据
│   │   └── qz_*.json                    # 钦州 POI（公交/医院/学校/商场/公园）
│   └── beibu-gulf-merged-data.geojson   # 北部湾行政边界合并 GeoJSON
│
├── server/                              # Node.js 后端（独立工程，本次不动）
│   ├── controllers/                     # authController / facilitiesController / markersController / plansController / siteAnalysisController
│   ├── data/                            # markers/plans/xiaoqu/qz_* JSON 数据
│   ├── middleware/auth.js
│   ├── repositories/                    # facilitiesRepository / markersRepository / plansRepository
│   ├── routes/                          # auth / facilities / markers / plans / siteAnalysis
│   ├── services/                        # siteAnalysisService / scoringService / decayFunctions / importanceMapping / userService
│   ├── utils/spatialIndex.js            # R-tree 空间索引
│   ├── app.js / index.js
│   └── package.json
│
└── src/                                 # 前端源码（本次重构主战场）
    ├── components/
    │   ├── analysis/                    # 选址分析组件（已实现）
    │   │   ├── BufferControl.vue         #   选址配置 + 触发分析
    │   │   ├── ResultPanel.vue          #   结果列表
    │   │   ├── RadarFloatPanel.vue       #   ECharts 雷达图浮窗
    │   │   └── OverlayControl.vue
    │   ├── common/                      # AppHeader / ErrorBoundary / InfoPanel
    │   ├── map/                         # 当前地图 UI 组件
    │   │   ├── UnifiedMap.vue           #   ★ 当前地图容器（2D/3D 切换 + 生命周期）
    │   │   ├── LayerPanel.vue           #   图层控制面板（已实现）
    │   │   └── MapSwitcher.vue          #   2D/3D 手动切换按钮
    │   └── user/                        # PlanDrawer / PlanSaveModal / ProfilePanel
    │
    ├── composables/                     # 组合式函数（大部分已实现）
    │   ├── useMapRenderer.js             # ★ 渲染器 inject 契约
    │   ├── useLayerManager.js            # ★ 图层注册门面（回调模式）
    │   ├── useAnalysisLayer.js           # 分析图层更新处理器
    │   ├── useSiteAnalysisApi.js         # 选址分析 API 调用
    │   ├── useBoundaryLayer.js           # 边界图层加载
    │   ├── useFacilities.js              # 设施配置 FACILITY_CONFIG
    │   ├── usePortLayer.js               # 港口图层加载
    │   ├── useMapControls.js             # 地图控制（flyTo/zoom）
    │   ├── useAuth.js                    # 鉴权（login/register/logout/checkAuth）
    │   ├── usePlans.js                   # 方案管理
    │   ├── useApiRequest.js              # HTTP 请求 + token
    │   └── facilityLabels.js             # 设施标签映射
    │
    ├── config/
    │   └── map.js                       # ★ 地图配置（天地图 key/底图/相机/视图层级）
    │
    ├── renderers/                       # ★★ 地图渲染引擎（稳定基线，禁止重构）
    │   ├── MapRenderer.js               #   抽象基类（统一契约）
    │   ├── OLRenderer.js                #   OpenLayers 2D 实现（完整）
    │   ├── CesiumRenderer.js            #   Cesium 3D 实现（完整）
    │   └── index.js                     #   createRenderer 工厂
    │
    ├── router/
    │   └── index.js                     # 路由（仅 3 条：/ / /buffer / /profile）
    │
    ├── services/mapDataService.js       # 静态数据加载
    ├── stores/map.js                    # ★ Pinia 地图状态（图层注册表 + 互斥）
    ├── types/                           # analysis.d.ts / auth.d.ts / plans.d.ts
    │
    ├── views/                          # 页面（仅 3 个）
    │   ├── HomePage.vue                 #   首页（仅 InfoPanel）
    │   ├── BufferPage.vue               #   ★ 选址分析页（已实现完整链路）
    │   └── ProfilePage.vue              #   个人中心
    │
    ├── App.vue                         # ★ 应用根（UnifiedMap + AppHeader + LayerPanel + MapSwitcher + RouterView）
    ├── main.js                         # 入口（Pinia + Router + ElementPlus）
    └── style.css                       # 全局样式（CSS 变量 --unit: 8px）
```

### 1.2 已实现（完整功能，经代码核验）

| 模块                         | 文件                                                                                                      | 说明                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 地图渲染引擎                 | [MapRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/MapRenderer.js)                     | 抽象基类，完整契约：addPointLayer/addPolygonLayer/addGeoJsonLayer/setVisibility/removeLayer/flyTo/exportState/importState/on/off/emit/destroy |
| OL 2D 渲染器                 | [OLRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/OLRenderer.js)                       | 完整实现：底图（天地图 img_w/vec_w）、点/面/GeoJSON 图层、呼吸动画、相机状态导出导入                                                          |
| Cesium 3D 渲染器             | [CesiumRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/CesiumRenderer.js)               | 完整实现：Viewer 初始化、底图、点/面/GeoJSON 实体、呼吸动画（CallbackProperty）、相机状态                                                     |
| 渲染器工厂                   | [index.js](file:///c:/mypython/beibu-gulf-project/src/renderers/index.js)                                 | `createRenderer(type, container)` 工厂函数                                                                                                    |
| 地图容器                     | [UnifiedMap.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/UnifiedMap.vue)                | 当前地图容器：创建渲染器、2D/3D 切换、加载底图/港口/边界、provide(MapRendererKey)、expose flyTo/startBreathing                                |
| 应用根布局                   | [App.vue](file:///c:/mypython/beibu-gulf-project/src/App.vue)                                             | UnifiedMap + AppHeader + LayerPanel + MapSwitcher + RouterView，watch 路由切换视野                                                            |
| 路由                         | [router/index.js](file:///c:/mypython/beibu-gulf-project/src/router/index.js)                             | 3 条路由：`/`(Home) / `/buffer`(BufferPage) / `/profile`(ProfilePage)                                                                         |
| **选址分析业务（完整链路）** | [BufferPage.vue](file:///c:/mypython/beibu-gulf-project/src/views/BufferPage.vue)                         | 入口页：BufferControl 配置 → API 调用 → ResultPanel 结果 → RadarFloatPanel 雷达图                                                             |
| 选址配置组件                 | [BufferControl.vue](file:///c:/mypython/beibu-gulf-project/src/components/analysis/BufferControl.vue)     | 设施勾选 + 重要性 + 触发分析 + 保存方案                                                                                                       |
| 结果列表                     | ResultPanel.vue                                                                                           | 匹配小区列表 + 点击飞行 + 呼吸动画                                                                                                            |
| 雷达图浮窗                   | [RadarFloatPanel.vue](file:///c:/mypython/beibu-gulf-project/src/components/analysis/RadarFloatPanel.vue) | ECharts 雷达图 + 位置自适应 + ResizeObserver                                                                                                  |
| 选址 API                     | [useSiteAnalysisApi.js](file:///c:/mypython/beibu-gulf-project/src/composables/useSiteAnalysisApi.js)     | POST `/site-analysis` 调用后端                                                                                                                |
| 图层状态管理                 | [stores/map.js](file:///c:/mypython/beibu-gulf-project/src/stores/map.js)                                 | layerCatalog + registerBaseLayer（底图互斥）+ registerToggleable（业务图层）+ toggleLayer + 分析结果分发                                      |
| 图层管理门面                 | [useLayerManager.js](file:///c:/mypython/beibu-gulf-project/src/composables/useLayerManager.js)           | 回调模式 + renderer.setVisibility 模式                                                                                                        |
| 图层控制 UI                  | [LayerPanel.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/LayerPanel.vue)                | 底图组（互斥）+ 业务图层组（非互斥）                                                                                                          |
| 地图控制                     | [useMapControls.js](file:///c:/mypython/beibu-gulf-project/src/composables/useMapControls.js)             | flyTo/zoomToRegion/zoomToCity/zoomToDistrict/startBreathing/stopBreathing                                                                     |
| 2D/3D 手动切换               | [MapSwitcher.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/MapSwitcher.vue)              | 底部浮动按钮，切换 mapStore.mapType                                                                                                           |
| 顶部导航栏                   | [AppHeader.vue](file:///c:/mypython/beibu-gulf-project/src/components/common/AppHeader.vue)               | 首页/选址分析/个人主页 RouterLink + 登录按钮                                                                                                  |
| 鉴权                         | [useAuth.js](file:///c:/mypython/beibu-gulf-project/src/composables/useAuth.js)                           | login/register/logout/checkAuth                                                                                                               |
| HTTP 请求                    | useApiRequest.js                                                                                          | apiRequest + token 管理                                                                                                                       |
| 方案管理                     | usePlans.js                                                                                               | getPlans/createPlan/updatePlan/deletePlan                                                                                                     |
| 港口图层                     | usePortLayer.js                                                                                           | loadPorts/buildPortGeoJson/PORT_STYLE                                                                                                         |
| 边界图层                     | useBoundaryLayer.js                                                                                       | loadBoundaryGeoJson/BOUNDARY_STYLE                                                                                                            |
| 设施配置                     | useFacilities.js                                                                                          | FACILITY_CONFIG（6 类设施）                                                                                                                   |
| 分析图层                     | useAnalysisLayer.js                                                                                       | createUpdateHandler（结果 → 地图渲染）                                                                                                        |
| 地图配置                     | [config/map.js](file:///c:/mypython/beibu-gulf-project/src/config/map.js)                                 | 天地图 key + 底图 + 相机 + VIEW_LEVELS（REGION/CITY/DISTRICT）                                                                                |
| 首页                         | [HomePage.vue](file:///c:/mypython/beibu-gulf-project/src/views/HomePage.vue)                             | 仅 InfoPanel（显示选中港口信息）                                                                                                              |
| 个人中心                     | ProfilePage.vue                                                                                           | 个人主页                                                                                                                                      |
| CSS 变量系统                 | [style.css](file:///c:/mypython/beibu-gulf-project/src/style.css)                                         | `--unit: 8px` 全局变量                                                                                                                        |
| **后端选址算法**             | [siteAnalysisService.js](file:///c:/mypython/beibu-gulf-project/server/services/siteAnalysisService.js)   | turf.buffer + turf.union + turf.intersect + 空间索引 + 评分排序                                                                               |
| 后端评分                     | [scoringService.js](file:///c:/mypython/beibu-gulf-project/server/services/scoringService.js)             | 线性衰减评分 + DEFAULT_WEIGHTS                                                                                                                |
| 后端衰减                     | decayFunctions.js                                                                                         | linearDecay                                                                                                                                   |
| 后端重要性映射               | importanceMapping.js                                                                                      | importanceToRadius                                                                                                                            |

### 1.3 部分实现

| 模块                                                                                          | 说明                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [useMapRenderer.js](file:///c:/mypython/beibu-gulf-project/src/composables/useMapRenderer.js) | 仅提供 `inject(MapRendererKey)` 契约，`provide` 在 UnifiedMap.vue 中。这是设计如此，非缺失，但意味着业务组件必须嵌套在 UnifiedMap 内才能拿到渲染器 |

### 1.4 占位实现

> 当前 Git 版本**无占位文件**。所有文件都是真实实现或不存在。

### 1.5 不存在（禁止引用）

| 内容                                          | 真实状态   | 禁止写法                          |
| --------------------------------------------- | ---------- | --------------------------------- |
| `src/views/screen/ScreenLayout.vue`           | **不存在** | 禁止写"迁移 ScreenLayout"         |
| `src/views/screen/ScreenHeader.vue`           | **不存在** | 禁止写"拆解 ScreenHeader"         |
| `src/views/screen/LeftVizPanel.vue`           | **不存在** | 禁止写"解耦 LeftVizPanel"         |
| `src/views/screen/RightFeatureNav.vue`        | **不存在** | 禁止写"替换 RightFeatureNav"      |
| `src/views/features/SiteSelectionFeature.vue` | **不存在** | 禁止写"迁移 SiteSelectionFeature" |
| `src/views/features/ThroughputFeature.vue`    | **不存在** | 禁止写"实现吞吐量页面"            |
| `src/views/features/HeatmapFeature.vue`       | **不存在** | 禁止写"实现热力图页面"            |
| `src/views/features/FactorFeature.vue`        | **不存在** | 禁止写"实现因子可视化页面"        |
| `src/views/features/RouteAnalysisFeature.vue` | **不存在** | 禁止写"实现航线分析页面"          |
| `src/config/features.js`                      | **不存在** | 禁止写"读取 features.js 配置"     |
| `route.meta.engine` 机制                      | **不存在** | 禁止写"按 meta.engine 切换引擎"   |
| 前端算法模块 `siteAnalysis.js`                | **不存在** | 禁止写"禁止重写 siteAnalysis.js"  |
| 前端 `throughputForecast.js`（GM(1,1)）       | **不存在** | 禁止写"禁止重写 GM(1,1)"          |
| 前端 `dijkstra.js`                            | **不存在** | 禁止写"禁止重写 Dijkstra"         |
| 前端 mock 数据 `portCandidates.js`            | **不存在** | 禁止写"迁移 portCandidates.js"    |
| 前端 mock 数据 `throughput.js`                | **不存在** | 禁止写"迁移 throughput.js"        |
| 前端 mock 数据 `routes.js`                    | **不存在** | 禁止写"迁移 routes.js"            |
| AHP 层次分析法                                | **不存在** | 禁止写"禁止重写 AHP"              |
| 吞吐量预测业务                                | **不存在** | 禁止写"实现吞吐量业务"            |
| 因子可视化业务                                | **不存在** | 禁止写"实现因子可视化业务"        |
| 热力图业务                                    | **不存在** | 禁止写"实现热力图业务"            |
| 航线分析业务                                  | **不存在** | 禁止写"实现航线分析业务"          |
| 左侧折线图面板                                | **不存在** | 禁止写"迁移折线图面板"            |
| 四区 Zone 布局                                | **不存在** | 禁止写"迁移 Zone 布局"            |
| GCS 布局系统                                  | **不存在** | 禁止写"迁移 GCS 系统"             |
| `CELL_PIXEL` 参数                             | **不存在** | 禁止写"调整 CELL_PIXEL"           |
| `useGCS.js` composable                        | **不存在** | 禁止写"修改 useGCS.js"            |
| `GcsPanel/GcsCell/GcsCellButton` 组件         | **不存在** | 禁止写"重构 GcsPanel"             |

### 1.6 未来规划（本次重构不实现）

| 业务             | 说明                                                 |
| ---------------- | ---------------------------------------------------- |
| 吞吐量预测       | 需 GM(1,1) 灰色预测算法 + 折线图                     |
| 因子可视化       | 需多因子叠加图层                                     |
| 热力图           | 需核密度散点                                         |
| 航线分析         | 需 Dijkstra 最短路径 + 3D Cesium 大圆弧              |
| AHP 层次分析法   | 未来可能替换当前线性衰减评分                         |
| 业务驱动 3D 切换 | 未来用 `route.meta.engine` 替代 MapSwitcher 手动切换 |

### 1.7 当前布局现状（真实）

```
当前布局（App.vue）：
┌──────────────────────────────────────────────────────────┐
│  AppHeader（绝对定位顶部，z-50，height: 7×--unit=56px）  │  ← 首页/选址分析/个人主页 + 登录
├──────────┬───────────────────────────────┬──────────────┤
│ LayerPanel│                              │  BufferPage  │
│ (左上,    │     UnifiedMap（全屏 z-1）    │  (右侧,      │
│  z-100)   │                              │  z-55)       │
│           │                              │              │
│           │     RouterView（z-50）       │              │
│           │                              │              │
│           │     MapSwitcher（底部居中）  │              │
└──────────┴───────────────────────────────┴──────────────┘

尺寸系统：CSS 变量 --unit: 8px
- AppHeader height: calc(7 * var(--unit)) = 56px
- LayerPanel top: calc(9 * var(--unit)) = 72px, width: calc(39 * var(--unit)) = 312px
- BufferPage right: calc(2.5 * var(--unit)) = 20px, width: calc(39 * var(--unit)) = 312px
- RadarFloatPanel left: calc(1.25 * var(--unit)) = 10px, width: calc(39 * var(--unit)) = 312px
```

---

## 第二章 GCS 设计哲学

> **本章目的**：统一未来所有开发人员对 GCS 体系的理解，明确 CELL / PANEL / ZONE / BUSINESS 四层关系。

### 2.1 四层关系

```
CELL                    ← 数学单位（仅用于计算位置与尺寸）
  ↓
PANEL                   ← 可见交互对象（Frosted Glass 容器）
  ↓
ZONE                    ← 容器（只负责位置，不负责内容）
  ↓
BUSINESS                ← 业务内容（可拖拽、可配置、可替换）
```

### 2.2 CELL：数学单位

> **CELL 不是组件。CELL 不是按钮。CELL 不是面板。CELL 只是数学单位。**

| 属性   | 说明                               |
| ------ | ---------------------------------- |
| 本质   | 最小布局单元，用于计算位置与尺寸   |
| 可见性 | 不可见（不渲染任何 UI）            |
| 职责   | 提供统一的尺寸计算基准             |
| 类比   | 网格纸的格子（用于对齐，不是内容） |

**禁止理解**：

- ❌ Cell 是按钮
- ❌ Cell 是组件
- ❌ Cell 是面板

**正确理解**：

- ✅ Cell 是数学单位，用于计算 Panel 的位置与尺寸

### 2.3 PANEL：可见交互对象

> **PANEL 才是可见对象。所有可见交互对象都是 Panel。**

| 对象                     | 是 Panel    | 说明                     |
| ------------------------ | ----------- | ------------------------ |
| Home 按钮                | ✅ 是 Panel | 占 2×1 Cell 的按钮 Panel |
| User 按钮                | ✅ 是 Panel | 占 2×1 Cell 的按钮 Panel |
| 业务入口按钮（选址分析） | ✅ 是 Panel | 占 2×1 Cell 的按钮 Panel |
| 图层按钮                 | ✅ 是 Panel | 占 2×1 Cell 的按钮 Panel |
| 城市定位按钮（钦州）     | ✅ 是 Panel | 占 4×1 横条内的子 Panel  |
| 雷达图面板               | ✅ 是 Panel | 占 4×4 Cell 的图表面板   |
| 折线图面板               | ✅ 是 Panel | 占 4×4 Cell 的图表面板   |
| 业务区容器               | ✅ 是 Panel | 占 4×4 Cell 的容器 Panel |
| 图层区容器               | ✅ 是 Panel | 占 4×4 Cell 的容器 Panel |

**Panel 统一视觉语言**：

| 属性          | 统一来源                                        |
| ------------- | ----------------------------------------------- |
| 尺寸          | CELL_PIXEL 计算                                 |
| 圆角          | 统一 `border-radius: calc(CELL_PIXEL × 0.15)`   |
| Frosted Glass | 统一 `backdrop-filter: blur(CELL_PIXEL × 0.15)` |
| 边距          | 统一 CONTENT_PADDING                            |
| 阴影          | 统一 box-shadow                                 |

> 目标：达到 iPhone 桌面 Widget 排列的对齐感。

### 2.4 ZONE：容器

> **ZONE 只是容器。只负责位置。不负责内容。**

| 属性 | 说明                                 |
| ---- | ------------------------------------ |
| 本质 | 四区象限容器                         |
| 职责 | 提供位置（左上/右上/左下/右下）      |
| 内容 | 不关心放什么 Panel                   |
| 类比 | 书架的格子（用于放置书，不是书本身） |

**Zone 与 Business 彻底解耦**：

| 原则            | 说明                             |
| --------------- | -------------------------------- |
| Zone 只负责位置 | 不关心放什么 Panel               |
| Panel 负责内容  | 不关心自己在哪个 Zone            |
| 可配置          | Zone 与 Panel 的绑定关系可持久化 |
| 可拖拽          | 未来允许 Panel 在 Zone 间拖拽    |

**示例**：

- 雷达图 Panel 从 Zone2 拖到 Zone4 → 允许
- 业务按钮 Panel 从 Zone1 拖到 Zone3 → 允许
- Zone 不能写死业务 → Zone 只负责位置

### 2.5 BUSINESS：业务内容

> **BUSINESS 只是业务内容。未来允许拖拽、配置、替换。**

| 属性   | 说明                                         |
| ------ | -------------------------------------------- |
| 本质   | 具体业务内容（雷达图、业务按钮、图层按钮等） |
| 职责   | 提供业务功能                                 |
| 位置   | 不关心自己在哪个 Zone                        |
| 可替换 | 未来可拖拽到其他 Zone                        |

**示例**：

- 选址分析业务按钮 → 业务内容
- 雷达图 → 业务内容
- 图层控制按钮 → 业务内容

### 2.6 设计哲学总结

| 层       | 本质         | 可见性           | 职责             | 类比         |
| -------- | ------------ | ---------------- | ---------------- | ------------ |
| CELL     | 数学单位     | 不可见           | 提供尺寸计算基准 | 网格纸的格子 |
| PANEL    | 可见交互对象 | 可见             | 承载业务内容     | 书           |
| ZONE     | 容器         | 可见（容器边框） | 提供位置         | 书架的格子   |
| BUSINESS | 业务内容     | 可见             | 提供业务功能     | 书的内容     |

**核心原则**：

- CELL 只是数学单位，不是组件
- PANEL 才是可见对象，所有交互对象都是 Panel
- ZONE 只是容器，只负责位置，不负责内容
- BUSINESS 只是业务内容，可拖拽、可配置、可替换
- Zone 与 Business 彻底解耦

---

## 第三章 Cell 尺寸验证实验

> **本章目的**：在正式施工前确定 CELL_PIXEL 尺寸标准。当前实施文档默认 CELL_PIXEL=80，但尚未验证。
>
> **原则**：CELL_PIXEL 属于待确认参数，必须通过实验验证后才能确定最终值。

### 3.1 实验方案

| 方案       | CELL_PIXEL | 4×4 面板尺寸  | 2×1 按钮尺寸 | 说明                   |
| ---------- | ---------- | ------------- | ------------ | ---------------------- |
| 方案 A     | 60         | 240×240px     | 120×60px     | 紧凑型                 |
| 方案 B     | 70         | 280×280px     | 140×70px     | 适中偏小               |
| **方案 C** | **80**     | **320×320px** | **160×80px** | **适中型（当前默认）** |
| 方案 D     | 90         | 360×360px     | 180×90px     | 宽松型                 |

### 3.2 各方案分析

#### 方案 A：CELL_PIXEL=60

| 维度       | 桌面端 16:10                     | 桌面端 16:9            | 超宽屏 21:9         | 平板       | 移动端     |
| ---------- | -------------------------------- | ---------------------- | ------------------- | ---------- | ---------- |
| 按钮尺寸   | 120×60px                         | 120×60px               | 120×60px            | 120×60px   | 120×60px   |
| 图表尺寸   | 240×240px                        | 240×240px              | 240×240px           | 240×240px  | 240×240px  |
| 面板尺寸   | 240×240px                        | 240×240px              | 240×240px           | 240×240px  | 240×240px  |
| 可读性     | ⚠️ 按钮文字偏小                  | ⚠️ 按钮文字偏小        | ✅ 可接受           | ⚠️ 偏小    | ⚠️ 偏小    |
| 空间利用率 | ✅ 高                            | ✅ 高                  | ⚠️ 过低（浪费空间） | ✅ 高      | ✅ 高      |
| 优点       | 移动端友好，信息密度高           | 移动端友好，信息密度高 | -                   | 移动端友好 | 移动端友好 |
| 缺点       | 桌面端图表偏小，雷达图轴标签拥挤 | 桌面端图表偏小         | 超宽屏浪费空间      | 平板偏小   | 手机仍偏小 |

**结论**：适合移动端优先场景，但桌面端体验不佳。

#### 方案 B：CELL_PIXEL=70

| 维度       | 桌面端 16:10         | 桌面端 16:9          | 超宽屏 21:9  | 平板       | 移动端     |
| ---------- | -------------------- | -------------------- | ------------ | ---------- | ---------- |
| 按钮尺寸   | 140×70px             | 140×70px             | 140×70px     | 140×70px   | 140×70px   |
| 图表尺寸   | 280×280px            | 280×280px            | 280×280px    | 280×280px  | 280×280px  |
| 面板尺寸   | 280×280px            | 280×280px            | 280×280px    | 280×280px  | 280×280px  |
| 可读性     | ✅ 可接受            | ✅ 可接受            | ✅ 可接受    | ⚠️ 偏小    | ⚠️ 偏小    |
| 空间利用率 | ✅ 高                | ✅ 高                | ⚠️ 偏低      | ✅ 高      | ✅ 高      |
| 优点       | 桌面/移动端平衡      | 桌面/移动端平衡      | 可接受       | 可接受     | 可接受     |
| 缺点       | 4×4 面板放雷达图略紧 | 4×4 面板放雷达图略紧 | 超宽屏仍偏紧 | 平板仍偏小 | 手机仍偏小 |

**结论**：桌面/移动端平衡方案，但 4×4 面板放雷达图略紧。

#### 方案 C：CELL_PIXEL=80（当前默认）

| 维度       | 桌面端 16:10                               | 桌面端 16:9      | 超宽屏 21:9    | 平板         | 移动端     |
| ---------- | ------------------------------------------ | ---------------- | -------------- | ------------ | ---------- |
| 按钮尺寸   | 160×80px                                   | 160×80px         | 160×80px       | 160×80px     | 160×80px   |
| 图表尺寸   | 320×320px                                  | 320×320px        | 320×320px      | 320×320px    | 320×320px  |
| 面板尺寸   | 320×320px                                  | 320×320px        | 320×320px      | 320×320px    | 320×320px  |
| 可读性     | ✅ 舒适                                    | ✅ 舒适          | ✅ 舒适        | ✅ 可接受    | ⚠️ 偏大    |
| 空间利用率 | ✅ 高                                      | ✅ 高            | ✅ 高          | ✅ 高        | ⚠️ 偏低    |
| 优点       | 桌面端雷达图舒适，按钮可放下"选址分析"4 字 | 桌面端雷达图舒适 | 超宽屏也可接受 | 平板可接受   | -          |
| 缺点       | 移动端需降级到 60                          | 移动端需降级     | -              | 移动端需降级 | 手机需降级 |

**结论**：桌面端体验最佳，4×4 面板 320×320px 与当前 LayerPanel/BufferPage 的 `calc(39 * var(--unit)) = 312px` 接近，迁移成本低。**推荐作为桌面端默认值**。

#### 方案 D：CELL_PIXEL=90

| 维度       | 桌面端 16:10               | 桌面端 16:9                | 超宽屏 21:9 | 平板         | 移动端         |
| ---------- | -------------------------- | -------------------------- | ----------- | ------------ | -------------- |
| 按钮尺寸   | 180×90px                   | 180×90px                   | 180×90px    | 180×90px     | 180×90px       |
| 图表尺寸   | 360×360px                  | 360×360px                  | 360×360px   | 360×360px    | 360×360px      |
| 面板尺寸   | 360×360px                  | 360×360px                  | 360×360px   | 360×360px    | 360×360px      |
| 可读性     | ✅ 非常舒适                | ✅ 非常舒适                | ✅ 非常舒适 | ✅ 舒适      | ⚠️ 过大        |
| 空间利用率 | ⚠️ 偏低                    | ⚠️ 偏低                    | ✅ 高       | ⚠️ 偏低      | ❌ 过低        |
| 优点       | 桌面端图表宽松，视觉舒展   | 桌面端图表宽松             | 超宽屏最佳  | -            | -              |
| 缺点       | 4 区面板可能挤压地图可视区 | 4 区面板可能挤压地图可视区 | -           | 平板挤压地图 | 手机完全不可用 |

**结论**：仅适合超宽屏 21:9，其他场景不推荐。

### 3.3 推荐区间

> **推荐区间：CELL_PIXEL ∈ [70, 90]，桌面端默认值 80。**

#### 3.3.1 为什么选择该区间

1. **下界 70**：保证 4×4 面板（280×280px）能容纳 ECharts 雷达图 + 轴标签（6 个因子名），不出现文字截断
2. **上界 90**：保证四区面板（4×4=360×360px）在 1366×768 笔记本屏幕上不挤压地图可视区（四区合计占用约 50% 屏宽）
3. **默认 80**：4×4 面板 320×320px，与当前 LayerPanel/BufferPage 的 `calc(39 * var(--unit)) = 312px` 接近，迁移成本低

#### 3.3.2 如何影响各对象

| 对象       | CELL_PIXEL=80 时                           | 影响                                   |
| ---------- | ------------------------------------------ | -------------------------------------- |
| 面板大小   | 4×4 = 320×320px                            | 容纳雷达图/折线图/结果列表             |
| 按钮大小   | 2×1 = 160×80px                             | "选址分析"4 字 + 图标可放下            |
| 图表大小   | 4×4 面板内容区约 296×296px（减去 padding） | ECharts 雷达图 radius 65% = 96px，舒适 |
| 移动端布局 | 需降级到 CELL_PIXEL=60 或切换为单列堆叠    | 4 区从象限布局改为纵向堆叠             |

### 3.4 响应式策略

| 视口宽度                         | CELL_PIXEL | 布局策略               |
| -------------------------------- | ---------- | ---------------------- |
| ≥ 1920px（21:9/16:9 桌面）       | 90         | 四区象限布局           |
| 1366–1919px（16:10/16:9 笔记本） | 80（默认） | 四区象限布局           |
| 1024–1365px（平板横屏）          | 70         | 四区象限布局，面板紧凑 |
| 768–1023px（平板竖屏）           | 60         | 四区改为左右两列堆叠   |
| < 768px（移动端）                | 60         | 单列纵向堆叠，面板全宽 |

### 3.5 实验结论

> **CELL_PIXEL 属于待确认参数。在正式实施前，必须通过实验验证各断点下的实际效果，才能确定最终值。**

**实验要求**：

1. 在 Phase 2-A（Cell + Panel 基础组件）阶段，实现 CELL_PIXEL 响应式查表
2. 在各断点（1920px / 1366px / 1024px / 768px / 375px）下截图验证
3. 验证 4×4 面板、2×1 按钮、雷达图的实际效果
4. 根据截图反馈调整 CELL_PIXEL 值

**最终决策**：

- 桌面端默认值：80（推荐）
- 移动端降级值：60（推荐）
- 超宽屏可选值：90（可选）

---

## 第四章 Navigation State 导航状态机

> **本章目的**：分析 Home / Profile 按钮的导航状态机设计，输出设计结论，不直接进入实现阶段。

### 4.1 问题描述

当前设计中，Home 和 Profile 不再是普通路由跳转，需要记录来源页面，实现"再次点击返回来源"的交互。

### 4.2 场景分析

| 场景                                     | 用户行为               | 期望行为       |
| ---------------------------------------- | ---------------------- | -------------- |
| 主页 → 个人中心 → 再次点击个人中心       | 主页 → 个人中心 → ?    | 返回主页       |
| 选址分析页 → 个人中心 → 再次点击个人中心 | 选址 → 个人中心 → ?    | 返回选址分析页 |
| 主页 → 个人中心 → Home                   | 主页 → 个人中心 → Home | 回到主页       |
| 选址 → 个人中心 → Home                   | 选址 → 个人中心 → Home | 回到主页       |

### 4.3 方案对比

#### 方案 A：个人中心按钮 = 切换按钮（记录来源）

| 行为             | 实现                                                       |
| ---------------- | ---------------------------------------------------------- |
| 进入个人中心     | `router.push('/profile')`，记录 `fromRoute = currentRoute` |
| 再次点击个人中心 | `router.back()` 或 `router.push(fromRoute)`                |
| 点击 Home        | `router.push('/')`                                         |

**优点**：

- 一键往返，交互流畅

**缺点**：

- 用户可能困惑"为什么点个人中心变成了返回"
- 不符合常规导航心智模型（用户期望"点击即进入"）
- 如果从个人中心又进入其他页面，fromRoute 会被覆盖
- 实现复杂度高（需维护来源状态）

**用户认知成本**：高（违反心智模型）

**实现复杂度**：高（需维护来源状态 + 处理边界情况）

#### 方案 B：个人中心 = 普通路由 + 全局返回按钮

| 行为                                     | 实现                           |
| ---------------------------------------- | ------------------------------ |
| 个人中心按钮                             | 始终 `router.push('/profile')` |
| 非首页时，个人中心按钮替换为"返回上一页" | `router.back()`                |
| Home 按钮                                | 始终 `router.push('/')`        |

**优点**：

- 心智模型清晰（点击 = 进入，返回 = 返回）
- 符合移动端导航习惯
- 不需要维护来源状态
- 实现复杂度低

**缺点**：

- 个人中心入口在非首页时消失（被返回按钮替代）
- 用户在个人中心时想"再进个人中心"不可能（但通常无此需求）

**用户认知成本**：低（符合心智模型）

**实现复杂度**：低（仅需判断当前路由）

#### 方案 C：双按钮并存

| 行为         | 实现                                |
| ------------ | ----------------------------------- |
| Home 按钮    | 始终显示，`router.push('/')`        |
| 个人中心按钮 | 始终显示，`router.push('/profile')` |
| 返回按钮     | 非首页时额外显示，`router.back()`   |

**优点**：

- 功能完整，无歧义

**缺点**：

- 业务区顶部需要 3 个按钮，占用空间
- 用户可能困惑"为什么有两个返回按钮"

**用户认知成本**：中（功能完整但按钮过多）

**实现复杂度**：中（需管理 3 个按钮的显示逻辑）

### 4.4 推荐分析

| 方案       | 推荐度      | 理由                                             |
| ---------- | ----------- | ------------------------------------------------ |
| 方案 A     | ⚠️ 不推荐   | 心智模型不清晰，用户困惑，实现复杂               |
| **方案 B** | **✅ 推荐** | 心智模型清晰，符合移动端习惯，节省空间，实现简单 |
| 方案 C     | 备选        | 功能完整但占空间，可用于桌面端                   |

### 4.5 方案 B 的潜在问题与缓解

| 问题                               | 缓解                                                |
| ---------------------------------- | --------------------------------------------------- |
| 非首页时个人中心入口消失           | 非首页时用户可通过 Home → 个人中心两步到达          |
| `router.back()` 在历史栈为空时无效 | fallback：`router.back()` 失败时 `router.push('/')` |
| 用户直接 URL 访问非首页            | 此时无历史，返回按钮 fallback 到 Home               |

### 4.6 设计结论

> **推荐方案 B，但本节仅输出设计分析，不直接实施。最终方案由架构师与用户确认后，在实施阶段落地。**

**方案 B 核心设计**：

- Home 按钮：始终显示，`router.push('/')`
- 个人中心按钮：
  - 首页时显示"个人中心"，`router.push('/profile')`
  - 非首页时显示"返回上一页"，`router.back()`（fallback `router.push('/')`）
- 实现简单：仅需判断 `route.name === 'Home'`

---

## 第五章 Zone1 业务控制区标准结构

> **本章目的**：定稿 Zone1 业务控制区的标准结构，禁止继续采用"按钮区 + 业务面板区"两个独立系统。

### 5.1 统一结构

> **统一成一个 4×4 业务控制 Panel。**

### 5.2 内部结构

```
┌──────────────────────────────┐
│  第一行：两个 2×1 按钮        │
│  ┌──────────┐ ┌──────────┐  │
│  │   Home   │ │   User   │  │
│  └──────────┘ └──────────┘  │
├──────────────────────────────┤
│  第二行：4×1 横条             │
│  ┌────────────────────────┐  │
│  │ 钦州 │ 防城港 │ 北海   │  │  ← 城市定位按钮（执行 flyTo 回调）
│  └────────────────────────┘  │
├──────────────────────────────┤
│  第三至第五行：6 个 2×1 按钮  │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │选址分析│ │吞吐量 │ │因子  │ │  ← 业务路由入口
│  └──────┘ └──────┘ └──────┘ │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ 热力图│ │航线分析│ │预留  │ │
│  └──────┘ └──────┘ └──────┘ │
└──────────────────────────────┘
```

### 5.3 第一行：Home + User

| 按钮 | 尺寸      | 行为                                                                         |
| ---- | --------- | ---------------------------------------------------------------------------- |
| Home | 2×1 Panel | `router.push('/')`                                                           |
| User | 2×1 Panel | 首页时 `router.push('/profile')`，非首页时 `router.back()`（见第四章方案 B） |

### 5.4 第二行：4×1 城市横条

| 属性 | 说明                                             |
| ---- | ------------------------------------------------ |
| 尺寸 | 4×1 Panel（横条）                                |
| 作用 | 业务区标题 + 区域提示                            |
| 内部 | 3 个城市子 Panel：钦州 / 防城港 / 北海           |
| 行为 | 点击城市 → 执行 `flyTo(cityCenter)` 地图定位回调 |

### 5.5 第三至第五行：6 个业务入口按钮

| 顺序 | 按钮       | 路由                   | 当前状态              |
| ---- | ---------- | ---------------------- | --------------------- |
| 1    | 选址分析   | `/buffer`              | ✅ 已实现             |
| 2    | 吞吐量预测 | 未来 `/throughput`     | ❌ 不存在（未来规划） |
| 3    | 因子可视化 | 未来 `/factor`         | ❌ 不存在（未来规划） |
| 4    | 热力图     | 未来 `/heatmap`        | ❌ 不存在（未来规划） |
| 5    | 航线分析   | 未来 `/route-analysis` | ❌ 不存在（未来规划） |
| 6    | 预留       | -                      | 未来扩展              |

> **注意**：本次重构**不实现**吞吐量/因子/热力图/航线业务。按钮可先渲染为"即将上线"禁用态，点击不跳转。

### 5.6 统一视觉语言

| 属性     | 统一规则                                      |
| -------- | --------------------------------------------- |
| 尺寸体系 | 所有按钮 2×1 Panel                            |
| 圆角体系 | 统一 `border-radius: calc(CELL_PIXEL × 0.15)` |
| 间距     | 统一 GAP                                      |
| 文字     | 优先文字，图标在下方                          |
| 排列     | 从左到右、从上到下                            |

> 目标：达到 iPhone 桌面 Widget 排列的对齐感。

---

## 第六章 Zone3 图层控制区标准结构

> **本章目的**：定稿 Zone3 图层控制区的标准结构，与 Zone1 镜像对称。

### 6.1 与 Zone1 镜像结构

> **采用与 Zone1 完全相同的结构。**

### 6.2 内部结构

```
┌──────────────────────────────┐
│  第一行：4×1 横条             │
│  ┌────────────────────────┐  │
│  │ 影像底图 │ 矢量底图    │  │  ← 底图切换（互斥）
│  └────────────────────────┘  │
├──────────────────────────────┤
│  第二至第五行：6 个 2×1 按钮  │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │边界   │ │港口   │ │预留  │ │  ← 业务图层开关（非互斥）
│  └──────┘ └──────┘ └──────┘ │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │预留  │ │预留  │ │预留  │ │
│  └──────┘ └──────┘ └──────┘ │
└──────────────────────────────┘
```

### 6.3 第一行：4×1 底图横条

| 属性 | 说明                                                         |
| ---- | ------------------------------------------------------------ |
| 尺寸 | 4×1 Panel（横条）                                            |
| 作用 | 区域标题 + 底图切换                                          |
| 内部 | 2 个子 Panel：影像底图 / 矢量底图（互斥）                    |
| 行为 | 点击 → `renderer.setBaseLayer('image'/'vector')`（已有契约） |
| 互斥 | 通过 `mapStore.registerBaseLayer` 已实现互斥逻辑             |

### 6.4 第二至第五行：6 个图层按钮

| 顺序 | 按钮                 | 当前状态     |
| ---- | -------------------- | ------------ |
| 1    | 行政区划（boundary） | ✅ 已注册    |
| 2    | 港口位置（ports）    | ✅ 已注册    |
| 3    | 预留                 | 未来业务图层 |
| 4    | 预留                 | 未来业务图层 |
| 5    | 预留                 | 未来业务图层 |
| 6    | 预留                 | 未来业务图层 |

| 属性 | 说明                                                  |
| ---- | ----------------------------------------------------- |
| 行为 | 点击 → `useLayerManager.toggleLayer(key)`（已有契约） |
| 互斥 | 业务图层非互斥（`registerToggleable`）                |

### 6.5 对称保证

| 维度         | Zone1 业务区  | Zone3 图层区  |
| ------------ | ------------- | ------------- |
| 尺寸         | 4×4           | 4×4           |
| 第一行       | 2 个 2×1 按钮 | 4×1 横条      |
| 第二行       | 4×1 横条      | -             |
| 第三至第五行 | 6 个 2×1 按钮 | 6 个 2×1 按钮 |
| 圆角         | 统一          | 统一          |
| 间距         | 统一 GAP      | 统一 GAP      |

> Zone1 与 Zone3 在视觉上完全对称，达成 iPhone Widget 排列对齐感。

---

## 第七章 响应式设计原则

> **本章目的**：明确响应式设计原则，禁止仅通过 media query 隐藏面板。

### 7.1 核心要求

> **禁止：仅通过 media query 隐藏面板。**

> **要求：窗口尺寸变化 → CELL 重新计算 → Panel 重新计算 → Zone 重新计算 → 布局重新计算。**

### 7.2 响应式计算链

```
窗口 resize 事件
  ↓
useGCS composable 监听（防抖 150ms）
  ↓
根据视口宽度查表得 CELL_PIXEL
  ↓
派生 PANEL_PIXEL = CELL_PIXEL - 2 × CELL_PADDING
  ↓
派生 GAP = CELL_PADDING × 2
  ↓
所有 Panel 的 :style 响应式更新
  ↓
Zone 容器响应式更新
  ↓
布局自动重排
```

### 7.3 各断点策略

| 视口宽度                         | CELL_PIXEL | 布局策略               |
| -------------------------------- | ---------- | ---------------------- |
| ≥ 1920px（21:9/16:9 桌面）       | 90         | 四区象限布局，面板宽松 |
| 1366–1919px（16:10/16:9 笔记本） | 80（默认） | 四区象限布局           |
| 1024–1365px（平板横屏）          | 70         | 四区象限布局，面板紧凑 |
| 768–1023px（平板竖屏）           | 60         | 四区改为左右两列堆叠   |
| < 768px（移动端）                | 60         | 单列纵向堆叠，面板全宽 |

### 7.4 各断点详细分析

#### 桌面端 16:10（1366×768）

| 维度         | 值                   |
| ------------ | -------------------- |
| CELL_PIXEL   | 80                   |
| 4×4 面板     | 320×320px            |
| 四区总宽     | 320×2 + 10×3 = 670px |
| 地图可视区   | 1366 - 670 = 696px   |
| 地图可视比例 | 696 / 1366 = 51%     |
| 评价         | ✅ 可接受            |

#### 桌面端 16:9（1920×1080）

| 维度         | 值                   |
| ------------ | -------------------- |
| CELL_PIXEL   | 90                   |
| 4×4 面板     | 360×360px            |
| 四区总宽     | 360×2 + 10×3 = 750px |
| 地图可视区   | 1920 - 750 = 1170px  |
| 地图可视比例 | 1170 / 1920 = 61%    |
| 评价         | ✅ 舒适              |

#### 超宽屏 21:9（2560×1080）

| 维度         | 值                   |
| ------------ | -------------------- |
| CELL_PIXEL   | 90                   |
| 4×4 面板     | 360×360px            |
| 四区总宽     | 360×2 + 10×3 = 750px |
| 地图可视区   | 2560 - 750 = 1810px  |
| 地图可视比例 | 1810 / 2560 = 71%    |
| 评价         | ✅ 非常舒适          |

#### 平板横屏（1024×768）

| 维度         | 值                   |
| ------------ | -------------------- |
| CELL_PIXEL   | 70                   |
| 4×4 面板     | 280×280px            |
| 四区总宽     | 280×2 + 10×3 = 590px |
| 地图可视区   | 1024 - 590 = 434px   |
| 地图可视比例 | 434 / 1024 = 42%     |
| 评价         | ⚠️ 偏紧，但可接受    |

#### 平板竖屏（768×1024）

| 维度         | 值                              |
| ------------ | ------------------------------- |
| CELL_PIXEL   | 60                              |
| 布局策略     | 四区改为左右两列堆叠            |
| 左列         | Zone2 + Zone3（垂直堆叠）       |
| 右列         | Zone1 + Zone4（垂直堆叠）       |
| 每列宽       | 360px                           |
| 地图可视区   | 768 - 360×2 = 48px              |
| 地图可视比例 | 48 / 768 = 6%                   |
| 评价         | ❌ 地图几乎不可见，需降级为单列 |

#### 移动端（375×667）

| 维度       | 值                                           |
| ---------- | -------------------------------------------- |
| CELL_PIXEL | 60                                           |
| 布局策略   | 单列纵向堆叠                                 |
| 面板宽     | 全宽（375px）                                |
| 地图       | 在下层，被面板遮挡                           |
| 评价       | ⚠️ 地图不可见，需切换为"地图 + 面板切换"模式 |

### 7.5 移动端降级策略

```
桌面端（四区象限）：          平板竖屏（左右两列）：      移动端（单列堆叠）：
┌─────┬─────┐                ┌─────┬─────┐              ┌─────────┐
│ Z2  │ Z1  │                │ Z2  │ Z1  │              │   Z1    │ ← 业务入口优先
├─────┼─────┤                ├─────┼─────┤              ├─────────┤
│ Z3  │ Z4  │                │ Z3  │ Z4  │              │   Z2    │ ← 可视化
└─────┴─────┘                └─────┴─────┘              ├─────────┤
                             地图在下层                   │   Z4    │ ← 结果
                                                         ├─────────┤
                                                         │   Z3    │ ← 图层
                                                         ├─────────┤
                                                         │  地图   │ ← 全屏底层
                                                         └─────────┘
```

### 7.6 实施约束

- useGCS composable 必须监听 `window.resize`（防抖 150ms）
- CELL_PIXEL 通过 `ref` 响应式存储，所有 Panel 计算函数依赖此 ref
- 移动端降级时，Zone 容器从绝对定位改为 Flex 纵向堆叠
- 移动端需实现"地图 + 面板切换"模式（点击按钮切换地图/面板显示）

---

## 第八章 项目真正目标

### 8.1 项目本质

> 这是一个：**WebGIS 智慧港口选址分析平台**

**不是**：

- ❌ UI 练习项目
- ❌ Dashboard 项目
- ❌ 组件库项目
- ❌ 2D/3D 切换演示项目

### 8.2 价值定位

| 层           | 角色     | 优先级                   |
| ------------ | -------- | ------------------------ |
| 地图         | 载体     | 中（必须稳定，但不抢戏） |
| 可视化       | 展示形式 | 中（服务于业务呈现）     |
| **业务分析** | **核心** | **最高**                 |

**所有架构设计必须服务于业务，不是业务迁就架构。**

### 8.3 本次重构在项目中的位置

本次重构**不增加新业务能力**，只解决"布局混乱 + 业务与可视化耦合 + 交互不一致"三大工程债，为后续业务接入（吞吐量/因子/热力图/航线）扫清架构障碍。

---

## 第九章 本次重构范围

### 9.1 本次属于

| 类型           | 说明                                         |
| -------------- | -------------------------------------------- |
| **展示层重构** | 面板外观、Frosted Glass、对齐体系            |
| **布局层重构** | 四区 Zone 布局替代顶部导航 + 左右固定面板    |
| **交互层重构** | 按钮统一为 Panel、业务入口归一、城市定位归一 |

### 9.2 本次不是

| 类型        | 原因                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| ❌ 地图重构 | 地图框架已完成独立封装（MapRenderer/OLRenderer/CesiumRenderer），已满足当前需求 |
| ❌ 业务重构 | 选址分析业务链路已完整，后端算法已实现                                          |
| ❌ 算法重构 | 线性衰减评分 + Turf 空间分析已满足选址需求                                      |

### 9.3 禁止修改清单

| 禁止项                                                                              | 原因                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| OLRenderer / CesiumRenderer / MapRenderer                                           | 地图引擎稳定，双引擎隔离已实现         |
| UnifiedMap.vue 的渲染器生命周期管理                                                 | 当前 createRenderer + destroy 模式正确 |
| 业务接口契约（addPointLayer 等方法签名）                                            | 业务层依赖                             |
| 后端 server/ 全部文件                                                               | 独立工程                               |
| 后端选址算法（siteAnalysisService/scoringService/decayFunctions/importanceMapping） | 已实现且满足需求                       |
| public/ 静态数据                                                                    | 数据稳定                               |

### 9.4 本次重构重点

| 重点         | 说明                                     |
| ------------ | ---------------------------------------- |
| 业务层布局   | 业务入口从顶部导航迁移到 GCS Panel 体系  |
| 可视化层布局 | 雷达图/折线图从浮窗迁移到 GCS Panel 体系 |
| 交互层布局   | 按钮统一尺寸、统一圆角、统一视觉语言     |

---

## 第十章 Panel 体系

### 10.1 核心原则

> **所有可见交互对象都是 Panel。Cell 不是组件。Cell 只是数学单位。**

### 10.2 禁止的理解方式

| ❌ 错误理解           | 正确理解                                       |
| --------------------- | ---------------------------------------------- |
| Cell 是按钮           | Cell 是数学单位（仅用于计算位置与尺寸）        |
| Cell 是组件           | Cell 不渲染任何 UI                             |
| GcsCellButton 是 Cell | GcsCellButton 是 Panel（占 2×1 Cell 的 Panel） |

### 10.3 正确的三层结构

```
CELL                    ← 数学单位（仅计算位置 w×h）
  ↓
PANEL                   ← 可见交互对象（Frosted Glass 容器）
  ↓
PANEL_CONTENT           ← 面板内容（业务/图表/按钮文字）
```

### 10.4 Panel 分类示例

| 对象                     | 是 Panel    | 不是 Cell    | 说明                     |
| ------------------------ | ----------- | ------------ | ------------------------ |
| Home 按钮                | ✅ 是 Panel | ❌ 不是 Cell | 占 2×1 Cell 的按钮 Panel |
| 个人中心按钮             | ✅ 是 Panel | ❌ 不是 Cell | 占 2×1 Cell 的按钮 Panel |
| 业务入口按钮（选址分析） | ✅ 是 Panel | ❌ 不是 Cell | 占 2×1 Cell 的按钮 Panel |
| 图层按钮                 | ✅ 是 Panel | ❌ 不是 Cell | 占 2×1 Cell 的按钮 Panel |
| 城市定位按钮（钦州）     | ✅ 是 Panel | ❌ 不是 Cell | 占 4×1 横条内的子 Panel  |
| 雷达图面板               | ✅ 是 Panel | ❌ 不是 Cell | 占 4×4 Cell 的图表面板   |
| 折线图面板               | ✅ 是 Panel | ❌ 不是 Cell | 占 4×4 Cell 的图表面板   |
| 业务区容器               | ✅ 是 Panel | ❌ 不是 Cell | 占 4×4 Cell 的容器 Panel |
| 图层区容器               | ✅ 是 Panel | ❌ 不是 Cell | 占 4×4 Cell 的容器 Panel |

### 10.5 Panel 统一视觉语言

| 属性          | 统一来源                                        |
| ------------- | ----------------------------------------------- |
| 尺寸          | CELL_PIXEL 计算                                 |
| 圆角          | 统一 `border-radius: calc(CELL_PIXEL × 0.15)`   |
| Frosted Glass | 统一 `backdrop-filter: blur(CELL_PIXEL × 0.15)` |
| 边距          | 统一 CONTENT_PADDING                            |
| 阴影          | 统一 box-shadow                                 |

> 目标：达到 iPhone 桌面 Widget 排列的对齐感。

---

## 第十一章 地图层要求（稳定基线）

### 11.1 地图必须全屏（保持现有设计）

```
地图（z-1）
  └── UnifiedMap 全屏铺满（position:absolute; inset:0; z-index:1）

Overlay（z-50）
  └── RouterView 浮层（pointer-events:none，子元素 auto）

Panel（z-55+）
  └── GCS 面板浮在地图之上
```

**禁止布局形态**：

- ❌ 地图占中间，面板占两边
- ❌ 地图与面板并排 Grid 布局
- ❌ 面板挤压地图可视区域

**必须保持**：地图永远是底层全屏，面板浮层叠加。当前 [App.vue](file:///c:/mypython/beibu-gulf-project/src/App.vue) 的 `.app-layout` + UnifiedMap 全屏 + `.app-content` 浮层模式正确，本次重构保留该模式。

### 11.2 保持现有 Renderer 与 UnifiedMap

禁止修改：

- [OLRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/OLRenderer.js)
- [CesiumRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/CesiumRenderer.js)
- [MapRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/MapRenderer.js)
- [UnifiedMap.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/UnifiedMap.vue) 的渲染器生命周期管理（`initRenderer` / `switchMapType` / `destroy`）

> **注意**：UnifiedMap.vue 可迁移目录，但其内部的 `createRenderer` / `exportState` / `importState` / `setupLayers` / `setupEvents` 逻辑不得修改。

### 11.3 首屏性能优化（本次不强制，预留方向）

#### 当前现状

当前 UnifiedMap 按 `mapStore.mapType` 只实例化一个渲染器（2D 或 3D），**当前不存在"首屏同时加载 OL+Cesium"的问题**。MapSwitcher 手动切换时才销毁旧渲染器、创建新渲染器。

#### 未来优化方向（本次不实施）

- 删除 MapSwitcher 手动 2D/3D 切换
- 改为业务路由驱动：`route.meta.engine` 决定 mapType
- 进入 3D 业务路由时动态 `import()` CesiumRenderer
- 本次重构**预留**此方向，但**不实施**（因当前只有选址分析一个业务，且是 2D）

---

## 第十二章 可视化架构重构

### 12.1 当前问题

当前选址分析的雷达图（[RadarFloatPanel.vue](file:///c:/mypython/beibu-gulf-project/src/components/analysis/RadarFloatPanel.vue)）存在以下耦合：

```
RadarFloatPanel.vue（一个文件内同时包含）：
  ├── ECharts 雷达图渲染（echarts.init / setOption / dispose）  ← 应属图表层
  ├── 位置自适应逻辑（查询 .layer-panel DOM 位置）              ← 应属布局层
  ├── ResizeObserver 生命周期管理                                ← 应属图表层
  └── 业务数据消费（props.xiaoqu.breakdown）                     ← 来自业务层
```

当前选址分析的数据流：

```
BufferControl → useSiteAnalysisApi → 后端 → 结果 → BufferPage(handleResult)
  → mapStore.setAnalysisResult → analysisHandler → useAnalysisLayer.createUpdateHandler → renderer
  → ResultPanel(列表) + RadarFloatPanel(雷达图)
```

### 12.2 目标：建立三层体系

```
业务层 Business
   ↓ 只返回数据 + 发出指令
地图可视化层 MapVisualization
   ↓ 渲染地图要素
图表可视化层 ChartVisualization
   ↓ 渲染图表
```

### 12.3 三层职责定义

#### 12.3.1 业务层 Business

| 职责         | 说明                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| 调用后端 API | useSiteAnalysisApi.analyze()                                                 |
| 产出结果数据 | `{ coverage, matchedXiaoqu, selectedTypes }`                                 |
| 发出地图指令 | 通过 mapStore.setAnalysisResult → analysisHandler → renderer.addGeoJsonLayer |
| 发出图表指令 | 通过 chartStore 写入雷达图数据                                               |

**业务层不关心**：

- ❌ 雷达图用 ECharts 还是别的库
- ❌ 折线图怎么画
- ❌ 图表面板的尺寸与位置

#### 12.3.2 地图可视化层 MapVisualization

| 职责         | 说明                                                           |
| ------------ | -------------------------------------------------------------- |
| 接收业务结果 | 通过 useAnalysisLayer.createUpdateHandler                      |
| 渲染地图要素 | renderer.addGeoJsonLayer('coverage') / addPointLayer('xiaoqu') |
| 图层显隐控制 | 通过 useLayerManager 注册开关                                  |

#### 12.3.3 图表可视化层 ChartVisualization

| 职责             | 说明                     |
| ---------------- | ------------------------ |
| 接收业务数据     | 通过 chartStore（Pinia） |
| 自主决定渲染方式 | ECharts / Canvas / SVG   |
| 自主管理生命周期 | init / resize / dispose  |

**图表可视化层不关心**：

- ❌ 数据怎么算出来的
- ❌ 地图上画了什么

### 12.4 解耦后的数据流（选址分析）

```
业务层（BufferControl + useSiteAnalysisApi）
   ↓ analyze() 返回结果
   ├──► MapVisualization: mapStore.setAnalysisResult → renderer.addGeoJsonLayer
   ├──► ChartVisualization(雷达图): chartStore.radarData = { xiaoqu, selectedTypes }
   └──► ChartVisualization(结果列表): chartStore.resultList = matchedXiaoqu

业务层只提供数据；雷达图组件自己决定怎么画；结果列表自己决定怎么展示。
未来新增柱状图/热力图/桑基图 → 只新增图表组件，无需修改业务层。
```

### 12.5 通信契约

| 通信方向         | 机制                                       | 说明                          |
| ---------------- | ------------------------------------------ | ----------------------------- |
| Business → Chart | Pinia store（`useChartStore`）             | 业务层写数据，图表层读数据    |
| Business → Map   | mapStore + analysisHandler                 | 已有契约，不变                |
| Chart → Business | 事件总线（独立 EventBus 或 renderer.emit） | 如雷达图轴点击 → 触发图层切换 |

---

## 第十三章 目录结构重构

### 13.1 目标目录结构（按职责拆分）

```
src/
├── core/                              # 核心稳定层
│   ├── map/                           # ★ 地图相关（从根目录迁入，原样不动）
│   │   ├── renderers/                 #   OLRenderer / CesiumRenderer / MapRenderer（原样）
│   │   ├── components/                #   UnifiedMap.vue（从 components/map/ 迁入，逻辑不动）
│   │   ├── composables/               #   useMapRenderer / useLayerManager / useMapControls / useAnalysisLayer 等
│   │   ├── stores/                    #   map.js（从 stores/ 迁入）
│   │   ├── services/                  #   mapDataService.js
│   │   └── config/                    #   map.js（从 config/ 迁入）
│   │
│   ├── layout/                        # ★ GCS 布局系统（新增）
│   │   ├── config.js                  #   CELL_PIXEL 等参数源
│   │   ├── useGCS.js                   #   响应式布局 composable
│   │   ├── components/                #   GCS 基础 Panel 组件
│   │   │   ├── GcsPanel.vue           #     通用 Panel 容器
│   │   │   ├── GcsButton.vue          #     按钮 Panel
│   │   │   ├── GcsZone.vue            #     四区容器
│   │   │   ├── BusinessPanel.vue      #     业务控制面板（4×4）
│   │   │   └── LayerControlPanel.vue  #     图层控制面板（4×4）
│   │   └── AppLayout.vue              #   应用布局（替代 App.vue 的布局部分）
│   │
│   └── visualization/                 # ★ 可视化基础设施（新增）
│       ├── ChartPanel.vue             #   通用图表面板容器
│       ├── useChart.js                 #   ECharts 生命周期管理
│       ├── charts/                    #   纯展示图表组件
│       │   ├── RadarChart.vue         #     雷达图（从 RadarFloatPanel 拆解）
│       │   └── LineChart.vue         #     折线图（未来）
│       └── stores/
│           └── chartStore.js          #   图表数据总线
│
├── business/                          # 业务层
│   └── site-selection/                #   选址分析
│       ├── SiteSelectionPage.vue      #     从 BufferPage.vue 迁入
│       ├── components/                #     BufferControl / ResultPanel（从 analysis/ 迁入）
│       └── composables/               #     useSiteAnalysisApi（迁入）
│
├── components/                         # 通用组件
│   ├── common/                        #   ErrorBoundary / InfoPanel
│   └── user/                          #   PlanDrawer / PlanSaveModal / ProfilePanel
│
├── composables/                       # 跨业务通用
│   ├── useAuth.js
│   ├── usePlans.js
│   └── useApiRequest.js
│
├── config/                            # 全局配置（map.js 迁走后可能为空）
├── router/                            # 路由
├── services/
├── stores/
├── types/
├── views/                            # HomePage / ProfilePage
├── App.vue
└── main.js
```

### 13.2 迁移 / 保留 / 删除清单

| 原路径                                        | 操作         | 目标路径                                                  | 说明               |
| --------------------------------------------- | ------------ | --------------------------------------------------------- | ------------------ |
| `src/renderers/*`                             | 迁移（原样） | `src/core/map/renderers/*`                                | 引擎不动           |
| `src/components/map/UnifiedMap.vue`           | 迁移（原样） | `src/core/map/components/UnifiedMap.vue`                  | 逻辑不动           |
| `src/components/map/LayerPanel.vue`           | 迁移 + 重构  | `src/core/layout/components/LayerControlPanel.vue`        | 重构为 4×4 Panel   |
| `src/components/map/MapSwitcher.vue`          | 标记废弃     | 原地保留                                                  | 本次不删，未来删   |
| `src/composables/useMap*.js` 等               | 迁移（原样） | `src/core/map/composables/*`                              | 逻辑不动           |
| `src/stores/map.js`                           | 迁移（原样） | `src/core/map/stores/map.js`                              | 逻辑不动           |
| `src/services/mapDataService.js`              | 迁移（原样） | `src/core/map/services/`                                  |                    |
| `src/config/map.js`                           | 迁移（原样） | `src/core/map/config/map.js`                              |                    |
| `src/components/common/AppHeader.vue`         | 拆解         | 功能分散到 GCS Panel                                      | 不再作为独立顶部栏 |
| `src/components/analysis/*`                   | 迁移         | `src/business/site-selection/components/*`                |                    |
| `src/composables/useSiteAnalysisApi.js`       | 迁移         | `src/business/site-selection/composables/`                |                    |
| `src/views/BufferPage.vue`                    | 迁移         | `src/business/site-selection/SiteSelectionPage.vue`       |                    |
| `src/components/analysis/RadarFloatPanel.vue` | 拆解         | ECharts 逻辑 → `core/visualization/charts/RadarChart.vue` | 解耦               |
| `src/style.css` 的 `--unit`                   | 替换         | `src/core/layout/config.js` 的 `CELL_PIXEL`               | 新尺寸源           |

> **重要**：所有标注"原样迁移"的文件，**内容一字不改**，只换目录路径与 import 引用。

---

## 第十四章 实施阶段（修订版）

> **本章修订**：每阶段增加"依赖前置条件"、"阶段完成定义"、"阶段失败回滚条件"。

### 总览

| 阶段    | 名称                      | 上半段（A）                    | 下半段（B）                       |
| ------- | ------------------------- | ------------------------------ | --------------------------------- |
| Phase 1 | 目录结构整理              | 建立目标目录骨架               | 迁移文件 + 修正 import            |
| Phase 2 | GCS 布局系统建立          | Cell + Panel 基础组件 + config | 四区 Zone + AppLayout 接入        |
| Phase 3 | 删除顶部导航 + 业务区归位 | 拆解 AppHeader 功能            | 业务控制面板（4×4）               |
| Phase 4 | 可视化解耦                | 图表层基础设施 + chartStore    | RadarFloatPanel 拆解为 RadarChart |
| Phase 5 | 图层区归位                | LayerControlPanel（4×4）       | 底图互斥 + 业务图层开关           |
| Phase 6 | 收尾 + 全量验收           | 响应式设计实现                 | 旧组件清理 + 全量验收             |

---

### Phase 1-A：建立目标目录骨架

#### 目标

在 `src/` 下建立 `core/map/`、`core/layout/`、`core/visualization/`、`business/site-selection/` 目录骨架，不迁移任何文件。

#### 依赖前置条件

- 无

#### 修改范围

- 新增空目录与 `index.js` 占位

#### 禁止修改范围

- 禁止移动任何现有文件
- 禁止修改任何 import 路径
- 禁止修改 `renderers/` / `composables/` / `stores/` / `config/`

#### 实施步骤

1. 新建 `src/core/map/`（空）
2. 新建 `src/core/layout/`（空，加 `config.js` 占位）
3. 新建 `src/core/visualization/`（空）
4. 新建 `src/business/site-selection/`（空）
5. 提交 Git

#### 阶段完成定义

- 目录骨架建立完成
- `npm run dev` 正常
- `npm run build` 成功
- `GetDiagnostics` 0 error
- 页面与重构前完全一致

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- `npm run dev` 正常
- `npm run build` 成功
- `GetDiagnostics` 0 error
- 页面与重构前完全一致

#### 截图验证要求

- 重构前后首页截图对比（应完全一致）

#### Git 提交节点

- `feat(core): scaffold GCS V3 target directory structure`

---

### Phase 1-B：迁移文件 + 修正 import

#### 目标

将地图相关文件原样迁移到 `src/core/map/`，选址业务迁移到 `src/business/site-selection/`，修正所有 import 路径。

#### 依赖前置条件

- Phase 1-A 完成

#### 修改范围

- 迁移 `src/renderers/*` → `src/core/map/renderers/*`
- 迁移 `src/components/map/UnifiedMap.vue` → `src/core/map/components/`
- 迁移 `src/composables/useMap*.js`、`useBoundaryLayer.js`、`useFacilities.js`、`usePortLayer.js`、`useAnalysisLayer.js`、`facilityLabels.js` → `src/core/map/composables/`
- 迁移 `src/stores/map.js` → `src/core/map/stores/map.js`
- 迁移 `src/services/mapDataService.js` → `src/core/map/services/`
- 迁移 `src/config/map.js` → `src/core/map/config/map.js`
- 迁移 `src/views/BufferPage.vue` → `src/business/site-selection/SiteSelectionPage.vue`
- 迁移 `src/components/analysis/*` → `src/business/site-selection/components/*`
- 迁移 `src/composables/useSiteAnalysisApi.js` → `src/business/site-selection/composables/`
- 全局替换 import 路径

#### 禁止修改范围

- 禁止修改任何文件内容（仅改 import 路径）
- 禁止修改业务逻辑

#### 实施步骤

1. 分批迁移地图相关文件
2. 每迁一批，全局搜索替换 import 路径
3. 迁移选址业务文件
4. `npm run dev` 验证每一步
5. 全量回归：选址分析完整链路
6. 提交 Git

#### 阶段完成定义

- 所有文件迁移完成
- 所有 import 路径修正完成
- `npm run dev` 正常
- `npm run build` 成功
- `GetDiagnostics` 0 error
- 选址分析功能与重构前完全一致
- Grep 旧路径 0 残留

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- `npm run dev` 正常
- `npm run build` 成功，chunk 划分与重构前一致
- `GetDiagnostics` 0 error
- 选址分析功能与重构前完全一致
- Grep 旧路径 0 残留

#### 截图验证要求

- 重构前后选址页截图对比
- `npm run build` 输出对比

#### Git 提交节点

- `refactor(core): migrate map modules to core/map (no logic change)`
- `refactor(business): migrate site-selection to business/ (no logic change)`

---

### Phase 2-A：Cell + Panel 基础组件

#### 目标

建立 `core/layout/config.js`（CELL_PIXEL 参数源）+ `useGCS.js`（响应式布局）+ `GcsPanel.vue` + `GcsButton.vue` 基础 Panel 组件。

#### 依赖前置条件

- Phase 1 完成

#### 修改范围

- 新增 `src/core/layout/config.js`：CELL_PIXEL=80 + 派生参数 + 响应式查表
- 新增 `src/core/layout/useGCS.js`：监听 resize，响应式计算 style
- 新增 `src/core/layout/components/GcsPanel.vue`：Frosted Glass 容器 Panel
- 新增 `src/core/layout/components/GcsButton.vue`：按钮 Panel（文字在上，图标在下）

#### 禁止修改范围

- 禁止修改 App.vue（本阶段不接入）
- 禁止修改地图相关
- 禁止修改业务

#### 实施步骤

1. 编写 config.js：CELL_PIXEL + 响应式查表函数
2. 编写 useGCS.js：resize 监听 + cell(w,h) / panel(w,h) 计算函数
3. 编写 GcsPanel.vue：Frosted Glass + 统一圆角
4. 编写 GcsButton.vue：2×1 按钮 Panel
5. 测试页验证
6. 提交 Git

#### 阶段完成定义

- config.js 导出 CELL_PIXEL 等
- useGCS 返回正确像素值
- GcsPanel 渲染 Frosted Glass
- `npm run build` 成功
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- `npm run build` 成功
- `GetDiagnostics` 0 error
- config.js 导出 CELL_PIXEL 等
- useGCS 返回正确像素值
- GcsPanel 渲染 Frosted Glass

#### 截图验证要求

- 测试页 4×4 Panel、2×1 按钮对齐截图
- Panel 叠加地图 blur 效果截图

#### Git 提交节点

- `feat(layout): add GCS panel/button base components + CELL_PIXEL config`

---

### Phase 2-B：四区 Zone + AppLayout 接入

#### 目标

建立 `GcsZone.vue` 四区容器，新增 `AppLayout.vue` 接入 GCS（替换 App.vue 布局部分），暂保留 AppHeader。

#### 依赖前置条件

- Phase 2-A 完成

#### 修改范围

- 新增 `src/core/layout/components/GcsZone.vue`：四区象限容器
- 新增 `src/core/layout/AppLayout.vue`：保留 UnifiedMap + provide，新增四区空 Panel
- 修改 App.vue：布局部分委托 AppLayout（或直接改 App.vue）
- 修改 router import 路径

#### 禁止修改范围

- 禁止修改 UnifiedMap 渲染器逻辑
- 禁止修改 useMapRenderer / useLayerManager 契约
- 禁止删除 AppHeader（Phase 3 删）

#### 实施步骤

1. 编写 GcsZone.vue：接收 zone props，渲染象限容器
2. 编写 AppLayout.vue：UnifiedMap + 四区空 Panel
3. 修改 App.vue 引用 AppLayout
4. 验证：四区可见、地图全屏
5. 提交 Git

#### 阶段完成定义

- 四区 Zone 容器建立
- AppLayout 接入 GCS
- 地图全屏可见、可拖拽缩放
- 四区空 Panel 对称可见
- 选址功能正常
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- 地图全屏可见、可拖拽缩放
- 四区空 Panel 对称可见
- 选址功能正常
- `GetDiagnostics` 0 error

#### 截图验证要求

- 首页四区空布局截图
- 选址页功能截图

#### Git 提交节点

- `feat(layout): integrate GCS zones into AppLayout`

---

### Phase 3-A：拆解 AppHeader 功能

#### 目标

删除 AppHeader 顶部横栏，将功能（首页/个人中心/登录/城市定位）拆解为独立 Panel 按钮。

#### 依赖前置条件

- Phase 2 完成

#### 修改范围

- 拆解 `src/components/common/AppHeader.vue`：
  - Home → GcsButton
  - 个人中心 → GcsButton
  - 登录 → GcsButton
  - 城市定位 → 4×1 城市横条子 Panel
- 新增 `useScreenActions.js`：封装跳转/登录/城市 flyTo 逻辑
- 从 AppLayout 删除 AppHeader 引用

#### 禁止修改范围

- 禁止修改地图
- 禁止修改 useAuth 逻辑
- 禁止删除功能

#### 实施步骤

1. 编写 useScreenActions.js
2. 拆解 AppHeader 为独立 GcsButton
3. 从 AppLayout 删除 AppHeader
4. 验证所有原功能可用
5. 提交 Git

#### 阶段完成定义

- AppHeader 顶部横栏删除
- Home/个人中心/登录按钮可用
- 城市定位 flyTo 可用
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- 顶部无横栏
- Home/个人中心/登录按钮可用
- 城市定位 flyTo 可用
- `GetDiagnostics` 0 error

#### 截图验证要求

- 无 AppHeader 首页截图
- 点击城市后地图飞行截图

#### Git 提交节点

- `refactor(layout): decompose AppHeader into GCS panel buttons`

---

### Phase 3-B：业务控制面板（4×4）

#### 目标

建立 Zone1 业务控制面板：顶部 2 按钮 + 中部城市横条 + 下部 6 业务入口。

#### 依赖前置条件

- Phase 3-A 完成

#### 修改范围

- 新增 `src/core/layout/components/BusinessPanel.vue`
- 挂载到 Zone1
- 6 个业务入口按钮（选址分析可用，其余禁用"即将上线"）

#### 禁止修改范围

- 禁止修改路由配置
- 禁止实现吞吐量/因子/热力图/航线业务

#### 实施步骤

1. 编写 BusinessPanel.vue（4×4 内部结构）
2. 顶部 2 个 GcsButton（Home + 个人中心）
3. 中部 4×1 城市横条（钦州/防城港/北海）
4. 下部 6 个 GcsButton（选址分析 → /buffer，其余禁用）
5. 挂载到 Zone1
6. 提交 Git

#### 阶段完成定义

- Zone1 显示 4×4 业务面板
- 顶部 Home/个人中心可用
- 中部城市按钮 flyTo 可用
- 下部选址分析可跳转，其余禁用
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- Zone1 显示 4×4 业务面板
- 顶部 Home/个人中心可用
- 中部城市按钮 flyTo 可用
- 下部选址分析可跳转，其余禁用
- `GetDiagnostics` 0 error

#### 截图验证要求

- Zone1 业务面板截图
- 点击选址分析跳转截图
- 点击城市 flyTo 截图

#### Git 提交节点

- `feat(layout): add BusinessPanel 4×4 in Zone1`

---

### Phase 4-A：图表层基础设施 + chartStore

#### 目标

建立 `core/visualization/` 基础设施：ChartPanel + useChart + chartStore + RadarChart 纯展示组件。

#### 依赖前置条件

- Phase 3 完成

#### 修改范围

- 新增 `src/core/visualization/ChartPanel.vue`：图表面板容器
- 新增 `src/core/visualization/useChart.js`：ECharts init/resize/dispose
- 新增 `src/core/visualization/stores/chartStore.js`：数据总线
- 新增 `src/core/visualization/charts/RadarChart.vue`：纯展示雷达图

#### 禁止修改范围

- 禁止修改 RadarFloatPanel（Phase 4-B 才拆）
- 禁止修改业务

#### 实施步骤

1. 编写 ChartPanel.vue
2. 编写 useChart.js（自动 dispose）
3. 编写 chartStore.js（radarData 状态）
4. 编写 RadarChart.vue（从 chartStore 读数据）
5. 测试页验证
6. 提交 Git

#### 阶段完成定义

- ChartPanel / useChart / chartStore / RadarChart 建立
- RadarChart 独立渲染
- chartStore 数据变化图表更新
- 卸载后 dispose
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- RadarChart 独立渲染
- chartStore 数据变化图表更新
- 卸载后 dispose
- `GetDiagnostics` 0 error

#### 截图验证要求

- 测试页 RadarChart 截图
- 卸载后内存截图

#### Git 提交节点

- `feat(viz): add ChartPanel + useChart + chartStore + RadarChart`

---

### Phase 4-B：RadarFloatPanel 拆解

#### 目标

将 RadarFloatPanel 的 ECharts 逻辑迁移到 RadarChart，业务数据通过 chartStore 流转，删除 RadarFloatPanel。

#### 依赖前置条件

- Phase 4-A 完成

#### 修改范围

- 选址业务层写 chartStore.radarData
- RadarChart 挂载到 Zone2（ChartPanel 包裹）
- 删除 RadarFloatPanel.vue
- 删除其位置自适应逻辑（由 GCS Zone 接管位置）

#### 禁止修改范围

- 禁止修改 renderer 图层方法
- 禁止修改选址算法

#### 实施步骤

1. 业务层（SiteSelectionPage）在选中小区后写 chartStore.radarData
2. RadarChart 挂载到 Zone2
3. 删除 RadarFloatPanel
4. 验证雷达图正常显示
5. 提交 Git

#### 阶段完成定义

- Zone2 显示雷达图
- 数据来自 chartStore
- RadarFloatPanel 已删除
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- Zone2 显示雷达图
- 数据来自 chartStore
- RadarFloatPanel 已删除
- `GetDiagnostics` 0 error

#### 截图验证要求

- Zone2 雷达图截图
- 选中小区后雷达图更新截图

#### Git 提交节点

- `refactor(viz): decouple RadarFloatPanel into RadarChart + chartStore`

---

### Phase 5-A：LayerControlPanel（4×4）

#### 目标

建立 Zone3 图层控制面板（4×4），与业务区对称。

#### 依赖前置条件

- Phase 4 完成

#### 修改范围

- 新增 `src/core/layout/components/LayerControlPanel.vue`（替代旧 LayerPanel.vue）
- 顶部 4×1 底图横条（影像/矢量互斥）
- 下部 6 个图层按钮

#### 禁止修改范围

- 禁止修改 stores/map.js 的 registerBaseLayer 互斥逻辑
- 禁止修改 OLRenderer.setBaseLayer

#### 实施步骤

1. 编写 LayerControlPanel.vue（4×4）
2. 顶部底图横条（调用 setBaseLayer）
3. 下部 6 按钮（调用 toggleLayer）
4. 挂载到 Zone3
5. 删除旧 LayerPanel.vue
6. 提交 Git

#### 阶段完成定义

- Zone3 显示 4×4 图层面板
- 底图切换互斥
- 业务图层独立开关
- 与业务区视觉对称
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- Zone3 显示 4×4 图层面板
- 底图切换互斥
- 业务图层独立开关
- 与业务区视觉对称
- `GetDiagnostics` 0 error

#### 截图验证要求

- Zone3 图层面板截图
- 底图切换截图
- 业务区与图层区对称对比截图

#### Git 提交节点

- `feat(layout): add LayerControlPanel 4×4 in Zone3`

---

### Phase 5-B：底图互斥 + 业务图层开关收尾

#### 目标

完善图层面板，确保底图互斥、图层注册、跨路由状态正确。

#### 依赖前置条件

- Phase 5-A 完成

#### 修改范围

- 完善 LayerControlPanel 8 槽位
- 业务页进入时注册图层
- 路由切换时图层状态保持

#### 禁止修改范围

- 禁止修改 stores/map.js 互斥逻辑
- 禁止修改 renderer

#### 实施步骤

1. 完善 8 槽位
2. 业务页注册图层
3. 验证跨路由
4. 提交 Git

#### 阶段完成定义

- 8 槽位正常
- 跨路由图层保持
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- 8 槽位正常
- 跨路由图层保持
- `GetDiagnostics` 0 error

#### 截图验证要求

- 选址页图层列表截图
- 路由切换前后对比

#### Git 提交节点

- `feat(layout): persist layer state + auto-register`

---

### Phase 6-A：响应式设计实现

#### 目标

实现窗口变化 → CELL_PIXEL 重新计算 → Panel 重新计算的响应式链路。

#### 依赖前置条件

- Phase 5 完成

#### 修改范围

- 完善 useGCS.js：resize 监听 + CELL_PIXEL 查表
- 移动端降级：四区从象限改为堆叠

#### 禁止修改范围

- 禁止修改地图
- 禁止修改业务

#### 实施步骤

1. useGCS.js 实现 resize 防抖监听
2. CELL_PIXEL 按视口宽度查表
3. 移动端 Zone 从绝对定位改 Flex 堆叠
4. 验证各分辨率
5. 提交 Git

#### 阶段完成定义

- 1920px / 1366px / 1024px / 768px / 375px 各断点布局正确
- resize 实时更新
- `GetDiagnostics` 0 error

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- 1920px / 1366px / 1024px / 768px / 375px 各断点布局正确
- resize 实时更新
- `GetDiagnostics` 0 error

#### 截图验证要求

- 各断点截图（5 张）
- resize 过程录屏

#### Git 提交节点

- `feat(layout): responsive CELL_PIXEL + mobile stacking`

---

### Phase 6-B：旧组件清理 + 全量验收

#### 目标

清理废弃旧组件，全量回归验收。

#### 依赖前置条件

- Phase 6-A 完成

#### 修改范围

- 删除 `src/components/map/MapSwitcher.vue`（本次仍保留手动切换，但标记废弃；若已无需引用则删）
- 删除 `src/components/common/AppHeader.vue`（已拆解）
- 删除 `src/components/analysis/RadarFloatPanel.vue`（已拆解）
- 全量回归

#### 禁止修改范围

- 禁止删除 public/ 数据
- 禁止删除 server/
- 禁止修改业务算法

#### 实施步骤

1. Grep 确认旧组件无引用
2. 删除旧组件
3. 全量回归：所有路由、所有功能
4. 提交 Git + 打 tag

#### 阶段完成定义

- 所有路由正常
- 选址分析完整链路正常
- `npm run build` 成功
- `GetDiagnostics` 0 error
- 旧组件全删

#### 阶段失败回滚条件

- 任一验收标准未通过
- 回滚操作：`git revert <commit>`

#### 验收标准

- 所有路由正常
- 选址分析完整链路正常
- `npm run build` 成功
- `GetDiagnostics` 0 error
- 旧组件全删

#### 截图验证要求

- 全量功能截图集
- build 输出截图
- GetDiagnostics 0 error 截图

#### Git 提交节点

- `chore(cleanup): remove deprecated components`
- Tag: `gcs-v3`

---

## 第十五章 验收与回滚总则

### 15.1 每阶段独立可验收

每个阶段交付时，验收人员按以下顺序检查：

1. `npm run build` 成功
2. `GetDiagnostics` 0 error
3. 该阶段"验收标准"逐项打勾
4. 该阶段"截图验证要求"全部截图归档
5. 回归测试：上一阶段功能未退化

### 15.2 每阶段独立可回滚

- 每个阶段一个 Git 提交（或一组紧密提交）
- 回滚操作：`git revert <commit>`
- 回滚后验证：上一阶段功能完整

### 15.3 每阶段独立可交接

每个阶段交接时，交付物：

1. 该阶段改动文件清单
2. 该阶段实施文档章节
3. 验收截图集
4. Git 提交 hash
5. 已知问题与后续注意事项

### 15.4 全局回滚点

| 阶段       | 回滚点 tag             |
| ---------- | ---------------------- |
| Phase 1 前 | `gcs-v3-start`         |
| Phase 2 后 | `gcs-v3-layout-base`   |
| Phase 4 后 | `gcs-v3-viz-decoupled` |
| Phase 6 后 | `gcs-v3`               |

### 15.5 禁止事项复核

施工完成后，架构师按以下清单复核：

- [ ] `src/core/map/renderers/` 文件内容与重构前 diff 为 0（仅路径变）
- [ ] MapRenderer / OLRenderer / CesiumRenderer 类签名未变
- [ ] useMapRenderer / useLayerManager 契约未变
- [ ] UnifiedMap 渲染器生命周期逻辑未改
- [ ] 后端 server/ 未改
- [ ] 选址分析算法逻辑未改
- [ ] 无硬编码 px（Grep 排除 style.css 基础样式）
- [ ] 业务层未 import ECharts
- [ ] 图表组件未 import 业务算法
- [ ] **未引用不存在功能**（Grep 检查 ScreenLayout/LeftVizPanel/AHP/GM/Dijkstra 等）

---

## 第十六章 架构契约总则（最高优先级）

> **本章是后续所有阶段施工的最高约束规则。优先级高于其他所有章节。未来任何实施阶段不得违反。**

### 16.1 核心架构契约

```
Home Route = Layout Base（布局基座）
Business Route = Workspace（动态工作台）
Profile Route = User Workspace（用户工作台）

业务层 Business
  ↓ 数据契约 Data Contract
可视化层 Visualization
  ↓ 渲染指令
地图层 Map
```

### 16.2 契约定义

| 路由类型       | 职责                         | 布局规则                         |
| -------------- | ---------------------------- | -------------------------------- |
| Home Route     | 固定驾驶舱（Dashboard）      | Layout Base，定义四象限布局      |
| Business Route | 动态工作台（Workspace）      | 继承 Layout Base，仅替换业务内容 |
| Profile Route  | 用户工作台（User Workspace） | 独立左右分区，不继承四象限       |

### 16.3 强制约束

| 约束项                  | 说明                                           |
| ----------------------- | ---------------------------------------------- |
| 🚫 禁止重新定义布局规则 | 所有业务路由必须继承 Layout Base               |
| 🚫 禁止重新定义 Cell    | Cell 是数学单位，全局统一                      |
| 🚫 禁止重新定义 Panel   | Panel 是可见对象，全局统一                     |
| 🚫 禁止重新定义 Zone    | Zone 是容器，全局统一                          |
| ✅ 必须复用 Layout Base | 新增业务路由时优先复用                         |
| ✅ 必须遵守数据契约     | Business → Data Contract → Visualization → Map |

### 16.4 契约优先级

```
架构契约总则（本章）
  ↓ 最高优先级
事实基线（第一章）
  ↓
GCS 设计哲学（第二章）
  ↓
其他章节
```

---

## 第十七章 Layout Base（布局基座）原则

### 17.1 核心定义

> **Home Route 不是普通页面。Home Route 是整个系统的 Layout Base（布局基座）。**

### 17.2 继承关系

```
Home Route（Layout Base）
  ↓ 继承
SiteSelection Route
  ↓ 继承
Throughput Route
  ↓ 继承
HeatMap Route
  ↓ 继承
RouteAnalysis Route
  ↓ 继承
FutureBusiness Route
```

### 17.3 允许与禁止

| 允许               | 禁止                |
| ------------------ | ------------------- |
| ✅ 替换业务内容    | ❌ 重新定义布局规则 |
| ✅ 替换 Panel 内容 | ❌ 重新定义 Cell    |
| ✅ 替换可视化内容  | ❌ 重新定义 Panel   |
|                    | ❌ 重新定义 Zone    |

### 17.4 实施要求

未来新增业务路由时：

1. **优先复用 Layout Base**
2. 仅替换 Zone 内的业务内容
3. 不修改四象限布局规则

---

## 第十八章 路由布局继承原则

### 18.1 继承模式

所有业务路由采用：

```
Layout Base（布局基座）
  ↓
Business Content（业务内容）
```

### 18.2 各路由职责

| 路由          | 布局             | 职责                                        |
| ------------- | ---------------- | ------------------------------------------- |
| Home          | 固定驾驶舱       | 地图总览 + 系统入口 + 全局可视化 + 图层控制 |
| SiteSelection | 继承 Home Layout | 选址分析参数输入 + 结果查看                 |
| Throughput    | 继承 Home Layout | 吞吐量预测参数输入 + 结果查看               |
| RouteAnalysis | 继承 Home Layout | 航线分析参数输入 + 结果查看                 |
| 未来新增业务  | 继承 Home Layout | 业务参数输入 + 结果查看                     |

### 18.3 强制约束

| 路由类型     | 必须             | 禁止             |
| ------------ | ---------------- | ---------------- |
| 所有业务路由 | 继承 Layout Base | 改变 Layout Base |
| 未来新增业务 | 复用四象限布局   | 重新设计页面结构 |

---

## 第十九章 首页布局稳定性原则

### 19.1 核心定义

> **Home Layout 属于平台基础设施。不是业务模块。**

### 19.2 稳定性约束

当 Home Layout 完成验收后：

| 允许            | 禁止                                   |
| --------------- | -------------------------------------- |
| ✅ 扩展业务内容 | ❌ 修改 Home Layout                    |
| ✅ 新增业务路由 | ❌ 为新增业务调整四象限规则            |
|                 | ❌ 为新增业务增加新的布局体系          |
|                 | ❌ 为新增业务修改 Cell/Panel/Zone 体系 |

### 19.3 实施要求

新增业务时：

1. 只能扩展业务内容
2. 不能修改布局体系
3. 必须遵守现有 Cell/Panel/Zone 体系

---

## 第二十章 首页最终职责定义

### 20.1 首页定位

> **首页属于：固定驾驶舱（Dashboard）**

### 20.2 首页职责

| 职责       | 说明                |
| ---------- | ------------------- |
| 地图总览   | 全屏地图 + 底图切换 |
| 系统入口   | 业务路由入口按钮    |
| 全局可视化 | 折线图 + 雷达图     |
| 图层控制   | 底图 + 业务图层切换 |

### 20.3 职责边界

| 首页承担      | 首页不承担      |
| ------------- | --------------- |
| ✅ 地图总览   | ❌ 复杂业务操作 |
| ✅ 系统入口   | ❌ 业务参数输入 |
| ✅ 全局可视化 | ❌ 业务结果导出 |
| ✅ 图层控制   | ❌ 业务分析计算 |

### 20.4 职责分离

- 首页布局固定
- 不承担复杂业务操作
- 业务操作进入业务路由完成

---

## 第二十一章 业务路由职责定义

### 21.1 业务路由定位

> **业务路由属于：动态工作台（Workspace）**

### 21.2 业务路由职责

| 职责     | 说明              |
| -------- | ----------------- |
| 参数输入 | 业务配置面板      |
| 业务分析 | 调用后端 API      |
| 结果查看 | 地图 + 图表可视化 |
| 结果导出 | 数据导出功能      |

### 21.3 允许与禁止

| 允许                | 禁止                         |
| ------------------- | ---------------------------- |
| ✅ 替换 Panel 内容  | ❌ 改变 Layout Base          |
| ✅ 动态调整业务模块 | ❌ 重新定义四象限布局        |
| ✅ 扩展业务功能     | ❌ 修改 Cell/Panel/Zone 体系 |

### 21.4 实施要求

业务路由开发时：

1. 继承 Layout Base
2. 仅替换 Zone 内的业务内容
3. 复用统一的可视化组件

---

## 第二十二章 Profile 特殊规则

### 22.1 当前状态

> **当前阶段：Profile 布局未最终确定。**

### 22.2 已确定内容

| 已确定                          | 说明                |
| ------------------------------- | ------------------- |
| ✅ Profile 不继承首页四象限布局 | 采用独立布局        |
| ✅ 采用左右分区结构             | 左侧信息 + 右侧操作 |

### 22.3 允许与禁止

| 允许            | 禁止                             |
| --------------- | -------------------------------- |
| ✅ 未来独立设计 | ❌ 为 Profile 建立第二套布局系统 |
| ✅ 采用左右分区 | ❌ 重新定义 Cell/Panel 体系      |
|                 | ❌ 使用固定 px 值                |

### 22.4 强制约束

Profile 必须遵守：

1. Cell 统一体系
2. Panel 统一体系
3. CELL_PIXEL 统一尺寸来源

---

## 第二十三章 UI 边界原则（强制）

### 23.1 核心定义

> **本项目不采用第三方驾驶舱模板。**

### 23.2 禁止引入

| 禁止项                     | 说明           |
| -------------------------- | -------------- |
| ❌ Ant Design Pro          | 后台管理框架   |
| ❌ Vue Admin               | 后台管理框架   |
| ❌ DataV 模板              | 数据可视化模板 |
| ❌ 智慧城市模板            | 现成模板       |
| ❌ 智慧港口模板            | 现成模板       |
| ❌ 若依后台模板            | 后台管理框架   |
| ❌ 任何现成 Dashboard 框架 | 现成框架       |

### 23.3 允许使用

| 允许项          | 说明      |
| --------------- | --------- |
| ✅ Vue          | 前端框架  |
| ✅ Element Plus | UI 组件库 |
| ✅ ECharts      | 图表库    |
| ✅ OpenLayers   | 2D 地图库 |
| ✅ Cesium       | 3D 地图库 |

### 23.4 实施要求

所有布局均基于项目自身：

- Cell（数学单位）
- Panel（可见对象）
- Zone（容器）

体系实现，不依赖第三方模板。

---

## 第二十四章 组件复用优先原则

### 24.1 复用优先级

新增组件前必须检查：

```
复用（优先）
  ↓
组合
  ↓
扩展
  ↓
新建（最后）
```

### 24.2 复用检查清单

新增组件前必须回答：

| 问题                         | 说明               |
| ---------------------------- | ------------------ |
| 是否已有组件可复用？         | 检查现有组件库     |
| 是否可通过组合现有组件实现？ | 检查组件组合可能性 |
| 是否可通过扩展现有组件实现？ | 检查组件扩展可能性 |
| 是否必须新建？               | 最后选择           |

### 24.3 禁止行为

| 禁止项                    | 说明           |
| ------------------------- | -------------- |
| ❌ 复制组件后改名字       | 避免组件冗余   |
| ❌ 不检查现有组件直接新建 | 避免重复造轮子 |

### 24.4 实施要求

新增组件时：

1. 先检查现有组件库
2. 优先复用现有组件
3. 其次组合现有组件
4. 再次扩展现有组件
5. 最后新建组件

---

## 第二十五章 平台资产原则

### 25.1 平台资产清单

以下属于平台资产，未来所有业务共享：

| 资产类型   | 资产列表                                                  |
| ---------- | --------------------------------------------------------- |
| 布局体系   | Layout Base, Cell, Panel, Zone                            |
| 基础组件   | Button                                                    |
| 可视化组件 | RadarChart, LineChart, BarChart, ResultCard, LayerControl |

### 25.2 统一管理

| 管理要求        | 说明                          |
| --------------- | ----------------------------- |
| ✅ 统一维护     | 平台资产由架构组统一维护      |
| ✅ 统一复用     | 所有业务共享平台资产          |
| ❌ 禁止业务独占 | 业务不能拥有自己的 RadarChart |
| ❌ 禁止业务独占 | 业务不能拥有自己的 LineChart  |

### 25.3 实施要求

平台资产管理：

1. 统一维护
2. 统一复用
3. 禁止业务独占

---

## 第二十六章 未来扩展原则

### 26.1 未来业务预测

未来可能新增：

| 业务类型   | 说明             |
| ---------- | ---------------- |
| 港口分析   | 港口数据统计     |
| 旧选址分析 | 现有选址分析优化 |
| 新选址分析 | 新选址算法       |
| 航线分析   | 航线规划         |
| 浸没分析   | 浸没风险评估     |
| 预测分析   | 预测模型         |

### 26.2 强制约束

| 必须                    | 禁止                            |
| ----------------------- | ------------------------------- |
| ✅ 继承 Layout Base     | ❌ 新增业务时重新设计布局       |
| ✅ 复用 Cell/Panel/Zone | ❌ 新增业务时修改 Home Layout   |
| ✅ 接入统一可视化体系   | ❌ 新增业务时建立第二套布局系统 |

### 26.3 实施要求

未来新增业务时：

1. 继承 Layout Base
2. 复用 Cell/Panel/Zone
3. 接入统一可视化体系
4. 不修改 Home Layout

---

## 附录 A：关键文件路径速查（当前 Git 真实路径）

### 稳定基线（禁止修改）

| 文件                                                                                                    | 说明                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------ |
| [MapRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/MapRenderer.js)                   | 渲染器抽象基类           |
| [OLRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/OLRenderer.js)                     | OpenLayers 2D 实现       |
| [CesiumRenderer.js](file:///c:/mypython/beibu-gulf-project/src/renderers/CesiumRenderer.js)             | Cesium 3D 实现           |
| [UnifiedMap.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/UnifiedMap.vue)              | 地图容器（生命周期管理） |
| [useMapRenderer.js](file:///c:/mypython/beibu-gulf-project/src/composables/useMapRenderer.js)           | 渲染器 inject 契约       |
| [useLayerManager.js](file:///c:/mypython/beibu-gulf-project/src/composables/useLayerManager.js)         | 图层管理门面             |
| [stores/map.js](file:///c:/mypython/beibu-gulf-project/src/stores/map.js)                               | 地图状态 + 互斥逻辑      |
| [config/map.js](file:///c:/mypython/beibu-gulf-project/src/config/map.js)                               | 地图配置                 |
| [siteAnalysisService.js](file:///c:/mypython/beibu-gulf-project/server/services/siteAnalysisService.js) | 后端选址算法             |
| [scoringService.js](file:///c:/mypython/beibu-gulf-project/server/services/scoringService.js)           | 后端评分                 |

### 本次重构重点改造

| 文件                                                                                                      | 改造方向                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [App.vue](file:///c:/mypython/beibu-gulf-project/src/App.vue)                                             | 布局部分委托 AppLayout         |
| [AppHeader.vue](file:///c:/mypython/beibu-gulf-project/src/components/common/AppHeader.vue)               | 拆解为 GcsButton 组            |
| [LayerPanel.vue](file:///c:/mypython/beibu-gulf-project/src/components/map/LayerPanel.vue)                | 重构为 4×4 LayerControlPanel   |
| [RadarFloatPanel.vue](file:///c:/mypython/beibu-gulf-project/src/components/analysis/RadarFloatPanel.vue) | 拆解为 RadarChart + chartStore |
| [BufferPage.vue](file:///c:/mypython/beibu-gulf-project/src/views/BufferPage.vue)                         | 迁移为 SiteSelectionPage       |
| [router/index.js](file:///c:/mypython/beibu-gulf-project/src/router/index.js)                             | import 路径更新                |
| [style.css](file:///c:/mypython/beibu-gulf-project/src/style.css)                                         | --unit 替换为 CELL_PIXEL       |

---

**文档版本**：V3.3（第三轮修订最终版）
**修订日期**：2026-07-16
**编制**：架构师
**适用范围**：北部湾智慧港口选址分析平台 GCS V3 重构
**核心原则重申**：【地图稳定】【业务稳定】【展示层重构】【布局层重构】【交互层重构】【业务驱动地图】【业务驱动可视化】【GCS 统一布局】【Cell 统一尺寸来源】【可视化与业务解耦】【首屏仅加载 OL】【3D 按业务动态加载】

---

## 文档修订记录

| 版本 | 日期       | 修订内容                                                                                                                                                                                                                            |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3.0 | 2026-07-15 | 初始第三版，建立事实基线                                                                                                                                                                                                            |
| V3.1 | 2026-07-15 | 补充实施阶段细节                                                                                                                                                                                                                    |
| V3.2 | 2026-07-15 | 完善验收标准                                                                                                                                                                                                                        |
| V3.3 | 2026-07-16 | 第三轮修订最终版：完整覆盖用户 8 部分需求，更新事实基线核验时间，统一文档结构                                                                                                                                                       |
| V3.4 | 2026-07-16 | 第四轮修订：新增架构契约总则（最高优先级）、Layout Base 布局基座原则、路由布局继承原则、首页布局稳定性原则、首页最终职责定义、业务路由职责定义、Profile 特殊规则、UI 边界原则、组件复用优先原则、平台资产原则、未来扩展原则共 11 章 |
