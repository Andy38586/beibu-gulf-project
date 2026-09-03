"""测试环境隔离（pytest 全局）：关闭路网图启动预热。

应用 lifespan 会在 daemon 线程构图（真库实测约 40s），TestClient 进入上下文即
触发——而本套件不测路径（路径由 test_route_graph / test_topology 离线覆盖），
白等一个用不到的图。经 ROUTE_WARMUP=0 显式关闭，语义写在 main.lifespan。
"""

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _no_route_warmup():
    previous = os.environ.get("ROUTE_WARMUP")
    os.environ["ROUTE_WARMUP"] = "0"
    yield
    if previous is None:
        os.environ.pop("ROUTE_WARMUP", None)
    else:
        os.environ["ROUTE_WARMUP"] = previous
