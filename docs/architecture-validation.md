# 北部湾港 WebGIS 智慧分析平台 —— 架构验证文档

> **v1.5 Architecture Validation Release**
>
> 项目定位：WebGIS 双引擎业务平台架构验证系统
> 当前阶段：架构能力验证，非业务产品交付

---

## 1. 双引擎架构

```
                    Business Layer
                    (3 个业务模块)
                         |
          ---------------+---------------
          |                              |
    2D Renderer                    3D Renderer
    (OpenLayers)                   (Cesium)
          |                              |
    选址分析 · 预测分析              浸没分析
    (空间计算 · 时序数据)          (3D 空间分析)
                         |
              BusinessLayerManager
              (统一图层生命周期)
                         |
              Layer Adapter Registry
        heatmap | geojson | points | polygon | waterSurface
                         |
                    GCS Layout System
                 (80px grid + PPS anchor)
```

### 1.1 引擎隔离设计

| 维度 | 2D (OpenLayers) | 3D (Cesium) | 隔离方式 |
|------|----------------|-------------|----------|
| 渲染器实例 | `OLRenderer` | `CesiumRenderer` | `MapRenderer` 抽象基类 |
| 业务路由 | 选址、预测 | 浸没 | `route.meta.engine` |
| 图层管理 | `BusinessLayerManager` | `BusinessLayerManager` | 共享 Manager，引擎相关 Adapter |
| 坐标系统 | EPSG:3857 | EPSG:4326 (WGS84) | Renderer 内部转换 |
| 相机状态 | zoom | height | `useMapControls` 桥接 |

### 1.2 BusinessLayerManager 生命周期

```
register(id, config)     → 创建图层条目（不渲染）
updateData(id, data)     → 更新图层数据（触发渲染）
setVisible(id, bool)     → 控制图层显隐
remove(id)               → 销毁图层 + 清理资源
has(id)                  → 检查图层是否存在
```

- 图层注册与数据填充分离：`register` 建目录，`updateData` 填数据
- 组件卸载时统一 `remove`，避免图层残留

---

## 2. 业务模块验证矩阵

| 模块 | 引擎 | 定位 | 验证目标 | 状态 |
|------|------|------|----------|------|
| **选址分析** | 2D | 核心业务 | 2D GIS 空间分析能力：缓冲区、叠加、权重模型 | ✅ 完成 |
| **预测分析** | 2D | 架构验证 | 2D 渲染引擎承载非空间计算型业务：时序数据驱动地图更新 | ✅ 完成 |
| **浸没分析** | 3D | 架构验证 | 3D 渲染引擎与空间分析业务解耦：Primitive 动态更新、图层生命周期 | ✅ 完成 |

### 2.1 选址分析（核心业务）

**技术栈**：OpenLayers + Turf.js

**能力验证**：
- 空间叠加分析（缓冲区 + 设施点）
- 多因子权重模型
- 小区匹配与评分
- 方案保存/恢复

**数据**：真实 POI 数据（学校、医院、商超、公交站）

### 2.2 预测分析（架构验证）

**定位**：验证 2D 渲染引擎承载非空间计算型业务的能力

**数据链路**：
```
时间参数 → 业务状态 → forecastAdapter → 时序数据 → ECharts → Heatmap/GeoJSON → 时间播放
```

**验证项**：
- [x] 动态数据驱动地图更新（时间滑块 + 指标切换 + 播放）
- [x] Heatmap + GeoJSON 图层切换
- [x] 多指标并行缓存与事务管理
- [x] Mock 数据 → 真实 API 切换路径（通过 forecastAdapter）

**注意**：不验证预测准确率，只验证数据链路稳定性。

### 2.3 浸没分析（架构验证）

**定位**：验证 3D 渲染引擎和空间分析业务解耦能力

**数据链路**：
```
水位参数 → floodAdapter → 高程模拟数据 → 空间过滤 → Cesium Primitive → 动态水面
```

**验证项**：
- [x] waterSurface Adapter 独立注册/销毁
- [x] Cesium Primitive API 动态构建水面几何体
- [x] 相机状态（height ↔ zoom）在 2D ↔ 3D 切换时的同步
- [x] 图层残留检测（路由离开后清理）
- [x] Mock 数据 → 真实 DEM 切换路径（通过 floodAdapter）

**注意**：不验证洪涝预测准确性，只验证 3D Layer 生命周期。

---

## 3. 数据策略

### 3.1 数据分层

```
Business Layer (业务层)
       |
       | 调用 Adapter 接口
       v
Data Adapter (适配层)
       |
       +---- Mock Data (开发阶段)
       |
       +---- Real API / Database (生产阶段)
```

### 3.2 Adapter 设计

| Adapter | 文件 | Mock 数据源 | 生产切换方式 |
|---------|------|------------|-------------|
| `forecastAdapter` | `src/services/adapters/forecastAdapter.js` | `public/data/forecast/*.json` | `setDataSource('api')` |
| `floodAdapter` | `src/services/adapters/floodAdapter.js` | `public/data/water-area.json` + 后端模拟 DEM | `setDataSource('api')` |

**核心原则**：替换 Adapter 实现，业务层和渲染层零改动。

### 3.3 Mock 数据目录

```
src/mock/
├── README.md           # Mock 数据边界说明
├── forecast/
│   └── README.md       # 预测数据说明（不含真实业务数据）
└── flood/
    └── README.md       # 浸没数据说明（不含真实 DEM）
```

所有 Mock 数据 README 声明：
1. 用途：架构验证阶段
2. 非生产数据声明
3. 替换方式：只需替换 Adapter

---

## 4. 技术栈一览

| 层 | 技术 | 用途 |
|----|------|------|
| 框架 | Vue 3 (Composition API) | 页面组件 |
| 状态管理 | Pinia (9 stores) | 全局状态 + 路由间持久化 |
| 2D 地图 | OpenLayers | 选址分析、预测分析 |
| 3D 地图 | Cesium (动态导入) | 浸没分析 |
| 空间分析 | Turf.js | 缓冲区、叠加、距离计算 |
| 数据可视化 | ECharts | 时序图表、雷达图 |
| 布局系统 | GCS V2 (80px grid + PPS anchor) | 面板布局 |
| 图层管理 | BusinessLayerManager | 统一图层生命周期 |
| 数据适配 | Data Adapter 层 | Mock ↔ 真实数据切换 |
| UI 框架 | Element Plus | 表单、消息、弹窗 |

---

## 5. 架构验证测试清单

### 5.1 路由切换稳定性

| 测试项 | 检查点 | 结果 |
|--------|--------|------|
| 首页 → 选址 → 预测 → 浸没 → 首页 | 无内存泄漏、无图层残留、无控制台错误 | ⬜ |
| 2D ↔ 3D 引擎切换 | 相机状态同步、旧 Engine 图层已销毁、新 Engine 渲染器就绪 | ⬜ |

### 5.2 预测分析链路

| 测试项 | 检查点 | 结果 |
|--------|--------|------|
| 时间滑块拖动 | 图层更新不闪烁、事务不过期 | ⬜ |
| 指标切换 (throughput ↔ berth ↔ traffic ↔ pressure) | 旧图层隐藏、新图层渲染、Heatmap ↔ GeoJSON 切换 | ⬜ |
| 时间播放 | 数据持续更新、停止时状态一致 | ⬜ |

### 5.3 浸没分析链路

| 测试项 | 检查点 | 结果 |
|--------|--------|------|
| 水位调整 (0 → 10 → 20 → 50) | Primitive 更新、水面高度变化、淹没范围重算 | ⬜ |
| 图层显隐切换 | waterSurface / flood-area / facilities 独立控制 | ⬜ |
| 路由离开 | 3 个图层全部 remove、gcsLayersRegistered 重置 | ⬜ |

---

## 6. 已知限制与后续规划

### 6.1 当前限制

| 项目 | 说明 | 影响范围 |
|------|------|----------|
| Mock 数据 | 预测时序数据、水位高程数据均为示意性 | 预测分析、浸没分析 |
| 无真实 DEM | 浸没分析使用模拟高程 | 浸没分析精度 |
| Cesium 首次加载 | ~5MB 动态导入，首次访问 3D 路由有延迟 | 浸没分析首屏 |
| 无工业级预测模型 | 未接入 LSTM/时序预测引擎 | 预测分析准确率 |

### 6.2 后续扩展路径

1. **生产数据接入**：替换 Adapter 实现，对接自然资源局 DEM + 港口实时数据库
2. **预测模型集成**：通过 Adapter 接入时序预测服务（LSTM / Prophet）
3. **更多业务模块**：基于现有架构注册新的 Business → Renderer → Adapter 链路
4. **性能优化**：Cesium 预加载、图层 LOD、数据分页

---

*文档版本：v1.5 | 生成日期：2026-07-24 | 作者：架构验证团队*
