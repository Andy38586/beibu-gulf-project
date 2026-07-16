<script setup>
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 职责：承载用户认证与方案管理，不继承首页四象限布局。
 * Phase 5-A：改为左右分区结构，使用 GCS Cell/Panel 统一设计语言。
 * Phase 5-B：迁移 ProfilePanel / PlanDrawer / PlanSaveModal 到本页面。
 * - 左侧 4×4 Panel：ProfilePanel（登录/注册/用户信息）
 * - 右侧 4×4 Panel：PlanDrawer（方案列表）
 * - PlanSaveModal：方案重命名
 * - 整体占用 8×4 Cell 的居中工作台
 */

import { ref, computed, watch } from 'vue'
import { useAuth } from '@/shared/composables/useAuth'
import { usePlans } from '@/shared/composables/usePlans'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import ProfilePanel from '@/shared/components/ProfilePanel.vue'
import PlanDrawer from '@/shared/components/PlanDrawer.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { useGCS } from '@/core/layout/useGCS.js'
import { GAP } from '@/core/layout/config.js'

const router = useRouter()
const { user } = useAuth()
const { updatePlan } = usePlans()
const { cell } = useGCS()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

const showProfile = ref(true)
const showPlanDrawer = ref(true)
const showSaveModal = ref(false)
const editingNamePlan = ref(null)
const saveError = ref('')
const savingName = ref(false)

// 用户工作台尺寸：8×4 Cell，居中显示
const workspaceStyle = computed(() => ({
  width: cell(8, 4).width,
  height: cell(8, 4).height,
  gap: `${GAP}px`,
}))

// 登录成功后刷新方案列表
watch(user, (u) => {
  if (u) {
    showPlanDrawer.value = false
    // 触发 PlanDrawer 重新加载
    setTimeout(() => {
      showPlanDrawer.value = true
    }, 0)
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
    // 刷新方案列表
    showPlanDrawer.value = false
    setTimeout(() => {
      showPlanDrawer.value = true
    }, 0)
  } catch (e) {
    saveError.value = e.message || '重命名失败'
  } finally {
    savingName.value = false
  }
}
</script>

<template>
  <div class="profile-page">
    <!-- 8×4 用户工作台：左右两个 4×4 Panel -->
    <div class="profile-workspace" :style="workspaceStyle">
      <!-- 左侧：ProfilePanel -->
      <GcsPanel :w="4" :h="4" class="profile-panel-slot">
        <ProfilePanel :visible="showProfile" @close="showProfile = false" />
      </GcsPanel>

      <!-- 右侧：PlanDrawer -->
      <GcsPanel :w="4" :h="4" class="profile-panel-slot">
        <PlanDrawer
          :visible="showPlanDrawer"
          @close="showPlanDrawer = false"
          @load-plan="handleLoadPlan"
          @edit-plan="handleEditPlan"
        />
      </GcsPanel>
    </div>

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

/* 用户工作台：8×4 Cell，居中定位 */
.profile-workspace {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: stretch;
  pointer-events: auto;
  padding: 0;
}

/* Panel 插槽：确保子组件撑满 GcsPanel 内容区 */
.profile-panel-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
