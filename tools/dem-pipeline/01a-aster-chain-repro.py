# -*- coding: utf-8 -*-
"""01a-aster-chain-repro.py — 复现现役 DEM 链头部（6 幅 ASTER → filled_CGCS2000_int16）并比对归档件。

为什么有这支脚本：现役链的 06 消费外置 `处理成果/filled_CGCS2000_int16.tif`，而它此前
**没有任何入库脚本**（`处理成果/处理报告.md` 记的是 2026-07-30 一次人工处理）；本仓
`01~03*.ps1` 是另一条历史支线（输出 `dem_4326.tif`，现役链没有消费方）且 02 的
MINSLOPE=0.01 **不复现**归档件。本脚本把 07-30 那条链固化为可复跑，并逐像元比对归档件。

链（目标格网/参数取自归档件，见下方常量；不用"估计值"）：
  ① 6 幅 .img --gdalwarp(bilinear, 固定 -te/-ts)--> merged_WGS84.repro.tif（EPSG:4326）
  ② --gdalwarp--> reproj_CGCS2000.repro.tif（GRS80 / CM108 自定义 TM，与工作格网同投影）
  ③ SAGA io_gdal 0 → ta_preprocessor 5（Wang & Liu，**MINSLOPE=0**）→ io_gdal 2 → Int16/32767
  ④ 与归档件逐像元比对（结构 + 数值差）

2026-10-04 本机实测（参考值，换 SAGA/GDAL 版本会变）：
  · ① 有效 77,076,617 px，仅 13,342 px 有差、max|Δ| 4 m（>1 m 只 1 px）
  · ② 有效 78,945,465 px，28,942 px 有差、max|Δ| 1 m（>1 m 0 px）
  · ③ 抬高 12,672,522 px（归档报告 12,672,629）、降低 0、最大抬高 170.0 m；
       Int16 比对 max|Δ| 1 m、25,958 px 有差（>1 m 0 px）

⚠ 待裁（不自行选边）：`02-fill-sinks.ps1` 用 MINSLOPE=0.01，实测抬高 35,390,751 px、
与归档 Int16 差 >5 m 的像元 11,173,154 个 ⇒ 与现役输入不一致。01~03 是否作废/改写，
属口径决策，由用户裁定；本脚本只做复现与比对，不改任何现役文件。

用法（venv python；需 QGIS 的 gdalwarp.exe 与 saga_cmd.exe）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/dem-pipeline/01a-aster-chain-repro.py            # 全链（SAGA 约 2.5 分钟）
    ... --skip-fill                                       # 只跑 ①②（约 15 秒）
    ... --reuse                                           # 复存在产物，只重跑比对
输出只写 `.local/dem-aster/`（gitignored），不碰任何运行时资产。
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import rasterio

REPO = Path(__file__).resolve().parents[2]
QGIS = Path(r'C:\Program Files\QGIS 3.44.12')
GDALWARP = QGIS / 'bin/gdalwarp.exe'
SAGA = QGIS / 'apps/saga/saga_cmd.exe'

ASTER_DIR_DEFAULT = Path(
    r'C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\项目数据\浸没分析'
    r'\ASTER-GDEM-30m\解压后')
ASTER_DIR_OLD = Path(r'C:\Users\JionHappY\Desktop\项目数据\浸没分析\ASTER-GDEM-30m\解压后')
ARCHIVE_DIR_DEFAULT = Path(
    r'C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\项目数据\浸没分析\处理成果')

# 目标格网：直接取归档件的 4 角 + 尺寸（不许估计）
WGS84_TE = (106.9855287, 20.9791452, 110.0075215, 23.0222690)
WGS84_TS = (10830, 7322)
CGCS_TE = (394506.241, 2320754.426, 708795.330, 2548414.249)
CGCS_TS = (10659, 7721)
CGCS_SRS = ('+proj=tmerc +lat_0=0 +lon_0=108 +k=1 +x_0=500000 +y_0=0 '
            '+ellps=GRS80 +units=m +no_defs +type=crs')
NODATA = 32767


def run(cmd, env=None, note=''):
    print('$ %s' % ' '.join(str(c) for c in cmd[:6]) + (' …' if len(cmd) > 6 else ''))
    r = subprocess.run([str(c) for c in cmd], env=env, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    tail = [ln for ln in (r.stdout or '').splitlines() if ln.strip()][-1:] or ['']
    if r.returncode != 0:
        print((r.stdout or '')[-2000:])
        print((r.stderr or '')[-2000:])
        raise SystemExit('❌ %s 失败，exit=%d' % (note or cmd[0], r.returncode))
    print('   %s [exit 0]' % tail[0].strip())
    return r


def saga_env():
    env = os.environ.copy()
    env['PATH'] = ';'.join([str(QGIS / 'bin'), str(QGIS / 'apps/saga'),
                            str(QGIS / 'apps/Python312'), str(QGIS / 'apps/qgis-ltr/bin'),
                            env.get('PATH', '')])
    env['GDAL_DATA'] = str(QGIS / 'apps/gdal/share/gdal')
    env['PROJ_LIB'] = str(QGIS / 'share/proj')
    return env


def grid_of(path: Path):
    with rasterio.open(path) as ds:
        return dict(shape=(ds.height, ds.width), crs=ds.crs, tf=tuple(ds.transform)[:6],
                    nodata=ds.nodata, dtype=ds.dtypes[0])


def compare(path_a: Path, path_b: Path, name: str):
    ga, gb = grid_of(path_a), grid_of(path_b)
    # 容差按量纲分档：经纬度 1e-6°（≈0.1 m）／投影米 1e-3 m——远小于 1 像元，
    # 但仍容忍 gdalwarp 写盘时的末位舍入（实测最大 3e-8°、2.7e-4 m）
    def tf_close(a, b):
        return all(abs(x - y) <= (1e-3 if abs(y) > 100 else 1e-6) for x, y in zip(a, b))
    tfmax = max(abs(x - y) for x, y in zip(ga['tf'], gb['tf']))
    struct_ok = (ga['shape'] == gb['shape'] and ga['crs'] == gb['crs'] and tf_close(ga['tf'], gb['tf']))
    print('== 比对 %s ==' % name)
    print('  结构: shape %s/%s ｜ crs %s ｜ tf %s（max 分量差 %.8f）'
          % (ga['shape'], gb['shape'], '同' if ga['crs'] == gb['crs'] else '不同',
             '同' if tf_close(ga['tf'], gb['tf']) else '不同', tfmax))
    A = rasterio.open(path_a).read(1).astype('int32')
    B = rasterio.open(path_b).read(1).astype('int32')
    va, vb = A != NODATA, B != NODATA
    m = va & vb
    d = A - B
    stats = dict(valid_a=int(va.sum()), valid_b=int(vb.sum()), valid_mismatch=int((va ^ vb).sum()),
                 max_abs=int(np.abs(d[m]).max()) if m.any() else -1,
                 nonzero=int((d[m] != 0).sum()), gt1=int((np.abs(d[m]) > 1).sum()),
                 gt5=int((np.abs(d[m]) > 5).sum()))
    print('  有效 a/b %s/%s ｜ 有效位不一致 %s ｜ 共同有效 %s' %
          (f"{stats['valid_a']:,}", f"{stats['valid_b']:,}", stats['valid_mismatch'], f"{int(m.sum()):,}"))
    print('  Δ: max|Δ| %s ｜ 有差 %s ｜ >1m %s ｜ >5m %s'
          % (stats['max_abs'], f"{stats['nonzero']:,}", f"{stats['gt1']:,}", f"{stats['gt5']:,}"))
    if not struct_ok or stats['valid_mismatch'] > 1000 or stats['max_abs'] > 10:
        raise SystemExit('❌ %s 粗差守卫未过（结构/掩膜/max|Δ|>10m）——不是同一链的产物' % name)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--out-dir', default=str(REPO / '.local/dem-aster'))
    ap.add_argument('--aster-dir', default=None)
    ap.add_argument('--archive-dir', default=str(ARCHIVE_DIR_DEFAULT))
    ap.add_argument('--skip-fill', action='store_true', help='只跑 ①②（不跑 SAGA）')
    ap.add_argument('--reuse', action='store_true', help='复用已有产物，只重跑比对')
    args = ap.parse_args()

    if not GDALWARP.exists():
        raise SystemExit('❌ 缺 %s' % GDALWARP)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    archive = Path(args.archive_dir)

    aster = Path(args.aster_dir) if args.aster_dir else (
        ASTER_DIR_DEFAULT if ASTER_DIR_DEFAULT.exists() else ASTER_DIR_OLD)
    imgs = sorted(aster.glob('*.img'))
    if len(imgs) != 6:
        raise SystemExit('❌ ASTER 输入应为 6 幅 .img，实际 %d 幅（%s）' % (len(imgs), aster))
    print('输入 %s（%d 幅）→ 输出 %s' % (aster, len(imgs), out))

    merged = out / 'merged_WGS84.repro.tif'
    reproj = out / 'reproj_CGCS2000.repro.tif'
    if not args.reuse:
        run([GDALWARP, '-overwrite', '-t_srs', 'EPSG:4326',
             '-te', *WGS84_TE, '-ts', *WGS84_TS, '-r', 'bilinear',
             '-srcnodata', NODATA, '-dstnodata', NODATA, '-ot', 'Int16',
             '-of', 'GTiff', '-co', 'TILED=YES', '-co', 'COMPRESS=LZW',
             *imgs, merged], note='① 6 幅 ASTER → WGS84 合并')
        run([GDALWARP, '-overwrite', '-t_srs', CGCS_SRS, '-te', *CGCS_TE, '-ts', *CGCS_TS,
             '-r', 'bilinear', '-srcnodata', NODATA, '-dstnodata', NODATA, '-ot', 'Int16',
             '-of', 'GTiff', '-co', 'TILED=YES', '-co', 'COMPRESS=LZW',
             merged, reproj], note='② WGS84 → CGCS2000/CM108')
    else:
        for p in (merged, reproj):
            if not p.exists():
                raise SystemExit('❌ --reuse 需要已有产物：%s' % p)

    filled_int16 = out / 'filled_CGCS2000_int16.repro.tif'
    if not args.skip_fill and not args.reuse:
        if not SAGA.exists():
            raise SystemExit('❌ 缺 %s' % SAGA)
        env = saga_env()
        sgrd_in, sgrd_filled = out / 'reproj.sgrd', out / 'filled.sgrd'
        f32 = out / 'filled_f32.tif'
        run([SAGA, 'io_gdal', '0', '-FILES', reproj, '-GRIDS', sgrd_in],
            env=env, note='③-1 SAGA 导入')
        run([SAGA, 'ta_preprocessor', '5', '-ELEV', sgrd_in, '-FILLED', sgrd_filled,
             '-MINSLOPE', '0'], env=env, note='③-2 填洼 Wang&Liu (MINSLOPE=0)')
        run([SAGA, 'io_gdal', '2', '-GRIDS', sgrd_filled, '-FILE', f32],
            env=env, note='③-3 SAGA 导出 Float32')
    if filled_int16.exists() and (args.reuse or args.skip_fill):
        print('（复用已有 %s）' % filled_int16.name)

    if not args.skip_fill and not args.reuse:
        f32 = out / 'filled_f32.tif'
        with rasterio.open(reproj) as ds:
            profile = ds.profile.copy()
        src = rasterio.open(reproj).read(1).astype('int32')
        f = rasterio.open(f32).read(1).astype('float64')
        m = (src != NODATA) & np.isfinite(f) & (f != -99999)
        raised = int((f[m] > src[m] + 1e-6).sum())
        lowered = int((f[m] < src[m] - 1e-6).sum())
        print('== ③ 填洼统计（对照 处理报告.md：抬高 12,672,629 / 降低 0 / 最大 +170 m）==')
        print('   抬高 %s ｜ 降低 %s ｜ 最大抬高 %.1f m'
              % (f'{raised:,}', f'{lowered:,}', float((f[m] - src[m]).max())))
        profile.update(dtype='int16', nodata=NODATA)
        out_arr = np.where(m, np.rint(f), NODATA).astype('int16')
        with rasterio.open(filled_int16, 'w', **profile) as dst:
            dst.write(out_arr, 1)
        print('   WROTE %s' % filled_int16)

    if not archive.exists():
        print('⚠ 归档目录不存在，跳过比对：%s' % archive)
        return 0
    compare(merged, archive / 'merged_WGS84.tif', '① merged_WGS84')
    compare(reproj, archive / 'reproj_CGCS2000.tif', '② reproj_CGCS2000')
    if filled_int16.exists():
        compare(filled_int16, archive / 'filled_CGCS2000_int16.tif', '③ filled_CGCS2000_int16')
    else:
        print('（未跑填洼，③ 比对跳过）')
    print('⇒ 头部链复现完成（数值差见上；口径分歧见文件头「待裁」）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
