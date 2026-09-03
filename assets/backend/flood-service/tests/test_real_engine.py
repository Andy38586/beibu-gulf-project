"""
8-2 修复：真演算回归测试（原 test_main.py 全 mock engine，连通演算从未执行）。

真实 DEM 连通性淹没演算冒烟：验证应然契约（02 §4.3 / §5.6）——
- 水位 0 → 无淹没多边形（features 空；floodedKm2 允许海面种子小残差，上限容差防回归）
- 淹没面积随水位单调不减（低水位面积 > 高水位面积 = 数据错）
- 输出为合法 GeoJSON Feature 集合

CI 无 DEM 卷（169MB gitignored），文件缺失自动 skip，不影响 CI 绿；
本地/生产镜像（DEM volume 挂载）执行真演算。
"""

import time
from pathlib import Path

import pytest

DEM_DIR = Path(__file__).resolve().parents[2] / "data" / "flood" / "dem"

requires_dem = pytest.mark.skipif(
    not any(DEM_DIR.glob("*.tif")),
    reason="真实 DEM 未就绪（CI 无 DEM 卷），跳过真演算回归",
)


@requires_dem
def test_real_engine_zero_level_no_flood():
    """水位 0 → 无淹没多边形（02 §4.3 应然：海面种子正确性验证点）"""
    import flood_engine

    flood_engine.load_dem()
    r = flood_engine.run_online_flood(0.0)
    assert r["features"] == [], f"0 水位不应有淹没多边形，实际 {r['featureCount']} 个"
    # 海面种子误差允许小残差（预计算 0 档实测 6.87km²，已在 main.py 8-6 归一）；
    # 上限容差防回归到"0 档大面积淹没"
    assert 0 <= r["floodedKm2"] < 50, f"0 水位淹没面积异常: {r['floodedKm2']}"


@requires_dem
def test_real_engine_area_monotonic():
    """淹没面积随水位单调不减（低水位 > 高水位 = 数据错）"""
    import flood_engine

    flood_engine.load_dem()
    r2 = flood_engine.run_online_flood(2.0)
    r5 = flood_engine.run_online_flood(5.0)
    r10 = flood_engine.run_online_flood(10.0)
    assert r2["floodedKm2"] >= 0
    assert r5["floodedKm2"] >= r2["floodedKm2"], (
        f"单调性破坏: 2m={r2['floodedKm2']} > 5m={r5['floodedKm2']}"
    )
    assert r10["floodedKm2"] >= r5["floodedKm2"], (
        f"单调性破坏: 5m={r5['floodedKm2']} > 10m={r10['floodedKm2']}"
    )


@requires_dem
def test_real_engine_valid_geojson():
    """输出为合法 GeoJSON Feature 集合（Polygon/MultiPolygon，4326）"""
    import flood_engine

    flood_engine.load_dem()
    r = flood_engine.run_online_flood(5.0)
    assert r["level"] == 5.0
    assert isinstance(r["features"], list)
    for f in r["features"]:
        assert f["type"] == "Feature"
        assert f["geometry"]["type"] in ("Polygon", "MultiPolygon")


@requires_dem
def test_real_engine_performance_sanity():
    """降采样 4x 演算应在秒级（性能哨兵：退化到分钟级即预警）"""
    import flood_engine

    flood_engine.load_dem()
    t0 = time.time()
    flood_engine.run_online_flood(5.0)
    elapsed = time.time() - t0
    assert elapsed < 30, f"真演算耗时 {elapsed:.1f}s，超出秒级预期（降采样退化？）"
