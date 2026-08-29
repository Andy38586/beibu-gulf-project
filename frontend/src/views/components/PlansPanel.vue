<script setup lang="ts">
/**
 * PlansPanel - 个人中心收藏夹（方案抽屉）
 * 职责单一：方案列表加载/展开/加载到业务页/重命名/删除 + 收藏切换刷新。
 * useAuth/usePlans/useFloodStore 为 Pinia 单例；RESTORE_PLAN_DATA_KEY/EDITING_PLAN_KEY
 * 由 App.vue provide，此处 inject 拿到同一 ref 引用，赋值对主页面/业务页可见。
 */
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { EDITING_PLAN_KEY, RESTORE_PLAN_DATA_KEY } from '@/core'
import { useAuth, usePlans } from '@/shared'
import { showModal } from '@/shared'
import { showError } from '@/shared'
import { showToast } from '@/shared'
import { logger } from '@/shared'
import { EmptyState, PaginatedListPanel, PlanSaveModal, sanitizeMessage } from '@/shared'
import { useFavorites } from '@/shared'
import { useFloodStore } from '@/stores'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import type { FavoriteItem } from '@/types/business/base'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'
import type { SavedXiaoqu } from '@/types/xiaoqu'

const router = useRouter()
const {
  updatePlan,
  getPlans,
  deletePlan,
  cancel: cancelPlansRequest,
  loading: plansLoading,
  deleting: plansDeleting,
} = usePlans()
const { user } = useAuth()
const floodStore = useFloodStore()
// 全局收藏单例（2026-08-29 收藏与方案解耦：收藏夹直接展示全局收藏平铺列表）
const { favorites, removeFavorite } = useFavorites()

// 卸载时取消在途 getPlans 请求，避免迟到响应写入已卸载组件
onUnmounted(() => {
  cancelPlansRequest()
})

const restorePlanData = inject(RESTORE_PLAN_DATA_KEY, ref<Record<string, TypeSetting> | null>(null))
const editingPlan = inject(EDITING_PLAN_KEY, ref<Plan | null>(null))

const showSaveModal = ref(false)
const editingNamePlan = ref<Plan | null>(null)
const saveError = ref('')
const savingName = ref(false)

/** 方案列表（含收藏内容） */
const plansList = ref<Plan[]>([])

/** 当前展开的方案ID */
const expandedPlanId = ref<string | null>(null)

/** 加载方案列表（含已收藏小区） */
async function loadPlans() {
  if (!user.value) return

  try {
    plansList.value = await getPlans()
  } catch (error) {
    // 错误反馈走全局 toast（成因区分在 showError/describeError），不在面板内联渲染
    showError(error, { fallback: '方案列表加载失败，请稍后重试' })
  }
}

/** 删除方案：GCSModal confirm 确认（取消不触发 onConfirm，仅关弹窗） */
function handleDeletePlan(plan: Plan) {
  showModal({
    message: `确定要删除方案"${plan.name}"吗？`,
    mode: 'confirm',
    onConfirm: () => void doDeletePlan(plan.id),
  })
}

async function doDeletePlan(id: string): Promise<void> {
  try {
    await deletePlan(id)
    if (expandedPlanId.value === id) {
      expandedPlanId.value = null
    }
    await loadPlans()
  } catch (error) {
    showError(error, { fallback: '删除失败，请稍后重试' })
  }
}

/** 切换方案展开/收起 */
function togglePlan(planId: string) {
  expandedPlanId.value = expandedPlanId.value === planId ? null : planId
}

/** 加载方案到对应业务页（按 businessType 路由到选址/浸没分析） */
function handleLoadPlan(plan: Plan) {
  if (plan.businessType === 'flood') {
    loadFloodPlan(plan)
    return
  }
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  void router.push('/site-selection')
}

/** 最小类型守卫：对象是否具备 FloodFeature 必需字段 */
function isFloodFeature(obj: unknown): obj is FloodFeature {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return o.type === 'Feature' && typeof o.geometry === 'object' && o.geometry !== null
}

/** 最小类型守卫：数组元素是否全部为 FloodFeature */
function isFloodFeatureArray(data: unknown): data is FloodFeature[] {
  return Array.isArray(data) && data.every(isFloodFeature)
}

/** 最小类型守卫：对象是否具备 AffectedFacility 必需字段 */
function isAffectedFacility(obj: unknown): obj is AffectedFacility {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.lng === 'number' &&
    typeof o.lat === 'number'
  )
}

function isAffectedFacilityArray(data: unknown): data is AffectedFacility[] {
  return Array.isArray(data) && data.every(isAffectedFacility)
}

/** 加载浸没分析方案：类型守卫收窄后存入 floodStore 再跳转，不通过降级为空数组 */
function loadFloodPlan(plan: Plan) {
  const floodFeatures = isFloodFeatureArray(plan.floodFeatures) ? plan.floodFeatures : []
  const affectedFacilities = isAffectedFacilityArray(plan.affectedFacilities)
    ? plan.affectedFacilities
    : []

  if (!isFloodFeatureArray(plan.floodFeatures)) {
    logger.debug('[PlansPanel] 方案 floodFeatures 数据格式异常，已降级为空数组')
  }
  if (!isAffectedFacilityArray(plan.affectedFacilities)) {
    logger.debug('[PlansPanel] 方案 affectedFacilities 数据格式异常，已降级为空数组')
  }

  floodStore.saveState({
    waterLevel: plan.waterLevel || 0,
    floodStatistics: (plan.floodStatistics ?? null) as FloodStatistics | null,
    floodFeatures,
    floodRiskLevel: plan.floodRiskLevel as string, // 补传风险等级
    affectedFacilities,
    totalLoss: plan.totalLoss as number,
  })
  void router.push('/flood-analysis')
}

/** 编辑方案名称 */
function handleEditPlan(plan: Plan) {
  editingNamePlan.value = plan
  saveError.value = ''
  showSaveModal.value = true
}

/** 保存方案名称 */
async function handleSaveName(name: string) {
  if (!editingNamePlan.value) return
  savingName.value = true
  saveError.value = ''
  try {
    await updatePlan(editingNamePlan.value.id, name.trim(), editingNamePlan.value.typeSettings)
    showSaveModal.value = false
    await loadPlans()
  } catch (e) {
    // 816-专项5并 1-2：同上无害化
    saveError.value = sanitizeMessage((e as Error).message || '', '重命名失败')
  } finally {
    savingName.value = false
  }
}

/** 全局收藏分区（选址小区 / 浸没设施），收藏夹平铺展示 */
const favoriteGroups = computed(() => {
  const groups = [
    {
      type: 'xiaoqu' as const,
      label: '选址小区',
      items: favorites.value.filter((f) => f.itemType === 'xiaoqu'),
    },
    {
      type: 'facility' as const,
      label: '浸没设施',
      items: favorites.value.filter((f) => f.itemType === 'facility'),
    },
  ]
  return groups.filter((g) => g.items.length > 0)
})

/** 取消收藏（收藏夹内直接操作，全局状态单例同步） */
async function handleRemoveFavorite(fav: FavoriteItem): Promise<void> {
  try {
    await removeFavorite(fav.itemType, fav.itemId)
    showToast(`已取消收藏：${fav.name}`, 'success')
  } catch (error) {
    showError(error, { fallback: '取消收藏失败，请稍后重试' })
  }
}

/** 选址分析类型的小区（score > 0） */
function getSiteXiaoqu(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => xq.score > 0) || []
}

/** 浸没分析类型的设施（score === 0） */
function getFloodFacilities(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => !xq.score || xq.score === 0) || []
}

// 监听登录状态：登录自动加载，登出清空
watch(
  () => user.value,
  (newUser) => {
    if (newUser) {
      void loadPlans()
    } else {
      plansList.value = []
      expandedPlanId.value = null
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="favorites-container">
    <!-- 错误反馈已收敛到全局 toast（GCS 反馈层），面板不再内联渲染错误条 -->

    <!-- 加载状态 -->
    <div v-if="plansLoading" class="plans-loading">加载中...</div>

    <!-- ===== 我的收藏（全局收藏平铺，2026-08-29 与方案解耦） ===== -->
    <template v-if="user">
      <div v-if="favorites.length > 0" class="favorites-header">
        <span class="favorites-title">我的收藏</span>
        <span class="favorites-count">{{ favorites.length }}条</span>
      </div>
      <div v-for="group in favoriteGroups" :key="group.type" class="fav-group">
        <div class="fav-group-title">{{ group.label }}</div>
        <div v-for="fav in group.items" :key="fav.id" class="fav-item">
          <span class="fav-name">{{ fav.name }}</span>
          <button class="fav-remove" @click="handleRemoveFavorite(fav)">取消收藏</button>
        </div>
      </div>
      <EmptyState
        v-if="favorites.length === 0"
        icon="⭐"
        message="暂无收藏"
        hint="去选址分析或浸没分析收藏内容吧"
      />
    </template>

    <!-- ===== 我的方案（保存的方案快照，展开/加载/删除） ===== -->
    <div v-if="user && plansList.length > 0" class="favorites-header">
      <span class="favorites-title">我的方案</span>
      <span class="favorites-count">{{ plansList.length }}个方案</span>
    </div>

    <!-- 方案列表（可展开） -->
    <div v-if="user && plansList.length > 0" class="plans-list">
      <div v-for="plan in plansList" :key="plan.id" class="plan-group">
        <!-- 方案头部 -->
        <div class="plan-header" @click="togglePlan(plan.id)">
          <span class="plan-toggle">{{ expandedPlanId === plan.id ? '▼' : '▶' }}</span>
          <span class="plan-name">{{ plan.name }}</span>
          <span class="plan-count">{{ plan.savedXiaoqu?.length || 0 }}项</span>
        </div>

        <!-- 展开内容：操作按钮 + 收藏列表 -->
        <div v-if="expandedPlanId === plan.id" class="plan-detail">
          <!-- 操作按钮 -->
          <div class="plan-actions">
            <button class="action-btn load-btn" @click="handleLoadPlan(plan)">加载</button>
            <button class="action-btn edit-btn" @click="handleEditPlan(plan)">重命名</button>
            <button
              class="action-btn delete-btn"
              :disabled="plansDeleting"
              @click="handleDeletePlan(plan)"
            >
              {{ plansDeleting ? '删除中...' : '删除' }}
            </button>
          </div>

          <!-- 选址分析收藏（如果有） -->
          <div v-if="getSiteXiaoqu(plan).length > 0" class="fav-section">
            <div class="fav-section-title">选址分析</div>
            <PaginatedListPanel
              :items="getSiteXiaoqu(plan)"
              :page-size="3"
              :show-favorite="false"
              :map-interaction="false"
              plan-type="site-selection"
            >
              <template #item="{ item: xq, index }">
                <span class="xq-rank">{{ index + 1 }}</span>
                <span class="xq-name">{{ xq.name }}</span>
                <span class="xq-score">{{ xq.score }}分</span>
              </template>
            </PaginatedListPanel>
          </div>

          <!-- 浸没分析收藏（如果有） -->
          <div v-if="getFloodFacilities(plan).length > 0" class="fav-section">
            <div class="fav-section-title">浸没分析</div>
            <PaginatedListPanel
              :items="getFloodFacilities(plan)"
              :page-size="3"
              :show-favorite="false"
              :map-interaction="false"
              plan-type="flood"
            >
              <template #item="{ item: facility }">
                <span class="facility-name">{{ facility.name }}</span>
              </template>
            </PaginatedListPanel>
          </div>
        </div>
      </div>
    </div>

    <!-- 方案空态由收藏空态与「我的方案」标题共同表达：无方案时不重复渲染占位 -->
    <!-- 方案重命名弹窗（初始名取 editingNamePlan，error 时显示校验失败） -->
    <PlanSaveModal
      :visible="showSaveModal"
      :saving="savingName"
      :error-msg="saveError"
      :initial-name="editingNamePlan?.name || ''"
      @close="showSaveModal = false"
      @save="handleSaveName"
      @error="(msg) => (saveError = msg)"
    />
  </div>
</template>

<style scoped>
/* 收藏区：从上四分位线往下，可滚动（抽屉型） */
.favorites-container {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

/* 我的收藏分组（全局收藏平铺，2026-08-29 与方案解耦） */
.fav-group {
  margin-bottom: 10px;
}

.fav-group-title {
  font-size: 12px;
  color: var(--GCS-text-muted);
  margin-bottom: 6px;
  padding-left: 4px;
}

.fav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--GCS-bg-container);
  border-radius: 6px;
}

.fav-name {
  flex: 1;
  color: var(--GCS-text-primary);
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.fav-remove {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-sm);
  background: var(--GCS-bg-panel);
  color: var(--GCS-color-error);
  font-size: 12px;
  cursor: pointer;
}

.fav-remove:hover {
  border-color: var(--GCS-color-error);
}

/* 方案列表 Loading 状态 */
.plans-loading {
  margin-top: 12px;
  padding: 8px 12px;
  text-align: center;
  color: var(--GCS-text-muted);
  font-size: 13px;
}

/* 收藏夹标题 */
.favorites-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 4px;
}

.favorites-title {
  /* c054：收敛到正文基准档位（原 15px 非刻度） */
  font-size: var(--GCS-font-size-body);
  font-weight: 600;
  color: var(--GCS-text-primary);
}

.favorites-count {
  font-size: 12px;
  color: var(--GCS-text-muted);
}

/* 方案列表 */
.plans-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.plan-group {
  background: var(--GCS-bg-container);
  border-radius: 6px;
  overflow: hidden;
}

.plan-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.plan-header:hover {
  background: var(--GCS-bg-container);
}

.plan-toggle {
  font-size: var(--GCS-font-size-xs); /* 816-S7-57：越档 10px 归 12px 档 */
  color: var(--GCS-text-muted);
  width: 12px;
  flex-shrink: 0;
}

.plan-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--GCS-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-count {
  font-size: 12px;
  color: var(--GCS-text-muted);
  flex-shrink: 0;
}

.plan-detail {
  padding: 8px 12px 12px;
  background: var(--GCS-bg-panel);
  border-top: 1px solid var(--GCS-border-light);
}

.plan-actions {
  display: flex;

  /* 816-S7-51：微间距归 8px 基准（原 6px 非刻度） */
  gap: 8px;
  margin-bottom: 10px;
}

.action-btn {
  flex: 1;

  /* 816-S7-51：垂直 padding 归 8px 基准（原 5px 非刻度） */
  padding: 8px 0;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-sm); /* 816-S7-54：非档位 4px 归 sm */
  background: var(--GCS-bg-panel);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}

.action-btn:disabled {
  /* 816-S7-47：禁用态走 text-disabled token（原裸 opacity 0.6） */
  color: var(--GCS-text-disabled);
  cursor: not-allowed;
}

.load-btn {
  color: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
}

.edit-btn {
  color: var(--GCS-color-success);
  border-color: var(--GCS-color-success);
}

.delete-btn {
  color: var(--GCS-color-error);
  border-color: var(--GCS-color-error);
}

.delete-btn:hover:not(:disabled) {
  background: var(--GCS-color-error);
  color: var(
    --GCS-text-inverse
  ); /* 816-S7-62：bg-panel 语义为背景，前景一律 text-inverse（原数值恰等，非功能性改动） */
}

/* 收藏分区 */
.fav-section {
  margin-bottom: 10px;
}

.fav-section:last-child {
  margin-bottom: 0;
}

.fav-section-title {
  font-size: 12px;
  color: var(--GCS-text-muted);
  margin-bottom: 6px;
  padding-left: 4px;
}

.fav-section :deep(.paginated-list-panel) {
  background: var(--GCS-bg-container);
}

/* 小区列表样式 */
.xq-rank {
  color: var(--GCS-text-muted);
  font-size: 12px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.xq-name {
  color: var(--GCS-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: center;
  min-width: 0;
  font-size: 12px;
}

.xq-score {
  color: var(--GCS-color-primary);
  font-weight: 600;
  flex-shrink: 0;
  font-size: 12px;
}

.facility-name {
  color: var(--GCS-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  font-size: 12px;
}
</style>
