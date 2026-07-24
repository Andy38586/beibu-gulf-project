<script setup lang="ts">
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 继承 AppLayout 布局基座：
 * - 左侧：默认可视化面板（折线图 + 柱状图）
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

import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import { ElMessageBox } from 'element-plus'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LoginPanel from '@/shared/components/LoginPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import { usePlans } from '@/shared/composables/usePlans'
import { useAuth } from '@/shared/composables/useAuth'
import { useFavoriteStore } from '@/stores/favoriteStore'
import { useFloodStateStore } from '@/stores/floodState'
import type { Plan } from '@/types/plan'
import type { SavedXiaoqu } from '@/types/xiaoqu'

const router = useRouter()
const { updatePlan, getPlans, deletePlan, loading: plansLoading, deleting: plansDeleting } = usePlans()
const { user } = useAuth()
const favStore = useFavoriteStore()
const floodStateStore = useFloodStateStore()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

const showSaveModal = ref(false)
const editingNamePlan = ref<Plan | null>(null)
const saveError = ref('')
const savingName = ref(false)

/** 本地收藏夹：新增文件夹名称 */
const newFolderName = ref('')

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
    plansError.value = error.message || '方案列表加载失败，请稍后重试'
    if (import.meta.env.DEV) {
      console.error('[ProfilePage] 加载方案列表失败:', error)
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
    plansError.value = error.message || '删除失败，请稍后重试'
    if (import.meta.env.DEV) {
      console.error('[ProfilePage] 删除方案失败:', error)
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
 * 加载浸没分析方案：保存状态到 floodStateStore 后跳转
 */
function loadFloodPlan(plan: Plan) {
  floodStateStore.saveState({
    waterLevel: plan.waterLevel || 0,
    floodStatistics: plan.floodStatistics,
    floodFeatures: plan.floodFeatures,
    floodRiskLevel: plan.floodRiskLevel, // FIX:P2-03: 补传风险等级
    affectedFacilities: plan.affectedFacilities,
    totalLoss: plan.totalLoss,
  })
  router.push('/heatmap')
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
    saveError.value = e.message || '重命名失败'
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

/** 本地收藏夹操作 */
function handleAddFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  favStore.addFolder(name)
  newFolderName.value = ''
}
function handleRemoveFolder(id) { favStore.removeFolder(id) }
function handleToggleFolder(id) { favStore.toggleFolder(id) }
function handleRemoveFavItem(itemId, folderId) { favStore.removeFromFolder(itemId, folderId) }
function handleMoveFavItem(itemId, fromId, toId) { favStore.moveItem(itemId, fromId, toId) }
function targetFolders(excludeId) { return favStore.folders.filter(f => f.id !== excludeId) }
const totalLocalFavs = computed(() => favStore.folders.reduce((s, f) => s + f.items.length, 0))

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
  { immediate: true },
)
</script>

<template>
  <div class="profile-page">
    <AppLayout>
      <!-- 左侧：不传 slot，使用 AppLayout 默认可视化面板（折线图 + 柱状图） -->

      <!-- 右侧：单个 4×8 Panel -->
      <template #right>
        <GcsPanel :w="4" :h="8" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div class="profile-content">
            <!-- 顶部：登录面板 -->
            <LoginPanel />

            <!-- 本地收藏夹（文件夹结构，localStorage 持久化） -->
            <div class="local-fav-section">
              <div class="section-header">
                <span class="section-title">收藏夹</span>
                <span v-if="totalLocalFavs" class="section-count">{{ totalLocalFavs }} 项</span>
              </div>
              <!-- 新增文件夹 -->
              <div class="add-folder-row">
                <input v-model="newFolderName" class="folder-input" placeholder="新收藏夹名称" @keyup.enter="handleAddFolder" />
                <button class="add-btn" @click="handleAddFolder">+ 新增</button>
              </div>
              <!-- 文件夹列表 -->
              <div v-for="f in favStore.folders" :key="f.id" class="local-folder">
                <div class="folder-bar" @click="handleToggleFolder(f.id)">
                  <span class="folder-arrow">{{ f.expanded ? '▼' : '▶' }}</span>
                  <span class="folder-name">{{ f.name }}</span>
                  <span class="folder-n">{{ f.items.length }}</span>
                  <button v-if="f.id !== 'default'" class="folder-x" @click.stop="handleRemoveFolder(f.id)">×</button>
                </div>
                <div v-if="f.expanded" class="folder-body">
                  <div v-if="f.items.length === 0" class="empty-hint">暂无收藏</div>
                  <div v-for="item in f.items" :key="item.id" class="local-item">
                    <span class="item-t">{{ item.title }}</span>
                    <select v-if="targetFolders(f.id).length" class="move-sel" @change="e => { if(e.target.value){handleMoveFavItem(item.id, f.id, e.target.value);e.target.value=''} }" @click.stop>
                      <option value="">移至</option>
                      <option v-for="t in targetFolders(f.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
                    </select>
                    <button class="item-x" @click.stop="handleRemoveFavItem(item.id, f.id)">×</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 中部：方案收藏（服务端） -->
            <div class="favorites-container">
              <!-- 错误提示 -->
              <div v-if="plansError" class="plans-error">
                {{ plansError }}
              </div>

              <!-- 加载状态 -->
              <div v-if="plansLoading" class="plans-loading">
                加载中...
              </div>

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
            </div>

          </div>
        </GcsPanel>
      </template>
    </AppLayout>

    <!-- 方案重命名弹窗 -->
    <!-- FIX:P1-04: 重命名弹窗初始名使用 editingNamePlan -->
    <!-- FIX:P3-14: 监听 error 事件，校验失败时显示错误 -->
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
  overflow-y: auto;
  pointer-events: auto;
}

/* 方案列表错误提示 */
.plans-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  color: #ff4d4f;
  font-size: 13px;
}

/* 方案列表 Loading 状态 */
.plans-loading {
  margin-top: 12px;
  padding: 8px 12px;
  text-align: center;
  color: #999;
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
  color: #303133;
}

.favorites-count {
  font-size: 12px;
  color: #909399;
}

/* 方案列表 */
.plans-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.plan-group {
  background: #f5f7fa;
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
  background: #eef1f6;
}

.plan-toggle {
  font-size: 10px;
  color: #909399;
  width: 12px;
  flex-shrink: 0;
}

.plan-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-count {
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
}

.plan-detail {
  padding: 8px 12px 12px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.plan-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.action-btn {
  flex: 1;
  padding: 5px 0;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.load-btn {
  color: #409eff;
  border-color: #409eff;
}

.edit-btn {
  color: #52c41a;
  border-color: #52c41a;
}

.delete-btn {
  color: #ff4d4f;
  border-color: #ff4d4f;
}

.delete-btn:hover:not(:disabled) {
  background: #ff4d4f;
  color: #fff;
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
  color: #909399;
  margin-bottom: 6px;
  padding-left: 4px;
}

.fav-section :deep(.favorite-list-panel) {
  background: #f5f7fa;
}

/* 小区列表样式 */
.xq-rank {
  color: #909399;
  font-size: 12px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.xq-name {
  color: #303133;
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
  color: #409eff;
  font-weight: 600;
  flex-shrink: 0;
  font-size: 12px;
}

.facility-name {
  color: #303133;
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
  color: #606266;
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: #909399;
}

/* 本地收藏夹 */
.local-fav-section {
  margin-top: 10px;
  padding: 0 4px;
  flex-shrink: 0;
}
.section-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.section-title { font-size: 14px; font-weight: 600; color: #303133; }
.section-count { font-size: 11px; color: #909399; }
.add-folder-row { display: flex; gap: 4px; margin-bottom: 6px; }
.folder-input {
  flex: 1; border: 1px solid #dcdfe6; border-radius: 4px;
  padding: 3px 6px; font-size: 12px; outline: none;
}
.folder-input:focus { border-color: #409eff; }
.add-btn {
  flex-shrink: 0; background: #409eff; color: #fff; border: none;
  border-radius: 4px; padding: 3px 8px; font-size: 12px; cursor: pointer;
}
.local-folder { background: #f5f7fa; border-radius: 4px; margin-bottom: 4px; overflow: hidden; }
.folder-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px; cursor: pointer; font-size: 13px;
}
.folder-arrow { font-size: 9px; color: #909399; width: 10px; }
.folder-name { flex: 1; font-weight: 500; color: #303133; }
.folder-n { font-size: 11px; color: #c0c4cc; }
.folder-x { border: none; background: none; color: #c0c4cc; font-size: 14px; cursor: pointer; }
.folder-x:hover { color: #f56c6c; }
.folder-body { padding: 0 6px 4px; }
.empty-hint { padding: 8px 0; text-align: center; font-size: 12px; color: #c0c4cc; }
.local-item {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 6px; margin-bottom: 2px; background: #fff; border-radius: 3px;
  font-size: 12px;
}
.item-t { flex: 1; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.move-sel { font-size: 10px; border: 1px solid #e4e7ed; border-radius: 2px; padding: 0 2px; color: #606266; }
.item-x { border: none; background: none; color: #c0c4cc; font-size: 13px; cursor: pointer; }
.item-x:hover { color: #f56c6c; }
</style>
