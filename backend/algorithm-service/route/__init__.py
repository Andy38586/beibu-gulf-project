"""
route/ — 最短路径分域（algorithm-service 路由域之二）

当前仅立骨架：路由注册点（APIRouter）与目录先就位，无实际路由；
路网图构建与 /route/path 查询（起终点拾取 → 路径线 → 里程/时长面板）
后续在此域填充，引擎采用 networkx（论文口径：生产级方案采用 pgRouting）。
"""

from fastapi import APIRouter

router = APIRouter()