#!/usr/bin/env node
/**
 * 集装箱参数化建模（5 款）。
 *
 * ## 为什么重做
 *
 * 交付包里的「集装箱」是**无顶底盖的竖棱柱**：8 个顶点、30 个三角面、两个共位环
 * （相差 ~0.06 m，退化成一条侧带），一个分量代表**一摞箱区**而不是一个箱子。
 * 用户在 3D 里看到的就是一片斜插的色块。
 *
 * ## 款式与尺寸（ISO 668 / 实际箱型）
 *
 * | key | 名称 | 长 m | 宽 m | 高 m |
 * | --- | --- | --- | --- | --- |
 * | c20   | 20ft 标准箱 | 6.058 | 2.438 | 2.591 |
 * | c40   | 40ft 标准箱 | 12.192 | 2.438 | 2.591 |
 * | c40hc | 40ft 高柜   | 12.192 | 2.438 | 2.896 |
 * | c40rf | 40ft 冷藏箱 | 12.192 | 2.438 | 2.591 |
 * | c20ot | 20ft 开顶箱 | 6.058 | 2.438 | 2.591 |
 *
 * 高度 2.591 m 与实测吻合：交付包里箱区高度是 2.59 / 5.18 / 7.77 / 10.36 / 12.96 m，
 * 正好是 1~5 层（见 .local/3d-diag/extract2.cjs 的实测输出）。
 *
 * ## 几何（每箱 ~28 三角面）
 *
 * 长边按 4 段细分并交替外凸 0.03 m 表现瓦楞，段间用顶点色明暗交替加强；
 * 两端面 + 顶底 + 门端色带。刻意压低面数：作业区有 7745 个箱区、按每区 3~9 箱
 * 放置后总量约 2 万~7 万箱，每箱多 10 个面就是几十万面。
 *
 * 用法：node tools/3dtiles-build/container-models.mjs [输出目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGLB } from './glb.mjs'

/** 箱型表（长 × 宽 × 高，米）——ISO 668 标准尺寸 */
export const CONTAINER_TYPES = [
  {
    key: 'c20',
    name: '20ft 标准箱',
    len: 6.058,
    wid: 2.438,
    hei: 2.591,
    color: [0.14, 0.36, 0.64],
  },
  {
    key: 'c40',
    name: '40ft 标准箱',
    len: 12.192,
    wid: 2.438,
    hei: 2.591,
    color: [0.68, 0.21, 0.17],
  },
  {
    key: 'c40hc',
    name: '40ft 高柜',
    len: 12.192,
    wid: 2.438,
    hei: 2.896,
    color: [0.16, 0.47, 0.31],
  },
  {
    key: 'c40rf',
    name: '40ft 冷藏箱',
    len: 12.192,
    wid: 2.438,
    hei: 2.591,
    color: [0.87, 0.88, 0.89],
  },
  {
    key: 'c20ot',
    name: '20ft 开顶箱',
    len: 6.058,
    wid: 2.438,
    hei: 2.591,
    color: [0.82, 0.46, 0.13],
  },
]

const CORRUGATION_SEGMENTS = 4
const CORRUGATION_DEPTH = 0.03
const END_INSET = 0.06

/** 造一个箱型的三角面数据（glTF Y-up：X=长，Y=高，Z=宽） */
/** 单款集装箱几何（导出供绕序/结构判据直接测，不必先落盘 GLB） */
export function buildContainer(t) {
  const hx = t.len / 2,
    hy = t.hei / 2,
    hz = t.wid / 2
  const positions = [],
    normals = [],
    colors = [],
    indices = []
  const push = (p, n, c) => {
    const base = positions.length / 3
    for (const v of p) {
      positions.push(v[0], v[1], v[2])
      normals.push(n[0], n[1], n[2])
      colors.push(c[0], c[1], c[2])
    }
    // 绕序：p 必须按"从 +n 方向看逆时针"给。给反了不报错，只在该面被背面剔除时**看不见**——
    // 单面材质下箱体会缺块（2026-10-04 facing-audit 实测本文件曾 16/28 正向：±Z 侧面 8 面对、
    // 端面/顶/底/门带 12 面反）。判据见 __tests__/build.test.mjs「集装箱绕序」。
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const shade = (k) => [t.color[0] * k, t.color[1] * k, t.color[2] * k]
  const DARK = 0.72,
    LIGHT = 1.06

  // 两个长边：按 X 分 4 段，交替外凸，段色明暗交替
  for (const sgn of [1, -1]) {
    const n = [0, 0, sgn]
    for (let i = 0; i < CORRUGATION_SEGMENTS; i++) {
      const x0 = -hx + END_INSET + ((t.len - 2 * END_INSET) * i) / CORRUGATION_SEGMENTS
      const x1 = -hx + END_INSET + ((t.len - 2 * END_INSET) * (i + 1)) / CORRUGATION_SEGMENTS
      const z = sgn * (hz + (i % 2 === 0 ? CORRUGATION_DEPTH : 0))
      const c = shade(i % 2 === 0 ? LIGHT : DARK)
      const quad =
        sgn > 0
          ? [
              [x0, -hy, z],
              [x1, -hy, z],
              [x1, hy, z],
              [x0, hy, z],
            ]
          : [
              [x1, -hy, z],
              [x0, -hy, z],
              [x0, hy, z],
              [x1, hy, z],
            ]
      push(quad, n, c)
    }
  }
  // 两个端面
  for (const sgn of [1, -1]) {
    const x = sgn * hx
    const c = shade(DARK)
    const quad =
      sgn > 0
        ? [
            [x, hy, -hz],
            [x, hy, hz],
            [x, -hy, hz],
            [x, -hy, -hz],
          ]
        : [
            [x, hy, hz],
            [x, hy, -hz],
            [x, -hy, -hz],
            [x, -hy, hz],
          ]
    push(quad, [sgn, 0, 0], c)
  }
  // 顶 / 底
  push(
    [
      [-hx, hy, hz],
      [hx, hy, hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
    ],
    [0, 1, 0],
    shade(1.18)
  )
  push(
    [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, -hy, hz],
      [-hx, -hy, hz],
    ],
    [0, -1, 0],
    shade(0.55)
  )
  // 门端色带（+X 端两条竖带，冷藏箱为整面白）
  const doorX = hx + 0.001
  const band = t.key === 'c40rf' ? shade(1.12) : shade(0.5)
  for (const off of [-0.45, 0.45]) {
    const z0 = off * hz - 0.06,
      z1 = off * hz + 0.06
    push(
      [
        [doorX, hy, z0],
        [doorX, hy, z1],
        [doorX, -hy, z1],
        [doorX, -hy, z0],
      ],
      [1, 0, 0],
      band
    )
  }
  return { positions, normals, colors, indices }
}

export function generateAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  for (const t of CONTAINER_TYPES) {
    const geo = buildContainer(t)
    const glb = buildGLB({
      meshes: [{ primitives: [{ ...geo, material: 0 }] }],
      materials: [
        {
          name: t.key,
          pbrMetallicRoughness: {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 0.35,
            roughnessFactor: 0.65,
          },
          doubleSided: false,
        },
      ],
    })
    const file = path.join(outDir, t.key + '.glb')
    fs.writeFileSync(file, glb)
    written.push({
      ...t,
      file,
      bytes: glb.length,
      tris: geo.indices.length / 3,
      verts: geo.positions.length / 3,
    })
  }
  return written
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? 'backend/static/qinzhou-port/rebuilt/models'
  const rows = generateAll(out)
  console.log('款式            长×宽×高 (m)              三角面  顶点   字节')
  for (const r of rows) {
    console.log(
      r.key.padEnd(7) +
        r.name.padEnd(12) +
        (r.len + '×' + r.wid + '×' + r.hei).padEnd(24) +
        String(r.tris).padStart(5) +
        String(r.verts).padStart(7) +
        String(r.bytes).padStart(8)
    )
  }
  console.log('\n共 ' + rows.length + ' 款，写出到 ' + out)
}
