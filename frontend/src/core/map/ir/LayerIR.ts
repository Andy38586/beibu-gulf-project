/**
 * LayerIR — 跨路由拖出渲染的引擎无关中间表示（v4-S8，总纲 §六）。
 *
 * ## 口径（总纲 §6.1）
 *
 * 用户主动拖出才渲染；不拖不渲染。跨路由 = 纯渲染、不重算——IR 的 data 是任务
 * **已完成结果的快照**，上图不再发任何请求；引擎切换后的重现由 BLM 的
 * registry + reapplyAll 既有机制承担（本层零额外机制）。
 *
 * ## 去重
 *
 * 同 `origin.taskId + kind` 视为同一份拖出结果：再次拖出 = 撤下（toggle），
 * 永不产生第二份。键见 `layerIRKey`。
 *
 * ## L3 边界
 *
 * 本文件在 core，**不得 import business**：任务结果按结构判定（features 数组 /
 * coordinates 数组），不引用 flood/route 的业务类型。域语义（label/颜色）作为
 * 【作者设定】写死在本文件的映射表里——它是"拖出渲染"的展示口径，不是业务口径。
 */
import type { Feature, FeatureCollection } from 'geojson'

import type { LayerOptions, RoutePathResult } from '@/types'
import type { TaskDomain, TaskSlot } from '@/types/task'

import type { BusinessLayerManagerLike } from '../composables/useBusinessLayers'
import { useOwnedLayers } from '../composables/useOwnedLayers'

type LayerIRKind = 'polygon' | 'polyline' | 'point' | 'raster'

interface LayerIROrigin {
  taskId: string
  route: string
}

export interface LayerIR {
  /** 由 `layerIRKey` 派生（同 origin.taskId + kind 唯一） */
  id: string
  origin: LayerIROrigin
  kind: LayerIRKind
  /** EPSG:4326（坐标系纪律：业务唯一流通口径） */
  data: FeatureCollection
  /** 引擎无关样式：直接复用双引擎 geojson 通道的 LayerOptions（OL/Cesium 同款） */
  style: LayerOptions
  meta: { domain: TaskDomain; label: string; createdAt: number }
}

/** 拖出图层的 BLM 键（owned-layers 体系内的 first-class 业务图层） */
export function layerIRKey(ir: Pick<LayerIR, 'origin' | 'kind'>): string {
  // kind 必须进键：同任务可能同时拖出多边形与折线两类结果，去重键漏 kind 会互相顶掉
  return `task-ir-${ir.origin.taskId}-${ir.kind}`
}

/** 各域拖出图层的展示色与标签（【作者设定】：拖出渲染的展示口径） */
const DOMAIN_IR_PRESENTATION: Partial<Record<TaskDomain, { color: string; label: string }>> = {
  'flood-areas': { color: '#3b82f6', label: '浸没结果' },
  'route-path': { color: '#f59e0b', label: '航线结果' },
}

/** 结构化判定：features 是否为可渲染的 GeoJSON Feature 数组（不引业务类型，L3） */
function isFeatureArray(v: unknown): v is Feature[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((f) => typeof f === 'object' && f !== null && 'geometry' in f)
  )
}

/** 结构化判定：路径坐标（≥2 点的 [lng,lat][]，L3 不引业务类型时的同构口径） */
function isCoordPairArray(v: unknown): v is Array<[number, number]> {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every(
      (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
  )
}

/**
 * 任务结果 → LayerIR。仅可渲染域返回 IR；无几何/结果畸形返回 null——
 * **不支持就不出手柄**（UI 层据此隐藏拖出入口），绝不造空几何充数。
 */
export function taskResultToIR(
  slot: Pick<TaskSlot, 'taskId' | 'route' | 'domain' | 'result'>
): LayerIR | null {
  const presentation = DOMAIN_IR_PRESENTATION[slot.domain]
  if (!presentation) return null
  const createdAt = Date.now()

  if (slot.domain === 'flood-areas') {
    // 浸没载荷结构（business/flood-analysis useFloodRequest FloodAnalysisPayload 的几何面）：
    // result.features = GeoJSON FeatureCollection（淹没范围多边形）
    const payload = slot.result as { features?: unknown } | null
    const features = payload?.features
    if (Array.isArray(features) && isFeatureArray(features)) {
      const data: FeatureCollection = { type: 'FeatureCollection', features }
      return {
        id: layerIRKey({ origin: { taskId: slot.taskId, route: slot.route }, kind: 'polygon' }),
        origin: { taskId: slot.taskId, route: slot.route },
        kind: 'polygon',
        data,
        style: { strokeColor: presentation.color, strokeWidth: 2 },
        meta: { domain: slot.domain, label: presentation.label, createdAt },
      }
    }
    return null
  }

  if (slot.domain === 'route-path') {
    // 航线载荷结构（RoutePathResult@types/route 的几何面）：coordinates = [lng,lat][]
    const result = slot.result as RoutePathResult | null
    const coords = result?.coordinates
    if (!isCoordPairArray(coords)) return null
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        },
      ],
    }
    return {
      id: layerIRKey({ origin: { taskId: slot.taskId, route: slot.route }, kind: 'polyline' }),
      origin: { taskId: slot.taskId, route: slot.route },
      kind: 'polyline',
      data,
      style: { strokeColor: presentation.color, strokeWidth: 4 },
      meta: { domain: slot.domain, label: presentation.label, createdAt },
    }
  }

  return null
}

/**
 * 拖出图层的渲染/撤下（BLM 通道）：注册进 useOwnedLayers（结构约束，图层注册无豁免），
 * 双引擎缺省 → 引擎切换由 BLM reapplyAll 自动重现（跨路由纯渲染的实现载体）。
 */
/**
 * @param manager 显式传入的 BLM——`App.vue`（BLM 的 provide 者）必须用它：
 *                自 provide 对自身不可注入，不传会静默退化为 no-op 桩（见 useBusinessLayers 实测注）。
 */
export function useLayerIRLayer(manager?: BusinessLayerManagerLike) {
  const irOwned = useOwnedLayers('task-ir', manager)

  function hasIR(ir: Pick<LayerIR, 'origin' | 'kind'>): boolean {
    // 判重走 owner 册（useOwnedLayers 的设计口径：回答「我登记过没有」），
    // 不问 manager.has——别的 owner 用了同名 key 不该干扰本册判断
    return irOwned.owned.has(layerIRKey(ir))
  }

  function renderIR(ir: LayerIR): void {
    const key = layerIRKey(ir)
    irOwned.applyOrUpdate(key, {
      label: ir.meta.label,
      layerType: 'geojson',
      data: ir.data,
      options: { ...ir.style, featureType: key } as LayerOptions,
      visible: true,
    })
  }

  function removeIR(ir: Pick<LayerIR, 'origin' | 'kind'>): void {
    irOwned.unregister(layerIRKey(ir))
  }

  /**
   * 拖出语义（toggle）：未上图 → 渲染；已上图 → 撤下。
   * 第二次拖出永不产生重复（总纲 §6.1 去重口径），同时给出撤下入口。
   */
  function toggleIR(ir: LayerIR): 'added' | 'removed' {
    if (hasIR(ir)) {
      removeIR(ir)
      return 'removed'
    }
    renderIR(ir)
    return 'added'
  }

  return { hasIR, renderIR, removeIR, toggleIR, owned: irOwned.owned }
}
