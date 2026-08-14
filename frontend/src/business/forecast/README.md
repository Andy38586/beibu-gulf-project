# business/forecast — 预测分析模块

- **职责**：吞吐量趋势可视化（时间轴播放 + 地图热力 + 图表），支持 cargo/container（真实模型产物）/ berth/traffic（合成示意，诚实标注）。
- **入口**：`ForecastPage.vue` → `useForecastRequest`（事务/竞态管理，`useLatestRequest` 取消旧请求）→ `forecastAdapter`（/forecast/* 三端点，schema 边界校验）。
- **composables**：`useForecastLayer`（地图图层 BLM 更新）；`useOverviewCharts`（首页概览静态快照）。
- **store**：`useForecastStore`（跨页快照 saveState/consumeState；登出 clearState；requestCache LRU 50）。
- **数据流**：三值合并 watch + 300ms 防抖 → 事务（新请求取消旧）→ 图表写本地 ref / 图层经 BLM（key: forecast-{indicator}）。
- **禁止**：不经 adapter 直接 fetch；播放态 429 限流静默降级不弹 toast（已知边界，02 §4.2）。
- **已知**：数据缓存职责在 requestCache（原 dataCache 死状态已移除，F-7）；v3 将接入 ARIMA 真模型 + 情景分档。
