"""
flood_realify.py — 用真 DEM/真演算产物重建 flood 假数据文件（一次性修复脚本）

背景：backend/data/flood/ 下 terrainProfile.json / floodStatistics.json / floodArea.json /
waterLevel.json 曾为 simulated（拍脑袋）数据。本脚本用仓库内真实资源重建：

  1. floodStatistics.json ← 真演算反算：面积(floodedKm2)/深度(DEM重算mask)/受影响设施
                            (real设施点×真多边形点面判断)/损失(设施价值×假设系数,标注)
  2. facilityPoints.json  ← 设施高程 5x5 窗口最小值重采样（与统计同口径）
  3. waterLevel.json      ← 水位基准为工程假设参数，source 改标注为 reference_parameters

不再写出的两件（2026-10-04 收口，避免"一个事实两个写入方"）：
  · floodArea.json —— 读侧已于 z154（2026-09-12）改接 PostGIS flood_levels（251 档）而下线，
    后端注释即声明（backend/src/modules/flood/services/flood.service.ts:53）。本脚本继续写它
    只会复活一个已废弃产物，故删除该步；风险等级改由权威分段表派生（见 risk_label）。
  · terrainProfile.json —— 唯一写入方是 tools/flood/rederive-terrain-profiles.py（P3 于
    2026-09-12 接手：锚点/线位/元数据都在那边，本脚本的旧采样口径已被取代）。

运行（生成侧 venv，需 rasterio/shapely/scipy）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/flood/flood_realify.py
  （venv 仍在原路径：`backend/algorithm-service/` 已随 FastAPI 移除、不再受版本控制，
    但 venv 是未追踪目录且绝对路径烧死，故原地保留；重建见 tools/setup-runtime.ps1）
"""
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# 生成侧计算引擎（FastAPI 层已于 2026-09-26 移除，flood_engine 是离线复用模块）
sys.path.insert(0, str(ROOT / "tools" / "flood" / "engine"))

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402
from shapely.geometry import shape as shp_shape, Point  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from flood_engine import compute_flood_mask  # noqa: E402
from flood_engine import DEM_PATH as ENGINE_DEM_PATH  # noqa: E402

# 2026-08-30 全链路重算口径：DEM 源复用 flood_engine 的多级回退解析
# （FLOOD_DEM_PATH > workspace dem/ > Desktop 处理成果），与 online 服务同链同口径。
# 最终链 = ASTER 填洼版 + 海岸线矢量海掩膜（见 dem-pipeline/06-restore-cut-dem.ps1）：
# ASTER 沿海低地真实但海面整 0 值，掩膜后海面干净；GLO-30 因沿海偏高 12~30m 弃用。
DEM_SOURCE = ENGINE_DEM_PATH
DOWNSAMPLE = 1  # 与 flood_engine 同步：30m 全分辨率（2026-08-30 起）

FLOOD_DIR = ROOT / "backend" / "data" / "flood"


def _dem_identity(path: Path) -> tuple[str, str]:
    """DEM 溯源（04-B10：产物自述必须能在运行侧指到同一份输入）。

    返回 (人读标签, md5)。缺失即抛——无 DEM 的"重算"只会产出假产物。
    """
    import hashlib

    digest = hashlib.md5(path.read_bytes()).hexdigest()
    merged = "landsea" in path.name
    label = (
        f"{path.name}（海陆一体 ASTER GDEM 填洼 + SRTM15+ 水深，EGM96 正高，30m）"
        if merged
        else f"{path.name}（陆地填洼版，海=NoData，EGM96 正高，30m）"
    )
    return label, digest


DEM_LABEL, DEM_MD5 = _dem_identity(DEM_SOURCE)
# 生成时写入（原为硬编码 "2026-08-30"）：戳记必须是**本次生成日**——写死会让数据自述随时间
# 失真（实测 facilityPoints.json 的 updatedAt 落后其内容改动 10 天），且与
# backend/test/data-freshness.spec.ts 的「戳记 vs git 改动日」核对直接冲突
GENERATED_AT = datetime.date.today().isoformat()
LEVELS = [0, 2, 5, 8, 10, 15]
# 权威风险码表（与 backend/src/common/constants/flood.constants.ts 的 RISK_LEVEL_BANDS 同序）。
# 原实现把「标签→码」写成带默认值的 dict.get(risk, 2)，即未知标签静默变 code 2（中风险）——
# d057 记录的「15m 档标签=灾难级、码=2」正是它造成的第三源。
RISK_CODE = {"无风险": 0, "低风险": 1, "中风险": 2, "高风险": 3, "极高风险": 4, "灾难级": 5}

# 权威风险分段：与 backend/src/common/constants/flood.constants.ts 的 RISK_LEVEL_BANDS 同界同序
#（上界 0 / 2 / 4.3 / 6 / 8 / ∞）。生成侧此前只沿用 floodArea.json 里的历史标签，那份标签与
# 运行侧派生值不同步（5m 写中风险、8m/10m 各错一档）⇒ 同一份数据两套口径。现在生成前先对账：
# floodArea.json 已于 z154 退出仓库，本表成为唯一来源（标签→码只此一处）。
RISK_BANDS = [
    (0, "无风险"),
    (2, "低风险"),
    (4.3, "中风险"),
    (6, "高风险"),
    (8, "极高风险"),
    (float("inf"), "灾难级"),
]


def authoritative_risk(level: float) -> str:
    """按水位派生风险标签（与运行侧 deriveRiskLevel 同界）。"""
    for max_level, label in RISK_BANDS:
        if level <= max_level:
            return label
    return RISK_BANDS[-1][1]


def risk_label(level: float) -> str:
    """档位 → 风险标签（唯一来源 = RISK_BANDS；floodArea.json 已随 z154 下线）。

    d057 的复现条件是「6 档全写同一个码」：只要这里与 RISK_BANDS 脱钩（硬编码/兜底），
    码就会撞值。下面这条断言把它钉死在同一次调用里——不依赖任何外部文件。
    """
    label = authoritative_risk(level)
    if label not in RISK_CODE:
        raise SystemExit(f"启动失败：权威分段产出未知标签「{label}」—— 先裁决归属再重跑。")
    return label


STATS_PATH = FLOOD_DIR / "floodStatistics.json"
WL_PATH = FLOOD_DIR / "waterLevel.json"
LEVELS_GZ = FLOOD_DIR / "flood_levels.json.gz"
FACILITY = FLOOD_DIR / "facilityPoints.json"


def load_levels_gz():
    import gzip

    with gzip.open(LEVELS_GZ, "rt", encoding="utf-8") as f:
        return json.load(f)


def datum_offset():
    """
    垂直基准换算：水位（理论深度基准面）→ DEM 正高（EGM96 / 平均海平面）。

    waterLevel.json 中 verticalDatum='理论深度基准面'，baseLevels 给出
    msl(平均海平面)=2.5m —— 即"水位 H"对应的 EGM96 正高为 H - 2.5。
    基准偏移量从该文件的 baseLevels 读取（单一数据源），不另行硬编码。
    """
    wl = json.loads(WL_PATH.read_text(encoding="utf-8"))
    msl = next((b["height"] for b in wl.get("baseLevels", []) if b.get("id") == "msl"), None)
    if msl is None:
        raise RuntimeError("waterLevel.json 缺少 baseLevels.msl，无法确定垂直基准偏移")
    return float(msl)


FACILITY_WINDOW_RADII = (2, 5, 10, 20)  # ±60m → ±600m，逐级外扩找陆地点


def resample_facility_elevations(dem_dataset, transformer, facilities):
    """设施高程重采样：从 5x5（±60m）起逐级外扩，取窗口内**陆地像元**（>0）的最小高程。

    承 dem-pipeline/05 口径：港口设施建在填海区低地，单像元采样含周围高地偏高，
    局部最小值更接近设施实际高程。

    2026-10-04（换海陆一体 DEM 的收口）：海侧不再是 NoData 而是真实水深负值，
    直接把窗口最小值当高程会取到**海底**——实测出现 elevation=-6.0m 的码头设施，
    运行侧 `depth = max(0, level - elevation)` 会把水深算成 +6m 的额外淹没。
    故只在 >0 的陆地像元里取最小，并逐级外扩（港区码头窄、掩膜会盖住点位本身）。
    该半径内仍无正高程者记 **0.0**（港区填海面）：这不是"编一个值"，而是**旧口径的等价取值**——
    换 DEM 前海侧是 NoData、窗口跳过 NoData 后剩下的邻居正是 ASTER 在这个面上的**整 0 读数**
    （2026-10-04 实测 20/83 个设施的 ASTER 5x5 窗口值集恰为 {0}）；换成海陆一体 DEM 后
    这些 0 被填成了水深，直接取最小值才变成负高程。故 0.0 = 该面上唯一可得的地面读数。

    为什么会有"整窗无陆地"：ASTER 在钦州港/防城港/铁山港填海面上读**整 0**
    （2026-10-04 实测 28/83 个设施、ASTER 原件窗口值集 {0}），属源头分辨率/水体污染缺陷，
    已在《陆海DEM高程数据需求-2026-09-27.md》§一/§四列为换源理由。
    """
    import rasterio.windows as riowin

    t = dem_dataset.transform
    nodata = dem_dataset.nodata
    changed = 0
    flat_zero: list[str] = []
    for fac in facilities:
        x, y = transformer(fac["lng"], fac["lat"])
        col, row = (int(v) for v in (~t * (x, y)))
        best = None
        for r in FACILITY_WINDOW_RADII:
            arr = dem_dataset.read(1, window=riowin.Window(col - r, row - r, 2 * r + 1, 2 * r + 1))
            land_vals = [
                float(v)
                for v in arr.flatten()
                if v is not None and float(v) != nodata and float(v) > 0
            ]
            if land_vals:
                best = min(land_vals)
                break
        if best is None:
            fac["elevation"] = 0.0
            flat_zero.append(fac["id"])
        else:
            fac["elevation"] = round(best, 1)
            changed += 1
    return changed, flat_zero


def facility_depths(facilities, level):
    """设施点处淹没深度：level(EGM96) - 重采样高程；无高程/低于0 视为未淹。"""
    out = {}
    for fac in facilities:
        elev = fac.get("elevation")
        d = None if elev is None else round(level - float(elev), 2)
        out[fac["id"]] = d if (d is not None and d > 0) else 0.0
    return out


def load_dem_ds(downsample=DOWNSAMPLE):
    """自读填洼 DEM（降采样 4x，与 flood_engine.load_dem 同逻辑），返回 (data, nodata, transform, crs)。"""
    with rasterio.open(DEM_SOURCE) as src:
        out_shape = (src.height // downsample, src.width // downsample)
        data = src.read(1, out_shape=out_shape)
        sx = src.width / out_shape[1]
        sy = src.height / out_shape[0]
        transform = src.transform * Affine.scale(sx, sy)
        nodata = src.nodata
        crs = src.crs
    return data, nodata, transform, crs


def main():
    print("=== flood 真数据重建 ===")
    OFFSET = datum_offset()
    print(f"垂直基准：水位(理论深度基准面) - {OFFSET}m = DEM 正高(EGM96/平均海平面)")

    # ---- 0. riskLevel 映射先取（W20）：本步骤之后的每一步都会写盘，
    #      映射缺失必须在**任何写盘之前**拦下（原实现把它散在 stats 循环的 dict 默认值里）
    RISK_BY_LEVEL = {lv: risk_label(lv) for lv in LEVELS}
    codes = {RISK_BY_LEVEL[lv] for lv in LEVELS}
    if len({RISK_CODE[c] for c in codes}) != len(codes):
        raise SystemExit(f"启动失败：档位→码撞值（{RISK_BY_LEVEL}）—— d057 的判据即被此抹平。")
    print(f"0. riskLevel 映射：{sorted(RISK_BY_LEVEL.items())}（源 RISK_BANDS 派生，无外部文件）")

    levels_gz = load_levels_gz()
    facilities = json.loads(FACILITY.read_text(encoding="utf-8"))["facilities"]

    # ---- 1. 设施高程重采样（5x5 窗口最小值，先于统计，水深/损失同口径）----
    with rasterio.open(DEM_SOURCE) as dem:
        crs = dem.crs

        def to_dem(lng, lat, inverse=False):
            gj = {"type": "Point", "coordinates": [lng, lat]}
            out = transform_geom("EPSG:4326", crs, gj) if not inverse else transform_geom(crs, "EPSG:4326", gj)
            return out["coordinates"]

        fac_data = json.loads(FACILITY.read_text(encoding="utf-8"))
        n_changed, flat_zero = resample_facility_elevations(dem, to_dem, fac_data["facilities"])
        fac_data["metadata"]["updatedAt"] = GENERATED_AT
        fac_data["metadata"]["elevationFrom"] = f"{DEM_LABEL} 5x5 窗口最小值采样（承 05 脚本口径）"
        fac_data["metadata"]["demMd5"] = DEM_MD5
        fac_data["metadata"]["elevationFlatZero"] = {
            "count": len(flat_zero),
            "ids": flat_zero,
            "reason": (
                "±600m 窗口内无 >0 陆地像元（ASTER 在港区填海面上读整 0，实测窗口值集 {0}）——"
                "取 0m = 该面唯一可得地面读数，与旧口径「跳过 NoData 后取最小值」等价；"
                "待《陆海DEM高程数据需求》换源后重派生"
            ),
        }
        FACILITY.write_text(json.dumps(fac_data, ensure_ascii=False, indent=2), encoding="utf-8")
        facilities = fac_data["facilities"]
        elevs_fac = [f["elevation"] for f in facilities if f.get("elevation") is not None]
        print(
            f"1. facilityPoints: {n_changed} 个设施高程重采样, "
            f"范围 {min(elevs_fac):.1f}~{max(elevs_fac):.1f}m"
            f"{f', 其中 {len(flat_zero)} 个取填海面 0m（窗口无正高程）' if flat_zero else ''}"
            f" | DEM={DEM_LABEL} md5={DEM_MD5[:8]}"
        )

    # ---- 2. floodStatistics：真演算反算（全部锚定 flood_levels.json.gz 多边形，单一口径）----
    from rasterio.features import rasterize as rio_rasterize

    dem_data, nodata, transform, crs3 = load_dem_ds()
    px_area_km2 = abs(transform.a * transform.e) / 1e6  # 降采样后像元面积
    stats_out = []
    for level in LEVELS:
        if level == 0:
            stats_out.append(
                {
                    "waterLevel": 0,
                    "riskLevel": "无风险",
                    "riskLevelCode": 0,
                    "floodArea": 0,
                    "averageDepth": 0,
                    "maxDepth": 0,
                    "affectedFacilityCount": 0,
                    "affectedPorts": [],
                    "estimatedLoss": 0,
                    "description": "正常潮位，无淹没风险",
                }
            )
            continue
        # 垂直基准换算：水位(理论深度基准面) → EGM96 正高，再查 251 档产物
        # （产物按 dem<=level 演算，dem 为 EGM96 正高，故档位键语义即 EGM96 水位）
        level_egm96 = round(level - OFFSET, 1)
        entry = levels_gz.get(f"{level_egm96:.1f}") if level_egm96 >= 0 else None
        feats = entry["features"] if entry else []
        # 产物多边形为 EPSG:4326，需先变换到 DEM 网格 CRS（CGCS2000 三度带米制）再栅格化
        geoms = []
        for f in feats:
            try:
                geoms.append((shp_shape(transform_geom("EPSG:4326", crs3, f["geometry"])), 1))
            except Exception as exc:  # 单点变换失败不阻断，跳过并记录
                print(f"   [warn] {level}m 要素变换失败: {str(exc)[:60]}")
        mask = (
            rio_rasterize(
                geoms,
                out_shape=dem_data.shape,
                transform=transform,
                fill=0,
                dtype="uint8",
            ).astype(bool)
            if geoms
            else np.zeros(dem_data.shape, dtype=bool)
        )
        # 面积以产物 floodedKm2 为权威（多边形精确面积）；栅格化像元和仅作交叉验证
        area_px_km2 = round(int(mask.sum()) * px_area_km2, 2)
        area_km2 = entry["floodedKm2"] if entry else 0
        # 水深域必须与面积同域：面积出自 flood_engine 的连通 mask（dem<=level 且与永久水体连通、
        # 且 dem>0），而上面栅格化的多边形带 300m 简化容差、会把沿岸高地吞进来 ——
        # 在高地像元上 depth = level - dem < 0，直接拉出**负的平均水深**
        # （2026-10-04 实测 8m 档 -3.88m、10m 档 -2.13m）。故水深改在引擎 mask 上算，
        # 多边形栅格化只保留作面积交叉验证。
        mask_true = compute_flood_mask(dem_data, nodata, level_egm96) & (dem_data > 0.0)
        valid = mask_true & (dem_data != nodata) & np.isfinite(dem_data)
        depth = np.where(valid, level_egm96 - dem_data, np.nan)
        px_v = int(valid.sum())
        avg_depth = round(float(np.nanmean(depth)), 2) if px_v else 0
        max_depth = round(float(np.nanmax(depth)), 2) if px_v else 0

        # 受影响设施：设施点落在该档真淹没多边形内（flood_levels 4326 多边形）
        affected = []
        if entry and entry["features"]:
            polys = unary_union([shp_shape(f["geometry"]) for f in entry["features"]])
            for fac in facilities:
                pt = Point(fac["lng"], fac["lat"])
                if polys.covers(pt):
                    affected.append(fac)
        # 设施处水深：EGM96水位 - 重采样高程（5x5 窗口最小值，与 facilityPoints 同口径）
        fdepth = facility_depths(affected, float(level_egm96))
        loss = 0.0
        for fac in affected:
            d = fdepth.get(fac["id"], 0.0)
            depth_factor = min(1.0, d / 3.0)  # 假设：淹没 3m 损失饱和
            loss += fac.get("value", 0) * fac.get("damageRate", 0.5) * depth_factor
        ports = sorted({f["port"] for f in affected})
        # 映射与码表都由 load_area_with_risk 前置校验过（缺档/未知标签已在写盘前拦下），
        # 此处直接取值；不再写 `.get(x, "中风险")` / `.get(risk, 2)` 这类静默兜底
        risk = RISK_BY_LEVEL[level]
        code = RISK_CODE[risk]
        stats_out.append(
            {
                "waterLevel": level,
                "riskLevel": risk,
                "riskLevelCode": code,
                "floodArea": area_km2,
                "averageDepth": avg_depth,
                "maxDepth": max_depth,
                "affectedFacilityCount": len(affected),
                "affectedPorts": ports,
                "estimatedLoss": round(loss, 1),
                "description": f"水位 {level}m（理论深度基准面，= EGM96 {level_egm96}m）真DEM连通性演算：淹没 {area_km2}km²，"
                f"平均水深 {avg_depth}m，受影响设施 {len(affected)} 处",
            }
        )
        print(
            f"2. {level}m: 面积={area_km2}km²(栅格交叉验证{area_px_km2}) "
            f"深度avg/max={avg_depth}/{max_depth}m 设施={len(affected)} loss≈{round(loss, 1)}"
        )

    stats = {
        "metadata": {
            "description": "北部湾港不同水位下的淹没统计数据（真DEM演算反算）",
            "region": "广西北部湾（钦州港、防城港、北海港）",
            "unit": {"area": "km²", "depth": "米", "waterLevel": "米", "loss": "万元(假设)"},
            "source": "computed_from_dem",
            "demSource": DEM_LABEL,
            "demMd5": DEM_MD5,
            "areaFrom": "flood_levels.json.gz / 现算 mask 像元统计",
            "facilityFrom": "facilityPoints.json (高德POI实抓) × 真淹没多边形点面判断",
            "lossAssumption": "estimatedLoss=Σ 设施价值×损伤率×水深因子(min(d/3,1))，系数为情景假设非实测",
            "generatedAt": GENERATED_AT,
        },
        "statistics": stats_out,
    }
    STATS_PATH.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 4. waterLevel：标注为工程假设参数 ----
    wl = json.loads(WL_PATH.read_text(encoding="utf-8"))
    wl["metadata"]["source"] = "reference_parameters"
    wl["metadata"]["note"] = "水位基准（平均海平面/设计高潮位等）为工程参考假设参数，未接实测潮位站"
    WL_PATH.write_text(json.dumps(wl, ensure_ascii=False, indent=2), encoding="utf-8")
    print("4. waterLevel: source → reference_parameters")

    print("=== 完成 ===")


if __name__ == "__main__":
    main()
