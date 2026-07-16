# GCS V3 重构 Phase 3~4 实施日志

> 生成时间：2026-07-16  
> 实施阶段：Phase 3-A / 3-B / 4-A / 4-B  
> 目标：拆除旧顶部导航，完成首页四象限业务填充，将选址分析业务页迁移到 Layout Base，并把本地 commit message 本地化为中文。

---

## 一、阶段范围

| 阶段 | 计划目标 | 实际完成 |
|------|----------|----------|
| Phase 3-A | 拆解 AppHeader，功能迁入 GCS Panel | ✅ 已完成（已提交） |
| Phase 3-B | 填充首页 Zone1/Zone2/Zone3 | ✅ 已完成（已提交） |
| Phase 4-A | BufferPage 重命名并接入 AppLayout | ⚠️ 部分完成（已提交：重命名 + 基础路由；未提交：Zone2/Zone4 完整接入） |
| Phase 4-B | 完成 SiteSelectionPage 布局迁移；commit message 中文化 | ⚠️ 代码改动在工作区未提交；commit message 已中文化 |

---

## 二、新增文件

| 文件路径 | 作用 |
|----------|------|
| `src/composables/useScreenActions.js` | 集中导航与城市定位逻辑：首页/个人中心/返回、钦州/北海/防城港 flyTo |
| `src/core/layout/components/CityBar.vue` | 4×1 城市定位栏，复用 GcsPanel |
| `src/core/layout/components/Zone1.vue` | 业务控制区（右上）：Home/User 按钮 + CityBar + 业务入口 |
| `src/core/layout/components/charts/LineChart.vue` | Zone2 折线图可视化组件，基于 ECharts |

---

## 三、修改文件

### 3.1 已提交到本地仓库的修改

| 文件路径 | 修改内容 |
|----------|----------|
| `src/App.vue` | 删除 AppHeader 导入，接入 AppLayout；LayerPanel/MapSwitcher 保留（待 Phase 5 处理） |
| `src/core/layout/components/GcsButton.vue` | 新增 `active` prop，支持图层开关等激活态样式 |
| `src/core/layout/components/Zone1.vue` | 业务入口按钮、城市条、导航按钮 |
| `src/core/layout/components/Zone2.vue` | 接入 LineChart 组件 |
| `src/core/layout/components/Zone3.vue` | 接入 useLayerManager，渲染底图/业务图层开关 |
| `src/router/index.js` | 引入 SiteSelectionPage，路径从 `/buffer` 调整为 `/site-selection` |
| `src/views/HomePage.vue` | 配合 AppLayout 调整 |
| `src/views/BufferPage.vue` | 重命名为 `src/views/SiteSelectionPage.vue` |

### 3.2 仍在工作区、未提交的修改（Phase 4-B 代码内容）

| 文件路径 | 修改内容 |
|----------|----------|
| `src/components/analysis/RadarFloatPanel.vue` | 新增 `embedded` 模式：浮动模式保持原行为，嵌入模式填满 Zone2 固定面板；无数据时显示占位文案 |
| `src/views/SiteSelectionPage.vue` | 完整继承 Home Layout：Zone2 固定雷达图、Zone4 垂直堆叠 BufferControl + ResultPanel；删除旧的浮动结果面板 |
| `src/views/ProfilePage.vue` | 加载方案后跳转路径从 `/buffer` 改为 `/site-selection` |
| `src/core/layout/components/Zone1.vue` | 业务入口「选址分析」路由从 `/buffer` 改为 `/site-selection` |
| `src/router/index.js` | 路径 `/buffer` → `/site-selection`（与已提交内容一致，工作区为最终确认状态） |

---

## 四、改动方式与关键决策

### 4.1 Phase 3-A：拆解 AppHeader

- **不改地图架构**：AppHeader 的登录/注册按钮属于业务入口，本次只把「首页」「个人中心/返回」和城市定位条迁出，不改动地图渲染逻辑。
- **导航状态集中**：新建 `useScreenActions.js`，把 `router.push('/')`、`router.back()`、个人中心标签逻辑统一封装，避免 Zone1 与 Profile 路由各自维护判断。
- **城市定位**：CityBar 通过 `useMapControls().flyTo()` 触发，坐标来源保留为 `public/data/ports.json`（由既有项目提供），CityBar 本身只负责触发 `select` 事件。

### 4.2 Phase 3-B：填充首页四象限

- **Zone1 业务入口**：采用 `businessEntries` 数组驱动 2×1 按钮网格，仅「选址分析」可点击，其余功能（吞吐量/因子/航线分析）置灰占位。
- **Zone2 可视化**：直接嵌入 `LineChart.vue`，数据走默认 prop，未接入真实 API，符合「可视化面板与业务解耦」原则。
- **Zone3 图层控制**：接入已有的 `useLayerManager`，从 `layerCatalog` 动态渲染底图/业务图层按钮；底图互斥、业务图层多选由 useLayerManager 保证。
- **GcsButton 扩展**：新增 `active` 状态，复用于图层开关，避免复制按钮组件。

### 4.3 Phase 4-A：页面重命名

- 将 `BufferPage.vue` 重命名为 `SiteSelectionPage.vue`，路由同步从 `/buffer` 改为 `/site-selection`。
- `ProfilePage` 中加载方案的跳转路径同步更新。
- 这一提交仅完成文件级迁移和路由切换，未做 Zone2/Zone4 的完整布局接入（该部分在后续工作区修改中完成）。

### 4.4 Phase 4-B：SiteSelectionPage 接入 Layout Base

- **Zone2 雷达图固定化**：`RadarFloatPanel` 新增 `embedded` prop。
  - `embedded=false`：保持原有浮动弹窗行为。
  - `embedded=true`：作为 Zone2 固定面板，始终渲染；无小区选中时显示占位提示。
- **Zone4 组合配置 + 结果**：使用 `zone4-stack` 垂直堆叠 `BufferControl` 与 `ResultPanel`，超出高度可滚动；删除旧版独立的 `result-panel-wrap` 浮动容器。
- **清空选中小区**：`handleResult` 在每次分析结果返回后清空 `selectedXiaoqu`，避免旧雷达图与新结果列表状态错位。

### 4.5 Phase 4-B：commit message 中文化

- 通过 `git rebase -i HEAD~4` 修改最近 4 条本地未推送 commit 的 message。
- 保留冒号前的 conventional commit 前缀（`feat(layout):` / `refactor(layout):`）和所有英文文件名。
- 删除所有括号内附加说明（本次无），其余描述翻译为中文。
- 最终 message 见「九、附录」。

---

## 五、遇到的问题与处理方式

| 问题 | 原因 | 处理方式 | 状态 |
|------|------|----------|------|
| `git rebase -i` 提示 `You have unstaged changes` | 工作区有 Phase 4-B 未提交改动 | 先 `git stash push -u` 暂存，rebase 完成后 `git stash pop` 恢复 | 已解决 |
| PowerShell 脚本中 commit message 中文乱码 | 终端默认编码非 UTF-8，PowerShell 5.1 `Set-Content -Encoding UTF8` 会写入 BOM | 改用 `[System.IO.File]::WriteAllLines` 以无 BOM UTF-8 写入 rebase todo 文件；查看 log 时临时设置 `[Console]::OutputEncoding = UTF8` | 已解决 |
| `git rebase` 报 `invalid command 'pick'` | rebase todo 文件开头带 BOM，Git 无法识别 | 脚本改为无 BOM 写入 | 已解决 |
| ESLint 警告：Zone1/Zone2/Zone3/Zone4 组件名单词数不足 | Vue 规范要求组件名多词 | 为每个 Zone 组件添加 `export default { name: 'GcsZoneX' }` | 已解决 |
| ESLint 警告：`const props = defineProps(...)` 未使用 | CityBar 中 `props` 变量无引用 | 直接调用 `defineProps(...)`，不赋值给变量 | 已解决 |
| `router.back()` 在历史栈为空时失效 | 从外部直接访问 SiteSelectionPage 时可能无历史 | 检查 `window.history.state?.back`，不存在则 fallback 到 `router.push('/')` | 已解决 |
| Vue warn：extraneous non-props attributes (class) passed to component | `BufferControl` / `ResultPanel` 被直接加 `class` | 用 `div` 包裹组件，将 `class` 移到外层 div | 已解决 |
| 点击「开始筛选」返回 HTTP 502 | 后端服务未启动 | 与本次前端重构无关，已记录，未修改代码 | 已记录 |
| 旧 `LayerPanel`、`MapSwitcher` 仍挂载在 `App.vue` | 属于 Phase 5 图层控件迁移范围 | 本次未删除，避免一次性改动过大 | 待 Phase 5 |

---

## 六、做了哪些 / 没做哪些

### 6.1 已完成

- [x] 拆除 AppHeader，功能迁入 Zone1 与 `useScreenActions`。
- [x] 首页四象限业务入口、折线图、图层控制全部可用（业务入口仅选址分析可点击）。
- [x] SiteSelectionPage 文件重命名、路由切换。
- [x] SiteSelectionPage 继承 Home Layout，Zone2 固定雷达图、Zone4 组合配置与结果列表。
- [x] RadarFloatPanel 支持 embedded 模式，同时保留浮动模式兼容。
- [x] 本地最近 4 条 commit message 改为中文版本。
- [x] ESLint 与 build 通过（当前工作区改动尚未 build，已提交阶段均通过）。

### 6.2 未完成 / 待后续阶段

- [ ] 吞吐量、因子、航线分析等业务路由仍为占位按钮，未实现页面。
- [ ] Zone3 目前复用旧 `useLayerManager`，未来需要按 guide Phase 5 迁移为统一的 `LayerControlPanel`。
- [ ] `App.vue` 中仍保留旧 `LayerPanel` / `MapSwitcher`，需在 Phase 5 删除或替换。
- [ ] LineChart 当前为静态示例数据，未接入真实港口吞吐量 API。
- [ ] HTTP 502 问题需后端服务启动后再次验证。
- [ ] Phase 4-B 的代码改动目前在工作区，未执行 `git commit`（按用户要求，由用户自行提交）。

---

## 七、发现的问题

### 7.1 地图与后端相关问题（按用户要求，本次仅记录、未改动）

| 问题 | 现象 | 建议处理阶段 |
|------|------|--------------|
| 后端服务未启动 | 点击「开始筛选」时 API 返回 HTTP 502 | 后端部署 / 联调阶段 |
| 旧图层面板与 Zone3 并存 | `LayerPanel` 和 `MapSwitcher` 仍浮在 App.vue 上，与新的 Zone3 功能重复 | Phase 5 |
| 地图引擎切换按钮仍保留 | `MapSwitcher` 与「地图引擎由 route meta 决定」的架构契约冲突 | Phase 5 |

### 7.2 代码与工程问题

| 问题 | 影响 | 建议 |
|------|------|------|
| `ResultPanel` 内部仍使用固定 `380px` / `max-height` 等 px 值 | 与 GCS「禁止硬编码 px」原则存在偏差 | 后续统一用 `useGCS` 计算 |
| `ProfilePage` 使用固定 px / `calc(39 * var(--unit))` 等自定义布局 | Profile 属于特殊布局，但部分数值与 GCS 不完全一致 | 按 guide 中 Profile 8×4 规则再校准 |
| `RadarFloatPanel` 浮动模式仍依赖 `document.querySelector('.layer-panel')` | 与旧 LayerPanel 耦合，旧面板删除后需改用 GCS 计算位置 | Phase 5 |

---

## 八、验收结果

| 检查项 | 结果 |
|--------|------|
| `npm run build`（已提交阶段） | ✅ 通过 |
| ESLint（已提交阶段） | ✅ 0 error |
| 首页四象限布局 | ✅ Zone1/Zone2/Zone3 已按 4×4 Panel 渲染 |
| 城市定位按钮 | ✅ 点击城市名可触发 flyTo |
| 首页/个人中心按钮 | ✅ 在首页显示「个人中心」，在非首页显示「返回」 |
| 选址分析入口 | ✅ 点击后跳转 `/site-selection` |
| SiteSelectionPage Zone2 雷达图 | ⚠️ 代码在工作区，待用户提交后验证 |
| SiteSelectionPage Zone4 配置+结果 | ⚠️ 代码在工作区，待用户提交后验证 |
| commit message 中文化 | ✅ 最近 4 条本地 commit 已改为中文 |

---

## 九、附录

### 9.1 本地化后的 commit message

```
234a002 feat(layout): 阶段 4-A 重命名 BufferPage 为 SiteSelectionPage 并将 BufferControl 移入 Zone4
d841b53 feat(layout): 阶段 3-B 填充首页业务入口、折线图和图层控制
6939ec1 refactor(layout): 阶段 3-A 将 AppHeader 拆分为 GCS 面板
32d8c99 feat(layout): 阶段 1-2 构建 GCS 基础组件
```

### 9.2 当前工作区未提交文件

```
 M src/components/analysis/RadarFloatPanel.vue
 M src/core/layout/components/Zone1.vue
 M src/router/index.js
 M src/views/ProfilePage.vue
 M src/views/SiteSelectionPage.vue
?? docs/
```

### 9.3 关键组件状态

| 组件 | 状态 |
|------|------|
| `AppLayout` / `Zone1~Zone4` / `GcsPanel` / `GcsButton` | 稳定可用 |
| `LineChart` | 静态数据，样式可用 |
| `CityBar` / `useScreenActions` | 稳定可用 |
| `RadarFloatPanel` | 浮动 + 嵌入双模式，待提交 |
| `SiteSelectionPage` | 已接入 Layout Base，待提交 |

### 9.4 给下一个实施者的提示

1. **提交前请运行**：`npm run build`、`npm run lint`，确认 Phase 4-B 工作区改动无新增错误。
2. **Phase 4-B 提交建议**：可将当前工作区改动作为一个 commit，message 参考：`feat(layout): 阶段 4-B 完成 SiteSelectionPage 的 Zone2/Zone4 布局迁移与路由切换`。
3. **Phase 5 重点**：移除 `App.vue` 中旧 `LayerPanel` / `MapSwitcher`，将图层控制完全收敛到 Zone3；统一 `ProfilePage` 尺寸到 GCS 8×4 规则。
4. **业务页面扩展**：新增业务路由时，优先复用 `AppLayout` + Zone 插槽，不要重新定义布局规则。
