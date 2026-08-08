<script setup lang="ts">
/**
 * PlansPanel - 个人中心收藏夹（方案抽屉）
 * 职责单一：方案列表加载/展开/加载到业务页/重命名/删除 + 收藏切换刷新
 * （P1-10 拆分 ProfilePage 产物）
 *
 * 依赖说明：useAuth/usePlans/useFloodStore 均为 Pinia 单例；RESTORE_PLAN_DATA_KEY /
 * EDITING_PLAN_KEY 由 App.vue 顶层 provide，此处 inject 拿到同一 ref 引用，赋值对
 * 主页面/目标业务页可见。
 */
import { inject, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { EDITING_PLAN_KEY, RESTORE_PLAN_DATA_KEY } from '@/core'
import { useAuth, usePlans } from '@/shared'
import { showModal } from '@/shared/utils/gcsFeedback'
import { logger } from '@/shared'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { useFloodStore } from '@/stores'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
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

// P0-5: 组件卸载时取消在途 getPlans 请求,避免迟到响应写入已卸载组件
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
const plansError = ref('')
const plansList = ref<Plan[]>([])

/** 当前展开的方案ID */
const expandedPlanId = ref<string | null>(null)

/**
 * 加载方案列表（含已收藏小区）
 */
async function loadPlans() {
  if (!user.value) return

  plansError.value = ''
  try {
    plansList.value = await getPlans()
  } catch (error) {
    plansError.value = (error as Error).message || '方案列表加载失败，请稍后重试'
    if (import.meta.env.DEV) {
      logger.error('[PlansPanel] 加载方案列表失败:', error)
    }
  }
}

/**
 * 删除方案
 * 2026-08-08 打磨：ElMessageBox.confirm → GCSModal（confirm 模式：确定/取消，
 * 取消 = 不触发 onConfirm 仅关闭弹窗）
 */
function handleDeletePlan(plan: Plan) {
  showModal({
    message: `确定要删除方案"${plan.name}"吗？`,
    mode: 'confirm',
    onConfirm: () => void doDeletePlan(plan.id),
  })
}

async function doDeletePlan(id: string): Promise<void> {
  plansError.value = ''
  try {
    await deletePlan(id)
    if (expandedPlanId.value === id) {
      expandedPlanId.value = null
    }
    await loadPlans()
  } catch (error) {
    plansError.value = (error as Error).message || '删除失败，请稍后重试'
    if (import.meta.env.DEV) {
      logger.error('[PlansPanel] 删除方案失败:', error)
    }
  }
}

/**
 * 切换方案展开/收起
 */
function togglePlan(planId: string) {
  expandedPlanId.value = expandedPlanId.value === planId ? null : planId
}

/**
 * 加载方案到对应业务页面
 * 根据 businessType 路由到选址分析或浸没分析
 */
function handleLoadPlan(plan: Plan) {
  if (plan.businessType === 'flood') {
    loadFloodPlan(plan)
    return
  }
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  void router.push('/site-selection')
}

/**
 * 最小类型守卫：校验对象是否具备 FloodFeature 的必需字段
 */
function isFloodFeature(obj: unknown): obj is FloodFeature {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return o.type === 'Feature' && typeof o.geometry === 'object' && o.geometry !== null
}

/** 最小类型守卫：校验数组元素是否全部为 FloodFeature */
function isFloodFeatureArray(data: unknown): data is FloodFeature[] {
  return Array.isArray(data) && data.every(isFloodFeature)
}

/** 最小类型守卫：校验对象是否具备 AffectedFacility 的必需字段 */
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

/**
 * 加载浸没分析方案：保存状态到 floodStore 后跳转
 * 方案字段为 unknown，使用类型守卫做最小运行时校验后收窄，
 * 不通过则降级为空数组，避免裸断言导致后续运行时崩溃。
 */
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

/**
 * 编辑方案名称
 */
function handleEditPlan(plan: Plan) {
  editingNamePlan.value = plan
  saveError.value = ''
  showSaveModal.value = true
}

/**
 * 保存方案名称
 */
async function handleSaveName(name: string) {
  if (!editingNamePlan.value) return
  savingName.value = true
  saveError.value = ''
  try {
    await updatePlan(editingNamePlan.value.id, name.trim(), editingNamePlan.value.typeSettings)
    showSaveModal.value = false
    await loadPlans()
  } catch (e) {
    saveError.value = (e as Error).message || '重命名失败'
  } finally {
    savingName.value = false
  }
}

/**
 * 收藏状态变化后重新加载
 */
async function handleFavoriteChange() {
  await loadPlans()
}

/**
 * 判断方案是否包含选址分析类型的小区（score > 0）
 */
function getSiteXiaoqu(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => xq.score > 0) || []
}

/**
 * 判断方案是否包含浸没分析类型的设施（score === 0）
 */
function getFloodFacilities(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => !xq.score || xq.score === 0) || []
}

// 监听用户登录状态，自动加载方案列表
watch(
  () => user.value,
  (newUser) => {
    if (newUser) {
      void loadPlans()
    } else {
      plansList.value = []
      plansError.value = ''
      expandedPlanId.value = null
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="favorites-container">
    <!-- 错误提示 -->
    <div v-if="plansError" class="plans-error">
      {{ plansError }}
    </div>

    <!-- 加载状态 -->
    <div v-if="plansLoading" class="plans-loading">加载中...</div>

    <!-- 收藏夹标题 -->
    <div v-if="user && plansList.length > 0" class="favorites-header">
      <span class="favorites-title">我的收藏</span>
      <span class="favorites-count">{{ plansList.length }}个方案</span>
    </div>

    <!-- 方案列表（可展开查看收藏内容） -->
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
              :show-favorite="true"
              :map-interaction="false"
              plan-type="site-selection"
              @favorite-change="handleFavoriteChange"
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
              :show-favorite="true"
              :map-interaction="false"
              plan-type="flood"
              @favorite-change="handleFavoriteChange"
            >
              <template #item="{ item: facility }">
                <span class="facility-name">{{ facility.name }}</span>
              </template>
            </PaginatedListPanel>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态：已登录但无收藏 -->
    <div v-if="user && !plansLoading && plansList.length === 0" class="empty-favorites">
      <div class="empty-icon">⭐</div>
      <div class="empty-text">暂无收藏</div>
      <div class="empty-hint">去选址分析或浸没分析收藏内容吧</div>
    </div>

    <!-- 方案重命名弹窗（初始名使用 editingNamePlan，error 事件时显示校验失败） -->
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

/* 方案列表错误提示 */
.plans-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--GCS-color-error-bg);
  border: 1px solid var(--GCS-color-error-border);
  border-radius: 6px;
  color: var(--GCS-color-error);
  font-size: 13px;
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
  font-size: 15px;
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
  font-size: 10px;
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
  gap: 6px;
  margin-bottom: 10px;
}

.action-btn {
  flex: 1;
  padding: 5px 0;
  border: 1px solid var(--GCS-border-default);
  border-radius: 4px;
  background: var(--GCS-bg-panel);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}

.action-btn:disabled {
  opacity: 0.6;
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
  color: var(--GCS-bg-panel);
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

/* 空收藏状态 */
.empty-favorites {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  gap: 6px;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
  color: var(--GCS-text-secondary);
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: var(--GCS-text-muted);
}
</style>
