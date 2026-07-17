<script setup>
/**
 * PlanDrawer - 方案列表面板
 *
 * Phase 5-B：从抽屉组件迁移为 ProfilePage 右侧的 GCS Panel 内容组件。
 * 职责：展示当前用户的方案列表，支持加载、重命名、删除。
 */

import { ref, watch, computed } from 'vue'
import { usePlans } from '@/shared/composables/usePlans'
import { CELL_PIXEL } from '@/core/layout/config.js'

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

// 用于 CSS v-bind 的计算属性：基于 CELL_PIXEL 的比例计算
const confirmLineHeightCss = computed(() => `${Math.round(CELL_PIXEL * 0.275)}px`)
const headerPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const headerFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.2)}px`)
const closeBtnFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.25)}px`)
const closeBtnPaddingCss = computed(() => `0 ${Math.round(CELL_PIXEL * 0.05)}px`)
const bodyPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const statusFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1625)}px`)
const statusMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px`)
const listGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.075)}px`)
const itemPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px ${Math.round(CELL_PIXEL * 0.125)}px`)
const infoGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.025)}px`)
const planNameFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1625)}px`)
const planTimeFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1375)}px`)
const actionsGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.05)}px`)
const actionBtnPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.0375)}px ${Math.round(CELL_PIXEL * 0.1)}px`)
const actionBtnFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const confirmFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1375)}px`)
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
  padding-bottom: v-bind(headerPaddingCss);
}
.drawer-header h3 {
  margin: 0;
  font-size: v-bind(headerFontSizeCss);
  color: #fff;
}
.close-btn {
  background: none;
  border: none;
  font-size: v-bind(closeBtnFontSizeCss);
  color: rgba(255, 255, 255, 0.6);
  line-height: 1;
  cursor: pointer;
  padding: v-bind(closeBtnPaddingCss);
}
.close-btn:hover {
  color: #fff;
}
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: v-bind(bodyPaddingCss);
}
.status-text {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: v-bind(statusFontSizeCss);
  margin-top: v-bind(statusMarginCss);
}
.plan-list {
  display: flex;
  flex-direction: column;
  gap: v-bind(listGapCss);
}
.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: v-bind(itemPaddingCss);
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
  gap: v-bind(infoGapCss);
  min-width: 0;
}
.plan-name {
  font-size: v-bind(planNameFontSizeCss);
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-time {
  font-size: v-bind(planTimeFontSizeCss);
  color: rgba(255, 255, 255, 0.5);
}
.plan-actions {
  display: flex;
  gap: v-bind(actionsGapCss);
  flex-shrink: 0;
}
.action-btn {
  padding: v-bind(actionBtnPaddingCss);
  border-radius: 4px;
  font-size: v-bind(actionBtnFontSizeCss);
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
  font-size: v-bind(confirmFontSizeCss);
  color: #ff8a80;
  line-height: v-bind(confirmLineHeightCss);
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
