# -*- coding: utf-8 -*-
"""terrain-enc.py — Cesium heightmap-1.0 地形瓦片编解码的单一源（P3·D23 余项）。

规范（CesiumTerrainProvider.createHeightmapTerrainData）：
  · 每瓦片 SAMPLES×SAMPLES uint16 小端，行主序北→南、西→东，相邻瓦片共享边缘；
  · 编码值 = (高程米 + ENC_OFFSET) * ENC_SCALE，收口到 [0, UINT16_MAX]；
  · 海洋/NoData 按 0 m 计 ⇒ 编码 OCEAN_VALUE；
  · payload = gzip(heights.tobytes() + 1B childTileMask + 1B waterMask)；
    childTileMask 位 bit0=SW(2x, 2y+1) bit1=SE(2x+1, 2y+1) bit2=NW(2x, 2y) bit3=NE(2x+1, 2y)。

为什么单源：07 / 07c / 08 / 09 与 tools/diag 的两个地形探针曾各自手抄这组常量与算式。
判据见 tools/dem-pipeline/test_terrain_enc.py —— 任一站点换回字面量、或摘掉本模块的
import，对应断言即红。
"""
from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np

SAMPLES = 65  # heightmap-1.0 默认网格（CesiumTerrainProvider heightmapWidth）
ENC_OFFSET = 1000.0
ENC_SCALE = 5.0
UINT16_MAX = 65535  # 编码值上限（uint16；-1000..10086 m 覆盖域）
OCEAN_VALUE = 5000  # 0 m 的编码值（海洋/NoData 记法）
RAW_BYTES = SAMPLES * SAMPLES * 2 + 2  # 解压后 payload 长度：heights + childTileMask + waterMask


def encode(heights: np.ndarray) -> np.ndarray:
    """高程（米，float）→ uint16 编码值；越界收口到 [0, UINT16_MAX]。"""
    return np.clip((heights + ENC_OFFSET) * ENC_SCALE, 0, UINT16_MAX).astype("<u2")


def read_heights(path: Path) -> np.ndarray:
    """读 .terrain（gzip）→ SAMPLES×SAMPLES 高程（米，float64）；尾部 2B 掩膜不参与换算。"""
    raw = gzip.decompress(Path(path).read_bytes())
    grid = np.frombuffer(raw[: SAMPLES * SAMPLES * 2], dtype="<u2").reshape(SAMPLES, SAMPLES)
    return grid.astype(np.float64) / ENC_SCALE - ENC_OFFSET
