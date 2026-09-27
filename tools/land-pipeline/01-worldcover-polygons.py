"""
01-worldcover-polygons.py — 土地覆盖矢量管线（2026-09-27，新选址因子 W2 队列#3）

源：ESA WorldCover 2021 v200 10m（S3 匿名直链，2026-09-27 HEAD+vsicurl 实测可达）
  https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_<T>_Map.tif
本区 4 瓦片：N21E108 / N21E105 / N18E108 / N18E105（bbox 107.29-110.00E, 20.96-22.61N
角点各落一角，缺一会出洞）。

三步：warp（4326→4490，30m mode 多数聚合对齐 DEM 因子分辨率，裁项目 bbox）
  → polygonize（4 连通，field=class）→ PGDump（只出 INSERT，DDL 归
  tools/db/db-schema-gis.sql，索引归 schema 不在此重复生成）。

导入（本机，手工执行；幂等：先 TRUNCATE）：
  docker exec beibu-postgis psql -U postgres -d beibu-gulf-data -c \\
    "TRUNCATE land_cover; SELECT 1"
  docker cp .local/land-work/landcover_import.sql beibu-postgis:/tmp/
  # dump 只含 INSERT(geom,class)，id 由库端 BIGSERIAL 自配（无 setval 需求）
  docker exec beibu-postgis psql -U postgres -d beibu-gulf-data -v ON_ERROR_STOP=1 \\
    -f /tmp/landcover_import.sql
  docker exec beibu-postgis psql -U postgres -d beibu-gulf-data -f - <<'SQL'
    INSERT INTO spatial_meta (table_name, storage_crs, source_crs, transform, notes)
    VALUES ('land_cover','EPSG:4490','EPSG:4326',
      'gdalwarp -r mode 30m 聚合（WorldCover 10m 源）+ polygonize 4 连通 → 4490',
      'ESA WorldCover 2021 v200 10m，4 瓦片裁 bbox；class 代码见 db-schema-gis.sql')
    ON CONFLICT (table_name) DO UPDATE SET
      transform=EXCLUDED.transform, notes=EXCLUDED.notes, updated_at=now();
  SQL

坑：①Git Bash 调 gdal 传 /vsicurl/ 会被 MSYS 路径转换毁掉（MSYS_NO_PATHCONV=1 解）；
②系统代理必须在本进程内显式清空（curl -noproxy 等价物）；③4 瓦片缺一会静默出洞——
进度里打印各瓦片读取确认，洞由导入后 ST_CoverageCheck/counts 对账发现。
"""
import os
import sys

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["GDAL_HTTP_MAX_RETRY"] = "3"
# GDAL Python 绑定的 curl 无默认 CA 链（gdalinfo.exe 有自带，绑定没有）——指向 certifi；
# certifi 缺失则显式降级 UNSAFESSL（只读公开 S3，风险可受，留痕不静默）
try:
    import certifi

    ca = certifi.where()
    os.environ["GDAL_HTTP_CAFILE"] = ca
    os.environ["GDAL_CURL_CA_BUNDLE"] = ca
    os.environ["CPL_CAFILE"] = ca
    print("CA:", ca, flush=True)
except ImportError:
    os.environ["GDAL_HTTP_UNSAFESSL"] = "YES"
    print("⚠️ certifi 缺失，降级 GDAL_HTTP_UNSAFESSL=YES（SSL 校验关闭）", flush=True)

import numpy as np
from osgeo import gdal, ogr, gdalconst

gdal.UseExceptions()

S3 = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
TILES = ["N21E108", "N21E105", "N18E108", "N18E105"]
# 项目 bbox（=陆地 DEM cut 角点换算，2026-09-27 PROJ 实测：107.292-110.000, 20.958-22.611）
BBOX = (107.29, 20.96, 110.00, 22.61)
RES = 0.00028  # ≈30m，与 DEM 因子分辨率对齐
WORK = r"C:/workspace/beibu-gulf-project/.local/land-work"
TIF = f"{WORK}/landcover_4490_30m.tif"
GPKG = f"{WORK}/landcover_4490_30m.gpkg"
SQL = f"{WORK}/landcover_import.sql"

CLASS_CODES = (10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100)


def warp() -> None:
    srcs = [f"/vsicurl/{S3}/ESA_WorldCover_10m_2021_v200_{t}_Map.tif" for t in TILES]
    print("warp:", TILES, flush=True)
    ds = gdal.Warp(
        TIF,
        srcs,
        format="GTiff",
        dstSRS="EPSG:4490",
        outputBounds=BBOX,
        xRes=RES,
        yRes=RES,
        resampleAlg="mode",
        outputType=gdalconst.GDT_Byte,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES"],
    )
    arr = ds.GetRasterBand(1).ReadAsArray()
    hist = dict(zip(*[x.tolist() for x in np.unique(arr, return_counts=True)]))
    print("warp done:", ds.RasterXSize, "x", ds.RasterYSize, flush=True)
    for c in CLASS_CODES:
        print(f"  class {c}: {hist.get(c, 0)} px", flush=True)
    if 0 in hist:
        # 源 nodata 空洞（v200 官方 nodata=0，非管线缺陷；2026-09-27 定责记录）
        print(f"  源 nodata(0): {hist[0]} px（源数据空洞，polygonize 剔除）", flush=True)
    unknown = set(hist) - set(CLASS_CODES) - {0}
    if unknown:
        print(f"  ⚠️ 未知类别码 {unknown}（PUM 之外，须人工核对）", flush=True)


def polygonize() -> None:
    src = gdal.Open(TIF, gdalconst.GA_ReadOnly)
    band = src.GetRasterBand(1)
    # 源数据空洞（v200 在钦州湾外海 108.1-108.9E/21.0-21.3N 段无值，nodata=0 为官方声明，
    # 2026-09-27 直读源 10m 实测定责）——0 不是类别，掩膜剔除不产面；不伪造补值（04-B7）
    arr = band.ReadAsArray()
    mask = gdal.GetDriverByName("MEM").Create("", src.RasterXSize, src.RasterYSize, 1, gdalconst.GDT_Byte)
    mask.GetRasterBand(1).WriteArray((arr != 0).astype(np.uint8) * 255)
    drv = ogr.GetDriverByName("GPKG")
    if os.path.exists(GPKG):
        drv.DeleteDataSource(GPKG)
    out = drv.CreateDataSource(GPKG)
    layer = out.CreateLayer("land_cover", src.GetSpatialRef(), ogr.wkbMultiPolygon)
    layer.CreateField(ogr.FieldDefn("class", ogr.OFTInteger))
    # 4 连通（GDAL 默认）：8 连通在对角相接处产 8 字环（实测 72 万面 11.5 万 invalid，
    # 而对巨大多面跑 ST_MakeValid 28 分钟未完）——4 连通环天然单圈，全部有效
    result = gdal.Polygonize(band, mask.GetRasterBand(1), layer, 0, [])
    n = layer.GetFeatureCount()
    print("polygonize done:", n, "features →", GPKG, flush=True)
    assert result == 0 or result is None, "Polygonize 失败"


def dump() -> None:
    # CREATE_TABLE=OFF：DDL 归 db-schema-gis.sql（表结构单一事实源）；索引同理不在此生成
    gdal.VectorTranslate(
        SQL,
        GPKG,
        format="PGDump",
        layerName="land_cover",
        geometryType="MultiPolygon",
        layerCreationOptions=[
            "CREATE_TABLE=OFF",
            "GEOMETRY_NAME=geom",
            "SPATIAL_INDEX=OFF",
            "DROP_TABLE=OFF",
            "FID=id",  # 对齐 db-schema-gis.sql 主键惯例（id BIGSERIAL）
        ],
    )
    head = open(SQL, encoding="utf-8").read(200)
    print("pgdump done:", os.path.getsize(SQL) // 1024, "KB；头部：", head[:120], flush=True)


if __name__ == "__main__":
    os.makedirs(WORK, exist_ok=True)
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "warp"):
        warp()
    if step in ("all", "polygonize"):
        polygonize()
    if step in ("all", "dump"):
        dump()
