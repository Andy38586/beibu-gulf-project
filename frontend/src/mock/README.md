# Mock Data

## 用途

架构验证阶段使用的模拟数据。所有数据均为示意性数据，不具备业务真实性。

## 原则

- **开发阶段**：通过 Data Adapter 层使用 Mock 数据
- **生产阶段**：替换 Adapter 实现，接入真实数据源
- **业务层和渲染层无需修改**

## 目录结构

```
mock/
├── README.md           # 本文件
├── forecast/           # 预测分析 Mock 数据
│   ├── README.md       # 预测数据说明
│   ├── throughput.json
│   ├── berth.json
│   ├── traffic.json
│   ├── pressure.json
│   └── development.json
└── flood/              # 浸没分析 Mock 数据
    ├── README.md       # 浸没数据说明
    └── dem.json
```

## 替换流程

1. 替换 Adapter 中的数据源实现（例如从 `return mockData` 改为 `return axios.get(...)`）
2. 业务层代码零改动
3. 渲染层代码零改动
