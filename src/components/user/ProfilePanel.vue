<script setup>
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { usePlans } from '@/composables/usePlans'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'load-plan'])

const { login, register, logout, user } = useAuth()
const { getPlans, deletePlan } = usePlans()

const mode = ref('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

const plans = ref([])
const plansLoading = ref(false)
const deleting = ref(null)
const confirmDeleteId = ref(null)

watch(
  () => props.visible,
  (v) => {
    if (v && user.value) {
      fetchPlans()
    }
  },
)

function switchMode(m) {
  mode.value = m
  errorMsg.value = ''
  confirmPassword.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请填写用户名和密码'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      errorMsg.value = '密码长度不能少于 6 位'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次密码输入不一致'
      return
    }
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await login(username.value.trim(), password.value)
    } else {
      await register(username.value.trim(), password.value)
    }
    fetchPlans()
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

async function fetchPlans() {
  plansLoading.value = true
  try {
    const raw = await getPlans()
    plans.value = raw.slice().sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt)
      const tB = new Date(b.updatedeatedAt)
      return tB - tA
    })
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

async function handleDelete(id) {
  deleting.value = id
  try {
    await deletePlan(id)
    plans.value = plans.value.filter((p) => p.id !== id)
    // eslint-disable-next-line no-empty, no-unused-vars
  } catch (e) {
  } finally {
    deleting.value = null
    confirmDeleteId.value = null
  }
}

function handleLoad(plan) {
  emit('load-plan', plan)
}
async function handleLogout() {
  await logout()
  mode.value = 'login'
  plans.value = []
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="profile-panel" v-if="visible">
    <div class="panel-header">
      <h3>{{ user ? '个人主页' : '登录/注册' }}</h3>
      <button class="close-btn" @click="emit('close')">x</button>
    </div>

    <div class="panel-body" v-if="!user">
      <div class="tab-row">
        <button :class="['tab-btn', { active: mode === 'login' }]" @click="switchMode('login')">
          登录
        </button>
        <button
          :class="['tab-btn', { active: mode === 'register' }]"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>
      <form class="auth-form" @submit.prevent="handleSubmit">
        <input
          v-model="username"
          class="input-field"
          placeholder="用户名"
          autocomplete="username"
        />
        <input
          v-model="password"
          class="input-field"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
        />
        <input
          v-if="mode === 'register'"
          v-model="confirmPassword"
          class="input-field"
          type="password"
          placeholder="确认密码"
          autocomplete="new-password"
        />
        <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
        <button type="submit" class="submit-btn" :disabled="loading">
          {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册' }}
        </button>
      </form>
    </div>

    <div class="panel-body" v-else>
      <div class="user-info">
        <div class="avatar">👤</div>
        <div class="user-details">
          <span class="user-name">{{ user.username }}</span>
          <button class="logout-btn" @click="handleLogout">退出</button>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="plans-section">
        <h4 class="section-title">我的方案</h4>
        <div v-if="plansLoading" class="status-text">加载中...</div>
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
  </div>
</template>

<style scoped>
.profile-panel {
  position: fixed;
  top: 55px;
  right: 15px;
  width: 280px;
  z-index: 40;
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
  padding: 15px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding-bottom: 15px;
}
.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}
.panel-body {
  overflow-y: auto;
}
.tab-row {
  display: flex;
  gap: 0;
  margin-bottom: 12px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
}
.tab-btn {
  flex: 1;
  padding: 6px 0;
  border: none;
  cursor: pointer;
  font-size: 13px;
  background: #f5f7fa;
  color: #666;
  transition:
    background 0.2s,
    color 0.2s;
}
.tab-btn.active {
  background: #409eff;
  color: white;
  font-weight: 500;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-field {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}
.input-field:focus {
  border-color: #409eff;
}
.error-text {
  color: #e74c3c;
  font-size: 12px;
  margin: 0;
}
.submit-btn {
  padding: 8px 0;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}
.submit-btn:hover:not(:disabled) {
  background: #337ecc;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 15px;
}
.avatar {
  width: 48px;
  height: 48px;
  background: #f0f2f5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.user-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.user-name {
  font-size: 16px;
  font-weight: 500;
  color: #333;
}
.logout-btn {
  padding: 4px 10px;
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: #666;
  align-self: flex-start;
}
.logout-btn:hover {
  background: #eee;
}
.section-divider {
  height: 1px;
  background: #eee;
  margin: 0 -15px 15px;
}
.section-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}
.status-text {
  text-align: center;
  color: #999;
  font-size: 13px;
  margin-top: 10px;
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
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-time {
  font-size: 11px;
  color: #999;
}
.plan-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.action-btn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
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
.confirm-hint {
  font-size: 11px;
  color: #e74c3c;
  line-height: 22px;
}
.confirm-yes {
  color: #e74c3c;
  border-color: #e74c3c;
}
.confirm-no {
  color: #666;
  border-color: #ccc;
}
</style>
