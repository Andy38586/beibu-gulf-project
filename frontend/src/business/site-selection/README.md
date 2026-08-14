# business/site-selection — 选址分析模块

- **职责**：小区选址分析（三态设施选择 → 后端九步计算 → 雷达图/小区列表/图层结果）。
- **入口**：`SiteSelectionPage.vue`（页面装配）→ `SiteAnalysisControlPanel.vue`（交互组装参数，不计算）→ `useSiteAnalysisApi`（取数，直连 `useApiRequest` + zod，无 adapter——设计豁免，见 02 §4.1）。
- **composables**：`useAnalysisLayer`（结果 GeoJSON 构建，纯函数 `buildCoverageGeoJson`）；`useRadarChart`（雷达图资产在 visualization，本模块只消费）。
- **数据流**：POST `/api/site-analysis`（需登录）→ 后端 service 九步 → BLM 注册 analysis-coverage / analysis-matched 图层。
- **禁止**：不经 `useApiRequest` 裸 fetch；在页面里写空间计算；直接操作 renderer 图层。
- **已知**：旧选址将随 v3 新选址（多准则+运河因子）替换，代码保留为历史版本，路由让位（见 v3-发展路径 §四）。
