# router — 路由层

业务路由由 `business/manifest.ts` 清单生成（新增业务模块 = manifest 加一条 + 建模块目录）。

## 约定

- 业务路由 `meta.engine`（'2d' | '3d'）驱动地图引擎切换；`meta.title` 驱动面板标题
- 组件懒加载：`component: () => import(...)`
- 无全局路由守卫（前端全公开是设计：后端 `authenticate` 为真网关，见根基文档 02 §4.5）
- 页面跳转登录（`/profile`）的跨页状态恢复走各 store 快照（`saveState`/`consumeState`），路由层不做
