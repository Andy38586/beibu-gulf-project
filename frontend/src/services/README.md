# services — 数据服务层

业务取数逻辑的唯一出口（分层铁律：组件/composable 不得直调 HTTP）。

## 结构

```
services/
├── index.ts              # 公开入口（export * 各 adapter）
├── mapDataService.ts     # 地图静态数据（港口/边界 GeoJSON，经 loadStatic）
└── adapters/
    ├── floodAdapter.ts   # 洪涝双模式（api=Express / online=FastAPI 演算）+ 档位缓存
    └── forecastAdapter.ts# 预测三端点（timeseries / indicator / overview，schema 边界校验）
```

## 约定

- **所有 HTTP 请求必须经 `useApiRequest`**（统一信封解包 / 超时重试 / zod 校验 / 请求 ID）
- **HTTP 边界 100% zod**：每个端点必须传 `schema`（`types/schemas.ts` 定义，`z.infer` 同源类型）
- adapter 返回业务形状（组件直接消费），不做字段映射残留
- 仅在取数逻辑跨业务复用时新建 adapter；单业务取数放业务模块 composable（见根基文档 02 §R5）
