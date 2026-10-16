/**
 * glb.mjs — GLB 读链底座（tools 侧 JS **唯一**来源）。
 *
 * 与 PY 侧 `tools/lib/glb.py` 同口径：CS/NC 两张表、accessor 步长与返回元素宽度逐一对应。
 * 与 `tools/lib/geo.mjs` 同层同风格：站点只准 `import … from '../lib/glb.mjs'`，
 * 不得再写 0x4e4f534a / CS / NC / readGLB / accessor 的第二份手抄。
 *
 * 口径（与 PY 侧的差异一处，见 `tools/lib/glb.py` 头注）：本件**校验** magic 与「缺 chunk」并抛错；
 * PY 侧 11/12 站原状不校验，故 glb.py 保持不校验。
 *
 * 返回元素宽度 = componentType 的原生宽度（5126 → Float32Array、5123 → Uint16Array …），
 * 与 numpy 侧 `np.frombuffer(dtype='<f4'|'<u2'|…)` 一致；要双精度运算的站点自行转换。
 */
import fs from 'node:fs'

export const GLB_MAGIC = 0x46546c67
export const JSON_CHUNK = 0x4e4f534a
export const BIN_CHUNK = 0x004e4942
/** componentType → 每元素字节宽（glTF 2.0 §3.6.2.2） */
export const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
/** type → 每元素分量数 */
export const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

const READERS = {
  5120: (b, o) => b.readInt8(o),
  5121: (b, o) => b.readUInt8(o),
  5122: (b, o) => b.readInt16LE(o),
  5123: (b, o) => b.readUInt16LE(o),
  5125: (b, o) => b.readUInt32LE(o),
  5126: (b, o) => b.readFloatLE(o),
}
const TYPED = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}

/** 读 GLB：切 JSON 块与 BIN 块；magic 不符或缺块即抛（不静默返回 null） */
export function readGLB(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not glb: ' + file)
  let off = 12
  let json = null
  let bin = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const d = buf.subarray(off + 8, off + 8 + len)
    if (type === JSON_CHUNK) json = JSON.parse(d.toString('utf8'))
    else if (type === BIN_CHUNK) bin = d
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('glb 缺 chunk: ' + file)
  return { json, bin }
}

/** 取 accessor 全部元素（扁平 typed array，行主序）；支持 bufferView.byteStride */
export function accessor(json, bin, index) {
  const a = json.accessors[index]
  const bv = json.bufferViews[a.bufferView]
  const nc = NC[a.type]
  const sz = CS[a.componentType]
  const stride = bv.byteStride || sz * nc
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const rd = READERS[a.componentType]
  const out = new TYPED[a.componentType](a.count * nc)
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < nc; c++) out[i * nc + c] = rd(bin, base + i * stride + c * sz)
  return out
}
