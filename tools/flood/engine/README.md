# tools/flood/engine — 生成侧计算引擎（原 algorithm-service 的离线部分）

> **这个目录不是服务，是**离线数据生成链复用的计算引擎。
> 2026-09-26 从 `backend/algorithm-service/` 拆出，原 FastAPI 服务层已**整体移除**（仅存于 git 历史）。

## 为什么拆

`backend/algorithm-service` 原是 FastAPI 在线演算服务，2026-09-10 退役（能力全覆盖到
Nest + PostGIS：淹没档位 → `/flood/flood-areas`、设施影响 → `/flood/analysis/disaster`、
路径规划 → `/route/path`）。退役时其源码**保留不删**，理由是"FastAPI 未来可能因
用户上传数据实时渲染回归"。

2026-09-26 复核发现：真正**还被消费**的只有两个离线模块 ——

| 模块                   | 谁在消费                                                                        | 性质                          |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| `flood_engine.py`      | `tools/flood/flood_realify.py`（`from flood_engine import compute_flood_mask`） | 淹没掩膜/影响计算，**生成侧** |
| `precompute_levels.py` | `tools/dem-pipeline/06-restore-cut-dem.ps1` 的流水线提示                        | 251 档预计算，离线            |

其余（`main.py` / `flood.py` / `route/` / `tests/` / `Dockerfile` / `start.bat`）都是
**Web 层**，无任何离线消费者 ⇒ 与"服务可能回归"无关，故连同服务一起移除。

`flood_engine.py` 自足：只依赖 `numpy` / `affine` / `rasterio` / `scipy`，不 import 本包其他模块。

## 输入地表：一份（海陆一体优先）

`_resolve_dem_path()` 是**全项目"用哪份 DEM"的唯一解析点**（淹没演算 / 设施高程 / 剖面共用）：

1. `FLOOD_DEM_PATH`（部署与临时复算的显式覆盖口）；
2. `backend/data/flood/dem/landsea_utm48n.tif`——**海陆一体**（陆=Aster 填洼，
   海=SRTM15+ 水深，EGM96 正高，30m，gitignored，由 `tools/dem-pipeline/06-sea-mask.py`
   → `10-landsea-merge.py` 重建）；
3. 回退 `filled_utm48n_cut.tif`（陆地填洼版，海=NoData，部署环境未同步资产时不炸）。

垂直基准链：水位（理论深度基准面）− `datumOffset`（2.5，读 `backend/data/flood/waterLevel.json`
的 `baseLevels.msl`）= EGM96 正高；产物 metadata 里写 `demSource` + `demMd5`，可回指同一份输入。

海面语义（2026-10-04）：永久水体 = NoData ∪（与开海 NoData 连通的 dem<=0 分量）——
被堤坝围住的负高程塘不算海源；无负值的陆地 DEM 自动退回"只有 NoData 是海"的旧行为。

## 运行环境

三个 Python 工具（`tools/flood/flood_realify.py`、`tools/flood/rederive-terrain-profiles.py`、
`tools/dem-pipeline/07-heightmap-reslice.py`）需要一个装有 rasterio/shapely/scipy 的 venv。

**venv 仍在 `backend/algorithm-service/.venv`** —— 原因不是设计，是 venv 的可执行脚本里
烧死了绝对路径，搬动即失效。该目录已**不在版本控制内**，只承载这个 venv（新克隆时由
`tools/setup-runtime.ps1` 第 3 步按本目录的 `requirements.lock.txt` 建出来）。

```bash
# 用法示例（Windows）
backend/algorithm-service/.venv/Scripts/python.exe tools/flood/flood_realify.py
```

## 口径权威源提示

本目录的模块是若干数据产物的**生成侧口径来源**。此前 `route/graph.py`、`route/topology.py`
同时是 `tools/roads/*.sql` 的口径对照源 —— 那两个文件已随服务移除，`tools/roads/*.sql`
的注释已改为指向 git 历史（口径值本身内联在该 SQL 里）。**改这些 SQL 前先看它的注释指向。**
