# -*- coding: utf-8 -*-
"""
08-backfill-root-tiles.py
补齐 Cesium heightmap-1.0 地形金字塔缺失的根瓦片（2026-09-10 线上事故：
layer.json 声明了 z0 两张全球根瓦片与 1/3/1，但瓦片目录是旧产物、缺这三张，
导致 Cesium 根四叉树建立失败、影像底图被整体拖黑）。

不依赖原始 DEM：用磁盘上已有的子瓦片上采样合成父瓦片，保证与现有金字塔物理一致；
纯海洋瓦片直接写常量。瓦片编码、payload 布局与 childTileMask 位口径见
lib/terrain_enc.py（单一源）：
  - 行主序：北→南、西→东；相邻瓦片共享边缘
  - waterMask：全海洋（高程全 0）= 0xFF，否则 0x00
切片方案：GeographicTilingScheme（EPSG:4326），z 级 cols=2^(z+1)、rows=2^z，y=0 最北。

用法：python 08-backfill-root-tiles.py [terrain_dir]
默认 terrain_dir = backend/static/terrain（相对仓库根）。
幂等：已存在的瓦片不覆盖（除非加 --force）。
"""
from __future__ import annotations

import gzip
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from terrain_enc import OCEAN_VALUE, RAW_BYTES, SAMPLES, build_payload  # noqa: E402
# 目标瓦片：(z,x,y, 是否纯海洋)。顺序：先补子瓦片 1/3/1，再合成其父 0/1/0
TARGETS = [(1, 3, 1, True), (0, 0, 0, True), (0, 1, 0, False)]


def tile_path(root: Path, z: int, x: int, y: int) -> Path:
    return root / str(z) / str(x) / f"{y}.terrain"


def decode_tile(path: Path) -> tuple[np.ndarray, int, int]:
    """返回 (65x65 uint16 高程编码值, childTileMask, waterMask)。"""
    raw = gzip.decompress(path.read_bytes())
    if len(raw) != RAW_BYTES:
        raise ValueError(f"{path} 解压后 {len(raw)}B，期望 {RAW_BYTES}B")
    heights = np.frombuffer(raw[:-2], dtype="<u2").reshape(SAMPLES, SAMPLES).copy()
    return heights, raw[-2], raw[-1]


def encode_tile(heights: np.ndarray, child_mask: int) -> bytes:
    return build_payload(heights, child_mask)


def child_mask_from_disk(root: Path, z: int, x: int, y: int) -> int:
    """按四个子瓦片在磁盘上的存在性计算 childTileMask（位定义见模块 docstring）。"""
    children = {
        0: (2 * x, 2 * y + 1),      # SW
        1: (2 * x + 1, 2 * y + 1),  # SE
        2: (2 * x, 2 * y),          # NW
        3: (2 * x + 1, 2 * y),      # NE
    }
    mask = 0
    for bit, (cx, cy) in children.items():
        if tile_path(root, z + 1, cx, cy).exists():
            mask |= 1 << bit
    return mask


def ocean_tile(root: Path, z: int, x: int, y: int) -> bytes:
    heights = np.full((SAMPLES, SAMPLES), OCEAN_VALUE, dtype="<u2")
    return encode_tile(heights, child_mask_from_disk(root, z, x, y))


def aggregate_from_children(root: Path, z: int, x: int, y: int) -> np.ndarray:
    """从 2x2 子瓦片最近邻采样合成父瓦片 65x65；缺失子瓦片按全海洋处理。"""
    child_index = {
        (0, 0): (2 * x, 2 * y),       # NW
        (1, 0): (2 * x + 1, 2 * y),   # NE
        (0, 1): (2 * x, 2 * y + 1),   # SW
        (1, 1): (2 * x + 1, 2 * y + 1),  # SE
    }
    cache: dict[tuple[int, int], np.ndarray] = {}
    for (qx, qy), (cx, cy) in child_index.items():
        p = tile_path(root, z + 1, cx, cy)
        cache[(qx, qy)] = decode_tile(p)[0] if p.exists() else np.full(
            (SAMPLES, SAMPLES), OCEAN_VALUE, dtype="<u2"
        )

    parent = np.empty((SAMPLES, SAMPLES), dtype="<u2")
    for i in range(SAMPLES):
        v = i / (SAMPLES - 1)          # 北→南 0..1
        qy = min(int(v * 2), 1)
        li = int(round((v * 2 - qy) * (SAMPLES - 1)))
        for j in range(SAMPLES):
            u = j / (SAMPLES - 1)      # 西→东 0..1
            qx = min(int(u * 2), 1)
            lj = int(round((u * 2 - qx) * (SAMPLES - 1)))
            parent[i, j] = cache[(qx, qy)][li, lj]
    return parent


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    root = Path(args[0]) if args else Path("backend/static/terrain")
    if not root.exists():
        print(f"[ERR] 地形目录不存在: {root.resolve()}")
        return 1

    created = []
    for z, x, y, is_ocean in TARGETS:
        out = tile_path(root, z, x, y)
        if out.exists() and not force:
            print(f"[SKIP] {out.relative_to(root)} 已存在（--force 可覆盖）")
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        if is_ocean:
            blob = ocean_tile(root, z, x, y)
        else:
            heights = aggregate_from_children(root, z, x, y)
            blob = encode_tile(heights, child_mask_from_disk(root, z, x, y))
        out.write_bytes(blob)
        # 回读自检
        h, cm, wm = decode_tile(out)
        created.append(f"{z}/{x}/{y}.terrain ({len(blob)}B gzip, 高程编码 {h.min()}-{h.max()}, childMask={cm:04b}, waterMask=0x{wm:02x})")
        print(f"[OK]  {out.relative_to(root)} -> childMask={cm:04b} waterMask=0x{wm:02x} 编码范围 {h.min()}..{h.max()}")

    print(f"\n完成，新增/重写 {len(created)} 张根瓦片。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
