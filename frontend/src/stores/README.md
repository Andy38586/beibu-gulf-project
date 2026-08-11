# stores — Pinia 状态层

业务跨页面状态的唯一事实源（分层铁律：stores 不得 import business，常量从 shared 取）。

## 结构

```
stores/
├── index.ts                    # 公开入口
├── mapStore.ts                 # 地图状态（mapType/图层目录/底图/当前渲染器）
├── forecastStore.ts            # 预测状态（时间/指标/置信度/数据与请求缓存/快照）
├── floodStore.ts               # 洪涝状态（水位/淹没数据/影响评估/持久化快照）
├── siteSelectionStore.ts       # 选址状态（分析结果/收藏/跨页快照）
└── factories/
    └── createPersistedState.ts # 跨页面快照工厂（save/consume 一次性）
```

## 约定

- 状态变更一律走 **action**（禁止组件逐字段直改，DevTools 可追踪）
- 登出/路由切换重置：`reset()` 统一复位；跨页面登录返回用快照（`saveState`/`consumeState`）
- 请求事务状态（竞态守卫）迁入 store 共享，AbortController 由请求实例持有
- 新 store 用 composition 写法（`defineStore('x', () => {...})`）
