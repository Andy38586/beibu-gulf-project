"""
route/source.py — 路网边数据源（PG roads 表读取）

职能边界：本模块只做 IO（连接 + 两条 SQL），构图计算在 graph.py，
缓存编排在 service.py——三层互不 import 对方的内部实现。

版本戳（专项8 指标 7.3）：count + max(id) + sum(length_m) 三元组。
重灌（TRUNCATE 后序列继续 → max(id) 变）、口径修正（sum 变）、增删行
（count 变）任一发生都会改变戳值 → 缓存自动重建，无需重启进程。
"""

from __future__ import annotations

import logging
import os

import psycopg
from shapely import wkb

from .topology import RoadLine

_logger = logging.getLogger("algorithm-service")

# 连接参数：默认对齐 docker-compose.v3.yml 的 v3_dev；容器内经服务名互连
#（compose 注入 ROUTE_PG_HOST=postgis），本地开发缺省 localhost。
# connect_timeout 短超时：PG 未就绪时预热/惰性构建快速失败降级，不拖住 flood 域
_PG = {
    "host": os.environ.get("ROUTE_PG_HOST", "localhost"),
    "port": int(os.environ.get("ROUTE_PG_PORT", "5432")),
    "user": os.environ.get("ROUTE_PG_USER", "postgres"),
    "password": os.environ.get("ROUTE_PG_PASSWORD", "postgres"),
    "dbname": os.environ.get("ROUTE_PG_DB", "v3_dev"),
    "connect_timeout": int(os.environ.get("ROUTE_PG_CONNECT_TIMEOUT", "3")),
}

# 完整折线读取（拓扑切分需要全部顶点，端点形式由 topology.split_at_endpoints 产出）。
# ORDER BY id 是确定性的数据源保障——切分顺序与构图节点"格内首见"都依赖此顺序（7.4）。
_EDGES_SQL = """
SELECT id, class, length_m, ST_AsBinary(geom)
FROM roads
WHERE geom IS NOT NULL
ORDER BY id
"""

_STAMP_SQL = """
SELECT count(*), COALESCE(max(id), 0), COALESCE(sum(length_m), 0)::bigint FROM roads
"""


def _fetch(sql: str) -> list[tuple]:
    """短连接取数：构图是低频重操作，不值得常驻连接池（进程级缓存挡住重复构图）"""
    with psycopg.connect(**_PG) as conn, conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def fetch_version_stamp() -> str:
    (count, max_id, sum_len) = _fetch(_STAMP_SQL)[0]
    return f"count={count};max_id={max_id};sum_len={sum_len}"


def fetch_roads() -> list[RoadLine]:
    rows = _fetch(_EDGES_SQL)
    roads = [
        RoadLine(int(r[0]), r[1], float(r[2]), wkb.loads(bytes(r[3])))
        for r in rows
        if r[2] is not None
    ]
    dropped = len(rows) - len(roads)
    if dropped:
        _logger.warning("roads 表 %d 行缺 length_m，构图前丢弃", dropped)
    return roads
