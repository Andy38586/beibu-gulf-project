# v1.5 发布验收清单

> Architecture Validation Release | 冻结日期：2026-07-24

---

## 功能验收

| # | 功能 | 验收标准 | 结果 |
|---|------|----------|------|
| 1 | 首页地图 | 2D OpenLayers 正常加载，天地图底图 + 港口标记 | ⬜ |
| 2 | 选址分析 | POI 加载、缓冲分析、权重模型、方案保存/恢复 | ⬜ |
| 3 | 预测分析 | 4 指标切换、时间滑块、播放、图表联动、地图热力 | ⬜ |
| 4 | 浸没分析 | 3D Cesium 加载、水位滑块、剖面线选择 | ⬜ |
| 5 | 碳排放分析 | 年份选择、图表展示、points 图层注册/销毁 | ⬜ |
| 6 | 个人中心 | 页面正常渲染 | ⬜ |

## 架构验收

| # | 指标 | 验收标准 | 结果 |
|---|------|----------|------|
| 7 | 新增业务无需改核心引擎 | carbon-analysis 实验：0 核心文件修改 | ✅ |
| 8 | 数据 Adapter 隔离 | 3 个 Adapter（forecast/flood/carbon），mock↔api 切换 | ✅ |
| 9 | Renderer 隔离 | BusinessLayerManager 动态获取，2D/3D 不耦合 | ✅ |
| 10 | 图层生命周期 | register/updateData/setVisible/remove 完整 | ✅ |

## 工程验收

| # | 检查项 | 验收标准 | 结果 |
|---|--------|----------|------|
| 11 | `npm run build` | 0 编译错误 | ✅ |
| 12 | 控制台错误 | 无未捕获异常 | ⬜ |
| 13 | 路由切换 | 首页→选址→预测→浸没→碳排→首页，循环正常 | ⬜ |
| 14 | 2D→3D 切换 | 引擎切换无崩溃，图层正确销毁/重建 | ⬜ |

## 收尾功能

| # | 功能 | 状态 |
|---|------|------|
| 15 | 统一错误处理 | ✅ `src/shared/utils/errorHandler.js` |
| 16 | 收藏夹 | ✅ `src/stores/favoriteStore.js` + FavoritePanel |

## 文档验收

| # | 文档 | 状态 |
|---|------|------|
| 17 | 架构验证文档 | ✅ `docs/architecture-validation.md` |
| 18 | 业务扩展指南 | ✅ `docs/business-extension-guide.md` |
| 19 | 架构冻结检查报告 | ✅ `docs/architecture-freeze-check.md` |
| 20 | 已知问题诊断 | ✅ `docs/known-issues-diagnosis.md` |
| 21 | 预测分析冻结说明 | ✅ `docs/forecast-freeze-memo.md` |
| 22 | 发布验收清单 | ✅ 本文档 |

## 已知不修项

| 问题 | 原因 |
|------|------|
| Cesium 图层未显示 | 高风险，触核心引擎，等真实 DEM 后修复 |
| 人口/吞吐热力图 | 未实现功能（非 Bug），bottom nav 已标 disabled |
| 预测业务准确率 | mock 数据，等真实港口数据接入 |
| dist/ 清理权限警告 | 沙箱环境限制，非代码问题 |

---

*验收人：___________ | 日期：2026-07-24*
