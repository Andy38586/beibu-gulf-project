# 业务扩展指南

> **如何新增一个业务模块而不修改核心引擎**
>
> 适用版本：v1.5 Architecture Validation Release
> 验证案例：港口碳排放分析（carbon-analysis）

---

## 核心原则

```
新增业务 = Business Module + Adapter + Route Registration

          改核心引擎 = 架构失败
```

**不修改的文件清单**（这是验证标准）：

| 文件 | 理由 |
|------|------|
| `core/map/UnifiedMap.vue` | 地图组件，所有业务共享 |
| `core/map/BusinessLayerManager.js` | 图层管理器，通用接口 |
| `core/map/layerAdapters.js` | 图层适配器注册表，已有 5 种类型 |
| `core/map/renderers/MapRenderer.js` | 渲染器抽象基类 |
| `core/map/renderers/OLRenderer.js` | 2D 渲染器 |
| `core/map/renderers/CesiumRenderer.js` | 3D 渲染器 |
| `core/layout/AppLayout.vue` | 页面布局模板 |
| `core/layout/useGCS.js` | GCS 布局引擎 |
| 任何现有业务模块 | site-selection / forecast / flood-analysis |

---

## 步骤 1：创建 Mock 数据 + README

```
src/mock/<new-business>/
├── <data>.json      # Mock 数据文件
└── README.md        # 声明用途 + 替换方式
```

README 必须写清楚三件事：
1. 这是架构验证阶段的模拟数据
2. 不是生产数据
3. 替换方式：只改 Adapter

**案例**：`src/mock/carbon/carbonEmission.json` + `README.md`

---

## 步骤 2：创建 Data Adapter

```
src/services/adapters/<business>Adapter.js
```

Adapter 必须有：
- `dataSource` 开关（`'mock'` / `'api'`）
- `setDataSource(mode)` 方法
- 业务方法当前返回 Mock，将来返回 API

```js
// 最小模板
let dataSource = 'mock'

export const myAdapter = {
  setDataSource(mode) { dataSource = mode },

  async getData() {
    if (dataSource === 'mock') {
      return mockData  // 或 fetch('/mock/my-data.json')
    }
    // TODO: 生产环境
    // return axios.get('/api/my-data')
  },
}
```

**关键**：业务层只调用 `myAdapter.getData()`，不关心数据来源。

---

## 步骤 3：创建独立 Store

```
src/stores/<business>State.js
```

每个业务模块拥有独立的 Pinia Store：

```js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMyState = defineStore('<business>', () => {
  const data = ref(null)
  const isLoading = ref(false)

  function setData(d) { data.value = d }
  function reset() { data.value = null; isLoading.value = false }

  return { data, isLoading, setData, reset }
})
```

**规则**：
- Store 之间不互相依赖
- `reset()` 清理本 Store 所有状态
- 不与 `mapStore`、`gcsStore` 等核心 Store 耦合

---

## 步骤 4：创建业务页面

```
src/business/<new-business>/
├── <BusinessName>Page.vue        # 主页面
├── components/                    # 业务专属组件（可选）
│   └── ControlPanel.vue
└── composables/                   # 业务逻辑（可选）
    └── useMyLayer.js
```

### 4.1 页面模板结构

```vue
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { useMapStore } from '@/stores/map'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { myAdapter } from '@/services/adapters'

const mapStore = useMapStore()
const { manager } = useBusinessLayers()

// ===== 图层注册 =====
const LAYER_ID = 'my-business-layer'
let layerRegistered = false

function registerLayer() {
  if (layerRegistered || !manager) return
  layerRegistered = true

  manager.register(LAYER_ID, {
    label: '业务图层名称',
    layerType: 'points',    // 可选: heatmap | geojson | points | polygon | waterSurface
    data: null,
    options: { featureType: 'my-feature-type' },
    visible: true,
  })
}

watch(() => mapStore.currentRenderer, (r) => { if (r) registerLayer() }, { immediate: true })

// ===== 数据加载 =====
async function loadData() {
  const data = await myAdapter.getData()
  // 处理数据...
}

// ===== 地图渲染 =====
function updateMapLayer(data) {
  const geojson = {
    type: 'FeatureCollection',
    features: data.map(item => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
      properties: { ...item },
    })),
  }

  manager.updateData(LAYER_ID, { data: geojson, options: { /* ... */ } })
}

// ===== 生命周期 =====
onMounted(() => loadData())

onUnmounted(() => {
  if (manager.has(LAYER_ID)) manager.remove(LAYER_ID)
  layerRegistered = false
  // myStore.reset()
})
</script>

<template>
  <div class="my-page">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <!-- 图表/数据面板 -->
        </GcsPanel>
      </template>

      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <!-- 控制面板 -->
        </GcsPanel>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.my-page {
  width: 100%; height: 100%; position: relative; overflow: hidden;
  pointer-events: none;
}
.my-page :deep(.gcs-panel) { pointer-events: auto; }
</style>
```

### 4.2 GCS 面板布局说明

```
+------------------+------------------+
| 左上 4x4         | 右上 4x4         |
| (图表/数据)      | (控制面板)       |
+------------------+------------------+
| 左下 4x4         | 右下 4x4         |
| (辅助面板)       | LayerControlPanel|
+------------------+------------------+
```

每个 Panel 通过 GcsPanel 组件定位：
- `anchor`: `top-left` | `top-right` | `bottom-left` | `bottom-right`
- `:w` `:h`: 宽高（单位：80px 格）
- `:offset-x` `:offset-y`: 偏移（单位：80px 格）

---

## 步骤 5：注册路由

在 `src/router/index.js` 中添加：

```js
{
  path: '/my-business',
  name: 'MyBusiness',
  component: () => import('@/business/my-business/MyBusinessPage.vue'),
  meta: { engine: '2d', title: '业务名称' },
}
```

- `engine: '2d'` → 使用 OpenLayers 渲染器
- `engine: '3d'` → 使用 Cesium 渲染器
- 业务代码不依赖 engine 选择——由 `BusinessLayerManager` 内部处理

---

## 步骤 6：导出 Adapter

在 `src/services/adapters/index.js` 中添加一行：

```js
export { myAdapter } from './myBusinessAdapter'
```

---

## 步骤 7：验证

### 验收清单

| # | 验证项 | 方法 |
|---|--------|------|
| 1 | 路由正常访问 | 输入 URL，页面渲染 |
| 2 | 图层注册成功 | LayerControlPanel 中可见 |
| 3 | 图层可显隐切换 | LayerControlPanel 切换开关 |
| 4 | 路由离开后图层销毁 | 切换到其他页面，Developer Tools 检查 |
| 5 | 无控制台错误 | Console 面板 |
| 6 | 未修改核心文件 | `git diff --stat` 确认只改 router + adapters/index |
| 7 | 其他业务不受影响 | 依次打开选址→预测→浸没，功能正常 |
| 8 | 构建通过 | `npm run build` |

---

## 可用的共享组件

新增业务时，以下组件无需自己实现：

| 组件 | 用途 | 位置 |
|------|------|------|
| `AppLayout` | 页面布局模板 | `core/layout/` |
| `GcsPanel` | 面板容器（GCS 定位） | `core/layout/components/` |
| `LayerControlPanel` | 图层显隐控制 | `shared/components/` |
| `LineChart` | 折线图 | `visualization/charts/` |
| `BarChart` | 柱状图 | `visualization/charts/` |
| `RadarChart` | 雷达图 | `visualization/charts/` |
| `UnifiedMap` | 地图（自动管理） | `core/map/` |

---

## 可用的图层类型

| layerType | 用途 | 数据格式 |
|-----------|------|----------|
| `points` | 点标记 | GeoJSON Point FeatureCollection |
| `heatmap` | 热力图 | `[{coordinates, value}]` 数组 |
| `geojson` | 多边形/线 | GeoJSON FeatureCollection |
| `polygon` | 自定义多边形 | 坐标数组 |
| `waterSurface` | 水面（仅 3D） | `{coordinates, height}` |

---

## 架构验证结果

本指南以 **港口碳排放分析（carbon-analysis）** 为验证案例，实测结论：

| 变更类型 | 文件数 | 说明 |
|----------|--------|------|
| 新增文件 | 5 | Page + Store + Adapter + Mock + README |
| 修改配置 | 2 | router（+7行）+ adapters/index（+1行） |
| 核心引擎 | **0** | UnifiedMap / BusinessLayerManager / Renderers 全部未触碰 |

**结论**：平台满足"插件化业务扩展"设计目标。

---

## 附录：从 3 业务扩展到 4 业务的完整 diff

```
新增：
  src/business/carbon-analysis/CarbonAnalysisPage.vue  ← 主页面
  src/stores/carbonState.js                             ← 独立 Store
  src/services/adapters/carbonAdapter.js                ← 数据适配器
  src/mock/carbon/carbonEmission.json                   ← Mock 数据
  src/mock/carbon/README.md                             ← 数据边界声明

修改：
  src/router/index.js            +7 lines   ← 路由注册
  src/services/adapters/index.js +1 line    ← 导出

未修改：
  src/core/  （全部 0 改动）
  src/shared/（全部 0 改动）
  src/business/site-selection/（0 改动）
  src/business/forecast/（0 改动）
  src/business/flood-analysis/（0 改动）
  src/visualization/（0 改动）
  src/stores/map.js（0 改动）
```

---

*文档版本：v1.5 | 验证日期：2026-07-24*
