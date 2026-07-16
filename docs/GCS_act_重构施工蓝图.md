# GCS V1 重构施工蓝图

> **文档版本**：V1.0
>
> **修订日期**：2026-07-16
>
> **文档定位**：施工执行蓝图，用于指导开发团队实施、阶段验收、AI 接力施工
>
> **核心目标**：在不修改地图架构和业务逻辑的前提下，建立统一的 Layout Base / Cell / Panel / Zone 体系，实现业务层、可视化层、地图层解耦

---

## 目录

- [第一章 项目现状](#第一章-项目现状)
- [第二章 本次重构范围](#第二章-本次重构范围)
- [第三章 架构原则](#第三章-架构原则)
- [第四章 首页(Home)改造](#第四章-首页home改造)
- [第五章 SiteSelection改造](#第五章-siteselection改造)
- [第六章 Profile改造](#第六章-profile改造)
- [第七章 目录重构](#第七章-目录重构)
- [第八章 六阶段施工计划](#第八章-六阶段施工计划)
- [第九章 总体验收标准](#第九章-总体验收标准)
- [第十章 未来扩展约束](#第十章-未来扩展约束)

---

## 第一章 项目现状

### 1.1 当前目录结构

```
src/
├── components/
│   ├── analysis/           # 选址分析组件
│   │   ├── BufferControl.vue      # 选址配置
│   │   ├── ResultPanel.vue        # 结果列表
│   │   ├── RadarFloatPanel.vue    # 雷达图浮窗
│   │   └── OverlayControl.vue     # 覆盖控制
│   ├── common/             # 通用组件
│   │   ├── AppHeader.vue          # 顶部导航栏
│   │   ├── ErrorBoundary.vue      # 错误边界
│   │   └── InfoPanel.vue          # 信息面板
│   ├── map/                # 地图组件
│   │   ├── UnifiedMap.vue         # 地图容器
│   │   ├── LayerPanel.vue         # 图层控制面板
│   │   └── MapSwitcher.vue        # 2D/3D切换
│   └── user/               # 用户组件
│       ├── PlanDrawer.vue
│       ├── PlanSaveModal.vue
│       └── ProfilePanel.vue
├── composables/            # 组合式函数
├── config/                 # 配置
├── renderers/              # 渲染引擎（稳定基线）
├── router/                 # 路由
├── services/               # 服务
├── stores/                 # 状态管理
├── types/                  # 类型定义
├── views/                  # 页面
│   ├── HomePage.vue               # 首页（仅InfoPanel）
│   ├── BufferPage.vue             # 选址分析页
│   └── ProfilePage.vue            # 个人中心
├── App.vue                 # 应用根组件
├── main.js                 # 入口
└── style.css               # 全局样式
```

### 1.2 当前布局现状

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
```

### 1.3 当前路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | HomePage | 首页（仅 InfoPanel） |
| `/buffer` | BufferPage | 选址分析页 |
| `/profile` | ProfilePage | 个人中心 |

### 1.4 稳定基线（禁止修改）

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 渲染引擎 | `src/renderers/` | MapRenderer / OLRenderer / CesiumRenderer |
| 地图容器 | `src/components/map/UnifiedMap.vue` | 渲染器生命周期管理 |
| 地图配置 | `src/config/map.js` | 天地图 key / 底图 / 相机 |
| 地图状态 | `src/stores/map.js` | 图层注册表 + 互斥 |
| 后端服务 | `server/` | 独立工程，本次不动 |

---

## 第二章 本次重构范围

### 2.1 做什么

| 重构项 | 说明 |
| --- | --- |
| ✅ 建立 Layout Base | Home 作为布局基座，定义四象限 Zone 布局 |
| ✅ 建立 Cell/Panel/Zone 体系 | 统一布局语言，所有面板基于 Cell 计算 |
| ✅ 首页改造 | 从空页面改为四象限布局：业务入口 + 可视化 + 图层控制 |
| ✅ SiteSelection 改造 | 继承 Home Layout，替换业务内容 |
| ✅ Profile 改造 | 独立左右分区布局，不继承四象限 |
| ✅ 目录重构 | 按职责组织：Layout / Map / Business / Visualization / Shared |
| ✅ 可视化解耦 | 建立 Business → Data Contract → Visualization → Map 链路 |

### 2.2 不做什么

| 禁止项 | 原因 |
| --- | --- |
| ❌ 不重写地图 | OLRenderer / CesiumRenderer / UnifiedMap 逻辑不变 |
| ❌ 不重写业务 | 选址分析业务链路完整，后端算法不变 |
| ❌ 不新增算法 | 后端 siteAnalysisService 已实现 |
| ❌ 不新增业务功能 | 本次只重构布局，不增加新业务 |
| ❌ 不引入第三方模板 | 禁止 Ant Design Pro / Vue Admin / DataV 等 |
| ❌ 不引入新地图框架 | 保持 OpenLayers + Cesium |

### 2.3 重构边界

```
本次重构边界：

┌─────────────────────────────────────────┐
│  重构范围内（本次修改）                  │
│  ├─ 布局层：App.vue / HomePage / 路由   │
│  ├─ 组件层：AppHeader / LayerPanel      │
│  ├─ 目录结构：按职责重组                 │
│  └─ 样式系统：--unit → CELL_PIXEL       │
├─────────────────────────────────────────┤
│  重构范围外（禁止修改）                  │
│  ├─ 地图层：renderers/ UnifiedMap       │
│  ├─ 业务层：BufferControl / ResultPanel │
│  ├─ 后端：server/                       │
│  └─ 数据：public/data/                  │
└─────────────────────────────────────────┘
```

---

## 第三章 架构原则

### 3.1 Layout Base 原则

> **Home Route 不是普通页面。Home Route 是 Layout Base（布局基座）。**

```
Home Route（Layout Base）
  ↓ 继承
SiteSelection Route
  ↓ 继承
Throughput Route（未来）
  ↓ 继承
RouteAnalysis Route（未来）
  ↓ 继承
FutureBusiness Route（未来）
```

| 允许 | 禁止 |
| --- | --- |
| ✅ 替换业务内容 | ❌ 重新定义布局规则 |
| ✅ 替换 Panel 内容 | ❌ 重新定义 Cell |
| ✅ 替换可视化内容 | ❌ 重新定义 Panel |
| | ❌ 重新定义 Zone |

### 3.2 Cell / Panel / Zone 原则

#### Cell（数学单位）

- 布局最小逻辑单位
- 尺寸必须统一配置，单独声明
- 禁止硬编码 px

```
CELL_PIXEL = 80px（待验证，推荐区间 [70, 90]）
```

#### Panel（可见对象）

所有用户可见元素都是 Panel：

| Panel 类型 | 示例 |
| --- | --- |
| 按钮 Panel | Home 按钮 / User 按钮 / 业务按钮 |
| 图表 Panel | RadarChart / LineChart / BarChart |
| 统计卡片 Panel | ResultCard |
| 业务面板 Panel | BufferControl / ResultPanel |
| 控制面板 Panel | LayerControl |
| 信息面板 Panel | InfoPanel |

#### Zone（容器）

用于承载 Panel，Home 固定四象限：

```
┌─────────┬─────────┐
│  Zone2  │  Zone1  │  ← 上半部分
│ (可视化) │ (业务)  │
├─────────┼─────────┤
│  Zone3  │  Zone4  │  ← 下半部分
│ (图层)  │ (结果)  │
└─────────┴─────────┘
```

| Zone | 职责 | 尺寸 |
| --- | --- | --- |
| Zone1 | 业务控制区 | 4×4 Cell |
| Zone2 | 可视化区 | 4×4 Cell |
| Zone3 | 图层控制区 | 4×4 Cell |
| Zone4 | 结果展示区 | 4×4 Cell |

### 3.3 可视化解耦原则

```
业务层 Business
  ↓ 数据契约 Data Contract
可视化层 Visualization
  ↓ 渲染指令
地图层 Map
```

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| 业务层 | 调用 API / 产出数据 / 发出指令 | ❌ 直接操作图表 / 地图 |
| 可视化层 | 渲染图表 | ❌ 包含业务逻辑 |
| 地图层 | 空间表达 | ❌ 包含业务逻辑 |

**示例**：RadarChart 属于可视化资产，所有业务复用同一组件。

```
✅ 正确：RadarChart（统一组件）
❌ 错误：NewSiteRadar / OldSiteRadar（重复实现）
```

### 3.4 页面关系原则

| 页面 | 布局 | 说明 |
| --- | --- | --- |
| Home | Layout Base | 固定驾驶舱，定义四象限 |
| SiteSelection | Home Layout + 业务内容 | 继承 Layout Base |
| Throughput（未来） | Home Layout + 业务内容 | 继承 Layout Base |
| Profile | 独立布局 | 左右分区，不继承四象限 |

---

## 第四章 首页(Home)改造

### 4.1 现状

```
HomePage.vue 当前：
- 仅包含 InfoPanel（显示选中港口信息）
- 无业务入口
- 无可视化面板
- 无图层控制
```

### 4.2 目标

```
HomePage.vue 目标：
┌──────────────────────────────────────────────────────────┐
│  Zone2（4×4）         │  Zone1（4×4）                    │
│  ┌─────────────────┐  │  ┌─────────────────────────────┐│
│  │ 折线图面板       │  │  │ [Home] [User]               ││
│  │ (ThroughputChart)│  │  ├─────────────────────────────┤│
│  │                  │  │  │ 业务区标题                  ││
│  │                  │  │  │ [钦州] [防城港] [北海]      ││
│  │                  │  │  ├─────────────────────────────┤│
│  │                  │  │  │ [选址分析] [吞吐量预测]     ││
│  │                  │  │  │ [因子可视化] [航线分析]     ││
│  │                  │  │  │ [热力图] [更多业务]         ││
│  └─────────────────┘  │  └─────────────────────────────┘│
├──────────────────────────────────────────────────────────┤
│  Zone3（4×4）         │  Zone4（4×4）                    │
│  ┌─────────────────┐  │  ┌─────────────────────────────┐│
│  │ 图层控制区标题   │  │  │ 结果展示区                  ││
│  │ [矢量底图]      │  │  │ (预留，首页不显示内容)      ││
│  │ [影像底图]      │  │  │                             ││
│  │ [港口图层]      │  │  │                             ││
│  │ [边界图层]      │  │  │                             ││
│  │ [业务图层1]     │  │  │                             ││
│  │ [业务图层2]     │  │  │                             ││
│  └─────────────────┘  │  └─────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 4.3 施工步骤

#### 步骤 1：创建 Layout Base 组件

**新建文件**：`src/components/layout/AppLayout.vue`

**职责**：
- 定义四象限 Zone 布局
- 计算 Zone 位置（基于 CELL_PIXEL）
- 提供 Zone 插槽

**验收标准**：
- [ ] 四象限布局正确显示
- [ ] Zone 位置基于 CELL_PIXEL 计算
- [ ] 无硬编码 px

#### 步骤 2：创建 Zone 组件

**新建文件**：
- `src/components/layout/Zone1.vue`（业务控制区）
- `src/components/layout/Zone2.vue`（可视化区）
- `src/components/layout/Zone3.vue`（图层控制区）
- `src/components/layout/Zone4.vue`（结果展示区）

**职责**：
- Zone1：业务入口按钮 + 城市定位按钮
- Zone2：折线图面板
- Zone3：图层控制按钮
- Zone4：预留（首页不显示内容）

**验收标准**：
- [ ] 各 Zone 组件正确渲染
- [ ] Zone 尺寸基于 CELL_PIXEL
- [ ] Zone 位置正确

#### 步骤 3：创建 Panel 组件

**新建文件**：
- `src/components/panels/GcsPanel.vue`（通用 Panel 容器）
- `src/components/panels/GcsButton.vue`（按钮 Panel）
- `src/components/panels/ThroughputChart.vue`（折线图 Panel）

**职责**：
- GcsPanel：Frosted Glass 风格容器
- GcsButton：统一按钮样式
- ThroughputChart：折线图可视化

**验收标准**：
- [ ] Panel 样式统一（Frosted Glass）
- [ ] Button 样式统一
- [ ] 折线图正确渲染

#### 步骤 4：改造 HomePage

**修改文件**：`src/views/HomePage.vue`

**改造内容**：
- 引入 AppLayout
- 填充 Zone1 / Zone2 / Zone3 / Zone4
- 移除 InfoPanel（或迁移到 Zone4）

**验收标准**：
- [ ] 首页四象限布局正确
- [ ] 业务入口按钮可点击
- [ ] 城市定位按钮可点击
- [ ] 折线图正确显示
- [ ] 图层控制可用

### 4.4 验收标准

| 验收项 | 标准 |
| --- | --- |
| 布局 | 四象限布局正确，Zone 位置基于 CELL_PIXEL |
| 样式 | Panel 统一 Frosted Glass 风格 |
| 交互 | 业务入口按钮可点击，跳转正确 |
| 可视化 | 折线图正确渲染 |
| 图层 | 图层控制可用 |
| 响应式 | 窗口变化时布局自适应 |

### 4.5 回滚方案

```bash
# 回滚到重构前
git revert <commit-hash>

# 或回滚到特定 tag
git checkout gcs-v1-start
```

---

## 第五章 SiteSelection改造

### 5.1 现状

```
BufferPage.vue 当前：
- 右侧固定面板（BufferControl + ResultPanel）
- 左侧 RadarFloatPanel 浮窗
- 不继承 Home Layout
```

### 5.2 目标

```
SiteSelectionPage.vue 目标：
┌──────────────────────────────────────────────────────────┐
│  Zone2（4×4）         │  Zone1（4×4）                    │
│  ┌─────────────────┐  │  ┌─────────────────────────────┐│
│  │ 雷达图面板       │  │  │ [Home] [User]               ││
│  │ (RadarChart)    │  │  ├─────────────────────────────┤│
│  │                  │  │  │ 业务区标题                  ││
│  │                  │  │  │ [钦州] [防城港] [北海]      ││
│  │                  │  │  ├─────────────────────────────┤│
│  │                  │  │  │ [选址分析] [吞吐量预测]     ││
│  │                  │  │  │ [因子可视化] [航线分析]     ││
│  │                  │  │  │ [热力图] [更多业务]         ││
│  └─────────────────┘  │  └─────────────────────────────┘│
├──────────────────────────────────────────────────────────┤
│  Zone3（4×4）         │  Zone4（4×4）                    │
│  ┌─────────────────┐  │  ┌─────────────────────────────┐│
│  │ 图层控制区标题   │  │  │ 选址配置面板               ││
│  │ [矢量底图]      │  │  │ (BufferControl)             ││
│  │ [影像底图]      │  │  │                             ││
│  │ [港口图层]      │  │  │                             ││
│  │ [边界图层]      │  │  │                             ││
│  │ [分析结果图层]  │  │  │                             ││
│  │ [业务图层2]     │  │  │                             ││
│  └─────────────────┘  │  └─────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 5.3 施工步骤

#### 步骤 1：重命名 BufferPage

**修改文件**：`src/views/BufferPage.vue` → `src/views/SiteSelectionPage.vue`

**改造内容**：
- 引入 AppLayout
- 替换 Zone 内容（Zone2 显示雷达图，Zone4 显示选址配置）

**验收标准**：
- [ ] 页面重命名成功
- [ ] 路由更新成功

#### 步骤 2：迁移 BufferControl 到 Zone4

**修改文件**：`src/views/SiteSelectionPage.vue`

**改造内容**：
- 将 BufferControl 从右侧面板迁移到 Zone4
- 调整样式适配 Zone4 尺寸

**验收标准**：
- [ ] BufferControl 在 Zone4 正确显示
- [ ] 选址配置功能正常

#### 步骤 3：迁移 ResultPanel 到 Zone4

**修改文件**：`src/views/SiteSelectionPage.vue`

**改造内容**：
- 将 ResultPanel 从右侧面板迁移到 Zone4
- 与 BufferControl 组合显示

**验收标准**：
- [ ] ResultPanel 在 Zone4 正确显示
- [ ] 结果列表功能正常

#### 步骤 4：迁移 RadarFloatPanel 到 Zone2

**修改文件**：`src/views/SiteSelectionPage.vue`

**改造内容**：
- 将 RadarFloatPanel 从浮窗迁移到 Zone2
- 改为固定面板

**验收标准**：
- [ ] 雷达图在 Zone2 正确显示
- [ ] 雷达图数据正确

#### 步骤 5：更新路由

**修改文件**：`src/router/index.js`

**改造内容**：
- `/buffer` → `/site-selection`
- BufferPage → SiteSelectionPage

**验收标准**：
- [ ] 路由跳转正确
- [ ] 页面功能正常

### 5.4 验收标准

| 验收项 | 标准 |
| --- | --- |
| 布局 | 继承 Home Layout，四象限布局正确 |
| 业务 | 选址分析完整链路正常 |
| 可视化 | 雷达图正确显示 |
| 交互 | 选址配置 / 结果列表 / 雷达图联动正常 |
| 响应式 | 窗口变化时布局自适应 |

### 5.5 回滚方案

```bash
# 回滚到重构前
git revert <commit-hash>

# 或回滚到特定 tag
git checkout gcs-v1-layout-base
```

---

## 第六章 Profile改造

### 6.1 现状

```
ProfilePage.vue 当前：
- 左右分区布局（已实现）
- 左侧 ProfilePanel
- 右侧 PlanDrawer / PlanSaveModal
```

### 6.2 目标

```
ProfilePage.vue 目标：
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────────────────┐  ┌─────────────────────────────┐│
│  │ ProfilePanel        │  │ PlanDrawer / PlanSaveModal  ││
│  │                     │  │                             ││
│  │ - 用户信息          │  │ - 方案列表                  ││
│  │ - 登录/登出         │  │ - 方案操作                  ││
│  │                     │  │                             ││
│  └─────────────────────┘  └─────────────────────────────┘│
│                                                          │
│  采用左右分区布局，不继承四象限                            │
│  使用统一的 Cell / Panel 设计语言                         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.3 施工步骤

#### 步骤 1：调整 ProfilePage 布局

**修改文件**：`src/views/ProfilePage.vue`

**改造内容**：
- 保持左右分区布局
- 使用 Cell / Panel 统一设计语言
- 调整样式适配 CELL_PIXEL

**验收标准**：
- [ ] 左右分区布局正确
- [ ] 样式统一（Cell / Panel）
- [ ] 无硬编码 px

#### 步骤 2：迁移 ProfilePanel

**修改文件**：`src/views/ProfilePage.vue`

**改造内容**：
- 将 ProfilePanel 从 `components/user/` 迁移到 ProfilePage 内联
- 或保持独立组件，但调整样式

**验收标准**：
- [ ] ProfilePanel 正确显示
- [ ] 用户信息 / 登录登出功能正常

#### 步骤 3：迁移 PlanDrawer / PlanSaveModal

**修改文件**：`src/views/ProfilePage.vue`

**改造内容**：
- 将 PlanDrawer / PlanSaveModal 从 `components/user/` 迁移到 ProfilePage 内联
- 或保持独立组件，但调整样式

**验收标准**：
- [ ] PlanDrawer / PlanSaveModal 正确显示
- [ ] 方案管理功能正常

### 6.4 验收标准

| 验收项 | 标准 |
| --- | --- |
| 布局 | 左右分区布局正确 |
| 样式 | 使用 Cell / Panel 统一设计语言 |
| 功能 | 用户信息 / 登录登出 / 方案管理正常 |
| 响应式 | 窗口变化时布局自适应 |

### 6.5 回滚方案

```bash
# 回滚到重构前
git revert <commit-hash>

# 或回滚到特定 tag
git checkout gcs-v1-viz-decoupled
```

---

## 第七章 目录重构

### 7.1 目录现状

```
src/
├── components/
│   ├── analysis/           # 选址分析组件
│   ├── common/             # 通用组件
│   ├── map/                # 地图组件
│   └── user/               # 用户组件
├── composables/            # 组合式函数
├── config/                 # 配置
├── renderers/              # 渲染引擎
├── router/                 # 路由
├── services/               # 服务
├── stores/                 # 状态管理
├── types/                  # 类型定义
├── views/                  # 页面
├── App.vue
├── main.js
└── style.css
```

### 7.2 目标结构

```
src/
├── core/                       # 核心模块（稳定基线）
│   ├── map/
│   │   ├── renderers/          # 渲染引擎（禁止修改）
│   │   │   ├── MapRenderer.js
│   │   │   ├── OLRenderer.js
│   │   │   ├── CesiumRenderer.js
│   │   │   └── index.js
│   │   ├── UnifiedMap.vue      # 地图容器（禁止修改逻辑）
│   │   └── composables/        # 地图组合式函数
│   │       ├── useMapRenderer.js
│   │       ├── useLayerManager.js
│   │       └── useMapControls.js
│   └── config/
│       └── map.js              # 地图配置
│
├── layout/                     # 布局模块（本次重构重点）
│   ├── components/
│   │   ├── AppLayout.vue       # 布局基座
│   │   ├── Zone1.vue           # 业务控制区
│   │   ├── Zone2.vue           # 可视化区
│   │   ├── Zone3.vue           # 图层控制区
│   │   └── Zone4.vue           # 结果展示区
│   ├── panels/
│   │   ├── GcsPanel.vue        # 通用 Panel 容器
│   │   └── GcsButton.vue       # 按钮 Panel
│   └── composables/
│       └── useGCS.js           # GCS 组合式函数
│
├── business/                   # 业务模块
│   ├── site-selection/         # 选址分析
│   │   ├── SiteSelectionPage.vue
│   │   ├── components/
│   │   │   ├── BufferControl.vue
│   │   │   └── ResultPanel.vue
│   │   └── composables/
│   │       └── useSiteAnalysisApi.js
│   ├── throughput/             # 吞吐量预测（未来）
│   ├── factor/                 # 因子可视化（未来）
│   └── route-analysis/         # 航线分析（未来）
│
├── visualization/              # 可视化模块
│   ├── charts/
│   │   ├── RadarChart.vue      # 雷达图（统一资产）
│   │   ├── LineChart.vue       # 折线图（统一资产）
│   │   └── BarChart.vue        # 柱状图（统一资产）
│   └── panels/
│       ├── LayerControlPanel.vue  # 图层控制面板
│       └── InfoPanel.vue          # 信息面板
│
├── shared/                     # 共享模块
│   ├── components/
│   │   ├── ErrorBoundary.vue
│   │   └── ResultCard.vue
│   ├── composables/
│   │   ├── useAuth.js
│   │   ├── usePlans.js
│   │   └── useApiRequest.js
│   └── utils/
│       └── facilityLabels.js
│
├── stores/                     # 状态管理
│   ├── map.js
│   ├── chart.js                # 图表状态（新增）
│   └── business.js             # 业务状态（新增）
│
├── views/                      # 页面
│   ├── HomePage.vue
│   ├── ProfilePage.vue
│   └── login/                  # 登录页（未来）
│       └── LoginPage.vue
│
├── router/
│   └── index.js
│
├── App.vue
├── main.js
└── style.css
```

### 7.3 迁移步骤

#### 步骤 1：创建新目录结构

**操作**：
```bash
mkdir -p src/core/map/renderers
mkdir -p src/core/map/composables
mkdir -p src/core/config
mkdir -p src/layout/components
mkdir -p src/layout/panels
mkdir -p src/layout/composables
mkdir -p src/business/site-selection/components
mkdir -p src/business/site-selection/composables
mkdir -p src/visualization/charts
mkdir -p src/visualization/panels
mkdir -p src/shared/components
mkdir -p src/shared/composables
mkdir -p src/shared/utils
```

#### 步骤 2：迁移核心模块

**迁移文件**：
- `src/renderers/` → `src/core/map/renderers/`
- `src/components/map/UnifiedMap.vue` → `src/core/map/`
- `src/composables/useMapRenderer.js` → `src/core/map/composables/`
- `src/composables/useLayerManager.js` → `src/core/map/composables/`
- `src/composables/useMapControls.js` → `src/core/map/composables/`
- `src/config/map.js` → `src/core/config/`

**更新引用**：
- 更新所有 import 路径

#### 步骤 3：迁移布局模块

**新建文件**：
- `src/layout/components/AppLayout.vue`
- `src/layout/components/Zone1.vue`
- `src/layout/components/Zone2.vue`
- `src/layout/components/Zone3.vue`
- `src/layout/components/Zone4.vue`
- `src/layout/panels/GcsPanel.vue`
- `src/layout/panels/GcsButton.vue`
- `src/layout/composables/useGCS.js`

#### 步骤 4：迁移业务模块

**迁移文件**：
- `src/views/BufferPage.vue` → `src/business/site-selection/SiteSelectionPage.vue`
- `src/components/analysis/BufferControl.vue` → `src/business/site-selection/components/`
- `src/components/analysis/ResultPanel.vue` → `src/business/site-selection/components/`
- `src/composables/useSiteAnalysisApi.js` → `src/business/site-selection/composables/`

**更新引用**：
- 更新所有 import 路径

#### 步骤 5：迁移可视化模块

**迁移文件**：
- `src/components/analysis/RadarFloatPanel.vue` → `src/visualization/charts/RadarChart.vue`
- `src/components/map/LayerPanel.vue` → `src/visualization/panels/LayerControlPanel.vue`
- `src/components/common/InfoPanel.vue` → `src/visualization/panels/InfoPanel.vue`

**更新引用**：
- 更新所有 import 路径

#### 步骤 6：迁移共享模块

**迁移文件**：
- `src/components/common/ErrorBoundary.vue` → `src/shared/components/`
- `src/composables/useAuth.js` → `src/shared/composables/`
- `src/composables/usePlans.js` → `src/shared/composables/`
- `src/composables/useApiRequest.js` → `src/shared/composables/`
- `src/composables/facilityLabels.js` → `src/shared/utils/`

**更新引用**：
- 更新所有 import 路径

#### 步骤 7：清理旧目录

**操作**：
```bash
rm -rf src/components/
rm -rf src/composables/
rm -rf src/config/
rm -rf src/renderers/
```

#### 步骤 8：更新路由

**修改文件**：`src/router/index.js`

**改造内容**：
- 更新 import 路径
- 更新路由组件路径

### 7.4 验收标准

| 验收项 | 标准 |
| --- | --- |
| 目录结构 | 新目录结构正确 |
| 引用路径 | 所有 import 路径更新成功 |
| 构建 | `npm run build` 成功 |
| 功能 | 所有功能正常 |
| 测试 | `npm run test` 通过 |

### 7.5 回滚方案

```bash
# 回滚到重构前
git revert <commit-hash>

# 或回滚到特定 tag
git checkout gcs-v1-start
```

---

## 第八章 六阶段施工计划

### Phase 1：Layout Base 建立

#### Phase 1-A（上半段）：创建 AppLayout 组件

**目标**：创建布局基座组件，定义四象限 Zone 布局

**施工内容**：
- 新建 `src/layout/components/AppLayout.vue`
- 实现四象限 Zone 布局
- 基于 CELL_PIXEL 计算 Zone 位置

**影响范围**：
- 新增文件：`src/layout/components/AppLayout.vue`

**验收方式**：
- [ ] AppLayout 组件正确渲染
- [ ] 四象限布局正确显示
- [ ] Zone 位置基于 CELL_PIXEL 计算
- [ ] `npm run build` 成功
- [ ] `GetDiagnostics` 0 error

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 1-B（下半段）：创建 Zone 组件

**目标**：创建四个 Zone 组件，定义各区域职责

**施工内容**：
- 新建 `src/layout/components/Zone1.vue`（业务控制区）
- 新建 `src/layout/components/Zone2.vue`（可视化区）
- 新建 `src/layout/components/Zone3.vue`（图层控制区）
- 新建 `src/layout/components/Zone4.vue`（结果展示区）

**影响范围**：
- 新增文件：`Zone1.vue` / `Zone2.vue` / `Zone3.vue` / `Zone4.vue`

**验收方式**：
- [ ] 各 Zone 组件正确渲染
- [ ] Zone 尺寸基于 CELL_PIXEL
- [ ] Zone 位置正确
- [ ] `npm run build` 成功
- [ ] `GetDiagnostics` 0 error

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] Layout Base 组件完整
- [ ] 四象限布局正确
- [ ] Zone 组件完整

---

### Phase 2：Panel 体系建立

#### Phase 2-A（上半段）：创建 GcsPanel 组件

**目标**：创建通用 Panel 容器，统一 Frosted Glass 风格

**施工内容**：
- 新建 `src/layout/panels/GcsPanel.vue`
- 实现 Frosted Glass 风格
- 支持 Cell 尺寸计算

**影响范围**：
- 新增文件：`GcsPanel.vue`

**验收方式**：
- [ ] GcsPanel 组件正确渲染
- [ ] Frosted Glass 风格正确
- [ ] 尺寸基于 CELL_PIXEL
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 2-B（下半段）：创建 GcsButton 组件

**目标**：创建按钮 Panel，统一按钮样式

**施工内容**：
- 新建 `src/layout/panels/GcsButton.vue`
- 实现统一按钮样式
- 支持文字 + 图标

**影响范围**：
- 新增文件：`GcsButton.vue`

**验收方式**：
- [ ] GcsButton 组件正确渲染
- [ ] 按钮样式统一
- [ ] 文字 + 图标正确显示
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] Panel 体系完整
- [ ] Frosted Glass 风格统一
- [ ] 按钮样式统一

---

### Phase 3：首页改造

#### Phase 3-A（上半段）：改造 HomePage

**目标**：将 HomePage 改为四象限布局

**施工内容**：
- 修改 `src/views/HomePage.vue`
- 引入 AppLayout
- 填充 Zone1 / Zone2 / Zone3 / Zone4

**影响范围**：
- 修改文件：`HomePage.vue`

**验收方式**：
- [ ] 首页四象限布局正确
- [ ] Zone 内容正确显示
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 3-B（下半段）：填充 Zone 内容

**目标**：填充各 Zone 内容（业务入口 / 可视化 / 图层控制）

**施工内容**：
- Zone1：业务入口按钮 + 城市定位按钮
- Zone2：折线图面板
- Zone3：图层控制按钮
- Zone4：预留（首页不显示内容）

**影响范围**：
- 修改文件：`Zone1.vue` / `Zone2.vue` / `Zone3.vue` / `Zone4.vue`

**验收方式**：
- [ ] 业务入口按钮可点击
- [ ] 城市定位按钮可点击
- [ ] 折线图正确显示
- [ ] 图层控制可用
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] 首页四象限布局完整
- [ ] 业务入口可用
- [ ] 可视化可用
- [ ] 图层控制可用

---

### Phase 4：SiteSelection 改造

#### Phase 4-A（上半段）：重命名 + 迁移 BufferControl

**目标**：重命名 BufferPage，迁移 BufferControl 到 Zone4

**施工内容**：
- 重命名 `BufferPage.vue` → `SiteSelectionPage.vue`
- 引入 AppLayout
- 迁移 BufferControl 到 Zone4

**影响范围**：
- 重命名文件：`BufferPage.vue` → `SiteSelectionPage.vue`
- 修改文件：`SiteSelectionPage.vue`

**验收方式**：
- [ ] 页面重命名成功
- [ ] BufferControl 在 Zone4 正确显示
- [ ] 选址配置功能正常
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 4-B（下半段）：迁移 ResultPanel + RadarFloatPanel

**目标**：迁移 ResultPanel 到 Zone4，迁移 RadarFloatPanel 到 Zone2

**施工内容**：
- 迁移 ResultPanel 到 Zone4
- 迁移 RadarFloatPanel 到 Zone2
- 更新路由

**影响范围**：
- 修改文件：`SiteSelectionPage.vue`
- 修改文件：`router/index.js`

**验收方式**：
- [ ] ResultPanel 在 Zone4 正确显示
- [ ] 雷达图在 Zone2 正确显示
- [ ] 路由跳转正确
- [ ] 选址分析完整链路正常
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] SiteSelection 页面完整
- [ ] 选址分析完整链路正常
- [ ] 可视化正确显示

---

### Phase 5：Profile 改造

#### Phase 5-A（上半段）：调整 ProfilePage 布局

**目标**：调整 ProfilePage 为左右分区布局

**施工内容**：
- 修改 `src/views/ProfilePage.vue`
- 保持左右分区布局
- 使用 Cell / Panel 统一设计语言

**影响范围**：
- 修改文件：`ProfilePage.vue`

**验收方式**：
- [ ] 左右分区布局正确
- [ ] 样式统一（Cell / Panel）
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 5-B（下半段）：迁移 ProfilePanel + PlanDrawer

**目标**：迁移 ProfilePanel / PlanDrawer 到 ProfilePage

**施工内容**：
- 迁移 ProfilePanel 到 ProfilePage
- 迁移 PlanDrawer / PlanSaveModal 到 ProfilePage

**影响范围**：
- 修改文件：`ProfilePage.vue`

**验收方式**：
- [ ] ProfilePanel 正确显示
- [ ] PlanDrawer / PlanSaveModal 正确显示
- [ ] 用户信息 / 登录登出 / 方案管理正常
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] Profile 页面完整
- [ ] 左右分区布局正确
- [ ] 功能正常

---

### Phase 6：目录重构

#### Phase 6-A（上半段）：创建新目录 + 迁移核心模块

**目标**：创建新目录结构，迁移核心模块

**施工内容**：
- 创建新目录结构
- 迁移 `src/renderers/` → `src/core/map/renderers/`
- 迁移 `src/components/map/UnifiedMap.vue` → `src/core/map/`
- 迁移地图组合式函数
- 更新所有 import 路径

**影响范围**：
- 新增目录：`src/core/` / `src/layout/` / `src/business/` / `src/visualization/` / `src/shared/`
- 迁移文件：核心模块

**验收方式**：
- [ ] 新目录结构正确
- [ ] 核心模块迁移成功
- [ ] 所有 import 路径更新成功
- [ ] `npm run build` 成功

**回滚方式**：
```bash
git revert <commit-hash>
```

#### Phase 6-B（下半段）：迁移业务 + 可视化 + 共享模块

**目标**：迁移剩余模块，清理旧目录

**施工内容**：
- 迁移业务模块
- 迁移可视化模块
- 迁移共享模块
- 清理旧目录
- 更新路由

**影响范围**：
- 迁移文件：业务 / 可视化 / 共享模块
- 删除目录：`src/components/` / `src/composables/` / `src/config/` / `src/renderers/`

**验收方式**：
- [ ] 所有模块迁移成功
- [ ] 旧目录清理成功
- [ ] 所有功能正常
- [ ] `npm run build` 成功
- [ ] `npm run test` 通过

**回滚方式**：
```bash
git revert <commit-hash>
```

**阶段验收标准**：
- [ ] 目录重构完整
- [ ] 所有功能正常
- [ ] 构建成功
- [ ] 测试通过

---

## 第九章 总体验收标准

### 9.1 功能验收

| 验收项 | 标准 | 勾选 |
| --- | --- | --- |
| 首页布局 | 四象限布局正确，Zone 位置基于 CELL_PIXEL | [ ] |
| 业务入口 | 业务入口按钮可点击，跳转正确 | [ ] |
| 城市定位 | 城市定位按钮可点击，地图飞行正确 | [ ] |
| 可视化 | 折线图 / 雷达图正确渲染 | [ ] |
| 图层控制 | 图层控制可用，底图 / 业务图层切换正常 | [ ] |
| 选址分析 | 选址分析完整链路正常 | [ ] |
| Profile | 左右分区布局正确，功能正常 | [ ] |
| 响应式 | 窗口变化时布局自适应 | [ ] |

### 9.2 架构验收

| 验收项 | 标准 | 勾选 |
| --- | --- | --- |
| Layout Base | Home 作为布局基座，业务路由继承 | [ ] |
| Cell/Panel/Zone | 统一布局语言，无硬编码 px | [ ] |
| 可视化解耦 | Business → Data Contract → Visualization → Map | [ ] |
| 目录结构 | 按职责组织：Layout / Map / Business / Visualization / Shared | [ ] |
| 组件复用 | RadarChart / LineChart 等统一资产复用 | [ ] |

### 9.3 工程验收

| 验收项 | 标准 | 勾选 |
| --- | --- | --- |
| 构建 | `npm run build` 成功 | [ ] |
| 诊断 | `GetDiagnostics` 0 error | [ ] |
| 测试 | `npm run test` 通过 | [ ] |
| 地图基线 | renderers/ UnifiedMap 逻辑未改 | [ ] |
| 业务基线 | 选址分析算法逻辑未改 | [ ] |
| 后端基线 | server/ 未改 | [ ] |

### 9.4 回滚验收

| 验收项 | 标准 | 勾选 |
| --- | --- | --- |
| Git 节点 | 每阶段一个 Git 提交 | [ ] |
| 回滚测试 | `git revert` 可还原 | [ ] |
| 回滚验证 | 回滚后功能正常 | [ ] |

---

## 第十章 未来扩展约束

### 10.1 允许

| 允许项 | 说明 |
| --- | --- |
| ✅ 继承 Layout Base | 新增业务路由时优先复用 |
| ✅ 替换业务内容 | Zone 内业务内容可替换 |
| ✅ 替换 Panel 内容 | Zone 内 Panel 可替换 |
| ✅ 替换可视化内容 | Zone 内可视化可替换 |
| ✅ 扩展业务功能 | 新增业务路由 |
| ✅ 复用统一资产 | RadarChart / LineChart 等 |

### 10.2 禁止

| 禁止项 | 说明 |
| --- | --- |
| ❌ 重新定义布局规则 | 禁止修改四象限布局 |
| ❌ 重新定义 Cell | Cell 是数学单位，全局统一 |
| ❌ 重新定义 Panel | Panel 是可见对象，全局统一 |
| ❌ 重新定义 Zone | Zone 是容器，全局统一 |
| ❌ 修改 Home Layout | Home Layout 属于平台基础设施 |
| ❌ 引入第三方模板 | 禁止 Ant Design Pro / Vue Admin / DataV 等 |
| ❌ 重复实现可视化 | 禁止 NewSiteRadar / OldSiteRadar |

### 10.3 新增业务检查清单

新增业务路由前必须回答：

| 问题 | 答案 |
| --- | --- |
| 是否继承 Layout Base？ | ✅ 必须 |
| 是否复用 Cell/Panel/Zone？ | ✅ 必须 |
| 是否复用统一可视化资产？ | ✅ 必须 |
| 是否修改 Home Layout？ | ❌ 禁止 |
| 是否重新定义布局体系？ | ❌ 禁止 |

### 10.4 未来业务示例

#### 示例 1：吞吐量预测

```
ThroughputPage.vue
├── 继承 AppLayout
├── Zone1：业务入口按钮（同 Home）
├── Zone2：折线图面板（ThroughputChart）
├── Zone3：图层控制按钮（同 Home）
└── Zone4：吞吐量配置面板
```

#### 示例 2：航线分析

```
RouteAnalysisPage.vue
├── 继承 AppLayout
├── Zone1：业务入口按钮（同 Home）
├── Zone2：3D 地球面板（Cesium）
├── Zone3：图层控制按钮（同 Home）
└── Zone4：航线配置面板
```

---

## 附录 A：关键文件路径速查

### 稳定基线（禁止修改）

| 文件 | 说明 |
| --- | --- |
| `src/core/map/renderers/MapRenderer.js` | 渲染器抽象基类 |
| `src/core/map/renderers/OLRenderer.js` | OpenLayers 2D 实现 |
| `src/core/map/renderers/CesiumRenderer.js` | Cesium 3D 实现 |
| `src/core/map/UnifiedMap.vue` | 地图容器（生命周期管理） |
| `src/core/map/composables/useMapRenderer.js` | 渲染器 inject 契约 |
| `src/core/map/composables/useLayerManager.js` | 图层管理门面 |
| `src/stores/map.js` | 地图状态 + 互斥逻辑 |
| `src/core/config/map.js` | 地图配置 |
| `server/services/siteAnalysisService.js` | 后端选址算法 |
| `server/services/scoringService.js` | 后端评分 |

### 本次重构重点改造

| 文件 | 改造方向 |
| --- | --- |
| `src/views/HomePage.vue` | 四象限布局 |
| `src/views/SiteSelectionPage.vue` | 继承 Home Layout |
| `src/views/ProfilePage.vue` | 左右分区布局 |
| `src/layout/components/AppLayout.vue` | 布局基座 |
| `src/layout/components/Zone1.vue` | 业务控制区 |
| `src/layout/components/Zone2.vue` | 可视化区 |
| `src/layout/components/Zone3.vue` | 图层控制区 |
| `src/layout/components/Zone4.vue` | 结果展示区 |
| `src/layout/panels/GcsPanel.vue` | 通用 Panel 容器 |
| `src/layout/panels/GcsButton.vue` | 按钮 Panel |
| `src/router/index.js` | 路由更新 |
| `src/style.css` | --unit 替换为 CELL_PIXEL |

---

**文档版本**：V1.0
**修订日期**：2026-07-16
**编制**：架构师
**适用范围**：北部湾智慧港口选址分析平台 GCS V1 重构
**核心原则重申**：【地图稳定】【业务稳定】【Layout Base】【Cell/Panel/Zone 统一】【可视化解耦】【组件复用】【目录按职责组织】
