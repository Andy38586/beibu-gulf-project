#!/usr/bin/env node
/**
 * tiles3d-check — 3D Tiles 瓦片集完整性守卫（v3 第 10 守卫）。
 *
 * 动因（2026-09-21）：backend/static/pinglu/tiles/tileset.json 曾被
 * tmp-3dtiles/rebuild_transforms.py 用**不含 corridor/bridges 的模板**（tileset-hubs.json）
 * 整体覆盖，把 31 内容节点打回 17 节点：整条运河的路堤/河堤（corridor-00~10）与
 * 三座跨运河桥梁（bridges-*）从 Web 上静默消失，同时坐标约定从「逐顶点烘焙曲率」
 * （块间接缝 0.00 m）退回「逐瓦片各挂锚点」（块间有真误差）。
 * 文件里的 JSON「看着是合法的」，没有任何门禁问过「瓦片是不是全的」——本守卫把该断言
 * 固化为不变量。
 *
 * 守卫的不变量：
 *   1. tileset.json 的**内容节点数** ≥ MIN_CONTENT_NODES，且必须含全部
 *      REQUIRED_CONTENT（三枢纽分区 + 11 走廊 + 3 桥梁）；
 *   2. asset.generator 必须含 GENERATOR_MARKER（逐顶点曲率烘焙），
 *      防止退回 per-tile anchor fix；
 *   3. 每个 content.uri 指向的文件必须**实际存在**（不允许悬空引用）；
 *   4. 根节点必须有 transform（ENU→ECEF），且 root.boundingVolume.box 必须存在；
 *   5. tileset-b3dm.json（1.0 兼容套）与 tileset.json 的 uri 集合一致。
 *
 * 用法：node tools/v3-guard/tiles3d-check.mjs [--json]
 * 返回码：0 = 瓦片集完整；1 = 缺节点/生成器退化/悬空引用/索引不一致。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 瓦片集目录（相对仓库根） */
export const TILES_DIR = 'backend/static/pinglu/tiles'
/** 1.1 索引（GLB 为主） */
export const TILESET = 'tileset.json'
/** 1.0 兼容索引（b3dm） */
export const TILESET_B3DM = 'tileset-b3dm.json'

/** 内容节点数下限（当前实测 31：三枢纽 17 + 走廊 11 + 桥梁 3） */
export const MIN_CONTENT_NODES = 31

/** 必须存在的内容 uri（缺任一即失败——这是被覆盖事故的直接指纹） */
export const REQUIRED_CONTENT = [
  // 三枢纽低模
  'madao-low.glb',
  'qishi-low.glb',
  'qingnian-low.glb',
  // 马道枢纽分区（5）
  'madao-z1-terrain.glb',
  'madao-z2-upstream.glb',
  'madao-z3-lock.glb',
  'madao-z4-pool.glb',
  'madao-z6-downstream.glb',
  // 企石枢纽分区（5）
  'qishi-z1-terrain.glb',
  'qishi-z2-upstream.glb',
  'qishi-z3-lock.glb',
  'qishi-z4-pool.glb',
  'qishi-z6-downstream.glb',
  // 青年枢纽分区（4，无 z4-pool：青年枢纽无省水池）
  'qingnian-z1-terrain.glb',
  'qingnian-z2-upstream.glb',
  'qingnian-z3-lock.glb',
  'qingnian-z6-downstream.glb',
  // 全线走廊（11）——被覆盖事故中全部丢失
  'corridor-00.glb',
  'corridor-01.glb',
  'corridor-02.glb',
  'corridor-03.glb',
  'corridor-04.glb',
  'corridor-05.glb',
  'corridor-06.glb',
  'corridor-07.glb',
  'corridor-08.glb',
  'corridor-09.glb',
  'corridor-10.glb',
  // 全线桥梁（3）——被覆盖事故中全部丢失
  'bridges-mid.glb',
  'bridges-up.glb',
  'bridges-urban.glb',
]

/**
 * generator 必须包含的标记：逐顶点椭球曲率烘焙。
 * 退回 per-tile anchor fix 会让相邻瓦片接缝出现真实误差（各瓦片各挂各的锚点），
 * 这正是 2026-09-21 覆盖事故引入的回归。
 */
export const GENERATOR_MARKER = 'WGS84 baked curvature'

/** 递归收集内容 uri */
export function collectContentUris(node, out = []) {
  const uri = node?.content?.uri ?? node?.content?.url
  if (uri) out.push(String(uri))
  for (const child of node?.children ?? []) collectContentUris(child, out)
  return out
}

/**
 * 瓦片集评估（纯函数，供守卫与单测共用）。
 * @param {object} tileset 解析后的 tileset.json
 * @param {(uri: string) => boolean} exists uri 存在性判定（注入以便单测）
 * @param {object} [opts]
 * @param {number} [opts.minContentNodes]
 * @returns {string[]} 违规描述（空数组 = 全部合法）
 */
export function evaluateTileset(tileset, exists, opts = {}) {
  const problems = []
  const minNodes = opts.minContentNodes ?? MIN_CONTENT_NODES

  const root = tileset?.root
  if (!root) return ['tileset.root 缺失：无法解析瓦片集']

  // 1) 内容节点数与必需内容
  const uris = collectContentUris(root)
  if (uris.length < minNodes) {
    problems.push(
      `内容节点 ${uris.length} 个 < 下限 ${minNodes} 个（疑似被不含 corridor/bridges 的模板覆盖）`
    )
  }
  const present = new Set(uris)
  const missing = REQUIRED_CONTENT.filter((r) => !present.has(r))
  if (missing.length) {
    problems.push(`必需内容缺失 ${missing.length} 个：${missing.join('、')}`)
  }

  // 2) generator 标记（防止坐标约定退化）
  const generator = String(tileset?.asset?.generator ?? '')
  if (!generator.includes(GENERATOR_MARKER)) {
    problems.push(
      `asset.generator 不含「${GENERATOR_MARKER}」（当前：${generator || '空'}）；` +
        `疑似退回逐瓦片锚点，块间接缝会有真实误差`
    )
  }

  // 3) 悬空引用
  const dangling = uris.filter((u) => !exists(u))
  if (dangling.length) {
    problems.push(`悬空引用 ${dangling.length} 个：${dangling.join('、')}`)
  }

  // 4) 根变换与根包围盒
  if (!Array.isArray(root.transform) || root.transform.length !== 16) {
    problems.push('root.transform 缺失或不是 16 元素（ENU→ECEF 变换必须显式给出）')
  }
  if (!Array.isArray(root.boundingVolume?.box) || root.boundingVolume.box.length !== 12) {
    problems.push('root.boundingVolume.box 缺失或不是 12 元素')
  }

  return problems
}

/** 索引套一致性（1.1 GLB 与 1.0 b3dm 的 uri 集合换算后必须一致） */
export function evaluateTilesetPair(glbTs, b3dmTs) {
  const problems = []
  if (!b3dmTs?.root) return [`${TILESET_B3DM} 缺失 root：1.0 兼容套须与 1.1 同步`]
  const toStem = (u) => String(u).replace(/\.(glb|b3dm)$/i, '')
  const a = new Set(collectContentUris(glbTs.root).map(toStem))
  const b = new Set(collectContentUris(b3dmTs.root).map(toStem))
  const onlyA = [...a].filter((x) => !b.has(x))
  const onlyB = [...b].filter((x) => !a.has(x))
  if (onlyA.length) problems.push(`${TILESET} 独有内容（${TILESET_B3DM} 缺）：${onlyA.join('、')}`)
  if (onlyB.length) problems.push(`${TILESET_B3DM} 独有内容（${TILESET} 缺）：${onlyB.join('、')}`)
  return problems
}

/**
 * 对**任意** tileset.json 做通用结构判据（判据域扩展的落地形态）。
 *
 * ## 为什么不是一个覆盖 5 个 tileset 的门禁
 *
 * 用户裁定「判据域从 1 个扩到 5 个」。实施时撞上一条硬约束：AGENTS §5.4 规定
 * **判据的输入必须受版本控制**，而本项目 4/5 的瓦片集都在 .gitignore 里
 * （`backend/static/qinzhou-port/`、`backend/static/bim-hub/`、
 * `backend/static/bridges-city/` —— 理由见 .gitignore:184-191 的体积说明）。
 * 把它们写进门禁 = 让门禁依赖 gitignored 路径，浅克隆下会整批跳过——
 * 那正是 §5.4 要治的失效。
 *
 * 所以本函数做**通用结构判据**，由**产出方**（tools/3dtiles-build 的构建脚本）
 * 在生成后立即调用；git 时的门禁仍只覆盖受版本控制的那一份（pinglu/tiles）。
 *
 * ## 判据
 *
 * 1. 可解析，且有 root；
 * 2. root.transform 存在、3×3 部分正交（列向量单位长、两两正交）；
 * 3. root.boundingVolume 存在；
 * 4. 每个 content.uri 指向的文件**存在且非空**（0 字节是截断写入的典型残留）；
 * 5. 内部节点 geometricError **严格大于**其任一子节点（Cesium 靠它决定下钻）。
 *
 * @returns { problems: string[], checked: string[] }
 */
export function checkTilesetFile(file, baseDir) {
  const problems = []
  const checked = []
  let ts
  try {
    ts = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { problems: [`${file}：缺失或不可解析（${e.message}）`], checked }
  }
  const rel = baseDir ? path.relative(baseDir, file) : file
  if (!ts.root) return { problems: [`${rel}：无 root`], checked }

  const T = ts.root.transform
  if (!Array.isArray(T) || T.length !== 16) {
    problems.push(`${rel}：root.transform 缺失或不是 16 元（ENU→ECEF 必须显式给出）`)
  } else {
    const col = (i) => [T[i * 4], T[i * 4 + 1], T[i * 4 + 2]]
    const len = (v) => Math.hypot(v[0], v[1], v[2])
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const c0 = col(0),
      c1 = col(1),
      c2 = col(2)
    const err = Math.max(
      Math.abs(len(c0) - 1),
      Math.abs(len(c1) - 1),
      Math.abs(len(c2) - 1),
      Math.abs(dot(c0, c1)),
      Math.abs(dot(c1, c2)),
      Math.abs(dot(c0, c2))
    )
    if (err > 1e-6)
      problems.push(`${rel}：root.transform 非正交（最大偏差 ${err.toExponential(2)}）`)
    else checked.push('transform 正交')
  }
  if (!ts.root.boundingVolume) problems.push(`${rel}：root.boundingVolume 缺失`)

  const dir = path.dirname(file)
  let nodes = 0,
    leaves = 0,
    geViolations = 0
  const walk = (n, parentGe) => {
    nodes++
    const kids = n.children ?? []
    if (kids.length === 0) leaves++
    const ge = n.geometricError
    if (parentGe !== null && typeof ge === 'number' && ge >= parentGe) geViolations++
    const uri = n.content?.uri
    if (typeof uri === 'string') {
      const p = uri.startsWith('/') ? path.join(baseDir ?? dir, uri) : path.join(dir, uri)
      if (!existsSync(p) || statSync(p).size === 0)
        problems.push(`${rel}：content.uri 悬空或空文件 → ${uri}`)
    }
    for (const k of kids) walk(k, typeof ge === 'number' ? ge : parentGe)
  }
  walk(ts.root, null)
  if (geViolations)
    problems.push(
      `${rel}：${geViolations} 处 geometricError 未严格递减（Cesium 会在父节点提前终止遍历）`
    )
  checked.push(`${nodes} 节点 / ${leaves} 叶`)
  return { problems, checked }
}

/** 主检查：返回 { problems, checked }（problems 非空 = 守卫失败） */
export function runTiles3DCheck(root) {
  const problems = []
  const checked = []
  const dir = path.join(root, TILES_DIR)

  const readJson = (rel) => JSON.parse(readFileSync(path.join(dir, rel), 'utf8'))
  const exists = (uri) => {
    const p = path.join(dir, uri)
    // 既要存在、也要非空（0 字节文件是截断写入的典型残留）
    return existsSync(p) && statSync(p).size > 0
  }

  let glbTs
  try {
    glbTs = readJson(TILESET)
  } catch (e) {
    return {
      problems: [`${TILES_DIR}/${TILESET}：缺失或不可解析（${e.message}）`],
      checked,
    }
  }

  problems.push(...evaluateTileset(glbTs, exists))
  checked.push(`${TILESET}: ${collectContentUris(glbTs.root).length} 内容节点`)

  let b3dmTs = null
  try {
    b3dmTs = readJson(TILESET_B3DM)
  } catch {
    problems.push(`${TILES_DIR}/${TILESET_B3DM}：缺失或不可解析（1.0 兼容套须在册）`)
  }
  if (b3dmTs) {
    problems.push(...evaluateTilesetPair(glbTs, b3dmTs))
    checked.push(`${TILESET_B3DM}: ${collectContentUris(b3dmTs.root).length} 内容节点`)
  }

  return { problems, checked }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  // --file <路径>：对任意 tileset.json 跑通用结构判据（构建脚本生成后自检用）
  const fi = process.argv.indexOf('--file')
  if (fi > 0) {
    const target = path.resolve(ROOT, process.argv[fi + 1])
    const { problems, checked } = checkTilesetFile(target, ROOT)
    if (problems.length) {
      console.log(`[tiles3d-check --file] ${problems.length} 处违规：`)
      for (const p of problems) console.log('  - ' + p)
      process.exit(1)
    }
    console.log(
      `[tiles3d-check --file] OK：${path.relative(ROOT, target)}（${checked.join('｜')}）`
    )
    process.exit(0)
  }
  const { problems, checked } = runTiles3DCheck(ROOT)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checked, problems }, null, 2))
    process.exit(problems.length ? 1 : 0)
  }
  if (problems.length) {
    console.log(`[tiles3d-check] ${problems.length} 处瓦片集违规：`)
    for (const p of problems) console.log('  - ' + p)
    process.exit(1)
  }
  console.log(
    `[tiles3d-check] OK：${checked.join('｜')}，必需内容 ${REQUIRED_CONTENT.length} 项齐全`
  )
}
