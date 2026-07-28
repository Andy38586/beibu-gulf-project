# Vue 工程审查（修订版 v2 — 已对照「开工前必读」）

> **修订说明**：v1（2026-07-28 17:56）在审查前未读 `docs/开工前必读/` 设计文档，导致 4 处把**刻意为之的设计**误判为缺陷。本版在审查前已读完 `开工前必读/项目根基.md`（v2.2）、`开工前必读/工程规范与性能参考.md`，并交叉对照 `待解决问题.md` / `已解决问题.md`，对 v1 误报逐条撤回，并补入与既有问题清单一致的真实项。
>
> **代码最新性**：`git fetch --dry-run` 无远程待拉取，工作区即最新真代码；`App.vue`、`BusinessLayerManager.js` 等被改动文件已复读确认（含 `reapplyAll` 已落地，闭环 D06）。

---

## 0. 审查方法

- **范围**：30 个 `.vue` + 10 个 Pinia store + 22 个 composable，全部带 `file:line`。
- **判定依据**（优先级）：
  1. `docs/开工前必读/项目根基.md` / `工程规范与性能参考.md`（不变规则 / 刻意设计）
  2. `docs/待解决问题.md`（真实 bug / 已知取舍 / 刻意简化，分节明确）
  3. `docs/已解决问题.md`（已修复归档）
- **原则**：凡设计文档明示为「已知取舍 / 文档化行为 / 刻意简化」者，**不当作缺陷**；真实问题优先映射到 `待解决问题.md` 既有 ID，避免重复造项。

---

## 1. v1 误报纠正清单（刻意为之，非缺陷）

| v1 论断 | v2 判定 | 依据 |
|---|---|---|
| `mapStore.analysisHandler` 存函数 = 反模式 | **误报 / 刻意为之** | `项目根基.md:566-577` §6.2「模式一：Render Handler 注入」；`待解决问题.md` A02「核心组件职责集中是已知的设计取舍」 |
| `UnifiedMap` 卸载只销毁当前渲染器、漏另一个 = 泄漏 | **误报 / 刻意为之** | `项目根基.md:385-389` §4.2（Cesium Viewer 单例，离开 3D 仅 `v-show` 隐藏不销毁）、`:454` §4.4（任何设备都单例，接受双引擎常驻内存）；`待解决问题.md` E16。注：`UnifiedMap.onUnmounted` 仅在整应用卸载时触发，销毁当前活动渲染器是正确收尾，引擎切换走 `v-show` 复用，无泄漏 |
| 全仓零 `storeToRefs` = 缺陷 | **误报** | `项目根基.md:357` §5.2 / `工程规范与性能参考.md:357` 编码规范 §5.2 **明文禁止解构**（"解构会丢失响应性"）。组件用 `store.x` 直接访问天然保持响应式，与规范一致，无需 `storeToRefs` |
| `inject(KEY)!` 非空断言应加开发环境报错 | **误报** | `项目根基.md:436-442` §4.3 标准模式：App.vue 必 `provide` 单例，`inject(KEY)!` 非空断言是有意写法（业务页面恒在 RouterView 下，provide 必达） |
| `App.vue:54 watch(() => ({ name, engine }))` 每次 eval `new` 对象可优化 | **误报** | 返回新对象的多源监听是 Vue **标准惯用法**（需新引用触发 watcher），非性能问题亦非 bug |

---

## 2. 六维度审查（v2，仅列真实项）

### 2.1 组件设计

**设计良好 / 刻意为之**
- GCS Panel 体系（`AppLayout` 的 `#left`/`#right` slot 契约、`:deep(.gcs-panel){pointer-events:auto}` 恢复面板交互）严格遵循 `项目根基.md:503-545` §5.3。
- Visualization 为纯展示层（`项目根基.md:153` §2.3），`LineChart`/`BarChart` 等只收 props，不依赖 store。
- `PaginatedListPanel` 命名历史已澄清（`项目根基.md:166-169`）：通用分页列表 + 地图呼吸灯交互组件，非单纯收藏。

**真实问题**
| ID | 严重度 | 问题 | 证据 |
|---|:---:|---|---|
| A05 | P0-OPEN | `visualization` 反向依赖 `business`（`useRadarChart.js:19`、`RadarScoreTooltip.vue:11` `import ... from '@/business/...'`），违反 `项目根基.md:106-115` §2.3 Rule 3 | `待解决问题.md` A05 |
| E02 | P1-OPEN | `mapStore` 双图层注册机制并存：`registerToggleable`（旧，把 `show`/`hide` 函数存进 Pinia state）+ `registerBusinessLayer`（新，只存元数据）；`handleBusinessLayerToggle`（`:297`）访问 `entry.show!`，对 business 图层为 `undefined` → 一旦经 `toggleLayer` 调用即抛 TypeError（当前被 `LayerControlPanel` 绕开，隐患仍在） | `mapStore.ts:146-305`（`:197` 旧 / `:240` 新）；`待解决问题.md` E02 |
| E13 | P0-OPEN | `SiteSelectionPage` 直调渲染器 + 图层泄漏 + `pointer-events` 缺失（`:122/:156` 绕过 `BusinessLayerManager` 的 `removeLayer`；`:304` `onUnmounted` 仅 `stopBreathing`+清 timer，**未移除 `activeFacilityLayerKey`**；全文件仅 `pointer-events:none` 无 `:deep(.gcs-panel)`） | `待解决问题.md` E13 |

> 注：`mapStore` 体量 ~370 行、职责集中属 `待解决问题.md` A02 **已知取舍**，不单列；但 E02「函数进 state」是真问题。

### 2.2 生命周期

**设计良好 / 刻意为之**
- `ForecastPage` 用 `watch(currentRenderer, immediate)` 等渲染器就绪再注册图层，符合 `项目根基.md:393-414` §4.3 反模式 3。
- `FloodAnalysisPage` `consumeState` 一次性消费（`项目根基.md:597-611` §6.2 模式二）：HMR/`KeepAlive` 导致 `onMounted` 多次触发时二次消费返回 `null` 是**预期行为**，非 bug。
- 三业务模块 `onUnmounted` 清理基本配对。

**真实问题**
| ID | 严重度 | 问题 | 证据 |
|---|:---:|---|---|
| — | 低 | `ForecastPage.vue:220` `onUnmounted` 未 `clearTimeout(debounceTimer)`。卸载 300ms 内若防抖未触发，会跑一个孤儿 `doForecastUpdate()`（新事务 + 孤儿请求 + 写已 `reset` 的 ref）。Vue 3 不崩但浪费/孤儿请求 | `ForecastPage.vue:48,215-216,220-225` |
| E26 | 低 | `startBreathing` 的 RAF 循环在引擎切换时不停止（仅 `renderer.destroy` 才停），隐藏地图空转浪费 GPU/CPU | `OLRenderer.js:528-557` / `CesiumRenderer.js:677-716` |
| E19 | 中 | `UnifiedMap.loadData` 失败仅当错误含「超时」才提示（`:104`），其它失败（4xx/网络异常）静默吞 → 地图空加载无提示 | `UnifiedMap.vue:99-107` |
| E27 | 低 | `withTimeout`（`:54-60`）超时后不 `abort` 底层 promise，后台无效工作 + 潜在竞态 | `UnifiedMap.vue:54-60` |

### 2.3 响应式

**设计良好 / 刻意为之**
- `shallowRef` 用于重对象：`mapStore.currentRenderer`（`mapStore.ts:87`）、`UnifiedMap.currentRenderer`、渲染器实例（`mapStore.ts:80`）——与 `项目根基.md:806-818` §7.7 Store 类型规范一致。

**真实问题**
| ID | 严重度 | 问题 | 证据 |
|---|:---:|---|---|
| D09 | P2 | `layerCatalog` 用 `ref([])`（`:83`），应 `shallowRef`——50 个图层注册触发 50 次重渲染；同文件 `currentRenderer` 已用 `shallowRef`，不一致 | `mapStore.ts:83`；`待解决问题.md` D09 |
| D03 / E07 | P1 / P2 | `floodState` 仍手写 `persisted*` ref（`floodState.ts:37-39`），未用 `createPersistedState` 工厂，与 `siteSelectionState` 不一致 | `待解决问题.md` D03 / E07 |
| — | 低 | `forecastState` 用 `ref(new Map())` / `ref({})` 装可变结构——Vue 3 下 `.set()` 可变但类型弱；重对象建议 `shallowRef`（与 §7.7 对齐）。非 bug，提示 | `forecastState.ts` |

### 2.4 watch

**设计良好 / 刻意为之**
- `App.vue` 路由 `watch`（`:54-94`）用 `isEngineSwitch` 区分「路由导航」与「引擎切换」，引擎切换时跳过相机重置（由 `importState` 管理）——逻辑正确。
- `App.vue:99-106` 已加 `currentRenderer` 监听调用 `businessLayerManager.reapplyAll(renderer)`，**闭环 D06**（引擎切换图层丢失）。
- 请求竞态三件套落地：① `analysisSeq` 递增序号过滤（`项目根基.md:613-631` §6.2 模式三 / 反模式 8）；② `useForecastRequest` 的 `startTransaction()` + `AbortController` 取消旧请求（`已解决问题.md` R23）；③ `ForecastPage` 的 300ms 防抖。

**真实问题**：无显著缺陷。v1 所述「`App.vue:54` 每次 new 对象可优化」已判定为误报（见 §1）。

### 2.5 composable

**设计良好 / 刻意为之**
- `useForecastRequest`：`AbortController` + `startTransaction()` + `cancelAll()` 事务取消（R23 已实现）。
- `useECharts`：ECharts 实例生命周期封装（init/resize/dispose）。
- `BusinessLayerManager`：数据驱动图层生命周期管理器，`App.vue` 单例 + `reapplyAll` 实现 2D↔3D 重绘（`App.vue:99-106`），设计正确（详见 `docs/前端架构审查报告`）。

**真实问题**
| ID | 严重度 | 问题 | 证据 |
|---|:---:|---|---|
| E20 | 中 | `BusinessLayerManager.setVisible`（`:170`）直改 `catalogEntry.visible` 绕过 Pinia action，状态来源分裂（与全项目「用 action 改状态」约定不一致） | `BusinessLayerManager.js:163-177`；`待解决问题.md` E20 |
| — | 低 | `inject(BUSINESS_LAYER_MANAGER_KEY)!` 非空断言——按 `项目根基.md:436-442` 是标准模式，但可考虑提供开发期缺失告警（超低风险，非缺陷） | `App.vue:31-32` |
| — | 低 | composable 单例/每实例模型不统一（`usePlans`/`useSiteAnalysisApi` 每组件新建 vs `BusinessLayerManager` 单例）；文档未强制，建议在 composable 头注释标注「单例 / 每实例」 | — |
| — | 低 | 部分 composable 仍是 `.js`（项目根基 §7.3 规定 `.js` 仅限 `router/index.js`、`useGCS.js`、`renderers/*.js` 等特定文件；其余 composable 应逐步 `.ts`，见 `TS_REVIEW.md`） | — |

### 2.6 状态管理

**设计良好 / 刻意为之**
- Setup Store 语法统一；`store.x` 直接访问保持响应式（符合「禁止解构」规范，`项目根基.md:357`）。
- `gcsStore` 协调器模式（`resetAll` 调各子 store）合法（`项目根基.md:117-131` §2.2 Rule 4）。
- `saveState`/`consumeState` 页面切换暂存模式清晰（`项目根基.md:579-611` §6.2 模式二）。

**真实问题**
| ID | 严重度 | 问题 | 证据 |
|---|:---:|---|---|
| E02 | P1 | 函数进 Pinia state：`registerToggleable` 的 `show`/`hide` 回调进 `layerCatalog`（`:146-229`）。注：`analysisHandler` 存函数属 §6.2 模式一刻意设计（A02），不在此列 | `mapStore.ts:146-305` |
| D09 | P2 | `layerCatalog` `ref` vs `shallowRef`（见 §2.3） | `mapStore.ts:83` |
| — | 低 | action 命名 `clear`/`reset`/`consume` 不统一（语义清晰但风格未对齐，非缺陷） | — |

> 撤回 v1「分析 UI 状态散在 `floodState` 和 `mapStore` 两处」：实为按 `项目根基.md:549-559` §6.1 分工——`mapStore` 管 `analysisHandler` 注入点，`floodState` 管统计+UI 控制，属刻意为之。

---

## 3. 真实问题汇总（与待解决问题对齐）

| 来源 ID | 维度 | 严重度 | 本版判定 |
|---|---|:---:|---|
| A05 | 组件设计 | P0 | 真实，OPEN |
| E13 | 组件设计 / 生命周期 | P0 | 真实，OPEN |
| E02 | 组件设计 / 状态管理 | P1 | 真实，OPEN（双注册债） |
| D03 / E07 | 响应式 / 状态管理 | P1 / P2 | 真实，OPEN |
| E19 | 生命周期 | 中 | 真实，OPEN |
| E20 | composable | 中 | 真实，OPEN |
| E21 | 错误处理 | 中 | 真实（`UnifiedMap.vue:104` 子串匹配，与 E19 同源） |
| D09 | 响应式 | P2 | 真实，OPEN |
| E26 | 生命周期 | 低 | 真实，OPEN |
| E27 | 生命周期 | 低 | 真实，OPEN |
| ForecastPage debounceTimer | 生命周期 | 低 | **本版新增**（v1 已指出但高估严重度，降级为低） |

> 以上全部可在 `待解决问题.md` 找到对应条目（除 debounceTimer 为 Vue 层补充发现，未单独建项）。**v2 未发现与既有清单冲突的新缺陷**。

---

## 4. 给 HappY 的内部化清单（修订版）

面试/复述时以下 6 点必须能**脱离代码讲清**，且区分「刻意为之」与「真实债」：

1. **Cesium 为什么不销毁**：渲染器 `v-show` 复用 + Cesium Viewer 单例是性能取舍（E16），引擎切换不重建上下文；`UnifiedMap.onUnmounted` 销毁当前活动渲染器只是整应用卸载收尾。
2. **`analysisHandler` 是刻意事件总线注入**（A02），让 `core` 不依赖 `business`，不是反模式——别在面试里把它当 bug 讲。
3. **为什么不解构 store**：规范 `项目根基.md:357` 明文禁止解构（"解构会丢失响应性"），用 `store.x` 直接访问天然响应式，因此全仓零 `storeToRefs` 是合规，不是疏漏。
4. **`shallowRef` 选型**：`currentRenderer`/渲染器实例用 `shallowRef`（重对象）；但 `layerCatalog` 仍用 `ref([])` 是 D09 真问题（数组频繁 push 应 `shallowRef`）。讲清"重对象/大数组用 shallowRef"即可。
5. **请求竞态三件套**：`analysisSeq` 序号过滤（浸没滑块）/ `startTransaction` + `AbortController`（预测）/ 300ms 防抖（`ForecastPage`）。
6. **双图层注册机制（E02）**：旧 `registerToggleable` 把函数存进 Pinia state（反模式），新 `registerBusinessLayer` 只存元数据——这是「迁移未完成债」，不是设计意图；`LayerControlPanel` 当前绕开了崩溃路径，但隐患代码仍在。

---

## 5. 结论

- **v2 相对 v1**：撤除 5 处误报（4 处刻意为之 + 1 处惯用法），保留并补入与 `待解决问题.md` 一致的真实项（A05 / E02 / E13 / D09 / E19 / E20 / E21 / E26 / E27 / D03 / E07），并将 `ForecastPage` 防抖定时器遗漏从「P0 崩溃级」降级为「低危孤儿请求」。
- **真实问题严重程度**：1 个 P0（A05 分层破口）、1 个 P0（E13 图层泄漏，架构评审已代码验证）、1 个 P1（E02 双注册债）、其余 P2/中/低。
- **与既有清单关系**：本版所有真实问题均能在 `待解决问题.md` 找到 ID，无新增冲突项——Vue 层审查与架构/TS/WebGIS/工程化审查同源互补，不重复架构结论。
- **建议落地顺序**：P0 先修 A05（可视化层去 business 依赖）+ E13（SiteSelectionPage 走 BusinessLayerManager + 补 pointer-events）；P1 修 E02（统一图层注册入口）；低危项按需。
