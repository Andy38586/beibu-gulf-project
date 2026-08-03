<script setup lang="ts">
/**
 * AffectedFacilityListPanel - 受影响设施清单面板（洪水分析专用）
 *
 * 功能：
 * 1. 显示受影响设施清单，按损失金额排名
 * 2. 分页显示，每页4个设施
 * 3. 收藏功能对接usePlans，与选址分析共用保存小区接口
 *
 * 布局：4×4 Cell
 * 位置：左下（bottom-left）
 */

import { computed } from 'vue'

import { useMapControls } from '@/core/map/composables/useMapControls'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import { usePortImpactStore } from '@/stores/portImpactStore'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

const portImpactStore = usePortImpactStore()
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
 * 格式化损失金额
 */
function formatLoss(loss: number | undefined) {
  // 非法输入防御
  const v = Number(loss)
  if (!isFinite(v)) return '—'
  // 基础单位：万元；>= 10000万 换算为亿
  if (v >= 10000) {
    return (v / 10000).toFixed(1) + '亿'
  }
  return v.toFixed(0) + '万'
}

/**
 * 按损失金额排序的设施列表（降序）
 */
const sortedFacilities = computed<ScoredXiaoqu[]>(() => {
  const facilities = portImpactStore.affectedFacilities || []
  // AffectedFacility 与 ScoredXiaoqu 字段不兼容（缺少 score/breakdown），
  // 通过映射转换为合法的 ScoredXiaoqu，避免裸 as unknown as 断言。
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

/** z054: 从 PaginatedListPanel 上提的地图交互（shared 不再依赖 core） */
function handleItemClick(item: ScoredXiaoqu): void {
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
    @click-item="handleItemClick"
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
