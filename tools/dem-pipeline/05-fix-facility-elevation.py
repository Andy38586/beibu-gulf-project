"""
修正设施点高程：取设施点周围 5x5 像元（150m×150m）的最小高程。

背景：ASTER GDEM 30m 像元反映地形网格均值，港口设施建在填海区低地，
直接采样返回 17m（像元含周围高地）。取局部最小值更接近设施实际高程。

修正后重新计算 floodStatistics 的 affectedFacilities/affectedPorts/estimatedLoss。
"""
import json
import sys
from pathlib import Path

from osgeo import gdal

# 常量
DEM_PATH = str(Path(__file__).resolve().parents[2] / 'backend' / 'data' / 'flood' / 'dem' / 'dem_4326.tif')
FACILITY_PATH = str(Path(__file__).resolve().parents[2] / 'backend' / 'data' / 'flood' / 'facilityPoints.json')
STATS_PATH = str(Path(__file__).resolve().parents[2] / 'backend' / 'data' / 'flood' / 'floodStatistics.json')
WINDOW = 2  # 5x5 像元窗口（±2 像元 = ±60m）


def sample_min(band, gt, nodata, lng, lat, xsize, ysize, window=WINDOW):
    """取设施点周围 (2*window+1)x(2*window+1) 像元的最小有效高程"""
    px = int((lng - gt[0]) / gt[1])
    py = int((lat - gt[3]) / gt[5])
    values = []
    for dx in range(-window, window + 1):
        for dy in range(-window, window + 1):
            x, y = px + dx, py + dy
            if 0 <= x < xsize and 0 <= y < ysize:
                val = band.ReadAsArray(x, y, 1, 1)[0][0]
                if val != nodata:
                    values.append(float(val))
    return min(values) if values else None


def main():
    dem = gdal.Open(DEM_PATH)
    if not dem:
        print(f'FATAL: 无法打开 DEM {DEM_PATH}', file=sys.stderr)
        sys.exit(1)
    band = dem.GetRasterBand(1)
    gt = dem.GetGeoTransform()
    nodata = band.GetNoDataValue()
    xsize, ysize = dem.RasterXSize, dem.RasterYSize
    print(f'DEM: {xsize}x{ysize}, NoData={nodata}, 像元={gt[1]:.6f}°')

    # 修正 facilityPoints
    with open(FACILITY_PATH, 'r', encoding='utf-8') as f:
        fac_data = json.load(f)

    old_to_new = []
    for fac in fac_data['facilities']:
        old_elev = fac['elevation']
        new_elev = sample_min(band, gt, nodata, fac['lng'], fac['lat'], xsize, ysize)
        if new_elev is not None:
            fac['elevation'] = round(new_elev, 1)
        old_to_new.append((fac['name'], old_elev, fac['elevation']))

    fac_data['metadata']['updatedAt'] = '2026-08-01'
    fac_data['metadata']['description'] = '北部湾港风险影响设施点数据（DEM 5x5最小值采样高程）'

    with open(FACILITY_PATH, 'w', encoding='utf-8') as f:
        json.dump(fac_data, f, ensure_ascii=False, indent=2)

    print('\n设施高程修正（原值 → 5x5最小值）:')
    for name, old, new in old_to_new[:8]:
        print(f'  {name}: {old}m → {new}m')
    if len(old_to_new) > 8:
        print(f'  ... 共 {len(old_to_new)} 个设施')

    # 重新计算 floodStatistics
    with open(STATS_PATH, 'r', encoding='utf-8') as f:
        stats = json.load(f)

    print('\n各档位受影响设施（修正后）:')
    for s in stats['statistics']:
        level = s['waterLevel']
        affected = [f for f in fac_data['facilities'] if f['elevation'] <= level]
        s['affectedFacilities'] = len(affected)
        s['affectedPorts'] = list(dict.fromkeys(f['port'] for f in affected))  # 去重保序
        s['estimatedLoss'] = round(sum(f['value'] * f['damageRate'] for f in affected))
        print(f'  {level}m: affected={s["affectedFacilities"]} ports={s["affectedPorts"]} loss={s["estimatedLoss"]}万')

    stats['metadata']['updatedAt'] = '2026-08-01'

    with open(STATS_PATH, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print('\n完成: facilityPoints.json + floodStatistics.json 已更新')


if __name__ == '__main__':
    main()
