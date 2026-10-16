"""桥构件色单源判据（P3·D23 余项）——钉三件事：

1. 权威源 tools/lib/bridge-palette.mjs 的对象字面量形状（4 构件 x 3 通道，值域 [0,1]）；
2. 探针 probe-bridge-vert.py 的调色板确实读自该文件（不是硬编码、不是第二份手抄）；
3. 全仓 tools/ 下的 .py 里不再出现与权威源同值的 3 元素数字字面量
   （换记法 8e-1 / 换容器 (...) 同判）。

为什么需要扫描型判据：色值抄成第二份不会报错，只会让分桶为空、判据恒红（AGENTS 第七节-8）。
变异对照：把 load_bridge_palette 换回内联字面量 ⇒ 用例 3 必红；把它改成写死返回值 ⇒ 用例 2 必红。
"""
import ast
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROBE = os.path.join(HERE, "probe-bridge-vert.py")
PALETTE_SOURCE = os.path.join(ROOT, "tools", "lib", "bridge-palette.mjs")
SKIP_DIRS = {"node_modules", ".git", ".local", ".venv", "__pycache__", "coverage", "dist", "data"}

sys.path.insert(0, HERE)


def _load_probe():
    spec = importlib.util.spec_from_file_location("probe_bridge_vert", PROBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


probe = _load_probe()


def _triples(source):
    """返回源码里「3 个数字字面量元素」的 List/Tuple 字面量：(值列表, 行号)。"""
    hits = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, (ast.List, ast.Tuple)) or len(node.elts) != 3:
            continue
        vals = []
        for e in node.elts:
            if isinstance(e, ast.Constant) and isinstance(e.value, (int, float)) and not isinstance(e.value, bool):
                vals.append(float(e.value))
            else:
                break
        if len(vals) == 3:
            hits.append((vals, node.lineno))
    return hits


def _matches_palette(vals, palette=None):
    palette = palette if palette is not None else probe.PALETTE
    return any(all(abs(a - b) < 1e-9 for a, b in zip(vals, t)) for t in palette.values())


def test_palette_source_shape():
    assert os.path.basename(probe.PALETTE_SOURCE) == "bridge-palette.mjs"
    assert os.path.abspath(probe.PALETTE_SOURCE) == os.path.abspath(PALETTE_SOURCE)
    assert list(probe.PALETTE) == ["deck", "pier", "rail", "tower"]
    for name, rgb in probe.PALETTE.items():
        assert len(rgb) == 3, name
        assert all(0.0 <= c <= 1.0 for c in rgb), name


def test_probe_reads_authoritative_file():
    """反硬编码：权威源换了值，探针必须跟着换；源里没有对象字面量必须抛。"""
    with tempfile.TemporaryDirectory() as d:
        other = os.path.join(d, "bridge-palette.mjs")
        with open(other, "w", encoding="utf-8") as f:
            f.write("""export const BRIDGE_PALETTE = {
  deck: [0.11, 0.12, 0.13],
  pier: [0.21, 0.22, 0.23],
  rail: [0.31, 0.32, 0.33],
  tower: [0.41, 0.42, 0.43],
}
""")
        assert probe.load_bridge_palette(other)["deck"] == [0.11, 0.12, 0.13]
        empty = os.path.join(d, "empty.mjs")
        open(empty, "w", encoding="utf-8").close()
        try:
            probe.load_bridge_palette(empty)
        except ValueError:
            pass
        else:
            raise AssertionError("权威源缺失时探针必须抛 ValueError，不得静默取空")


def test_no_hand_copied_palette_in_probe():
    """探针内不得内联权威源里那三组色值（换记法 8e-1 同判）。"""
    with open(PROBE, encoding="utf-8") as f:
        source = f.read()
    hits = ["%s:%d" % (PROBE, ln) for vals, ln in _triples(source) if _matches_palette(vals)]
    assert hits == [], "探针里出现手抄色值：%s" % hits


def test_scan_has_positive_and_negative_controls():
    """阳性对照保证扫描器咬得住；阴性对照保证不是恒真。

    对照样本一律**从权威源派生**且以字符串持有：派生是为了改色值后不误红
    （2026-10-16 变异 F 实测）；持字符串是因为本文件自己也在扫描面内（自适用），
    写成真 List/Tuple 字面量会让用例 5 先自红。
    """
    palette = probe.PALETTE
    d0, d1, d2 = palette["deck"]
    p0, p1, p2 = palette["pier"]
    inline = "D = [%r, %r, %r]" % (d0, d1, d2)
    exponent = "D = (%r, %r, %r)" % (float(d0), d1, float(d2))
    near_miss = "D = [%r, %r, %r]" % (d0, d1, d2 + 0.01)
    assert [1] == [ln for _, ln in _triples(inline)]
    assert _matches_palette(_triples(inline)[0][0], palette)
    assert _matches_palette(_triples(exponent)[0][0], palette)
    assert _matches_palette(_triples("D = [%r, %r, %r]" % (p0, p1, p2))[0][0], palette)
    assert not _matches_palette(_triples(near_miss)[0][0], palette)


def test_no_second_copy_across_python_sources():
    """全仓 tools/ 下 .py 扫描：阳性对照保证扫得动，再断言 0 命中。"""
    scanned, hits = 0, []
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "tools")):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith("tmp-")]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dirpath, fn)
            scanned += 1
            with open(path, encoding="utf-8", errors="replace") as f:
                source = f.read()
            hits += ["%s:%d" % (path, ln) for vals, ln in _triples(source) if _matches_palette(vals)]
    assert scanned > 10, "扫描面为空（%d）⇒ 路径写错，先红" % scanned
    assert hits == [], "出现第二份桥构件色：%s" % hits
