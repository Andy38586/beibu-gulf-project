# 北部湾港 WebGIS - 港口选址分析平台

一个全栈 WebGIS 应用，面向**北部湾（广西钦州）港口腹地的选址分析**。前端基于 Vue 3 + OpenLayers + Cesium + Turf.js，后端基于 Express.js。

本项目采用 **Renderer Adapter 架构模式**，实现了 2D/3D 地图引擎的统一抽象，业务图层与渲染引擎完全解耦。展示了一套完整的空间分析工作流：多因子缓冲区叠加分析、距离加权综合评分、交互式地图可视化，以及基于 JWT 认证的用户方案管理。

---

## 技术栈

| 层级           | 技术                                                                |
| -------------- | ------------------------------------------------------------------- |
| **前端**       | Vue 3（Composition API、`<script setup>`）、Vite、Vue Router、Pinia |
| **GIS 引擎**   | OpenLayers 10（2D 地图）、Cesium（3D 地图）、Turf.js（空间分析）    |
| **数据可视化** | ECharts 6（评分分解雷达图）                                         |
| **后端**       | Express.js 5（ESM）、RESTful API                                    |
| **认证**       | JWT（jsonwebtoken + bcryptjs）                                      |
| **存储**       | 基于 JSON 文件的持久化                                              |
| **测试**       | Vitest（单元测试、集成测试）                                        |
| **代码规范**   | ESLint + oxlint + Prettier                                          |

---

## 功能特性

### 选址分析

- 从 6 种设施类型中选择：医院、小学、中学、公园、公交站、商场/超市
- 每类设施设置重要性（1-5 级），影响缓冲区半径系数（0.4x 至 2.2x）
- 后端计算流程：**多缓冲区合并 → AND 交集 → 面内点过滤 → 加权距离评分**
- 返回按推荐度排序的前 10 个小区，附带各设施类型得分明细

### 地图可视化

- **2D/3D 双视图切换**：统一地图组件支持 OpenLayers 2D 和 Cesium 3D 切换
- 交互式地图，天地图底图（影像/矢量）
- 港口点位点击查看详情面板
- 分析结果覆盖区域半透明多边形渲染
- 匹配小区红色圆点标记
- 图层控制面板（底图切换、业务图层显隐）

### 分析可视化

- 点击任一结果项，弹出 ECharts 雷达图展示该小区在各设施类型上的得分分布

### 用户系统

- 基于 JWT 的注册与登录
- localStorage 持久化会话
- Token 过期自动退出

### 分析方案管理

- 将当前分析配置（选中类型 + 重要性设置）保存为命名方案
- 加载已有方案恢复面板配置
- 编辑方案名称、删除方案
- 方案按更新时间降序排列

---

## 架构

### Renderer Adapter 模式

本项目采用 **Renderer Adapter 架构模式**，实现了地图渲染引擎的统一抽象：

```
┌─────────────────────────────────────────────────────────────┐
│                      UnifiedMap.vue                          │
│                      （统一地图组件）                         │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │   OLRenderer    │    │  CesiumRenderer │                 │
│  │   (2D 渲染器)    │    │   (3D 渲染器)    │                 │
│  └────────┬────────┘    └────────┬────────┘                 │
│           │                      │                           │
│           └──────────┬───────────┘                           │
│                      ▼                                       │
│              MapRenderer (抽象基类)                           │
│              - addPointLayer()                               │
│              - addGeoJsonLayer()                             │
│              - setVisibility()                               │
│              - flyTo()                                       │
│              - on('click', handler)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│usePortLayer │  │useBoundary │  │useAnalysis  │
│  (港口图层)  │  │ Layer      │  │ Layer       │
│             │  │ (边界图层)  │  │ (分析图层)  │
│ 纯业务逻辑  │  │ 纯业务逻辑  │  │ 纯业务逻辑  │
│ 返回GeoJSON │  │ 返回GeoJSON │  │ 返回GeoJSON │
└─────────────┘  └─────────────┘  └─────────────┘
```

### 架构优势

| 特性               | 说明                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| **业务与引擎解耦** | 业务图层只返回 GeoJSON 和样式配置，不关心底层使用 OpenLayers 还是 Cesium |
| **统一接口**       | 通过 `MapRenderer` 抽象基类定义标准接口，新增渲染引擎只需实现接口        |
| **状态持久化**     | 2D/3D 切换时自动保存/恢复图层可见性、视角状态                            |
| **可测试性**       | Renderer 可被 mock，便于单元测试和集成测试                               |

### 前端架构

```
前端 (Vue 3 + Vite)                    后端 (Express.js)
+-------------------------+            +----------------------+
|  App.vue                |            |  app.js              |
|  +-- UnifiedMap.vue     |            |  +-- /api/markers    |
|  |   +-- Renderer       |   HTTP     |  +-- /api/auth       |
|  +-- HomePage.vue       |  <------>  |  +-- /api/plans      |
|  |   +-- InfoPanel      |   REST     |  +-- /api/site-analysis
|  +-- BufferPage.vue     |            |  +-- /api/facilities |
|  |   +-- BufferControl  |            |  +-- controllers/    |
|  |   +-- ResultPanel    |            |  +-- services/       |
|  +-- LayerPanel.vue     |            |  |   +-- siteAnalysisService
|  +-- MapSwitcher.vue    |            |  |   +-- scoringService
|  +-- composables/       |            |  |   +-- decayFunctions
|  |   +-- useAuth.js     |            |  |   +-- importanceMapping
|  |   +-- usePlans.js    |            |  +-- repositories/   |
|  |   +-- useLayerManager|            |  +-- middleware/auth.js
|  |   +-- useMapRenderer |            |  +-- data/*.json
|  +-- renderers/         |            +----------------------+
|  |   +-- MapRenderer.js |
|  |   +-- OLRenderer.js  |
|  |   +-- CesiumRenderer.js |
|  +-- stores/map.js      |
+-------------------------+
```

### 空间分析流程

```
用户选择设施类型 + 设置重要性
         |
POST /api/site-analysis
         |
加载各类型设施 GeoJSON 数据
         |
1. 对每种设施的每个点做缓冲区（半径 = defaultRadius x 重要性系数）
2. 同类型缓冲区合并（Union）→ 每种设施的覆盖区
3. 所有覆盖区取交集（Intersect）→ 候选区域
4. 筛选落在候选区域内的所有小区
5. 对每个候选小区评分：
   - 对每类设施：计算到最近点的距离 → 衰减函数映射为 0-100 分
   - 按权重加权平均 → 综合分
6. 按分数降序排列，返回 Top 10
```

---

## 项目结构

```
beibu-gulf-project/
+-- public/
|   +-- data/ports.json                     # 港口点位数据
|   +-- beibu-gulf-merged-data.geojson     # 北部湾边界矢量
+-- src/
|   +-- App.vue                             # 根组件：布局+错误边界+弹窗
|   +-- main.js                             # Vue 入口
|   +-- router/index.js                     # 3 条路由
|   +-- views/
|   |   +-- HomePage.vue                    # 首页：地图+港口详情
|   |   +-- BufferPage.vue                  # 选址分析主页面
|   |   +-- OverlayPage.vue                 # 预留页面
|   +-- components/
|   |   +-- map/MapContainer.vue            # OpenLayers 地图封装
|   |   +-- analysis/
|   |   |   +-- BufferControl.vue           # 分析表单+触发
|   |   |   +-- ResultPanel.vue             # 排名列表+雷达图
|   |   +-- common/
|   |   |   +-- AppHeader.vue               # 导航栏+用户菜单
|   |   |   +-- InfoPanel.vue               # 港口信息卡片
|   |   |   +-- ErrorBoundary.vue           # 全局异常捕获
|   |   +-- user/
|   |   |   +-- PlanDrawer.vue              # 侧边栏：方案列表
|   |   |   +-- PlanSaveModal.vue           # 方案命名弹窗
|   |   +-- auth/AuthModal.vue              # 登录/注册弹窗
|   +-- composables/
|       +-- useAuth.js                      # JWT 登录状态+API
|       +-- usePlans.js                     # 方案 CRUD API
|       +-- useSiteAnalysisApi.js           # 选址分析 API
|       +-- useFacilities.js                # 设施类型常量
|       +-- facilityLabels.js               # 设施标签映射（供雷达图使用）
+-- server/
|   +-- index.js                            # Express 启动入口
|   +-- app.js                              # 路由注册+中间件
|   +-- routes/
|   |   +-- auth.js                         # 认证路由
|   |   +-- plans.js                        # 方案 CRUD 路由
|   |   +-- markers.js                      # 标记 CRUD 路由
|   |   +-- facilities.js                   # 设施数据路由
|   |   +-- siteAnalysis.js                 # 选址分析路由
|   +-- controllers/                        # 请求处理函数
|   +-- services/
|   |   +-- siteAnalysisService.js          # 缓冲区分析编排
|   |   +-- scoringService.js               # 加权距离评分
|   |   +-- decayFunctions.js               # 3 种衰减策略
|   |   +-- importanceMapping.js            # 重要性系数映射
|   +-- repositories/                       # JSON 文件数据访问
|   +-- middleware/auth.js                  # JWT 验证中间件
|   +-- data/                               # 业务数据文件
+-- vite.config.js
+-- vercel.json
+-- package.json
```

---

## 本地开发

### 环境要求

- Node.js >= 22.18.0
- npm

### 浏览器兼容性

| 浏览器 | 最低版本 | 说明 |
|--------|---------|------|
| Chrome | 89+ | 推荐，完整支持 CSS v-bind 和所有现代特性 |
| Edge | 89+ | 推荐，基于 Chromium |
| Firefox | 114+ | 完整支持 |
| Safari | 14.1+ | 完整支持 CSS v-bind |
| IE | 不支持 | 项目使用现代 JavaScript 特性，不支持 IE |

**说明**：项目使用 Vue 3、CSS v-bind、ResizeObserver 等现代特性，已配置 browserslist 和 polyfill 确保兼容性。如需支持旧版浏览器，请参考 `package.json` 中的 browserslist 配置。

### 启动步骤

```bash
# 1. 安装前端依赖
cd beibu-gulf-project
npm install

# 2. 安装后端依赖
cd server
npm install
cd ..

# 3. 分别启动前后端（需要两个终端）

# 终端 1：后端 API 服务
cd server
node --watch index.js

# 终端 2：前端开发服务器
npm run dev
```

前端运行在 `http://localhost:5173`，后端 API 运行在 `http://localhost:3000`。

### PowerShell 终端编码说明

项目中的 GeoJSON 数据文件（如 `public/beibu-gulf-merged-data.geojson`）采用 **UTF-8 无 BOM** 编码。在 PowerShell 终端调试时，需要使用 UTF-8 编码读取文件以避免中文乱码：

```powershell
# 正确方式：指定 UTF-8 编码
Get-Content public/beibu-gulf-merged-data.geojson -Encoding UTF8

# 错误方式：默认编码会导致中文乱码
Get-Content public/beibu-gulf-merged-data.geojson
```

浏览器 `fetch` API 会自动处理 UTF-8 编码，因此前端功能不受影响。此说明仅针对终端调试场景。

### 环境变量

| 变量            | 默认值                       | 说明                                                  |
| --------------- | ---------------------------- | ----------------------------------------------------- |
| `VITE_API_BASE` | `http://localhost:3000/api`  | 后端 API 地址（前端使用，可在 .env 或 Vercel 中设置） |
| `JWT_SECRET`    | `beibu-gulf-dev-secret-2024` | JWT 签名密钥（后端环境变量）                          |
| `PORT`          | `3000`                       | 后端端口（后端环境变量）                              |

---

## API 文档

### 认证

| 方法 | 路径                 | 需认证 | 请求体                 | 返回            |
| ---- | -------------------- | ------ | ---------------------- | --------------- |
| POST | `/api/auth/register` | 否     | `{username, password}` | `{token, user}` |
| POST | `/api/auth/login`    | 否     | `{username, password}` | `{token, user}` |
| GET  | `/api/auth/me`       | 是     | -                      | `{user}`        |

### 方案管理（需 Bearer token）

| 方法   | 路径             | 请求体                                  | 返回               |
| ------ | ---------------- | --------------------------------------- | ------------------ |
| GET    | `/api/plans`     | -                                       | 当前用户的方案列表 |
| POST   | `/api/plans`     | `{name, selectedKeys[], typeSettings}`  | 创建后的方案       |
| PUT    | `/api/plans/:id` | `{name?, selectedKeys?, typeSettings?}` | 更新后的方案       |
| DELETE | `/api/plans/:id` | -                                       | 204                |

### 设施数据

| 方法 | 路径                     | 返回                                                                                        |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------- |
| GET  | `/api/facilities/xiaoqu` | 全部小区数据                                                                                |
| GET  | `/api/facilities/:type`  | 按类型获取设施数据（hospital / primary_school / middle_school / park / bus_station / mall） |

### 选址分析

| 方法 | 路径                 | 请求体                           | 返回                                                                  |
| ---- | -------------------- | -------------------------------- | --------------------------------------------------------------------- |
| POST | `/api/site-analysis` | `{selectedKeys[], typeSettings}` | `{error, coverage（GeoJSON 多边形）, matchedXiaoqu[]（Top 10 小区）}` |

### 用户标记

| 方法   | 路径               | 请求体                    | 返回                |
| ------ | ------------------ | ------------------------- | ------------------- |
| GET    | `/api/markers`     | -                         | 全部标记            |
| POST   | `/api/markers`     | `{name, lng, lat, note?}` | 创建后的标记（201） |
| PUT    | `/api/markers/:id` | 部分字段                  | 更新后的标记        |
| DELETE | `/api/markers/:id` | -                         | 204                 |

---

## 部署

### 前端 -> Vercel

```bash
npm run build
npx vercel --prod
```

在 Vercel 控制台设置环境变量：`VITE_API_BASE = https://你的后端域名:3000/api`

### 后端 -> 云服务器（阿里云等）

```bash
cd server
npm install --production
npm install -g pm2
pm2 start index.js --name "beibu-api"
pm2 save
pm2 startup
```

建议配合 Nginx 反向代理实现 HTTPS 和精准的 CORS 控制。

---

## 项目亮点

本项目作为求职作品，重点展示以下能力：

- **GIS 开发能力**：OpenLayers 地图交互、GeoJSON 数据处理、Turf.js 空间分析（缓冲区、合并、交集、点位过滤、距离计算）
- **前端工程能力**：Vue 3 Composition API、组件拆分设计、Composable 模式、provide/inject 跨组件通信、ECharts 集成、错误边界兜底
- **后端工程能力**：Express 分层架构（routes / controllers / services / repositories）、JWT 认证中间件、JSON 文件持久化及并发写防冲突
- **全栈整合能力**：RESTful API 设计、CORS 跨域、环境变量配置分离、前端-后端联调工作流

---

## 数据来源

项目使用广西钦州地区的静态 GeoJSON/JSON 数据，来源于公开数据。当前数据仅供功能演示。

---
