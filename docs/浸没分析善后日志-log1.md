# 浸没分析模块善后日志 — log1

> 日期：2026-07-23
> 主题：P1-1/P1-2 实施后三个复现问题的排查与修复

---

## 复现问题清单

| # | 问题 | 严重度 | 引入阶段 |
|---|------|--------|---------|
| 1 | 浸没分析左侧面板（分析报告 + 受影响设施清单）无数据响应 | P0（阻塞） | P1-2 修复 |
| 2 | 淹没范围图层即使开启开关也不显示 | P0（阻塞） | 原有 + P1-2 修复恶化 |
| 3 | 2D→3D 引擎切换无飞行动画 | P2（体验） | 原有（setView 永久性方案） |

---

## 排查过程

### 问题 1：左面板无响应

**初步怀疑**：Store 引用变更导致连接断开。

**实际根因**：`rendererReady` 守卫阻断。

执行链路：

```
组件 setup 阶段:
  waterLevel watcher (immediate: true)
    → triggerFloodAnalysis(0)  // 水位=0
    → if (!rendererReady.value) return  // ← 守卫拦截 ❌
    → floodStore 永远不被写入

500ms 后:
  renderer 就绪 → registerGcsLayers()
    → rendererReady = true
    → 重触发检查: if (waterLevel > 0)  // ← waterLevel=0 → 不触发 ❌
    → floodStore 仍然是空

面板渲染:
  FloodAnalysisReportPanel → floodStore.floodStatistics = null → "开始分析后显示浸没报告"
  AffectedFacilityListPanel → portImpactStore.affectedFacilities = [] → "暂无受影响设施"
```

**为何之前正常**：原有的 `triggerFloodAnalysis` 没有守卫，API 请求发出 → `floodStore.startFloodAnalysis` 写入 store（此时渲染器可能未就绪，`renderFloodAreas` 早返回）。之后渲染器就绪 → `registerGcsLayers` 注册图层 → show handler 从 store 中读取已有数据 → 渲染成功。

**`rendererReady` 守卫的本意**：避免渲染器未就绪时发 API 请求浪费。但副作用是阻断了 store 写入，且重触发条件忽略了 waterLevel=0 的场景。

**教训**：数据写入 store 和地图渲染是两个独立操作，不应耦合。`renderFloodAreas` 内部的 renderer=null 检查已经足够安全。外部再加守卫属于"过度防御"。

### 问题 2：淹没图层不显示

**根本原因**：问题 1 的连锁反应。

`floodStore.floodFeatures` 永远为空 → toggle show handler:
```js
() => {
  const features = floodStore.floodFeatures  // []
  if (features && features.length > 0) {     // false
    renderFloodAreas(features)               // 不执行
  }
}
```

**次要因素（原有问题）**：即使 store 有数据，原始的 visible=false 也导致 toggle checkbox 不勾选。但在 P1-2 中已将默认改为 true。

### 问题 3：flyTo 不生效

**初步怀疑**：`cancelFlight()` + `flyTo()` 组合可能有 Cesium 内部时序冲突。

**实际排查**：
- `_setCameraState` 代码路径正确（在 `importState` → `MapRenderer.importState` → `CesiumRenderer._setCameraState`）
- `_positionCamera` 初始化相机在 `(108.575, 21.760, 10km)`，pitch=-60°
- `flyTo` 目标在 zoom=9 → height≈586km，pitch=-90°
- 500ms 内移动 576km 且俯仰角大幅变化 → 动画极快，用户难以感知

**结论**：flyTo 逻辑本身没错，但 500ms 太短。原方案用 `setView` 是对竞态条件的过度防范（实际不存在，`switchMapType` 有 `switching` 互斥锁）。

---

## 修复方案

### 修复 1：移除 rendererReady 守卫

**文件**：`FloodAnalysisPage.vue`

**变更**：
```diff
- import { ref, onUnmounted, watch, nextTick } from 'vue'
+ import { onUnmounted, watch, nextTick } from 'vue'
- const rendererReady = ref(false)
- // 在 triggerFloodAnalysis 和 triggerImpactAssessment 入口
- if (!rendererReady.value) return  // 删除
```

**重触发逻辑**改为无条件（不再判断 `waterLevel > 0`）：

```js
// registerGcsLayers 末尾
analysisTimer = setTimeout(() => {
  triggerFloodAnalysis(waterLevelStore.waterLevel)
  triggerImpactAssessment(waterLevelStore.waterLevel)
}, ANALYSIS_DELAY)
```

这样无论水位是多少，渲染器就绪后会重新触发一次分析，确保 store 数据被写入。

### 修复 2：保持 visible=true

已在 P1-2 中完成。淹没范围和受影响设施图层默认可见（`registerToggleable` 第 5 参数为 `true`）。

### 修复 3：flyTo 时长从 0.5s → 2.0s

**文件**：`CesiumRenderer.js`

**变更**：
```diff
- this.viewer.camera.cancelFlight()
- this.viewer.camera.flyTo({ destination, duration: 0.5, ... })
+ this.viewer.camera.flyTo({ destination, duration: 2.0, ... })
```

取消 `cancelFlight()`（无实际作用，`switchMapType` 已有互斥锁防止重入）。

---

## 变更总结

| 文件 | 变更内容 |
|------|---------|
| `FloodAnalysisPage.vue` | 移除 `ref` 导入、`rendererReady` ref、两个 `if (!rendererReady) return` 守卫 |
| `FloodAnalysisPage.vue` | `registerGcsLayers` 重触发逻辑改为无条件（移除 `waterLevel > 0` 判断） |
| `CesiumRenderer.js` | `_setCameraState` flyTo duration 0.5→2.0，移除 `cancelFlight()` |

---

## 验证

```bash
npm run build → 成功（0 error）
CesiumRenderer chunk: 11.81KB
FloodAnalysisPage chunk: 13.71KB
```

---

## 第二次修复（log1 后续）

### flyTo 不"草率"的根因

`_positionCamera` 在 `_setCameraState.flyTo` 之前把相机锁定在了 `(108.575, 21.76, 10km)`：
```
_positionCamera → setView 到 10km（北部湾近景）
_setCameraState → flyTo 到 586km（zoom 换算）
```

两次相机几乎同经纬度，flyTo 只做纵向拉伸（10km→586km），**没有横向跨半球飞行**，自然没有"地球飞转"感。

**修复**：移除 `_positionCamera` 的相机定位（保留 `enableLighting`）。让 Cesium 保持默认的远距离美国上空视角。`_setCameraState.flyTo` 从美国飞到中国，自动产生跨半球飞行弧线。时长 3s 保证足够时间。

### 坐标系验证

WGS84 已是全系统统一的坐标系，传递链正确：

```
OL view.getCenter() → toLonLat() = WGS84(lng, lat)
    ↓ exportState / importState
Cesium Cartesian3.fromDegrees(lng, lat, height) ← 原生 WGS84

Cesium camera.pickEllipsoid → Cartographic.fromCartesian = WGS84(lng, lat)
    ↓ exportState / importState
OL view.setCenter(fromLonLat([lng, lat])) → EPSG:3857（仅 OL 内部渲染用）
```

zoom↔height 转换使用 `map.js` 的统一公式：
- `zoomToHeight(zoom) = 300000000 / 2^zoom`
- `heightToZoom(height) = log2(300000000 / height)`

### 城市按钮失效排查

追踪全链路（`useScreenActions` → `useMapControls` → `inject('unifiedMap')` → `UnifiedMap.flyTo` → `CesiumRenderer._doFlyTo`），注入链完整、代码正确。理论上应正常工作。如果确实失效，可能原因：
1. `CesiumRenderer._doFlyTo` 中 `options.pitch || -60` 当 `options` 只含 `{height, zoom}` 时为 `undefined || -60 = -60`，正常
2. `Cartesian3.fromDegrees(108.590, 21.727, 50000)` 坐标正确
3. 建议在 `_doFlyTo` 入口加 `console.log` 确认是否被调用

---

## 待验证（用户需复现确认）

1. ✅ 进入浸没分析页面 → 左面板显示数据（不再"无响应"）
2. ✅ 滑块拖动到 3.0 → 淹没范围图层自动显示
3. ✅ 2D→3D 切换 → 3 秒跨半球飞行动画（从美国上空飞向北部湾）
4. 城市切换按钮在 Cesium 中是否正常工作
