# 北部湾港 WebGIS 智慧分析平台 —— 架构验证文档

> **v1.5 Architecture Validation Release**
>
> 项目定位：WebGIS 双引擎业务平台架构验证系统
> 当前阶段：**双引擎业务扩展架构通过第一轮扩展性验证**

---

## 1. 双引擎架构

```
                    Business Layer
                   (4 个业务模块)
                         |
          ---------------+---------------
          |                              |
    2D Renderer                    3D Renderer
    (OpenLayers)                   (Cesium)
          |                              |
    选址分析 · 预测分析              浸没分析
    碳排放分析
          |                              |
              BusinessLayerManager
              (统一图层生命周期)
                         |
              Layer Adapter Registry
        heatmap | geojson | points | polygon | waterSurface
                         |
                    GCS Layout System
                 (80px grid + PPS anchor)
```

### 1.1 引擎隔离

| 维度 | 2D (OpenLayers) | 3D (Cesium) | 隔离方式 |
|------|----------------|-------------|----------|
| 渲染器实例 | `OLRenderer` | `CesiumRenderer` | `MapRenderer` 抽象基类 |
| 业务路由 | 选址、预测、碳排放 | 浸没 | `route.meta.engine` |
| 图层管理 | `BusinessLayerManager` | `BusinessLayerManager` | 共享 Manager，引擎相关 Adapter |
| 坐标系统 | EPSG:3857 | EPSG:4326 | Renderer 内部转换 |
| 相机状态 | zoom | height | `useMapControls` 桥接 |

### 1.2 BusinessLayerManager API

```
register(id, config)     → 创建图层条目（不渲染）
updateData(id, data)     → 更新图层数据（触发渲染）
setVisible(id, bool)     → 控制图层显隐
remove(id)               → 销毁图层 + 清理资源
has(id)                  → 检查图层是否存在
```

---

## 2. 业务模块验证矩阵

| 模块 | 引擎 | 定位 | 验证目标 | 状态 |
|------|------|------|----------|------|
| 选址分析 | 2D | 核心业务 | 2D GIS 空间分析能力（缓冲区、叠加、权重模型） | ✅ |
| 预测分析 | 2D | 架构验证 | 2D 渲染引擎承载非空间计算型业务（时序数据 → 地图） | ✅ |
| 浸没分析 | 3D | 架构验证 | 3D 引擎与空间分析业务解耦（Primitive 生命周期） | ✅ |
| 碳排放分析 | 2D | **扩展性验证** | 新增业务不修改核心引擎（碳排业务实验） | ✅ |

### 选址分析（核心业务）

**技术栈**：OpenLayers + Turf.js  
**数据**：真实 POI 数据（学校、医院、商超、公交站）  
**能力**：空间叠加分析、多因子权重模型、小区匹配与评分、方案保存/恢复

### 预测分析（架构验证）

**定位**：验证 2D 渲染引擎承载非空间计算型业务的能力

**数据链路**：
```
时间参数 → 业务状态 → forecastAdapter → 时序数据 → ECharts → Heatmap/GeoJSON → 时间播放
```

**验证项**：
- [x] 动态数据驱动地图更新（时间滑块 + 指标切换 + 播放）
- [x] Heatmap + GeoJSON 图层切换
- [x] 多指标并行缓存与事务管理
- [x] Mock 数据 → 真实 API 切换路���（通过 forecastAdapter）

### 浸没分析（��构验证）

**定位**：验证 3D 渲染引擎和空间分析业务解耦能力

**数据链路**：
```
水位参数 → floodAdapter → 高程模拟数据 → 空间过滤 → Cesium Primitive → 动态水面
```

**验证项**：
- [x] waterSurface Adapter 独立注册/销毁
- [x] Cesium Primitive API 动态构建水面几何体
- [x] 相机状态（height ↔ zoom）在 2D ↔ 3D 切换时同步
- [x] 图层残留检测（路由离开后清理）

### 碳排放分析（扩展性验证）★

**定位**：**架构验收实验**——从零新增第 4 业务，验证扩展成本

**变更审计**：

| 类别 | 文件 | 说明 |
|------|------|------|
| 核心引擎 | `BusinessLayerManager.js` | ❌ 未修改 |
| | `layerAdapters.js` | ❌ 未修改 |
| | `MapRenderer.js` / `OLRenderer.js` / `CesiumRenderer.js` | ❌ 未修改 |
| | `UnifiedMap.vue` | ❌ 未修改 |
| | `AppLayout.vue` / GCS 布局 | ❌ 未修改 |
| 配置 | `router/index.js` | +7 行 |
| | `adapters/index.js` | +1 行 |
| 新增 | `CarbonAnalysisPage.vue` + `carbonState.js` + `carbonAdapter.js` | 3 个文件 |

**结论**：新增业务只需注册路由 + 注册 Adapter，核心引擎零改动。

---

## 3. 数据策略

```
Business Layer
       |
       | 调用 Adapter 接口
       v
Data Adapter
       |
       +---- Mock Data（开发阶段）
       |
       +---- Real API / Database（生产阶段）
```

| Adapter | Mock 源 | 生产切换 |
|---------|---------|----------|
| `forecastAdapter` | `public/data/forecast/*.json` | `setDataSource('api')` |
| `floodAdapter` | `public/data/water-area.json` + 模拟 DEM | `setDataSource('api')` |
| `carbonAdapter` | `src/mock/carbon/carbonEmission.json` | `setDataSource('api')` |

**核心原则**：替换 Adapter 实现，业务层和渲染层零改动。

---

## 4. 架构验收评分

### 基准验收（8/8）

| # | 指标 | 验证方式 | 结果 |
|---|------|----------|------|
| 1 | 新增业务无需改核心引擎 | carbon-analysis 实验：0 核心文件修改 | ✅ |
| 2 | 数据替换 mock→API 无需改业务 | Adapter 模式：仅改 adapter，业务代码不变 | ✅ |
| 3 | 2D/3D 业务代码不依赖 renderer | BusinessLayerManager 动态获取 currentRenderer | ✅ |
| 4 | 生命周期切换无资源泄漏 | 三模块 onUnmounted：移除图层+取消请求+重置 Store | ✅ |
| 5 | 新增业务只注册路由+Adapter | carbon 仅 router (+7行) + adapters/index (+1行) | ✅ |
| 6 | 图层自动创建销毁 | BusinessLayerManager register/remove | ✅ |
| 7 | 业务状态独立 | 4 个模块独立 Pinia Store，互不依赖 | ✅ |
| 8 | 单业务失败不影响其他 | 独立 AbortController + try/catch 隔离 | ✅ |

### 进阶验证（待完成）

| # | 指标 | 测试方法 |
|---|------|----------|
| 9 | 故障隔离 | 故意让 carbon API 返回 500，验证其他业务不受影响 |
| 10 | 业务卸载 | 删除 carbon-analysis 全部文件，验证系统无残留 |
| 11 | 复杂度曲线 | 再新增 2 个空壳业务，验证核心代码变化 ≈ 0 |

---

## 5. 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 框架 | Vue 3 (Composition API) | 页面组件 |
| 状态管理 | Pinia (10 stores) | 全局状态 + 路由间持久化 |
| 2D 地图 | OpenLayers | 选址分析、预测分析、碳排放分析 |
| 3D 地图 | Cesium（动态导入） | 浸没分析 |
| 空间分析 | Turf.js | 缓冲区、叠加、距离计算 |
| 数据可视化 | ECharts | 时序图表、雷达图 |
| 布局系统 | GCS V2（80px grid + PPS anchor） | 面板布局 |
| 图层管理 | BusinessLayerManager | 统一图层生命周期 |
| 数据适配 | Data Adapter 层 | Mock ↔ 真实数据切换 |

---

## 6. 已知限制

| 项目 | 说明 | 影响范围 |
|------|------|----------|
| Mock 数据 | 预测时序、水位高程、碳排放均为示意性 | 预测分析、浸没分析、碳排放分析 |
| 无真实 DEM | 浸没分析使用模拟高程 | 浸没分析精度 |
| Cesium 首次加载 | ~5MB 动态导入，首访延迟 | 浸没分析首屏 |
| 未接入预测模型 | 未对接 LSTM/Prophet 等时序预测 | 预测准确率 |

---

## 7. 相关文档

| 文档 | 用途 |
|------|------|
| `business-extension-guide.md` | 如何新增业务模块（step-by-step） |
| `项目设计准则.md` | 项目设计规范 |
| `src/mock/*/README.md` | 各模块 Mock 数据说明 |

---

*文档版本：v1.5 | 更新日期：2026-07-24*
