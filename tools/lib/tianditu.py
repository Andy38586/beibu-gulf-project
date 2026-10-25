"""
天地图 img_w / WMTS 取图 —— **tools 侧 Python 唯一来源**。

三件事实只在这里写一次：
  ① key 读取契约（`.env` → `frontend/.env` → `frontend/.env.local` 的顺序与正则）
  ② Web Mercator 经纬 ↔ 瓦片号（z 级金字塔，天地图 img_w 同一投影）
  ③ WMTS 取图 URL 模板与 n×n 拼图循环（2026-10-25 F67 收口：两站原先逐字各抄一份，
     只有失败文案与输出元数据不同 ⇒ 文案由 `on_error` 回调留给站点）

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


#: WMTS 取图 URL 模板（两站原先逐字各抄一份，仅换行位置不同）
TILE_URL = (
    'https://t{sub}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    '&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles'
    '&TILEMATRIX={z}&TILEROW={row}&TILECOL={col}&tk={key}'
)


def tile_url(col, row, z, key, sub):
    """单张瓦片 URL（`sub` = 子域号 0..7，两站都按行号取模）。"""
    return TILE_URL.format(sub=sub, z=z, row=row, col=col, key=key)


def fetch_mosaic(x0, y0, z, n, on_error=None):
    """从起始瓦片 (x0, y0) 起拼 n×n 张 256px 瓦片成一张 RGB 大图。

    返回 `(canvas, 成功张数)`；单张失败回调 `on_error(col, row, exc)` 由站点自己措辞
    （两站失败文案与截断长度不同，故不在此写死）。PIL/urllib 延迟导入：本件其余函数
    （key 与瓦片号）不依赖这两个可选依赖，测试机没有 Pillow 也要能 import。
    """
    import urllib.request
    from io import BytesIO

    from PIL import Image

    key = read_key()
    canvas = Image.new('RGB', (256 * n, 256 * n))
    ok = 0
    for j in range(n):
        for i in range(n):
            col, row = x0 + i, y0 + j
            try:
                req = urllib.request.Request(
                    tile_url(col, row, z, key, j % 8), headers={'User-Agent': 'Mozilla/5.0'}
                )
                data = urllib.request.urlopen(req, timeout=30).read()
                canvas.paste(Image.open(BytesIO(data)).convert('RGB'), (i * 256, j * 256))
                ok += 1
            except Exception as e:  # noqa: BLE001 —— 单张失败不该中断整幅
                if on_error:
                    on_error(col, row, e)
    return canvas, ok
