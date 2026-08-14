# -*- coding: utf-8 -*-
"""
extract-roads.py — 从 OSM PBF 提取北部湾 bbox 内的公路(highway=*)与铁路(railway=*)。
用法: python extract-roads.py [pbf] [输出目录]
依赖: pyosmium; 输入 PBF 建议用 ASCII 路径硬链接(pyosmium C++ 不支持中文路径)。
输出: beibu-roads.geojson / beibu-railways.geojson (LineString)
"""
import json
import os
import sys

import osmium

BBOX = (106.0, 20.0, 111.0, 24.0)  # west, south, east, north (钦北防+南宁+平陆运河走廊)


class RoadHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads = []
        self.railways = []

    def way(self, w):
        # bbox 过滤: 任一节点落在 bbox 内的 way 才保留(pyosmium 无内置 bbox filter)
        if not any(self._in_bbox(n) for n in w.nodes if n.location.valid()):
            return
        if w.tags.get('highway') and w.tags.get('highway') not in ('footway', 'path', 'cycleway', 'track', 'steps', 'bridleway'):
            self._collect(w, self.roads, 'highway')
        elif w.tags.get('railway') and w.tags.get('railway') in ('rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'):
            self._collect(w, self.railways, 'railway')

    @staticmethod
    def _in_bbox(n):
        return BBOX[0] <= n.lon <= BBOX[2] and BBOX[1] <= n.lat <= BBOX[3]

    def _collect(self, w, target, kind):
        coords = [(round(n.lon, 6), round(n.lat, 6)) for n in w.nodes if n.location.valid()]
        if len(coords) >= 2:
            target.append({
                'type': 'LineString',
                'coordinates': coords,
                'properties': {'osm_id': w.id, 'name': w.tags.get('name', ''), kind: w.tags.get(kind, '')},
            })


def main():
    pbf = sys.argv[1] if len(sys.argv) > 1 else r'C:\mypython\beibu-gulf-project\.tmp-pip\china.osm.pbf'
    outdir = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\JionHappY\Desktop\项目数据\路网'
    os.makedirs(outdir, exist_ok=True)
    idx_dir = r'C:\mypython\beibu-gulf-project\.tmp-pip'
    os.makedirs(idx_dir, exist_ok=True)
    idx_path = os.path.join(idx_dir, 'roads-idx.cache')

    handler = RoadHandler()
    handler.apply_file(pbf, locations=True, idx=f'sparse_file_array,{idx_path}')

    for name, features, label in (('beibu-roads.geojson', handler.roads, 'roads'),
                                  ('beibu-railways.geojson', handler.railways, 'railways')):
        fc = {'type': 'FeatureCollection',
              'features': [{'type': 'Feature', 'properties': f['properties'], 'geometry': {
                  'type': f['type'], 'coordinates': f['coordinates']}} for f in features]}
        path = os.path.join(outdir, name)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(fc, f, ensure_ascii=False)
        print(f'{label}: {len(features)} features -> {path}')

    try:
        os.remove(idx_path)
    except OSError:
        pass


if __name__ == '__main__':
    main()
