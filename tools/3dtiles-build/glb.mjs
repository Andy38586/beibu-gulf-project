/**
 * 极简 GLB 写出器（无依赖），支持 EXT_mesh_gpu_instancing。
 *
 * 为什么自建而不用 Blender：产出的是**参数化箱体**（集装箱/龙门架），几何完全由参数
 * 决定；自建写出器是纯函数，同一参数必得同一字节，便于门禁钉死，也不引入 400 MB 外部依赖。
 *
 * 为什么必须支持实例化：作业区实测 79622 个集装箱，逐实例展开顶点是 446 万顶点
 * （位置+法线+色 = 178 MB）；改为「5 个模型 + 逐实例 TRANSLATION/ROTATION」后
 * 每实例 28 字节，整层降到 MB 量级。CesiumJS ≥1.97 支持该扩展（本项目 1.144）。
 *
 * 坐标系：glTF 为 Y-up，节点矩阵由调用方负责。
 */
/**
 * tile 局部 ENU(E,N,U) → glTF Y-up (x,y,z)。**全仓库唯一一处**。
 *
 * 为什么必须集中：3D Tiles 的 glTF 内容按 Y-up 解释，Cesium 施加 Y_UP_TO_Z_UP
 * 即 (x,y,z)→(x,−z,y)；于是反推 x=E、y=U、z=−N。把 ENU 直通写进 POSITION 的
 * 后果不是"偏一点"，是**整层按 N 值抬高**（作业区 N≈1~11 km ⇒ 路网悬在 1~11 km
 * 高空），在渲染图里表现为"天上挂着一张路网格子"。
 *
 * 2026-10-03 实测：build-roads / build-canal / build-bridges 三个写出器曾各自直通
 * ENU（只有 rebuild-containers 做对了），于是钦州港路网、运河、城区五桥全部浮空；
 * 而上一窗口的软件光栅器不施加 Y_UP_TO_Z_UP，它自己的渲染图里这些层是"落地"的
 * ——工具与运行时不同口径，才让这个错活到了用户截图上。
 */
export function enuToGltf(e, n, u) {
  return [e, u, -n]
}

/**
 * glTF Y-up (x,y,z) → tile 局部 ENU(E,N,U)。**enuToGltf 的逆，同一权威源**。
 *
 * 为什么需要逆映射：**boundingVolume 是 tile 局部 ENU(Z-up)，content 是 glTF Y-up**，
 * 两者轴序不同。若拿 positions（glTF）的 min/max 直接填 box，整层的"北向"会被塞进竖轴
 * ——实测 roads 的盒中心落到椭球下 5351 m，Cesium 在近机位把整层剔除
 * （tileset.statistics.visited=0），路网在港区**根本不显示**，且零报错。
 */
export function gltfToEnu(x, y, z) {
  return [x, -z, y]
}

/** ENU 法线 → glTF Y-up（与 enuToGltf 同一映射，法线只转方向） */
export function enuNormalToGltf(e, n, u) {
  return [e, u, -n]
}

/** glTF Y-up 竖直方向（ENU 的 +U）——平铺面片（路面/运河带）的法线 */
export const GLTF_UP = enuNormalToGltf(0, 0, 1)

const CS = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function pad4(n) {
  return (4 - (n % 4)) % 4
}

/**
 * @param {object} spec
 * @param {Array<{primitives: Array<{positions:number[], normals?:number[], colors?:number[], indices:number[], material?:number}>}>} spec.meshes
 * @param {Array<object>} [spec.materials]
 * @param {Array<{mesh:number, instancing?:{translation:number[], rotation:number[], scale?:number[]}}>} spec.nodes
 */
export function buildGLB(spec) {
  const meshes = spec.meshes ?? [spec.mesh]
  const chunks = []
  const bufferViews = []
  const accessors = []
  let offset = 0

  const pushBV = (buf, target) => {
    const pad = pad4(offset)
    if (pad) {
      chunks.push(Buffer.alloc(pad))
      offset += pad
    }
    const bv = { buffer: 0, byteOffset: offset, byteLength: buf.length }
    if (target) bv.target = target
    bufferViews.push(bv)
    chunks.push(buf)
    offset += buf.length
    return bufferViews.length - 1
  }
  const addAccessor = (arr, type, componentType, target, extra = {}) => {
    const nc = NC[type]
    const buf = Buffer.alloc(arr.length * CS[componentType])
    for (let i = 0; i < arr.length; i++) {
      if (componentType === 5126) buf.writeFloatLE(arr[i], i * 4)
      else if (componentType === 5125) buf.writeUInt32LE(arr[i], i * 4)
      else if (componentType === 5123) buf.writeUInt16LE(arr[i], i * 2)
      else buf.writeUInt8(arr[i], i)
    }
    accessors.push({
      bufferView: pushBV(buf, target),
      componentType,
      count: arr.length / nc,
      type,
      ...extra,
    })
    return accessors.length - 1
  }
  const minMax = (arr) => {
    const mn = [Infinity, Infinity, Infinity],
      mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = arr[i + k]
        if (v < mn[k]) mn[k] = v
        if (v > mx[k]) mx[k] = v
      }
    }
    return { mn, mx }
  }

  const glMeshes = []
  for (const mesh of meshes) {
    const prims = []
    for (const p of mesh.primitives) {
      const { mn, mx } = minMax(p.positions)
      const attributes = {
        POSITION: addAccessor(p.positions, 'VEC3', 5126, 34962, { min: mn, max: mx }),
      }
      if (p.normals) attributes.NORMAL = addAccessor(p.normals, 'VEC3', 5126, 34962)
      if (p.colors) {
        // 顶点色维度按数据长度自动判别（VEC3=RGB / VEC4=RGBA，B10 边缘 alpha 渐变用 VEC4）；
        // 数量对不上任何一档直接抛——写错维度的 COLOR_0 会让 Cesium 整片丢弃或渲染错色
        const nv = p.positions.length / 3
        const arity = p.colors.length === nv * 4 ? 4 : p.colors.length === nv * 3 ? 3 : 0
        if (!arity)
          throw new Error(
            `colors 数量(${p.colors.length})与顶点数(${nv})×3/×4 均不符（COLOR_0 维度判别失败）`
          )
        attributes.COLOR_0 = addAccessor(p.colors, arity === 4 ? 'VEC4' : 'VEC3', 5126, 34962)
      }
      const use32 = p.positions.length / 3 > 65535
      prims.push({
        attributes,
        indices: addAccessor(p.indices, 'SCALAR', use32 ? 5125 : 5123, 34963),
        material: p.material ?? 0,
        mode: 4,
      })
    }
    glMeshes.push({ primitives: prims })
  }

  const extensionsUsed = []
  const glNodes = (spec.nodes ?? meshes.map((_, i) => ({ mesh: i }))).map((n) => {
    const out = { mesh: n.mesh }
    if (n.instancing) {
      if (!extensionsUsed.includes('EXT_mesh_gpu_instancing'))
        extensionsUsed.push('EXT_mesh_gpu_instancing')
      const attrs = {
        TRANSLATION: addAccessor(n.instancing.translation, 'VEC3', 5126, 34962),
        ROTATION: addAccessor(n.instancing.rotation, 'VEC4', 5126, 34962),
      }
      if (n.instancing.scale) attrs.SCALE = addAccessor(n.instancing.scale, 'VEC3', 5126, 34962)
      out.extensions = { EXT_mesh_gpu_instancing: { attributes: attrs } }
    }
    return out
  })

  const json = {
    asset: { version: '2.0', generator: 'beibu-3dtiles-build' },
    scene: 0,
    scenes: [{ nodes: glNodes.map((_, i) => i) }],
    nodes: glNodes,
    meshes: glMeshes,
    materials: spec.materials ?? [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.8,
        },
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  }
  if (extensionsUsed.length) json.extensionsUsed = extensionsUsed

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length), 0x20)])
  const binBuf = Buffer.concat(chunks)
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length
  const head = Buffer.alloc(12)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(total, 8)
  const jh = Buffer.alloc(8)
  jh.writeUInt32LE(jsonBuf.length, 0)
  jh.writeUInt32LE(0x4e4f534a, 4)
  const bh = Buffer.alloc(8)
  bh.writeUInt32LE(binBuf.length, 0)
  bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, jh, jsonBuf, bh, binBuf])
}

/** 单位盒（12 三角面，逐面法线） */
export function box(sx, sy, sz) {
  const hx = sx / 2,
    hy = sy / 2,
    hz = sz / 2
  const faces = [
    {
      n: [0, 0, 1],
      v: [
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
        [-hx, hy, -hz],
        [hx, hy, -hz],
      ],
    },
    {
      n: [1, 0, 0],
      v: [
        [hx, -hy, hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
        [-hx, hy, -hz],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [-hx, hy, hz],
        [hx, hy, hz],
        [hx, hy, -hz],
        [-hx, hy, -hz],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
      ],
    },
  ]
  const positions = [],
    normals = [],
    indices = []
  for (const f of faces) {
    const base = positions.length / 3
    for (const p of f.v) {
      positions.push(p[0], p[1], p[2])
      normals.push(f.n[0], f.n[1], f.n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions, normals, indices }
}
