# business/flood-analysis — 浸没分析模块

- **职责**：水位滑块 → 淹没范围（双引擎）+ 水面（3D-only）+ 受影响设施评估。
- **入口**：`FloodAnalysisPage.vue` → `floodAdapter`（数据源分流：api=Express /flood/\*，online=FastAPI /flood-online，adapter 隔离业务零改动）。
- **components**：`WaterLevelProfilePanel`（水位滑块 + 剖面线）；`AffectedFacilityListPanel`（损失降序分页）；`FloodAnalysisReportPanel`（面积/水深/损失汇总）。
- **store**：`useFloodStore`（水位/结果/快照；`clearState` 全量清含快照）。
- **语义（应然）**：水位 0 → 无淹没；面积随水位单调不减；api 模式 6 档向上取档（宁可高估）；online 251 档精确查表（8-1 修复后整数档命中）。
- **禁止**：不经 floodAdapter 直连数据源（R5）；水面在 2D 下注册但跳过创建（设计，5.3）。
- **已知**：海底 DEM 未获取（海洋按海平面），浸没真实性最大短板，v3 融合 SRTM15+。
