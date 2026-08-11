<script setup lang="ts">
/**
 * PaginatedListPanel — 通用分页列表面板：
 * 分页 + 自定义插槽 + 收藏逻辑（对接 usePlans 的真实登录与 savedXiaoqu 判断）。
 * 前端称"收藏"，后端 API/数据库称 saved/save——字段名沿用后端约定，前端不做转换；
 * 点击项的地图跳转（flyTo）由业务层注入，shared 不依赖 core。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useAuth } from '@/shared/composables/useAuth'
import { usePlans } from '@/shared/composables/usePlans'
import { useGCS } from '@/shared/layout/useGCS.js'
import { showError } from '@/shared/utils/errorHandler'
import { showModal, showToast } from '@/shared/utils/gcsFeedback'
import { logger } from '@/shared/utils/logger'
import type { SavedXiaoqu } from '@/types/plan'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

interface Props {
  items: ScoredXiaoqu[]
  pageSize?: number
  title?: string
  emptyText?: string
  emptyHint?: string
  planType?: 'site-selection' | 'flood'
  showFavorite?: boolean
  mapInteraction?: boolean
  /** 点击列表项自动跳转（flyTo）：由业务层注入实现，页面不再各自处理 */
  flyTo?: (item: ScoredXiaoqu) => void
}

interface Emits {
  (_e: 'click-item', _item: ScoredXiaoqu): void
  (_e: 'favorite-change', _data: { item: ScoredXiaoqu; isFavorite: boolean }): void
}

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  pageSize: 4,
  title: '',
  emptyText: '暂无数据',
  emptyHint: '',
  planType: 'site-selection',
  showFavorite: true,
  mapInteraction: true,
})

const emit = defineEmits<Emits>()

// 从 useGCS 解构 CSS 变量供 v-bind() 使用
const { css } = useGCS()
const { cell8px, cell16px, cell40px, fontSizeTitle, fontSizeBody, fontSizeSmall } = css
const { createPlan, saveXiaoqu, removeXiaoqu } = usePlans()
const { isAuthenticated } = useAuth()
const router = useRouter()

/** 统一的登录状态判断：使用 isAuthenticated 而非 user.value */
const isLoggedIn = computed(() => isAuthenticated.value)

/** 当前选中的项（用于地图可视化） */
const selectedItem = ref<ScoredXiaoqu | null>(null)

/** 当前方案ID（用于收藏功能） */
const currentPlanId = ref<string | null>(null)
/** 当前方案的已收藏列表（用于isFavorite判断） */
const savedItems = ref<SavedXiaoqu[]>([])

/** 当前页码（从1开始） */
const currentPage = ref(1)

/** 总页数 */
const totalPages = computed(() => {
  if (props.pageSize <= 0) return 1
  return Math.ceil(props.items.length / props.pageSize)
})

/** 当前页数据 */
const currentPageItems = computed(() => {
  if (props.pageSize <= 0) return props.items
  const start = (currentPage.value - 1) * props.pageSize
  return props.items.slice(start, start + props.pageSize)
})

/** 是否有数据 */
const hasData = computed(() => props.items.length > 0)

/** 是否需要分页控件 */
const needPagination = computed(() => props.pageSize > 0 && totalPages.value > 1)

/** 判断项是否已收藏 */
function isFavorite(itemId: string): boolean {
  return savedItems.value.some((s) => s.id === itemId)
}

/** 切换收藏状态 */
async function toggleFavorite(item: ScoredXiaoqu) {
  if (!isLoggedIn.value) {
    // 未登录弹 GCSModal 登录引导
    showModal({
      message: '收藏功能需要登录，是否前往登录？',
      mode: 'login',
      onConfirm: () => void router.push('/profile'),
    })
    return
  }

  const itemId = item.id
  if (isFavorite(itemId)) {
    await doRemove(item)
  } else {
    await doSave(item)
  }
}

/** 添加收藏：无方案时先自动创建（浸没/选址命名区分） */
async function doSave(item: ScoredXiaoqu) {
  if (!currentPlanId.value) {
    try {
      const ts = Date.now().toString().slice(-8)
      const planName = props.planType === 'flood' ? `浸没分析收藏${ts}` : `选址分析收藏${ts}`
      const plan = await createPlan(planName, {})
      currentPlanId.value = plan?.id || null
      if (plan) {
        savedItems.value = plan.savedXiaoqu || []
      }
    } catch (error) {
      showError(error, { fallback: '创建收藏失败，请稍后重试' })
      if (import.meta.env.DEV) {
        logger.error('[PaginatedListPanel] 创建方案失败:', error)
      }
      return
    }
  }

  if (!currentPlanId.value) return

  try {
    const xiaoquData = toSavedXiaoqu(item)
    const plan = await saveXiaoqu(currentPlanId.value, xiaoquData)
    savedItems.value = plan?.savedXiaoqu || []
    showToast(`已收藏：${item.name}`, 'success')
    emit('favorite-change', { item, isFavorite: true })
  } catch (error) {
    showError(error, { fallback: '收藏失败，请稍后重试' })
    if (import.meta.env.DEV) {
      logger.error('[PaginatedListPanel] 收藏失败:', error)
    }
  }
}

/** 取消收藏 */
async function doRemove(item: ScoredXiaoqu) {
  if (!currentPlanId.value) {
    showError('未找到收藏方案，请先收藏一个小区')
    return
  }
  try {
    const plan = await removeXiaoqu(currentPlanId.value, item.id)
    savedItems.value = plan?.savedXiaoqu || []
    showToast(`已取消收藏：${item.name}`, 'success')
    emit('favorite-change', { item, isFavorite: false })
  } catch (error) {
    showError(error, { fallback: '取消收藏失败，请稍后重试' })
    if (import.meta.env.DEV) {
      logger.error('[PaginatedListPanel] 取消收藏失败:', error)
    }
  }
}

/** 列表项转 SavedXiaoqu 格式 */
function toSavedXiaoqu(item: ScoredXiaoqu): SavedXiaoqu {
  return {
    id: item.id,
    name: item.name,
    score: item.score ?? 0,
    lng: item.lng ?? 0,
    lat: item.lat ?? 0,
    breakdown: item.breakdown || {},
  } as SavedXiaoqu
}

/** 跳转到指定页 */
function goToPage(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

/** 点击列表项：注入 flyTo 跳转并 emit 规范化数据给父组件（雷达图等） */
function handleItemClick(item: ScoredXiaoqu) {
  selectedItem.value = item

  logger.debug('[PaginatedListPanel] 点击项:', item)
  logger.debug('[PaginatedListPanel] breakdown:', item.breakdown)

  const lng = item.lng
  const lat = item.lat

  // 规范化数据对象，确保字段一致性
  const normalizedItem = {
    ...item,
    lng,
    lat,
  }

  // 地图交互由业务层注入（shared 不依赖 core）
  props.flyTo?.(normalizedItem)

  // 向父组件 emit 规范化数据（雷达图等用）
  emit('click-item', normalizedItem)
}

/** 监听数据变化，重置到第一页 */
watch(
  () => props.items.length,
  () => {
    currentPage.value = 1
  }
)

/** 设置当前方案（外部初始化） */
function setCurrentPlan(planId: string, saved: SavedXiaoqu[]) {
  currentPlanId.value = planId
  savedItems.value = saved || []
}

/** 获取当前方案 ID */
function getCurrentPlanId(): string | null {
  return currentPlanId.value
}

/** 获取已收藏 ID 列表 */
function getSavedIds(): string[] {
  return savedItems.value.map((s) => s.id)
}

defineExpose({
  setCurrentPlan,
  getCurrentPlanId,
  getSavedIds,
  isFavorite,
})
</script>

<template>
  <div class="paginated-list-panel">
    <!-- 标题区 -->
    <div v-if="title" class="panel-header">
      <div class="header-title">{{ title }}</div>
    </div>

    <!-- 灰色背景板（包裹列表和分页） -->
    <div class="gray-container">
      <!-- 列表内容区 -->
      <div v-if="hasData" class="list-content">
        <div
          v-for="(item, index) in currentPageItems"
          :key="item.id || index"
          class="list-item"
          @click="handleItemClick(item)"
        >
          <slot name="item" :item="item" :index="index" />
          <ElButton
            v-if="showFavorite"
            class="favorite-btn"
            :type="isFavorite(item.id) ? 'warning' : 'default'"
            size="small"
            text
            @click.stop="toggleFavorite(item)"
          >
            {{ isFavorite(item.id) ? '★' : '☆' }}
          </ElButton>
        </div>
      </div>

      <!-- 无数据提示 -->
      <div v-else class="no-data-section">
        <slot name="empty">
          <div class="no-data-text">{{ emptyText }}</div>
          <div v-if="emptyHint" class="no-data-hint">{{ emptyHint }}</div>
        </slot>
      </div>

      <!-- 分页控制区 -->
      <div v-if="needPagination" class="pagination-section">
        <ElButton size="small" :disabled="currentPage === 1" @click="goToPage(1)">
          &lt;&lt;
        </ElButton>
        <ElButton size="small" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
          &lt;
        </ElButton>

        <div class="page-info">
          <span class="current-page">{{ currentPage }}</span>
          <span class="page-separator">/</span>
          <span class="total-pages">{{ totalPages }}</span>
        </div>

        <ElButton
          size="small"
          :disabled="currentPage === totalPages"
          @click="goToPage(currentPage + 1)"
        >
          &gt;
        </ElButton>
        <ElButton size="small" :disabled="currentPage === totalPages" @click="goToPage(totalPages)">
          &gt;&gt;
        </ElButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paginated-list-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--GCS-bg-panel-translucent);
  border-radius: var(--GCS-radius-md);
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell16px);
  flex-shrink: 0;
}

.header-title {
  font-size: v-bind(fontSizeTitle);
  font-weight: 600;
  color: var(--GCS-text-primary);
}

/* 灰色背景板：距外层panel 0.1cell，距标题 0.1cell */
.gray-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0 v-bind(cell8px) v-bind(cell8px) v-bind(cell8px);
  padding: v-bind(cell8px);
  background: var(--GCS-bg-container);
  border-radius: var(--GCS-radius-sm);
  box-sizing: border-box;
  overflow: hidden;
  min-height: 0;
}

.list-content {
  display: flex;
  flex-direction: column;
  gap: v-bind(cell8px);
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 单行列表项：不换行 */
.list-item {
  display: flex;
  align-items: center;
  gap: v-bind(cell8px);
  padding: v-bind(cell8px) 10px;
  background: var(--GCS-bg-panel);
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.2s;
}

.list-item:hover {
  background: var(--GCS-bg-hover);
}

.no-data-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell40px) 20px;
  gap: v-bind(cell8px);
  flex: 1;
}

.no-data-text {
  font-size: v-bind(fontSizeBody);
  color: var(--GCS-text-primary);
  font-weight: 500;
}

.no-data-hint {
  font-size: v-bind(fontSizeSmall);
  color: var(--GCS-text-muted);
}

.pagination-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: v-bind(cell8px);
  flex-shrink: 0;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: v-bind(fontSizeBody);
  color: var(--GCS-text-primary);
  min-width: 60px;
  justify-content: center;
}

.current-page {
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.page-separator {
  color: var(--GCS-text-muted);
}

.total-pages {
  color: var(--GCS-text-secondary);
}

.pagination-section .el-button {
  min-width: 40px;
  font-size: v-bind(fontSizeSmall);
}

.favorite-btn {
  flex-shrink: 0;
  padding: 0 4px;
  min-width: auto;
}
</style>
