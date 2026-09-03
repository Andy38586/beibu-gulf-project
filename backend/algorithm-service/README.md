# algorithm-service — 北部湾在线演算服务

FastAPI 计算引擎层（v3 架构 §二 2.1）：**项目全部计算算法归此服务**。
由 `backend/flood-service/` 平移演进（2026-09-03）。

## 职责边界

- **flood 兼容区（`flood.py`）**：连通性淹没（海面种子）与设施影响评估，
  保留 `/api/flood/online`、`/api/flood/impact` 既有契约（滑块演进 0~15m，
  查表秒回 + LRU 演算兜底，垂直基准 EGM96 换算）。
- **route 新区（`route/`）**：最短路径（networkx），骨架已就位，路由后续填充。
- 应用装配（日志/CORS/lifespan/health）在 `main.py`，引擎在 `flood_engine.py`。
- 预计算档位表工具 `precompute_levels.py` 仅离线使用，不进镜像（见 .dockerignore）。

## 启动

```bash
cd backend/algorithm-service
.venv/Scripts/python.exe -m uvicorn main:app --port 8000   # 或 start.bat
```

## 测试

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

真演算耗 `backend/data/flood/dem/*.tif`（gitignored），缺失自动 skip，不影响 CI。

## 接口

| 方法 | 路径                               | 说明                                                    |
| ---- | ---------------------------------- | ------------------------------------------------------- |
| GET  | `/api/flood/online?waterLevel=3.5` | 水位 → 淹没 GeoJSON + 统计（查表秒回；miss 走动态演算） |
| GET  | `/api/flood/impact?waterLevel=3.5` | 淹没 ∩ 设施点 → 受影响设施 + 总损失                     |
| GET  | `/health`                          | 健康检查                                                |

## 容器

Dockerfile 与 `docker-compose.v3.yml`（algorithm-service 服务，8000 端口）。
数据卷 `./backend/data` 以 ro 挂载；DEM 缺失时在线演算兜底返回 503，查表不受影响。
