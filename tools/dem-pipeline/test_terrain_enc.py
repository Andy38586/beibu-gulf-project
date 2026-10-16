# -*- coding: utf-8 -*-
"""terrain_enc 单源与六站点的接线判据（pytest，跑在 dem-pipeline venv）。

背景（task-2 / P3·D23 余项）：Cesium heightmap-1.0 的编解码常量与算式曾在六个文件里各自
手抄（07 / 07c / 08 / 09 与 tools/diag 的两个地形探针）。本文件钉住"只有 lib/terrain_enc.py
一份"这件事，以及 lib 的行为与 Cesium 规范一致：

  · 任一站把常量或算式搬回来（含换记法：1e3 / 0xFFFF / 字面 5）⇒ test_no_hand_copied_encoding 必红；
  · 任一站摘掉 terrain_enc 的 import（停用共享实现）⇒ test_stations_import_single_source 必红；
  · lib 的编码值被改写 ⇒ test_encode_* / test_read_heights_* 必红；
  · lib 的 SAMPLES / RAW_BYTES 被改写 ⇒ test_payload_layout_* 必红；
  · 等价重构（np.clip ↔ minimum+maximum / 改写循环）不许红。

运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/dem-pipeline/test_terrain_enc.py -q
"""
from __future__ import annotations

import ast
import gzip
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
LIB_DIR = ROOT / "tools" / "dem-pipeline" / "lib"
sys.path.insert(0, str(LIB_DIR))
import terrain_enc as te  # noqa: E402

# 六个站点：生产侧 4 + 消费侧探针 2（全仓扫描确认无第七站，见 relay 文档 §三 D23）
STATIONS = [
    "tools/dem-pipeline/07-heightmap-reslice.py",
    "tools/dem-pipeline/07c-patch-terrain.py",
    "tools/dem-pipeline/08-backfill-root-tiles.py",
    "tools/dem-pipeline/09-audit-terrain.py",
    "tools/diag/probe-terrain-vs-dem.py",
    "tools/diag/probe-terrain-returned-scope.py",
]

# 编码口径的数值面：常量表 + 算式形状（形状用于堵"换记法"，如 x*5 / 5*x / x+1e3）
FORBIDDEN_INT = {65, 5000, 65535, 8452}
FORBIDDEN_FLOAT = {1000.0}
ENCODING_FACTORS = {5.0, 1000.0}  # ENC_SCALE / ENC_OFFSET 的值面
LIB_NAMES = {"SAMPLES", "ENC_OFFSET", "ENC_SCALE", "UINT16_MAX", "OCEAN_VALUE", "RAW_BYTES"}


def _tree(rel: str) -> tuple[ast.Module, str]:
    src = (ROOT / rel).read_text(encoding="utf-8")
    return ast.parse(src), src


def test_no_hand_copied_encoding():
    """六站点里不得再出现编码常量与算式（含换记法）。"""
    offenders: list[str] = []
    for rel in STATIONS:
        tree, src = _tree(rel)
        lines = src.splitlines()
        for node in ast.walk(tree):
            bad = False
            if isinstance(node, ast.Constant) and not isinstance(node.value, bool):
                bad = (isinstance(node.value, int) and node.value in FORBIDDEN_INT) or (
                    isinstance(node.value, float) and node.value in FORBIDDEN_FLOAT
                )
            elif isinstance(node, ast.BinOp) and isinstance(
                node.op, (ast.Mult, ast.Div, ast.Add, ast.Sub)
            ):
                # 换记法：x*5 / 5*x / x/5 / x+1000 / 5.0/... 任一操作数是编码因子即红
                for side in (node.left, node.right):
                    if isinstance(side, ast.Constant) and isinstance(side.value, (int, float)):
                        if not isinstance(side.value, bool) and side.value in ENCODING_FACTORS:
                            bad = True
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for t in targets:
                    if isinstance(t, ast.Name) and t.id in LIB_NAMES:
                        bad = True  # 站内自建 lib 常量名 = 第二份权威
            else:
                continue
            if bad:
                offenders.append(f"{rel}:{node.lineno} {lines[node.lineno - 1].strip()[:80]}")
    assert not offenders, "站点里出现手抄的编码常量/算式（应收口到 lib/terrain_enc.py）：\n" + "\n".join(offenders)


def test_stations_import_single_source():
    """每站必须 from terrain_enc import ...，且 lib 目录在 sys.path 上。"""
    missing: list[str] = []
    for rel in STATIONS:
        tree, src = _tree(rel)
        names: set[str] = set()
        has_path = False
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "terrain_enc":
                names |= {a.name for a in node.names}
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                # sys.path.insert(0, <指向 lib 的表达式>)
                if node.func.attr == "insert" and len(node.args) > 1:
                    if "lib" in ast.unparse(node.args[1]):
                        has_path = True
        if not names:
            missing.append(f"{rel}: 未从 terrain_enc 导入任何名字")
        elif not has_path:
            missing.append(f"{rel}: 导入了 {sorted(names)} 但 sys.path 未指向 lib")
    assert not missing, "共享实现被停用（import 摘掉或 sys.path 缺失）：\n" + "\n".join(missing)


@pytest.mark.parametrize(
    "meters,code",
    [
        (-1000.0, 0),  # 下界
        (-1500.0, 0),  # 越界收口
        (-0.2, 4999),
        (0.0, te.OCEAN_VALUE),  # 海洋/NoData 记法
        (1000.0, 10000),
        (12000.0, 65000),  # 覆盖域上沿
        (20000.0, 65535),  # 越界收口
    ],
)
def test_encode_frozen_values(meters: float, code: int):
    got = te.encode(np.array([[meters]], dtype=np.float64))
    assert got.dtype == np.dtype("<u2")
    assert int(got[0, 0]) == code


def test_ocean_is_zero_meters():
    """OCEAN_VALUE 与 ENC_* 的口径必须自洽：0 m 的编码值即海洋记法。"""
    assert te.encode(np.array([[0.0]]))[0, 0] == te.OCEAN_VALUE
    assert te.ENC_OFFSET + 0.0 * te.ENC_SCALE == te.ENC_OFFSET


def test_read_heights_round_trip(tmp_path: Path):
    src = np.linspace(-100.0, 2000.0, te.SAMPLES * te.SAMPLES).reshape(te.SAMPLES, te.SAMPLES)
    p = tmp_path / "t.terrain"
    p.write_bytes(gzip.compress(te.encode(src).tobytes() + bytes([0x0F, 0xFF]), mtime=0))
    got = te.read_heights(p)
    assert got.shape == (te.SAMPLES, te.SAMPLES)
    # 期望 = encode 的投影（量化到 1/ENC_SCALE 米），不是原值本身
    assert np.allclose(got, te.encode(src).astype(np.float64) / te.ENC_SCALE - te.ENC_OFFSET)


def test_payload_layout_is_heights_plus_two_masks(tmp_path: Path):
    """payload 布局：heights 在前、尾部 2B 掩膜，解压后长度 = RAW_BYTES。"""
    heights = np.full((te.SAMPLES, te.SAMPLES), 12.0)
    p = tmp_path / "t.terrain"
    p.write_bytes(gzip.compress(te.encode(heights).tobytes() + bytes([0x0F, 0xFF]), mtime=0))
    raw = gzip.decompress(p.read_bytes())
    assert len(raw) == te.RAW_BYTES == te.SAMPLES * te.SAMPLES * 2 + 2
    assert int(te.read_heights(p).max()) == 12
    assert raw[-2:] == bytes([0x0F, 0xFF])
