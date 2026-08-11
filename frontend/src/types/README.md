# types — 类型定义层

纯类型层（禁运行时逻辑、禁反向依赖 shared；运行时常量见 `shared/utils/crs.ts` 等）。

## 结构

```
types/
├── index.ts            # 公开入口
├── renderer.ts         # MapRenderer 接口 / LayerOptions / 能力接口（Water3D/GeoTIFF/Heatmap）
├── schemas.ts          # HTTP 边界 zod schema（z.infer 同源类型，运行时校验唯一来源）
├── crs.ts              # 坐标系类型（CRS / GeoPoint / LaxPoint）
├── business/base.ts    # 业务类型（FloodStatistics / FloodFeature / AffectedFacility…）
├── api/forecast.ts     # 预测数据模型
└── …                   # map/facility/xiaoqu/plan/components 等按域划分
```

## 约定

- 无 I/T 前缀，业务语义优先（`MapRenderer`、`SiteSelectionParams`）
- HTTP 响应类型从 schema `z.infer` 派生（与 `services/` 的边界校验同源，不手写第二份）
- `types/` 不得出现 `import from '@/shared'` 等运行时依赖
