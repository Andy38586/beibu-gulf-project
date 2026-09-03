"""
route/ — 最短路径分域（algorithm-service 路由域之二）

目录职责（三层，互不 import 内部实现）：
- `source.py`：IO 层——roads 表读取（完整折线）与版本戳查询；
- `topology.py`：拓扑层——端点投影切分（OSM 纵向道路不在路口切断，横路端点接在
  纵路中部顶点，只合并首末点构不出拓扑），输出端点形式的 Edge；
- `graph.py`：图与查询——网格吸附构图、双口径权重、最短路径查询，纯计算可离线单测；
- `service.py`：编排层——进程内缓存 + 版本戳失效、启动预热。

引擎采用 networkx（论文口径：生产级方案采用 pgRouting）。路由端点在路由功能
落地时于本域注册（当前为空骨架）。

`warmup` 供应用 lifespan 后台线程调用：构图耗时数十秒，不阻塞服务就绪。
"""

from fastapi import APIRouter

router = APIRouter()
