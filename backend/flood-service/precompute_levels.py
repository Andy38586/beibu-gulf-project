"""
precompute_levels.py — 预计算 0~25m 档位淹没数据（0.1m 步长，251 档）

产出 backend/data/flood/flood_levels.json（与 floodArea.json 同目录，数据文件化）：
  {
    "0.0": {"featureCount": 0, "floodedKm2": 0.0, "features": []},
    "0.1": {...},
    ...,
    "25.0": {...}
  }

动机（2026-08-06 用户拍板）：
- 滑块 0.1m 步长 + 拖动连续触发 + uvicorn 单 worker 串行 + 每新档现场演算(1~2.3s)
  → 高水位区间（淹没范围大、多边形边界复杂）卡顿明显。
- 离线预计算全档位 → /api/flood/online 查表秒回(<10ms)，消灭在线演算延迟。
- 多进程并行（每档 1 任务）：连通性演算各档位相互独立，天然可并行；
  numpy/scipy/rasterio 为 C 扩展（释放 GIL），ProcessPoolExecutor 避开 Python 层 GIL。

跑法：
  cd backend/flood-service
  ./.venv/Scripts/python.exe precompute_levels.py

依赖：flood_engine（numpy/scipy/rasterio/shapely）。
"""

from __future__ import annotations

import gzip
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from flood_engine import run_online_flood

LEVEL_START = 0.0
LEVEL_END = 25.0
LEVEL_STEP = 0.1
# 多边形简化容差（米，UTM 系）：300m ≈ 1.25 个 240m 降采样像元——视觉差异可忽略，
# 但顶点数显著下降（95MB → 更小）。与在线动态演算兜底（180m）不冲突。
SIMPLIFY_TOL = 300.0
# 输出：backend/data/flood/flood_levels.json.gz（gzip 压缩，数字字符串压缩率高）
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "flood" / "flood_levels.json.gz"


def _compute(level: float) -> tuple[float, dict]:
    """单档演算（子进程执行）。失败返回 error 标记，不中断整批。"""
    try:
        r = run_online_flood(level, simplify_tol=SIMPLIFY_TOL)
        r.pop("downsample", None)
        r.pop("level", None)
        return level, r
    except Exception as e:  # noqa: BLE001 —— 单档失败记录即可
        return level, {"error": str(e)}


def main() -> None:
    n = int(round((LEVEL_END - LEVEL_START) / LEVEL_STEP)) + 1
    levels = [round(LEVEL_START + i * LEVEL_STEP, 2) for i in range(n)]
    workers = min(os.cpu_count() or 4, 8)
    print(f"预计算 {len(levels)} 档 ({LEVEL_START}~{LEVEL_END}m, 步长 {LEVEL_STEP}m), {workers} 进程")

    result: dict[str, dict] = {}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for i, (level, r) in enumerate(ex.map(_compute, levels)):
            if "error" in r:
                print(f"  ! {level}m 失败: {r['error']}")
                continue
            result[str(level)] = r
            if i % 50 == 0 or i == len(levels) - 1:
                print(
                    f"  [{i + 1}/{len(levels)}] {level}m: "
                    f"{r['featureCount']} 多边形, {r['floodedKm2']} km²"
                )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT_PATH, "wt", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    size_mb = OUT_PATH.stat().st_size / 1024 / 1024
    print(f"写出 {OUT_PATH} ({size_mb:.1f} MB, {len(result)} 档)")


if __name__ == "__main__":
    main()
