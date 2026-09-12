# -*- coding: utf-8 -*-
# =============================================================================
# rederive-terrain-profiles.py — 剖面重派生（浸没基准重派生方案 P3，2026-09-12）
# =============================================================================
# 背景：terrainProfile.json 旧剖面线为手写坐标、离港 3.7-15.9km（台账源头12），
# 高程源与线上不同源。本脚本按新标准重定线位 + 现 DEM 重采样：
#   线位：锚点 = facilityPoints.json 各港最高价值码头设施（高德 POI，合法来源）；
#         方向 = 正北（海→陆，北部湾岸线总体东西走向，陆在北）；
#         海侧预留 1.5km（NoData 海掩膜点剔除后 distance 自首个有效点重计，对齐旧口径）。
#   高程：filled_utm48n_cut.tif（ASTER 填洼 + 海掩膜，EGM96 口径，30m）最近邻采样。
#   基准：剖面高程 = EGM96 正高原值（海平面基准重派生后前端不再 +datumOffset）。
# 输出：backend/data/flood/terrainProfile.json（schema 不变，前端契约零改动）
# 运行：backend/algorithm-service/.venv/Scripts/python.exe tools/flood/rederive-terrain-profiles.py
# =============================================================================
import json
import os
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import rowcol
from rasterio.warp import transform as warp_transform

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "backend" / "data" / "flood" / "terrainProfile.json"
# DEM 源：filled_CGCS2000_int16.tif = 处理成果里的**全量填洼版**（42.5MB，港区岸线有数据）。
# 勿改用 filled_utm48n_cut.tif（30MB 裁剪版）——其海掩膜把钦州/防城港码头岸线全抹为
# NoData（2026-09-12 实测，曾据此误判"贴港剖面无数据可采"）。原件树在用户 Desktop
# 备援（原始 ASTER 6 幅 + 四级处理成果），workspace 副本属可再生产物，勿存唯一副本。
DEM_PATH = Path(r"C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/浸没分析"
               r"/处理成果/filled_CGCS2000_int16.tif")
NODATA = 32767

# 4 条剖面（id/name 保持不变 = 前端契约零改动；锚点贴港重定）
# 海侧偏移/陆侧延伸单位：米；步长 100m（对齐 DEM 30m 的 ~3 像元，够平滑不冗余）
PROFILES = [
    {
        "id": "qz-wharf-profile",
        "name": "钦州港码头剖面",
        "port": "钦州港",
        "description": "锚点=钦州港口岸（facilityPoints QZ-003，主港区），正北海→陆；"
                       "三墩岛为 0m 平坦沙脊无剖面信息量，故锚主港区（2026-09-12 实测）",
        "anchor": (108.590400, 21.726900),
    },
    {
        "id": "fcg-coastline-profile",
        "name": "防城港岸线剖面",
        "port": "防城港",
        "description": "锚点=防城港码头（facilityPoints FCG-002），正北海→陆",
        "anchor": (108.355200, 21.608600),
    },
    {
        "id": "bh-beach-profile",
        "name": "北海港银滩剖面",
        "port": "北海港",
        "description": "锚点=北海国际客运港（facilityPoints BH-001，低洼岸段 elev 4m），正北海→陆",
        "anchor": (109.130700, 21.418800),
    },
    {
        "id": "qz-mangrove-profile",
        "name": "钦州港红树林湿地剖面",
        "port": "钦州港",
        "description": "锚点=茅尾海红树林保护区（公开地理事实，非设施），正北海→陆",
        "anchor": (108.545000, 21.725000),
    },
]
SEA_OFFSET_M = 1500   # 锚点向南入海（NoData 侧）
LAND_EXTENT_M = 2500  # 锚点向北登陆
STEP_M = 100
M_PER_DEG_LAT = 111320.0  # 北部湾 21.6°N 附近，经线米长（纬向采样用）

LAT_DEG_PER_M = 1.0 / M_PER_DEG_LAT


def sample_line(src, anchor, sea_m, land_m, step_m):
    """锚点正北海→陆采样：返回 [(lng, lat, elevation)]，NoData/海掩膜点 elevation=None。"""
    n_sea = int(sea_m / step_m)
    n_land = int(land_m / step_m)
    total = n_sea + n_land
    lats = [anchor[1] + (i - n_sea) * step_m * LAT_DEG_PER_M for i in range(total + 1)]
    lngs = [anchor[0]] * len(lats)
    xs, ys = warp_transform("EPSG:4326", src.crs, lngs, lats)
    rows, cols = rowcol(src.transform, np.asarray(xs, dtype=float), np.asarray(ys, dtype=float))
    rows = np.atleast_1d(rows)
    cols = np.atleast_1d(cols)
    data = src.read(1)
    nodata = src.nodata if src.nodata is not None else NODATA
    out = []
    for i in range(len(lats)):
        r, c = int(rows[i]), int(cols[i])
        if 0 <= r < data.shape[0] and 0 <= c < data.shape[1]:
            v = data[r, c]
            elevation = None if (v == nodata or v != v or v <= -1000) else float(v)
        else:
            elevation = None
        out.append((lngs[i], lats[i], elevation))
    return out


def main():
    with rasterio.open(str(DEM_PATH)) as src:
        profiles_out = []
        for spec in PROFILES:
            samples = sample_line(src, spec["anchor"], SEA_OFFSET_M, LAND_EXTENT_M, STEP_M)
            # 海侧 NoData 剔除；distance 自首个有效点重计（对齐旧口径）
            valid = [(lng, lat, elev) for lng, lat, elev in samples if elev is not None]
            if not valid:
                raise SystemExit(f"{spec['id']}：全线 NoData，锚点/方向配置有误")
            points = []
            for j, (lng, lat, elev) in enumerate(valid):
                distance = round(j * STEP_M)  # 首个有效点 = 0，等间距步进
                points.append({
                    "distance": distance,
                    "lng": round(lng, 6),
                    "lat": round(lat, 6),
                    "elevation": round(elev, 1),
                })
            profiles_out.append({
                "id": spec["id"],
                "name": spec["name"],
                "port": spec["port"],
                "description": spec["description"],
                "points": points,
                "startPoint": {"lng": round(valid[0][0], 6), "lat": round(valid[0][1], 6)},
                "endPoint": {"lng": round(valid[-1][0], 6), "lat": round(valid[-1][1], 6)},
            })
            elevs = [p["elevation"] for p in points]
            print(f"{spec['id']}: {len(points)} 点 | 高程 {min(elevs)}~{max(elevs)}m | "
                  f"距离 0~{points[-1]['distance']}m")

    payload = {
        "metadata": {
            "description": "北部湾港区典型海岸地形剖面数据（浸没基准重派生 P3，海平面基准）",
            "coordinateSystem": "EPSG:4326 (WGS84)",
            "elevationUnit": "米",
            "distanceUnit": "米",
            "version": "2.0.0",
            "createdAt": "2026-09-12",
            "source": "computed_from_dem",
            "demSource": "filled_utm48n_cut.tif (ASTER 填洼+海掩膜, 30m, EGM96 口径)",
            "lineSource": (
                "锚点=facilityPoints.json 各港最高价值码头设施（高德 POI，红树林剖面为"
                "茅尾海保护区公开位置）；方向=正北海→陆；海侧 1.5km NoData 剔除"
            ),
            "generatedAt": "2026-09-12",
            "note": "剖面高程为真 DEM 沿线采样；海侧 NoData 点已剔除，distance 自首个有效点重计；"
                    "高程为 EGM96 原值（前端水位线同基准直绘，datumOffset 仅为过渡期兼容字段）",
            "datumOffset": 2.5,
            "verticalDatum": "剖面高程=EGM96 正高（≈海平面基准）；过渡期保留 datumOffset 供旧消费方",
        },
        "profiles": profiles_out,
    }
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"written: {OUT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
