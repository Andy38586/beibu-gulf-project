"""
route/ — 最短路径分域（algorithm-service 路由域之二）

目录职责（三层，互不 import 内部实现）：
- `source.py`：IO 层——roads 表读取（完整折线）与版本戳查询；
- `topology.py`：拓扑层——端点投影切分（OSM 纵向道路不在路口切断，横路端点接在
  纵路中部顶点，只合并首末点构不出拓扑），输出端点形式的 Edge；
- `graph.py`：图与查询——网格吸附构图、双口径权重、最短路径查询，纯计算可离线单测；
- `service.py`：编排层——进程内缓存 + 版本戳失效、启动预热。

引擎采用 networkx（论文口径：生产级方案采用 pgRouting）。/route/path 端点在本域注册，
其余算法后续追加于此。

`warmup` 供应用 lifespan 后台线程调用：构图耗时数十秒，不阻塞服务就绪。
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from .service import get_road_graph

router = APIRouter()

# 有效 mode 枚举（graph.MODE_WEIGHT 的入口白名单；前端只发 distance|time）
_VALID_MODES = frozenset({"distance", "time"})


@router.get("/route/path")
def route_path(
    fromLng: float = Query(..., ge=-180, le=180, description="起点经度"),
    fromLat: float = Query(..., ge=-90, le=90, description="起点纬度"),
    toLng: float = Query(..., ge=-180, le=180, description="终点经度"),
    toLat: float = Query(..., ge=-90, le=90, description="终点纬度"),
    mode: str = Query("distance", description="寻路权重口径：distance=距离（米）/time=时长（分）"),
):
    """最短路径：起终点坐标 + 权重口径 → 路径折线 + 双口径里程/时长。

    裸 JSON（与 flood 域同例，无信封）。语义对齐 T5.2 设计契约（专项8 7.1/7.2）：
    - 不可达 / 起终点未吸附 → 200 + `{found:false, reason}`（合法空结果，非错误）；
    - 图不可用（PG 未就绪 / 构建失败）→ 503 可操作错误，不冒泡 500；
    - mode 非法 → 400（白名单校验，参数校验错误与业务错误同类，不落 500）。
    """
    if mode not in _VALID_MODES:
        return JSONResponse(
            status_code=400,
            content={"detail": f"mode 必须为 {' / '.join(sorted(_VALID_MODES))}，收到：{mode}"},
        )

    graph = get_road_graph()
    if graph is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "路径服务不可用：路网图未就绪（PG 可达性检查见服务日志）"},
        )

    # find_path 内部不抛（不可达/未吸附返回 found=false + reason）；ValueError 仅
    # 在 mode 白名单外时才可能——已被上方 400 拦截，此处不再兜。
    return graph.find_path(fromLng, fromLat, toLng, toLat, mode)
