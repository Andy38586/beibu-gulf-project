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

import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LoginPanel from '@/shared/components/LoginPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { usePlans } from '@/shared/composables/usePlans'

const router = useRouter()
const { updatePlan } = usePlans()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

const showSaveModal = ref(false)
const editingNamePlan = ref(null)
const saveError = ref('')
const savingName = ref(false)

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
</style>
