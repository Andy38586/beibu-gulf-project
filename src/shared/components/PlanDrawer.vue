<script setup>
/**
 * PlanDrawer - 方案列表面板
 *
 * Phase 5-B：从抽屉组件迁移为 ProfilePage 右侧的 GCS Panel 内容组件。
 * 职责：展示当前用户的方案列表，支持加载、重命名、删除。
 */

import { ref, watch } from 'vue'
import { usePlans } from '@/shared/composables/usePlans'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'load-plan', 'edit-plan'])

const { getPlans, deletePlan } = usePlans()

const plans = ref([])
const loading = ref(false)
const deleting = ref(null)
const confirmDeleteId = ref(null)

watch(
  () => props.visible,
  (v) => {
    if (v) fetchPlans()
  },
)

async function fetchPlans() {
  loading.value = true
  try {
    const raw = await getPlans()
    plans.value = raw.slice().sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt)
      const tB = new Date(b.updatedAt || b.createdAt)
      return tB - tA
    })
  } catch (e) {
    plans.value = []
  } finally {
    loading.value = false
  }
}

async function handleDelete(id) {
  deleting.value = id
  try {
    await deletePlan(id)
    plans.value = plans.value.filter((p) => p.id !== id)
  } catch (e) {
  } finally {
    deleting.value = null
    confirmDeleteId.value = null
  }
}

function handleLoad(plan) {
  emit('load-plan', plan)
}

function handleEdit(plan) {
  emit('edit-plan', plan)
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div v-if="visible" class="plan-drawer">
    <div class="drawer-header">
      <h3>我的方案</h3>
      <button type="button" class="close-btn" @click="emit('close')">×</button>
    </div>
    <div class="drawer-body">
      <div v-if="loading" class="status-text">加载中...</div>
      <div v-else-if="plans.length === 0" class="status-text">暂无保存的方案</div>
      <div v-else class="plan-list">
        <div v-for="plan in plans" :key="plan.id" class="plan-item">
          <div class="plan-info">
            <span class="plan-name">{{ plan.name }}</span>
            <span class="plan-time">{{ formatDate(plan.createdAt) }}</span>
          </div>
          <div class="plan-actions">
            <template v-if="confirmDeleteId === plan.id">
              <span class="confirm-hint">确认?</span>
              <button class="action-btn confirm-yes" @click="handleDelete(plan.id)">确认</button>
              <button class="action-btn confirm-no" @click="confirmDeleteId = null">取消</button>
            </template>
            <template v-else>
              <button class="action-btn load-btn" @click="handleLoad(plan)">加载</button>
              <button class="action-btn edit-btn" @click="handleEdit(plan)">编辑</button>
              <button
                class="action-btn delete-btn"
                :disabled="deleting === plan.id"
                @click="confirmDeleteId = plan.id"
              >
                {{ deleting === plan.id ? '...' : '删除' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-drawer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.drawer-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 12px;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
  color: #fff;
}
.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.close-btn:hover {
  color: #fff;
}
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
}
.status-text {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  margin-top: 8px;
}
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  transition: background 0.15s;
}
.plan-item:hover {
  background: rgba(255, 255, 255, 0.15);
}
.plan-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.plan-name {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
.plan-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.action-btn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transition: background 0.15s;
}
.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.load-btn {
  color: #a8d8ff;
  border-color: rgba(168, 216, 255, 0.5);
}
.edit-btn {
  color: #b4f0c9;
  border-color: rgba(180, 240, 201, 0.5);
}
.delete-btn {
  color: #ff8a80;
  border-color: rgba(255, 138, 128, 0.5);
}
.confirm-hint {
  font-size: 11px;
  color: #ff8a80;
  line-height: 22px;
}
.confirm-yes {
  color: #ff8a80;
  border-color: rgba(255, 138, 128, 0.5);
}
.confirm-no {
  color: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.3);
}
</style>
