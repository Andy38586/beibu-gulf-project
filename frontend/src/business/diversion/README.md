# business/diversion — 分流分析模块

- **职责**：平陆运河分流份额与运河线位的可视化（分流比例、分段对账），不承载预测。
- **入口**：`DiversionPage.vue` → `useDiversionApi`（`getBreakdown` / `getCanalLine` 两个取数口）→ `diversionAdapter` 已于 `d89b77e1` 并入 composable。
- **composables**：`useDiversionLayer`（经 BLM 更新运河/分流图层）。
- **常量**：`constants/diversionMap.ts`（地图参数）；`panels.ts` 是面板位置的**唯一出处**，模板只 `v-bind`，不写字面量。
- **数据流**：页面挂载 → 取 breakdown/canal-line → 写本地 ref + 图层。
- **禁止**：在模板里手写面板位置；绕过 `useDiversionApi` 直接 fetch。
- **已知边界**：生产侧 `/diversion/canal-line` 仍是 1 段示意线（主干 11 段已入库本地，同步卡在生产数据变更）；本模块 barrel 不导出 composable，`useDiversionApi` 目前只有页面一个消费点。
