"""守 `tools/lib/geo.py` 是 tools 侧 Python 椭球底座**唯一**来源（P4 收口）。

为什么必须有这份判据：把 A / 1/f / 每度米抄成第二份**不会报错**——只会让交付包与探针的
落位悄悄错开（改一处不报错 = AGENTS §七-7）。断言的不是"有没有测试"，而是"第二份手抄还在不在"。

判据面 = `tools/**/*.py`（实测 250 个 .py 全在 tools/ 下；frontend/backend 无 .py 站点），两路：
  ① 常量路径：任何数值字面量命中 A / 1/f / E2 / 111320 / 110574（相对容差 1e-12）⇒ 红。
  ② 公式路径：站内再抄一遍换算公式（常量换记法也拦得住）——
     `sqrt(1 - …)` / `atan2(z, …)` / `atan2(y, x)` / `hypot(x, y)`。
     2026-10-17 实测除 geo.py 自身外，这四式在 tools/ 内 0 命中。

失效条件（诚实边界）：
  - 判据只认这四种记法。站内把标识符全改名（`np.arctan2(px, py)`）后重抄公式，判据**不红**，
    那一层只能靠代码评审。
  - 常量路径是相对容差 1e-12，等价小数（`6378137.0000001`）仍红，但藏进别的算术
    （`A = 6378136 + 1`）不红。
  - 本判据自身被豁免（里面的数值是**钉住权威值的断言**，不是第二份实现）；代价 = 该文件内的
    第二份实现扫不到。
  - 每度纬长族里 `110540.0`（tools/diag/port-quay-offset.py:48）与 `111412.84 / 111132.9`
    （dem-pipeline 07b/07c）是**异值异族**，不在禁表内——它们不是 110574 / 111320 的等价记法。
  - 未跟踪目录（`_traetmp/` / `tmp-*` / `.local` 等）不扫——判据输入必须受版本控制（§5.4）。
"""

import ast
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from geo import DEG_M_LAT, DEG_M_LNG, WGS84_A, WGS84_E2, WGS84_F, ecef_to_geo  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AUTHORITY = ROOT / 'tools' / 'lib' / 'geo.py'
GUARD = Path(__file__).resolve()
SCAN_ROOT = ROOT / 'tools'
SKIP_DIRS = {'node_modules', '.git', '.local', '.venv', '__pycache__', 'coverage', 'dist'}

#: 常量禁表：WGS84 长半轴 / 扁率倒数 / 派生 E2 / 每度米（都只该住在 geo.py）
BANNED = [WGS84_A, 1 / WGS84_F, WGS84_E2, DEG_M_LNG, DEG_M_LAT]


def _banned(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return any(abs(value - b) <= 1e-12 * abs(b) for b in BANNED)


def _dotted(node):
    """`np.sqrt` / `math.atan2` → 'np.sqrt'；否则空串。"""
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return node.value.id + '.' + node.attr
    return ''


def _name(node):
    return node.id if isinstance(node, ast.Name) else ''


def _is_one_minus(arg):
    """必须是 `1 - …`：仓内 `hypot(x1 - x0, y1 - y0)` 之类是无关同形，不得误红。"""
    return (isinstance(arg, ast.BinOp) and isinstance(arg.op, ast.Sub)
            and isinstance(arg.left, ast.Constant) and arg.left.value == 1)


def find_copies(source, rel):
    """一个源码里有没有"第二份手抄"——返回命中说明列表（空列表 = 干净）。"""
    hits = []
    tree = ast.parse(source, filename=rel)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and _banned(node.value):
            hits.append('%s:%d 常量 %r' % (rel, node.lineno, node.value))
        if not isinstance(node, ast.Call):
            continue
        fn = _dotted(node.func)
        args = node.args
        if fn in ('np.sqrt', 'math.sqrt') and args and _is_one_minus(args[0]):
            hits.append('%s:%d sqrt(1 - …)' % (rel, node.lineno))
        if fn in ('np.arctan2', 'math.arctan2') and args and _name(args[0]) == 'z':
            hits.append('%s:%d arctan2(z, …)' % (rel, node.lineno))
        if fn in ('np.arctan2', 'math.arctan2') and len(args) >= 2 and _name(args[0]) == 'y' and _name(args[1]) == 'x':
            hits.append('%s:%d arctan2(y, x)' % (rel, node.lineno))
        if fn in ('np.hypot', 'math.hypot') and len(args) >= 2 and _name(args[0]) == 'x' and _name(args[1]) == 'y':
            hits.append('%s:%d hypot(x, y)' % (rel, node.lineno))
    return hits


def scan_repo():
    hits = []
    scanned = 0
    for path in sorted(SCAN_ROOT.rglob('*.py')):
        if SKIP_DIRS & set(path.parts) or path.name.startswith('tmp-'):
            continue
        rel = path.relative_to(ROOT).as_posix()
        if path == AUTHORITY or path == GUARD:
            continue
        scanned += 1
        hits.extend(find_copies(path.read_text(encoding='utf-8'), rel))
    return hits, scanned


def station_lines(rel):
    if not (ROOT / rel).exists():   # 站点被删时走 test_station_paths_exist 的红，不在这里抛 FileNotFoundError
        return []
    text = (ROOT / rel).read_text(encoding='utf-8')
    return [ln for ln in text.splitlines() if ln.startswith('from geo import')]


STATIONS = [
    'tools/3dtiles-build/reframe-hubs.py',
    'tools/dem-pipeline/14-bathy-fuse.py',
    'tools/diag/align-fresh.py',
    'tools/diag/decision-overlay.py',
    'tools/diag/port-align.py',
    'tools/diag/port-overlay.py',
    'tools/diag/port-quay-offset.py',
    'tools/diag/probe-bridge-vert.py',
    'tools/diag/probe-hub-heights.py',
    'tools/diag/probe-port-cargo-vs-water.py',
    'tools/flood/rederive-terrain-profiles.py',
    'tools/industry-fit/kde-verify.py',
]


def test_authority_shape():
    """权威源形状：WGS84 参数自洽，每度米为正。"""
    assert WGS84_A == 6378137.0
    assert WGS84_F == 1 / 298.257223563
    assert abs(WGS84_F * (2 - WGS84_F) - WGS84_E2) <= 1e-18
    assert DEG_M_LNG > DEG_M_LAT  # 赤道处 1° 经度 > 1° 纬度


def test_roundtrip_and_m_per_deg():
    """反算与每度米可用：正算 → 反算回到原点，每度经长随纬度收缩。"""
    lng, lat, h = 108.940167, 22.447154, 20.0
    b = math.radians(lat)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(b) ** 2)
    x = (n + h) * math.cos(b) * math.cos(math.radians(lng))
    y = (n + h) * math.cos(b) * math.sin(math.radians(lng))
    z = (n * (1 - WGS84_E2) + h) * math.sin(b)
    got_lng, got_lat, got_h = ecef_to_geo([x, y, z])
    assert abs(got_lng - lng) <= 1e-9 and abs(got_lat - lat) <= 1e-9 and abs(got_h - h) <= 1e-6, (got_lng, got_lat, got_h)


def test_no_hand_copied_elliptical_constants():
    """全仓无第二份手抄（阴性 0 命中 + 阳性/近失对照）。"""
    # 对照值一律从权威源派生，不得手写——否则改权威值会让判据自己误红
    positive = [
        'A = %r' % WGS84_A,
        'F = 1 / %r' % (1 / WGS84_F),
        'M = %r' % DEG_M_LNG,
        'N = np.sqrt(1 - E2 * np.sin(a) ** 2)',
        'lat = np.arctan2(z, p * (1 - E2))',
        'lng = np.arctan2(y, x)',
        'p2 = np.hypot(x, y)',
    ]
    for src in positive:
        assert find_copies(src, 'synth-positive.py'), src

    # 近失样本：同形但不含禁值、公式不成形 ⇒ 不许红
    near_miss = [
        'A = %r' % (WGS84_A + 1),
        'M = %r' % (DEG_M_LNG + 1),
        'M = 110540.0',
        'M = 111412.84',
        'seg = math.hypot(x1 - x0, y1 - y0)',
        'N = np.sqrt(2 - E2 * np.sin(a) ** 2)',
        'lat = np.arctan2(zz, p)',
    ]
    for src in near_miss:
        assert find_copies(src, 'synth-negative.py') == [], src

    hits, scanned = scan_repo()
    assert scanned > 50, '扫描面为空 ⇒ 根路径写错，先红（scanned=%d）' % scanned
    assert hits == [], chr(10).join(hits)


def test_stations_take_from_authority():
    """12 个站点仍从权威源取（不得只删 import 各自为政）。"""
    for rel in STATIONS:
        lines = station_lines(rel)
        assert lines, rel + ' 未从 tools/lib/geo.py 取地理底座'


def test_station_paths_exist():
    """站点清单不得指向不存在的文件（随源存亡：站点删了清单必须同笔改）。"""
    for rel in STATIONS:
        assert (ROOT / rel).exists(), rel + ' 不存在——清单过期'
