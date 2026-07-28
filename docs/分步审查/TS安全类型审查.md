# 北部湾港 WebGIS 前端 TypeScript 类型安全审查报告（v2.2）

- **审查角色**：TypeScript 负责人（仅关注类型安全）
- **审查日期**：2026-07-28（**v2.2 修订**）
- **审查范围**：`frontend/src/**`（30 个 `.vue`、39 个 `.ts`、28 个 `.js`）
- **检查工具**：`npm run typecheck` → `vue-tsc --noEmit -p frontend/tsconfig.app.json`
- **聚焦维度**：① `any` / 隐式 `any` 缺失 ② interface 设计 ③ API 类型 ④ Store 类型
- **v2 修订说明**：v1 在**未读 `docs/开工前必读/`** 的情况下把若干**刻意设计**误判为 🔴 缺陷。本次修订先确认工作树为最新（`git status`：最后提交 `6cf82f9` 2026-07-28 14:25，所审文件均为 working-tree 最新），**通读 `开工前必读/项目根基.md`(v2.2) / `工程规范与性能参考.md` / `API契约文档.md`**，再对真实代码重新扫描，撤回误报、修正统计、保留真问题。

---

## 0. 执行摘要（修正后）

类型纪律**有两面**：

- **好的一面（确认）**：全仓 **0 处** `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` 逃逸注释；`strict` + `noImplicitAny` 已开启且**确实在执行**（见下方 138 错误，证明类型网在抓问题，不是摆设）。
- **需修正的一面（与 v1 相反）**：v1 称"`.ts` 近零 `any`、纪律优秀"**不准确**。当前 `vue-tsc --noEmit` 报告 **138 处错误，其中 126 处是隐式 `any`（TS7006/TS7005/TS7053/TS7034）**，集中在 `.vue` SFC 的 `<script setup>` 与测试文件。即"any 类型缺失"的真实现场不在 `.js` 盲区，而在**已受检查的 `.vue`/测试文件里**——v1 只扫了显式 `: any` 文本，漏掉了编译器实际报出的 126 处隐式 `any`。
- **v1 误报的刻意设计**：F1（`.js` 盲区）中的 7 个文件是 §7.3 明文规定"不在 TS 迁移范围"；F2（渲染器契约）的 `.js`+`.d.ts` 分层是 §4/§7.3 的核心刻意设计；F4 的"三套响应格式"是 `API契约 §1.2`/`项目根基 §8.3` 的稳定决策；F6 的 `FloodStatistics` 索引签名是 `§7.7` 显式允许；F7 的 `registerToggleable` 多态是 `§6.3` 明文记载。以上均**不能算缺陷**。

> 结论：本项目类型安全的两类真问题是 **(a) 已检查文件中存在 126 处隐式 `any` 错误（类型网在报，但尚不清零）；(b) `unknown` 在 API/mock 边界逃逸且部分落点为裸 `as unknown as`**。所谓"`.js` 不受检查"是**已知且部分刻意**的边界，不是紧急缺陷。此外 v2.2 补录了 5 条 v2.1 遗漏的 interface/API 类型设计问题（见 §3.4 / §4.5 / G1–G5）。

### v1 → v2 修订对照表

| v1 编号 | v1 判定 | 开工前必读依据 | v2 判定 | 说明 |
|---------|---------|---------------|---------|------|
| F1 | 28 个 `.js` 不受检查 🔴 | §7.3（router/useGCS/layout-config/renderers 明确保留 `.js`，"不在 TS 迁移范围，改动需仔细回归测试"） | **拆分** | F1a：7 个受 §7.3 保护的 `.js` = ✅ 刻意边界（非缺陷）；F1b：其余 21 个 `.js` = 🟠 真实覆盖缺口，但迁移须按 §9.4 单模块逐步，不批量 |
| F2 | 渲染器契约未强制 🔴 | §4.2 Renderer Adapter（核心刻意设计）；§7.3 渲染器保留 `.js`；`renderers.d.ts:20,37` 已 `declare class … extends MapRenderer` | **✅ 刻意设计** | consumer 侧契约已被 `.d.ts` 强制；实现侧不查是 `.js` 的代价。撤回"必须 implements" |
| F3 | `unknown` 逃逸 + `as unknown as` 🔴 | §7.3（`.js` 渲染器/组合式返回类型不可见，需用桥接转换） | **拆分** | `UnifiedMap.vue:142` + `SiteSelectionPage.vue:43` 为 `.js→.ts` 桥接 = 刻意；`ProfilePage:140,142` / `HomePage:21` / `AffectedFacilityListPanel:53` = 🟠 真实收窄机会；测试 `MapRenderer.interface.test.ts:81` 可接受 |
| F4 | API 响应缺 + "三套格式分裂" 🟠 | `API契约 §1.2` / `项目根基 §8.3`：三套响应格式（RESTful/GCS/混合）按模块固定、稳定设计、不主动改 | **拆分** | "三套响应格式"撤回为缺陷（刻意稳定）；保留 `forecastAdapter` 返回 `unknown` 且 `ForecastSeries` 未采用 = 🟠 真实 |
| F5 | Store `unknown` 槽 🟠 | §6.2 模式一（analysisHandler 是已知取舍，见 A02/A04）；§7.7 允许 `Record<string,unknown>` 加注释 | **修正优先级** | `forecastState.dataCache/currentData` 用 `ForecastSeries` 收窄 = 🟠；`mapStore.lastAnalysisResult` 关联已知取舍 A02/A04，降为 🟡 |
| F6 | `[key:string]:unknown` 削弱校验 🟠 | §7.7：`FloodStatistics` 索引签名"开放扩展（数据文件可能有额外字段）"显式允许 | **拆分** | `FloodStatistics`(base.ts:50) / `GcsFeature`(base.ts:28) 索引签名 = 刻意；`PointFeature`(renderer.ts:28)/`AnnotatedPoint`(base.ts:24)/`RendererState`(renderer.ts:76) 等合理但未注释 = 🟡 |
| F7 | `registerToggleable` 行为多态 🟡 | §6.3 明文记载：第三个参数"是 renderer 对象→自动生成 show/hide；是函数→直接作为 show 回调"，`'setVisibility' in` 是文档化的判别器 | **✅ 刻意设计** | 撤回"建议消除" |
| （新增） | — | — | **A-new 🔴→🟠** | v1 漏报：当前 `vue-tsc` 138 错误 / 126 隐式 `any`，集中在 `.vue` SFC 与测试，这是真正的"any 类型缺失"现场 |

---

## 1. 配置与工具链基线（事实 + 实测）

`frontend/tsconfig.app.json` 关键项：

```jsonc
"allowJs": true,
"checkJs": false,          // ← 28 个 .js 文件因此完全不受检查（其中 7 个受 §7.3 保护为刻意）
"strict": true,
"noImplicitAny": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"paths": { "@/*": ["./src/*"] }
```

`package.json` 脚本：`"typecheck": "vue-tsc --noEmit -p frontend/tsconfig.app.json"`。

**实测（本次运行）**：
- `.vue` + `.ts` 受 `vue-tsc` 检查，但当前**未通过**：**138 处错误**，其中 **126 处为隐式 `any`（TS7006/TS7005/TS7053/TS7034）**，集中在 `.vue` SFC `<script setup>` 与测试文件（如 `RadarScoreTooltip.vue`、`useChartBase.test.ts`、`UnifiedMap.vue`、`LayerControlPanel.vue`）。这些为 pre-existing（非本次改动引入，已确认本次改动文件 0 新增错误）。
- `.js`（28 个，`checkJs:false`）：贡献 **0** 错误，也贡献 **0** 安全性。

**文件分布**：`.ts` 39、`.vue` 30、`.js` 28（含受 §7.3 保护的 `router/index.js`、`core/layout/useGCS.js`、`core/layout/config.js`、`core/map/renderers/*.js` 共 7 个；其余 21 个为普通 `.js`）。

---

## 2. 关注点一：`any` / 隐式 `any` 缺失（v1 此处统计有误）

### 2.1 v1 的方法论缺陷
v1 仅对 `.ts` 文本扫描 `: any | as any | <any> | any[]`，得到"2 处且都在测试文件"。这**漏掉了** `noImplicitAny` 真正会报错的**隐式 `any`**（未标注类型的函数参数、未标注的索引访问）。实测 `vue-tsc` 报出 **126 处隐式 `any`**，这才是"any 类型缺失"的真实规模。

### 2.2 显式 `any`（确实很少，但存在生产代码）
在**受检查的 `.vue`/`.ts` 非测试文件**中：
- `core/map/UnifiedMap.vue:51,52,54` — `let portGeoJson: any = null` / `boundaryGeoJson: any` / `cameraState: any`（GeoJSON / Camera 逃生口，**无 §7.3 要求的注释**）
- `business/site-selection/components/SiteAnalysisControlPanel.vue:192` — `function restoreSettings(settings: Record<string, any>)`（**无注释**）
- `src/env.d.ts:5` — `DefineComponent<{}, {}, any>`（Vue 自动生成 shim，豁免）

> 依 §7.3："`any` 仅允许在 Vue emit 泛型、第三方库兼容场景，且**必须加注释**说明原因"。`UnifiedMap.vue` / `SiteAnalysisControlPanel.vue` 的 `any` 既非 emit 泛型也非第三方兼容，且缺注释 → 属 §7.3 违规，应补具体类型或补注释。

### 2.3 隐式 `any`（126 处，类型网在报但未清零）
集中在 `.vue` SFC 与测试：典型为 `<script setup>` 里未标注的回调参数、模板事件处理器的 `event` 参数、`for`/`map` 回调参数、`Record` 索引无签名。这些是 v1 完全漏报的真问题。

### 2.4 结论
把"any 类型缺失"理解为 **(a) 已检查文件里 126 处隐式 `any` 错误未清零** + **(b) 生产 `.vue` 中少量未注释的显式 `any`**。修复方向不是盯 `.js` 盲区，而是**先把 `vue-tsc` 的 138 错误清零**（见路线图 R0）。

---

## 3. 关注点二：interface 设计

### 3.1 优点（应保留）
- **`types/renderer.ts` 的 `MapRenderer` 接口设计优秀**（renderer.ts:89）：泛型事件总线 `MapRendererEventMap` + `on/off/emit<K>`；用可选方法 `?` 区分 2D-only / 3D-only；`FlyToTarget = GeoPoint | [number, number] | { layerId }` 表达力强。
- **`types/business/base.ts` 域模型清晰**：`GeoPoint` / `GcsFeature<T>` / `ScoredFeature<T>` / `FloodFeature` / `AffectedFacility` 结构合理。
- **`types/analysis.ts`** 用 `Feature<Geometry>` 处理 turf `union` 的多边形不确定性，并附 D1/D2 决策注释（工程记录意识好）。

### 3.2 修正：F2 渲染契约是刻意设计（非缺陷）
- `renderers.d.ts:20,37` 已 `declare class OLRenderer extends MapRenderer` / `declare class CesiumRenderer extends MapRenderer`——这是**为 `.js` 模块手写环境声明**的标准 TypeScript 模式。consumer（`UnifiedMap.vue` 等）拿到的是 `MapRenderer` 类型对象，契约在**使用侧已被编译器强制**。
- 实现侧（`.js` 内部）不检查，是 §7.3 保留渲染器为 `.js` 的**代价**，不是遗漏。迁移到 `implements` 需把渲染器 `.ts` 化，属 §7.3 明示的"不在 TS 迁移范围"，且改动需仔细回归测试。
- **`UnifiedMap.vue:142` 的 `(await createRenderer(...)) as unknown as MapRenderer`** 正是 `.js` 渲染器 → `.ts` 接口的桥接，受 §7.3 保护，**刻意、可接受**。
- **v2 结论**：F2 从 🔴 降为 **✅ 刻意设计（记录）**。不要求改。

### 3.3 `[key:string]:unknown` 索引签名（F6 修正）
- **`FloodStatistics`（base.ts:50）**：§7.7 原文"开放扩展（数据文件可能有额外字段如 averageDepth/maxDepth/estimatedLoss 等）"——**显式允许**，刻意为之。
- **`GcsFeature<T extends Record<string, unknown>>`（base.ts:28）**：泛型默认参数，通用 GIS 基础模型，合理。
- **`PointFeature`（renderer.ts:28）/ `AnnotatedPoint`（base.ts:24）/ `RendererState`（renderer.ts:76）/ `FloodFeature.properties`（base.ts:63）/ `ConfidenceThresholds`（base.ts:114）**：开放扩展合理，但**缺注释说明**。v2 将其从 🟠 降为 🟡，仅要求补一行"为何开放扩展"的注释，不强制移除。

### 3.4 其他 interface / 类型设计问题（v2.2 补录，源自另一份草稿的真实发现）
> 以下 4 条为 v2.1 遗漏、经 `grep` + 读代码核实属实的真实问题（另一份草稿 `TS类型安全审查报告-2026-07-28.md` 含此内容，但其整体为纯 grep 产物且带 v2 已撤回误报，已合并后删除）。

- **G1 🟡 `PanelName` 联合退化（types/map.ts:40）**：`PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | string` 末尾 `| string` 使整个联合退化为裸 `string`，字面量收窄 / 拼写检查 / 自动补全全部失效（`'port-inf0'` 数字 0 能过编译）。项目自身已有正确范式：`types/api/forecast.ts:51` 的 `ForecastIndicatorName = ... | (string & {})`——保留提示又不退化。建议改为 `(string & {})` 写法，或封闭为已知字面量。
- **G2 🟡 `LayerType` 已定义却未接线（types/core/layerManager.ts:19）**：`LayerType = 'heatmap'|'geojson'|'points'|'polygon'|'waterSurface'` 已存在，但 `LayerEntry.layerType?: string`（types/map.ts:23）、`registerBusinessLayer(..., layerType: string, ...)`（mapStore.ts:240）仍用松散 `string`，分派到 adapter 的关键字段放弃枚举保护。建议统一为 `LayerType`。
- **G3 🟡 `RegisterLayerOptions` 声明与运行时形状不符（types/map.ts:27-32 vs mapStore.ts:161）**：声明 `show?: () => void; hide?: () => void`（单函数），但 `registerLayer` 实际存成 `Array<() => void>`（`layerCatalog.value.push({ ..., show: show ? [show] : [() => {}], ... })`）。调用方按声明理解会得到错误预期。建议声明直接对齐为 `Array<() => void>`。
- **G4 🟡 Cesium Viewer 全程 `unknown`（renderers.d.ts:65-66）**：`cesiumViewerManager.getViewer(): unknown` / `ensureViewer(...): Promise<unknown>`——Cesium `Viewer` 完全无类型，`CesiumRenderer.js`（`.js` 未检查）直接操作 `viewer` 无保护。建议定义最小 `CesiumViewerLike` 接口收窄常用方法，或引入 `@types/cesium`。

---

## 4. 关注点三：API 类型

### 4.1 现状
`types/api.ts` 覆盖认证域（`User`/`AuthResponse`/`ApiError` 等）。业务数据流类型散落：`types/api/forecast.ts` 有 `ForecastSeries`（优秀），`business/base.ts` 有 `FloodFeature`/`AffectedFacility`/`FloodStatistics`，`floodAdapter.ts` 内联了 `FloodAnalysisResult`/`ImpactAssessmentResult`。

### 4.2 修正：三套响应格式是刻意稳定设计（非缺陷）
`API契约 §1.2` / `项目根基 §8.3` 明确：**项目存在 RESTful / GCS / 混合 三套响应格式，按业务模块固定使用**；"新增接口统一使用 RESTful；已有 GCS/混合格式接口不主动修改"。因此：
- 浸没分析用 GCS 格式（`{ code, data, message }`）、预测用混合格式（`{ code, data }`，错误用 `error`）——这是**跨模块一致的稳定契约**，v1 把"三套格式"当"无单一事实来源"的缺陷是**误读**。
- **v2 结论**：从缺陷清单撤回"响应格式分裂"。相关真问题只剩"**TypeScript 类型定义**分散"（见下）。

### 4.3 真问题：类型定义来源分裂（保留，降级为 🟠）
同一条"洪水数据"在 TS 里有 3 处定义：`types/api/forecast.ts`(forecast)、`floodAdapter.ts` 内联(flood)、`business/base.ts`(域模型)。这不是 API 格式问题，而是**前后端类型未统一到 `types/api/*` 单一事实来源**。属于可优化的维护性事项，非紧急。

### 4.4 真问题：Adapter 返回 `unknown`（保留，🟠）
- `forecastAdapter.getIndicatorData(): Promise<unknown>`（forecastAdapter.ts:46）——且 `types/api/forecast.ts:38` 的 `ForecastSeries` 已存在却**未被 adapter 采用**。好类型被闲置。
- `floodAdapter` 比 forecast 强：用 `_fetchMockJson<T>` 泛型，内联 `FloodAnalysisResult`/`ImpactAssessmentResult`，但内层 `features: unknown[]` / `statistics: unknown` 未收窄为 `FloodFeature[]`/`FloodStatistics`。
- `mapDataService.getPorts()/getBoundary(): Promise<unknown>`——虽有 `Array.isArray` 运行时校验，类型仍是 `unknown`。

> 注意：`forecastAdapter` 当前为 **mock-only**（真实 API 未接入，见 forecastAdapter.ts:50 抛错）。返回 `unknown` 在此阶段可接受，但应**顺手采用 `ForecastSeries`** 把出口收窄。

### 4.5 边界 `as T` 缺运行时校验（v2.2 补录，真实，可选加固）
- `floodAdapter.ts:50` `_fetchMockJson<T>(...): Promise<T>` → `return (await res.json()) as T`；`useApiRequest.ts:107` `return data as T`。
- `as T` 把原始 JSON 直接断言成业务类型，**无任何运行时校验**；后端/mock 形状一旦变化，类型继续说谎，错误延迟到运行时深处才暴露。
- 建议（非紧急）：在 adapter 边界引入 `zod` / `valibot` 做 `schema.parse(json)`，"类型 + 形状"双保险。属健壮性增强，非类型安全缺陷。

---

## 5. 关注点四：Store 类型

### 5.1 优点（应保留）
- 多数 Store 的 `ref` 显式标注 `Ref<X>`（`mapStore.ts`、`floodState.ts` 规范）。
- `floodState.ts` 用 `FloodSavedState` / `FloodConsumedState` 完整建模跨页持久化，职责清晰——设计质量高。

### 5.2 修正后的真问题
**F5a 🟠 `forecastState` 的 `unknown` 槽（真实收窄机会）**
```ts
// forecastState.ts:28,30,50
const dataCache: Ref<Map<string, unknown>> = ref(new Map())
const currentData: ComputedRef<unknown | null> = computed(...)
function cacheData(time: string, data: unknown): void
```
预测结果无形状，且与 §4.4 的 `forecastAdapter` 同源。可改用 `types/api/forecast.ts` 的 `ForecastSeries` 收窄。

**F5b 🟡 `mapStore` 的 `unknown` 槽（关联已知取舍，降优先级）**
```ts
// mapStore.ts:89,91
const analysisHandler: Ref<((_result: unknown) => void) | null> = ref(null)
const lastAnalysisResult: Ref<unknown> = ref(readStoredAnalysisResult())
```
`项目根基 §6.2 模式一` 注明：mapStore 累积 analysisHandler 职责是**已知设计取舍（见 `待解决问题.md` A02/A04）**。`lastAnalysisResult` 来自 `sessionStorage` 的 `JSON.parse`（mapStore.ts:56-64），恢复时本就无静态类型，用 `unknown` 合理。可后续用 `AnalysisResult`（`types/analysis.ts:21` 已有）做一层类型守卫，但**非紧急**。

### 5.3 修正：F7 `registerToggleable` 多态是刻意设计（非缺陷）
`mapStore.ts:197-229` 的 `showOrRenderer: (() => void) | { setVisibility }` + `'setVisibility' in showOrRenderer` 判别，`项目根基 §6.3` 明文记载为**预期参数处理**（renderer 对象→自动生成回调；函数→直接作为回调）。这是文档化的有意为之，**撤回"建议消除"**。真要更优雅可拆两参，但属可选重构，非类型安全缺陷。

---

## 6. `unknown` 逃逸链全景（标注意图桥接 vs 真实收窄）

```
API / mock 层
  useApiRequest<T=unknown>         → 默认 unknown（consumer 应填泛型）
  forecastAdapter.getIndicatorData() → Promise<unknown>   ★mock-only，应改用 ForecastSeries
  floodAdapter (内层)              → features: unknown[] / statistics: unknown
  mapDataService.getPorts()        → Promise<unknown>      ★有 Array.isArray 运行时校验
        ↓
Adapter 层
  ForecastSeries / FloodFeature 等好类型已存在，部分未被采用
        ↓
Store 层
  forecastState.dataCache: Map<string, unknown>      ← 真实收窄点（用 ForecastSeries）
  mapStore.lastAnalysisResult: unknown               ← 关联 A02/A04 取舍，可加 AnalysisResult 守卫
        ↓
组件层
  ── 刻意桥接（§7.3，.js→.ts，可接受）──
  UnifiedMap.vue:142          createRenderer(...) as unknown as MapRenderer
  SiteSelectionPage.vue:43     useAnalysisLayer() as unknown as { createUpdateHandler }
  ── 真实收窄机会（应加类型守卫 isXxx）──
  ProfilePage.vue:140,142      plan.floodFeatures/affectedFacilities as unknown as FloodFeature[]/AffectedFacility[]
  HomePage.vue:21              mapStore.selectedPort as unknown as Record<string, unknown>
  AffectedFacilityListPanel.vue:53  [...].sort(...) as unknown as ScoredXiaoqu[]
  ── 测试（可接受）──
  MapRenderer.interface.test.ts:81  exportState() as unknown as Record<string,{visible:boolean}>
```

**风险本质（真实部分）**：`ProfilePage`/`HomePage`/`AffectedFacilityListPanel` 三处的裸转换，JSON 结构一旦变化会静默得到 `undefined` 成员，错误推迟到运行时。这三处应优先补 `isFloodFeature` / `isAffectedFacility` 类型守卫。

---

## 7. 风险等级汇总（v2.2 更新）

| 编号 | 问题 | 维度 | 风险 | v1→v2 |
|------|------|------|------|-------|
| A-new | 受检查 `.vue`/测试存在 126 处隐式 `any`（138 错误未清零） | any | 🟠 中高 | **新增（v1 漏报）** |
| F1a | 7 个 `.js` 受 §7.3 保护为刻意 `.js` | 覆盖 | ✅ 刻意 | 🔴→✅ |
| F1b | 其余 21 个 `.js` 不受检查 | 覆盖 | 🟠 中 | 🔴→🟠 |
| F2 | 渲染器 `.js`+`.d.ts` 分层 | interface | ✅ 刻意 | 🔴→✅ |
| F3a | `UnifiedMap:142`/`SiteSelection:43` `.js` 桥接转换 | API | ✅ 刻意 | 🔴→✅ |
| F3b | `ProfilePage`/`HomePage`/`AffectedFacility` 裸转换 | API/Store | 🟠 中 | 维持 🟠 |
| F4a | 三套响应格式 | API | ✅ 刻意 | 🟠→✅（撤回） |
| F4b | `forecastAdapter` 返回 unknown + `ForecastSeries` 未采用 | API | 🟠 中 | 维持 🟠 |
| F5a | `forecastState` `unknown` 槽 | Store | 🟠 中 | 维持 🟠 |
| F5b | `mapStore` `unknown` 槽 | Store | 🟡 低 | 🟠→🟡 |
| F6 | 索引签名（`FloodStatistics` 等） | interface | 🟡 低 | 🟠→🟡 |
| F7 | `registerToggleable` 多态 | Store | ✅ 刻意 | 🟡→✅（撤回） |
| G1 | `PanelName` 联合退化 `\| string` | interface | 🟡 低 | **v2.2 新增** |
| G2 | `LayerType` 已定义未接线 | interface | 🟡 低 | **v2.2 新增** |
| G3 | `RegisterLayerOptions` 形状不符 | interface | 🟡 低 | **v2.2 新增** |
| G4 | Cesium Viewer 全程 `unknown` | interface | 🟡 低 | **v2.2 新增** |
| G5 | 边界 `as T` 无运行时校验 | API | 🟡 低 | **v2.2 新增（可选加固）** |

---

## 8. 修复路线图（按 ROI，尊重 §7.3 / §9.4）

> 遵循既有规范（项目 memory「TS 迁移方法论」）：不追求 100% TS 化；核心链路强类型优先；**先由用户定类型规则，AI 再带约束批量施工**；§9.4「每次只修一个模块」。

**R0 🟠→ 清零 `vue-tsc` 的 138 错误（高收益 / 高优先级）**
- 这是 v1 完全漏报的真问题：126 处隐式 `any` 集中在 `.vue` SFC 与测试。
- 逐文件补参数类型 / 索引签名，使 `npm run typecheck` 通过。CI 的 typecheck 步骤当前会因 138 错误失败。
- 注意：§9.4 要求单模块推进；可先清测试文件（低风险），再清 `visualization/charts` 等展示层，最后动 `UnifiedMap.vue` / `LayerControlPanel.vue`。

**R1 🟠→ 21 个非 §7.3 保护的 `.js` 逐步收编（中成本 / 中收益）**
- 仅针对 **非** router/useGCS/layout-config/renderers 的 21 个 `.js`（如 `useAnalysisLayer.js`、`facilityConfig.js`、`useECharts.js`、`BusinessLayerManager.js` 等）。
- 改名进网（`checkJs:true` 或转 `.ts`）后逐个补注解；**受 §7.3 保护的 7 个 `.js` 不动**。
- ⚠️ 改名进网会暴露大量被掩盖的隐式 `any`，需按"先定规则再施工"推进。

**R2 🟠→ Adapter 返回类型收口（低/中成本 / 高收益）**
- `forecastAdapter` 采用 `types/api/forecast.ts` 的 `ForecastSeries`（mock-only 也应收窄出口）；
- `floodAdapter` 内层 `features: unknown[]`→`FloodFeature[]`、`statistics: unknown`→`FloodStatistics`；
- 把 flood 结果类型从 adapter 内联提升到 `types/api/flood.ts`，统一 API 类型来源（消除 §4.3 的 TS 定义分裂）。

**R3 🟠→ 收窄 `forecastState` 的 `unknown` 槽（低/中成本）**
- `dataCache`/`currentData` 采用 `ForecastSeries`；`cacheData(time, data: ForecastSeries)`。

**R4 🟡→ 收窄裸 `as unknown as`（仅 F3b 三处）**
- 在 R2/R3 基础上，为 `ProfilePage`/`HomePage`/`AffectedFacilityListPanel` 增加类型守卫 `isFloodFeature`/`isAffectedFacility`/`isScoredXiaoqu`，把校验前移。

**R5 🟡→ 索引签名补注释（仅 F6 未注释者）**
- 为 `PointFeature`/`AnnotatedPoint`/`RendererState` 等补一行"为何开放扩展"注释；`FloodStatistics`/`GcsFeature` 已合规，不改。

**R6 🟡→ 清理生产 `.vue` 中未注释的显式 `any`**
- `UnifiedMap.vue:51,52,54`（GeoJSON/Camera 逃生口）→ 改用 `GeoJSON.FeatureCollection` / `CameraState` 或补 §7.3 注释；
- `SiteAnalysisControlPanel.vue:192` `Record<string, any>` → 具体 `SettingsShape` 或补注释。

**R7 🟡→ 补录的 interface / API 类型设计问题（v2.2，低优先级）**
- G1–G3（PanelName `|string` 退化 / LayerType 未接线 / RegisterLayerOptions 形状不符）：统一为项目既有联合 / `LayerType` / 数组对齐，属低风险拼写与一致性加固，可顺手做。
- G4（Cesium Viewer `unknown`）：定义最小 `CesiumViewerLike` 或引 `@types/cesium`。
- G5（`as T` 运行时校验）：adapter 边界引入 zod/valibot，健壮性强化的可选项。

> 不纳入路线图的（刻意设计，不改）：F2 渲染器 `.js`+`.d.ts`、F3a `.js` 桥接转换、F4a 三套响应格式、F7 `registerToggleable` 多态。

---

## 9. 不可妥协的底线（与现有工程规范一致）

- 不追求 100% TS 化；核心链路强类型优先。
- 受 §7.3 保护的 7 个 `.js`（router/useGCS/layout-config/renderers）**保持 `.js` 现状**，改动需仔细回归测试。
- 禁止无注释的 `any`（§7.3）：emit 泛型 / 第三方兼容之外的 `any` 必须加原因注释或换具体类型。
- 禁止 `@ts-ignore` / `@ts-nocheck` 逃逸（当前 0 处，保持）。
- 渲染器进网后**建议** `implements MapRenderer`——但这是 §7.3 范围外事项，当前 `.d.ts` 环境声明已满足 consumer 侧契约。
- 新增 API 结果类型统一放 `types/api/*`，单一事实来源；不对齐域模型不允许合入。
- 三套响应格式按 `API契约 §1.2` 稳定存在，新增接口用 RESTful，不主动改既有格式。

---

## 10. 统计附录（本次实测）

- `vue-tsc --noEmit`：**138 处错误**，其中 **126 处隐式 `any`（TS7006/TS7005/TS7053/TS7034）**，代码分布：TS7006(参数隐式 any)×92 · TS7005(变量隐式 any)×19 · TS7053(索引 any)×9 · TS7034(部分路径隐式 any)×6；其余 TS2339(属性缺失)×6 · TS18048(非全路径返回)×6。集中在 `.vue` SFC 与测试文件（pre-existing，非本次改动引入）。
- 显式 `any` 在受检查非测试 `.vue`/`.ts`：`UnifiedMap.vue` ×3、`SiteAnalysisControlPanel.vue` ×1、`env.d.ts` ×1（shim 豁免）。
- `as unknown as` 出现：**7 处**（UnifiedMap:142、SiteSelection:43 为刻意桥接；ProfilePage:140,142、HomePage:21、AffectedFacilityListPanel:53 为真实收窄点；MapRenderer.interface.test.ts:81 为测试）。
- `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`：**0 处**（纪律良好 ✅）。
- `.js` 文件：**28 个**（`checkJs:false`）。其中 **7 个受 §7.3 保护为刻意 `.js`**，21 个为普通未检查 `.js`。
- `unknown` 在 `.ts` 出现次数：`floodAdapter.ts` 11、`mapDataService.ts` 8、`forecastAdapter.ts` 4、`mapStore.ts`/`forecastState.ts`/`business/base.ts` 各 3、`types/plan.ts`/`types/core/layerManager.ts`/`spatialIndex.ts`/`renderer.ts` 各 2~3。

---

### 修订记录
- **v1（2026-07-28 上午）**：初版。未读 `开工前必读/`，把 §7.3/§4/§6.3/§8.3/§1.2/§7.7 的刻意设计误判为 🔴/🟠 缺陷；且只扫显式 `:any` 文本，漏报 126 处隐式 `any`。
- **v2（2026-07-28 下午）**：通读三份 `开工前必读` 文档 + 重扫真实代码（git 工作树最新）+ 实测 `vue-tsc` 138/126 错误后修订。撤回 F1a/F2/F3a/F4a/F7 的缺陷判定，修正 F1b/F5b/F6 风险等级，新增 A-new（隐式 `any` 漏报）。
- **v2.1（2026-07-28 傍晚）**：用权威命令 `npm run typecheck`（`-p frontend/tsconfig.app.json`）复测，确认基线仍为 138 错误；隐式 `any` 计数由 120 修正为 **126**（TS7006×92 / TS7005×19 / TS7053×9 / TS7034×6），并修正错误码枚举（移除当前不存在的 TS7019，补 TS7034）。⚠️ 提示：裸 `vue-tsc --noEmit` 会误用根 tsconfig 而**误报 0 错误**，须用 `npm run typecheck`。
- **v2.2（2026-07-28 傍晚续）**：合并另一份独立草稿 `TS类型安全审查报告-2026-07-28.md` 中的真实发现（该草稿纯 grep、未跑编译器、且含 v2 已撤回误报，已删除）。补录 G1–G5 五条 v2.1 原先遗漏的 interface/API 类型设计问题（PanelName `|string` 退化、LayerType 未接线、RegisterLayerOptions 形状不符、Cesium Viewer `unknown`、`as T` 无运行时校验），均经代码核实属实。
