"""
天地图 img_w / WMTS 取图三件套 —— **tools 侧 Python 唯一来源**。

两件事实只在这里写一次：
  ① key 读取契约（`.env` → `frontend/.env` → `frontend/.env.local` 的顺序与正则）
  ② Web Mercator 经纬 ↔ 瓦片号（z 级金字塔，天地图 img_w 同一投影）
URL 拼装与画布拼接不入本件：两站参数不同（定心 8×8 vs 参数化 --lng/--n），不是同一事实。

为什么必须有权威源：`tools/3dtiles-build/fetch-port-imagery.py` 与 `tools/diag/fetch-imagery.py`
曾各抄一份公式。改一边不报错，只会让两张"对齐参照影像"错开一格瓦片（z17 约 1 km），
而错的是"参照贴歪"这种肉眼才看得出的形态（AGENTS §七-7）。第二份手抄由
`tools/lib/test_tianditu.py` 钉住（结构 / 公式 / key 正则三路扫描 + 两站接线）。

失效条件：天地图换投影、或换 WMTS 图层族（`LAYER=img` → 别的）时瓦片号语义随之变，
本件与站点 URL 必须同笔复核；本判据钉的是"没有第二份手抄"，钉不住"投影选对"。
"""

import math
import re

#: key 探测顺序与提取正则（两站原先各抄一份，正则逐字相同）
KEY_FILES = ('.env', 'frontend/.env', 'frontend/.env.local')
KEY_PATTERN = r'VITE_TIANDITU_KEY\s*=\s*(\S+)'


def read_key():
    """按 KEY_FILES 顺序找第一个带 key 的文件；找不到抛 SystemExit（与原两站一致）。"""
    for p in KEY_FILES:
        try:
            with open(p, encoding='utf-8') as f:
                m = re.search(KEY_PATTERN, f.read())
                if m:
                    return m.group(1)
        except OSError:
            pass
    raise SystemExit('找不到 VITE_TIANDITU_KEY（在 .env / frontend/.env）')


def tile_xy(lng, lat, z):
    """经纬 → 瓦片浮点号（左上角为 (0, 0)，取值 [0, n)）。"""
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def tile_lnglat(x, y, z):
    """瓦片号 → 该点经纬（站点用它算 bbox 的西北角与东南角）。"""
    n = 2 ** z
    lng = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lng, lat
