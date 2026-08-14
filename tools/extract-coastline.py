# -*- coding: utf-8 -*-
"""
extract-coastline.py — 从 OSM PBF 提取海岸线与水体多边形（pyosmium）。
用法: python extract-coastline.py <china.pbf> <输出目录>
输出: coastline-china.geojson (natural=coastline 线), water-china.geojson (natural=water/bay 面)
注: 仅处理 way 级别要素; relation 组成的大水体后续可用 osmium 合并。坐标精度 6 位小数(~0.1m)。
"""
import json
import os
import sys

import osmium


class WaterHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.coast = []
        self.water = []

    def way(self, w):
        nat = w.tags.get('natural')
        if nat == 'coastline':
            coords = [(round(n.lon, 6), round(n.lat, 6)) for n in w.nodes if n.location.valid()]
            if len(coords) >= 2:
                self.coast.append({'type': 'LineString', 'coordinates': coords})
        elif nat in ('water', 'bay'):
            coords = [(round(n.lon, 6), round(n.lat, 6)) for n in w.nodes if n.location.valid()]
            if len(coords) >= 4:
                self.water.append({'type': 'Polygon', 'coordinates': [coords + [coords[0]]]})


def main():
    # 中文路径不经 argv 传递（后台任务参数会被转码），且 pyosmium C++ 层无法打开中文路径：
    # 输入 PBF 先用硬链接挂到 ASCII 路径（tools 侧 .tmp-pip\china.osm.pbf）
    pbf = sys.argv[1] if len(sys.argv) > 1 else r'C:\mypython\beibu-gulf-project\.tmp-pip\china.osm.pbf'
    outdir = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\JionHappY\Desktop\项目数据\海岸线'
    os.makedirs(outdir, exist_ok=True)

    # 磁盘稀疏索引缓存节点坐标（中国 PBF 节点量大,内存索引会爆）。
    # 注意: pyosmium C++ 索引不支持中文路径(Windows ANSI 转换失败),必须用 ASCII 路径
    idx_dir = r'C:\mypython\beibu-gulf-project\.tmp-pip'
    os.makedirs(idx_dir, exist_ok=True)
    idx_path = os.path.join(idx_dir, 'node-idx.cache')

    handler = WaterHandler()
    handler.apply_file(pbf, locations=True, idx=f'sparse_file_array,{idx_path}')

    for name, features in (('coastline-china.geojson', handler.coast),
                           ('water-china.geojson', handler.water)):
        fc = {'type': 'FeatureCollection',
              'features': [{'type': 'Feature', 'properties': {}, 'geometry': g} for g in features]}
        path = os.path.join(outdir, name)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(fc, f, ensure_ascii=False)
        print(f'{name}: {len(features)} features -> {path}')

    try:
        os.remove(idx_path)
    except OSError:
        pass


if __name__ == '__main__':
    main()
