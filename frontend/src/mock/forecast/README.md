# Forecast Mock Data

## 用途

架构验证阶段模拟港口时序数据，用于验证：

- 2D 渲染引擎承载非空间计算型业务的能力
- 动态数据驱动地图更新链路

## 数据说明

按「真实数据归后端、示意数据归前端」原则分库存放（2026-07-31 起）：

- **真实数据（后端单源）** → `backend/data/forecast/`，经 `/api/forecast/*` 返回：
  - `cargo.json`（货物吞吐量，万吨，2021–2026 真实，桌面 CSV）
  - `container.json`（集装箱吞吐量，TEU，2021–2026 真实，桌面 CSV）
- **示意性合成数据（前端 fixture）** → `frontend/public/data/forecast/`，作静态文件：
  - `berth.json`（泊位利用率，2018–2025 生成）
  - `traffic.json`（船舶流量，2018–2025 生成）
- `throughput_model.json` 为独立的预测模型产物，不参与接口。

指标顺序（UI 排序）：货物 → 集装箱 → 泊位利用率 → 船舶流量。

## 重要声明

**cargo / container 为真实港口统计口径数据**（北部湾港 2021–2026 月度吞吐量，
来源：广西产业园区改革发展办公室官网）。预测值由后端 `forecastService.computeForecast`
按近 5 年月均增长率趋势外推 + 季节性因子生成，仅作架构验证演示，非官方预测。
berth / traffic 为示意性生成数据，仅前端静态展示（无后端预测引擎参与）。

## 数据接入方式（同一页面两种取数方式）

`forecastAdapter` 按指标来源分流（`INDICATOR_SOURCE`）：

- **cargo / container** → 全局默认 `api` → `GET /api/forecast/*`（后端读 `backend/data/forecast/`）。
- **berth / traffic** → `mock` → `fetch('/data/forecast/{indicator}.json')`（前端静态 fixture）。

即「一个预测页面两种请求方式」：真实指标走 API、合成指标走静态文件。
业务层（`useForecastRequest`、`ForecastPage`、`ForecastControlPanel`）无需修改。
渲染层（`useForecastLayer`）无需修改。
