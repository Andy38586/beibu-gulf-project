"""守 `tools/lib/glb.py` 是 tools 侧 Python GLB 读链唯一来源（P4-PY 补做）。

为什么必须有这份判据：chunk 类型字面量与 accessor 布局（componentType → 格式+宽度、type →
分量数、byteStride 步长）抄成第二份不会报错——只会让探针读出的顶点悄悄错开，而错开的是
三维几何（AGENTS §七-7：同一事实出现 ≥2 处手抄 ⇒ 指定权威源并派生 + 一条改一处必红守卫）。
断言的不是有没有测试，而是第二份手抄还在不在。

判据面 = `tools/**/*.py`，五路：
  ① 结构路径：站内再定义 read_glb / read_chunks / acc / accessor ⇒ 红。
  ② 常量路径：chunk 类型字面量（十进制/十六进制/大小写异记法都按 AST 值咬）⇒ 红。
  ③ 布局路径：CS 的 {5126: (f, 4)} 与 NC 的 {VEC3: 3} 形态（值从权威源派生）⇒ 红。
  ④ 取数路径：手写 struct.unpack_from(<II, …) / 自己读 byteStride ⇒ 红。
  ⑤ 接线路径：12 个站点仍从权威源取；站点清单不得指向已删文件。

失效条件（诚实边界）：
  - 判据按 AST 值比对。站点把 CS 拆成两个 dict 再拼、把 格式+宽度 拆成两次下标，或换一种
    字节拼接方式手工切 chunk，判据不红，那一层只能靠代码评审。
  - chunk 头判据只认 <II / =II / @II 三种记法（不认 <2I 这类等价写法）。
  - magic 字面量 0x46546C67 不在禁表：写器与 JS 侧 tools/lib/glb.mjs 都要用它
    拼/校验文件头，它不是读链布局的一部分；禁了就会逼人写第二份等价记法。
  - 本判据自身被豁免（里面的数值是钉住权威常量的断言与阳性对照，不是第二份实现）。
  - 未跟踪目录（_traetmp/ / tmp-* / .local 等）不扫——判据输入必须受版本控制（§5.4）。
"""

import ast
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from glb import BIN_CHUNK, CS, JSON_CHUNK, NC, accessor, read_glb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AUTHORITY = ROOT / "tools" / "lib" / "glb.py"
GUARD = Path(__file__).resolve()
SCAN_ROOT = ROOT / "tools"
SKIP_DIRS = {"node_modules", ".git", ".local", ".venv", "__pycache__", "coverage", "dist"}

BANNED_DEFS = ("read_glb", "read_chunks", "acc", "accessor")
BANNED_INTS = (JSON_CHUNK, BIN_CHUNK)
CS_PAIRS = {(code, fmt, size) for code, (fmt, size) in CS.items()}   # (componentType, 格式, 宽度) 三元
NC_PAIRS = set(NC.items())
STRIDE_KEY = "byteStride"
CHUNK_HEADS = ("<II", "=II", "@II")
Q = chr(39)   # 单引号：下面阳性/近失样本要拼出 Python 源码，写成字面量会与本判据的扫描面自指


def _const(node):
    return node.value if isinstance(node, ast.Constant) else None


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _tuple_pair(node):
    if not isinstance(node, ast.Tuple) or len(node.elts) != 2:
        return None
    return (_const(node.elts[0]), _const(node.elts[1]))


def find_copies(source, rel):
    """一个源码里有没有第二份手抄——返回命中说明列表（空列表 = 干净）。"""
    hits = []
    tree = ast.parse(source, filename=rel)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in BANNED_DEFS:
            hits.append("%s:%d 站内重定义 %s()" % (rel, node.lineno, node.name))
        if isinstance(node, ast.Constant):
            if _is_int(node.value) and node.value in BANNED_INTS:
                hits.append("%s:%d chunk 类型字面量 %d" % (rel, node.lineno, node.value))
            elif node.value == STRIDE_KEY:
                hits.append("%s:%d 手写 accessor 步长（byteStride）" % (rel, node.lineno))
        if isinstance(node, ast.Dict):
            for key, val in zip(node.keys, node.values):
                kv = _const(key)
                if _is_int(kv):
                    pair = _tuple_pair(val)
                    if pair is not None and (kv, pair[0], pair[1]) in CS_PAIRS:
                        hits.append("%s:%d CS 布局 %r" % (rel, node.lineno, pair))
                elif isinstance(kv, str):
                    vv = _const(val)
                    if _is_int(vv) and (kv, vv) in NC_PAIRS:
                        hits.append("%s:%d NC 分量数 %r" % (rel, node.lineno, (kv, vv)))
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Attribute) and fn.attr in ("unpack_from", "unpack") and node.args:
                first = _const(node.args[0])
                if isinstance(first, str) and first in CHUNK_HEADS:
                    hits.append("%s:%d 手写 chunk 头解析 %r" % (rel, node.lineno, first))
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


def station_lines(rel):
    if not (ROOT / rel).exists():   # 站点被删时走 test_station_paths_exist 的红，不在这里抛 FileNotFoundError
        return []
    text = (ROOT / rel).read_text(encoding="utf-8")
    return [ln for ln in text.splitlines() if ln.startswith("from glb import")]


STATIONS = [
    "tools/3dtiles-build/reframe-hubs.py",
    "tools/diag/align-fresh.py",
    "tools/diag/decision-overlay.py",
    "tools/diag/port-align.py",
    "tools/diag/port-overlay.py",
    "tools/diag/port-quay-offset.py",
    "tools/diag/preview-roads-vertfollow.py",
    "tools/diag/probe-3dtiles-facing.py",
    "tools/diag/probe-bridge-vert.py",
    "tools/diag/probe-hub-heights.py",
    "tools/diag/probe-port-cargo-vs-water.py",
    "tools/diag/probe-port-roads-vs-ground.py",
]


def test_authority_shape():
    """权威源形状：chunk 类型、六种 componentType、四种 type 自洽。"""
    assert JSON_CHUNK == 0x4E4F534A and BIN_CHUNK == 0x004E4942
    assert sorted(CS) == [5120, 5121, 5122, 5123, 5125, 5126]
    assert sorted(NC) == ["SCALAR", "VEC2", "VEC3", "VEC4"]
    assert all(len(fmt) == 1 and size in (1, 2, 4) for fmt, size in CS.values())
    assert NC["VEC3"] == 3 and NC["SCALAR"] == 1


def test_read_glb_and_accessor_on_real_corpus():
    """真语料（入库的 canal.glb）：read_glb 切块 + accessor 取数形状与 dtype 正确。"""
    corpus = ROOT / "backend" / "static" / "pinglu" / "canal" / "canal.glb"
    assert corpus.exists(), "夹具不在版本控制内：%s" % corpus
    js, bin_ = read_glb(corpus)
    assert isinstance(js, dict) and js.get("asset", {}).get("version") == "2.0"
    assert isinstance(bin_, bytes) and bytes(bin_)
    a = js["accessors"][0]
    arr = accessor(js, bin_, 0)
    assert arr.shape == (a["count"], NC[a["type"]])
    assert arr.dtype == np.dtype("<" + CS[a["componentType"]][0])


def test_no_hand_copied_glb_layout():
    """全仓无第二份手抄（阴性 0 命中 + 阳性/近失对照）。"""
    # 对照值一律从权威源派生，不得手写——否则改权威值会让判据自己误红
    positive = [
        "def read_glb(path): pass",
        "def read_chunks(p): pass",
        "def acc(j, b, i): pass",
        "def accessor(js, bin_, i): pass",
        "ty = %d" % JSON_CHUNK,
        "ty = 0x%08x" % JSON_CHUNK,
        "ty = 0X%08X" % JSON_CHUNK,
        "CS = {5126: (" + Q + "f" + Q + ", 4)}",
        "NC = {" + Q + "VEC3" + Q + ": 3}",
        "ln, ty = struct.unpack_from(" + Q + "<II" + Q + ", b, off)",
        "st = bv.get(" + Q + "byteStride" + Q + ") or sz * nc",
    ]
    for src in positive:
        assert find_copies(src, "synth-positive.py"), src

    # 近失样本：同形但不同值 / 无关用法 ⇒ 不许红
    near_miss = [
        "def read_gltf(path): pass",
        "def reader(p): pass",
        "ty = 0x46546C67",
        "ty = 0x4E4F534B",
        "CS = {5126: (" + Q + "f" + Q + ", 8)}",
        "CS = {5127: (" + Q + "f" + Q + ", 4)}",
        "NC = {" + Q + "VEC5" + Q + ": 5}",
        "NC = {" + Q + "VEC3" + Q + ": 4}",
        "st = bv.get(" + Q + "byteOffset" + Q + ") or 0",
        "ln, ty = struct.unpack_from(" + Q + "<III" + Q + ", b, off)",
    ]
    for src in near_miss:
        assert find_copies(src, "synth-negative.py") == [], src

    hits, scanned = scan_repo()
    assert scanned > 50, "扫描面为空 ⇒ 根路径写错，先红（scanned=%d）" % scanned
    assert hits == [], chr(10).join(hits)


def test_stations_take_from_authority():
    """12 个站点仍从权威源取（不得只删 import 各自为政）。"""
    for rel in STATIONS:
        lines = station_lines(rel)
        assert lines, rel + " 未从 tools/lib/glb.py 取 GLB 读链"


def test_station_paths_exist():
    """站点清单不得指向不存在的文件（随源存亡：站点删了清单必须同笔改）。"""
    for rel in STATIONS:
        assert (ROOT / rel).exists(), rel + " 不存在——清单过期"
