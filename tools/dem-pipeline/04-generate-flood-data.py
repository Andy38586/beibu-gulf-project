# -*- coding: utf-8 -*-
# =============================================================================
# 04-generate-flood-data.py
# DEM 洪涝派生数据生成 - 从 dem_4326.tif 生成真洪涝数据，替换 4 个 mock JSON
# =============================================================================
# 说明：
#   将 WebGIS 从「手编 JSON 驱动」升级为「真 DEM 驱动」。
#   保持 4 个 JSON 的契约结构（字段名/嵌套）完全不变，只替换内容为 DEM 派生数据，
#   让前端零改动。
#
# 输入：backend/data/flood/dem/dem_4326.tif (EPSG:4326, 10972x7552, Int16, NoData=32767)
# 输出（覆盖原文件）：
#   - backend/data/flood/facilityPoints.json   (设施点高程用 DEM 采样)
#   - backend/data/flood/floodArea.json        (淹没多边形用 DEM mask 多边形化)
#   - backend/data/flood/floodStatistics.json  (统计用 DEM mask 像元统计)
#   - backend/data/flood/terrainProfile.json   (剖面点高程用 DEM 采样)
#
# 运行：& 'C:\Program Files\QGIS 3.44.12\bin\python-qgis-ltr.bat' 04-generate-flood-data.py
# =============================================================================
import os
import sys
import json
import math
import numpy as np
from osgeo import gdal, ogr, osr

# --- 全局配置 ---
BASE_DIR = r'c:\mypython\beibu-gulf-project\backend\data\flood'
DEM_PATH = os.path.join(BASE_DIR, 'dem', 'dem_4326.tif')
TODAY = '2026-08-01'
NODATA = 32767

# 港口分类范围 (lng_min, lng_max, lat_min, lat_max)
PORT_BOUNDS = [
    ('钦州港', 108.5, 108.7, 21.7, 22.0),
    ('防城港', 108.2, 108.5, 21.5, 21.8),
    ('北海港', 109.0, 109.2, 21.3, 21.6),
]

# 水位档位 -> 风险等级 -> riskLevelCode
LEVELS = [
    (0,  '无风险',   0),
    (2,  '低风险',   1),
    (5,  '中风险',   2),
    (8,  '高风险',   3),
    (10, '极高风险', 4),
    (15, '灾难级',   5),
]

# 多边形处理参数
DOWNSAMPLE_FACTOR = 4         # mask 降采样因子（原像元~30m, 降采样后~120m, 简化后足够）
SIMPLIFY_TOLERANCE = 0.001    # 简化容差（度, ~111m）
MIN_AREA_KM2 = 0.01           # 丢弃 < 0.01 km² 的碎面
MAX_POLYGONS_PER_LEVEL = 30   # 每档最多保留 30 个多边形（取面积最大者）
COORD_DECIMALS = 6            # GeoJSON 坐标保留 6 位小数（~0.1m 精度）


# =============================================================================
# 工具函数
# =============================================================================

def classify_port(lng, lat):
    """按坐标判断所属港口，不在三港范围内标 '沿海区域'。"""
    for name, lng_min, lng_max, lat_min, lat_max in PORT_BOUNDS:
        if lng_min <= lng <= lng_max and lat_min <= lat <= lat_max:
            return name
    return '沿海区域'


def area_deg2_to_km2(area_deg2, lat_deg):
    """球面近似：面积(度²) -> km²。
    dA = R² * cos(lat) * dlon * dlat，1°×1°@赤道 ≈ 12364 km²。
    """
    R_km = 6371.0
    rad_per_deg = math.pi / 180.0
    return area_deg2 * (rad_per_deg * R_km) ** 2 * math.cos(math.radians(lat_deg))


def round_coords(coords, decimals=COORD_DECIMALS):
    """递归圆整坐标值，减少 GeoJSON 体积。"""
    if isinstance(coords, list):
        if len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords):
            return [round(coords[0], decimals), round(coords[1], decimals)]
        return [round_coords(c, decimals) for c in coords]
    return coords


def write_json(path, data):
    """UTF-8, 2空格缩进, ensure_ascii=False 写出 JSON。"""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = os.path.getsize(path) / 1024.0
    print(f'    已写入: {path} ({size_kb:.1f} KB)')
    return size_kb


# =============================================================================
# DEM 处理器
# =============================================================================

class DEMProcessor:
    """加载 DEM，提供高程采样和洪涝 mask 计算能力。"""

    def __init__(self, dem_path):
        print(f'加载 DEM: {dem_path}')
        gdal.SetConfigOption('GDAL_CACHEMAX', '512')
        self.ds = gdal.Open(dem_path)
        if self.ds is None:
            raise RuntimeError(f'无法打开 DEM: {dem_path}')
        self.band = self.ds.GetRasterBand(1)
        self.gt = self.ds.GetGeoTransform()
        self.srs = osr.SpatialReference()
        self.srs.ImportFromWkt(self.ds.GetProjectionRef())
        self.nodata = int(self.band.GetNoDataValue())
        self.cols = self.ds.RasterXSize
        self.rows = self.ds.RasterYSize
        print(f'  尺寸: {self.cols}x{self.rows}, NoData={self.nodata}')
        print(f'  Origin=({self.gt[0]:.6f}, {self.gt[3]:.6f}), '
              f'PixelSize=({self.gt[1]:.8f}, {self.gt[5]:.8f})')

        print('  读取 DEM 数组到内存...')
        # 用 int32 避免 NoData=32767 与正常值比较时的类型问题
        self.array = self.band.ReadAsArray().astype(np.int32)
        print(f'  DEM 数组加载完成, shape={self.array.shape}, dtype={self.array.dtype}')

        # 像元面积 (km²)，用 DEM 中纬度近似
        mid_lat = (self.gt[3] + self.gt[3] + self.gt[5] * self.rows) / 2.0
        pixel_size_deg = abs(self.gt[1])
        self.pixel_area_km2 = area_deg2_to_km2(pixel_size_deg ** 2, mid_lat)
        print(f'  像元面积: ~{self.pixel_area_km2:.6f} km² (mid_lat={mid_lat:.2f})')

        # 统计 DEM 值范围（排除 NoData）
        valid = self.array[self.array != self.nodata]
        if len(valid) > 0:
            print(f'  高程范围: {valid.min()}m ~ {valid.max()}m '
                  f'(有效像元 {len(valid)}/{self.array.size})')

    def sample_elevation(self, lng, lat):
        """在 (lng, lat) 采样高程。
        返回 (elevation, source):
          source='dem'       直接采样成功
          source='3x3'       像元是 NoData，用 3x3 窗口均值回退
          source='nodata'    3x3 窗口也全是 NoData
          source='out_of_bounds' 坐标超出 DEM 范围
        """
        col = int((lng - self.gt[0]) / self.gt[1])
        line = int((lat - self.gt[3]) / self.gt[5])
        if col < 0 or col >= self.cols or line < 0 or line >= self.rows:
            return None, 'out_of_bounds'

        val = int(self.array[line, col])
        if val != self.nodata:
            return float(val), 'dem'

        # NoData 回退：3x3 窗口均值
        vals = []
        for dl in range(-1, 2):
            for dc in range(-1, 2):
                c = col + dc
                l = line + dl
                if 0 <= c < self.cols and 0 <= l < self.rows:
                    v = int(self.array[l, c])
                    if v != self.nodata:
                        vals.append(v)
        if vals:
            return round(sum(vals) / len(vals), 1), '3x3'
        return None, 'nodata'

    def compute_flood_mask(self, level):
        """计算洪涝 mask: (DEM <= level) AND (DEM != NoData)。"""
        mask = (self.array <= level) & (self.array != self.nodata)
        count = int(mask.sum())
        area_km2 = count * self.pixel_area_km2
        print(f'    淹没像元数={count}, 像元面积~{area_km2:.2f} km²')
        return mask

    def compute_depth_stats(self, level):
        """从 DEM mask 像元统计水深。
        depth = level - elevation（仅对 mask 内像元）。
        返回 (average_depth, max_depth)。
        """
        mask = (self.array <= level) & (self.array != self.nodata)
        if not mask.any():
            return 0.0, 0.0
        depths = level - self.array[mask]
        depths = depths[depths >= 0]  # 安全过滤
        if len(depths) == 0:
            return 0.0, 0.0
        return float(depths.mean()), float(depths.max())

    def polygonize_mask(self, mask, level):
        """将 mask 多边形化为 GeoJSON Feature 列表。
        步骤：降采样 -> gdal.Polygonize -> Simplify -> 拆分 MultiPolygon -> 面积过滤 -> 取 topN。
        返回 list of {geometry, area_km2, centroid_lng, centroid_lat}。
        """
        # --- 降采样（max pooling，保留淹没范围不缩小）---
        factor = DOWNSAMPLE_FACTOR
        h, w = mask.shape
        new_h = h // factor
        new_w = w // factor
        mask_trimmed = mask[:new_h * factor, :new_w * factor]
        mask_ds = mask_trimmed.reshape(new_h, factor, new_w, factor).any(axis=(1, 3))

        new_gt = (self.gt[0], self.gt[1] * factor, self.gt[2],
                  self.gt[3], self.gt[4], self.gt[5] * factor)

        # --- 创建内存栅格 ---
        mem_drv = gdal.GetDriverByName('MEM')
        raster_ds = mem_drv.Create('', new_w, new_h, 1, gdal.GDT_Byte)
        raster_ds.SetGeoTransform(new_gt)
        raster_ds.SetProjection(self.srs.ExportToWkt())
        raster_band = raster_ds.GetRasterBand(1)
        raster_band.WriteArray(mask_ds.astype(np.uint8))
        raster_band.SetNoDataValue(0)

        # --- 创建内存矢量图层 ---
        vec_drv = ogr.GetDriverByName('Memory')
        vec_ds = vec_drv.CreateDataSource('mem')
        vec_layer = vec_ds.CreateLayer('poly', srs=self.srs, geom_type=ogr.wkbPolygon)
        vec_layer.CreateField(ogr.FieldDefn('DN', ogr.OFTInteger))

        # --- 多边形化 ---
        print(f'    多边形化 (降采样 factor={factor}, size={new_w}x{new_h})...')
        gdal.Polygonize(raster_band, raster_band, vec_layer, 0, ['8CONNECTED=8'])

        # --- 收集并处理多边形 ---
        raw_geoms = []
        for feat in vec_layer:
            if feat.GetField('DN') != 1:
                continue
            geom = feat.GetGeometryRef().Clone()
            geom_simp = geom.Simplify(SIMPLIFY_TOLERANCE)
            if geom_simp is None or geom_simp.IsEmpty():
                continue
            gtype = geom_simp.GetGeometryType()
            # 拆分 MultiPolygon 为单独 Polygon
            if gtype in (ogr.wkbMultiPolygon, ogr.wkbMultiPolygon25D):
                for i in range(geom_simp.GetGeometryCount()):
                    part = geom_simp.GetGeometryRef(i).Clone()
                    if not part.IsEmpty():
                        raw_geoms.append(part)
            else:
                raw_geoms.append(geom_simp)

        # 清理 GDAL 内存对象
        vec_ds = None
        raster_ds = None

        # --- 计算面积、过滤碎面 ---
        polygons = []
        for geom in raw_geoms:
            centroid = geom.Centroid()
            cx, cy = centroid.GetX(), centroid.GetY()
            area_deg2 = geom.GetArea()
            area_km2 = area_deg2_to_km2(area_deg2, cy)
            if area_km2 < MIN_AREA_KM2:
                continue
            polygons.append({
                'geometry': geom,
                'area_km2': area_km2,
                'centroid_lng': cx,
                'centroid_lat': cy,
            })

        # --- 按面积降序，保留 top N ---
        polygons.sort(key=lambda p: p['area_km2'], reverse=True)
        if len(polygons) > MAX_POLYGONS_PER_LEVEL:
            print(f'    多边形数={len(polygons)} (> {MAX_POLYGONS_PER_LEVEL}), '
                  f'保留面积最大的前 {MAX_POLYGONS_PER_LEVEL} 个')
            polygons = polygons[:MAX_POLYGONS_PER_LEVEL]
        else:
            print(f'    合格多边形数={len(polygons)}')

        return polygons


# =============================================================================
# JSON 处理函数
# =============================================================================

def process_facility_points(dem):
    """1. facilityPoints.json: 用 DEM 采样高程更新 elevation 字段。"""
    print('\n=== [1/4] 处理 facilityPoints.json ===')
    path = os.path.join(BASE_DIR, 'facilityPoints.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    nodata_count = 0
    fallback_count = 0
    for facility in data['facilities']:
        lng = facility['lng']
        lat = facility['lat']
        old_elev = facility['elevation']
        elev, source = dem.sample_elevation(lng, lat)
        if elev is None:
            # 保留原 elevation
            print(f'  {facility["id"]} {facility["name"]}: '
                  f'NoData/越界, 保留原值 {old_elev}')
            nodata_count += 1
        else:
            facility['elevation'] = round(elev, 1)
            note = '' if source == 'dem' else f' (回退: {source})'
            if source != 'dem':
                fallback_count += 1
            print(f'  {facility["id"]} {facility["name"]}: '
                  f'{old_elev} -> {facility["elevation"]}{note}')

    data['metadata']['updatedAt'] = TODAY
    print(f'  汇总: NoData保留原值={nodata_count}, 3x3回退={fallback_count}')

    write_json(path, data)
    return data


def process_terrain_profile(dem):
    """2. terrainProfile.json: 用 DEM 采样高程更新每个 point 的 elevation。"""
    print('\n=== [2/4] 处理 terrainProfile.json ===')
    path = os.path.join(BASE_DIR, 'terrainProfile.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    nodata_count = 0
    fallback_count = 0
    for profile in data['profiles']:
        print(f'  剖面: {profile["name"]} ({len(profile["points"])} 点)')
        for point in profile['points']:
            lng = point['lng']
            lat = point['lat']
            old_elev = point['elevation']
            elev, source = dem.sample_elevation(lng, lat)
            if elev is None:
                print(f'    distance={point["distance"]}: NoData, 保留原值 {old_elev}')
                nodata_count += 1
            else:
                point['elevation'] = round(elev, 1)
                if source != 'dem':
                    fallback_count += 1

    print(f'  汇总: NoData保留原值={nodata_count}, 3x3回退={fallback_count}')
    write_json(path, data)
    return data


def process_flood_area(dem):
    """3. floodArea.json: 对每个水位档位，DEM mask 多边形化为 GeoJSON。"""
    print('\n=== [3/4] 处理 floodArea.json ===')
    path = os.path.join(BASE_DIR, 'floodArea.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 更新 metadata
    data['metadata']['updatedAt'] = TODAY
    data['metadata']['description'] = \
        '北部湾港不同水位对应的淹没范围GeoJSON数据（DEM派生），用于Cesium渲染'

    flood_zones = []
    level_areas = {}  # level -> 多边形总面积 km²（供 statistics 使用）
    for level, risk, code in LEVELS:
        print(f'\n  --- 水位 {level}m ({risk}) ---')

        zone = {
            'waterLevel': level,
            'riskLevel': risk,
            'features': []
        }

        if level == 0:
            # 0m 无风险，features 为空数组
            print('    无风险，features=[]')
            level_areas[level] = 0.0
            flood_zones.append(zone)
            continue

        # 计算 mask
        mask = dem.compute_flood_mask(level)
        if not mask.any():
            print('    无淹没像元，features=[]')
            level_areas[level] = 0.0
            flood_zones.append(zone)
            continue

        # 多边形化
        polygons = dem.polygonize_mask(mask, level)

        # 构建 GeoJSON Feature
        for i, poly in enumerate(polygons):
            port = classify_port(poly['centroid_lng'], poly['centroid_lat'])
            area_name = f'{port}{level}m淹没区'
            if len(polygons) > 1:
                area_name += f'_{i + 1}'

            geom_json = json.loads(poly['geometry'].ExportToJson())
            geom_json['coordinates'] = round_coords(geom_json['coordinates'])

            feature = {
                'type': 'Feature',
                'properties': {
                    'port': port,
                    'areaName': area_name,
                    'waterLevel': level
                },
                'geometry': geom_json
            }
            zone['features'].append(feature)

        total_area = sum(p['area_km2'] for p in polygons)
        level_areas[level] = total_area
        print(f'    输出要素数={len(zone["features"])}, '
              f'多边形总面积~{total_area:.2f} km²')
        flood_zones.append(zone)

    data['floodZones'] = flood_zones

    size_kb = write_json(path, data)
    if size_kb > 5 * 1024:
        print(f'    警告: 文件 {size_kb:.1f} KB 超过 5MB!')

    # 返回每档多边形总面积（供 statistics 使用，保持与 floodArea.json 一致）
    return data, level_areas


def process_flood_statistics(dem, facility_data, level_areas):
    """4. floodStatistics.json: 从 DEM mask 像元统计 + 设施影响统计。
    floodArea 使用 floodArea.json 多边形总面积（level_areas）。
    """
    print('\n=== [4/4] 处理 floodStatistics.json ===')
    path = os.path.join(BASE_DIR, 'floodStatistics.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    facilities = facility_data['facilities']

    # 原始描述风格模板（用于保持风格一致）
    DESC_TEMPLATES = {
        0:  '正常潮位，无淹没风险',
        2:  '低潮位附近，部分低洼码头区域开始受影响',
        5:  '接近设计高潮位，码头前沿作业区和部分仓储区受淹',
        8:  '超过设计高潮位，港口作业区大面积受淹，油库区域面临威胁',
        10: '风暴潮叠加高潮位，港口设施严重受损，内陆区域开始受淹',
        15: '极端洪水情景，三港全面受淹，周边城镇低洼区域严重内涝',
    }

    statistics = []
    for level, risk, code in LEVELS:
        print(f'\n  --- 水位 {level}m ({risk}, code={code}) ---')

        if level == 0:
            stat = {
                'waterLevel': 0,
                'riskLevel': '无风险',
                'riskLevelCode': 0,
                'floodArea': 0,
                'averageDepth': 0,
                'maxDepth': 0,
                'affectedFacilities': 0,
                'affectedPorts': [],
                'estimatedLoss': 0,
                'description': DESC_TEMPLATES[0]
            }
            statistics.append(stat)
            print('    无风险，全部为 0')
            continue

        # 水深统计（从 DEM mask 像元）
        avg_depth, max_depth = dem.compute_depth_stats(level)
        print(f'    平均水深: {avg_depth:.2f}m, 最大水深: {max_depth:.2f}m')

        # 淹没面积（从 floodArea.json 多边形总面积，保持与可视化一致）
        flood_area = level_areas.get(level, 0.0)
        print(f'    淹没面积(多边形): {flood_area:.2f} km²')

        # 受影响设施（elevation <= level）
        affected = [f for f in facilities
                    if f['elevation'] is not None and f['elevation'] <= level]
        affected_ports = list(dict.fromkeys(f['port'] for f in affected))
        estimated_loss = round(sum(f['value'] * f['damageRate'] for f in affected))
        print(f'    受影响设施: {len(affected)}, 港口: {affected_ports}, '
              f'损失: {estimated_loss} 万元')

        # 描述：保留原风格，追加数值
        desc = DESC_TEMPLATES[level]
        desc += f'，淹没面积约{flood_area:.1f}km²'
        if len(affected) > 0:
            desc += f'，受影响设施{len(affected)}处'

        stat = {
            'waterLevel': level,
            'riskLevel': risk,
            'riskLevelCode': code,
            'floodArea': round(flood_area, 2),
            'averageDepth': round(avg_depth, 2),
            'maxDepth': round(max_depth, 2),
            'affectedFacilities': len(affected),
            'affectedPorts': affected_ports,
            'estimatedLoss': estimated_loss,
            'description': desc
        }
        statistics.append(stat)

    data['statistics'] = statistics

    write_json(path, data)
    return data


# =============================================================================
# 主函数
# =============================================================================

def main():
    print('=' * 70)
    print('DEM 洪涝派生数据生成脚本')
    print(f'  日期: {TODAY}')
    print(f'  DEM:  {DEM_PATH}')
    print(f'  输出: {BASE_DIR}\\*.json (覆盖原文件)')
    print('=' * 70)

    # 加载 DEM
    dem = DEMProcessor(DEM_PATH)

    # 按依赖顺序处理 4 个 JSON
    # 1. facilityPoints（先做，statistics 依赖更新后的 elevation）
    facility_data = process_facility_points(dem)

    # 2. terrainProfile（独立，只采样高程）
    process_terrain_profile(dem)

    # 3. floodArea（多边形化，核心）
    flood_area_data, level_areas = process_flood_area(dem)

    # 4. floodStatistics（依赖 facilityPoints 的更新高程 + floodArea 多边形面积）
    process_flood_statistics(dem, facility_data, level_areas)

    # 汇总
    print('\n' + '=' * 70)
    print('全部完成！文件体积汇总：')
    print('-' * 70)
    total = 0
    for name in ['facilityPoints.json', 'terrainProfile.json',
                 'floodArea.json', 'floodStatistics.json']:
        p = os.path.join(BASE_DIR, name)
        size = os.path.getsize(p)
        total += size
        print(f'  {name:25s}  {size / 1024:>10.1f} KB')
    print(f'  {"合计":25s}  {total / 1024:>10.1f} KB')
    print('=' * 70)


if __name__ == '__main__':
    main()
