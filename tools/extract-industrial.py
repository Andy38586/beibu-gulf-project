# -*- coding: utf-8 -*-
"""
extract-industrial.py — 从 OSM PBF 提取北部湾 bbox 内的工业园区多边形(landuse=industrial)。
用法: python extract-industrial.py   (输入用 ASCII 硬链接,输出到桌面数据目录)
输出: beibu-industrial.geojson (Polygon)
"""
import json
import os

import osmium

BBOX = (106.0, 20.0, 111.0, 24.0)


class IndustrialHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.polys = []

    def way(self, w):
        if w.tags.get('landuse') != 'industrial':
            return
        if not any(BBOX[0] <= n.lon <= BBOX[2] and BBOX[1] <= n.lat <= BBOX[3] for n in w.nodes if n.location.valid()):
            return
        coords = [(round(n.lon, 6), round(n.lat, 6)) for n in w.nodes if n.location.valid()]
        if len(coords) >= 4:
            self.polys.append({'type': 'Polygon', 'coordinates': [coords + [coords[0]]],
                               'properties': {'osm_id': w.id, 'name': w.tags.get('name', '')}})


def main():
    pbf = r'C:\workspace\beibu-gulf-project\.tmp-pip\china.osm.pbf'
    outdir = r'C:\Users\JionHappY\Desktop\项目数据\多边形\工业园区'
    os.makedirs(outdir, exist_ok=True)
    idx_dir = r'C:\workspace\beibu-gulf-project\.tmp-pip'
    os.makedirs(idx_dir, exist_ok=True)

    handler = IndustrialHandler()
    handler.apply_file(pbf, locations=True, idx=f'sparse_file_array,{idx_dir}/industrial-idx.cache')

    fc = {'type': 'FeatureCollection',
          'features': [{'type': 'Feature', 'properties': f['properties'],
                        'geometry': {'type': f['type'], 'coordinates': f['coordinates']}} for f in handler.polys]}
    out = os.path.join(outdir, 'beibu-industrial.geojson')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f'industrial: {len(handler.polys)} features -> {out}')

    try:
        os.remove(f'{idx_dir}/industrial-idx.cache')
    except OSError:
        pass


if __name__ == '__main__':
    main()
