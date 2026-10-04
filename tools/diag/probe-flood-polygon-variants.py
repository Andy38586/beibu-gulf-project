"""probe-flood-polygon-variants.py — 档位几何的三个变体对比（只读，不改产物、不入库）。

## 为什么有这支探针（2026-10-04 实测）

`tools/flood/engine/flood_engine.py:mask_to_geojson` 想"只填 <0.25km² 的小内环、保留大洞
（海湾/大湖）"，但判据写的是 `abs(ring.area) >= 250_000`：

    >>> from shapely.geometry import LinearRing
    >>> LinearRing([(0,0),(0,1000),(1000,1000),(1000,0)]).area
    0.0            # shapely 2.x：LinearRing 是线，.area 恒 0
    >>> Polygon(ring).area
    1000000.0

⇒ `keep_holes` 恒为空 ⇒ **所有内环都被填**（引擎实跑输出：31 个 feature、0 个洞）。
后果：5m 档 mask 2,132.9 km² 而画出来的多边形 2,700~2,789 km²（+27%~+31%），圈进的像元
27.5% 高于水位（最高 373 m）；2m 档反向少画（两个最小面积过滤吃掉 148 km² / 40%）。

## 三个变体

  A 现状（洞全填）        ｜ 与入库产物同款
  B 按注释本意（留大洞）  ｜ 把判据改成 `Polygon(ring).area` 后的形态
  C 一个都不填            ｜ 下限形态

用法（venv，需 rasterio/shapely；QGIS python 无这两个包）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
      tools/diag/probe-flood-polygon-variants.py [level...]     # 默认 2 5 10
"""
from __future__ import annotations

import sys
from pathlib import Path

from rasterio.features import shapes as rio_shapes
from rasterio.warp import transform_geom
from shapely.geometry import Polygon, shape

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "flood" / "engine"))
from flood_engine import compute_flood_mask, load_dem  # noqa: E402

MIN_UTM_M2 = 250_000  # 第一道过滤（part.area）与"小洞"阈值
MIN_DEG2 = 0.0002  # MIN_AREA_DEG2：注释写≈0.25km²，按本纬度实际≈2.3km²（另一处待裁）
LEVELS = [float(a) for a in sys.argv[1:]] or [2.0, 5.0, 10.0]


def npts(rings) -> int:
    return sum(len(r.coords) for r in rings)


def main() -> None:
    dem, nodata, transform, crs = load_dem(1)
    for level in LEVELS:
        mask = compute_flood_mask(dem, nodata, level) & (dem > 0.0)
        px_km2 = float(mask.sum()) * 900 / 1e6
        parts = []
        for g, v in rio_shapes(mask.astype("uint8"), transform=transform, connectivity=8):
            if v != 1:
                continue
            geom = shape(g)
            parts.extend(geom.geoms if geom.geom_type == "MultiPolygon" else [geom])

        drop_utm = drop_deg2 = 0.0
        kept = []
        for p in parts:
            if p.geom_type != "Polygon" or p.area < MIN_UTM_M2:
                drop_utm += p.area
                continue
            g4 = transform_geom(crs, "EPSG:4326", p.__geo_interface__, precision=6)
            if shape(g4).area < MIN_DEG2:
                drop_deg2 += p.area
                continue
            kept.append(p)

        exts = sum(p.area for p in kept)
        holes = [r for p in kept for r in p.interiors]
        areas = [Polygon(r).area for r in holes]
        small = sum(a for a in areas if a < MIN_UTM_M2)
        big = sum(a for a in areas if a >= MIN_UTM_M2)
        n_big = sum(1 for a in areas if a >= MIN_UTM_M2)
        v_ext = npts([p.exterior for p in kept])
        v_small = v_ext + npts([r for p in kept for r in p.interiors if Polygon(r).area < MIN_UTM_M2])
        v_all = v_ext + npts(holes)
        pct = lambda a: 100 * a / (px_km2 * 1e6)  # noqa: E731
        print(
            f"\nlevel {level:5.1f}m ｜ mask {px_km2:8.2f} km² ｜ 过滤 -{drop_utm/1e6:.2f}(UTM) "
            f"-{drop_deg2/1e6:.2f}(deg²) ｜ 保留外形 {exts/1e6:7.2f} km² ｜ 洞 {len(holes)} 个（小 {len(holes)-n_big} / 大 {n_big}）"
        )
        print(
            f"  A 现状（洞全填）      : 画出 {(exts+small+big)/1e6:8.2f} km²（{pct(exts+small+big):5.1f}% of mask）｜ 洞 0 ｜ 顶点 {v_ext:>7d}"
        )
        print(
            f"  B 按注释本意（留大洞）: 画出 {(exts+small)/1e6:8.2f} km²（{pct(exts+small):5.1f}% of mask）｜ 洞 {n_big} ｜ 顶点 {v_small:>7d}"
        )
        print(
            f"  C 一个都不填          : 画出 {exts/1e6:8.2f} km²（{pct(exts):5.1f}% of mask）｜ 洞 {len(holes)} ｜ 顶点 {v_all:>7d}"
        )


if __name__ == "__main__":
    main()
