"""探针 A（QGIS python）：09-29 旧口径 terrain_factors.gpkg → 块索引 CSV。

terrain_factors.gpkg（点=480m 块中心，EPSG:4490，148,423 行）转换成
「custom TM CM108 块行/列 + mean_elev/mean_slope/max_slope/land_frac」CSV，
供 probe-suitability-lineage-impact.py 与「按现役 DEM 重派生」逐块对照。

用法（需 osgeo；本机 = QGIS 的 Python）：
  "C:/Program Files/QGIS 3.44.12/apps/Python312/python.exe" \
    tools/diag/probe-suitability-old-blocks.py
输出：.local/suitability-materiality/old-blocks.csv（gitignored）
"""
import csv
import sys
from pathlib import Path

from osgeo import ogr, osr

ogr.UseExceptions()
REPO = Path(__file__).resolve().parents[2]
GPKG = REPO / ".local/dem-sea-work/terrain_factors.gpkg"
OUT = REPO / ".local/suitability-materiality/old-blocks.csv"
X0, Y0, BLK = 427204.83022098464, 2501620.9715276216, 480.0


def main() -> None:
    src = osr.SpatialReference()
    src.ImportFromEPSG(4490)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference()
    dst.ImportFromProj4(
        "+proj=tmerc +lat_0=0 +lon_0=108 +k=1 +x_0=500000 +y_0=0 "
        "+ellps=GRS80 +units=m +no_defs"
    )
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    ct = osr.CoordinateTransformation(src, dst)

    ds = ogr.Open(str(GPKG))
    lyr = ds.GetLayer(0)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as out:
        w = csv.writer(out)
        w.writerow(["col", "row", "elev", "slope", "maxslope", "landfrac"])
        n = 0
        bad = 0
        for feat in lyr:
            g = feat.GetGeometryRef()
            tx, ty, _ = ct.TransformPoint(g.GetX(), g.GetY())
            c = int((tx - X0) // BLK)
            r = int((Y0 - ty) // BLK)
            if not (0 <= c < 586 and 0 <= r < 380):
                bad += 1
            w.writerow(
                [
                    c,
                    r,
                    feat.GetField("mean_elev_m"),
                    feat.GetField("mean_slope_deg"),
                    feat.GetField("max_slope_deg"),
                    feat.GetField("land_frac"),
                ]
            )
            n += 1
    print(f"dumped {n} rows, out-of-range {bad} -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
