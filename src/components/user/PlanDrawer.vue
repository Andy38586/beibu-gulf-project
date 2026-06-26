<script setup>
import { ref, watch } from 'vue'
import { usePlans } from '@/composables/usePlans'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'load-plan', 'edit-plan'])

const { getPlans, deletePlan } = usePlans()

const plans = ref([])
const loading = ref(false)
const deleting = ref(null)
const confirmDeleteId = ref(null)

watch(() => props.visible, (v) => {
  if (v) fetchPlans()
})

async function fetchPlans() {
  loading.value = true
  try {
    const raw = await getPlans()
    plans.value = raw.slice().sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt);
      const tB = new Date(b.updatedAt || b.createdAt);
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

function handleEdit(plan) { emit('edit-plan', plan) }

function handleLoad(plan) {
  emit('load-plan', plan)
  emit('close')
}

function onOverlayClick() {
  emit('close')
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="drawer-overlay" @click.self="onOverlayClick">
      <div class="drawer-panel">
        <div class="drawer-header">
          <h3>我的方案</h3>
          <button class="close-btn" @click="emit('close')">x</button>
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
                  <span class="confirm-hint">确认删除?</span>
                  <button class="action-btn confirm-yes" @click="handleDelete(plan.id)">确认</button>
                  <button class="action-btn confirm-no" @click="confirmDeleteId = null">取消</button>
                </template>
                <template v-else>
                <button class="action-btn load-btn" @click="handleLoad(plan)">加载</button>
                <button
                  class="action-btn delete-btn"
                  :disabled="deleting === plan.id"
                  @click="confirmDeleteId = plan.id"
                >{{ deleting === plan.id ? '...' : '删除' }}</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 320px;
  height: 100%;
  background: white;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #eee;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.status-text {
  text-align: center;
  color: #999;
  font-size: 14px;
  margin-top: 40px;
}
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #f9fafb;
  border-radius: 6px;
  transition: background 0.15s;
}
.plan-item:hover {
  background: #f0f2f5;
}
.plan-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.plan-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-time {
  font-size: 12px;
  color: #999;
}
.plan-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.action-btn {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  border: 1px solid #ddd;
  cursor: pointer;
  background: white;
  transition: background 0.15s;
}
.action-btn:hover:not(:disabled) {
  background: #f5f5f5;
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.load-btn {
  color: #409eff;
  border-color: #409eff;
}
.load-btn:hover:not(:disabled) {
  background: #ecf5ff;
}
.delete-btn {
  color: #e74c3c;
  border-color: #e74c3c;
}
.delete-btn:hover:not(:disabled) {
  background: #fef0ef;
}
.edit-btn {
  color: #27ae60;
  border-color: #27ae60;
}
.edit-btn:hover:not(:disabled) {
  background: #e8f8f0;
}
.confirm-hint {
  font-size: 12px;
  color: #e74c3c;
  line-height: 26px;
}
.confirm-yes {
  color: #e74c3c;
  border-color: #e74c3c;
}
.confirm-yes:hover:not(:disabled) {
  background: #fef0ef;
}
.confirm-no {
  color: #666;
  border-color: #ccc;
}
</style>
