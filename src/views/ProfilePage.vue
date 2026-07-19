<script setup>
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 继承 AppLayout 布局基座：
 * - 左侧：默认可视化面板（折线图 + 柱状图）
 * - 右侧：单个 4×8 Panel，放置 LoginPanel（登录/注册/退出）
 * - PlanSaveModal：方案重命名弹窗
 *
 * 布局规格：
 * - 右侧 Panel 4×8 Cell，anchor=top-right, offset-y=1.25
 * - LoginPanel 内部：登录/注册按钮 1.8×0.8 并排，退出按钮 3.8×0.8 底部
 */

import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LoginPanel from '@/shared/components/LoginPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { usePlans } from '@/shared/composables/usePlans'
import { useAuth } from '@/shared/composables/useAuth'

const router = useRouter()
const { updatePlan, getPlans, deletePlan, loading: plansLoading, deleting: plansDeleting } = usePlans()
const { user } = useAuth()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

const showSaveModal = ref(false)
const editingNamePlan = ref(null)
const saveError = ref('')
const savingName = ref(false)

// AUDIT-110: 方案列表加载和删除的错误处理
const plansError = ref('')
const plansList = ref([])

/**
 * 加载方案列表
 * AUDIT-110: 添加错误提示
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
 * AUDIT-110: 添加错误提示和确认弹窗
 */
async function handleDeletePlan(plan) {
  if (!confirm(`确定要删除方案"${plan.name}"吗？`)) return
  
  plansError.value = ''
  try {
    await deletePlan(plan.id)
    // 删除成功后重新加载列表
    await loadPlans()
  } catch (error) {
    plansError.value = error.message || '删除失败，请稍后重试'
    if (import.meta.env.DEV) {
      console.error('[ProfilePage] 删除方案失败:', error)
    }
  }
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
    }
  },
  { immediate: true }
)

onMounted(() => {
  if (user.value) {
    loadPlans()
  }
})

function handleLoadPlan(plan) {
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  router.push('/site-selection')
}

function handleEditPlan(plan) {
  editingNamePlan.value = plan
  saveError.value = ''
  showSaveModal.value = true
}

async function handleSaveName(name) {
  if (!editingNamePlan.value) return
  savingName.value = true
  saveError.value = ''
  try {
    await updatePlan(editingNamePlan.value.id, name.trim(), editingNamePlan.value.typeSettings)
    showSaveModal.value = false
  } catch (e) {
    saveError.value = e.message || '重命名失败'
  } finally {
    savingName.value = false
  }
}
</script>

<template>
  <div class="profile-page">
    <AppLayout>
      <!-- 左侧：不传 slot，使用 AppLayout 默认可视化面板（折线图 + 柱状图） -->

      <!-- 右侧：单个 4×8 Panel，放置 LoginPanel -->
      <template #right>
        <GcsPanel :w="4" :h="8" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <LoginPanel />
          
          <!-- AUDIT-110: 方案列表错误提示 -->
          <div v-if="plansError" class="plans-error">
            {{ plansError }}
          </div>
          
          <!-- AUDIT-109: 方案列表 Loading 状态 -->
          <div v-if="plansLoading" class="plans-loading">
            加载中...
          </div>
          
          <!-- 方案列表（如果有） -->
          <div v-if="plansList.length > 0" class="plans-list">
            <div v-for="plan in plansList" :key="plan.id" class="plan-item">
              <span class="plan-name">{{ plan.name }}</span>
              <div class="plan-actions">
                <button class="action-btn load-btn" @click="handleLoadPlan(plan)">加载</button>
                <button class="action-btn edit-btn" @click="handleEditPlan(plan)">编辑</button>
                <button 
                  class="action-btn delete-btn" 
                  :disabled="plansDeleting"
                  @click="handleDeletePlan(plan)"
                >
                  {{ plansDeleting ? '删除中...' : '删除' }}
                </button>
              </div>
            </div>
          </div>
        </GcsPanel>
      </template>
    </AppLayout>

    <!-- 方案重命名弹窗 -->
    <PlanSaveModal
      :visible="showSaveModal"
      :saving="savingName"
      :error-msg="saveError"
      :initial-name="editingNamePlan?.name || ''"
      @close="showSaveModal = false"
      @save="handleSaveName"
    />
  </div>
</template>

<style scoped>
.profile-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* AUDIT-110: 方案列表错误提示 */
.plans-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  color: #ff4d4f;
  font-size: 13px;
  pointer-events: auto;
}

/* AUDIT-109: 方案列表 Loading 状态 */
.plans-loading {
  margin-top: 12px;
  padding: 8px 12px;
  text-align: center;
  color: #999;
  font-size: 13px;
}

/* 方案列表 */
.plans-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
}

.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 6px;
  gap: 8px;
}

.plan-name {
  flex: 1;
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  padding: 4px 10px;
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
</style>
