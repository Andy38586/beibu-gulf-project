"""
/route/path HTTP 层测试（不连真库，monkeypatch route 域 get_road_graph）

覆盖：
- test_path_found：正常路径响应形状（found/distanceM/durationMin/snapDistanceM 透传）；
- test_origin_not_snapped_is_legal_empty：未吸附 → 200 + found:false（合法空结果非错误，
  专项8 7.2 语义在 HTTP 层的透传）；
- test_invalid_mode_400：mode 白名单外 → 400 可操作错误；
- test_graph_unavailable_503：图未就绪（PG 不可达/构建失败）→ 503 不 500。

DEM/PG 隔离：monkeypatch route.__init__.get_road_graph，不触 source（不连库）、
不触 lifespan 预热（conftest 已 ROUTE_WARMUP=0）。
"""

import pytest
from fastapi.testclient import TestClient

import route

_FOUND = {
    "found": True,
    "mode": "distance",
    "distanceM": 8600.0,
    "durationMin": 15.5,
    "snapDistanceM": {"from": 250.0, "to": 81.0},
    "edgeCount": 30,
    "coordinates": [[108.6, 21.6], [108.7, 21.7]],
}


class _FakeGraph:
    """最小假图：find_path 形状与真实 RoadGraph 对齐（字典透传，不由 HTTP 层加工）"""

    def __init__(self, result: dict) -> None:
        self._result = result

    def find_path(self, from_lng, from_lat, to_lng, to_lat, mode):
        return self._result


@pytest.fixture()
def client():
    from main import app

    return TestClient(app)


def test_path_found(client, monkeypatch):
    monkeypatch.setattr(route, "get_road_graph", lambda: _FakeGraph(_FOUND))
    r = client.get(
        "/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=distance"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["distanceM"] == 8600.0
    assert body["durationMin"] == 15.5
    assert body["snapDistanceM"]["from"] == 250.0
    assert body["edgeCount"] == 30
    assert len(body["coordinates"]) == 2


def test_origin_not_snapped_is_legal_empty(client, monkeypatch):
    """起终点未吸附/不可达 → 200 + found:false + reason（合法空，非错误、非 500）"""
    monkeypatch.setattr(
        route,
        "get_road_graph",
        lambda: _FakeGraph({"found": False, "reason": "origin_not_snapped"}),
    )
    r = client.get("/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is False
    assert body["reason"] == "origin_not_snapped"


def test_invalid_mode_400(client, monkeypatch):
    """mode 白名单外 → 400 可操作错误（不落 500）"""
    monkeypatch.setattr(route, "get_road_graph", lambda: _FakeGraph(_FOUND))
    r = client.get("/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=magic")
    assert r.status_code == 400
    assert "mode" in r.json()["detail"]


def test_graph_unavailable_503(client, monkeypatch):
    """图未就绪（PG 不可达/构建失败）→ 503 可操作错误，不 500"""
    monkeypatch.setattr(route, "get_road_graph", lambda: None)
    r = client.get("/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7")
    assert r.status_code == 503
    assert "路网图未就绪" in r.json()["detail"]


def test_missing_coord_params_422(client, monkeypatch):
    """必须参数缺失 → FastAPI Query 校验 422（与 flood Query(...) 同例）"""
    monkeypatch.setattr(route, "get_road_graph", lambda: _FakeGraph(_FOUND))
    r = client.get("/route/path?fromLng=108.6&fromLat=21.6")  # 缺 toLng/toLat
    assert r.status_code == 422