<script setup lang="ts">
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 继承 AppLayout 布局基座：
 * - 左侧：港口吞吐量折线图 + 柱状图（c023 从 AppLayout 下沉到本页）
 * - 右侧：单个 4×8 Panel，放置 LoginPanel + 收藏夹
 *
 * 功能：
 * 1. 登录/注册/退出
 * 2. 收藏夹：按方案分组显示已收藏的小区/设施
 * 3. 方案重命名、删除、加载
 *
 * 布局规格：
 * - 右侧 Panel 4×8 Cell，anchor=top-right, offset-y=1.25
 * - 上半部分：LoginPanel
 * - 下半部分：收藏夹列表
 */

import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { EDITING_PLAN_KEY, RESTORE_PLAN_DATA_KEY } from '@/core'
import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useAuth } from '@/shared'
import { usePlans } from '@/shared'
import { useGCS } from '@/shared'
import { logger } from '@/shared'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { useFloodState } from '@/stores'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'

import LoginPanel from './LoginPanel.vue'

const { css, cellPixel } = useGCS()
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'
import type { SavedXiaoqu } from '@/types/xiaoqu'

const router = useRouter()
const {
  updatePlan,
  getPlans,
  deletePlan,
  loading: plansLoading,
  deleting: plansDeleting,
} = usePlans()
const { user, logout } = useAuth()
const floodStore = useFloodState()

/**
 * 折线图数据（c023 从 AppLayout 下沉到本页）
 */
const chartData = {
  labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
  series: [
    { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
    { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
    { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
  ],
}

/**
 * 柱状图数据（c023 从 AppLayout 下沉到本页）
 */
const barData = {
  labels: ['钦州港', '北海港', '防城港'],
  series: [
    { name: '2023年', data: [190, 140, 150] },
    { name: '2024年', data: [230, 180, 170] },
  ],
}

/* 个人中心布局尺寸（GCS cell 单位） */
const avatarSizeCss = computed(() => `${cellPixel.value * 1.2}px`)
const avatarFontCss = computed(() => `${cellPixel.value * 0.5}px`)
const logoutWidthCss = computed(() => `${cellPixel.value * 3.8}px`)
const logoutHeightCss = computed(() => `${cellPixel.value * 0.8}px`)
const logoutFontCss = computed(() => `${cellPixel.value * 0.175}px`)
const avatarText = computed(() => (user.value?.username || '?').charAt(0).toUpperCase())

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
      logger.error('[ProfilePage] 加载方案列表失败:', error)
    }
  }
}

/**
 * 删除方案
 */
async function handleDeletePlan(plan: Plan) {
  try {
    await ElMessageBox.confirm(`确定要删除方案"${plan.name}"吗？`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  plansError.value = ''
  try {
    await deletePlan(plan.id)
    if (expandedPlanId.value === plan.id) {
      expandedPlanId.value = null
    }
    await loadPlans()
  } catch (error) {
    plansError.value = (error as Error).message || '删除失败，请稍后重试'
    if (import.meta.env.DEV) {
      logger.error('[ProfilePage] 删除方案失败:', error)
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
  router.push('/site-selection')
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
 *
 * 方案字段为 unknown，使用类型守卫做最小运行时校验后收窄，
 * 不通过则降级为空数组，避免裸断言导致后续运行时崩溃。
 */
function loadFloodPlan(plan: Plan) {
  const floodFeatures = isFloodFeatureArray(plan.floodFeatures) ? plan.floodFeatures : []
  const affectedFacilities = isAffectedFacilityArray(plan.affectedFacilities)
    ? plan.affectedFacilities
    : []

  if (!isFloodFeatureArray(plan.floodFeatures)) {
    logger.debug('[ProfilePage] 方案 floodFeatures 数据格式异常，已降级为空数组')
  }
  if (!isAffectedFacilityArray(plan.affectedFacilities)) {
    logger.debug('[ProfilePage] 方案 affectedFacilities 数据格式异常，已降级为空数组')
  }

  floodStore.saveState({
    waterLevel: plan.waterLevel || 0,
    floodStatistics: (plan.floodStatistics ?? null) as FloodStatistics | null,
    floodFeatures,
    floodRiskLevel: plan.floodRiskLevel as string, // 补传风险等级
    affectedFacilities,
    totalLoss: plan.totalLoss as number,
  })
  router.push('/flood-analysis')
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
 * 退出登录：复用 useAuth.logout（清 HttpOnly Cookie + localStorage + 业务 store）
 * 之前退出按钮只写在 LoginPanel 的"已登录分支"，而登录态下 ProfilePage 并不挂载
 * LoginPanel（v-if="!user"），导致按钮不可达。此处把入口接出来。
 */
async function handleLogout() {
  await logout()
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
      loadPlans()
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
  <div class="profile-page">
    <AppLayout>
      <!-- 左侧：折线图 + 柱状图（c023 从 AppLayout 下沉到本页） -->
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart title="港口吞吐量趋势" :x-data="chartData.labels" :series="chartData.series" />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口吞吐量对比" :x-data="barData.labels" :series="barData.series" />
        </GCSPanel>
      </template>

      <!-- 右侧：单个 4×8 Panel -->
      <template #right>
        <GCSPanel :w="4" :h="8" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div class="profile-content">
            <!-- c013: 两张屏 v-if 互换——未登录显示登录面板，已登录显示个人中心 -->
            <LoginPanel v-if="!user" class="profile-login" />

            <!-- 个人中心：收藏夹内容（仅登录后显示） -->
            <div v-else class="profile-logged-in">
              <!-- 顶部：默认头像 + 用户名（占上四分位 ~25%） -->
              <div class="profile-header">
                <div class="profile-avatar">{{ avatarText }}</div>
                <span class="profile-username">{{ user?.username }}</span>
              </div>

              <!-- 从上四分位线往下：抽屉型收藏（一个方案=一个抽屉，可装多个小区/设施） -->
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
                        <button class="action-btn load-btn" @click="handleLoadPlan(plan)">
                          加载
                        </button>
                        <button class="action-btn edit-btn" @click="handleEditPlan(plan)">
                          重命名
                        </button>
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
              </div>
              <!-- 最底部：退出登录按钮（0.8×3.8 Cell，沿用原视觉语言） -->
              <div class="logout-bar">
                <button class="logout-btn-bottom" @click="handleLogout">退出登录</button>
              </div>
            </div>
          </div>
        </GCSPanel>
      </template>
    </AppLayout>

    <!-- 方案重命名弹窗 -->
    <!-- 重命名弹窗初始名使用 editingNamePlan -->
    <!-- 监听 error 事件，校验失败时显示错误 -->
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
.profile-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.profile-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  pointer-events: auto;
}

/* 未登录：登录面板占满整个 Panel */
.profile-login {
  flex: 1 1 0;
  min-height: 0;
}

/* 已登录：内部三段式（顶部头像+用户名 / 中段抽屉收藏 / 底部退出） */
.profile-logged-in {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 顶部：默认头像 + 用户名（占上四分位 ~25%） */
.profile-header {
  flex: 0 0 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid var(--GCS-border-light);
}

.profile-avatar {
  width: v-bind(avatarSizeCss);
  height: v-bind(avatarSizeCss);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: v-bind(avatarFontCss);
  font-weight: 600;
  flex-shrink: 0;
  user-select: none;
}

.profile-username {
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* 收藏区：从上四分位线往下，可滚动（抽屉型） */
.favorites-container {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

/* 最底部：退出登录按钮（0.8×3.8 Cell，沿用原视觉语言） */
.logout-bar {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: v-bind(css.cell8px) 0;
}

.logout-btn-bottom {
  width: v-bind(logoutWidthCss);
  height: v-bind(logoutHeightCss);
  border: 1px solid var(--GCS-color-error);
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-bg-panel);
  color: var(--GCS-color-error);
  font-size: v-bind(logoutFontCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.logout-btn-bottom:hover {
  background: var(--GCS-color-error);
  color: var(--GCS-text-inverse);
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
