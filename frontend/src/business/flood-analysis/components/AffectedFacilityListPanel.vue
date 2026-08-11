<script setup lang="ts">
/**
 * 受影响设施清单面板：按损失金额降序分页展示（每页 4 个），
 * 收藏功能与选址分析共用保存方案接口。布局 4×4，左下角。
 */

import { computed } from 'vue'

import { useMapControls } from '@/core'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import { formatLoss } from '@/shared/utils/facilityLabels'
import { useFloodStore } from '@/stores'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

const floodStore = useFloodStore()
const { flyTo, startBreathing } = useMapControls()

/**
 * 获取设施类型对应的中文标签
 */
function getFacilityTypeLabel(type: string | undefined) {
  if (!type) return ''
  const typeMap: Record<string, string> = {
    泊位: '泊位',
    码头: '码头',
    仓储区: '仓储',
    油库: '油库',
  }
  return typeMap[type] || type
}

/**
 * 按损失金额排序的设施列表（降序）
 */
const sortedFacilities = computed<ScoredXiaoqu[]>(() => {
  const facilities = floodStore.affectedFacilities || []
  // AffectedFacility 缺 score/breakdown 字段，映射为合法 ScoredXiaoqu 避免裸断言
  return [...facilities]
    .sort((a, b) => b.loss - a.loss)
    .map(
      (f): ScoredXiaoqu => ({
        id: f.id,
        name: f.name,
        lng: f.lng,
        lat: f.lat,
        score: 0,
        breakdown: {},
        type: f.type,
        loss: f.loss,
      })
    )
})

/** 跳转逻辑由 PaginatedListPanel 提供（flyTo 回调 prop），此处注入实现 */
function flyToFacility(item: ScoredXiaoqu): void {
  startBreathing(item.lng, item.lat)
  flyTo({ lng: item.lng, lat: item.lat }, { height: 1000 })
}
</script>

<template>
  <PaginatedListPanel
    :items="sortedFacilities"
    :page-size="4"
    title="受影响设施清单"
    empty-text="暂无受影响设施"
    empty-hint="开始评估后显示设施清单"
    plan-type="flood"
    :fly-to="flyToFacility"
  >
    <template #item="{ item: facility }">
      <div class="facility-info">
        <span class="facility-name">{{ facility.name }}</span>
        <span class="facility-type">{{ getFacilityTypeLabel(facility.type) }}</span>
      </div>
      <span class="facility-loss">{{ formatLoss(facility.loss) }}元</span>
    </template>
  </PaginatedListPanel>
</template>

<style scoped>
.facility-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  justify-content: center;
}

.facility-name {
  color: var(--GCS-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  flex: 1;
}

.facility-type {
  color: var(--GCS-text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.facility-loss {
  color: var(--GCS-color-danger);
  font-weight: 600;
  flex-shrink: 0;
  min-width: 70px;
  text-align: right;
}
</style>
