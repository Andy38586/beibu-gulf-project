# business/site-suitability — 选址适宜性模块

- **职责**：按 AHP 权重对候选方格做适宜性评分与雷达图展示（行政区/设施可达性等因子）。
- **入口**：`SiteSuitabilityPage.vue` → `useSiteSuitabilityStore`（权重、评分结果、默认值）。
- **store**：`siteSuitabilityStore`；默认值有前端兜底快照 `stores/siteSuitabilityDefaults.snapshot.ts`，
  **权威是后端** `GET /site-suitability/defaults`，两侧双向断言在册（`siteSuitabilityStore.defaults.test.ts`
  ⇄ `backend/test/site-suitability-defaults.spec.ts`）。
- **常量**：`panels.ts` 是面板位置的唯一出处，测试直接 import 做派生断言。
- **数据流**：页面挂载 → 拉 defaults → 用户调权重 → 评分请求 → 写 store → 面板读 store。
- **禁止**：把前端快照当权威改（改后端 defaults 后快照须同笔跟进，否则双向断言会红）。
- **已知边界**：本模块 barrel 只导出页面组件；评分方格来自 PostGIS 物化表，本地全量与 CI 合成夹具口径不同。
