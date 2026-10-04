# -*- coding: utf-8 -*-
"""14-bathy-fuse 的判据（pytest，跑在 dem-pipeline venv）。

钉的是 `docs/近岸测深数据需求-2026-10-04.md` 的四条红线与两条换算路径：
拒收（缺来源/缺基准/分辨率超标/零覆盖/无 CRS）、LLD→EGM96 换算、融合只作用在海侧有效格。
夹具全部在 pytest tmp_path，合成、小尺寸，不与任何生产数据同值。
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform as warp_transform
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'tools/dem-pipeline' / '14-bathy-fuse.py'
N = 20
RES = 30.0
SEA_VALUE = -20.0
BATHY_VALUE = -12.0


def load_module():
    spec = importlib.util.spec_from_file_location('bathy_fuse', SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_cli(*args):
    return subprocess.run([sys.executable, '-X', 'utf8', str(SCRIPT), *args],
                          capture_output=True, text=True, encoding='utf-8')


def sea_bounds_4326(tr):
    return transform_bounds('EPSG:32648', 'EPSG:4326',
                            *rasterio.transform.array_bounds(N, N, tr))


def make_sea(path: Path):
    """20×20 / 30m / UTM48N，左上 3×3 置 NaN 模拟非海区（陆或未覆盖海）。"""
    cx, cy = warp_transform('EPSG:4326', 'EPSG:32648', [108.60], [21.70])
    x0 = cx[0] - N * RES / 2.0
    y0 = cy[0] + N * RES / 2.0
    tr = from_origin(x0, y0, RES, RES)
    arr = np.full((N, N), SEA_VALUE, dtype='float32')
    arr[0:3, 0:3] = np.nan
    with rasterio.open(path, 'w', driver='GTiff', width=N, height=N, count=1,
                       dtype='float32', crs='EPSG:32648', transform=tr,
                       nodata=float('nan')) as ds:
        ds.write(arr, 1)
    return tr


def make_bathy_grid(path: Path, tr, value=BATHY_VALUE, res_deg=0.0005, pad=0.02,
                    crs='EPSG:4326'):
    x0, y0, x1, y1 = sea_bounds_4326(tr)
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    width = int(np.ceil((x1 - x0) / res_deg))
    height = int(np.ceil((y1 - y0) / res_deg))
    arr = np.full((height, width), value, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=width, height=height, count=1,
                       dtype='float32', crs=crs,
                       transform=from_origin(x0, y1, res_deg, res_deg),
                       nodata=float('nan')) as ds:
        ds.write(arr, 1)


def make_bathy_csv(path: Path, tr, depth=2.0, n=11, pad=0.005):
    x0, y0, x1, y1 = sea_bounds_4326(tr)
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    lines = ['lng,lat,depth_m']
    for lat in np.linspace(y0, y1, n):
        for lon in np.linspace(x0, x1, n):
            lines.append('%.6f,%.6f,%.3f' % (lon, lat, depth))
    path.write_text('\n'.join(lines), encoding='utf-8')


def test_refuse_missing_source_or_datum(tmp_path):
    tr = make_sea(tmp_path / 'sea.tif')
    make_bathy_grid(tmp_path / 'bathy_x_100m_egm96.tif', tr)
    b = str(tmp_path / 'bathy_x_100m_egm96.tif')
    r1 = run_cli(b, '--datum', 'egm96', '--check')
    assert r1.returncode == 2 and '--source' in r1.stdout
    r2 = run_cli(b, '--source', 'pytest', '--check')
    assert r2.returncode == 2 and '--datum' in r2.stdout
    r3 = run_cli(b, '--source', 'pytest', '--datum', 'lld', '--check')
    assert r3.returncode == 2 and '--lld-height-m' in r3.stdout


def test_refuse_bad_resolution(tmp_path):
    tr = make_sea(tmp_path / 'sea.tif')
    make_bathy_grid(tmp_path / 'coarse.tif', tr, res_deg=0.01)
    r = run_cli(str(tmp_path / 'coarse.tif'), '--source', 'pytest', '--datum', 'egm96', '--check')
    assert r.returncode == 2 and '分辨率' in r.stdout


def test_refuse_zero_p0_coverage(tmp_path):
    path = tmp_path / 'far.tif'
    arr = np.full((40, 40), BATHY_VALUE, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=40, height=40, count=1,
                       dtype='float32', crs='EPSG:4326',
                       transform=from_origin(100.0, 10.0, 0.0005, 0.0005)) as ds:
        ds.write(arr, 1)
    r = run_cli(str(path), '--source', 'pytest', '--datum', 'egm96', '--check')
    assert r.returncode == 2 and '零相交' in r.stdout


def test_refuse_missing_crs(tmp_path):
    path = tmp_path / 'nocrs.tif'
    arr = np.full((40, 40), BATHY_VALUE, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=40, height=40, count=1,
                       dtype='float32', transform=from_origin(108.5, 21.8, 0.0005, 0.0005)) as ds:
        ds.write(arr, 1)
    r = run_cli(str(path), '--source', 'pytest', '--datum', 'egm96', '--check')
    assert r.returncode == 2 and '无 CRS' in r.stdout


def test_datum_conversion_lld():
    mod = load_module()
    out = mod.convert_datum(np.array([1.0, 2.5], dtype='float32'), 'lld', -4.3)
    assert out.tolist() == pytest.approx([-5.3, -6.8])
    same = mod.convert_datum(np.array([-5.3], dtype='float32'), 'egm96', None)
    assert same.tolist() == pytest.approx([-5.3])


def test_fuse_grid_end_to_end(tmp_path):
    import hashlib

    tr = make_sea(tmp_path / 'sea.tif')
    bathy = tmp_path / 'bathy_pytest_55m_egm96.tif'
    make_bathy_grid(bathy, tr)
    out = tmp_path / 'sea_v2.tif'
    rep = tmp_path / 'report.json'
    r0 = run_cli(str(bathy), '--source', 'pytest 夹具', '--datum', 'egm96',
                 '--sea', str(tmp_path / 'sea.tif'), '--out', str(out), '--report', str(rep),
                 '--check')
    assert r0.returncode == 0 and '验收通过' in r0.stdout and not out.exists()
    r1 = run_cli(str(bathy), '--source', 'pytest 夹具', '--datum', 'egm96',
                 '--sea', str(tmp_path / 'sea.tif'), '--out', str(out), '--report', str(rep))
    assert r1.returncode == 0, r1.stdout + r1.stderr
    assert out.exists() and rep.exists()
    with rasterio.open(out) as ds:
        got = ds.read(1)
        assert ds.crs is not None and ds.nodata is not None and np.isnan(ds.nodata)
    assert np.isnan(got[0, 0])  # 现役非海区不被新增覆盖
    inside = np.isfinite(got)
    assert inside.sum() == N * N - 9
    assert np.allclose(got[inside], BATHY_VALUE)
    report = json.loads(rep.read_text(encoding='utf-8'))
    assert report['replaced_cells'] == N * N - 9
    assert report['delta_median'] == pytest.approx(BATHY_VALUE - SEA_VALUE)
    assert report['out_md5'] == hashlib.md5(out.read_bytes()).hexdigest()


def test_fuse_csv_lld_and_dry_run(tmp_path):
    tr = make_sea(tmp_path / 'sea.tif')
    csv = tmp_path / 'bathy_enc_100m_lld.csv'
    make_bathy_csv(csv, tr, depth=2.0)
    out = tmp_path / 'sea_v2.tif'
    r0 = run_cli(str(csv), '--source', 'pytest 点云', '--datum', 'lld', '--lld-height-m', '-4.0',
                 '--sea', str(tmp_path / 'sea.tif'), '--out', str(out), '--dry-run')
    assert r0.returncode == 0 and 'dry-run：未写盘' in r0.stdout and not out.exists()
    r1 = run_cli(str(csv), '--source', 'pytest 点云', '--datum', 'lld', '--lld-height-m', '-4.0',
                 '--sea', str(tmp_path / 'sea.tif'), '--out', str(out))
    assert r1.returncode == 0, r1.stdout + r1.stderr
    with rasterio.open(out) as ds:
        got = ds.read(1)
    inside = np.isfinite(got)
    assert inside.sum() == N * N - 9
    assert np.allclose(got[inside], -6.0)
