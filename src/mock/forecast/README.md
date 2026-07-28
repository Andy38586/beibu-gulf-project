# Forecast Mock Data

## 用途

架构验证阶段模拟港口时序数据，用于验证：

- 2D 渲染引擎承载非空间计算型业务的能力
- 动态数据驱动地图更新链路

## 数据说明

| 文件               | 指标         | 时间范围          | 粒度 |
| ------------------ | ------------ | ----------------- | ---- |
| `throughput.json`  | 吞吐量预测   | 2023-01 ~ 2035-12 | 月   |
| `berth.json`       | 泊位利用率   | 2023-01 ~ 2035-12 | 月   |
| `traffic.json`     | 航道流量     | 2023-01 ~ 2035-12 | 月   |
| `pressure.json`    | 港口压力指数 | 2023-01 ~ 2035-12 | 月   |
| `development.json` | 发展趋势     | 2023-01 ~ 2035-12 | 月   |

## 重要声明

**这不是生产数据。** 所有数值均为示意性随机生成，不具备真实港口业务参考价值。

## 替换方式

只替换 `forecastAdapter.js` 中的 Data Adapter 实现：

```js
// 当前（Mock）
getForecastData(indicator, time) {
  return fetch(`/data/forecast/${indicator}.json`)
}

// 将来（真实 API）
getForecastData(indicator, time) {
  return axios.get(`/api/v2/forecast/${indicator}`, { params: { time } })
}
```

业务层（`useForecastRequest`、`ForecastPage`、`ForecastControlPanel`）无需修改。
渲染层（`useForecastLayer`）无需修改。
