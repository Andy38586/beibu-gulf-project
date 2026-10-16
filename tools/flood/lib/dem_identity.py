# -*- coding: utf-8 -*-
"""DEM 溯源标识的唯一实现（CMC01 收口计划 P5 · 一段交接 §三 A2）。

为什么单独成模块：`(人读标签, md5)` 被两个生成脚本共用——
`flood_realify.py`（统计/设施点）与 `rederive-terrain-profiles.py`（剖面）。
两处曾各有一份逐字相同的手抄实现：改一处文案而另一处不同步，同一份 DEM 在两件
产物自述里就会显示成两个来源（04-B10 的"自述必须指到同一份输入"随之失效）。

缺失即抛：无 DEM 的"重算"只会产出假产物。
"""
from __future__ import annotations

import hashlib
from pathlib import Path

def dem_identity(path: Path) -> tuple[str, str]:
    """返回 (人读标签, md5)。"""
    digest = hashlib.md5(path.read_bytes()).hexdigest()
    merged = "landsea" in path.name
    label = (
        f"{path.name}（海陆一体 ASTER GDEM 填洼 + SRTM15+ 水深，EGM96 正高，30m）"
        if merged
        else f"{path.name}（陆地填洼版，海=NoData，EGM96 正高，30m）"
    )
    return label, digest
