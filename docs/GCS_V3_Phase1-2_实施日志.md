# GCS V3 重构 Phase 1~2 实施日志

> 生成时间：2026-07-16  
> 实施阶段：Phase 1-A / 1-B / 2-A / 2-B  
> 目标：建立 Layout Base（AppLayout + Zone + GcsPanel + GcsButton），为后续业务路由迁移提供统一布局基座。

---

## 一、阶段范围

| 阶段 | 计划目标 | 实际完成 |
|------|----------|----------|
| Phase 1-A | 创建 AppLayout 组件 | ✅ AppLayout + config.js + useGCS.js |
| Phase 1-B | 创建 Zone1~Zone4 组件 | ✅ 四区组件 + 已接入 AppLayout 默认 slot |
| Phase 2-A | 创建 GcsPanel 通用 Panel 容器 | ✅ 已创建并校准参数 |
| Phase 2-B | 创建 GcsButton 按钮 Panel | ✅ 已创建并在 Zone1/Zone3 示例化 |

---

## 二、新增文件

| 文件路径 | 作用 |
|----------|------|
| `src/core/layout/config.js` | GCS 统一尺寸源：CELL_PIXEL、PANEL_PIXEL、CELL_PADDING、GAP |
| `src/core/layout/useGCS.js` | 响应式布局 composable，提供 `cell()`、`panel()`、`padding()` 计算 |
| `src/core/layout/AppLayout.vue` | 四象限 Zone 布局基座，含 `zone1`~`zone4` 插槽 |
| `src/core/layout/components/GcsPanel.vue` | 通用 Panel 容器：Frosted Glass、Cell 尺寸计算 |
| `src/core/layout/components/GcsButton.vue` | 按钮 Panel：文字在上、图标在下、默认 2×1 Panel |
| `src/core/layout/components/Zone1.vue` | 业务控制区（右上），当前用 GcsButton 占位 |
| `src/core/layout/components/Zone2.vue` | 可视化区（左上），当前为占位面板 |
| `src/core/layout/components/Zone3.vue` | 图层控制区（左下），当前用 GcsButton 占位 |
| `src/core/layout/components/Zone4.vue` | 结果展示区（右下），当前为占位面板 |

---

## 三、修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/core/layout/AppLayout.vue` | 为 `zone1`~`zone4` 插槽添加默认 Zone 组件；当页面未显式传入 slot 内容时自动渲染占位 Zone |

---

## 四、关键设计决策

### 4.1 目录结构采用 guide 版本

- **act 路径**：`src/components/layout/AppLayout.vue`、`src/layout/panels/GcsPanel.vue`
- **guide 路径**：`src/core/layout/AppLayout.vue`、`src/core/layout/components/GcsPanel.vue`
- **结论**：按 guide 第十三章目录结构统一放在 `src/core/layout/` 下。

### 4.2 GCS 参数最终取值

| 参数 | 值 | 说明 |
|------|-----|------|
| `CELL_PIXEL` | 100 | Cell 最小逻辑单位 |
| `PANEL_PIXEL` | 80 | 可见 Panel 区域 = CELL - 2×PADDING |
| `CELL_PADDING` | 10 | Panel 距 Cell 四边距离 |
| `GAP` | 20 | 相邻两个 Cell 的 Panel 间距 = 上 Cell 下 padding + 下 Cell 上 padding = 10 + 10 |

**布局语义**：Cell 之间无缝拼接；Panel 在 Cell 内部居中，四周留白 10px；两个相邻 Panel 的间距自然为 20px。

### 4.3 AppLayout 与 Zone 的耦合方式

- AppLayout 提供 `zone1`~`zone4` 具名插槽。
- 每个 slot 的 fallback 为对应 Zone 组件（Zone1~Zone4）。
- 业务路由后续可通过 `<template #zone1>` 覆盖默认内容，无需修改 AppLayout。

### 4.4 跨 Phase 前置创建 GcsPanel

- act Phase 1-B 仅要求创建 Zone，但 Zone 是可见容器，需要统一 Panel 容器承载。
- 因此前置创建了 `GcsPanel.vue`，作为 Zone 和 GcsButton 的视觉容器。

### 4.5 Zone 当前为占位实现

- Zone1/Zone3 已用 GcsButton 填入示例按钮，仅用于验证布局。
- 真实业务内容（router 跳转、城市定位、图层状态控制等）按 guide 归入 Phase 3-B / Phase 5。

---

## 五、与 act/guide 文档的出入

| 出入点 | 文档预期 | 实际实施 | 原因/建议补丁 |
|--------|----------|----------|---------------|
| Phase 1-A 范围 | 仅创建 AppLayout | 同时创建 config.js / useGCS.js | AppLayout 尺寸计算依赖统一配置源 |
| Phase 1-B 范围 | 仅创建 Zone | 同时创建 GcsPanel | Zone 需要统一 Panel 容器 |
| Zone 职责 | 业务按钮/折线图/图层控制 | 当前为占位面板 | 业务逻辑在后续 Phase 实现，避免跨 Phase 耦合 |
| AppLayout 接入 | act 未要求 Phase 1 内引用 Zone | 已把 Zone 作为 slot fallback | 便于验证四象限布局 |
| 目录位置 | act 用 `src/components/layout/` 等 | 采用 `src/core/layout/` | 按 guide 第十三章统一目录 |
| App.vue 未修改 | 验收标准涉及首页四象限显示 | AppLayout 尚未接入 App.vue | 按阶段边界，接入 App.vue 属于 Phase 2-B/3 |
| 旧组件未删除 | guide Phase 3-A 拆解 AppHeader | AppHeader / LayerPanel 仍存在 | Phase 3-A 未开始 |

**建议给实施文档加的补丁**：
1. 把 Phase 1-A 扩展为「AppLayout + config.js + useGCS.js」。
2. 把 GcsPanel 创建提前到 Phase 1-B 之前。
3. 在 Phase 1-B 增加「AppLayout 引入 Zone 作为 slot fallback」。
4. 把 Phase 1-B 的 Zone 职责明确为「占位容器，内容后续填充」。

---

## 六、已知问题与待办

| 问题 | 影响 | 处理阶段 |
|------|------|----------|
| AppLayout 未接入 App.vue | 浏览器中看不到四象限效果 | Phase 2-B/3 |
| AppHeader 旧顶部导航仍存在 | 接入 AppLayout 后会产生叠加 | Phase 3-A |
| LayerPanel 旧图层控件仍存在 | 与 Zone3 功能重复 | Phase 5 |
| Zone1/Zone3 按钮未绑定真实逻辑 | 仅占位 | Phase 3-B / Phase 5 |
| Zone2/Zone4 为纯占位面板 | 无真实图表/结果内容 | Phase 4 / SiteSelection 业务 |

---

## 七、下一阶段建议

### 推荐顺序

1. **Phase 2-B 收尾**：在 App.vue 中接入 AppLayout，用浏览器验证四象限位置和 Zone 尺寸。
2. **Phase 3-A**：拆解 AppHeader，将「回到首页」「个人中心」提取为全局悬浮按钮，放入 Zone1 或 AppLayout 全局层。
3. **Phase 3-B**：实现 Zone1 业务控制面板（城市定位条 + 6 个业务入口）。
4. **Phase 4**：迁移 RadarFloatPanel / LineChart 到 Zone2。
5. **Phase 5**：将 LayerPanel 重构为 LayerControlPanel 放入 Zone3。

### 给下一个实施者的提示

- 所有新增面板/按钮必须复用 `GcsPanel` / `GcsButton`，禁止复制后改名字。
- 所有尺寸必须通过 `useGCS` 计算，禁止硬编码 px。
- 接入 AppLayout 时建议先保留旧组件，验证布局无误后再删除旧组件，避免一次性改动过大。
- 当前 `GAP = 20` 已验证与 4×4 Cell Zone 兼容（4×4 Panel 总宽 380px，Zone 内容区 380px）。

---

## 八、验收结果

| 检查项 | 结果 |
|--------|------|
| `npm run build` | ✅ 通过 |
| `GetDiagnostics` | ✅ 0 error |
| AppLayout 四象限 Zone 位置计算 | ✅ 基于 CELL_PIXEL=100 动态计算 |
| GcsPanel Frosted Glass 样式 | ✅ 已实现 |
| GcsButton 2×1 Panel 尺寸 | ✅ 通过 `panel(2, 1)` 计算 |
| Zone1/Zone3 按钮 2×2 排列 | ✅ 与 4×4 Zone 尺寸兼容 |

---

## 九、快速引用

### 9.1 当前 GCS 配置

```js
// src/core/layout/config.js
export const CELL_PIXEL = 100
export const CELL_PADDING = 10
export const PANEL_PIXEL = CELL_PIXEL - CELL_PADDING * 2 // 80
export const GAP = CELL_PIXEL - PANEL_PIXEL // 20
```

### 9.2 核心 Composable API

```js
import { useGCS } from '@/core/layout/useGCS.js'

const { cell, panel, padding, cellPixel } = useGCS()

// cell(w, h) => { width: w*CELL_PIXEL, height: h*CELL_PIXEL }
// panel(w, h) => { width: w*PANEL + (w-1)*GAP, height: h*PANEL + (h-1)*GAP }
// padding() => { padding: CELL_PADDING }
// cellPixel => 响应式当前 Cell 像素值
```

### 9.3 Zone 插槽约定

```vue
<AppLayout>
  <template #zone1><MyBusinessPanel /></template>
  <template #zone2><MyChartPanel /></template>
  <template #zone3><MyLayerPanel /></template>
  <template #zone4><MyResultPanel /></template>
</AppLayout>
```

---

## 十、附录：本次实施中确认有效的目录/文件索引

```
src/core/layout/
├── AppLayout.vue           # 四象限布局基座
├── config.js               # 尺寸配置
├── useGCS.js               # 响应式计算
└── components/
    ├── GcsPanel.vue        # 通用 Panel
    ├── GcsButton.vue       # 按钮 Panel
    ├── Zone1.vue           # 业务控制区
    ├── Zone2.vue           # 可视化区
    ├── Zone3.vue           # 图层控制区
    └── Zone4.vue           # 结果展示区
```
