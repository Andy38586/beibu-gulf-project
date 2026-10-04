# -*- coding: utf-8 -*-
# =============================================================================
# rederive-terrain-profiles.py — 剖面重派生（浸没基准重派生方案 P3，2026-09-12）
# =============================================================================
# 背景：terrainProfile.json 旧剖面线为手写坐标、离港 3.7-15.9km（台账源头12），
# 高程源与线上不同源。本脚本按新标准重定线位 + 现 DEM 重采样：
#   线位：锚点 = facilityPoints.json 各港最高价值码头设施（高德 POI，合法来源）；
#         方向 = 正北（海→陆，北部湾岸线总体东西走向，陆在北）；
#         海侧预留 1.5km（海侧水深点剔除后 distance 自首个陆地点重计，对齐旧口径）。
#   高程：与淹没演算同一条解析链（海陆一体优先；见 DEM_PATH）最近邻采样。
#   基准：剖面高程 = EGM96 正高原值（海平面基准重派生后前端不再 +datumOffset）。
# 输出：backend/data/flood/terrainProfile.json（schema 不变，前端契约零改动）
# 运行：backend/algorithm-service/.venv/Scripts/python.exe tools/flood/rederive-terrain-profiles.py
#       （venv 路径未变；该目录已随 FastAPI 移除、不再受版本控制）
# =============================================================================
import json
import os
import sys
import datetime
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import rowcol
from rasterio.warp import transform as warp_transform

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "backend" / "data" / "flood" / "terrainProfile.json"
# DEM 源：与淹没演算同一条解析链（海陆一体优先，回退陆地填洼版）——**一份地表，三处共用**
# （淹没演算 / 设施高程 / 剖面）。2026-10-04 前本脚本直读未掩膜的 ASTER 全量版：
# 那是被 06-sea-mask.py「逐列取最北顶点」缺陷逼出来的绕行——该缺陷会把河口/内湾列的
# 陆地整列置 NoData（域内 1139.8 km²，含钦州/防城港码头岸线），2026-09-12 据此误判
# "贴港剖面无数据可采"。缺陷已在 06-sea-mask.py 修正（加测深源确认），绕行随之撤销。
sys.path.insert(0, str(ROOT / "tools" / "flood" / "engine"))
from flood_engine import DEM_PATH  # noqa: E402

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


def dem_identity(path):
    """(人读标签, md5)：产物自述必须能指到同一份输入（04-B10）。"""
    import hashlib

    merged = "landsea" in path.name
    label = (
        f"{path.name}（海陆一体 ASTER GDEM 填洼 + SRTM15+ 水深，EGM96 正高，30m）"
        if merged
        else f"{path.name}（陆地填洼版，海=NoData，EGM96 正高，30m）"
    )
    return label, hashlib.md5(path.read_bytes()).hexdigest()


def main():
    dem_label, dem_md5 = dem_identity(DEM_PATH)
    with rasterio.open(str(DEM_PATH)) as src:
        profiles_out = []
        for spec in PROFILES:
            samples = sample_line(src, spec["anchor"], SEA_OFFSET_M, LAND_EXTENT_M, STEP_M)
            # 海侧剔除 + distance 自首个**陆地**点重计（对齐旧口径）。
            # 判据自 2026-10-04 起为 elev > 0：海陆一体 DEM 的海侧是真实水深（负值）而不再是
            # NoData，「首个有效点」会落在海里、把剖面拖进海面（前端水位线也随之移位）。
            valid = [(lng, lat, elev) for lng, lat, elev in samples if elev is not None]
            land_start = next((i for i, t in enumerate(valid) if t[2] > 0), None)
            if land_start is None:
                raise SystemExit(f"{spec['id']}：全线无陆地（elev>0），锚点/方向配置有误")
            valid = valid[land_start:]
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
            "demSource": dem_label,
            "demMd5": dem_md5,
            "lineSource": (
                "锚点=facilityPoints.json 各港最高价值码头设施（高德 POI，红树林剖面为"
                "茅尾海保护区公开位置）；方向=正北海→陆；海侧 1.5km 内水深点剔除（起点=首个陆地点）"
            ),
            # 戳记必须写**本次生成日**（backend/test/data-freshness.spec.ts 判「戳记不得早于
            # 文件最后一次 git 改动日」；写死会让每次重派生都过不了该守卫）
            "generatedAt": datetime.date.today().isoformat(),
            "note": "剖面高程为真 DEM 沿线采样；**起点=首个陆地点**（海侧水深点已剔除），distance 自该点重计；"
                    "沿线潮沟/内湾等真实水域点保留原值（可为负，不再拿 NoData 当海）；"
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
