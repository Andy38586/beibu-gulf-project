
"""守 `tools/lib/tianditu.py` 是 tools 侧天地图取图三件套唯一来源（必要性审判波二·单元 O）。

为什么必须有这份判据：key 探测顺序与 Web Mercator 瓦片公式抄成第二份不会报错——
只会让两张「对齐参照影像」各偏一格（z17 约 1 km），而偏的是肉眼才看得出的贴图错位
（AGENTS §七-7：同一事实 ≥2 处手抄 ⇒ 指定权威源并派生 + 一条改一处必红守卫）。
断言的不是有没有测试，而是第二份手抄还在不在。

判据面 = `tools/**/*.py`，四路：
  ① 结构路径：站内再定义 read_key / tile_xy / tile_lnglat ⇒ 红。
  ② 公式路径：站内出现 Web Mercator 瓦片式（AST 见 `_mercator_ys` / `_mercator_lat` 两条子式）
      ⇒ 红。
  ③ key 路径：站内再写 `VITE_TIANDITU_KEY` 正则（AST 字符串常量含该变量名且含 \\s*=）⇒ 红。
  ④ 接线路径：两站点仍从权威源取；站点清单不得指向已删文件。

失效条件（诚实边界）：
  - 判据按 AST 结构比对。站点把公式拆成多个中间量、或改用别的等价投影写法（如先转弧度再
    统一 log10），本判据不红——那一层只能靠代码评审；本条只钉「同一写法被抄第二份」。
  - 只认 `math.log` / `math.tan` / `math.sinh` 三个名字族的调用链；`numpy` 版等价写法不在咬合范围。
  - 经度→瓦片 x 式 `(lng + 180.0) / 360.0 * n` 不入判据：它是等距柱状网格的通用写法，
    Cesium terrain 瓦片编号（`tools/dem-pipeline/07c-patch-terrain.py` 的 `cols = 2 ** (z + 1)`、
    `tools/diag/probe-terrain-returned-scope.py` 的 `(n * 2)`）与天地图 WMTS 共用同一式，咬下去
    只得到假红；而 tile_xy 的任何副本都必然带着墨卡托 y 式（已由 `_mercator_ys` 咬住）。
  - 本判据自身被豁免（里面的数值是阳性/近失对照与钉住权威源的断言，不是第二份实现）。
  - 未跟踪目录（`_traetmp/` / `tmp-*` / `.local` 等）不扫——判据输入必须受版本控制（§5.4）。
"""

import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tianditu import KEY_FILES, KEY_PATTERN, read_key, tile_lnglat, tile_xy  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AUTHORITY = ROOT / "tools" / "lib" / "tianditu.py"
GUARD = Path(__file__).resolve()
SCAN_ROOT = ROOT / "tools"
SKIP_DIRS = {"node_modules", ".git", ".local", ".venv", "__pycache__", "coverage", "dist"}
BANNED_DEFS = ("read_key", "tile_xy", "tile_lnglat")
KEY_VAR = "VITE_TIANDITU_KEY"


def _is_math_call(node, names):
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in names
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "math"
    )


def _mercator_ys(node):
    """`... math.log(math.tan(<x>) ± ...) / math.pi ...` —— 墨卡托 y 行的骨架。"""
    has_log = _is_math_call(node, ("log",))
    has_tan = any(_is_math_call(n, ("tan",)) for n in ast.walk(node))
    return has_log and has_tan


def _mercator_lat(node):
    """`math.atan(math.sinh(...))` —— 瓦片号回经纬的骨架。"""
    has_atan = _is_math_call(node, ("atan",))
    has_sinh = any(_is_math_call(n, ("sinh",)) for n in ast.walk(node))
    return has_atan and has_sinh


def _key_regex(node):
    return (
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and KEY_VAR in node.value
        and "\\s*=" in node.value
    )


def find_copies(source, rel):
    """一个源码里有没有第二份手抄——返回命中说明列表（空列表 = 干净）。"""
    hits = []
    tree = ast.parse(source, filename=rel)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in BANNED_DEFS:
            hits.append("%s:%d 站内重定义 %s()" % (rel, node.lineno, node.name))
        if _key_regex(node):
            hits.append("%s:%d 手抄 key 正则" % (rel, node.lineno))
        if _mercator_ys(node):
            hits.append("%s:%d 手抄墨卡托 y 公式" % (rel, node.lineno))
        if _mercator_lat(node):
            hits.append("%s:%d 手抄瓦片号回经纬公式" % (rel, node.lineno))
    return hits


def scan_repo():
    hits = []
    scanned = 0
    for path in sorted(SCAN_ROOT.rglob("*.py")):
        if SKIP_DIRS & set(path.parts) or path.name.startswith("tmp-"):
            continue
        rel = path.relative_to(ROOT).as_posix()
        if path == AUTHORITY or path == GUARD:
            continue
        scanned += 1
        hits.extend(find_copies(path.read_text(encoding="utf-8"), rel))
    return hits, scanned


STATIONS = [
    "tools/3dtiles-build/fetch-port-imagery.py",
    "tools/diag/fetch-imagery.py",
]


def station_line(rel):
    path = ROOT / rel
    if not path.exists():   # 站点被删时走 test_station_paths_exist 的红
        return ""
    for ln in path.read_text(encoding="utf-8").splitlines():
        if ln.startswith("from tianditu import"):
            return ln
    return ""


def test_authority_shape():
    """权威源形状：探测顺序三档、正则能取出 key、公式在极点附近仍自洽。"""
    assert KEY_FILES == (".env", "frontend/.env", "frontend/.env.local")
    import re
    m = re.search(KEY_PATTERN, "VITE_TIANDITU_KEY=abc123")
    assert m and m.group(1) == "abc123"
    for z in (0, 17):
        x, y = tile_xy(0.0, 0.0, z)
        assert abs(x - 2 ** z / 2.0) < 1e-9 and abs(y - 2 ** z / 2.0) < 1e-9
        lng, lat = tile_lnglat(x, y, z)
        assert abs(lng) < 1e-9 and abs(lat) < 1e-9
    # 往返：任意点 → 瓦片号 → 该瓦片内的点，回算经纬必须落在同一格内
    lng, lat, z = 108.6473, 21.6745, 17
    cx, cy = tile_xy(lng, lat, z)
    bx, by = tile_lnglat(cx, cy, z)
    assert abs(bx - lng) < 1e-9 and abs(by - lat) < 1e-9


def test_no_hand_copied_formula():
    """全仓无第二份手抄（阴性 0 命中 + 阳性/近失对照）。"""
    Q = chr(39)
    positive = [
        "def read_key(): pass",
        "def tile_xy(lng, lat, z): pass",
        "def tile_lnglat(x, y, z): pass",
        "y = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n",
        "lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))",
        "m = re.search(r" + Q + KEY_VAR + "\\s*=\\s*(\\S+)" + Q + ", t)",
    ]
    for src in positive:
        assert find_copies(src, "synth-positive.py"), src

    near_miss = [
        "def fetch_key(): pass",
        "def tile_x(lng, z): pass",
        "x = (lng + 180.0) / 360.0",
        "y = math.log(v) / 2.0",
        "lat = math.degrees(math.atan(v))",
        "m = re.search(r" + Q + "VITE_DATA_SOURCE" + Q + ", t)",
        "tile = " + Q + "https://t%d.tianditu.gov.cn/img_w/wmts" + Q,
    ]
    for src in near_miss:
        assert find_copies(src, "synth-negative.py") == [], src

    hits, scanned = scan_repo()
    assert scanned > 50, "扫描面为空 ⇒ 根路径写错，先红（scanned=%d）" % scanned
    assert hits == [], chr(10).join(hits)


def test_stations_take_from_authority():
    """两站点仍从权威源取（不得只删 import 各自为政）。"""
    for rel in STATIONS:
        line = station_line(rel)
        assert line, rel + " 未从 tools/lib/tianditu.py 取图"
        for name in ("read_key", "tile_xy", "tile_lnglat"):
            assert name in line, rel + " 未从权威源取 " + name


def test_station_paths_exist():
    """站点清单不得指向不存在的文件（随源存亡：站点删了清单必须同笔改）。"""
    for rel in STATIONS:
        assert (ROOT / rel).exists(), rel + " 不存在——清单过期"
