# Carbon Emission Mock Data

## 用途

架构验证阶段模拟港口碳排放时序数据，用于验证：

- 2D 渲染引擎承载新业务类型的扩展能力
- BusinessLayerManager 对新 layerType 的兼容性
- Data Adapter 模式的复用性

## 数据说明

| 字段 | 内容 | 说明 |
|------|------|------|
| `ports[*].emissions` | 逐年碳排放量 (千吨 CO2) | 示意性趋势数据 |
| `categories` | 排放类别 | 示意性分类 |

## 重要声明

**这不是生产数据。**
- 碳排放数据为示意性趋势模拟，非实际监测值
- 排放类别为架构验证占位

## 替换方式

只替换 `carbonAdapter.js`：

```js
// 当前（Mock）
getEmissionData() { return carbonMockData }

// 将来（真实数据）
getEmissionData() { return axios.get('/api/carbon/emissions') }
```

业务层 `CarbonAnalysisPage.vue` 无需修改。
