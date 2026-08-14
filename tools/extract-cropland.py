# -*- coding: utf-8 -*-
"""
extract-cropland.py — 从 ESA WorldCover 10m 瓦片提取耕地(class 40)掩膜 + 面积统计。
用法: python extract-cropland.py
依赖: rasterio (flood-service venv 已装)
输出: 项目数据/多边形/土地类型/cropland_beibu.tif (0/1 掩膜, 4326) + 面积统计打印
"""
import os

import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling

SRC = r'C:\Users\JionHappY\Desktop\项目数据\多边形\土地类型\ESA-WorldCover-10m'
OUT = r'C:\Users\JionHappY\Desktop\项目数据\多边形\土地类型\cropland_beibu.tif'
TILES = [
    'ESA_WorldCover_10m_2021_v200_N18E105_Map.tif',
    'ESA_WorldCover_10m_2021_v200_N18E108_Map.tif',
    'ESA_WorldCover_10m_2021_v200_N21E105_Map.tif',
    'ESA_WorldCover_10m_2021_v200_N21E108_Map.tif',
]
CROPLAND_CLASS = 40


def main():
    # 1. 逐瓦片读 class==40 掩膜,输出 0/1 掩膜 tif(同分辨率零损失;合并留到入库时用 gdal_merge)
    total_px = 0
    for name in TILES:
        path = os.path.join(SRC, name)
        with rasterio.open(path) as src:
            data = src.read(1)
            mask = data == CROPLAND_CLASS
            px = int(mask.sum())
            total_px += px
            km2 = px * (10.0 / 1000.0) ** 2
            print(f'{name}: 耕地 {px} 像元 ≈ {km2:,.0f} km²')
            out_name = name.replace('_Map.tif', '_cropland.tif')
            out_path = os.path.join(SRC, out_name)
            profile = src.profile.copy()
            profile.update(dtype='uint8', count=1, compress='lzw', tiled=True,
                           blockxsize=256, blockysize=256)
            with rasterio.open(out_path, 'w', **profile) as out:
                out.write(mask.astype(np.uint8), 1)
            print(f'   -> {out_name}')

    print(f'合计: {total_px:,} 像元 ≈ {total_px * 0.0001:,.0f} km² (10m 像元近似)')


if __name__ == '__main__':
    main()
