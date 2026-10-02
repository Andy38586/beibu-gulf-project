/**
 * 分流页 3D 可视化常量与几何构建（Cesium ③）。
 *
 * ## 端点权威源
 * 港口坐标运行时取自 frontend/public/data/ports.json（anchor-check 守卫声明的唯一
 * 权威源，与库内 ports 表同源），本文件只声明「契约端口 → ports.json 条目名」的映射，
 * **不抄坐标**。例外（作者设定）：ports.json 无北海货运港区条目，北海港端点暂以
 * 「北海国际客运港」替代——失效条件：ports.json/库补货运港区条目时只改本表映射。
 *
 * ## 弧线几何（作者设定）
 * 运河线位末点（示意线止于茅尾海）→ 三港的二次贝塞尔弧，控制点向正南偏
 * ARC_BULGE_RATIO × 弦长（本区岸线格局下三弧均离岸鼓出）。这是「分流关系示意」
 * 的表达几何，不是航运轨迹——界面文案与论文按示意口径表述。
 *
 * ## 弧宽编码
 * 宽度只做同一年三港间的相对编码（arcWidthFor：值/三弧最大值），像素宽
 * ∈ [ARC_WIDTH_MIN, ARC_WIDTH_MAX]；绝对万吨经 tooltip/桑基图表达。
 */
import { PORT_PORTS } from '@/shared'
import type { Port } from '@/types'

/** 契约端口 key → ports.json 条目名（见头注释；新增港口先补 ports.json 再补本表） */
export const PORT_JSON_NAMES: Record<string, string> = {
  qinzhou: '钦州港口岸',
  beihai: '北海国际客运港',
  fangchenggang: '防城港',
}

/** 弧线控制点向南偏移量 = 弦长 × 本比例（作者设定：三弧均离岸鼓出） */
export const ARC_BULGE_RATIO = 0.18

/** 弧线离散段数（贝塞尔采样点数 - 1；64 段在 3D 缩放下平滑且顶点量级可忽略） */
export const ARC_SEGMENTS = 64

/** 弧线像素宽范围：width = min + t×(max-min)，t = 该港值/三弧最大值 */
export const ARC_WIDTH_MIN = 2
export const ARC_WIDTH_MAX = 14

/** 弧线（常规/高亮）与运河线样式（模块 constants，组件不硬编码色值——route 域同纪律） */
export const ARC_COLOR = '#2f7bff'
export const ARC_COLOR_HIGHLIGHT = '#ffb020'
export const CANAL_LINE_COLOR = '#12b886'
export const CANAL_LINE_HIGHLIGHT = '#ffd43b'
export const CANAL_LINE_WIDTH = 3

export interface LngLat {
  lng: number
  lat: number
}

/**
 * 二次贝塞尔弧：起点→终点，控制点 = 弦中点向南偏 ARC_BULGE_RATIO×弦长。
 * 纯函数：t=0/1 必为原端点，采样 segments+1 点，同输入同输出（确定性）。
 */
export function buildPortArc(
  start: LngLat,
  end: LngLat,
  segments: number = ARC_SEGMENTS
): Array<[number, number]> {
  const midLng = (start.lng + end.lng) / 2
  const midLat = (start.lat + end.lat) / 2
  const chord = Math.hypot(end.lng - start.lng, end.lat - start.lat)
  const ctrlLng = midLng
  const ctrlLat = midLat - chord * ARC_BULGE_RATIO
  const points: Array<[number, number]> = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    points.push([
      u * u * start.lng + 2 * u * t * ctrlLng + t * t * end.lng,
      u * u * start.lat + 2 * u * t * ctrlLat + t * t * end.lat,
    ])
  }
  return points
}

/** 弧宽：t = 值/基准值 clamp 到 [0,1]；基准值非正（无数据/全零）退最小宽 */
export function arcWidthFor(value: number, maxOfPortLegs: number): number {
  const t = maxOfPortLegs > 0 ? Math.min(1, Math.max(0, value / maxOfPortLegs)) : 0
  return Math.round(ARC_WIDTH_MIN + t * (ARC_WIDTH_MAX - ARC_WIDTH_MIN))
}

/**
 * 由 ports.json 静态数据解析三港端点（按 PORT_JSON_NAMES 名称匹配）。
 * 缺失端口直接跳过不抛——ports.json 缺条目时弧线缺一条而非整页崩，调用方负责 DEV 告警。
 */
export function resolvePortEndpoints(ports: Port[]): Record<string, LngLat> {
  const byName = new Map(ports.map((p) => [p.name, p]))
  const out: Record<string, LngLat> = {}
  for (const { key } of PORT_PORTS) {
    const hit = byName.get(PORT_JSON_NAMES[key])
    if (hit) out[key] = { lng: hit.lng, lat: hit.lat }
  }
  return out
}
