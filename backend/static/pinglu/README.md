# 平陆运河 3D Tiles 资产来源与生成链

> **用途**（04 清单 A8「大资产必须标注来源、可复现」）：说明 `backend/static/pinglu/tiles/`
> 与 `backend/static/pinglu/imagery/` 下的二进制资产**从哪来、怎么生成的、怎么复现**。
> 这两处合计约 7.6 MB 且以 GLB/B3DM/JPEG 为主，Git 无法审阅其内容差异——
> 没有本文档，后续任何一次"替换瓦片"都无法判断是修复还是回归。

## 一、资产清单

| 目录 | 内容 | 数量 | 体积 |
| --- | --- | --- | --- |
| `tiles/` | 瓦片模型 | 64 文件 = 31 GLB + 31 B3DM + `tileset.json` + `tileset-b3dm.json` | ≈ 7.6 MB |
| `imagery/` | 离线影像块 + 索引 | `imagery.json` + 3 JPEG（马道/企石/青年） | ≈ 2.3 MB |

瓦片集结构（`tileset.json`，实测）：

```
root（纯容器，无 content）
├─ 马道枢纽      6 个内容节点（低模自身 + 5 个分区子瓦片）
├─ 企石枢纽      6 个内容节点（低模自身 + 5 个分区子瓦片）
├─ 青年枢纽      5 个内容节点（低模自身 + 4 个分区子瓦片）
├─ bridges-mid / bridges-up / bridges-urban     各 1（extras.kind = corridor）
└─ corridor-00 … corridor-10                   各 1（extras.kind = corridor）
                                               ─────
                                       合计    31 个内容节点
```

## 二、来源

**唯一来源**：`平陆运河3DTiles交付_20260921/07-闸室归位版/models/tiles/`
（本机路径 `C:/Users/JionHappY/Desktop/平陆运河3DTiles交付_20260921/`）。

选定 `07-闸室归位版` 而非 `01-真实中线版` 等其它版本，因为它同时满足：

1. **逐顶点椭球曲率烘焙**（`asset.generator` 含 `WGS84 baked curvature`）——
   所有瓦片共用根变换，块间接缝误差 0.00 m。早先版本用「每块各挂锚点」的
   per-tile anchor fix，块间存在真实错位（这正是 web 端模型看起来"歪"的根因）。
2. **31 个内容节点齐全**——含 3 个枢纽低模、15 个分区子瓦片、11 个 corridor-*、3 个 bridges-*。
3. **闸室（ZL）归位**——`qingnian-z3-lock.glb` 等锁定件已按 ZL 归位量修正
   （实测 Δz 均值 −79.33 m，含 −238.000 整数值）。

### 与 07 交付版的核对结果

2026-09-21 逐字节比对（`cmp`）：**63/64 文件逐字节相同**；唯一不同的
`tileset.json` 经 JSON 规范化后**内容完全等价**（差异仅为空白/键序），
`asset` 段、`root.children` 数量、全部字段值一致。

> 复现命令：
> ```bash
> SRC=".../07-闸室归位版/models/tiles"; DST="backend/static/pinglu/tiles"
> for f in "$SRC"/*; do cmp -s "$f" "$DST/$(basename "$f")" || echo "DIFF: $(basename "$f")"; done
> ```

## 三、生成链（可复现）

资产由**生成机**（非本机）产出，脚本在交付包 `03-脚本与数据/` 内：

```
原始建模数据
  → build_models.py      产出各枢纽/走廊的 GLB（含分区拆分）
  → bake_wgs84.py        逐顶点椭球曲率烘焙（统一根变换，消除块间错位）
  → build_tiles.py       装配 tileset.json（写 extras.name / extras.kind、BV z-up）
  → make_b3dm.py         由 GLB 转 B3DM（3D Tiles 1.0 兼容路径）
```

产物双份：`*.glb` 供需 glTF 的消费方，`*.b3dm` 供 Cesium 3D Tiles 1.0 路径。
两份 `tileset.json` / `tileset-b3dm.json` 分别引用两种格式，内容节点数均为 31。

> ⚠ **重烘提示**：本项目已有一次「用旧模板 `tileset-hubs.json` 覆盖新产物导致索引
> 失真（31 → 17 节点）」的事故。任何重生成后**必须**跑 `npm run guard:v3`，
> 其中 `tiles3d-check` 会对内容节点数（下限 31）、31 项必需内容、`generator` 标记
> （须含 `WGS84 baked curvature`）三方面做校验——这是该事故留下的阳性对照。

## 四、影像块（imagery/）

| 文件 | 说明 |
| --- | --- |
| `imagery.json` | 索引：每块的 `name` / `label` / `file` / 宽高 / `bbox` |
| `madao.jpg` / `qishi.jpg` / `qingnian.jpg` | z=17 单张拼接影像，覆盖对应枢纽 |

`bbox` 为 `[west, south, east, north]`，坐标系 EPSG:4326（CGCS2000）。
影像由交付包 `03-脚本与数据/` 的提取脚本从离线瓦片拼接产出，与 3D Tiles
同源同坐标系——前端同时挂载二者，用于对照核验模型落位。

## 五、门禁

`tools/v3-guard/tiles3d-check.mjs`（已注册进 `guard:v3`，共 10 项不短路）守护本资产：

- 内容节点数 ≥ 31；
- 31 项必需内容逐一在册（3 枢纽低模 + 15 分区 + 11 corridor + 3 bridges，或等价清单）；
- `asset.generator` 必须含 `WGS84 baked curvature`（防退化为 per-tile anchor fix）；
- GLB 与 B3DM 两套 tileset 的内容节点数须一致。

单测 `tools/v3-guard/__tests__/tiles3d-check.test.mjs` 含**阳性对照**：
对真实事故归档（17 节点版）能报出"内容节点不足 / 缺必需内容 / generator 退化"三类问题，
对修复后版本报 0 问题——证明该守卫真的会变红，而非恒绿摆设。
