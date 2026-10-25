#!/usr/bin/env node
/**
 * reanchor-hubs.mjs — 按**施工影像**实测，校准交付包里三枢纽的落位（平移 + 朝向）。
 *
 * ## 为什么是改 child.transform
 * 交付包 pinglu/tiles/tileset.json 的 17 个 child **各自带 transform**（root 只是外包络），
 * 所以按枢纽整体校准 = 改该枢纽 depth-1 child 的 transform（在 ENU 米系），子孙自动跟随。
 *
 * ## 两种模式
 * ① 纯平移（旧）：--dE/--dN/--dH，直接叠加到 child transform 平移量。
 * ② 朝向 + 平移（新）：--angle <度> + --target-lon/--target-lat/--target-h。
 *    与 Cesium 的 ENU 校正等价：在 P0 处建 eastNorthUp，先绕上轴转 angle，再把 P0 移到
 *    target，最后合回 child transform（P0 = root·child·(180,162.5,0)）。
 *
 * ## 判据从哪来（不是我拍的）
 * 2026-10-09 马道：施工影像中央导堤/建成船闸长墙实测朝向正南（az=180），模型未旋转
 * +X 为 az=197.8 ⇒ angle=17；船闸长墙（x=826/902）与高程（墙顶对齐边坡 51.5m）定
 * target=108.940167,22.447154、h=20。
 *
 * ## 用法
 *   node tools/3dtiles-build/reanchor-hubs.mjs --hub madao --angle 17 \
 *     --target-lon 108.940167 --target-lat 22.447154 --target-h 20
 *   加 --apply 才落盘，否则只打印。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { arg } from '../lib/cli-args.mjs'
import { ecefToGeo as ecefToLlh, geoToEcef as geocentric } from '../lib/geo.mjs'
import { identity, inv, mul, mulPoint, toCol, toMath } from '../lib/mat4.mjs'

const TILESET = 'backend/static/pinglu/tiles/tileset.json'
const LEDGER = '.local/3d-review/reanchor-hubs-log.json'
export const HUBS = ['madao', 'qishi', 'qingnian']
/** P0 在 child 坐标系的固定局部点（与浏览器 init_benchmark 一致） */
export const P0_LOCAL = [180, 162.5, 0]

// 4×4 矩阵（行主序 number[][]）的实现已收口到 tools/lib/mat4.mjs（2026-10-25 F56）。
// 这里**原样再导出**：既有消费点（`__tests__/reanchor.test.mjs`、诊断脚本）继续从本文件
// import，不必知道实现搬了家；本文件内部也直接用这批符号，不再自带第二份。
export { identity, inv, mul, mulPoint, toCol, toMath }
export function enuFrame(center) {
  const [lon, lat] = ecefToLlh(center)
  const lo = (lon * Math.PI) / 180
  const la = (lat * Math.PI) / 180
  const so = Math.sin(lo)
  const co = Math.cos(lo)
  const sl = Math.sin(la)
  const cl = Math.cos(la)
  const M = identity()
  M[0][0] = -so
  M[1][0] = co
  M[2][0] = 0
  M[0][1] = -sl * co
  M[1][1] = -sl * so
  M[2][1] = cl
  M[0][2] = cl * co
  M[1][2] = cl * so
  M[2][2] = sl
  M[0][3] = center[0]
  M[1][3] = center[1]
  M[2][3] = center[2]
  return M
}

/**
 * 计算校准后的 child 数学矩阵。
 * @param {number[][]} ROOT root 数学矩阵
 * @param {number[][]} OLD  当前 child 数学矩阵
 * @param {{angle?:number,targetLon?:number,targetLat?:number,targetH?:number,
 *          dE?:number,dN?:number,dH?:number}} spec
 */
export function computeNew(ROOT, OLD, spec) {
  const {
    angle = null,
    targetLon = null,
    targetLat = null,
    targetH = 0,
    dE = 0,
    dN = 0,
    dH = 0,
  } = spec
  if (angle !== null) {
    // P0 = ROOT·OLD·P0_LOCAL
    const P0ecef = mulPoint(mul(ROOT, OLD), [...P0_LOCAL, 1]).slice(0, 3)
    const enu = enuFrame(P0ecef)
    const rad = (Number(angle) * Math.PI) / 180
    const Rz = identity()
    Rz[0][0] = Math.cos(rad)
    Rz[0][1] = -Math.sin(rad)
    Rz[1][0] = Math.sin(rad)
    Rz[1][1] = Math.cos(rad)
    let M
    if (targetLon !== null && targetLat !== null) {
      // localM = Rz + 平移到 target（先转再平移）
      const tgt = geocentric(Number(targetLon), Number(targetLat), targetH)
      const tgtLocal = mulPoint(inv(enu), [...tgt, 1]).slice(0, 3)
      const localM = identity()
      localM[0][0] = Rz[0][0]
      localM[0][1] = Rz[0][1]
      localM[1][0] = Rz[1][0]
      localM[1][1] = Rz[1][1]
      localM[0][3] = tgtLocal[0]
      localM[1][3] = tgtLocal[1]
      localM[2][3] = tgtLocal[2]
      M = mul(mul(enu, localM), inv(enu))
    } else {
      M = mul(mul(enu, Rz), inv(enu))
    }
    return mul(mul(inv(ROOT), mul(M, ROOT)), OLD)
  }
  // 纯平移（child 坐标是 root 系）
  const NEW = OLD.map((r) => r.slice())
  NEW[0][3] += dE
  NEW[1][3] += dN
  NEW[2][3] += dH
  return NEW
}

function main() {
  const hub = arg('hub', null)
  const apply = process.argv.includes('--apply')
  const angle = arg('angle', null)
  const targetLon = arg('target-lon', null)
  const targetLat = arg('target-lat', null)
  const targetH = Number(arg('target-h', 0))
  const dE = Number(arg('dE', 0))
  const dN = Number(arg('dN', 0))
  const dH = Number(arg('dH', 0))

  if (!hub || !HUBS.includes(hub)) {
    console.error(
      '用法: node tools/3dtiles-build/reanchor-hubs.mjs --hub <madao|qishi|qingnian> ' +
        '[--angle 度 --target-lon .. --target-lat .. --target-h 米] 或 [--dE .. --dN .. --dH ..] [--apply]'
    )
    process.exit(2)
  }

  const ts = JSON.parse(fs.readFileSync(TILESET, 'utf8'))
  const child = (ts.root.children || []).find((c) =>
    ((c.content || {}).uri || '').startsWith(hub + '-')
  )
  if (!child) {
    console.error('找不到 ' + hub + ' 的 depth-1 child')
    process.exit(3)
  }

  const before = child.transform ? child.transform.slice(12, 15) : [0, 0, 0]
  if (!child.transform) {
    child.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  const ROOT = toMath(ts.root.transform)
  const OLD = toMath(child.transform)
  const NEW = computeNew(ROOT, OLD, { angle, targetLon, targetLat, targetH, dE, dN, dH })

  child.transform = toCol(NEW)
  const after = child.transform.slice(12, 15)
  console.log('枢纽 ' + hub + '：uri=' + child.content.uri)
  console.log('  平移 ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after))
  const P0check = ecefToLlh(mulPoint(mul(ROOT, NEW), [...P0_LOCAL, 1]).slice(0, 3))
  console.log(
    '  P0 落点 lon=' +
      P0check[0].toFixed(6) +
      ' lat=' +
      P0check[1].toFixed(6) +
      ' h=' +
      P0check[2].toFixed(2)
  )
  if (!apply) {
    console.log('  （未给 --apply，未落盘）')
    process.exit(0)
  }

  fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
  const log = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []
  log.push({
    at: new Date().toISOString(),
    hub,
    angle: angle === null ? null : Number(angle),
    target: targetLon === null ? null : [Number(targetLon), Number(targetLat), targetH],
    dE,
    dN,
    dH,
    before,
    after,
  })
  fs.writeFileSync(LEDGER, JSON.stringify(log, null, 2))
  // 保持缩进（探测第二行前导空格）
  const raw = fs.readFileSync(TILESET, 'utf8')
  const l2 = raw.split('\n')[1] ?? ''
  const ind = l2.length - l2.replace(/^ +/, '').length || 2
  fs.writeFileSync(TILESET, JSON.stringify(ts, null, ind) + '\n')
  console.log('  写出缩进=' + ind)
  console.log('  已写入 ' + TILESET + '（记录 ' + LEDGER + '）')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
