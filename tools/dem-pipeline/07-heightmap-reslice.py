#!/usr/bin/env python3
"""07-heightmap-reslice.py — 用 dem_4326_cut.tif 重切 Cesium heightmap-1.0 瓦片

背景（2026-09-05）：原 backend/static/terrain/ 为 ctb-quantized-mesh 产出，但
layer.json 声明 heightmap-1.0 与数据不符 + gzip 头缺失，Cesium 端解码自始
RangeError（8-10 生产"无起伏"即本 bug 症状），瓦片从未渲染成功。
本脚本按 Cesium 官方 heightmap-1.0 规范重切：
  - 每瓦片 65×65 uint16，行主序北→南/西→东，编码 = (高程米 + 1000) * 5
  - 海洋/NoData 按 0m 计（编码 5000）
  - gzip 压缩输出 .terrain；layer.json format 保持 heightmap-1.0
  - 层级枚举沿用现有瓦片目录树（z/x/y 集合不变，tiles 模板不变）

用法（生成侧 venv，rasterio 已装）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/dem-pipeline/07-heightmap-reslice.py
  （venv 路径未变；`backend/algorithm-service/` 已随 FastAPI 移除、不再受版本控制）
"""
from __future__ import annotations

import gzip
import math
import struct
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds

REPO = Path(__file__).resolve().parents[2]
# 2026-10-04 路径修订：原两个默认路径（dem/ 下的 dem_4326_cut.tif 与 filled_utm48n_cut.tif）
# 都已被清理进程删除，脚本此前**跑不起来**。现指向 06 脚本的实际落点，WarpedVRT 现场重投影。
# 为什么等价：陆地像元与该工作版同源（与 ASTER 原件逐像元差 0，见提交 a8a3560a）；海侧
# 两边都是"nodata→编码 0m"。单瓦片实测见 tools/diag/probe-terrain-vs-dem.py（served 对
# 当前 DEM 均 |Δ|0.34m / 重切 0.31m，P95 同为 2.00m ⇒ 不是系统性陈旧）。
DEM_4326 = REPO / ".local/dem-work/dem_4326_cut.tif"  # 可选加速件（本机已无）；缺失即回落
DEM_UTM = REPO / ".local/dem-work/filled_utm48n_cut.tif"  # 06 脚本产出的工作版（实际走这条）
TERRAIN_DIR = REPO / "backend/static/terrain"
SAMPLES = 65  # heightmap-1.0 默认网格（CesiumTerrainProvider heightmapWidth）

# 编码常量：uint16 = (米 + 1000) * 5（-1000..10086 m 覆盖域）
ENC_OFFSET = 1000.0
ENC_SCALE = 5.0


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Cesium GeographicTilingScheme：z 级 2^(z+1) 列 × 2^z 行，y=0 最北。"""
    cols = 2 ** (z + 1)
    rows = 2**z
    lon_w = -180.0 + x * 360.0 / cols
    lon_e = -180.0 + (x + 1) * 360.0 / cols
    lat_n = 90.0 - y * 180.0 / rows
    lat_s = 90.0 - (y + 1) * 180.0 / rows
    return lon_w, lat_s, lon_e, lat_n


def main() -> None:
    # 枚举源 = DEM bbox 推导（z0-12，geodetic 方案，凡与 DEM 相交的瓦片）——
    # 不依赖旧目录树（CTB 树 TMS/slippy y 轴语义混杂曾致重切错位；旧树已物理删除重建）
    DEM_MIN_LON, DEM_MAX_LON = 105.0, 115.0
    DEM_MIN_LAT, DEM_MAX_LAT = 18.0, 25.0
    existing: list[tuple[int, int, int]] = []
    for z in range(0, 13):
        cols = 2 ** (z + 1)
        rows = 2**z
        for x in range(cols):
            for y in range(rows):
                lon_w = -180.0 + x * 360.0 / cols
                lon_e = lon_w + 360.0 / cols
                lat_n = 90.0 - y * 180.0 / rows
                lat_s = lat_n - 180.0 / rows
                if (
                    lon_e > DEM_MIN_LON
                    and lon_w < DEM_MAX_LON
                    and lat_n > DEM_MIN_LAT
                    and lat_s < DEM_MAX_LAT
                ):
                    existing.append((z, x, y))
    tile_set = set(existing)
    # 树完整性强制：GeographicTilingScheme root 为 z0 两张并列 + z1 四列两行——
    # CesiumTerrainProvider 初始化即请求全部 root 与一层细化瓦片，与 DEM 不相交的
    # （如 z0 x0 西半球）也必须存在（全海洋 0 高程），缺任一张即 TerrainProvider 404、
    # 地形树建立失败（2026-09-09 实锤：0/0/0 缺失致 console 报 root 404、地形静默失效）
    for z in (0, 1):
        cols = 2 ** (z + 1)
        for x in range(cols):
            for y in range(2**z):
                tile_set.add((z, x, y))
    print(f"derived tiles (z0-12, DEM bbox intersect): {len(existing)}")

    src_path = DEM_4326 if DEM_4326.exists() else DEM_UTM
    print(f"input DEM: {src_path.name}")
    with rasterio.open(src_path) as raw:
        nodata = raw.nodata if raw.nodata is not None else -32767.0
        # UTM 输入经 WarpedVRT 统一到 EPSG:4326（双线性，与瓦片采样精度匹配）
        if raw.crs.to_epsg() == 4326:
            dem = raw
        else:
            dem = WarpedVRT(raw, crs="EPSG:4326", resampling=Resampling.bilinear)
        dem_bounds = dem.bounds
        grid = np.zeros((SAMPLES, SAMPLES), dtype=np.float64)
        written = 0
        written_paths: set[Path] = set()
        for z, x, y in sorted(tile_set):
            lon_w, lat_s, lon_e, lat_n = tile_bounds(z, x, y)
            heights = np.full((SAMPLES, SAMPLES), 0.0)
            step_lat = (lat_n - lat_s) / (SAMPLES - 1)
            step_lon = (lon_e - lon_w) / (SAMPLES - 1)
            # 瓦片 65 网格与 DEM 范围求交集（WarpedVRT 不支持 boundless，越界补 0 高程=海洋）
            j0 = max(0, math.ceil((dem_bounds.left - lon_w) / step_lon))
            j1 = min(SAMPLES - 1, math.floor((dem_bounds.right - lon_w) / step_lon))
            i0 = max(0, math.ceil((lat_n - dem_bounds.top) / step_lat))
            i1 = min(SAMPLES - 1, math.floor((lat_n - dem_bounds.bottom) / step_lat))
            if j1 >= j0 and i1 >= i0:
                sub_w = lon_w + j0 * step_lon
                sub_e = lon_w + j1 * step_lon
                sub_n = lat_n - i0 * step_lat
                sub_s = lat_n - i1 * step_lat
                win = from_bounds(sub_w, sub_s, sub_e, sub_n, transform=dem.transform)
                sub = dem.read(
                    1,
                    window=win,
                    out_shape=(i1 - i0 + 1, j1 - j0 + 1),
                    resampling=Resampling.bilinear,
                )
                heights[i0 : i1 + 1, j0 : j1 + 1] = sub
            heights = np.where(np.isfinite(heights) & (heights != nodata), heights, 0.0)
            heights = np.where(np.isfinite(heights) & (heights != nodata), heights, 0.0)
            # 编码 uint16：(h + 1000) * 5，负高程 clamp 到 -1000
            encoded = np.clip((heights + ENC_OFFSET) * ENC_SCALE, 0, 65535).astype("<u2")
            # heightmap-1.0 瓦片布局（CesiumTerrainProvider.createHeightmapTerrainData）：
            # 65×65 uint16 heights + 1B childTileMask + N B waterMask。childTileMask 位：
            # bit0=SW bit1=SE bit2=NW bit3=NE，按真实瓦片树存在性置位（缺子树=0 防 404 重试）
            mask = 0
            for bit, (cx, cy) in (
                (0, (2 * x, 2 * y + 1)),      # SW
                (1, (2 * x + 1, 2 * y + 1)),  # SE
                (2, (2 * x, 2 * y)),          # NW
                (3, (2 * x + 1, 2 * y)),      # NE
            ):
                if (z + 1, cx, cy) in tile_set:
                    mask |= 1 << bit
            payload = gzip.compress(
                encoded.tobytes()
                + bytes([mask])
                + bytes([0xFF if bool((heights == 0).all()) else 0x00])
            )
            out = TERRAIN_DIR / str(z) / str(x) / f"{y}.terrain"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(payload)
            written_paths.add(out)
            written += 1
            if written % 500 == 0:
                print(f"  {written} tiles...")
        print(f"written: {written} heightmap tiles")
        stale = 0
        for f in TERRAIN_DIR.rglob("*.terrain"):
            if f not in written_paths:
                f.unlink()
                stale += 1
        print(f"removed stale: {stale}")

    # ---- layer.json ----
    # 关键（2026-10-04 运行时实测更正）：available 与 scheme **同向解析**——本脚本显式声明
    # "slippyMap"（y=0 最北，与瓦片文件名同向，见 tile_bounds），Cesium 1.142 就按声明原样
    # 请求/判可用（实测：声明位置的镜像 URL 404、盘上实物 URL 200）。故 available 必须写
    # **不翻 y** 的区间；旧实现按 TMS 翻 y 写，等效于把整棵可用树镜像，z≥2 全部 404、
    # 回退父层（地形实际只剩 z0/z1）。
    max_zoom = 12
    by_level: dict[int, dict[int, list[int]]] = {}
    for tz, tx, ty_north in tile_set:
        by_level.setdefault(tz, {}).setdefault(tx, []).append(ty_north)
    available: list[list[dict]] = []
    for tz in range(0, max_zoom + 1):
        ranges_out: list[dict] = []
        for tx in sorted(by_level.get(tz, {})):
            ys = sorted(by_level[tz][tx])
            run_start = ys[0]
            prev = ys[0]
            for yy in ys[1:] + [None]:
                if yy is None or yy != prev + 1:
                    ranges_out.append({
                        "startX": tx,
                        "startY": run_start,
                        "endX": tx,
                        "endY": prev,
                    })
                    if yy is not None:
                        run_start = yy
                if yy is not None:
                    prev = yy
        available.append(ranges_out)

    layer_path = TERRAIN_DIR / "layer.json"
    layer = {
        "tilejson": "2.1.0",
        "name": "dem_heightmap",
        "format": "heightmap-1.0",
        "version": "1.1.0",
        # 瓦片文件名朝北（slippy）；缺省会被 Cesium 当 TMS 翻转 y
        "scheme": "slippyMap",
        "projection": "EPSG:4326",
        "bounds": [DEM_MIN_LON, DEM_MIN_LAT, DEM_MAX_LON, DEM_MAX_LAT],
        "minzoom": 0,
        "maxzoom": max_zoom,
        # available 与 scheme 同向（slippyMap ⇒ y 从北，不翻 y）——运行时实测口径见上
        "available": available,
        "tiles": ["/static/terrain/{z}/{x}/{y}.terrain?v={version}"],
    }
    layer_path.write_text(__import__("json").dumps(layer, indent=2), encoding="utf-8")
    print(
        "layer.json rewritten: format=heightmap-1.0 scheme=slippyMap "
        f"available levels={len(available)}"
    )


if __name__ == "__main__":
    sys.exit(main())
