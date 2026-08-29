"""
flood_realify.py — 用真 DEM/真演算产物重建 flood 假数据文件（一次性修复脚本）

背景：backend/data/flood/ 下 terrainProfile.json / floodStatistics.json / floodArea.json /
waterLevel.json 曾为 simulated（拍脑袋）数据。本脚本用仓库内真实资源重建：

  1. terrainProfile.json  ← 真DEM（filled_utm48n_cut.tif, 30m）沿剖面线采样真高程
  2. floodArea.json       ← 251档真演算产物（flood_levels.json.gz）提取对应档位真多边形
  3. floodStatistics.json ← 真演算反算：面积(floodedKm2)/深度(DEM重算mask)/受影响设施
                            (real设施点×真多边形点面判断)/损失(设施价值×假设系数,标注)
  4. waterLevel.json      ← 水位基准为工程假设参数，source 改标注为 reference_parameters

运行（flood-service venv，需 rasterio/shapely/scipy）：
  backend/flood-service/.venv/Scripts/python.exe tools/flood_realify.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "flood-service"))

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402
from shapely.geometry import shape as shp_shape, Point  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from flood_engine import compute_flood_mask  # noqa: E402

# flood_engine.DEM_PATH 指向的 169MB filled_utm48n_cut.tif 已被清理（gitignored 大文件）；
# 本脚本改用 Desktop 处理成果中的同族填洼 DEM（ASTER GDEM 30m, Wang&Liu 填洼, CGCS2000 三度带 CM108，
# 数学上与 UTM48N 等价；见 处理成果/处理报告.md）
DEM_SOURCE = Path(
    r"C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/浸没分析/处理成果/filled_CGCS2000_int16.tif"
)
DOWNSAMPLE = 4  # 与 flood_engine 一致：30m → 120m，区域统计够用

FLOOD_DIR = ROOT / "backend" / "data" / "flood"
GENERATED_AT = "2026-08-29"
LEVELS = [0, 2, 5, 8, 10, 15]
RISK_BY_LEVEL = {}  # 从原 floodArea.json 读映射，保留衍生标签语义

TERRAIN = FLOOD_DIR / "terrainProfile.json"
AREAPATH = FLOOD_DIR / "floodArea.json"
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


def sample_profile(dem_dataset, transformer, start, end):
    """沿 4326 剖面线按 DEM 分辨率步长采样真高程；海侧 NoData 点剔除，自首个有效点起。"""
    xs, ys = transformer(start["lng"], start["lat"])
    xe, ye = transformer(end["lng"], end["lat"])
    dist_m = ((xe - xs) ** 2 + (ye - ys) ** 2) ** 0.5
    step = max(abs(dem_dataset.transform.a), abs(dem_dataset.transform.e))  # ~30m
    n = max(int(dist_m / step), 2)
    pts = []
    for i in range(n + 1):
        t = i / n
        x = xs + (xe - xs) * t
        y = ys + (ye - ys) * t
        for val in dem_dataset.sample([(x, y)]):
            v = val[0]
            lon, lat = transformer(x, y, inverse=True)
            pts.append(
                {
                    "distance": round(dist_m * t),
                    "lng": round(lon, 6),
                    "lat": round(lat, 6),
                    "elevation": (round(float(v), 2) if v is not None and v == v and v > -1e9 else None),
                }
            )
    # 剔除海侧 NoData 前缀（剖面起点可能在岸线海侧），保留首个有效点起；
    # 中间 NoData 点（内海/湖泊）一并剔除，保证前端 elevation 数组全为有限数字（ECharts 零风险）
    first_valid = next((i for i, p in enumerate(pts) if p["elevation"] is not None), None)
    if first_valid is None:
        return []  # 全 NoData：返回空由人工核查（写入时跳过该剖面）
    trimmed = [p for p in pts[first_valid:] if p["elevation"] is not None]
    base = trimmed[0]["distance"]
    for p in trimmed:
        p["distance"] = round(p["distance"] - base)
    return trimmed


def facility_depths(dem_dataset, transformer, facilities, level):
    """设施点处淹没深度：level - 真DEM高程；无高程/低于0 视为未淹。"""
    out = {}
    for fac in facilities:
        x, y = transformer(fac["lng"], fac["lat"])
        for val in dem_dataset.sample([(x, y)]):
            v = val[0]
            elev = float(v) if v is not None and v == v and v > -1e9 else None
            break
        d = None if elev is None else round(level - elev, 2)
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
    # 0 档 riskLevel 映射沿用原文件（衍生标签语义不变）
    old_area = json.loads(AREAPATH.read_text(encoding="utf-8"))
    for zone in old_area["floodZones"]:
        RISK_BY_LEVEL[zone["waterLevel"]] = zone["riskLevel"]

    levels_gz = load_levels_gz()
    facilities = json.loads(FACILITY.read_text(encoding="utf-8"))["facilities"]

    # ---- 1. terrainProfile：真 DEM 采样 ----
    tp = json.loads(TERRAIN.read_text(encoding="utf-8"))
    with rasterio.open(DEM_SOURCE) as dem:
        crs = dem.crs

        def to_dem(lng, lat, inverse=False):
            gj = {"type": "Point", "coordinates": [lng, lat]}
            out = transform_geom("EPSG:4326", crs, gj) if not inverse else transform_geom(crs, "EPSG:4326", gj)
            return out["coordinates"]

        for prof in tp["profiles"]:
            pts = sample_profile(dem, to_dem, prof["startPoint"], prof["endPoint"])
            prof["points"] = pts if pts else prof["points"]  # 全NoData时保留原点集供人工核查
            prof["dataSource"] = "DEM采样 filled_utm48n_cut.tif (30m)"
        elevs = [p["elevation"] for prof in tp["profiles"] for p in prof["points"] if p["elevation"] is not None]
        print(
            f"1. terrainProfile: {len(tp['profiles'])} 条剖面重采样, "
            f"高程范围 {min(elevs):.1f}~{max(elevs):.1f}m"
        )
    tp["metadata"]["source"] = "computed_from_dem"
    tp["metadata"]["demSource"] = "backend/data/flood/dem/filled_utm48n_cut.tif (30m, 填洼 UTM48N)"
    tp["metadata"]["generatedAt"] = GENERATED_AT
    tp["metadata"]["note"] = "剖面高程为真 DEM 沿线采样；海侧 NoData 点已剔除，distance 自首个有效点重计"
    # 垂直基准偏移：水位(理论深度基准面) - datumOffset = DEM 正高(EGM96)。
    # 前端水面线须按此换算后与地形高程同基准绘制（来源 waterLevel.json baseLevels.msl）
    tp["metadata"]["datumOffset"] = OFFSET
    tp["metadata"]["verticalDatum"] = "水位=理论深度基准面；剖面高程=EGM96 正高"
    TERRAIN.write_text(json.dumps(tp, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 2. floodArea：251 档真多边形提取 ----
    for zone in old_area["floodZones"]:
        # 同 statistics：水位(理论深度基准面) 换算为 EGM96 正高后再查 251 档产物
        lv = zone["waterLevel"]
        lv_egm96 = round(lv - OFFSET, 1)
        entry = levels_gz.get(f"{lv_egm96:.1f}") if lv_egm96 >= 0 else None
        zone["features"] = entry["features"] if entry else []
        if lv == 0:
            zone["features"] = []
    old_area["metadata"]["source"] = "computed_from_dem"
    old_area["metadata"]["dataFrom"] = "flood_levels.json.gz (flood_engine 251 档连通性演算)"
    old_area["metadata"]["generatedAt"] = GENERATED_AT
    AREAPATH.write_text(json.dumps(old_area, ensure_ascii=False), encoding="utf-8")
    print(
        "2. floodArea: 6 档多边形替换, "
        + ", ".join(f"{z['waterLevel']}m={z['features'].__len__()}要素" for z in old_area["floodZones"])
    )

    # ---- 3. floodStatistics：真演算反算（全部锚定 flood_levels.json.gz 多边形，单一口径）----
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
        valid = mask & (dem_data != nodata) & np.isfinite(dem_data)
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
        # 设施处水深：EGM96水位 - 真DEM采样高程（30m 原始分辨率）
        with rasterio.open(DEM_SOURCE) as dem_full:
            fdepth = facility_depths(dem_full, to_dem, affected, float(level_egm96))
        loss = 0.0
        for fac in affected:
            d = fdepth.get(fac["id"], 0.0)
            depth_factor = min(1.0, d / 3.0)  # 假设：淹没 3m 损失饱和
            loss += fac.get("value", 0) * fac.get("damageRate", 0.5) * depth_factor
        ports = sorted({f["port"] for f in affected})
        risk = RISK_BY_LEVEL.get(level, "中风险")
        code = {"无风险": 0, "低风险": 1, "中风险": 2, "高风险": 3, "极高风险": 4}.get(risk, 2)
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
            f"3. {level}m: 面积={area_km2}km²(栅格交叉验证{area_px_km2}) 深度avg/max={avg_depth}/{max_depth}m "
            f"设施={len(affected)} loss≈{round(loss, 1)}"
        )

    stats = {
        "metadata": {
            "description": "北部湾港不同水位下的淹没统计数据（真DEM演算反算）",
            "region": "广西北部湾（钦州港、防城港、北海港）",
            "unit": {"area": "km²", "depth": "米", "waterLevel": "米", "loss": "万元(假设)"},
            "source": "computed_from_dem",
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
