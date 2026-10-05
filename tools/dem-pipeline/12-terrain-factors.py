"""
12-terrain-factors.py — 地形因子面物化（新选址准则「高程地形」，W2 单元二；2026-09-29）

输入（均 30m、custom TM CM108）：
  backend/data/flood/dem/landsea_utm48n.tif
                      海陆一体 DEM **权威件**（Int16，32767=海/无）——2026-10-05 A2 起
                      脚本只读服务消费件，不再读 .local 镜像（镜像仅归档展示，须与权威同 md5）
  slope.tif           gdaldem slope 产物（度，默认非 -p 百分比；由权威 DEM 重算：
                      `gdaldem slope -compute_edges -of GTiff <权威 DEM> slope.tif`——
                      缺 -compute_edges 时首行/首列 31 像元 nodata 掺入块均值，2026-10-05 实测修复）
  filled_utm48n_cut.tif  陆地权威版（取其海掩膜语义：==32767 为海）
聚合：30m → 480m（16×16 块），陆像元统计 mean_elev/mean_slope/max_slope +
land_frac（陆像元占比）；全海块跳过。块中心 custom TM → 4490 转换后入库。

输出：
  .local/dem-sea-work/terrain_factors.gpkg / terrain_factors_import.sql
导入（DDL 在 tools/db/db-schema-gis.sql terrain_factors 段；**replace 语义**——生成的 SQL
在 BEGIN 后自带 TRUNCATE terrain_factors，重灌不叠加旧行）：
  docker cp <sql> beibu-postgis:/tmp/ && docker exec beibu-postgis psql -U postgres \
    -d beibu-gulf-data -v ON_ERROR_STOP=1 -f /tmp/terrain_factors_import.sql
坑：gdal.Open 必须存变量（GC 悬空）；partial 块用 nodata 掩膜参与统计不丢边带。
"""
import os
import sys

from osgeo import gdal, ogr, osr, gdalconst

gdal.UseExceptions()

WORK = r"C:/workspace/beibu-gulf-project/.local/dem-sea-work"
# 权威件唯一读入点（2026-10-05 A2 裁定「归档替换 + 链重派生」）：防再次错代
DEM = r"C:/workspace/beibu-gulf-project/backend/data/flood/dem/landsea_utm48n.tif"
SLOPE = f"{WORK}/slope.tif"
CUT = r"C:/workspace/beibu-gulf-project/.local/dem-work/filled_utm48n_cut.tif"
GPKG = f"{WORK}/terrain_factors.gpkg"
SQL = f"{WORK}/terrain_factors_import.sql"
NOD = 32767
BLK = 16  # 30m × 16 = 480m 因子格


def main():
    d_dem = gdal.Open(DEM, gdalconst.GA_ReadOnly)
    d_slope = gdal.Open(SLOPE, gdalconst.GA_ReadOnly)
    d_cut = gdal.Open(CUT, gdalconst.GA_ReadOnly)  # 坑③：必须存变量
    dem = d_dem.GetRasterBand(1).ReadAsArray()
    slope = d_slope.GetRasterBand(1).ReadAsArray()
    sea = d_cut.GetRasterBand(1).ReadAsArray() == NOD  # 海掩膜（与 cut 同网格）
    gt = d_dem.GetGeoTransform()
    H, W = dem.shape

    rows_full, cols_full = H // BLK, W // BLK
    # partial 边带补齐到整块维度（nodata 掩膜排除，不丢边带）
    nb_r = -(-H // BLK)  # ceil
    nb_c = -(-W // BLK)
    pr, pc = nb_r * BLK, nb_c * BLK

    def pad(a, fill):
        out = np.full((pr, pc), fill, dtype=a.dtype)
        out[:H, :W] = a
        return out

    import numpy as np

    dem_p = pad(dem, NOD)
    slope_p = pad(slope, -9999)
    sea_p = pad(sea, True)
    land_p = ~sea_p & (dem_p != NOD)

    # 分块统计（reshape trick：整块维度 + 陆像元掩膜）
    dem_b = dem_p.reshape(nb_r, BLK, nb_c, BLK)
    slope_b = slope_p.reshape(nb_r, BLK, nb_c, BLK)
    land_b = land_p.reshape(nb_r, BLK, nb_c, BLK)
    cnt = land_b.sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        melev = np.where(
            cnt > 0,
            np.nansum(np.where(land_b, dem_b, np.nan), axis=(1, 3)) / np.maximum(cnt, 1),
            np.nan,
        )
        mslope = np.where(
            cnt > 0,
            np.nansum(np.where(land_b, slope_b, np.nan), axis=(1, 3)) / np.maximum(cnt, 1),
            np.nan,
        )
        maxslope = np.where(cnt > 0, np.where(land_b, slope_b, -9999).max(axis=(1, 3)), np.nan)
    frac = cnt / (BLK * BLK)

    # 块中心 → 4490
    src = osr.SpatialReference()
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    src.ImportFromWkt(d_dem.GetProjection())
    dst = osr.SpatialReference()
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.ImportFromEPSG(4490)
    ct = osr.CoordinateTransformation(src, dst)

    drv = ogr.GetDriverByName("GPKG")
    if os.path.exists(GPKG):
        drv.DeleteDataSource(GPKG)
    ds = drv.CreateDataSource(GPKG)
    lyr = ds.CreateLayer("terrain_factors", dst, ogr.wkbPoint)
    for name in ("mean_elev_m", "mean_slope_deg", "max_slope_deg", "land_frac"):
        lyr.CreateField(ogr.FieldDefn(name, ogr.OFTReal))

    n = 0
    defn = lyr.GetLayerDefn()
    for r in range(nb_r):
        for c in range(nb_c):
            k = cnt[r, c]
            if k == 0:
                continue
            x = gt[0] + (c * BLK + BLK / 2) * gt[1]
            y = gt[3] + (r * BLK + BLK / 2) * gt[5]
            lon, lat, _ = ct.TransformPoint(x, y)
            f = ogr.Feature(defn)
            f.SetGeometry(ogr.CreateGeometryFromWkt(f"POINT ({lon:.10f} {lat:.10f})"))
            f.SetField("mean_elev_m", float(melev[r, c]))
            f.SetField("mean_slope_deg", float(mslope[r, c]))
            f.SetField("max_slope_deg", float(maxslope[r, c]))
            f.SetField("land_frac", float(frac[r, c]))
            lyr.CreateFeature(f)
            n += 1
    print(f"块统计完成：{n} 个含陆块（跳全海 {nb_r * nb_c - n}）→ {GPKG}", flush=True)

    gdal.VectorTranslate(
        SQL,
        GPKG,
        format="PGDump",
        layerName="terrain_factors",
        layerCreationOptions=["CREATE_TABLE=OFF", "GEOMETRY_NAME=geom", "SPATIAL_INDEX=NONE", "DROP_TABLE=OFF", "FID=id"],
    )
    # replace 语义（2026-10-05 A2）：VectorTranslate 只出 INSERT，重灌会叠加旧行
    #（实证 148,423 旧 + 165,966 新 = 314,389）。与 13 的 TRUNCATE suitability_cells 同款，
    # 把 TRUNCATE 注进事务头，导入脚本可安全幂等重跑。
    with open(SQL, encoding="utf-8") as f:
        text = f.read()
    anchor = "BEGIN;\n"
    if anchor not in text:
        raise RuntimeError("导入 SQL 缺 BEGIN; 锚点，无法注入 TRUNCATE")
    text = text.replace(anchor, anchor + 'TRUNCATE TABLE "public"."terrain_factors";\n', 1)
    with open(SQL, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("pgdump:", os.path.getsize(SQL) // 1024, "KB →", SQL, flush=True)


if __name__ == "__main__":
    main()
