# Flood Mock Data

## 用途

架构验证阶段模拟高程和水域数据，用于验证：

- 3D 渲染引擎和空间分析业务解耦能力
- Cesium Primitive 动态更新生命周期

## 数据说明

| 文件 | 内容 | 来源 |
|------|------|------|
| `water-area.json` | 水域边界多边形 | 示意数据 |
| `dem.json`（待补充） | 高程模拟数据 | 示意数据 |

## 重要声明

**这不是生产数据。**
- 水域边界数据为示意性多边形，非真实地理测绘数据
- 高程数据为模拟值，非真实 DEM
- 浸没分析结果不具备洪涝预测参考价值

## 替换方式

只替换 `floodAdapter.js` 中的 Data Adapter 实现：

```js
// 当前（Mock）
getWaterArea() {
  return fetch('/data/water-area.json')
}

getDEM(region) {
  return generateMockDEM(region)  // 示意性高程
}

// 将来（真实数据）
getWaterArea() {
  return axios.get('/api/v2/hydrology/water-bodies', { params: { region } })
}

getDEM(region) {
  return axios.get('/api/v2/terrain/dem', { params: { region, resolution: 30 } })
}
```

业务层（`FloodAnalysisPage`、`WaterLevelProfilePanel`）无需修改。
渲染层（`BusinessLayerManager`、`CesiumRenderer`）无需修改。
