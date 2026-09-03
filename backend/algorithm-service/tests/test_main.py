"""
flood-service 回归测试（缓存 / LRU 淘汰 / 预计算查表 守护）

覆盖：
- test_same_level_second_request_cache_hit_no_500：回归——同水位二次请求
  命中缓存必须 200（bug 版：_cached_level 为普通 dict 却调 OrderedDict.move_to_end
  → AttributeError 500）。
- test_lru_eviction_after_64_levels：语义——满 64 档后 popitem(last=False)
  淘汰最久未访问，跨 64 档不周期性全量 miss，且淘汰路径不抛 500。
- test_precomputed_level_lookup：预计算档位表命中 → 秒回数据、零演算（性能优化：
  滑块拖动不再在线演算）。

DEM 隔离：flood_engine.load_dem 依赖 169MB gitignored DEM 文件，测试用
monkeypatch 替换 _engine_module（跳过 load_dem）与 run_online_flood（返回
固定结果），只测 HTTP 层 + 缓存行为，不依赖真实 DEM。
预计算表隔离：client fixture 默认 monkeypatch _load_levels 返回空表（走 LRU
演算路径，缓存/LRU 行为不变）；查表测试单独注入假表。

垂直基准统一：online 入口把前端理论深度基准面水位减 datum_offset 换算 EGM96
后查表/演算，响应 level 回显理论档位。测试用 _fixed_datum 固定偏移 2.5
（与 waterLevel.json baseLevels.msl 同口径），假表键/缓存键断言均为换算后
（EGM96）口径。
"""

import types

import pytest
from fastapi.testclient import TestClient

import flood as flood_mod


def _make_fake_engine():
    """假 engine 模块：load_dem 为 no-op（测试不依赖 169MB DEM 文件）"""
    engine = types.ModuleType("fake_flood_engine")
    engine.load_dem = lambda: None
    return engine


@pytest.fixture(autouse=True)
def _reset_cache():
    """每个测试独立缓存，避免相互污染"""
    flood_mod._cached_level.clear()
    yield
    flood_mod._cached_level.clear()


@pytest.fixture(autouse=True)
def _fixed_datum(monkeypatch):
    """垂直基准统一：固定偏移 2.5，测试口径确定、不依赖数据文件"""
    monkeypatch.setattr(flood_mod, "datum_offset", lambda: 2.5)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(flood_mod, "_engine_module", lambda: _make_fake_engine())
    # 隔离真实预计算档位表：默认空表 → 走 LRU 演算路径（缓存/LRU 行为不变）
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: {})
    from main import app

    return TestClient(app)


def _fake_run(level: float) -> dict:
    return {"level": level, "featureCount": 0, "floodedKm2": 0.0, "features": []}


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_flood_impact_spatial_filter(client, monkeypatch):
    """impact：淹没多边形 ∩ 设施点（空间筛选）→ 受影响设施 + 总损失"""
    # 假表键为 EGM96 口径：请求 15（理论）− 偏移 2.5 = 12.5
    fake_table = {
        "12.5": {
            "featureCount": 1,
            "floodedKm2": 100.0,
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [108.3, 21.6],
                                [108.4, 21.6],
                                [108.4, 21.8],
                                [108.3, 21.8],
                                [108.3, 21.6],
                            ]
                        ],
                    },
                    "properties": {"area": 1.0},
                }
            ],
        }
    }
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: fake_table)
    fake_facilities = [
        {
            "id": "A",
            "name": "多边形内设施",
            "type": "泊位",
            "lng": 108.35,
            "lat": 21.7,
            "port": "X",
            "value": 1000,
            "damageRate": 0.5,
        },
        {
            "id": "B",
            "name": "多边形外设施",
            "type": "仓储",
            "lng": 110.0,
            "lat": 30.0,
            "port": "Y",
            "value": 2000,
            "damageRate": 0.5,
        },
    ]
    monkeypatch.setattr(flood_mod, "_load_facilities", lambda: fake_facilities)

    r = client.get("/api/flood/impact?waterLevel=15")
    assert r.status_code == 200
    body = r.json()
    assert len(body["affectedFacilities"]) == 1  # 只有多边形内的 A
    assert body["affectedFacilities"][0]["id"] == "A"
    assert body["affectedFacilities"][0]["loss"] == 500  # 1000 × 0.5
    assert body["totalLoss"] == 500


def test_flood_impact_no_features_empty(client, monkeypatch):
    """impact：档位无淹没多边形（如低水位）→ 空设施 + 0 损失"""
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: {})
    r = client.get("/api/flood/impact?waterLevel=5")
    assert r.status_code == 200
    body = r.json()
    assert body["affectedFacilities"] == []
    assert body["totalLoss"] == 0


def test_precomputed_level_lookup(client, monkeypatch):
    """预计算档位表命中：秒回档位数据、零演算（滑块拖动不再在线演算）"""
    # 假表键为 EGM96 口径（请求 − 2.5）；响应 level 回显理论档位
    fake_table = {
        "1.0": {"featureCount": 1, "floodedKm2": 4538.75, "features": [{"type": "Feature"}]},
    }
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: fake_table)
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r = client.get("/api/flood/online?waterLevel=3.5")
    assert r.status_code == 200
    body = r.json()
    assert body["featureCount"] == 1
    assert body["floodedKm2"] == 4538.75
    assert body["level"] == 3.5  # 回显理论档位（与滑块 step=0.1 对齐，无提示噪音）
    assert len(calls) == 0  # 查表命中 → 零在线演算

    # 0.1m 档位（滑块 step）同样命中——任意档秒回
    fake_table["0.9"] = {"featureCount": 1, "floodedKm2": 4500.0, "features": []}
    r2 = client.get("/api/flood/online?waterLevel=3.4")
    assert r2.status_code == 200
    assert r2.json()["floodedKm2"] == 4500.0
    assert len(calls) == 0


def test_same_level_second_request_cache_hit_no_500(client, monkeypatch):
    """回归：同水位二次请求命中缓存 → 必须 200，且不重复演算"""
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r1 = client.get("/api/flood/online?waterLevel=3.5")
    assert r1.status_code == 200

    # bug 版（普通 dict 调 move_to_end）在这里抛 AttributeError → 500
    r2 = client.get("/api/flood/online?waterLevel=3.5")
    assert r2.status_code == 200, f"同水位二次请求命中缓存抛 500：{r2.text}"

    assert r1.json() == r2.json()
    assert len(calls) == 1  # 第二次命中缓存，不再触发演算
    assert flood_mod._cached_level[1.0] is not None  # 缓存键为 EGM96 口径（3.5−2.5），move_to_end 后键仍在


def test_lru_eviction_after_64_levels(client, monkeypatch):
    """LRU 语义：满 64 档后 popitem 淘汰最久未访问，跨 64 档不周期性全量 miss"""
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    # 64 档逐个演算（理论 2.5~8.8 → EGM96 键 0.0~6.3）：插入前 len<64，均不触发淘汰 → 64 档全量在缓存
    for i in range(64):
        r = client.get(f"/api/flood/online?waterLevel={2.5 + i / 10}")
        assert r.status_code == 200
    assert len(calls) == 64
    assert len(flood_mod._cached_level) == 64
    assert 0.0 in flood_mod._cached_level  # 尚未触发淘汰（淘汰发生在第 65 次插入时）

    # 请求新档（理论 8.9 → EGM96 6.4）→ 插入前 len=64 → popitem(last=False) 淘汰最旧 0.0 → 插入 6.4
    r_new = client.get("/api/flood/online?waterLevel=8.9")
    assert r_new.status_code == 200
    assert len(calls) == 65
    assert 0.0 not in flood_mod._cached_level  # 最久未访问被淘汰
    assert 6.4 in flood_mod._cached_level
    assert len(flood_mod._cached_level) == 64  # 上限保持 64，不周期性全量 clear

    # 重新请求理论 2.5（EGM96 0.0）→ 已淘汰 → 重新演算（仍 200，淘汰路径不抛 500）
    r_old = client.get("/api/flood/online?waterLevel=2.5")
    assert r_old.status_code == 200
    assert len(calls) == 66


def test_lookup_miss_falls_back_to_lru_compute(client, monkeypatch):
    """查表 miss 回退：表缺档 → LRU 动态演算兜底并缓存，二次请求零演算"""
    # 假表键 EGM96 口径：1.0 对应理论 3.5
    fake_table = {"1.0": {"featureCount": 1, "floodedKm2": 4538.75, "features": []}}
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: fake_table)
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    # 请求表外档 7.2（EGM96 4.7）→ 查表 miss → 回退 LRU 动态演算
    r1 = client.get("/api/flood/online?waterLevel=7.2")
    assert r1.status_code == 200
    assert len(calls) == 1  # 触发一次演算
    assert 4.7 in flood_mod._cached_level  # miss 结果已入 LRU 缓存（EGM96 键）

    # 二次请求同档 → LRU 命中，零演算（兜底路径稳定，不 500）
    r2 = client.get("/api/flood/online?waterLevel=7.2")
    assert r2.status_code == 200
    assert r2.json() == r1.json()
    assert len(calls) == 1

    # 表内档仍走查表（两条路径互不干扰）
    r3 = client.get("/api/flood/online?waterLevel=3.5")
    assert r3.status_code == 200
    assert r3.json()["floodedKm2"] == 4538.75
    assert len(calls) == 1


def test_out_of_table_level_falls_back_not_500(client, monkeypatch):
    """表外档（15.1，miss）回退 LRU 演算必须 200 不 500（档位边界语义防线）"""
    fake_table = {"3.5": {"featureCount": 1, "floodedKm2": 4538.75, "features": []}}
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: fake_table)
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r = client.get("/api/flood/online?waterLevel=15.1")
    assert r.status_code == 200, f"表外档 miss 回退抛 500：{r.text}"
    assert r.json()["level"] == 15.1
    assert len(calls) == 1  # 走兜底演算而非查表


def test_upper_bound_25_hits_precomputed(client, monkeypatch):
    """251 档上界 25.0 必须查表命中（档位表 0.0-25.0）"""
    # 理论 25 − 偏移 2.5 = EGM96 22.5，仍在 251 档表内
    fake_table = {"22.5": {"featureCount": 1, "floodedKm2": 1234.5, "features": []}}
    monkeypatch.setattr(flood_mod, "_load_levels", lambda: fake_table)
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r = client.get("/api/flood/online?waterLevel=25.0")
    assert r.status_code == 200
    assert r.json()["floodedKm2"] == 1234.5  # 表内档数据直返
    assert r.json()["level"] == 25.0
    assert len(calls) == 0  # 上界命中 → 零演算


def test_below_msl_returns_empty_without_compute(client, monkeypatch):
    """理论水位低于平均海平面（EGM96 键 <0）→ 空淹没响应、零演算、不触碰 DEM
    （cut 版 DEM 缺失时也不致 500）"""
    calls: list[float] = []
    monkeypatch.setattr(
        flood_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r = client.get("/api/flood/online?waterLevel=0")
    assert r.status_code == 200
    body = r.json()
    assert body["level"] == 0.0  # 回显理论档位
    assert body["floodedKm2"] == 0.0
    assert body["features"] == []
    assert len(calls) == 0  # 负键直接回空，不触发演算/DEM 加载


def test_dem_missing_fallback_returns_503_not_500(client, monkeypatch):
    """查表 miss 且 cut 版 DEM 缺失时，兜底演算返回 503 + 可操作信息
    （复原脚本路径），不裸 500"""
    def _boom():
        raise FileNotFoundError("backend/data/flood/dem/filled_utm48n_cut.tif")

    monkeypatch.setattr(flood_mod, "_engine_module", _boom)
    r = client.get("/api/flood/online?waterLevel=7.2")  # 默认空表 → 必 miss → 走兜底
    assert r.status_code == 503
    assert "filled_utm48n_cut.tif" in r.json()["detail"]