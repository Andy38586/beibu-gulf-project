# business/route-analysis — 航线分析模块

- **职责**：起终点航线查询、POI 搜索、北部湾 3D 航道瓦片与 LOD 精细度策略。
- **入口**：`RouteAnalysisPage.vue` → `useRouteApi`（`searchPois`）；航线查询本身走**异步任务域**（`domain: 'route-path'`），不经同步端点。
- **常量**：`constants/beibu3dTiles.ts`（`BEIBU_TILES` / `prepareBeibuTileset`，3D 瓦片预备面）、`constants/lodRefinePolicy.ts`（带实测来源的 LOD 阈值）、`constants/pingluTiles.ts`。
- **数据流**：输入起终点 → 提交任务 → 轮询任务结果 → 写本地 ref / 图层。
- **禁止**：绕过 `useRouteApi` 直连 HTTP；在页面里手写 LOD 阈值（须读 `lodRefinePolicy`）。
- **已知边界**：页面状态为本地 ref，登出时路由保留、图层由页面自行清理；`useRouteApi` 只有一个生产消费点。
