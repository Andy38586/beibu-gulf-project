# 北部湾智慧港口平台 — 项目现状说明

> **版本**: v4flash  
> **目的**: 给无法查看代码的 AI/协作者理解项目真实结构  
> **立场**: 只描述事实和问题，不粉饰

---

## 项目演进史（三大重构阶段）

> 以下内容基于 git log 历史还原，非用户口述。时间跨度：2026-06-20 → 2026-07-20，共 30 天。

---

### 第一阶段：前后端分离（2026-06-20 → 2026-06-26）

**重构动机**：初始版本是纯前端 SPA，Turf.js 缓冲区运算直接在浏览器执行，数据量稍大就卡死；所有数据存在 `public/data/` 下，没有用户系统，方案不可保存。

**重构内容**：

```
重构前（纯前端）:
  src/
    ├── MapContainer.vue      ← 地图 + 业务逻辑全部耦合
    ├── components/analysis/  ← 前端 Turf.js 运算
    └── public/data/          ← JSON 数据文件

重构后（前后端分离）:
  server/
    ├── app.js                ← Express 入口
    ├── routes/               ← RESTful 路由
    ├── controllers/          ← 请求处理
    ├── services/             ← 业务逻辑 (Turf.js 搬到后端)
    ├── repositories/         ← JSON 数据访问
    ├── middleware/auth.js    ← JWT 验证
    └── data/                 ← 数据文件
```

**关键 commit**：`c975aba` — "增加express后端,把现有前端运算和算法逻辑搬到后端"

**同时完成**：
- JWT 登录/注册系统（`af70758`）
- ErrorBoundary 全局错误边界（`fad004d`）
- CRUD 方案管理（`2aa61ea`）
- 设施数据缓存 + 并发写锁修复（`6d745fc`）

**遗留问题**：后端仍使用 JSON 文件存储，无数据库。

---

### 第二阶段：策略模式 + 多引擎解耦（2026-06-28 → 2026-07-02）

**重构动机**：MapContainer 仍与 OpenLayers 强耦合，无法支持 Cesium 3D。业务代码直接在组件里操作 OL API（`ol/Map`、`ol/layer/Vector`），切换引擎 = 重写整个组件。

**重构内容**：

```
重构前:
  MapContainer.vue
    ├── 直接使用 ol/Map 初始化
    ├── 直接调用 ol/layer/Vector 添加图层
    └── 分析结果直接在组件内处理

重构后:
  core/map/renderers/
    ├── MapRenderer.js        ← 抽象基类（策略模式）
    ├── OLRenderer.js         ← OpenLayers 实现
    └── CesiumRenderer.js     ← Cesium 实现（新增）
  core/map/UnifiedMap.vue     ← 统一地图容器
  core/map/composables/
    ├── useLayerManager.js    ← 图层管理（引擎无关）
    ├── useMapControls.js     ← 地图控制
    ├── usePortLayer.js       ← 港口图层
    └── useBoundaryLayer.js   ← 边界图层
  stores/map.js               ← Pinia 状态管理
```

**关键 commits**：
- `6d745fc` — 拆分 MapContainer，业务分给 OLMap 组件，通过 Pinia store 管理状态
- `6719bb2` — 新增 Cesium，完成同一数据源两套引擎调用
- `02c1919` — 封装接口：业务图层只提供数据 + 渲染方式，渲染器负责渲染和交互

**设计核心**：

```
业务图层（引擎无关）
    ↓ 提供 GeoJSON + 样式配置
MapRenderer 抽象基类
    ├── OLRenderer → ol/layer/Vector
    └── CesiumRenderer → Cesium Entity / Primitive
```

**同时完成**：
- TypeScript 类型定义文件创建（`88b5ba9`）
- ESLint + oxlint 规则配置（`23f517d`）
- Cell 最小单元 + CSS 系统统一（`7642493`）
- Element Plus 引入并逐步替换为自建组件（`88b5ba9`，后来在第三阶段又移除）

**遗留问题**（当前文档重点检测的部分）：
- MapRenderer 抽象接口不完整，CesiumRenderer 的 `addWaterSurface` 等方法不在基类
- UnifiedMap 仍直接 import `@/business/` 业务模块
- 业务代码仍存在 `getType() === 'cesium'` 类型嗅探

---

### 第三阶段：GCS 布局系统 + 组件复用 + 规范化（2026-07-16 → 至今，未完成）

**重构动机**：上一阶段的目录拆分（`components/map/`、`components/analysis/`）仍然是"按功能分文件夹"而非"按架构分层"。Zone 概念导致容器泛滥（Zone1~5），面板定位靠手动调 CSS，布局不可复用。

**重构内容**：

```
重构前:
  src/
    ├── components/map/           ← 功能分组
    ├── components/analysis/
    ├── components/common/
    └── components/user/

重构后（当前结构）:
  src/
    ├── core/                     ← 核心基础设施
    │   ├── map/                  ← 地图引擎
    │   ├── layout/               ← GCS 布局系统
    │   └── config/               ← 配置
    ├── business/                 ← 业务模块
    │   ├── site-selection/       ← 选址分析
    │   └── flood-analysis/       ← 浸没分析
    ├── visualization/            ← 可视化资产
    ├── shared/                   ← 共享组件
    │   ├── components/
    │   ├── composables/
    │   └── utils/
    ├── stores/                   ← Pinia
    └── types/                    ← TypeScript
```

**关键 commits**：
- `32d8c99` — 构建 GCS 基础组件（GcsPanel 等）
- `6e3823c` + `9eb4e22` — 迁移核心模块到 `src/core/map/` + `src/core/config/`
- `20fe303` — 模板继承：AppLayout 作为布局基座，所有业务路由通过 slot 注入
- `9edeead` — 完整 GCS 面板设计系统，重构选址分析页
- `430e5fc` — 新增浸没分析 + 预测分析业务框架（路由/占位页面，非完整实现）

**GCS 布局系统带来的提升**：

| 旧系统（Zone） | 新系统（GCS V2） |
|---|---|
| Zone1~5 五个容器组件 | 一切皆是 Panel，不存在容器 |
| 面板间距靠 CSS margin | PPS 公式统一计算 2×GAP |
| 像素硬编码 | Cell 单位（80px） + 响应式查表 |
| 布局不可复用 | AppLayout 模板继承 + slot 注入 |
| 每个页面独立布局 | 所有页面共享一套定位规则 |

**已完成的模块复用检查**：

以下组件在不同业务路由间实现了复用：
- `LineChart.vue` — 首页 + GCS 分析
- `BarChart.vue` — 首页 + GCS 分析
- `RadarChart.vue` — 首页 + 选址分析
- `LayerControlPanel.vue` — 首页 + 选址分析 + GCS 分析
- `ErrorBoundary.vue` — 所有页面
- `GcsPanel.vue` — 所有面板容器
- `AppLayout.vue` — 所有业务路由基座

**未完成的规划**：
- 预测分析模块（Forecast）— 设计文档 1764 行已写完，未落地
- TypeScript 迁移 — 类型定义已创建，但无 `.vue`/`.js` 引用
- MapRenderer 接口补完 — 5 个方法不在基类
- UnifiedMap → business 依赖切断 — `UnifiedMap.vue:22` 未修复

---

### 三个阶段的定性

| 阶段 | 核心命题 | 解决程度 | 当前状态 |
|---|---|---|---|
| 1. 前后端分离 | "前端不能做重型空间计算" | 已解决 | ✅ 稳定 |
| 2. 策略模式 | "地图引擎必须可替换" | **部分解决** | ⚠️ 基类接口不完整 |
| 3. GCS + 规范化 | "业务模块必须可复用、可插拔" | **架构已定，实现未完成** | 🔧 进行中 |

**核心矛盾**：第三阶段重构了目录结构和 UI 体系，但没有同步修复第二阶段遗留的"引擎接口不完整"和"core 依赖 business"问题。结果是架构分层更清晰了，但层与层之间的耦合没变。当前检测报告所指出的大部分阻断级问题，根源都在这。

---

## 一、一句话定位

一个 Vue 3 + OpenLayers + Cesium + Express 的 WebGIS 项目，核心功能是港口选址分析（2D）和三维浸没模拟（3D），**以及一个规划中但未实现的预测分析模块**。

---

## 二、技术栈真相

| 宣称 | 实际 |
|---|---|
| Vue 3 Composition API | ✅ 全量使用 `<script setup>` |
| OpenLayers 10 | ✅ 天地图瓦片 + Vector Layer |
| Cesium | ✅ 但只用于 `/heatmap` 一个路由，Viewer 单例缓存 |
| Turf.js | ✅ 只在**后端**选址分析用（缓冲区合并/交集） |
| ECharts | ✅ 折线图/柱状图/雷达图 |
| Element Plus | 依赖里有，但**实际组件基本没用到**，面板全是自建的 GcsPanel |
| TypeScript | ⚠️ `src/types/` 有完备的 `.ts` 类型定义，但**核心文件全是 `.js`**，类型未被使用 |
| Vitest | ⚠️ 配置了，但只有 renderer 目录下几个测试 |
| ESLint + oxlint | ⚠️ 配置了但未严格执行 |
| Express | ✅ 5 个路由模块，但**全是 JSON 文件 Mock**，无数据库 |

---

## 三、目录结构与真实含义

```
src/
├── core/                  ← "核心层"，但依赖业务层
│   ├── map/
│   │   ├── renderers/     ← MapRenderer(抽象) + OLRenderer + CesiumRenderer
│   │   ├── composables/   ← useLayerManager, usePortLayer 等
│   │   └── UnifiedMap.vue ← 核心组件，管理 2D/3D 切换
│   ├── layout/            ← GCS 布局系统 (Cell + PPS + AppLayout)
│   └── config/
│
├── business/              ← 业务模块
│   ├── site-selection/    ← 选址分析（2D，完整实现）
│   └── flood-analysis/    ← 浸没分析（3D，部分实现，目录命名与设计文档不一致）
│
├── visualization/         ← 图表组件 (LineChart/BarChart/RadarChart)
├── shared/                ← 共享组件 (ErrorBoundary, LoginPanel 等)
├── stores/                ← Pinia (map.js, gcsStore.js, siteSelectionState.js)
├── types/                 ← TS 类型定义（未使用）
├── services/              ← 只有一个 mapDataService.js
├── router/index.js        ← 4 条路由
└── App.vue                ← 挂载 UnifiedMap + RouterView

server/
├── routes/                ← 6 个路由模块
├── controllers/           ← 读取 JSON 文件返回
├── services/              ← 选址分析有真实 Turf.js 计算，其余为透传
├── repositories/          ← 读 JSON 文件的封装
└── data/                  ← JSON 数据文件
    └── flood/             ← 浸没分析 5 个 JSON 文件
```

---

## 四、架构中的真实问题

### 4.1 核心层依赖业务层（设计违反）

```
src/core/map/UnifiedMap.vue, line 22:
  import { useAnalysisLayer } from '@/business/site-selection/composables/useAnalysisLayer'
```

这意味着：
- 不能在 core 层做单元测试而不引入 business 模块
- 新增第三个业务模块 → UnifiedMap 要再加一个 import → 越来越臃肿
- core 层失去了"独立可复用"的属性

### 4.2 渲染器抽象不完整

MapRenderer 抽象基类声明了：
- `addPointLayer` / `addPolygonLayer` / `addGeoJsonLayer`
- `setVisibility` / `removeLayer` / `flyTo`

但 **CesiumRenderer 比基类多出 5 个不在接口中的方法**：
- `addWaterSurface` / `updateWaterLevel` / `removeWaterSurface`
- `setWaterSurfaceVisibility` / `removeAllWaterSurfaces`

业务代码被迫做类型嗅探：
```js
if (renderer.getType() === 'cesium') {
  renderer.addWaterSurface(...)  // ← OLRenderer 没有这个方法
}
```

**后果**：加第三个渲染引擎（如 Mapbox/Deck.gl）时，必须复制这一套 if/else。

### 4.3 业务层直接操控渲染器

FloodAnalysisPage.vue（business 层）直接：
```js
const renderer = mapStore.currentRenderer?.value
renderer.removeWaterSurface(WATER_SURFACE_ID)
renderer.updateWaterLevel(WATER_SURFACE_ID, newLevel)
```

没有经过任何中间层/适配器。业务与渲染引擎**硬耦合**。

### 4.4 API 调用混乱

项目中存在 **三种 API 调用方式** 并存：

| 方式 | 位置 | 备注 |
|---|---|---|
| 裸 `fetch('/api/...')` | FloodAnalysisPage.vue, HomePage.vue | 无超时、无错误处理统一策略 |
| `useApiRequest.ts` | shared/composables/ | 写了完整泛型 + AbortController，但**没有被任何页面使用** |
| `apiRequest` 混用 | 部分 composable 自己包装 | 不一致 |

### 4.5 类型定义文件未被使用

`src/types/` 下有 7 个 `.ts` 文件：
- `analysis.ts`、`api.ts`、`facility.ts`、`map.ts`、`plan.ts`、`xiaoqu.ts`、`index.ts`

定义了完整的 `AnalysisParams`、`AnalysisResult`、`Port`、`LayerEntry` 等接口。

**但没有任何一个 `.js` 或 `.vue` 文件引用它们**。类型定义只存在于 IDE 的自动补全里（JSDoc），编译器不做任何检查。

### 4.6 目录命名不一致

| 设计文档 | 实际 |
|---|---|
| `src/business/gcs-analysis/` | `src/business/flood-analysis/` |
| `server/controllers/gcsController.js` | `server/controllers/floodAnalysisController.js` |
| 路由是 `gcs.js` | ✅ 一致，但 controller 名不匹配 |
| BottomNavBar 有"预测分析"按钮 | 实际被替换为"吞吐量"按钮 |

### 4.7 预测分析模块（Forecast）未实现

设计文档 `docs/港口预测分析模块技术设计文档.md` 写了 1764 行完整设计：
- 5 个后端 API
- 6 个 JSON 数据文件
- 独立的 `forecastState` store
- 4 个前端组件 + Layer composable
- 路由 `/forecast`

**实际代码中完全不存 在**：
- `public/data/forecast/` 目录不存在
- `server/routes/forecast.js` 不存在
- `src/stores/forecastState.js` 不存在
- `src/business/forecast/` 目录不存在
- 路由表中没有 `/forecast`

### 4.8 GCS 面板布局与设计文档不一致

设计规范 `GCS_V2_设计规范.md` 要求面板为 **4×2 Cell**（4 个面板各 2 行，共占 4 行高度）。

实际代码中每个面板为 **4×4 Cell**，这意味着：
- 未来有更多面板加入时屏幕空间不足
- 布局参数与设计规范偏离，验收检查模式（Inspection Mode）不准

### 4.9 业务流断层与体验不一致（运行态问题）

以下问题只有在完整走完用户流程时才会暴露：

#### 4.9.1 错误提示三套体系

| 模块 | 错误机制 | 后果 |
|---|---|---|
| 选址分析 | `ErrorPopup.vue` 模态弹窗（4×3 Cell，重试/取消） | 用户看到弹窗 |
| 浸没分析 API 错误 | `console.error` 静默吞掉（FloodAnalysisPage.vue:227,265） | **用户完全不知情** |
| 浸没分析剖面线加载 | `ElMessage.error()` Element Plus toast | 飘一下消失，容易被忽略 |
| 收藏操作（通用） | `ElMessage.success/warning/error` | 三种不同的用户感知 |

**根因**：项目从 Vue 2 时代积累了三套错误展示机制（自定义弹窗 / Element Plus Message / console），不同时期写的模块用了不同的方案。

#### 4.9.2 收藏/保存概念混滑

**语义混乱链**：
- 前端点 ☆ → 调 `doSave()` → 发 `POST /plans/:id/xiaoqu`（后端叫 save）
- 后端存 `savedXiaoqu[]`（语义：已保存）
- 前端显示 `已收藏：xxx`（语义：已收藏）
- ProfilePage 标题叫"我的收藏"

**同一个操作**在前端叫"收藏"、在后端叫"保存"、在数据库字段叫"saved"。新增开发者要读完整条链路才知道它在干什么。

#### 4.9.3 浸没分析无状态保存/恢复

选址分析（SiteSelectionPage）离开页面时：
```
onBeforeRouteLeave → saveCurrentState()
  → 存 factorSettings、matchedXiaoqu、currentPlanId → siteSelectionState store
回来时 onMounted → restoreState() 恢复全部
```

浸没分析（FloodAnalysisPage）离开时：**什么都不存**。回来时：
- 水位归 0
- 分析结果清空
- 之前选的剖面线丢失
- 所有 API 重新请求

**后果**：用户在浸没分析调了半天水位 → 点去个人信息 → 回退 → 全丢了。

#### 4.9.4 浸没分析图层注册依赖 setTimeout

```js
// FloodAnalysisPage.vue, ~line 90
setTimeout(() => registerGcsLayers(), 1500)
```

硬等 1.5 秒让 Cesium 渲染器就绪。如果设备慢/网络差：
- `registerGcsLayers` 执行时 CesiumViewerManager 还没 `create()` → 图层注册失败
- **没有重试逻辑**
- 用户进入页面，LayerControlPanel 里没有水面/淹没区/设施的开关

#### 4.9.5 浸没分析离开时不注销图层

`onUnmounted` 只调了 `removeWaterSurface`，没有调 `unregisterLayer` 从 LayerControlPanel 移除已注册的三个图层。

用户反复进入/离开浸没分析 → LayerControlPanel 累积重复开关：
```
[gcs-water-surface] [gcs-flood-area] [gcs-facilities]
[gcs-water-surface] [gcs-flood-area] [gcs-facilities]  ← 第二次进入后又加了一组
```

#### 4.9.6 ProfilePage 的归集规则是脆弱伪逻辑

```js
// ProfilePage.vue 用 score 正负区分业务模块
savedXiaoqu 中 score > 0  → 归到"选址分析"
savedXiaoqu 中 score === 0 → 归到"浸没分析"
```

如果选址小区评分恰好为 0 → 显示在浸没分析下面。
如果浸没设施未来加了评分 → 显示在选址分析下面。

**正确做法**：存一个 `businessType: 'site-selection' | 'flood'` 字段。

#### 4.9.7 未登录收藏体验断裂

流程：
```
用户点 ☆（未登录）
  → PaginatedListPanel.toggleFavorite()
    → ElMessage.warning('请先登录后再收藏')
    → 结束
```

ErrorPopup 已经有 `mode='login'` 模式（显示"去登录"按钮），但收藏流程里没有触发它。用户看到一行灰色文字，不指导下一步怎么做。

#### 4.9.8 浸没分析方案在 ProfilePage 无"加载"入口

ProfilePage 对选址分析方案提供了：
- ✅ "加载" → 恢复状态并跳转 `/site-selection`
- ✅ "重命名"
- ✅ "删除"

对浸没分析方案只提供了：
- ❌ 无"加载"（无法恢复到浸没分析页面）
- ✅ "重命名"
- ✅ "删除"

#### 4.9.9 浸没分析 AP 错误静默

```js
// FloodAnalysisPage.vue
try {
  const res = await fetch(`/api/gcs/flood-areas?waterLevel=${waterLevel}`)
  if (resJson.code === 200) { /* 处理成功 */ }
} catch (error) {
  console.error('浸没分析失败', error)  // ← 用户看不到
}
```

后端挂了、网络超时、参数错误 → 控制台有一条 log，用户界面上**什么都没有**。地图不动、报告不更新，但没有任何提示告诉用户"出错了"。

---

## 五、数据流

### 5.1 选址分析（Site Selection）

```
用户选择设施类型 + 设置重要性
  → POST /api/site-analysis
  → server/services/siteAnalysisService.js（真实 Turf.js 计算）
    → buffer → union → intersect → filter → score → sort
  → 返回 GeoJSON coverage + scored xiaoqu[]
  → 前端渲染 coverage 多边形 + matched 红点
```

**这是项目中唯一有真实空间计算的后端流程。**

### 5.2 浸没分析（Flood Analysis）

```
用户拖动水位滑块
  → fetch('/api/gcs/flood-areas?waterLevel=2.5')
  → server/controllers/floodAnalysisController.js
    → 读取 server/data/flood/floodArea.json
    → 找到最接近水位区间返回（静态 JSON 查表）
  → fetch('/api/gcs/analysis/disaster')
    → 读取 facilityPoints.json → elevation ≤ waterLevel 过滤 → 计算损失
```

**无真实水文模型，纯 JSON 查表。**

### 5.3 预测分析（Forecast）

**不存在。**

---

## 六、路由表

| 路径 | 页面 | 引擎 | 状态 |
|---|---|---|---|
| `/` | HomePage | 2D (OL) | ✅ |
| `/site-selection` | SiteSelectionPage | 2D (OL) | ✅ |
| `/heatmap` | FloodAnalysisPage | 3D (Cesium) | ✅ 但命名误导 |
| `/profile` | ProfilePage | 2D (OL) | ✅ |
| `/forecast` | 不存在 | — | ❌ 设计文档有，未实现 |

引擎切换逻辑：`App.vue` 监听 `route.meta.engine`，动态切 UnifiedMap 的 `mapType`。

---

## 七、Store 结构

| Store | 职责 | 大小 | 问题 |
|---|---|---|---|
| `map.js` | 地图状态（引擎类型、选中港口、图层目录、渲染器引用） | 373 行 | 责任过多，图层管理 + 地图状态 + 分析结果混杂 |
| `gcsStore.js` | 三维分析状态（水位/剖面/淹没/港口影响） | 196 行 | 4 个模块挤在一个 store，模块间无隔离 |
| `siteSelectionState.js` | 选址分析状态 | — | 相对好，职责单一 |

**核心问题**：gcsStore 已有 4 个子模块，加 Forecast 又需要一个 store 或继续膨胀。

---

## 八、关键数字

| 指标 | 值 |
|---|---|
| 前端 JS 文件数 | ~40 个 |
| 后端 JS 文件数 | ~25 个 |
| TS 文件数 | 8 个（仅类型定义，无运行时使用） |
| 测试文件 | 2 个 `__tests__/` 目录 |
| API 接口 | ~15 个，其中 10 个为 JSON 查表 |
| 真实计算接口 | 1 个（`/api/site-analysis`） |
| 渲染引擎数 | 2（OL + Cesium） |
| 抽象基类漏掉的方法 | 5 个 |
| `getType() === 'cesium'` 出现次数 | 6 次（在 business/ 层） |

---

## 九、如果只能改三件事

1. **补完 MapRenderer 抽象接口** — 把 addWaterSurface/addHeatmapLayer 等方法加入基类，消除所有 `getType()` 嗅探
2. **切断 UnifiedMap → business 依赖** — 让 core 层不再 import 任何 business 模块
3. **把 Forecast 的设计文档落地** — 数据文件 + API + 路由 + 页面，18 个文件，设计文档已写完整，只差实现

这三件事完成后，项目才具备"可扩展"的前提。在此之前，每加一个业务模块都是在加固现有耦合。

---

## 十、文件清单（快速导航）

### 核心文件
- `src/App.vue` — 根组件，引擎切换逻辑
- `src/core/map/UnifiedMap.vue` — 统一地图容器（550 行，P0-2 已修：不再 import business）
- `src/core/map/renderers/MapRenderer.js` — 抽象基类（142 行）
- `src/core/map/renderers/OLRenderer.js` — OL 实现（394 行）
- `src/core/map/renderers/CesiumRenderer.js` — Cesium 实现（927 行，含 5 个不在基类的方法）
- `src/core/layout/AppLayout.vue` — 布局基座（215 行）
- `src/stores/map.js` — 地图 store（374 行）
- `src/stores/gcsStore.js` — 三维分析 store（197 行）

### 已修复的 P0 问题
- **P0-1**：渲染器接口补齐。`MapRenderer.js` 新增 7 个水面方法（addWaterSurface/updateWaterLevel/removeWaterSurface/removeAllWaterSurfaces/setWaterSurfaceVisibility/startBreathing/stopBreathing），OLRenderer 实现桩，FloodAnalysisPage 移除全部 `getType()` 嗅探
- **P0-2**：Core→Business 依赖切断。`UnifiedMap.vue` 不再 import business composable，改由 `SiteSelectionPage.vue` 在业务层自行调用 `useAnalysisLayer()` 注册分析处理函数

### 仍存在的问题
- `src/core/layout/AppLayout.vue:30-32` — 布局层直接 import 图表组件
- `src/business/flood-analysis/FloodAnalysisPage.vue:203,241` — 裸 `fetch()` 调用

### 设计文档
- `docs/项目描述报告.md` — 1100 行完整架构设计（含 Mapbox 扩展示例、布局规范）
- `docs/港口预测分析模块技术设计文档.md` — 1764 行未实现模块设计
- `docs/GCS_V2_设计规范.md` — 820 行布局规范（与实现有偏差）
- `docs/GCS三维港口分析系统技术设计文档.md` — 860 行技术方案
