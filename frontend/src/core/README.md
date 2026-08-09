# core — 前端核心层

> 地图双引擎、GCS V2 布局基座与图层生命周期的统一管理入口。
> 业务层（`business/`）通过 `@/core` 公开 API 与 provide/inject 注入键消费本层能力，不直接依赖 OL/Cesium API。

## 一、模块职责

core 承担三类「与业务无关」的基础能力：

1. **地图核心**：`UnifiedMap` 双引擎容器（OL 2D / Cesium 3D），`MapRenderer` 抽象基类 + 子类策略，`BusinessLayerManager`（BLM）业务图层生命周期，`layerAdapters` 分派注册表。
2. **布局基座**：`AppLayout` GCS V2 面板定位系统（PPS），导航注册机制，屏幕操作（首页/个人中心/城市飞行）。
3. **地图配置**：天地图底图、相机参数、视图层级、zoom↔height 互逆公式。

## 二、目录结构

```
core/
├── index.ts                 # 公开 API 入口（re-export 非组件模块）
├── provideKeys.ts           # 类型化 InjectionKey（4 个 provide 键）
├── config/
│   └── map.ts               # MAP_CONFIG + buildTiandituUrl + zoomToHeight/heightToZoom
├── layout/
│   ├── AppLayout.vue        # GCS V2 布局基座（PPS 定位 + 抽屉菜单）
│   ├── useMobileDrawer.ts   # 移动端抽屉状态（模块级单例）
│   ├── components/          # BottomNavBar(3键dock) / GCSButton / GCSPanel / NavButton / MobileDrawer / DebugToggle
│   └── composables/
│       └── useScreenActions.ts   # goHome/goProfileOrBack/flyToCity/userButtonLabel
└── map/
    ├── UnifiedMap.vue            # 双引擎容器（v-show 切换，渲染器复用不销毁）
    ├── BusinessLayerManager.ts   # 业务图层注册/更新/显隐/移除/reapplyAll
    ├── layerAdapters.ts          # LAYER_ADAPTERS 注册表（heatmap/geojson/points/polygon/waterSurface/geotiff）
    ├── components/LayerControlPanel.vue
    ├── composables/              # useBoundaryLayer / useBusinessLayers / useLayerManager / useMapControls / useMapRenderer / usePortLayer
    └── renderers/
        ├── index.ts              # createRenderer 工厂（2D 静态 / 3D 动态加载 Cesium）
        ├── MapRenderer.ts        # 抽象基类（策略模式）
        ├── OLRenderer.ts         # OpenLayers 2D 实现
        ├── CesiumRenderer.ts     # Cesium 3D 实现
        ├── CesiumEvents.ts / CesiumLayerRegistrar.ts / CesiumViewportCulling.ts / CesiumWaterSurface.ts
        └── renderers.d.ts
```

## 三、入口文件

### `index.ts`
公开 API 聚合点。约定：
- `components/` 与 `*.vue` 组件**不 re-export**，消费方走直接路径 import（如 `@/core/map/UnifiedMap.vue`）。
- `renderers/index.ts` 的 `createRenderer` / `OLRenderer` 仅 core 内部使用，不对外暴露。
- renderers 子目录内部辅助文件（`CesiumEvents` / `CesiumLayerRegistrar` 等）不 re-export。

### `provideKeys.ts`
用类型化 `InjectionKey` 替代字符串 key，对应 App.vue 的 4 个 provide：
- `RESTORE_PLAN_DATA_KEY` → ProfilePage 消费（计划恢复数据）
- `EDITING_PLAN_KEY` → ProfilePage 消费（当前编辑计划）
- `UNIFIED_MAP_KEY` → `useMapControls` 消费（UnifiedMap 暴露接口：flyTo/startBreathing/stopBreathing/getRenderer）
- `MAP_STORE_KEY` → `useLayerManager` 消费（mapStore 实例）

## 四、关键机制

### UnifiedMap 生命周期（`map/UnifiedMap.vue`）
- **双引擎策略**：OL 与 Cesium 容器均 `v-show` 切换；渲染器实例**长期复用、不销毁**，首次创建后保留在 `olRenderer`/`cesiumRenderer` ref。
- **Cesium 懒加载**：3D 首次切换时动态注入 `<script>` 加载 Cesium.js（5.7MB），首屏零开销；`ensureCesiumLoaded` 幂等（模块级单例 promise）。
- **引擎切换流程**：`switchMapType` → 导出旧相机状态 → `initRenderer`（复用则 `updateSize`+`setupLayers`，新建则 `createRenderer`+`setupLayers`+`setupEvents`）→ 导入相机状态 → `emit('typeChange')`。
- **重入保护**：切换进行中排队最新请求，完成后仅执行最后一个（`pendingSwitchType`）。
- **核心常驻层收口**（`@arch-note a033 / D-12=B`）：boundary/ports 不再由组件直管，统一收口到 BLM，与业务图层走同一 registry。

### BLM（BusinessLayerManager）注册表（`map/BusinessLayerManager.ts`）
业务数据驱动的图层生命周期管理器。API：`register / updateData / setVisible / remove / has / reapplyAll / removeAllFromRenderer / destroy`。
- Manager **不持有 renderer 引用**，每次从 `mapStore.currentRenderer` 动态获取。
- `layerCatalog` 条目只存元数据，不存 renderer 对象；`LayerControlPanel` 通过 catalog 读取状态。
- `updateData` 不覆盖 `visible` 状态。

### 渲染器复用语义
- `MapRenderer` 抽象基类：2D/3D 公共能力（layer Map、事件总线 EventTarget、flyTo 归一化、exportState/importState 相机迁移、pending visibility）。
- 2D Only 方法（`addGeoTIFFLayer` / `addHeatmapLayer`）：基类默认返回 false，仅 OLRenderer 实现。
- 3D Only 方法（`addWaterSurface` / `startBreathing` 等）：基类默认返回 false，仅 CesiumRenderer 实现。
- `layerAdapters.ts` 的 `LAYER_ADAPTERS` 按 `layerType` 分派；新增 layerType 只加条目，不碰 Manager。

## 五、依赖关系

- **向 shared 依赖**：`logger` / `useGCS` / `CELL_PIXEL`（GCS 布局）。
- **向 stores 依赖**：`useMapStore`（currentRenderer / layerCatalog / mapType）。
- **向 types 依赖**：`MapRenderer` / `LayerEntry` / `FlyToOptions` / `LayerType` 等。
- **被依赖方**：`business/` 各业务页通过 `@/core` + `@/core/...vue` 消费；`App.vue` 通过 provideKeys 注入。

## 六、关键约束（@arch-note）

| 标注 | 文件 | 约束 |
|------|------|------|
| `a016-D06` | BusinessLayerManager | 引擎切换时 `clearLayerCatalog()` 清空 catalog，可见性必须以 `_registry` 为准，reapplyAll/setVisible 不依赖 catalog，否则 2D↔3D 切换后业务图层丢失 |
| `a018-D06` | BusinessLayerManager | `clearLayerCatalog` 同样清掉业务图层 catalog 条目，reapplyAll 须按 registry 重建缺失条目（幂等，已存在则跳过） |
| `a020` | BusinessLayerManager | `reapplyAll` 中 `adapter.create` 必须逐层容错，单层失败（如 Cesium DeveloperError）只 warn 不中断整批 |
| `a023` | UnifiedMap | 卸载时遍历销毁两个缓存渲染器（非仅当前），ref 显式置空，store 悬空引用清除，停止排队的引擎切换 |
| `a025` | UnifiedMap | click 监听具名回调 + off 解绑，注册/移除配对契约 |
| `a033 (D-12=B)` | UnifiedMap | 核心常驻层（boundary/ports）收口到 BLM，与业务图层统一走 registry |
| `z024` | UnifiedMap | 组件级 abort（loadAbort），卸载后阻止异步回调继续写 ref |
| `c023` | 业务导航 | 2026-08-09 重构：navConfig 已删，底部 dock 固定 3 键（首页/个人中心/菜单），业务入口+城市切换统一收敛到 AppLayout 抽屉菜单（business/manifest 单一事实源） |

## 七、测试

`map/__tests__/`：`BusinessLayerManager.test.ts`、`BusinessLayerManager.orphan.test.ts`（孤儿图层）、`UnifiedMap.test.ts`。
`map/renderers/__tests__/`：`MapRenderer.interface.test.ts`、`OLRenderer.culling.test.ts`、`OLRenderer.heatmap.test.ts`、`CesiumRenderer.geojson.test.ts`。
