"""
flood-service 回归测试（d072 / d069 / 预计算查表 守护）

覆盖：
- test_same_level_second_request_cache_hit_no_500：d072 回归——同水位二次请求
  命中缓存必须 200（bug 版：_cached_level 为普通 dict 却调 OrderedDict.move_to_end
  → AttributeError 500）。
- test_lru_eviction_after_64_levels：d069 语义——满 64 档后 popitem(last=False)
  淘汰最久未访问，跨 64 档不周期性全量 miss，且淘汰路径不抛 500。
- test_precomputed_level_lookup：预计算档位表命中 → 秒回数据、零演算（性能优化：
  滑块拖动不再在线演算）。

DEM 隔离：flood_engine.load_dem 依赖 169MB gitignored DEM 文件，测试用
monkeypatch 替换 _engine_module（跳过 load_dem）与 run_online_flood（返回
固定结果），只测 HTTP 层 + 缓存行为，不依赖真实 DEM。
预计算表隔离：client fixture 默认 monkeypatch _load_levels 返回空表（走 LRU
演算路径，d072/d069 行为不变）；查表测试单独注入假表。
"""

import types

import pytest
from fastapi.testclient import TestClient

import main as main_mod


def _make_fake_engine():
    """假 engine 模块：load_dem 为 no-op（测试不依赖 169MB DEM 文件）"""
    engine = types.ModuleType("fake_flood_engine")
    engine.load_dem = lambda: None
    return engine


@pytest.fixture(autouse=True)
def _reset_cache():
    """每个测试独立缓存，避免相互污染"""
    main_mod._cached_level.clear()
    yield
    main_mod._cached_level.clear()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main_mod, "_engine_module", lambda: _make_fake_engine())
    # 隔离真实预计算档位表：默认空表 → 走 LRU 演算路径（d072/d069 行为不变）
    monkeypatch.setattr(main_mod, "_load_levels", lambda: {})
    return TestClient(main_mod.app)


def _fake_run(level: float) -> dict:
    return {"level": level, "featureCount": 0, "floodedKm2": 0.0, "features": []}


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_precomputed_level_lookup(client, monkeypatch):
    """预计算档位表命中：秒回档位数据、零演算（滑块拖动不再在线演算）"""
    fake_table = {
        "3.5": {"featureCount": 1, "floodedKm2": 4538.75, "features": [{"type": "Feature"}]},
    }
    monkeypatch.setattr(main_mod, "_load_levels", lambda: fake_table)
    calls: list[float] = []
    monkeypatch.setattr(
        main_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r = client.get("/api/flood/online?level=3.5")
    assert r.status_code == 200
    body = r.json()
    assert body["featureCount"] == 1
    assert body["floodedKm2"] == 4538.75
    assert body["level"] == 3.5  # 回显档位（与滑块 step=0.1 对齐，无提示噪音）
    assert len(calls) == 0  # 查表命中 → 零在线演算

    # 0.1m 档位（滑块 step）同样命中——任意档秒回
    fake_table["3.4"] = {"featureCount": 1, "floodedKm2": 4500.0, "features": []}
    r2 = client.get("/api/flood/online?level=3.4")
    assert r2.status_code == 200
    assert r2.json()["floodedKm2"] == 4500.0
    assert len(calls) == 0


def test_same_level_second_request_cache_hit_no_500(client, monkeypatch):
    """d072 回归：同水位二次请求命中缓存 → 必须 200，且不重复演算"""
    calls: list[float] = []
    monkeypatch.setattr(
        main_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    r1 = client.get("/api/flood/online?level=3.5")
    assert r1.status_code == 200

    # bug 版（普通 dict 调 move_to_end）在这里抛 AttributeError → 500
    r2 = client.get("/api/flood/online?level=3.5")
    assert r2.status_code == 200, f"同水位二次请求命中缓存抛 500（d072 回归）：{r2.text}"

    assert r1.json() == r2.json()
    assert len(calls) == 1  # 第二次命中缓存，不再触发演算
    assert main_mod._cached_level[3.5] is not None  # move_to_end 后键仍在


def test_lru_eviction_after_64_levels(client, monkeypatch):
    """d069 语义：满 64 档后 popitem 淘汰最久未访问，跨 64 档不周期性全量 miss"""
    calls: list[float] = []
    monkeypatch.setattr(
        main_mod, "run_online_flood", lambda level: (calls.append(level), _fake_run(level))[1]
    )

    # 64 档逐个演算（0.0~6.3）：插入前 len<64，均不触发淘汰 → 64 档全量在缓存
    for i in range(64):
        r = client.get(f"/api/flood/online?level={i / 10}")
        assert r.status_code == 200
    assert len(calls) == 64
    assert len(main_mod._cached_level) == 64
    assert 0.0 in main_mod._cached_level  # 尚未触发淘汰（淘汰发生在第 65 次插入时）

    # 请求新档 6.4 → 插入前 len=64 → popitem(last=False) 淘汰最旧 0.0 → 插入 6.4
    r_new = client.get("/api/flood/online?level=6.4")
    assert r_new.status_code == 200
    assert len(calls) == 65
    assert 0.0 not in main_mod._cached_level  # 最久未访问被淘汰
    assert 6.4 in main_mod._cached_level
    assert len(main_mod._cached_level) == 64  # 上限保持 64，不周期性全量 clear

    # 重新请求 0.0 → 已淘汰 → 重新演算（仍 200，淘汰路径不抛 500）
    r_old = client.get("/api/flood/online?level=0.0")
    assert r_old.status_code == 200
    assert len(calls) == 66
