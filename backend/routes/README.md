# routes — 后端路由层

Express 路由（薄层）：参数校验 + 分发到 controller，业务计算在 services 完成。

## 结构

```
routes/
├── auth.js              # 注册/登录/登出/当前用户
├── forecast.js          # 预测四端点（overview/map/timeseries/indicator/:type）+ /:portId 兼容端点
├── floodAnalysis.js     # 洪涝（flood-areas/statistics/terrain-profiles/water-area/analysis-disaster）
├── plans.js             # 收藏方案 CRUD（写接口全走 authenticate）
├── ports.js             # 港口列表
└── siteAnalysis.js      # 选址分析
```

## 约定

- 参数校验统一 `BusinessError` + 全局错误中间件（无裸 `res.status(400)`）
- 写接口必须 `authenticate` 中间件；读接口默认开放（用户拍板：仅收藏要求登录）
- `/:portId` 通配路由必须放最后（防吞固定路径）
