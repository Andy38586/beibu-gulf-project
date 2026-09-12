# -*- coding: utf-8 -*-
r"""
extract-roads-graph.py — 从 OSM PBF 抽取北部湾路网，并**按 OSM 节点 id 直接建图**（v2 质变管线）。

与旧管线 `extract-roads.py`（几何近似建拓扑）的三个本质区别：

  ① 属性：旧版每条 way 只导出 osm_id/name/highway，把 bridge/tunnel/layer/oneway/maxspeed
     全部丢弃（2026-09-12 复盘确认：这正是"国道下穿高速却直接拐上高速""高速可逆行"的根源）。
     本版把驾驶相关标签全部导出。
  ② 拓扑：旧版靠「端点投影切分 + 60m 网格并点」近似建网，天然会把上跨/下穿连成路口。
     本版按 OSM 语义建图：**way 之间共享 node id 才是真路口**，在路口处切分 way；
     上跨/下穿不共享 node → 天然不连通（layer/bridge/tunnel 只作渲染与规则，不参与连通性判断）。
  ③ 溯源：写出 meta（PBF 快照时间戳 / bbox / 计数 / 来源 / MD5），补上"不知道用的是哪版 OSM"的缺口。

输出（输出目录下五件产物）：
  beibu-roads-edges.geojson     每段一条 LineString。properties 见 EDGE_PROPS
  beibu-roads-vertices.geojson  每个路口/端点一个 Point，properties: node_id
  beibu-roads-edges.tsv         同上，制表符分隔——给 psql \copy 直灌（库容器内没有 ogr2ogr）
  beibu-roads-vertices.tsv
  beibu-roads-meta.json         快照时间戳 / bbox / 计数 / 源文件 / MD5 / 生成时间

用法（**可多输入**：省级抽取在省界处会截断，必须拼齐 bbox 相交的省才不会断路）:
  python extract-roads-graph.py <输出目录> <pbf> [<pbf> ...] [--bbox W,S,E,N]

多输入的两个要点：
  · 两遍扫描是**跨全部来源**的（不是每文件两遍）——路口判定必须看到所有省的 way；
  · 同一 way 会在相邻两省的抽取里各出现一次，按 (way_id, from_node, to_node) 去重。

注意（旧脚本同样踩过）：pyosmium 的 C++ 层不支持中文路径，输入 PBF 请先硬链接到纯 ASCII 路径，
例如:  mklink /H C:\\osm\\guangxi.osm.pbf "C:\\...\\路网\\OSM-Guangxi\\guangxi-20260912.osm.pbf"
"""
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import osmium

# 北部湾三市 + 走廊（与旧管线同 bbox：钦北防 + 南宁 + 平陆运河走廊）
DEFAULT_BBOX = (106.0, 20.0, 111.0, 24.0)  # west, south, east, north

# 不参与机动车路由的 highway 值（与旧管线同口径，避免可比性被改口径污染）
EXCLUDED_HIGHWAY = {
    'footway', 'path', 'cycleway', 'track', 'steps', 'bridleway',
    'pedestrian', 'corridor', 'elevator', 'escalator', 'proposed', 'razed',
}

# 逐段随行导出的驾驶相关标签（缺省一律 None，落地为 null）
# motor_vehicle/vehicle 比 access 更具体，且港口作业区常用 motor_vehicle=no —— 会直接决定可通行性
EDGE_PROPS = (
    'name', 'ref', 'highway', 'oneway', 'bridge', 'tunnel', 'layer',
    'maxspeed', 'access', 'junction', 'lanes', 'surface', 'toll',
    'motor_vehicle', 'vehicle',
)


def parse_oneway(tags):
    """OSM oneway 归一：1=正向单行，-1=反向单行，0=双向（含缺省）。"""
    v = tags.get('oneway')
    if v in ('yes', 'true', '1'):
        return 1
    if v in ('-1', 'reverse'):
        return -1
    # junction=roundabout 隐含单向（OSM 惯例）
    if tags.get('junction') == 'roundabout':
        return 1
    return 0


def parse_maxspeed(tags):
    """maxspeed 归一为 km/h 整数；'30 mph'/'none'/'signals' 等非常规值落 None。"""
    v = tags.get('maxspeed')
    if not v:
        return None
    v = v.strip().lower()
    for suffix in (' km/h', 'km/h', ' kph'):
        if v.endswith(suffix):
            v = v[: -len(suffix)]
            break
    try:
        return int(float(v))
    except ValueError:
        return None


def parse_layer(tags):
    try:
        return int(tags.get('layer', '0'))
    except (TypeError, ValueError):
        return 0


def is_bridge_or_tunnel(tags):
    """bridge/tunnel 的 OSM 取值约定：yes/viaduct/boardwalk/…、yes/culvert/…；no 为否。"""
    b = tags.get('bridge')
    t = tags.get('tunnel')
    return (b not in (None, 'no')) or (t not in (None, 'no'))


class Pass1NodeUsage(osmium.SimpleHandler):
    """第一遍：只统计 node 被多少条 highway way 引用（判路口用），不取坐标（省内存/时间）。"""

    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.usage = {}
        self.ways = 0

    def way(self, w):
        hw = w.tags.get('highway')
        if not hw or hw in EXCLUDED_HIGHWAY:
            return
        ok = False
        for n in w.nodes:
            if n.ref is not None:
                self.usage[n.ref] = self.usage.get(n.ref, 0) + 1
                ok = True
        if ok:
            self.ways += 1


class Pass2BuildGraph(osmium.SimpleHandler):
    """第二遍：带坐标解析 way，在"路口 node"处切段，产出 edges 与 vertices。"""

    def __init__(self, bbox, usage):
        super().__init__()
        self.bbox = bbox
        self.usage = usage
        self.edges = []
        self.vertices = {}          # node_id -> (lon, lat)
        self.in_bbox_ways = 0
        self.skipped_no_geom = 0
        self.seen_edges = set()     # (way_id, from_node, to_node) 跨来源去重
        self.dup_edges = 0

    def _in_bbox(self, lon, lat):
        w, s, e, n = self.bbox
        return w <= lon <= e and s <= lat <= n

    def way(self, w):
        tags = w.tags
        hw = tags.get('highway')
        if not hw or hw in EXCLUDED_HIGHWAY:
            return

        # 坐标 + node id 一一对应（locations=True 保证 location 有效）
        seq = []
        for nd in w.nodes:
            loc = nd.location
            if not loc.valid():
                self.skipped_no_geom += 1
                continue
            seq.append((nd.ref, round(loc.lon, 7), round(loc.lat, 7)))
        if len(seq) < 2:
            return
        # bbox 过滤：任一节点落入 bbox 才保留（与旧管线同口径）
        if not any(self._in_bbox(lon, lat) for _, lon, lat in seq):
            return
        self.in_bbox_ways += 1

        n = len(seq)
        tags_out = {k: tags.get(k) for k in EDGE_PROPS}
        tags_out['oneway'] = parse_oneway(tags)
        tags_out['maxspeed'] = parse_maxspeed(tags)
        tags_out['layer'] = parse_layer(tags)
        tags_out['bridge'] = is_bridge_or_tunnel(tags) and tags.get('bridge') not in (None, 'no')
        tags_out['tunnel'] = is_bridge_or_tunnel(tags) and tags.get('tunnel') not in (None, 'no')
        tags_out['lanes'] = tags.get('lanes')

        # 切分点：way 两端 + 被其他 way 共享的 node（真路口）
        cut_idx = [0]
        for i in range(1, n - 1):
            if self.usage.get(seq[i][0], 0) >= 2:
                cut_idx.append(i)
        cut_idx.append(n - 1)

        for seg_i, (a, b) in enumerate(zip(cut_idx, cut_idx[1:])):
            if b <= a:
                continue
            seg = seq[a : b + 1]
            # 图顶点 = 切分点（路口或 way 端点）。段内中间节点只是几何形状点，
            # 不是图顶点——旧实现把它们也塞进 vertices，1.6M 行里九成是路中弯点。
            for node_id, lon, lat in (seg[0], seg[-1]):
                self.vertices.setdefault(node_id, (lon, lat))
            edge_key = (w.id, seg[0][0], seg[-1][0])
            if edge_key in self.seen_edges:
                # 邻省抽取里同一 way 的同一段（省界两侧都会包含跨省 way）
                self.dup_edges += 1
                continue
            self.seen_edges.add(edge_key)
            props = dict(tags_out)
            props.update(
                {
                    'way_id': w.id,
                    'seg': seg_i,
                    'from_node': seg[0][0],
                    'to_node': seg[-1][0],
                    'node_count': len(seg),
                    'straight': b == a + 1,  # 相邻路口直连（无中间形状点），可作建网质量探针
                }
            )
            self.edges.append(
                {
                    'type': 'LineString',
                    'coordinates': [[lon, lat] for _, lon, lat in seg],
                    'properties': props,
                }
            )


def file_md5(path, chunk=1 << 20):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(chunk), b''):
            h.update(block)
    return h.hexdigest()


def main():
    argv = list(sys.argv[1:])
    bbox = DEFAULT_BBOX
    if '--bbox' in argv:
        i = argv.index('--bbox')
        bbox = tuple(float(x) for x in argv[i + 1].split(','))
        del argv[i : i + 2]
    if len(argv) < 2:
        print(__doc__)
        sys.exit(1)
    outdir, pbfs = argv[0], argv[1:]

    for pbf in pbfs:
        try:
            pbf.encode('ascii')
        except UnicodeEncodeError:
            print('[FATAL] 输入 PBF 路径含非 ASCII 字符，pyosmium 的 C++ 层不支持。')
            print('        请先硬链接到纯 ASCII 路径后再跑，例如：')
            print('        cmd /c mklink /H C:\\osm\\roads.osm.pbf "<原路径>"')
            sys.exit(2)

    os.makedirs(outdir, exist_ok=True)

    # 读头部元信息（快照时间戳）——补上"不知道数据是哪一版"的溯源缺口
    sources = []
    for pbf in pbfs:
        reader = osmium.io.Reader(pbf)
        header = reader.header()
        sources.append(
            {
                'file': os.path.basename(pbf),
                'md5': file_md5(pbf),
                'osm_snapshot': header.get('osmosis_replication_timestamp')
                or header.get('timestamp')
                or None,
            }
        )
        reader.close()
    snapshot = max((s['osm_snapshot'] or '' for s in sources), default='') or None

    # 两遍扫描都是**跨全部来源**的：路口判定要看到所有省的 way，否则省界附近
    # 「只被邻省 way 共享」的 node 会被判成非路口 → 路网恰好在省界断开。
    print(f'[1/2] 统计 node 引用（判路口）… bbox={bbox}，来源 {len(pbfs)} 个文件')
    p1 = Pass1NodeUsage(bbox)
    for pbf in pbfs:
        p1.apply_file(pbf, locations=False)
    junctions = sum(1 for v in p1.usage.values() if v >= 2)
    print(f'      highway way {p1.ways} 条；被引用 node {len(p1.usage)} 个，其中共享(路口) {junctions} 个')

    print('[2/2] 解析坐标并在路口切段…')
    p2 = Pass2BuildGraph(bbox, p1.usage)
    for pbf in pbfs:
        p2.apply_file(pbf, locations=True)

    edges = p2.edges
    vertices = p2.vertices

    edges_path = os.path.join(outdir, 'beibu-roads-edges.geojson')
    verts_path = os.path.join(outdir, 'beibu-roads-vertices.geojson')
    meta_path = os.path.join(outdir, 'beibu-roads-meta.json')

    with open(edges_path, 'w', encoding='utf-8') as f:
        json.dump(
            {
                'type': 'FeatureCollection',
                'features': [
                    {'type': 'Feature', 'properties': e['properties'], 'geometry': {
                        'type': 'LineString', 'coordinates': e['coordinates']}}
                    for e in edges
                ],
            },
            f,
            ensure_ascii=False,
        )
    with open(verts_path, 'w', encoding='utf-8') as f:
        json.dump(
            {
                'type': 'FeatureCollection',
                'features': [
                    {'type': 'Feature', 'properties': {'node_id': nid},
                     'geometry': {'type': 'Point', 'coordinates': [lon, lat]}}
                    for nid, (lon, lat) in sorted(vertices.items())
                ],
            },
            f,
            ensure_ascii=False,
        )

    # 装载格式：GeoJSON 给人/QGIS 看，TSV 给 psql \copy 直灌用（容器内无 ogr2ogr，
    # 走上层脚本生成、`\copy ... FORMAT csv, DELIMITER E'\t'` 落库，避免为一次性导入给容器装 GDAL）
    write_tsv_edges = os.path.join(outdir, 'beibu-roads-edges.tsv')
    with open(write_tsv_edges, 'w', encoding='utf-8', newline='') as f:
        wr = csv.writer(f, dialect='excel-tab', quoting=csv.QUOTE_MINIMAL)
        wr.writerow(
            ['osm_way_id', 'seg', 'from_node', 'to_node', 'highway', 'name', 'ref',
             'oneway', 'bridge', 'tunnel', 'layer', 'maxspeed', 'lanes', 'surface',
             'toll', 'access', 'junction', 'motor_vehicle', 'vehicle', 'node_count', 'wkt']
        )
        for e in edges:
            p = e['properties']
            wkt = 'LINESTRING(' + ','.join(f'{lon} {lat}' for lon, lat in e['coordinates']) + ')'
            wr.writerow([
                p['way_id'], p['seg'], p['from_node'], p['to_node'], p['highway'],
                p['name'] or '', p['ref'] or '', p['oneway'],
                1 if p['bridge'] else 0, 1 if p['tunnel'] else 0, p['layer'],
                p['maxspeed'] if p['maxspeed'] is not None else '',
                p['lanes'] or '', p['surface'] or '', p['toll'] or '',
                p['access'] or '', p['junction'] or '',
                p['motor_vehicle'] or '', p['vehicle'] or '', p['node_count'], wkt,
            ])

    verts_tsv = os.path.join(outdir, 'beibu-roads-vertices.tsv')
    with open(verts_tsv, 'w', encoding='utf-8', newline='') as f:
        wr = csv.writer(f, dialect='excel-tab', quoting=csv.QUOTE_MINIMAL)
        wr.writerow(['node_id', 'wkt'])
        for nid, (lon, lat) in sorted(vertices.items()):
            wr.writerow([nid, f'POINT({lon} {lat})'])

    oneway_fwd = sum(1 for e in edges if e['properties']['oneway'] == 1)
    oneway_rev = sum(1 for e in edges if e['properties']['oneway'] == -1)
    bridge = sum(1 for e in edges if e['properties']['bridge'])
    tunnel = sum(1 for e in edges if e['properties']['tunnel'])
    maxspeed = sum(1 for e in edges if e['properties']['maxspeed'])
    meta = {
        'sources': sources,
        'osm_snapshot': snapshot,
        'bbox': list(bbox),
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'highway_ways_in_bbox': p2.in_bbox_ways,
        'edges': len(edges),
        'duplicate_edges_dropped': p2.dup_edges,
        'vertices': len(vertices),
        'junctions_shared_nodes': junctions,
        'oneway_forward': oneway_fwd,
        'oneway_reverse': oneway_rev,
        'bridge_edges': bridge,
        'tunnel_edges': tunnel,
        'maxspeed_edges': maxspeed,
        'skipped_invalid_geometry': p2.skipped_no_geom,
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f'      edges    : {len(edges)} -> {edges_path}')
    print(f'      vertices : {len(vertices)} -> {verts_path}')
    print(f'      跨省去重 : {p2.dup_edges} 段（同一 way 在邻省抽取中重复）')
    print(f'      单行     : 正向 {oneway_fwd} / 反向 {oneway_rev}（旧管线为 0：oneway 全丢）')
    print(f'      桥/隧    : {bridge} / {tunnel}（旧管线为 0：属性全丢）')
    print(f'      maxspeed : {maxspeed} 条有真值')
    print(f'      OSM 快照 : {snapshot}')
    print(f'      meta     : {meta_path}')


if __name__ == '__main__':
    main()
