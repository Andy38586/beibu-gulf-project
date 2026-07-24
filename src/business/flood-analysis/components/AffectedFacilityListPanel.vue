<script setup>
/**
 * AffectedFacilityListPanel - 受影响设施清单面板（浸没分析专用）
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
import { usePortImpactStore } from '@/stores/portImpactStore'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'

const portImpactStore = usePortImpactStore()

/**
 * 获取设施类型对应的中文标签
 */
function getFacilityTypeLabel(type) {
  const typeMap = {
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
function formatLoss(loss) {
  // FIX:P3-15: 非法输入防御
  const v = Number(loss)
  if (!isFinite(v)) return '—'
  if (v >= 10000) {
    return (v / 10000).toFixed(1) + '万'
  }
  return v.toFixed(0)
}

/**
 * 按损失金额排序的设施列表（降序）
 */
const sortedFacilities = computed(() => {
  const facilities = portImpactStore.affectedFacilities || []
  return [...facilities].sort((a, b) => b.loss - a.loss)
})
</script>

<template>
  <PaginatedListPanel
    :items="sortedFacilities"
    :page-size="4"
    title="受影响设施清单"
    empty-text="暂无受影响设施"
    empty-hint="开始评估后显示设施清单"
    plan-type="flood"
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
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  flex: 1;
}

.facility-type {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

.facility-loss {
  color: #f56c6c;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 70px;
  text-align: right;
}
</style>
