/**
 * 桑基图点击→回调绑定（Cesium ③ A3 桑基联动的取数边）。
 *
 * 独立成模块的理由：echarts 实例在 jsdom 无 canvas 不可真挂，把「事件形态→载荷」的
 * 纯逻辑抽出来才能单测（node/edge 两形态、无关 dataType 丢弃、解绑幂等）。
 * 组件内只做 instance.on('click', handler) 一行接线，监听注销与注册同作用域（禁忌 4）。
 */

export interface SankeyClickPayload {
  /** node = 节点（西江上行货/平陆运河/三港），edge = 流向边（带 source/target） */
  kind: 'node' | 'edge'
  /** 节点名（kind=node）；edge 时为空串 */
  name: string
  /** 边两端节点名（kind=edge 时有效） */
  source?: string
  target?: string
  /** 流量值（万吨/年；echarts 原样透传） */
  value?: number
}

/** echarts 点击回调的原始参数形态（只声明本模块消费的字段） */
interface SankeyClickRaw {
  dataType?: string
  name?: string
  value?: unknown
  data?: { source?: string; target?: string }
}

/** 可绑定的最小实例形状（真 echarts 实例满足之；rest 形态兼容其 on(type, ...args) 签名） */
export interface SankeyClickTarget {
  on: (type: string, handler: (...args: unknown[]) => void) => void
  off: (type: string, handler: (...args: unknown[]) => void) => void
}

/**
 * 绑定 click → emit，返回解绑器。非 node/edge 的点击（如图例/空白）静默丢弃；
 * edge 载荷带 source/target（桑基联动按「目标港」定位弧线），node 只带 name。
 */
export function bindSankeyClick(
  instance: SankeyClickTarget,
  emit: (payload: SankeyClickPayload) => void
): () => void {
  const handler = (...args: unknown[]): void => {
    const params = (args[0] ?? {}) as SankeyClickRaw
    if (params.dataType !== 'node' && params.dataType !== 'edge') return
    if (params.dataType === 'edge') {
      emit({
        kind: 'edge',
        name: '',
        source: params.data?.source,
        target: params.data?.target,
        value: typeof params.value === 'number' ? params.value : undefined,
      })
      return
    }
    emit({
      kind: 'node',
      name: String(params.name ?? ''),
      value: typeof params.value === 'number' ? params.value : undefined,
    })
  }
  instance.on('click', handler)
  return () => instance.off('click', handler)
}
