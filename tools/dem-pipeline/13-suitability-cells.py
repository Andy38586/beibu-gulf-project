"""
13-suitability-cells.py — 统一因子格网物化 v2（单元四前置；2026-09-29）

v1 教训：148k 点 × land_cover 92.8k 多边形 LATERAL ST_Contains 跑 14.5 分钟
并把库打进 recovery（巨型林地多边形逐点包含判断是杀手）——废弃。
v2 口径：土地主类**直接查源栅格**（landcover_4490_30m.tif，多边形正是它的
派生物），经纬度 → 仿射像素零变换；terrain 行读自库（权威行源）；KDE/可达
在 SQL 内联（500m 方格小面，ST_Contains 便宜）。

前置链（2026-10-05 A2 修正，缺一环实测全 NULL）：12 → 灌 `terrain_factors`（replace）
→ **重刷 `tools/site-suitability/access-factors.sql`**（TRUNCATE+重灌，键=terrain_factors.id；
不刷则本脚本产物 `dist_port_m`/`dist_road_m` 全 NULL）→ 本脚本 → 灌 `suitability_cells`
（其 SQL 内 LEFT JOIN access_factors）。

输出：.local/land-work/suitability_cells.sql（含 staging 临时表的完整导入脚本）
导入：docker cp + psql -f（脚本尾打印命令）
"""
import io
import os
import json
import subprocess
import sys

import numpy as np
from osgeo import gdal, gdalconst, ogr, osr

gdal.UseExceptions()

LC = r"C:/workspace/beibu-gulf-project/.local/land-work/landcover_4490_30m.tif"
OUT_SQL = r"C:/workspace/beibu-gulf-project/.local/land-work/suitability_cells.sql"

PSQL = ["docker", "exec", "-i", "beibu-postgis", "psql", "-U", "postgres",
        "-d", "beibu-gulf-data", "-v", "ON_ERROR_STOP=1", "-qAt", "-c"]


def fetch_terrain() -> list[tuple]:
    r = subprocess.run(
        PSQL + ["COPY (SELECT id, st_x(geom), st_y(geom), mean_elev_m, mean_slope_deg,"
                " max_slope_deg, land_frac FROM terrain_factors ORDER BY id) TO STDOUT WITH CSV"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    rows = []
    for ln in r.stdout.strip().splitlines():
        p = ln.split(",")
        rows.append((int(p[0]), float(p[1]), float(p[2]),
                     float(p[3]), float(p[4]), float(p[5]), float(p[6])))
    return rows


def main():
    terrain = fetch_terrain()
    print(f"terrain 行: {len(terrain)}", flush=True)

    d = gdal.Open(LC, gdalconst.GA_ReadOnly)
    gt = d.GetGeoTransform()
    band = d.GetRasterBand(1)
    inv = gdal.InvGeoTransform(gt)
    classes = band.ReadAsArray()
    H, W = classes.shape

    drv = ogr.GetDriverByName("GPKG")
    gpkg = r"C:/workspace/beibu-gulf-project/.local/land-work/suitability_staging.gpkg"
    if os.path.exists(gpkg):
        drv.DeleteDataSource(gpkg)
    ds = drv.CreateDataSource(gpkg)
    srs = osr.SpatialReference()
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    srs.ImportFromEPSG(4490)
    lyr = ds.CreateLayer("cells", srs, ogr.wkbPoint)
    for name in ("id", "mean_elev_m", "mean_slope_deg", "max_slope_deg", "land_frac", "land_class"):
        lyr.CreateField(ogr.FieldDefn(name, ogr.OFTInteger if name in ("id", "land_class") else ogr.OFTReal))
    defn = lyr.GetLayerDefn()

    n_cls = 0
    for (tid, lon, lat, me, ms, mx, lf) in terrain:
        f = ogr.Feature(defn)
        f.SetField("id", tid)
        f.SetGeometry(ogr.CreateGeometryFromWkt(f"POINT ({lon!r} {lat!r})"))
        f.SetField("mean_elev_m", me)
        f.SetField("mean_slope_deg", ms)
        f.SetField("max_slope_deg", mx)
        f.SetField("land_frac", lf)
        # 经纬度 → 栅格像素（零 CRS 变换，landcover 与点同在 4490）
        px, py = gdal.ApplyGeoTransform(inv, lon, lat)
        px, py = int(px), int(py)
        cls = None
        if 0 <= px < W and 0 <= py < H:
            v = int(classes[py, px])
            cls = v if v != 0 else None  # 0 = 源 nodata（钦州湾外海空洞口径）
        if cls is not None:
            f.SetField("land_class", cls)
            n_cls += 1
        lyr.CreateFeature(f)
    print(f"land_class 命中 {n_cls}/{len(terrain)}（空洞/出图为 NULL）", flush=True)

    gdal.VectorTranslate(
        r"C:/workspace/beibu-gulf-project/.local/land-work/suitability_staging.sql",
        gpkg,
        format="PGDump",
        layerName="cells",
        layerCreationOptions=["CREATE_TABLE=OFF", "GEOMETRY_NAME=geom", "SPATIAL_INDEX=NONE", "DROP_TABLE=OFF", "FID=oid"],
    )
    # 组装最终 SQL：staging 临时表 + 主表灌入 + KDE/可达内联
    staging_sql = io.open(r"C:/workspace/beibu-gulf-project/.local/land-work/suitability_staging.sql", encoding="utf-8").read()
    body = staging_sql.split("BEGIN;", 1)[1].rsplit("COMMIT;", 1)[0]
    body = body.replace('INSERT INTO "public"."cells"', "INSERT INTO cells_staging")
    final = f"""-- suitability_cells 物化 v2（13 脚本生成；土地主类=源栅格像素查得，绕开多边形包含）
TRUNCATE suitability_cells;
CREATE TEMP TABLE cells_staging (oid bigserial, id bigint, geom geometry(Point,4490),
  mean_elev_m double precision, mean_slope_deg double precision,
  max_slope_deg double precision, land_frac double precision, land_class int);
BEGIN;
{body}
COMMIT;
INSERT INTO suitability_cells (id, geom, mean_elev_m, mean_slope_deg, max_slope_deg,
  land_frac, land_class, dist_port_m, dist_road_m, kde_mass)
SELECT s.id, s.geom, s.mean_elev_m, s.mean_slope_deg, s.max_slope_deg, s.land_frac,
  s.land_class, a.dist_port_m, a.dist_road_m, k.mass
FROM cells_staging s
LEFT JOIN access_factors a ON a.terrain_id = s.id
LEFT JOIN LATERAL (
  SELECT k.mass FROM kde_indzone_h2000_c500 k WHERE ST_Contains(k.geom, s.geom) LIMIT 1
) k ON true;
"""
    io.open(OUT_SQL, "w", encoding="utf-8", newline="\n").write(final)
    print(f"written: {OUT_SQL} ({os.path.getsize(OUT_SQL)//1024} KB)", flush=True)
    print("导入：docker cp 该文件 beibu-postgis:/tmp/ && psql -f", flush=True)


if __name__ == "__main__":
    main()
