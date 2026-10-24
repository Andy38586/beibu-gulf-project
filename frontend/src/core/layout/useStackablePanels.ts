import { computed, ref } from 'vue'

import { isStackSlotZone } from '@/shared'

/** 面板规格（仅本文件签名用；页面传字面量数组，不需要 import 此类型） */
interface StackablePanelSpec {
  id: string
  label: string
}

/**
 * 可拖拽可视化面板的堆叠状态（页面级唯一入口）。
 *
 * 此前每个页面各写一份 `stackedPanels / stackItems / onPanelDrop / restorePanel`
 * （预测页首份，其余页面要接拖拽就得再抄一遍）。本 composable 把「拖到 StackSlot
 * 即叠入、点还原即放回」的判据收成一份，页面只声明自己的面板清单。
 *
 * 落点分流仍由 `isStackSlotZone` 判定：主控制面板拖到堆叠槽不叠入（由页面忽略，
 * 面板自动回滚），与 `usePanelDrag` 的 dock 投递区共用同一条几何判定。
 */
export function useStackablePanels(panels: readonly StackablePanelSpec[]) {
  const stacked = ref<string[]>([])

  const stackItems = computed(() =>
    panels.filter((p) => stacked.value.includes(p.id)).map((p) => ({ id: p.id, label: p.label }))
  )

  function isStacked(id: string): boolean {
    return stacked.value.includes(id)
  }

  /** 面板被拖到堆叠槽：叠入（重复投放幂等，不产生第二份） */
  function onDrop(panelId: string, zone: HTMLElement): void {
    if (!isStackSlotZone(zone)) return
    if (!stacked.value.includes(panelId)) stacked.value.push(panelId)
  }

  /** 从堆叠槽还原回页面原锚位 */
  function restore(id: string): void {
    stacked.value = stacked.value.filter((p) => p !== id)
  }

  return { stacked, stackItems, isStacked, onDrop, restore }
}
