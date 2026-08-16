# visualization — 可视化层（L4 通用图表资产）

> 通用图表资产：ECharts 封装（图表组件 / composables）与业务无关的展示组件。
> 入口 `index.ts`（Q4 816 拍板：全量收口）。跨层消费方走 `@/visualization`，禁止深路径穿透；
> 图表懒加载（echarts 移出首屏关键路径）保留深路径 `import()`（见 HomePage/ProfilePage loader 注释）。

## 目录结构

```
visualization/
├── index.ts                 # 公开 API 入口（图表组件 + composables + 快照常量聚合导出）
├── charts/                  # 图表组件（BarChart / LineChart / RadarChart / ChartLoading）
│   ├── radarSnapshot.ts     # 雷达图默认快照常量（未分析时兜底显示）
│   ├── components/          # RadarScoreTooltip 等组件内部件
│   └── composables/         # useChartBase / useRadarChart（ECharts 装配）
├── composables/
│   └── useECharts.ts        # ECharts 底层封装（按需注册、主题、resize 闭环）
└── panels/
    └── PortInfoPanel.vue    # 港口信息浮层（首页）
```

## 依赖方向

- visualization 不反向依赖 business（cruise `visualization-should-not-import-business` 硬性拦截）。
- 图表如需业务常量/取数，由业务层注入 props 或 composable 参数（不 import 业务模块）。